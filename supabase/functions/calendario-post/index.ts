// Supabase Edge Function – calendario-post
// IL PROMEMORIA DI PUBBLICAZIONE DEI POST SOCIAL NEL CALENDARIO (06/11/2026)
//
// Chiesto dall'utente (segreteria d'area): un post approvato dal Direttore
// che ha una data di programmazione deve comparire da solo nel calendario,
// col promemoria per pubblicarlo quel giorno, così non si dimentica.
// Scelte dell'utente:
//   · calendario `s_config.post_calendario_id` (il primario di cptpd@did);
//   · evento di mezz'ora all'ora `s_config.post_calendario_ora` (09:30) del
//     giorno programmato, con la notifica all'ora dell'evento;
//   · pubblicato il post, l'evento RESTA, col titolo «✅ Pubblicato: …», sul
//     giorno in cui è uscito e senza notifica.
// Senza invitati: non esce niente dall'ufficio, quindi non è un'eccezione
// alla regola «l'app prepara, la persona manda».
//
//   { post_id }   porta il calendario a combaciare col post:
//                 approvato + data      → evento creato o spostato
//                 pubblicato con evento → evento segnato «pubblicato»
//                 tutto il resto        → evento tolto (se c'era)
//   { tutti:true } (solo segreteria) lo stesso per i post approvati o
//                 pubblicati: serve alla prima volta e dopo un guasto.
//
// Chi chiama: il database (trigger s_post_calendario, intestazione
// X-Calendario-Post = s_config.calendario_post_token) o la segreteria dalla
// pagina Comunicazione (JWT + is_segreteria). Deploy con --no-verify-jwt.
// L'evento si ritrova dalla proprietà privata `post_social` = id del post.
// L'esito va in s_post.calendario_il / calendario_esito.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE } from '../_shared/google.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-calendario-post',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const SCOPE_CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3'
const FUSO = 'Europe/Rome'
const APP_SEGRETERIA = 'https://formedilpadovacpt.github.io/segreteria/'

type Riga = Record<string, any>

const dIt = (d: string) => d.split('-').reverse().join('/')
const giornoRoma = (ts: string) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: FUSO })
/* hh:mm + 30 minuti, senza passare dai fusi: è un orario «da muro» in Europe/Rome */
const piuMezzora = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + 30
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const { data: cfgR, error: eC } = await admin.from('s_config').select('chiave, valore')
      .in('chiave', ['calendario_post_token', 'post_calendario_id', 'post_calendario_ora'])
    if (eC) throw new Error('Non riesco a leggere la configurazione: ' + eC.message)
    const cfg = Object.fromEntries(((cfgR || []) as Riga[]).map((r) => [r.chiave, r.valore]))

    /* ── chi chiama ── */
    let segreteria = false
    const gettone = req.headers.get('X-Calendario-Post') || ''
    if (gettone) {
      if (!cfg.calendario_post_token || gettone !== cfg.calendario_post_token) return json({ error: 'accesso non autorizzato' }, 401)
    } else {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const utente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: s, error: eS } = await utente.rpc('is_segreteria')
      if (eS || s !== true) return json({ error: 'Il calendario dei post lo aggiorna la segreteria.' }, 403)
      segreteria = true
    }

    const corpo = await req.json().catch(() => ({}))
    let ids: number[] = []
    if (corpo?.tutti === true) {
      if (!segreteria) return json({ error: 'Il riallineamento di tutti i post lo chiede la segreteria.' }, 403)
      const { data, error } = await admin.from('s_post').select('id').in('stato', ['approvato', 'pubblicato'])
      if (error) throw new Error('Non riesco a leggere i post: ' + error.message)
      ids = ((data || []) as Riga[]).map((r) => Number(r.id))
    } else {
      const id = Number(corpo?.post_id)
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Manca il post.' }, 400)
      ids = [id]
    }

    const calId = String(cfg.post_calendario_id || SOGGETTO_ENTE)
    const ora = /^\d{2}:\d{2}$/.test(String(cfg.post_calendario_ora || '')) ? String(cfg.post_calendario_ora) : '09:30'

    /* ── Google ── */
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    let token = ''
    try { token = await getToken(sa, SCOPE_CALENDAR_EVENTS, SOGGETTO_ENTE) } catch (e) {
      const msg = `calendario non aggiornato: Google non concede il permesso calendar.events (${(e as Error).message})`
      await admin.from('s_post').update({ calendario_il: new Date().toISOString(), calendario_esito: msg.slice(0, 500) }).in('id', ids)
      return json({ ok: false, esito: msg })
    }
    const G = async (metodo: string, path: string, corpoG?: unknown) => {
      const r = await fetch(`${API}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpoG ? JSON.stringify(corpoG) : undefined,
      })
      if (metodo === 'DELETE' && (r.status === 204 || r.status === 410)) return null
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error?.message || `Google Calendar ha risposto ${r.status}`)
      return j
    }
    const cal = encodeURIComponent(calId)

    const esiti: Riga[] = []
    for (const id of ids) {
      let esito = ''
      try {
        const { data: p, error: eP } = await admin.from('s_post')
          .select('id, titolo, stato, data_programmata, pubblicato_il').eq('id', id).maybeSingle()
        if (eP) throw new Error('Non riesco a leggere il post: ' + eP.message)
        if (!p) { esiti.push({ id, esito: 'post non trovato' }); continue }

        const trovati = await G('GET', `/calendars/${cal}/events?privateExtendedProperty=${encodeURIComponent(`post_social=${id}`)}&showDeleted=false&maxResults=10&singleEvents=true`)
        const eventi = (trovati?.items || []) as Riga[]
        const [ev, ...doppi] = eventi
        for (const d of doppi) await G('DELETE', `/calendars/${cal}/events/${encodeURIComponent(d.id)}?sendUpdates=none`)

        const titolo = String(p.titolo || 'post').trim()
        const evento = (giorno: string, pubblicato: boolean) => ({
          summary: pubblicato ? `✅ Pubblicato: ${titolo}` : `📣 Pubblica il post: ${titolo}`,
          description: pubblicato
            ? `Post n. ${id}, pubblicato il ${dIt(giorno)}.\n\nApp segreteria, pagina 📣 Comunicazione: ${APP_SEGRETERIA}`
            : `Post n. ${id}, approvato dal Direttore, da pubblicare oggi.\n\nSi pubblica dall'app segreteria, pagina 📣 Comunicazione: ${APP_SEGRETERIA}\nTelegram e app servizi da lì; LinkedIn, Instagram e Facebook col kit per l'agenzia.`,
          start: { dateTime: `${giorno}T${ora}:00`, timeZone: FUSO },
          end: { dateTime: `${giorno}T${piuMezzora(ora)}:00`, timeZone: FUSO },
          transparency: 'transparent',
          reminders: pubblicato ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
          extendedProperties: { private: { post_social: String(id) } },
        })

        if (p.stato === 'approvato' && p.data_programmata) {
          const giorno = String(p.data_programmata)
          if (ev) { await G('PATCH', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=none`, evento(giorno, false)); esito = `promemoria spostato al ${dIt(giorno)} alle ${ora}` }
          else { await G('POST', `/calendars/${cal}/events?sendUpdates=none`, evento(giorno, false)); esito = `promemoria in calendario il ${dIt(giorno)} alle ${ora}` }
        } else if (p.stato === 'pubblicato' && ev) {
          const giorno = p.pubblicato_il ? giornoRoma(String(p.pubblicato_il)) : String(p.data_programmata || String(ev.start?.dateTime || '').slice(0, 10))
          await G('PATCH', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=none`, evento(giorno, true))
          esito = `in calendario come pubblicato il ${dIt(giorno)}`
        } else if (p.stato === 'pubblicato') {
          esito = 'pubblicato senza promemoria in calendario'
        } else if (ev) {
          await G('DELETE', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=none`)
          esito = p.stato === 'approvato' ? 'promemoria tolto: il post non ha più una data' : 'promemoria tolto: il post non è più approvato'
        } else {
          esito = p.stato === 'approvato' ? 'nessun promemoria: il post non ha una data di pubblicazione' : ''
        }
      } catch (e) {
        esito = `calendario non aggiornato: ${(e as Error).message}`
        console.error('calendario-post', id, e)
      }
      if (esito) await admin.from('s_post').update({ calendario_il: new Date().toISOString(), calendario_esito: esito.slice(0, 500) }).eq('id', id)
      esiti.push({ id, esito })
    }
    const ko = esiti.filter((x) => String(x.esito).startsWith('calendario non aggiornato'))
    return json({ ok: ko.length === 0, esiti })
  } catch (e) {
    console.error('calendario-post:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
