// Supabase Edge Function – cassetta-consegna (progetto SERVIZI, qcvwrgjldbdoxcfdsvkq)
//
// LA CASSETTA DELLE LETTERE DEL PORTALE: lo sportello da cui il Gestionale
// ritira (13/09/2026). Vedi portale-ricevi per il disegno complessivo.
//
// Parla solo con la funzione portale-richieste del Gestionale: ogni chiamata
// porta l'intestazione X-Cassetta-Token, confrontata a tempo costante con
// cassetta_impostazioni.cassetta_token (la stessa parola sta in
// s_config.cassetta_token sul Gestionale). Senza, risponde 401 e basta.
//
// Azioni (POST JSON { azione, ... }):
//   leggi       { submission_id }  la richiesta com'era arrivata dal portale,
//                                  allegati ricostruiti in base64
//   in_attesa   {}                 le richieste da ritirare (al massimo 10) e
//                                  quelle ferme da piu' di 15 minuti
//   ritirata    { submission_id, progressivo, email }   chiude e CANCELLA dati e allegati
//   scartata    { submission_id, motivo }               idem, col motivo
//   tentativo   { submission_id, errore }               annota un giro non riuscito
//   pulizia     {}                 toglie le righe chiuse da piu' di 30 giorni
//   battito     {}                 database e bucket rispondono davvero
//
// verify_jwt = false: chi chiama e' una funzione, non un utente; la porta la
// chiude la parola d'ordine.
// Sorgente in segreteria-app/supabase/progetto-servizi/functions/cassetta-consegna/.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type Dati = Record<string, unknown>
type SB = ReturnType<typeof createClient>
type Allegato = { campo: string; nome: string; mime: string; byte: number; percorso: string }

const BUCKET = 'cassetta-allegati'
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const errore = (message: string, status = 400) => json({ status: 'error', message }, status)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'errore interno')
const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/

/* confronto a tempo costante: la durata non deve dire quanti caratteri erano giusti */
function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

function inBase64(b: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(bin)
}

async function leggi(sb: SB, subId: unknown): Promise<Response> {
  if (typeof subId !== 'string' || !ID_VALIDO.test(subId)) return errore('submission_id non valido')
  const { data: r, error } = await sb.from('cassetta')
    .select('tipo, stato, payload, dimensione, allegati, allegati_pronti, nota, progressivo, esito')
    .eq('submission_id', subId).maybeSingle()
  if (error) throw new Error('cassetta non leggibile: ' + error.message)
  if (!r) return json({ status: 'ok', richiesta: null })
  if (r.stato !== 'arrivata') {
    return json({ status: 'ok', richiesta: { stato: r.stato, progressivo: r.progressivo, motivo: (r.esito as Dati | null)?.motivo ?? null } })
  }
  const payload: Dati = { ...((r.payload as Dati) || {}) }
  const foto: { name: string; data: string }[] = []
  for (const a of (r.allegati as Allegato[]) || []) {
    const { data: blob, error: errA } = await sb.storage.from(BUCKET).download(a.percorso)
    if (errA || !blob) throw new Error(`allegato ${a.percorso} non leggibile: ${errA?.message || 'vuoto'}`)
    const b64 = inBase64(new Uint8Array(await blob.arrayBuffer()))
    if (a.campo === 'foto') foto.push({ name: a.nome, data: `data:${a.mime};base64,${b64}` })
    else {
      payload[a.campo + '_base64'] = b64
      if (a.nome) payload[a.campo + '_nome'] = a.nome
    }
  }
  if (foto.length) payload.seg_photo_base64 = JSON.stringify(foto)
  /* quel che la cassetta ha lasciato fuori arriva alla segreteria scritto.
     Viaggia accanto ai campi, non dentro: un campo del modulo con lo stesso
     nome non potrebbe cosi' fingersi un avviso della cassetta */
  const avvisi = [
    r.allegati_pronti ? '' : 'allegati non arrivati completi: chiederli a chi ha compilato',
    ...String(r.nota || '').split('; '),
  ].filter(Boolean).slice(0, 10)
  return json({ status: 'ok', richiesta: { stato: r.stato, tipo: r.tipo, dimensione: r.dimensione, payload, avvisi } })
}

async function inAttesa(sb: SB): Promise<Response> {
  const { data, error } = await sb.from('cassetta').select('submission_id, ricevuto_at, allegati_pronti')
    .eq('stato', 'arrivata').order('ricevuto_at', { ascending: true }).limit(500)
  if (error) throw new Error('cassetta non leggibile: ' + error.message)
  const ora = Date.now()
  const righe = (data || []).map((x) => ({ ...x, minuti: (ora - new Date(x.ricevuto_at as string).getTime()) / 60000 }))
  /* un minuto di rispetto: il campanello potrebbe starla gia' consegnando.
     Senza allegati completi si aspetta mezz'ora, poi si ritira lo stesso
     (la segreteria legge l'avviso): i dati non restano fermi per sempre. */
  const pronte = righe.filter((x) => (x.allegati_pronti && x.minuti >= 1) || x.minuti >= 30)
  return json({
    status: 'ok',
    totali: righe.length,
    piu_vecchia_min: righe.length ? Math.round(righe[0].minuti) : 0,
    vecchie: righe.filter((x) => x.minuti >= 15).map((x) => x.submission_id),
    submission_ids: pronte.slice(0, 10).map((x) => x.submission_id),
  })
}

async function chiudi(sb: SB, subId: unknown, stato: 'ritirata' | 'scartata', esito: Dati): Promise<Response> {
  if (typeof subId !== 'string' || !ID_VALIDO.test(subId)) return errore('submission_id non valido')
  const { data: r, error } = await sb.from('cassetta').select('stato, allegati').eq('submission_id', subId).maybeSingle()
  if (error) throw new Error('cassetta non leggibile: ' + error.message)
  if (!r) return json({ status: 'ok', nota: 'non in cassetta' })
  if (r.stato !== 'arrivata') return json({ status: 'ok', nota: 'gia\' ' + r.stato })
  const percorsi = ((r.allegati as Allegato[]) || []).map((a) => a.percorso)
  if (percorsi.length) {
    const { error: errR } = await sb.storage.from(BUCKET).remove(percorsi)
    if (errR) throw new Error('allegati non cancellati: ' + errR.message)
  }
  /* i dati personali non restano qui: resta solo quel che serve a riconoscere
     un reinvio (identificativo, stato, numero) per 30 giorni */
  const { error: errU } = await sb.from('cassetta').update({
    stato, ritirata_at: new Date().toISOString(), progressivo: stato === 'ritirata' ? Number(esito.progressivo) || null : null,
    esito, payload: null, allegati: [], nota: null,
  }).eq('submission_id', subId).eq('stato', 'arrivata')
  if (errU) throw new Error('cassetta non aggiornata: ' + errU.message)
  return json({ status: 'ok' })
}

async function tentativo(sb: SB, subId: unknown, testo: unknown): Promise<Response> {
  if (typeof subId !== 'string' || !ID_VALIDO.test(subId)) return errore('submission_id non valido')
  const { data: r } = await sb.from('cassetta').select('tentativi').eq('submission_id', subId).maybeSingle()
  if (!r) return json({ status: 'ok', nota: 'non in cassetta' })
  await sb.from('cassetta').update({
    tentativi: (Number(r.tentativi) || 0) + 1, ultimo_tentativo_at: new Date().toISOString(),
    esito: { ultimo_errore: String(testo ?? '').slice(0, 500) },
  }).eq('submission_id', subId).eq('stato', 'arrivata')
  return json({ status: 'ok' })
}

async function pulizia(sb: SB): Promise<Response> {
  const limite = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data, error } = await sb.from('cassetta').delete().in('stato', ['ritirata', 'scartata']).lt('ritirata_at', limite).select('id')
  if (error) throw new Error('pulizia non riuscita: ' + error.message)
  return json({ status: 'ok', tolte: (data || []).length })
}

async function battito(sb: SB): Promise<Response> {
  const { count: totali, error } = await sb.from('cassetta').select('id', { count: 'exact', head: true }).eq('stato', 'arrivata')
  if (error) throw new Error('cassetta non leggibile: ' + error.message)
  const { count: vecchie } = await sb.from('cassetta').select('id', { count: 'exact', head: true })
    .eq('stato', 'arrivata').lt('ricevuto_at', new Date(Date.now() - 15 * 60000).toISOString())
  const { error: errB } = await sb.storage.from(BUCKET).list('', { limit: 1 })
  if (errB) throw new Error('bucket degli allegati non leggibile: ' + errB.message)
  return json({ status: 'ok', totali: totali || 0, vecchie: vecchie || 0, bucket: 'ok' })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return errore('solo POST', 405)
  const SUPA = Deno.env.get('SUPABASE_URL')
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPA || !SRV) return errore('configurazione della funzione incompleta', 500)
  const sb = createClient(SUPA, SRV, { auth: { persistSession: false } })

  const dato = req.headers.get('x-cassetta-token') || ''
  const { data: t } = await sb.from('cassetta_impostazioni').select('valore').eq('chiave', 'cassetta_token').maybeSingle()
  if (!t?.valore || !dato || !uguali(dato, t.valore as string)) return errore('non autorizzato', 401)

  let d: Dati
  try { d = await req.json() } catch { return errore('JSON illeggibile') }
  try {
    switch (d?.azione) {
      case 'leggi': return await leggi(sb, d.submission_id)
      case 'in_attesa': return await inAttesa(sb)
      case 'ritirata': return await chiudi(sb, d.submission_id, 'ritirata', { progressivo: d.progressivo ?? null, email: d.email ?? null })
      case 'scartata': return await chiudi(sb, d.submission_id, 'scartata', { motivo: String(d.motivo ?? 'rifiutata').slice(0, 500) })
      case 'tentativo': return await tentativo(sb, d.submission_id, d.errore)
      case 'pulizia': return await pulizia(sb)
      case 'battito': return await battito(sb)
      default: return errore('azione sconosciuta')
    }
  } catch (e) {
    console.error('cassetta-consegna:', e)
    return errore(errMsg(e), 500)
  }
})
