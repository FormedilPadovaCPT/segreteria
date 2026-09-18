// Supabase Edge Function – questionari-ricevi (progetto SERVIZI, qcvwrgjldbdoxcfdsvkq)
//
// LE DOMANDE DI UN EVENTO, COPIATE DAL GESTIONALE (18/09/2026).
// Il portale non parla col database del Gestionale — chi sta su internet non
// deve avere le chiavi (regola del 13/09/2026 sulla cassetta delle lettere).
// Qui arrivano soltanto il testo delle domande e i dati per intestare la
// pagina; a leggerli è la pagina del portale, con apri_questionario(codice,
// firma), che risponde solo se codice e firma tornano insieme.
//
// Parla solo con la funzione questionari-pubblica del Gestionale: ogni
// chiamata porta X-Questionari-Token, confrontato a tempo costante con
// cassetta_impostazioni.questionari_token. Senza, 401.
//
// Azioni (POST JSON { azione, ... }):
//   pubblica  { righe: [...] }  aggiunge o aggiorna un questionario
//   ritira    { codici: [...] } lo toglie dal portale (evento annullato)
//   pubblica_iscr { righe: [...] }  un evento aperto alle iscrizioni
//   ritira_iscr   { codici: [...] } lo toglie dal portale
//   battito   {}                la tabella risponde
//
// Che cosa NON entra qui: nominativi, risposte, la firma in chiaro (arriva
// solo la sua impronta sha256). Ogni campo non previsto fa rifiutare la riga,
// così un errore dall'altra parte non può pubblicare più del dovuto.
// verify_jwt = false: chi chiama è una funzione; la porta la chiude la parola
// d'ordine. Sorgente in segreteria-app/supabase/progetto-servizi/functions/questionari-ricevi/.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const errore = (message: string, status = 400) => json({ status: 'error', message }, status)

function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

const CAMPI = new Set(['codice', 'firma_hash', 'titolo', 'genere', 'quando', 'sede', 'chiuso_il', 'domande'])
const CAMPI_TEST = new Set(['codice', 'firma_hash', 'titolo', 'quando', 'sede', 'chiuso_il', 'minuti', 'soglia', 'domande', 'persone'])
const CAMPI_DOM_TEST = new Set(['id', 'ordine', 'testo', 'tipo', 'opzioni', 'punti'])
const CAMPI_ISCR = new Set(['codice', 'firma_hash', 'titolo', 'genere', 'descrizione',
  'progetto', 'progetto_desc', 'ente', 'sede', 'modalita', 'ore', 'dal', 'al',
  'giornate', 'chiuso_il', 'in_elenco', 'aperte', 'liberi'])
const CAMPI_GIORNATA = new Set(['data', 'dalle', 'alle', 'dalle2', 'alle2', 'sede'])
const CAMPI_DOMANDA = new Set(['id', 'ordine', 'testo', 'tipo', 'opzioni', 'obbligatoria', 'tronco'])
const TIPI = new Set(['scala', 'scelta', 'multipla', 'testo'])
const GENERI = new Set(['conferenza', 'corso', 'convegno'])

const DATA = /^\d{4}-\d{2}-\d{2}$/
const ISTANTE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([.\d]*)?(Z|[+-]\d{2}:?\d{2})?$/
const testo = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const testoO = (v: unknown, max: number) => v == null || (typeof v === 'string' && v.length <= max)

/* Il portale disegna queste domande: se una arriva malformata, la pagina si
   rompe davanti a chi ha in mano il foglio. Meglio rifiutare qui. */
function controllaDomande(v: unknown): string | null {
  if (!Array.isArray(v)) return 'domande non è un elenco'
  if (v.length < 1 || v.length > 20) return `domande: ${v.length} (ne servono da 1 a 20)`
  for (const d of v) {
    if (typeof d !== 'object' || d === null) return 'domanda non è un oggetto'
    const q = d as Record<string, unknown>
    for (const k of Object.keys(q)) if (!CAMPI_DOMANDA.has(k)) return `campo non previsto nella domanda: ${k}`
    if (!(typeof q.id === 'number' && Number.isInteger(q.id) && q.id > 0)) return 'id della domanda non valido'
    if (!(typeof q.ordine === 'number' && Number.isInteger(q.ordine))) return 'ordine della domanda non valido'
    if (!testo(q.testo, 300)) return 'testo della domanda mancante o troppo lungo'
    if (typeof q.tipo !== 'string' || !TIPI.has(q.tipo)) return `tipo di domanda non previsto: ${String(q.tipo)}`
    if (typeof q.obbligatoria !== 'boolean' || typeof q.tronco !== 'boolean') return 'obbligatoria/tronco non booleani'
    if (!Array.isArray(q.opzioni)) return 'opzioni non è un elenco'
    if (q.opzioni.length > 8) return 'troppe risposte proposte'
    if ((q.tipo === 'scelta' || q.tipo === 'multipla') && q.opzioni.length < 2) return 'una domanda a scelta vuole almeno due risposte'
    if ((q.tipo === 'scala' || q.tipo === 'testo') && q.opzioni.length !== 0) return 'scala e testo non hanno risposte proposte'
    for (const o of q.opzioni) if (!testo(o, 160)) return 'una risposta proposta è vuota o troppo lunga'
  }
  return null
}

function controlla(r: Record<string, unknown>): string | null {
  for (const k of Object.keys(r)) if (!CAMPI.has(k)) return `campo non previsto: ${k}`
  if (!(typeof r.codice === 'string' && /^[0-9]{1,8}-[A-Z0-9]{4}$/.test(r.codice))) return 'codice non valido'
  if (!(typeof r.firma_hash === 'string' && /^[0-9a-f]{64}$/.test(r.firma_hash))) return 'firma_hash non valida'
  if (!testo(r.titolo, 300)) return 'titolo non valido'
  if (typeof r.genere !== 'string' || !GENERI.has(r.genere)) return `genere non previsto: ${String(r.genere)}`
  if (r.quando != null && !(typeof r.quando === 'string' && DATA.test(r.quando))) return 'quando non è una data'
  if (!testoO(r.sede, 200)) return 'sede non valida'
  if (r.chiuso_il != null && !(typeof r.chiuso_il === 'string' && ISTANTE.test(r.chiuso_il))) return 'chiuso_il non è un istante'
  return controllaDomande(r.domande)
}

/* ⚠️ Il controllo più importante di questo file: una domanda del test NON
   deve poter portare la risposta giusta. Se un campo non previsto arriva —
   «corrette», «soluzione», qualunque cosa — la riga viene rifiutata. È la
   difesa contro un errore dall'altra parte, non contro un attacco. */
function controllaTest(r: Record<string, unknown>): string | null {
  for (const k of Object.keys(r)) if (!CAMPI_TEST.has(k)) return `campo non previsto: ${k}`
  if (!(typeof r.codice === 'string' && /^T[0-9]{1,8}-[A-Z0-9]{4}$/.test(r.codice))) return 'codice non valido'
  if (!(typeof r.firma_hash === 'string' && /^[0-9a-f]{64}$/.test(r.firma_hash))) return 'firma_hash non valida'
  if (!testo(r.titolo, 300)) return 'titolo non valido'
  if (r.quando != null && !(typeof r.quando === 'string' && DATA.test(r.quando))) return 'quando non è una data'
  if (!testoO(r.sede, 200)) return 'sede non valida'
  if (r.chiuso_il != null && !(typeof r.chiuso_il === 'string' && ISTANTE.test(r.chiuso_il))) return 'chiuso_il non è un istante'
  if (r.minuti != null && !(typeof r.minuti === 'number' && r.minuti > 0 && r.minuti <= 600)) return 'minuti non validi'
  if (r.soglia != null && !(typeof r.soglia === 'number' && r.soglia >= 0 && r.soglia <= 100)) return 'soglia non valida'

  if (!Array.isArray(r.domande) || r.domande.length < 1 || r.domande.length > 60) return 'domande: da 1 a 60'
  for (const d of r.domande as Record<string, unknown>[]) {
    if (typeof d !== 'object' || d === null) return 'domanda non è un oggetto'
    for (const k of Object.keys(d)) {
      if (!CAMPI_DOM_TEST.has(k)) return `campo non previsto nella domanda: ${k} (le risposte giuste non escono dal Gestionale)`
    }
    if (!(typeof d.id === 'number' && Number.isInteger(d.id) && d.id > 0)) return 'id della domanda non valido'
    if (!testo(d.testo, 600)) return 'testo della domanda mancante o troppo lungo'
    if (d.tipo !== 'scelta' && d.tipo !== 'multipla' && d.tipo !== 'testo') return `tipo non previsto: ${String(d.tipo)}`
    if (!Array.isArray(d.opzioni) || d.opzioni.length > 8) return 'opzioni non valide'
    if (d.tipo !== 'testo' && d.opzioni.length < 2) return 'una domanda a scelta vuole almeno due risposte'
    for (const o of d.opzioni) if (!testo(o, 300)) return 'una risposta proposta è vuota o troppo lunga'
    if (d.punti != null && !(typeof d.punti === 'number' && d.punti > 0 && d.punti <= 100)) return 'punti non validi'
  }

  if (!Array.isArray(r.persone) || r.persone.length > 500) return 'persone: al massimo 500'
  for (const p of r.persone as Record<string, unknown>[]) {
    for (const k of Object.keys(p)) if (k !== 'h' && k !== 'n') return `campo non previsto in persone: ${k}`
    if (!(typeof p.h === 'string' && /^[0-9a-f]{64}$/.test(p.h))) return 'impronta del codice personale non valida'
    /* ⚠️ solo iniziali: «C. L.», mai un nome intero */
    if (!(typeof p.n === 'string' && /^([A-ZÀ-Ý]\.\s?){1,4}$/.test(p.n.trim() + ' '))) return `qui vanno le iniziali, non un nome: ${String(p.n).slice(0, 30)}`
  }
  return null
}

/* ⚠️ Un evento aperto alle iscrizioni non porta NESSUN dato di persona: non
   chi si è iscritto, non il referente, non l'impresa che ha chiesto la
   conferenza. Qui esce solo che cos'è, quando, dove e quanti posti restano —
   e il controllo lo fa rispettare rifiutando ogni campo che non sia previsto. */
function controllaIscr(r: Record<string, unknown>): string | null {
  for (const k of Object.keys(r)) if (!CAMPI_ISCR.has(k)) return `campo non previsto: ${k}`
  if (!(typeof r.codice === 'string' && /^[0-9]{1,8}-[A-Z0-9]{4}$/.test(r.codice))) return 'codice non valido'
  if (!(typeof r.firma_hash === 'string' && /^[0-9a-f]{64}$/.test(r.firma_hash))) return 'firma_hash non valida'
  if (!testo(r.titolo, 300)) return 'titolo non valido'
  for (const k of ['genere', 'descrizione', 'progetto', 'progetto_desc', 'ente', 'sede', 'modalita'] as const) {
    if (!testoO(r[k], k === 'descrizione' || k === 'progetto_desc' ? 2000 : 300)) return `${k} non valido`
  }
  for (const k of ['dal', 'al'] as const) {
    if (r[k] != null && !(typeof r[k] === 'string' && DATA.test(r[k] as string))) return `${k} non è una data`
  }
  if (r.ore != null && !(typeof r.ore === 'number' && r.ore >= 0 && r.ore <= 2000)) return 'ore non valide'
  if (r.liberi != null && !(typeof r.liberi === 'number' && Number.isInteger(r.liberi) && r.liberi >= 0)) return 'liberi non valido'
  if (r.chiuso_il != null && !(typeof r.chiuso_il === 'string' && ISTANTE.test(r.chiuso_il))) return 'chiuso_il non è un istante'
  if (typeof r.in_elenco !== 'boolean' || typeof r.aperte !== 'boolean') return 'in_elenco/aperte non booleani'
  if (!Array.isArray(r.giornate) || r.giornate.length > 60) return 'giornate: al massimo 60'
  for (const g of r.giornate as Record<string, unknown>[]) {
    if (typeof g !== 'object' || g === null) return 'giornata non è un oggetto'
    for (const k of Object.keys(g)) if (!CAMPI_GIORNATA.has(k)) return `campo non previsto nella giornata: ${k}`
    if (g.data != null && !(typeof g.data === 'string' && DATA.test(g.data))) return 'data della giornata non valida'
    for (const k of ['dalle', 'alle', 'dalle2', 'alle2'] as const) {
      if (g[k] != null && !(typeof g[k] === 'string' && /^\d{2}:\d{2}$/.test(g[k] as string))) return `${k} non è un orario`
    }
    if (!testoO(g.sede, 200)) return 'sede della giornata non valida'
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errore('solo POST', 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } })

  const { data: cfg, error: eCfg } = await sb.from('cassetta_impostazioni')
    .select('valore').eq('chiave', 'questionari_token').maybeSingle()
  if (eCfg) return errore('configurazione non leggibile', 500)
  const atteso = cfg?.valore as string | undefined
  if (!atteso) return errore('questionari_token mancante', 500)

  const tok = req.headers.get('X-Questionari-Token') ?? ''
  if (!tok || !uguali(tok, atteso)) return errore('accesso non autorizzato', 401)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return errore('JSON non leggibile') }
  const azione = String(corpo.azione ?? 'pubblica')

  if (azione === 'battito') {
    const { count, error } = await sb.from('questionari_pubblici').select('codice', { count: 'exact', head: true })
    if (error) return errore('la tabella non risponde: ' + error.message, 500)
    return json({ status: 'ok', questionari: count ?? 0 })
  }

  if (azione === 'ritira') {
    const codici = Array.isArray(corpo.codici) ? corpo.codici.filter((c) => typeof c === 'string').slice(0, 50) : []
    if (!codici.length) return errore('nessun codice da ritirare')
    const { error } = await sb.from('questionari_pubblici').delete().in('codice', codici)
    if (error) return errore('non ritirato: ' + error.message, 500)
    return json({ status: 'ok', ritirati: codici.length })
  }

  /* quante persone vedono il portale: i numeri li guarda l'ufficio, e la
     lettura non e' pubblica — passa da qui con la parola d'ordine. */
  if (azione === 'visite') {
    const giorni = Number(corpo.giorni)
    const { data, error } = await sb.rpc('portale_visite_riepilogo', {
      p_giorni: Number.isFinite(giorni) && giorni > 0 ? Math.min(giorni, 400) : 30,
    })
    if (error) return errore('visite non leggibili: ' + error.message, 500)
    return json({ status: 'ok', visite: data })
  }

  if (azione === 'pubblica_test' || azione === 'ritira_test') {
    if (azione === 'ritira_test') {
      const codici = Array.isArray(corpo.codici) ? corpo.codici.filter((c) => typeof c === 'string').slice(0, 50) : []
      if (!codici.length) return errore('nessun codice da ritirare')
      const { error } = await sb.from('test_pubblici').delete().in('codice', codici)
      if (error) return errore('non ritirato: ' + error.message, 500)
      return json({ status: 'ok', ritirati: codici.length })
    }
    const righe = Array.isArray(corpo.righe) ? corpo.righe : []
    if (!righe.length || righe.length > 20) return errore('da 1 a 20 righe per volta')
    const buone: Record<string, unknown>[] = []
    for (const r of righe) {
      if (typeof r !== 'object' || r === null) return errore('riga non valida')
      const motivo = controllaTest(r as Record<string, unknown>)
      if (motivo) return errore(`riga ${(r as Record<string, unknown>).codice ?? '?'}: ${motivo}`)
      buone.push({ ...(r as Record<string, unknown>), aggiornato_il: new Date().toISOString() })
    }
    const { error } = await sb.from('test_pubblici').upsert(buone, { onConflict: 'codice' })
    if (error) return errore('non pubblicato: ' + error.message, 500)
    return json({ status: 'ok', pubblicati: buone.length })
  }

  if (azione === 'pubblica_iscr' || azione === 'ritira_iscr') {
    if (azione === 'ritira_iscr') {
      const codici = Array.isArray(corpo.codici) ? corpo.codici.filter((c) => typeof c === 'string').slice(0, 50) : []
      if (!codici.length) return errore('nessun codice da ritirare')
      const { error } = await sb.from('iscrizioni_pubbliche').delete().in('codice', codici)
      if (error) return errore('non ritirato: ' + error.message, 500)
      return json({ status: 'ok', ritirati: codici.length })
    }
    const righe = Array.isArray(corpo.righe) ? corpo.righe : []
    if (!righe.length || righe.length > 50) return errore('da 1 a 50 righe per volta')
    const buone: Record<string, unknown>[] = []
    for (const r of righe) {
      if (typeof r !== 'object' || r === null) return errore('riga non valida')
      const motivo = controllaIscr(r as Record<string, unknown>)
      if (motivo) return errore(`riga ${(r as Record<string, unknown>).codice ?? '?'}: ${motivo}`)
      buone.push({ ...(r as Record<string, unknown>), aggiornato_il: new Date().toISOString() })
    }
    const { error } = await sb.from('iscrizioni_pubbliche').upsert(buone, { onConflict: 'codice' })
    if (error) return errore('non pubblicato: ' + error.message, 500)
    return json({ status: 'ok', pubblicati: buone.length })
  }

  if (azione !== 'pubblica') return errore(`azione non prevista: ${azione}`)

  const righe = Array.isArray(corpo.righe) ? corpo.righe : []
  if (!righe.length || righe.length > 50) return errore('da 1 a 50 righe per volta')

  const buone: Record<string, unknown>[] = []
  for (const r of righe) {
    if (typeof r !== 'object' || r === null) return errore('riga non valida')
    const motivo = controlla(r as Record<string, unknown>)
    if (motivo) return errore(`riga ${(r as Record<string, unknown>).codice ?? '?'}: ${motivo}`)
    buone.push({ ...(r as Record<string, unknown>), aggiornato_il: new Date().toISOString() })
  }

  const { error } = await sb.from('questionari_pubblici').upsert(buone, { onConflict: 'codice' })
  if (error) return errore('non pubblicato: ' + error.message, 500)
  return json({ status: 'ok', pubblicati: buone.length })
})
