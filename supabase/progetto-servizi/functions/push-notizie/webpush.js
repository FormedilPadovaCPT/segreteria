// webpush.js — invio di una notifica Web Push (13/09/2026)
//
// Tre standard, scritti qui senza librerie perche' bastano le primitive di
// WebCrypto, che la edge function (Deno) e Node hanno uguali: cosi' lo stesso
// file si prova sul PC (strumenti/prova-webpush.mjs) prima di pubblicarlo.
//   RFC 8030  il protocollo: una POST all'indirizzo che il browser ha dato
//   RFC 8292  VAPID: chi manda si firma con una chiave ES256 (P-256)
//   RFC 8291  la cifratura del messaggio (aes128gcm, RFC 8188): il servizio
//             di notifica (Google, Apple, Mozilla) trasporta il messaggio ma
//             non lo puo' leggere
//
// Nessuna dipendenza: solo crypto.subtle, TextEncoder, atob/btoa, fetch.

const te = new TextEncoder()

export function b64u(bytes) {
  const b = new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function daB64u(testo) {
  let s = String(testo).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function unisci(...parti) {
  const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parti) { out.set(p, o); o += p.length }
  return out
}

/* HKDF-SHA-256 (RFC 5869) in un colpo: estrazione con il sale, espansione con info */
export async function hkdf(sale, materiale, info, byte) {
  const k = await crypto.subtle.importKey('raw', materiale, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sale, info }, k, byte * 8))
}

/* Coppia VAPID nuova. Si genera UNA volta e non si cambia piu': ogni iscrizione
   dei telefoni e' legata a questa chiave pubblica, e cambiandola smetterebbero
   di arrivare tutte le notifiche finche' ognuno non si iscrive di nuovo. */
export async function generaChiaviVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey)
  const pubblica = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))
  return { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, pubblica: b64u(pubblica) }
}

/* RFC 8291: cifra il messaggio per un solo destinatario (le sue chiavi p256dh e auth).
   Restituisce il corpo della POST: intestazione aes128gcm + testo cifrato.
   `prova` serve solo ai test (chiave effimera e sale fissati). */
export async function cifra(messaggio, p256dh, auth, prova = {}) {
  const uaPub = daB64u(p256dh)
  const segreto = daB64u(auth)
  if (uaPub.length !== 65 || uaPub[0] !== 4) throw new Error('chiave p256dh non valida')
  if (segreto.length !== 16) throw new Error('segreto auth non valido')

  const effimera = prova.effimera || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', effimera.publicKey))
  const uaChiave = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const condiviso = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaChiave }, effimera.privateKey, 256))

  // key_info = "WebPush: info" 0x00 || chiave del browser || chiave effimera
  const ikm = await hkdf(segreto, condiviso, unisci(te.encode('WebPush: info\0'), uaPub, asPub), 32)
  const sale = prova.sale || crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(sale, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sale, ikm, te.encode('Content-Encoding: nonce\0'), 12)

  const testo = typeof messaggio === 'string' ? te.encode(messaggio) : new Uint8Array(messaggio)
  const chiaro = unisci(testo, new Uint8Array([2]))          // 0x02 = ultimo (e unico) blocco
  const RS = 4096
  if (chiaro.length + 16 > RS) throw new Error('messaggio troppo lungo per una notifica')
  const chiave = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cifrato = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, chiave, chiaro))

  // intestazione: sale (16) | dimensione blocco (4, big endian) | lunghezza id (1) | id = chiave effimera (65)
  const testa = new Uint8Array(21)
  testa.set(sale, 0)
  new DataView(testa.buffer).setUint32(16, RS)
  testa[20] = asPub.length
  return unisci(testa, asPub, cifrato)
}

/* RFC 8292: "vapid t=<JWT firmato>, k=<chiave pubblica>". Il JWT vale per
   l'origine del servizio di notifica e scade entro 24 ore (qui 12). */
export async function autorizzazioneVapid(endpoint, chiavi, contatto, adesso = Date.now()) {
  const pezzo = (o) => b64u(te.encode(JSON.stringify(o)))
  const daFirmare = pezzo({ typ: 'JWT', alg: 'ES256' }) + '.' +
    pezzo({ aud: new URL(endpoint).origin, exp: Math.floor(adesso / 1000) + 12 * 3600, sub: contatto })
  const privata = await crypto.subtle.importKey('jwk', chiavi.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const firma = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privata, te.encode(daFirmare)))
  return 'vapid t=' + daFirmare + '.' + b64u(firma) + ', k=' + chiavi.pubblica
}

/* Una notifica a un'iscrizione. Non lancia eccezioni per le risposte del
   servizio: restituisce lo stato, e decide chi chiama.
   201/200/202 consegnata · 404/410 iscrizione morta, va tolta · altro errore */
export async function inviaNotifica(iscrizione, messaggio, chiavi, contatto, opzioni = {}) {
  const corpo = await cifra(messaggio, iscrizione.p256dh, iscrizione.auth)
  const r = await fetch(iscrizione.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await autorizzazioneVapid(iscrizione.endpoint, chiavi, contatto),
      TTL: String(opzioni.ttl ?? 3 * 24 * 3600),
      Urgency: opzioni.urgenza || 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body: corpo,
  })
  const testo = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 300)
  return { stato: r.status, consegnata: r.status >= 200 && r.status < 300, morta: r.status === 404 || r.status === 410, testo }
}
