// Supabase Edge Function – questionari-pubblica (progetto GESTIONALE)
//
// IL QUESTIONARIO DI UN EVENTO VA SUL PORTALE (18/09/2026).
// Copia sul progetto Servizi le domande di un evento, perché la pagina del
// portale possa disegnarle a chi inquadra il QR del foglio in coda al
// registro. Stesso disegno della verifica degli attestati.
//
// Chi può chiamarla:
//   - la segreteria dall'app (quando apre il questionario o ne cambia le
//     domande), col proprio accesso;
//   - un giro pianificato, con X-Questionari-Token = s_config.questionari_token.
//
// Che cosa manda: codice, titolo, genere, data, sede, chiusura e il testo
// delle domande. Della firma parte SOLO l'impronta sha256: il segreto non
// esce da qui nemmeno in copia, e al portale basta l'impronta per
// riconoscere chi arriva col link giusto.
//
// Che cosa NON esce mai: nominativi, risposte, la firma in chiaro. Il
// progetto Servizi rifiuta comunque ogni campo non previsto.
//
// verify_jwt = false: il controllo lo fa la funzione (utente segreteria o
// parola d'ordine). Sorgente in segreteria-app/supabase/functions/questionari-pubblica/.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-questionari-token',
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

type Pubblicazione = {
  codice: string; firma: string; titolo: string | null; genere: string
  quando: string | null; sede: string | null; chiuso_il: string | null
  domande: { id: number; ordine: number; testo: string; tipo: string; opzioni: unknown[]; obbligatoria: boolean; tronco: boolean }[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'solo POST' }, 405)

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } })

    const { data: cfgRighe, error: eCfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['questionari_token', 'questionari_ricevi_url'])
    if (eCfg) throw new Error('configurazione non leggibile: ' + eCfg.message)
    const cfg = Object.fromEntries((cfgRighe ?? []).map((r) => [r.chiave, r.valore]))
    if (!cfg.questionari_token || !cfg.questionari_ricevi_url) {
      return json({ error: 'manca questionari_token o questionari_ricevi_url in s_config' }, 500)
    }

    /* chi chiama: il giro con la parola d'ordine, oppure un utente della segreteria */
    const tok = req.headers.get('X-Questionari-Token')
    let chi = 'giro'
    if (tok) {
      if (!uguali(tok, cfg.questionari_token)) return json({ error: 'accesso non autorizzato' }, 401)
    } else {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: u } = await sbUtente.auth.getUser()
      if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
      const { data: segr, error: eSegr } = await sbUtente.rpc('is_segreteria')
      if (eSegr || segr !== true) return json({ error: 'Il questionario di un evento lo pubblica la segreteria.' }, 403)
      chi = u.user.email
    }

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>
    const corsi = Array.isArray(corpo.corsi) ? corpo.corsi : (corpo.corso_id != null ? [corpo.corso_id] : [])
    const ids = corsi.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50)
    if (!ids.length) return json({ error: 'manca corso_id' }, 400)

    /* due cose diverse dallo stesso sportello: il questionario (anonimo) e il
       TEST (nominativo). Del test escono le domande senza le risposte giuste
       e, delle persone, impronta del codice personale e iniziali. */
    const test = corpo.cosa === 'test'
    const rpc = test ? 'test_pubblicazione' : 'quest_pubblicazione'
    const azione = test ? 'pubblica_test' : 'pubblica'
    const colonne = test
      ? { quando: 'test_pubblicato_il', esito: 'test_pubblica_esito' }
      : { quando: 'quest_pubblicato_il', esito: 'quest_pubblica_esito' }

    const righe: Record<string, unknown>[] = []
    const saltati: { corso_id: number; motivo: string }[] = []
    for (const id of ids) {
      const { data, error } = await sb.rpc(rpc, { p_corso_id: id })
      if (error) { saltati.push({ corso_id: id, motivo: error.message }); continue }
      const p = data as Pubblicazione | null
      if (!p || !p.codice) { saltati.push({ corso_id: id, motivo: `${test ? 'test' : 'questionario'} non aperto su questo evento` }); continue }
      if (!p.firma) { saltati.push({ corso_id: id, motivo: 'il codice non è firmato' }); continue }
      const comune = {
        codice: p.codice,
        firma_hash: await sha256(p.firma),   // ⚠️ del segreto esce solo l'impronta
        titolo: String(p.titolo ?? 'Evento').slice(0, 300),
        quando: p.quando,
        sede: p.sede ? String(p.sede).slice(0, 200) : null,
        chiuso_il: p.chiuso_il,
        domande: p.domande ?? [],
      }
      righe.push(test
        ? { ...comune, minuti: (p as Record<string, unknown>).minuti ?? null,
            soglia: (p as Record<string, unknown>).soglia ?? null,
            persone: (p as Record<string, unknown>).persone ?? [] }
        : { ...comune, genere: p.genere })
    }
    if (!righe.length) return json({ status: 'error', pubblicati: 0, saltati }, 400)

    let esito = ''
    try {
      const r = await fetch(cfg.questionari_ricevi_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Questionari-Token': cfg.questionari_token },
        body: JSON.stringify({ azione, righe }),
      })
      const testo = await r.text()
      esito = r.ok ? 'ok' : `HTTP ${r.status}: ${testo.slice(0, 300)}`
    } catch (e) {
      esito = 'rete: ' + (e instanceof Error ? e.message : String(e))
    }

    /* l'esito resta scritto sull'evento: se la copia non riesce, il
       questionario NON è raggiungibile dal portale e va saputo subito. */
    const adesso = new Date().toISOString()
    for (const id of ids) {
      if (saltati.some((s) => s.corso_id === id)) continue
      await sb.from('s_corsi').update(esito === 'ok'
        ? { [colonne.quando]: adesso, [colonne.esito]: `pubblicato (${chi})` }
        : { [colonne.esito]: `non pubblicato: ${esito}`.slice(0, 300) }).eq('id', id)
    }

    return json({ status: esito === 'ok' ? 'ok' : 'error', pubblicati: esito === 'ok' ? righe.length : 0, saltati, esito, chi },
      esito === 'ok' ? 200 : 502)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
