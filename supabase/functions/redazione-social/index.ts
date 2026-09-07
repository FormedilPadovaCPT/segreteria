// Supabase Edge Function – redazione-social
// La porta della REDAZIONE AUTOMATICA dell'Area Sicurezza e Salute.
//
// Una routine cloud (Claude Code, ogni lunedì mattina) non ha accesso né al
// PC né al vault: parla col database SOLO attraverso questa funzione.
//
//   op: 'materia'   → la materia prima per scrivere i post: aggregati delle
//                     visite (s_redazione_materia), circolari protocollate,
//                     corsi in apertura, campagne, i post recenti (per non
//                     ripetersi) e le indicazioni libere della segreteria.
//                     Nessun dato personale: solo aggregati e documenti di enti.
//   op: 'bozze'     → riceve le bozze scritte dalla routine e le mette in
//                     s_post con stato 'bozza'. Solo INSERT: non tocca mai
//                     quello che c'è già.
//   op: 'pubblica'  → pubblica un post APPROVATO sul canale Telegram
//                     pubblico (s_config.telegram_canale) via bot.
//   op: 'notizia'   → pubblica un post APPROVATO come notizia nell'app
//                     servizi (tabella `notizie` dell'altro progetto Supabase).
//
// Chi può fare cosa — due porte diverse, di proposito:
//   materia/bozze  → parola d'ordine in `X-Redazione-Token`, confrontata con
//                    s_config.redazione_token. È il pattern di riconcilia_token:
//                    la chiave anon sta in un repository pubblico, e senza
//                    questo controllo chiunque potrebbe riempire la coda.
//                    Nel peggiore dei casi qualcuno scrive bozze che la
//                    segreteria vede e scarta: non esce niente.
//   pubblica/notizia → utente autenticato con ruolo segreteria (is_segreteria).
//                    Pubblicare è un atto della persona, come il timbro.
//
// verify_jwt = false di proposito: la routine chiama senza JWT (ha il token),
// e il JWT di chi pubblica viene verificato qui dentro, a mano.
//
// Secrets: TELEGRAM_BOT_TOKEN (il bot che è amministratore del canale),
//          NOTIZIE_SERVICE_KEY (+ NOTIZIE_URL facoltativo) per l'app servizi.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken } from '../_shared/google.ts'

// Gli eventi pubblici dell'ufficio arrivano dai calendari Google elencati in
// s_config.redazione_calendari (id separati da virgola), letti con il service
// account dell'ente (delega domain-wide, scope calendar.readonly, aggiunta il
// 07/09/2026). La routine NON tocca Google: riceve titolo, date, luogo e le
// prime righe della descrizione. L'agenda interna della segreteria non è in
// elenco, di proposito.
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'

async function eventiCalendario(admin: ReturnType<typeof createClient>, giorni = 60) {
  const { data: cfg } = await admin.from('s_config').select('valore').eq('chiave', 'redazione_calendari').maybeSingle()
  const ids = String(cfg?.valore || '').split(',').map((s: string) => s.trim()).filter(Boolean)
  if (!ids.length) return { eventi: [], nota: 'nessun calendario configurato in s_config.redazione_calendari' }
  const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!saRaw) return { eventi: [], nota: 'secret GOOGLE_SERVICE_ACCOUNT_JSON assente' }
  let token: string
  try { token = await getToken(JSON.parse(saRaw), SCOPE_CALENDAR) }
  catch (e) { return { eventi: [], nota: 'token calendario non ottenuto: ' + String(e?.message || e) } }
  const tMin = new Date().toISOString()
  const tMax = new Date(Date.now() + giorni * 864e5).toISOString()
  const eventi: Record<string, unknown>[] = []
  const calendari: string[] = []
  const errori: string[] = []
  for (const id of ids) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?singleEvents=true&orderBy=startTime&timeMin=${tMin}&timeMax=${tMax}&maxResults=40`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { errori.push(`${id}: ${d.error?.message || r.status}`); continue }
    calendari.push(d.summary || id)
    for (const e of d.items || []) {
      if (e.status === 'cancelled') continue
      eventi.push({
        calendario: d.summary || id,
        titolo: e.summary || '(senza titolo)',
        inizio: e.start?.date || e.start?.dateTime || null,
        fine: e.end?.date || e.end?.dateTime || null,
        tutto_il_giorno: !!e.start?.date,
        luogo: e.location || null,
        descrizione: e.description ? String(e.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
      })
    }
  }
  return { finestra_giorni: giorni, calendari, eventi, errori }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-redazione-token',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const PILASTRI = ['cantiere', 'normativa', 'servizi', 'formazione', 'rassegna', 'avviso']
const NOTIZIE_URL_DEFAULT = 'https://qcvwrgjldbdoxcfdsvkq.supabase.co'

/* testo semplice → HTML della notizia (paragrafi, righe, link cliccabili) */
function testoInHtml(t: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return String(t || '').trim().split(/\n{2,}/).map((par) =>
    '<p>' + esc(par).replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + '</p>').join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = req.method === 'GET' ? Object.fromEntries(new URL(req.url).searchParams) : await req.json().catch(() => ({}))
    const op = String(body.op || 'materia')

    /* ── porta della routine: parola d'ordine ─────────────────────── */
    if (op === 'materia' || op === 'bozze') {
      const dato = req.headers.get('x-redazione-token') || ''
      const { data: cfg } = await admin.from('s_config').select('valore').eq('chiave', 'redazione_token').maybeSingle()
      const atteso = cfg?.valore || ''
      if (!atteso || atteso === 'DA-IMPOSTARE' || dato.length < 16 || dato !== atteso) {
        return json({ error: 'parola d\'ordine mancante o sbagliata' }, 401)
      }

      if (op === 'materia') {
        const mesi = Math.min(24, Math.max(3, Number(body.mesi) || 12))
        const { data, error } = await admin.rpc('s_redazione_materia', { p_mesi: mesi })
        if (error) return json({ error: error.message }, 500)
        const materia = (data && typeof data === 'object') ? { ...(data as Record<string, unknown>) } : { dati: data }
        materia.eventi_calendario = await eventiCalendario(admin)
        return json({ ok: true, materia })
      }

      /* op === 'bozze' — solo inserimenti, mai aggiornamenti */
      const giro = String(body.giro || new Date().toISOString().slice(0, 10))
      const lista = Array.isArray(body.bozze) ? body.bozze : []
      if (!lista.length) return json({ error: 'nessuna bozza nel corpo (campo bozze[])' }, 400)
      if (lista.length > 12) return json({ error: 'al massimo 12 bozze per giro' }, 400)
      const righe = lista.map((b: Record<string, unknown>) => ({
        giro,
        pilastro: PILASTRI.includes(String(b.pilastro)) ? String(b.pilastro) : 'cantiere',
        titolo: String(b.titolo || '').slice(0, 200) || 'Senza titolo',
        gancio: b.gancio ? String(b.gancio).slice(0, 400) : null,
        fonte: b.fonte ? String(b.fonte).slice(0, 500) : null,
        fonte_url: b.fonte_url ? String(b.fonte_url).slice(0, 1000) : null,
        norma: b.norma ? String(b.norma).slice(0, 300) : null,
        testo_telegram: b.testo_telegram ? String(b.testo_telegram).slice(0, 4000) : null,
        testo_app: b.testo_app ? String(b.testo_app).slice(0, 8000) : null,
        testo_linkedin: b.testo_linkedin ? String(b.testo_linkedin).slice(0, 3000) : null,
        testo_instagram: b.testo_instagram ? String(b.testo_instagram).slice(0, 2200) : null,
        hashtag: b.hashtag ? String(b.hashtag).slice(0, 300) : null,
        immagine_suggerita: b.immagine_suggerita ? String(b.immagine_suggerita).slice(0, 600) : null,
        verifica: b.verifica ? String(b.verifica).slice(0, 1500) : null,
        data_programmata: /^\d{4}-\d{2}-\d{2}$/.test(String(b.data_programmata || '')) ? String(b.data_programmata) : null,
        stato: 'bozza',
        creato_da: 'routine',
      }))
      const { data: ins, error } = await admin.from('s_post').insert(righe).select('id, titolo, pilastro')
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, giro, inserite: ins?.length || 0, bozze: ins })
    }

    /* ── porta della persona: JWT + ruolo segreteria ─────────────── */
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const utente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } })
    const { data: u } = await utente.auth.getUser()
    const email = u?.user?.email || ''
    const { data: segr } = await utente.rpc('is_segreteria')
    if (!email || segr !== true) return json({ error: 'solo la segreteria può pubblicare' }, 403)

    const id = Number(body.id)
    if (!id) return json({ error: 'id del post mancante' }, 400)
    const { data: post } = await admin.from('s_post').select('*').eq('id', id).maybeSingle()
    if (!post) return json({ error: 'post non trovato' }, 404)
    if (!['approvato', 'pubblicato'].includes(post.stato)) return json({ error: 'si pubblica solo un post approvato' }, 400)
    const canali = (post.canali_pubblicati && typeof post.canali_pubblicati === 'object') ? { ...post.canali_pubblicati } : {}

    if (op === 'pubblica') {
      if (canali.telegram?.message_id && !body.di_nuovo) return json({ error: 'già pubblicato su Telegram (message_id ' + canali.telegram.message_id + ')' }, 409)
      const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
      if (!TOKEN) return json({ error: 'secret TELEGRAM_BOT_TOKEN non impostato: pubblica a mano e segna il post come pubblicato' }, 501)
      const { data: cfg } = await admin.from('s_config').select('valore').eq('chiave', 'telegram_canale').maybeSingle()
      const chat = cfg?.valore
      if (!chat) return json({ error: 's_config.telegram_canale vuoto' }, 500)
      const testo = String(body.testo || post.testo_telegram || '').trim()
      if (!testo) return json({ error: 'testo Telegram vuoto' }, 400)
      const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: testo, disable_web_page_preview: false }),
      })
      const tg = await r.json().catch(() => ({}))
      if (!r.ok || !tg.ok) return json({ error: 'Telegram: ' + (tg.description || r.status) }, 502)
      canali.telegram = { message_id: tg.result?.message_id, chat: chat, at: new Date().toISOString(), da: email }
      await admin.from('s_post').update({
        canali_pubblicati: canali, stato: 'pubblicato', pubblicato_il: post.pubblicato_il || new Date().toISOString(),
        testo_telegram: testo, aggiornato_da: email,
      }).eq('id', id)
      return json({ ok: true, message_id: tg.result?.message_id, chat })
    }

    if (op === 'notizia') {
      if (canali.app?.notizia_id && !body.di_nuovo) return json({ error: 'già pubblicato nell\'app (notizia ' + canali.app.notizia_id + ')' }, 409)
      const KEY = Deno.env.get('NOTIZIE_SERVICE_KEY')
      if (!KEY) return json({ error: 'secret NOTIZIE_SERVICE_KEY non impostato: pubblica a mano dall\'app servizi e segna il post come pubblicato' }, 501)
      const notizie = createClient(Deno.env.get('NOTIZIE_URL') || NOTIZIE_URL_DEFAULT, KEY)
      const titolo = String(body.titolo || post.titolo).slice(0, 200)
      const testo = String(body.testo || post.testo_app || post.testo_telegram || '').trim()
      if (!testo) return json({ error: 'testo per l\'app vuoto' }, 400)
      const categoria = ['notizie', ({ cantiere: 'cantieri', normativa: 'normativa', servizi: 'informazione', formazione: 'formazione', rassegna: 'informazione', avviso: 'avvisi' } as Record<string, string>)[post.pilastro] || 'informazione']
      const { data: n, error } = await notizie.from('notizie').insert({
        titolo, corpo: testoInHtml(testo), categoria, priorita: post.pilastro === 'avviso' ? 'urgente' : 'normale',
        autore: 'Area Sicurezza e Salute', data_pubbl: new Date().toISOString().slice(0, 10),
        link_esterno: post.fonte_url || null, pubblicata: true,
      }).select('id').single()
      if (error) return json({ error: 'notizie: ' + error.message }, 502)
      canali.app = { notizia_id: n.id, at: new Date().toISOString(), da: email }
      await admin.from('s_post').update({
        canali_pubblicati: canali, stato: 'pubblicato', pubblicato_il: post.pubblicato_il || new Date().toISOString(),
        testo_app: testo, aggiornato_da: email,
      }).eq('id', id)
      return json({ ok: true, notizia_id: n.id })
    }

    return json({ error: 'op sconosciuta: ' + op }, 400)
  } catch (e) {
    console.error('redazione-social:', e)
    return json({ error: String(e?.message || e) }, 500)
  }
})
