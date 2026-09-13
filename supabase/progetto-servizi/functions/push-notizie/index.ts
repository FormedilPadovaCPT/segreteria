// Supabase Edge Function – push-notizie (progetto SERVIZI, qcvwrgjldbdoxcfdsvkq)
//
// AVVISI DELLE NOTIZIE SUL TELEFONO (13/09/2026).
//
// Il portale servizi e' un'app installabile (PWA): chi lo vuole attiva dalla
// pagina Notizie un avviso che arriva quando si pubblica una notizia. Nessuna app
// negli store: Web Push, con la cifratura e la firma in webpush.js (provato sul
// PC col vettore dell'RFC 8291: strumenti/prova-webpush.mjs del repo segreteria).
//
// Porte:
//   GET                          pubblica: la chiave VAPID pubblica, che il browser
//                                usa per iscriversi (la coppia si genera al primo uso)
//   POST {azione:'iscrivi'}      pubblica: salva l'iscrizione del browser. Si
//                                accettano solo indirizzi dei servizi di notifica
//                                veri (Google, Apple, Mozilla, Microsoft) e chiavi
//                                della lunghezza giusta; tetto per tutti e per IP
//   POST {azione:'cancella'}     pubblica: toglie un'iscrizione (serve l'indirizzo,
//                                che conosce solo quel browser)
//   POST {azione:'invia'}        con X-Campanello: manda gli avvisi delle notizie
//                                pubblicate e non ancora avvisate. La chiamano il
//                                trigger su notizie (subito) e pg_cron (ogni 30 min).
//                                Risponde subito e lavora in sottofondo
//   POST {azione:'prova'}        con X-Campanello: un avviso di prova alle ultime
//                                N iscrizioni (per il collaudo), senza notizia
//
// Che cosa NON fa, di proposito: nessun testo scelto da chi chiama finisce in una
// notifica (titolo ed estratto vengono dalla notizia pubblicata, la prova ha un
// testo fisso); nessun dato personale: dell'IP solo un'impronta col sale per il
// tetto, che non si conserva con l'iscrizione.
//
// verify_jwt = false: le porte pubbliche sono anonime come il portale, le altre
// chiedono la parola d'ordine del campanello, che vive solo nel database.
// Sorgente in segreteria-app/supabase/progetto-servizi/functions/push-notizie/.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { generaChiaviVapid, inviaNotifica, daB64u } from './webpush.js'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

type SB = ReturnType<typeof createClient>
type Chiavi = { jwk: JsonWebKey; pubblica: string }
type Iscrizione = { id: number; endpoint: string; p256dh: string; auth: string }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } })
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

const MAX_CORPO = 4096
const IN_PARALLELO = 20
/* i servizi di notifica dei browser: un indirizzo che non e' fra questi non e' un'iscrizione */
const HOST_PUSH = [
  /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /^web\.push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
]
const DISPOSITIVI = ['android', 'iphone', 'computer', 'altro']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* le letture si ritentano (502/503/504 di passaggio), le scritture no */
async function impostazioni(sb: SB): Promise<Record<string, string>> {
  let ultimo = ''
  for (let i = 0; i < 3; i++) {
    const { data, error } = await sb.from('push_impostazioni').select('chiave, valore')
    if (!error) return Object.fromEntries((data || []).map((r) => [r.chiave as string, r.valore as string]))
    ultimo = error.message
    await new Promise((ok) => setTimeout(ok, 800 * (i + 1)))
  }
  throw new Error('impostazioni degli avvisi non leggibili: ' + ultimo)
}

async function chiaviVapid(sb: SB, imp: Record<string, string>): Promise<Chiavi> {
  if (imp.vapid) return JSON.parse(imp.vapid)
  const nuove = await generaChiaviVapid()
  // due richieste insieme: vince la prima scritta, e tutte rileggono quella
  await sb.from('push_impostazioni').upsert({
    chiave: 'vapid', valore: JSON.stringify(nuove),
    descrizione: 'Coppia di chiavi VAPID (JWK privata + pubblica), generata da push-notizie al primo uso. NON cambiarla.',
  }, { onConflict: 'chiave', ignoreDuplicates: true })
  const { data, error } = await sb.from('push_impostazioni').select('valore').eq('chiave', 'vapid').single()
  if (error || !data) throw new Error('chiavi VAPID non leggibili: ' + (error?.message || 'riga mancante'))
  return JSON.parse(data.valore as string)
}

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

const indirizzoIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'sconosciuto'
async function impronta(sale: string, ip: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sale + ':' + ip)))
  return [...h.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ── porte pubbliche ── */

async function iscrivi(sb: SB, imp: Record<string, string>, req: Request, d: Record<string, any>) {
  const s = d.iscrizione || {}
  const endpoint = typeof s.endpoint === 'string' ? s.endpoint : ''
  const p256dh = typeof s.keys?.p256dh === 'string' ? s.keys.p256dh : ''
  const auth = typeof s.keys?.auth === 'string' ? s.keys.auth : ''
  let url: URL
  try { url = new URL(endpoint) } catch { return json({ error: 'iscrizione non valida' }, 400) }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !HOST_PUSH.some((r) => r.test(url.hostname))) {
    return json({ error: 'servizio di notifica non riconosciuto' }, 400)
  }
  try {
    const k = daB64u(p256dh), a = daB64u(auth)
    if (k.length !== 65 || k[0] !== 4 || a.length !== 16 || p256dh.length > 120 || auth.length > 40) throw new Error()
  } catch { return json({ error: 'chiavi dell\'iscrizione non valide' }, 400) }
  const dispositivo = DISPOSITIVI.includes(d.dispositivo) ? d.dispositivo : 'altro'

  const ip = await impronta(imp.ip_sale || '', indirizzoIp(req))
  const { data: ammessa, error: qe } = await sb.rpc('push_quota', {
    p_ip: ip, p_max_ora: Number(imp.quota_ora || 300), p_max_ora_ip: Number(imp.quota_ora_ip || 20),
  })
  if (qe) throw new Error('tetto: ' + qe.message)
  if (!ammessa) return json({ error: 'troppe richieste: riprova fra un\'ora' }, 429)

  const { error } = await sb.from('push_iscrizioni').upsert({
    endpoint, p256dh, auth, dispositivo, aggiornata_il: new Date().toISOString(), errori_consecutivi: 0,
  }, { onConflict: 'endpoint' })
  if (error) throw new Error('iscrizione: ' + error.message)
  return json({ ok: true })
}

async function cancella(sb: SB, d: Record<string, any>) {
  const endpoint = typeof d.endpoint === 'string' ? d.endpoint : ''
  if (!endpoint || endpoint.length > 1000) return json({ error: 'iscrizione non valida' }, 400)
  const { error } = await sb.from('push_iscrizioni').delete().eq('endpoint', endpoint)
  if (error) throw new Error('cancellazione: ' + error.message)
  return json({ ok: true })   // uguale anche se non c'era: la risposta non dice chi e' iscritto
}

/* ── invio ── */

function estratto(html: string | null, max = 160): string {
  const t = String(html || '')
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const taglio = t.slice(0, max)
  return taglio.slice(0, Math.max(taglio.lastIndexOf(' '), max - 20)).trim() + '…'
}

async function tutteLeIscrizioni(sb: SB): Promise<Iscrizione[]> {
  const out: Iscrizione[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await sb.from('push_iscrizioni').select('id, endpoint, p256dh, auth').order('id').range(da, da + 999)
    if (error) throw new Error('iscrizioni: ' + error.message)
    out.push(...(data as Iscrizione[]))
    if (!data || data.length < 1000) return out
  }
}

async function mandaATutti(sb: SB, iscritti: Iscrizione[], messaggio: string, chiavi: Chiavi, contatto: string, urgenza: string) {
  const consegnate: number[] = [], errori: number[] = [], morte: number[] = []
  const campioni: string[] = []
  let i = 0
  const lavoratore = async () => {
    while (i < iscritti.length) {
      const s = iscritti[i++]
      try {
        const r = await inviaNotifica(s, messaggio, chiavi, contatto, { urgenza })
        if (r.consegnata) consegnate.push(s.id)
        else if (r.morta) morte.push(s.id)
        else { errori.push(s.id); if (campioni.length < 3) campioni.push(r.stato + ' ' + new URL(s.endpoint).hostname + ' ' + r.testo.slice(0, 80)) }
      } catch (e) {
        errori.push(s.id)
        if (campioni.length < 3) campioni.push('eccezione ' + errMsg(e).slice(0, 80))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(IN_PARALLELO, iscritti.length) }, lavoratore))
  const { error } = await sb.rpc('push_registra', { p_consegnate: consegnate, p_errori: errori, p_morte: morte })
  if (error) campioni.push('registrazione esiti: ' + error.message)
  return { destinatari: iscritti.length, consegnati: consegnate.length, rimossi: morte.length, falliti: errori.length, campioni }
}

async function inviaNotizie(sb: SB, imp: Record<string, string>, d: Record<string, any>) {
  const idNotizia = typeof d.notizia_id === 'string' && UUID.test(d.notizia_id) ? d.notizia_id : null
  const chiavi = await chiaviVapid(sb, imp)
  const contatto = imp.contatto || 'mailto:cpt@formedilpadova.it'
  await sb.from('push_impostazioni').upsert({ chiave: 'ultimo_giro_il', valore: new Date().toISOString(), descrizione: 'Ultima chiamata di invio (campanello o giro): è il battito del canale.' }, { onConflict: 'chiave' })

  const { data: notizie, error } = await sb.rpc('push_notizie_da_inviare', { p_id: idNotizia })
  if (error) throw new Error('notizie da avvisare: ' + error.message)
  const esiti = []
  for (const n of (notizie || []) as { id: string; titolo: string; corpo: string; priorita: string }[]) {
    const { data: presa, error: pe } = await sb.rpc('push_prenota', { p_notizia: n.id })
    if (pe) throw new Error('prenotazione: ' + pe.message)
    if (!presa) continue                                  // la sta mandando qualcun altro
    const iscritti = await tutteLeIscrizioni(sb)
    const messaggio = JSON.stringify({
      titolo: String(n.titolo || 'Nuova notizia').slice(0, 120),
      testo: estratto(n.corpo),
      url: './?pagina=notizie',
      tag: 'notizia-' + n.id,
    })
    const r = await mandaATutti(sb, iscritti, messaggio, chiavi, contatto, n.priorita === 'urgente' ? 'high' : 'normal')
    const { error: ce } = await sb.rpc('push_concludi', {
      p_id: (presa as any).id, p_preso_il: (presa as any).preso_il,
      p_esito: { ...r, nota: r.campioni.join(' | ') || null },
    })
    if (ce) console.error('push-notizie: chiusura invio', n.id, ce.message)
    esiti.push({ notizia: n.id, ...r })
  }
  return esiti
}

async function prova(sb: SB, imp: Record<string, string>, d: Record<string, any>) {
  const quante = Math.min(5, Math.max(1, Number(d.quante) || 1))
  const chiavi = await chiaviVapid(sb, imp)
  const { data, error } = await sb.from('push_iscrizioni').select('id, endpoint, p256dh, auth, dispositivo')
    .order('aggiornata_il', { ascending: false }).limit(quante)
  if (error) throw new Error('iscrizioni: ' + error.message)
  const messaggio = JSON.stringify({
    titolo: 'Prova degli avvisi – Formedil Padova',
    testo: 'Se leggi questo messaggio, gli avvisi delle notizie arrivano sul tuo dispositivo.',
    url: './?pagina=notizie', tag: 'prova',
  })
  const r = await mandaATutti(sb, (data || []) as Iscrizione[], messaggio, chiavi, imp.contatto || 'mailto:cpt@formedilpadova.it', 'normal')
  return json({ ok: true, dispositivi: (data || []).map((x: any) => x.dispositivo), ...r })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    const imp = await impostazioni(sb)
    if (req.method === 'GET') {
      const chiavi = await chiaviVapid(sb, imp)
      return json({ chiave: chiavi.pubblica }, 200, { 'Cache-Control': 'public, max-age=3600' })
    }
    if (req.method !== 'POST') return json({ error: 'metodo non ammesso' }, 405)

    const testo = await req.text()
    if (testo.length > MAX_CORPO) return json({ error: 'richiesta troppo grande' }, 413)
    let d: Record<string, any>
    try { d = JSON.parse(testo) } catch { return json({ error: 'richiesta non valida' }, 400) }
    if (!d || typeof d !== 'object') return json({ error: 'richiesta non valida' }, 400)

    if (d.azione === 'iscrivi') return await iscrivi(sb, imp, req, d)
    if (d.azione === 'cancella') return await cancella(sb, d)

    const token = req.headers.get('x-campanello') || ''
    if (!imp.campanello_token || !uguali(token, imp.campanello_token)) return json({ error: 'non autorizzato' }, 401)

    if (d.azione === 'invia') {
      const lavoro = inviaNotizie(sb, imp, d)
        .then((esiti) => console.log('push-notizie: invio', JSON.stringify(esiti)))
        .catch((e) => console.error('push-notizie: invio fallito', errMsg(e)))
      EdgeRuntime.waitUntil(lavoro)
      return json({ ok: true, accettata: true }, 202)
    }
    if (d.azione === 'prova') return await prova(sb, imp, d)
    return json({ error: 'azione sconosciuta' }, 400)
  } catch (e) {
    console.error('push-notizie:', errMsg(e))
    return json({ error: 'errore interno, riprova' }, 503)
  }
})
