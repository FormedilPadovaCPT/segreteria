// Supabase Edge Function – attestati-pubblica (progetto SERVIZI, qcvwrgjldbdoxcfdsvkq)
//
// LA VERIFICA PUBBLICA DEGLI ATTESTATI (17/09/2026): qui il Gestionale copia i
// dati minimi di ogni attestato della serie N/aaaa, che la pagina
// servizi/verifica/ legge con la funzione SQL verifica_attestato.
//
// Parla solo con la funzione attestati-verifica del Gestionale: ogni chiamata
// porta X-Attestati-Token, confrontata a tempo costante con
// cassetta_impostazioni.attestati_token. Senza, 401.
//
// Azioni (POST JSON { azione, ... }):
//   pubblica  { righe: [...] }  aggiunge o aggiorna (anche la revoca è un
//                               aggiornamento: stato 'revocato' + revocato_il)
//   battito   {}                la tabella risponde
//
// Nessun nome, codice fiscale o impresa arriva qui: la funzione rifiuta le
// righe con campi non previsti, così un errore dall'altra parte non può
// pubblicare più del dovuto.
// verify_jwt = false: chi chiama è una funzione; la porta la chiude la parola d'ordine.
// Sorgente in segreteria-app/supabase/progetto-servizi/functions/attestati-pubblica/.

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

const CAMPI = new Set(['numero', 'codice_hash', 'tipo', 'corso', 'tipologia', 'durata_ore', 'ore_frequentate',
  'data_inizio', 'data_fine', 'data_rilascio', 'iniziali', 'stato', 'revocato_il'])
const DATA = /^\d{4}-\d{2}-\d{2}$/
const testo = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const dataO = (v: unknown) => v == null || (typeof v === 'string' && DATA.test(v))
const numO = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 10000)

function controlla(r: Record<string, unknown>): string | null {
  for (const k of Object.keys(r)) if (!CAMPI.has(k)) return `campo non previsto: ${k}`
  if (!(typeof r.numero === 'string' && /^\d{1,6}\/\d{4}$/.test(r.numero))) return 'numero non valido'
  if (!(typeof r.codice_hash === 'string' && /^[0-9a-f]{64}$/.test(r.codice_hash))) return 'codice_hash non valido'
  if (!testo(r.tipo, 80) || !testo(r.corso, 300) || !testo(r.iniziali, 20)) return 'tipo, corso o iniziali non validi'
  if (r.tipologia != null && !testo(r.tipologia, 120)) return 'tipologia non valida'
  if (!numO(r.durata_ore) || !numO(r.ore_frequentate)) return 'ore non valide'
  if (!(typeof r.data_rilascio === 'string' && DATA.test(r.data_rilascio))) return 'data_rilascio non valida'
  if (!dataO(r.data_inizio) || !dataO(r.data_fine) || !dataO(r.revocato_il)) return 'date non valide'
  if (r.stato !== 'valido' && r.stato !== 'revocato') return 'stato non valido'
  return null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errore('solo POST', 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } })

  const { data: imp, error: errImp } = await sb.from('cassetta_impostazioni')
    .select('valore').eq('chiave', 'attestati_token').maybeSingle()
  if (errImp || !imp?.valore) return errore('configurazione mancante', 500)
  if (!uguali(req.headers.get('X-Attestati-Token') ?? '', imp.valore)) return errore('non autorizzato', 401)

  let corpo: Record<string, unknown>
  try { corpo = await req.json() } catch { return errore('JSON non valido') }

  if (corpo.azione === 'battito') {
    const { error } = await sb.from('attestati_pubblici').select('numero', { count: 'exact', head: true })
    return error ? errore('tabella non leggibile: ' + error.message, 500) : json({ status: 'ok' })
  }

  if (corpo.azione !== 'pubblica') return errore('azione sconosciuta')
  const righe = Array.isArray(corpo.righe) ? corpo.righe as Record<string, unknown>[] : null
  if (!righe || righe.length === 0 || righe.length > 500) return errore('righe mancanti o troppe (massimo 500)')
  for (const r of righe) {
    const e = controlla(r)
    if (e) return errore(`${e} (${String(r?.numero ?? '?')})`)
  }
  const { error } = await sb.from('attestati_pubblici')
    .upsert(righe.map((r) => ({ ...r, aggiornato_il: new Date().toISOString() })), { onConflict: 'numero' })
  if (error) return errore('scrittura non riuscita: ' + error.message, 500)
  return json({ status: 'ok', pubblicate: righe.length })
})
