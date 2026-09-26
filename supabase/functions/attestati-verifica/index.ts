// Supabase Edge Function – attestati-verifica (progetto GESTIONALE)
//
// LA VERIFICA PUBBLICA DEGLI ATTESTATI (17/09/2026, deciso dall'utente).
// Copia sul progetto Servizi i DATI MINIMI degli attestati della serie N/aaaa,
// perché la pagina https://formedilpadovacpt.github.io/servizi/verifica/
// possa dire, a chi inquadra il QR, se l'attestato è valido o revocato.
//
// Chi può chiamarla:
//   - la segreteria dall'app (dopo aver generato, corretto o revocato un
//     attestato), con il proprio accesso;
//   - il giro pianificato (pg_cron), con X-Attestati-Token = s_config.attestati_token.
//
// Che cosa fa: prende gli iscritti con numero N/aaaa e codice di verifica,
// costruisce la riga pubblica, ne calcola l'impronta e ripubblica SOLO quelle
// cambiate dall'ultima volta (verifica_impronta). Poi segna l'esito.
//
// Che cosa NON esce mai: nome, codice fiscale, impresa, data di nascita,
// motivo della revoca, codice di verifica in chiaro (va solo la sua impronta
// sha256). Il progetto Servizi rifiuta comunque ogni campo non previsto.
//
// verify_jwt = false: il controllo lo fa la funzione (utente segreteria o
// parola d'ordine). Sorgente in segreteria-app/supabase/functions/attestati-verifica/.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-attestati-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

async function sha256(testo: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const TIPI: Record<string, string> = {
  partecipazione: 'Attestato di partecipazione',
  frequenza: 'Attestato di frequenza',
  frequenza_verifica: 'Attestato di frequenza e verifica finale',
}
const MODALITA: Record<string, string> = {
  aula: 'Corso in aula', cantiere: 'Corso in cantiere', impresa: 'Corso in impresa',
  videoconferenza: 'Corso in videoconferenza', mista: 'Corso in modalità mista',
}

/* «ROSSI MARIO» → «R. M.»: le iniziali nell'ordine in cui il nominativo è scritto */
export function iniziali(nominativo: string | null): string {
  const parole = String(nominativo ?? '').replace(/[^\p{L}\s'-]/gu, ' ').split(/\s+/).filter(Boolean)
  return parole.slice(0, 4).map((p) => p[0].toUpperCase() + '.').join(' ') || '—'
}

type Corso = { id: number; titolo: string | null; tipo: string | null; modalita: string | null; tipo_attestato: string | null;
  durata_ore: number | null; data_inizio: string | null; data_fine: string | null }
type Iscritto = { id: number; corso_id: number; nominativo: string | null; ore_frequentate: number | null;
  attestato_numero: string; attestato_data: string | null; verifica_codice: string; verifica_impronta: string | null;
  attestato_revocato_il: string | null }

async function rigaPubblica(c: Corso, i: Iscritto) {
  const riga = {
    numero: i.attestato_numero,
    codice_hash: await sha256(i.verifica_codice.toUpperCase()),
    tipo: TIPI[c.tipo_attestato ?? 'frequenza'] ?? 'Attestato',
    corso: String(c.titolo ?? 'Corso').slice(0, 300),
    tipologia: c.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : (MODALITA[c.modalita ?? ''] ?? 'Corso'),
    durata_ore: c.durata_ore == null ? null : Number(c.durata_ore),
    ore_frequentate: i.ore_frequentate == null ? null : Number(i.ore_frequentate),
    data_inizio: c.data_inizio,
    data_fine: c.data_fine ?? c.data_inizio,
    data_rilascio: i.attestato_data ?? c.data_fine ?? c.data_inizio,
    iniziali: iniziali(i.nominativo),
    stato: i.attestato_revocato_il ? 'revocato' : 'valido',
    revocato_il: i.attestato_revocato_il,
  }
  return { riga, impronta: await sha256(JSON.stringify(riga)) }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'solo POST' }, 405)
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cfgRighe, error: eCfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['attestati_token', 'attestati_pubblica_url'])
    if (eCfg) throw new Error('configurazione non leggibile: ' + eCfg.message)
    const cfg = Object.fromEntries((cfgRighe ?? []).map((r) => [r.chiave, r.valore]))
    if (!cfg.attestati_token || !cfg.attestati_pubblica_url) return json({ error: 'manca attestati_token o attestati_pubblica_url in s_config' }, 500)

    /* chi chiama: il giro con la parola d'ordine, oppure un utente della segreteria */
    const tok = req.headers.get('X-Attestati-Token')
    let chi = 'giro'
    if (tok) {
      if (!uguali(tok, cfg.attestati_token)) return json({ error: 'accesso non autorizzato' }, 401)
    } else {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: u } = await sbUtente.auth.getUser()
      if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
      const { data: segr, error: eSegr } = await sbUtente.rpc('is_segreteria')
      if (eSegr || segr !== true) return json({ error: 'La verifica degli attestati la aggiorna la segreteria.' }, 403)
      chi = u.user.email
    }

    const { data: iscritti, error: eIsc } = await sb.from('s_corsi_iscritti')
      .select('id, corso_id, nominativo, ore_frequentate, attestato_numero, attestato_data, verifica_codice, verifica_impronta, attestato_revocato_il')
      .like('attestato_numero', '%/%').not('verifica_codice', 'is', null)
      .order('id').limit(2000)
    if (eIsc) throw new Error('iscritti non leggibili: ' + eIsc.message)
    if (!iscritti?.length) return json({ status: 'ok', da_pubblicare: 0, pubblicate: 0, chi })

    const corsiId = [...new Set(iscritti.map((i) => i.corso_id))]
    const { data: corsi, error: eCorsi } = await sb.from('s_corsi')
      .select('id, titolo, tipo, modalita, tipo_attestato, durata_ore, data_inizio, data_fine').in('id', corsiId)
    if (eCorsi) throw new Error('corsi non leggibili: ' + eCorsi.message)
    const corsoDi = new Map((corsi ?? []).map((c) => [c.id, c as Corso]))

    const daFare: { id: number; riga: Record<string, unknown>; impronta: string }[] = []
    for (const i of iscritti as Iscritto[]) {
      const c = corsoDi.get(i.corso_id)
      if (!c) continue
      const { riga, impronta } = await rigaPubblica(c, i)
      if (impronta !== i.verifica_impronta) daFare.push({ id: i.id, riga, impronta })
    }
    if (!daFare.length) return json({ status: 'ok', da_pubblicare: 0, pubblicate: 0, chi })

    let pubblicate = 0
    const errori: string[] = []
    for (let k = 0; k < daFare.length; k += 200) {
      const lotto = daFare.slice(k, k + 200)
      let esito = ''
      try {
        const r = await fetch(cfg.attestati_pubblica_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Attestati-Token': cfg.attestati_token },
          body: JSON.stringify({ azione: 'pubblica', righe: lotto.map((x) => x.riga) }),
        })
        const testo = await r.text()
        esito = r.ok ? 'ok' : `HTTP ${r.status}: ${testo.slice(0, 200)}`
      } catch (e) {
        esito = 'rete: ' + (e instanceof Error ? e.message : 'errore interno')
      }
      const adesso = new Date().toISOString()
      for (const x of lotto) {
        const agg = esito === 'ok'
          ? { verifica_impronta: x.impronta, verifica_pubblicata_il: adesso, verifica_esito: `pubblicata (${chi})` }
          : { verifica_esito: `non pubblicata: ${esito}`.slice(0, 300) }
        await sb.from('s_corsi_iscritti').update(agg).eq('id', x.id)
      }
      if (esito === 'ok') pubblicate += lotto.length
      else errori.push(esito)
    }
    return json({ status: errori.length ? 'parziale' : 'ok', da_pubblicare: daFare.length, pubblicate, errori, chi },
      errori.length ? 502 : 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'errore interno' }, 500)
  }
})
