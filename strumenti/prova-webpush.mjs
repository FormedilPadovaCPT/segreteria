// Prova sul PC del modulo webpush.js della funzione push-notizie (progetto Servizi).
// Uso: node strumenti/prova-webpush.mjs   (esce con errore se una prova fallisce)
//
// 1. vettore di prova dell'RFC 8291 (Appendice A): con chiavi e sale fissati il
//    corpo cifrato deve essere IDENTICO byte per byte a quello pubblicato;
// 2. la firma VAPID si verifica con la chiave pubblica e il JWT ha aud/exp/sub giusti;
// 3. andata e ritorno: un «browser» finto decifra quello che la funzione cifra,
//    ricevuto da un server HTTP locale con le intestazioni vere (201 e 410).

import assert from 'node:assert/strict'
import http from 'node:http'
import { b64u, daB64u, unisci, hkdf, cifra, generaChiaviVapid, autorizzazioneVapid, inviaNotifica } from '../supabase/progetto-servizi/functions/push-notizie/webpush.js'

const te = new TextEncoder()
const td = new TextDecoder()
let fallite = 0
async function prova(nome, fn) {
  try { await fn(); console.log('OK  ' + nome) } catch (e) { fallite++; console.log('NO  ' + nome + '\n    ' + (e?.message || e)) }
}

async function chiaveEcdh(pubB64, privB64) {
  const pub = daB64u(pubB64)
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privB64 }
  return {
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
  }
}

/* il lato browser, scritto a parte seguendo l'RFC: legge l'intestazione e decifra */
async function decifra(corpo, uaPubB64, uaPrivB64, authB64) {
  const b = new Uint8Array(corpo)
  const sale = b.slice(0, 16)
  const rs = new DataView(b.buffer, b.byteOffset).getUint32(16)
  const idlen = b[20]
  const asPub = b.slice(21, 21 + idlen)
  const cifrato = b.slice(21 + idlen)
  assert.equal(rs, 4096, 'dimensione blocco')
  const ua = await chiaveEcdh(uaPubB64, uaPrivB64)
  const asChiave = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const condiviso = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asChiave }, ua.privateKey, 256))
  const ikm = await hkdf(daB64u(authB64), condiviso, unisci(te.encode('WebPush: info\0'), daB64u(uaPubB64), asPub), 32)
  const cek = await hkdf(sale, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(sale, ikm, te.encode('Content-Encoding: nonce\0'), 12)
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const chiaro = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, k, cifrato))
  let fine = chiaro.length - 1
  while (fine >= 0 && chiaro[fine] === 0) fine--
  assert.equal(chiaro[fine], 2, 'delimitatore di ultimo blocco')
  return td.decode(chiaro.slice(0, fine))
}

await prova('RFC 8291 Appendice A: corpo identico al vettore pubblicato', async () => {
  const effimera = await chiaveEcdh(
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw')
  const corpo = await cifra('When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { effimera, sale: daB64u('DGv6ra1nlYgDCS1FRnbzlw') })
  assert.equal(b64u(corpo),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
})

await prova('RFC 8291 Appendice A: il lato browser decifra il vettore', async () => {
  const testo = await decifra(
    daB64u('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    'BTBZMqHH6r4Tts7J_aSIgg')
  assert.equal(testo, 'When I grow up, I want to be a watermelon')
})

const vapid = await generaChiaviVapid()

await prova('VAPID: firma verificabile, aud/exp/sub giusti', async () => {
  const adesso = Date.parse('2026-09-13T12:00:00Z')
  const aut = await autorizzazioneVapid('https://fcm.googleapis.com/fcm/send/abc', vapid, 'mailto:cpt@formedilpadova.it', adesso)
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(aut)
  assert.ok(m, 'forma dell\'intestazione')
  assert.equal(m[4], vapid.pubblica)
  assert.deepEqual(JSON.parse(td.decode(daB64u(m[1]))), { typ: 'JWT', alg: 'ES256' })
  const claims = JSON.parse(td.decode(daB64u(m[2])))
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.equal(claims.sub, 'mailto:cpt@formedilpadova.it')
  assert.equal(claims.exp, adesso / 1000 + 12 * 3600)
  const pub = await crypto.subtle.importKey('raw', daB64u(vapid.pubblica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const firma = daB64u(m[3])
  assert.equal(firma.length, 64, 'firma r||s di 64 byte')
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, firma, te.encode(m[1] + '.' + m[2])), 'firma valida')
})

await prova('Invio a un server locale: intestazioni, decifratura, 201 e 410', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const uaPub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
  const uaPriv = (await crypto.subtle.exportKey('jwk', ua.privateKey)).d
  const auth = b64u(crypto.getRandomValues(new Uint8Array(16)))
  const ricevuti = []
  const server = http.createServer((req, res) => {
    const pezzi = []
    req.on('data', (c) => pezzi.push(c))
    req.on('end', () => {
      ricevuti.push({ url: req.url, h: req.headers, corpo: Buffer.concat(pezzi) })
      res.writeHead(req.url.includes('morta') ? 410 : 201).end()
    })
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const messaggio = JSON.stringify({ titolo: 'Chiusura uffici', testo: 'Àccenti e “virgolette” arrivano intatti', url: './?pagina=notizie' })
    const r1 = await inviaNotifica({ endpoint: base + '/viva', p256dh: uaPub, auth }, messaggio, vapid, 'mailto:cpt@formedilpadova.it', { urgenza: 'high' })
    assert.deepEqual([r1.stato, r1.consegnata, r1.morta], [201, true, false])
    const r2 = await inviaNotifica({ endpoint: base + '/morta', p256dh: uaPub, auth }, messaggio, vapid, 'mailto:cpt@formedilpadova.it')
    assert.deepEqual([r2.stato, r2.consegnata, r2.morta], [410, false, true])
    const h = ricevuti[0].h
    assert.equal(h['content-encoding'], 'aes128gcm')
    assert.equal(h['urgency'], 'high')
    assert.equal(h['ttl'], String(3 * 24 * 3600))
    assert.match(h['authorization'], /^vapid t=.+, k=/)
    assert.equal(await decifra(ricevuti[0].corpo, uaPub, uaPriv, auth), messaggio)
  } finally { server.close() }
})

await prova('Messaggio troppo lungo rifiutato prima di partire', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const uaPub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)))
  await assert.rejects(cifra('x'.repeat(5000), uaPub, b64u(new Uint8Array(16))), /troppo lungo/)
})

if (fallite) { console.log(fallite + ' prove fallite'); process.exit(1) }
console.log('Tutte le prove superate')
