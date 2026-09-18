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
//   op: 'immagine' / 'immagine_rimuovi' → immagine di testa del post, nel
//                     bucket pubblico social-media (11/09/2026): su Telegram
//                     esce come foto con il testo in didascalia, nell'app come
//                     immagine della notizia.
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
// ⚠️ post-formato.js è la COPIA di js/post-formato.js della webapp (Deno non
// legge fuori dalla cartella della funzione al deploy). Non si modifica qui:
// `npm run post-formato-sync` la rigenera, strumenti/verifica-post-formato.mjs
// fallisce se divergono. Da lì arrivano i segni della formattazione
// (**grassetto**, __corsivo__, ++sottolineato++, ~~barrato~~, [testo](link), > citazione).
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { postInTelegramHtml, postInHtmlNotizia, postInTestoSemplice, lunghezzaVisibile } from './post-formato.js'

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

/* invio a Telegram in HTML; se Telegram rifiuta la formattazione
   («can't parse entities») si ritenta col testo senza segni, invece di
   lasciare il post fermo: il messaggio esce, e la risposta lo dice */
async function inviaTelegram(token: string, metodo: 'sendMessage' | 'sendPhoto', campi: Record<string, unknown>, testo: string, campoTesto: 'text' | 'caption') {
  const chiama = (payload: Record<string, unknown>) => fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then(async (r) => ({ r, tg: await r.json().catch(() => ({})) as Record<string, any> }))
  let { r, tg } = await chiama({ ...campi, [campoTesto]: postInTelegramHtml(testo), parse_mode: 'HTML' })
  if ((!r.ok || !tg.ok) && /parse entities/i.test(String(tg.description || ''))) {
    const riprova = await chiama({ ...campi, [campoTesto]: postInTestoSemplice(testo) })
    return { ...riprova, formattazione_tolta: true }
  }
  return { r, tg, formattazione_tolta: false }
}

/* ══════════ Come esce un post su Telegram (18/09/2026) ══════════
   Scritto in un posto solo: lo usano sia la pubblicazione sul canale
   pubblico sia la PROVA sul canale di prova. Se divergessero, la prova
   non proverebbe niente. Restituisce l'errore invece di lanciarlo, così
   chi chiama decide che cosa scrivere nel post. */
async function mandaSuTelegram(token: string, chat: string, post: Record<string, any>, testo: string):
  Promise<{ tg?: Record<string, any>; formattazioneTolta: boolean; errore?: string }> {
  const altre = (Array.isArray(post.immagini) ? post.immagini as { url: string }[] : []).map((x) => x?.url).filter(Boolean)
  const inDidascalia = lunghezzaVisibile(testo) <= 1024
  let tg: Record<string, any> = {}
  let formattazioneTolta = false

  if (post.immagine_url && altre.length) {
    /* carosello -> album; la didascalia sta sulla prima foto */
    const urls = [post.immagine_url, ...altre].slice(0, 10)
    const album = async (conFormato: boolean) => {
      const didascalia = inDidascalia ? (conFormato ? postInTelegramHtml(testo) : postInTestoSemplice(testo)) : ''
      const media = urls.map((u, k) => (k === 0 && inDidascalia
        ? { type: 'photo', media: u, caption: didascalia, ...(conFormato ? { parse_mode: 'HTML' } : {}) }
        : { type: 'photo', media: u }))
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, media }),
      })
      return { r, tg: await r.json().catch(() => ({})) as Record<string, any> }
    }
    let { r, tg: j } = await album(true)
    if ((!r.ok || !j.ok) && /parse entities/i.test(String(j.description || ''))) {
      const rip = await album(false); r = rip.r; j = rip.tg; formattazioneTolta = true
    }
    if (!r.ok || !j.ok) return { formattazioneTolta, errore: 'Telegram (album): ' + (j.description || r.status) }
    tg = { result: Array.isArray(j.result) ? j.result[0] : j.result }
    if (!inDidascalia) {
      const msg = await inviaTelegram(token, 'sendMessage', { chat_id: chat, disable_web_page_preview: true }, testo, 'text')
      if (!msg.r.ok || !msg.tg.ok) return { formattazioneTolta, errore: "Telegram (testo dopo l'album): " + (msg.tg.description || msg.r.status) }
      tg = msg.tg; formattazioneTolta = msg.formattazione_tolta
    }
  } else if (post.immagine_url) {
    const foto = inDidascalia
      ? await inviaTelegram(token, 'sendPhoto', { chat_id: chat, photo: post.immagine_url }, testo, 'caption')
      : await (async () => {
          const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chat, photo: post.immagine_url }),
          })
          return { r, tg: await r.json().catch(() => ({})) as Record<string, any>, formattazione_tolta: false }
        })()
    if (!foto.r.ok || !foto.tg.ok) return { formattazioneTolta, errore: 'Telegram (foto): ' + (foto.tg.description || foto.r.status) }
    tg = foto.tg; formattazioneTolta = foto.formattazione_tolta
    if (!inDidascalia) {
      const msg = await inviaTelegram(token, 'sendMessage', { chat_id: chat, disable_web_page_preview: true }, testo, 'text')
      if (!msg.r.ok || !msg.tg.ok) return { formattazioneTolta, errore: 'Telegram (testo dopo la foto): ' + (msg.tg.description || msg.r.status) }
      tg = msg.tg; formattazioneTolta = msg.formattazione_tolta
    }
  } else {
    const msg = await inviaTelegram(token, 'sendMessage', { chat_id: chat, disable_web_page_preview: false }, testo, 'text')
    if (!msg.r.ok || !msg.tg.ok) return { formattazioneTolta, errore: 'Telegram: ' + (msg.tg.description || msg.r.status) }
    tg = msg.tg; formattazioneTolta = msg.formattazione_tolta
  }
  return { tg, formattazioneTolta }
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
    const canali = (post.canali_pubblicati && typeof post.canali_pubblicati === 'object') ? { ...post.canali_pubblicati } : {}

    /* ── immagine di testa (11/09/2026): bucket pubblico social-media di questo
       progetto, così serve a Telegram (sendPhoto con URL) e alla notizia
       dell'app servizi (immagine_url). Scrive solo il service role. ── */
    if (op === 'immagine') {
      const mime = String(body.mime || '')
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return json({ error: 'formato immagine non ammesso (jpeg, png, webp)' }, 400)
      const b64 = String(body.base64 || '')
      if (!b64) return json({ error: 'immagine vuota' }, 400)
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      if (bytes.length > 5 * 1024 * 1024) return json({ error: 'immagine oltre 5 MB' }, 400)
      const est = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
      /* 18/09/2026 - la prima immagine e' la copertina, le altre fanno il CAROSELLO
         (nell'app servizi si scorrono, su Telegram escono come album). Si AGGIUNGE,
         non si sostituisce: per cambiare la copertina si toglie e si ricarica. */
      const carosello = Array.isArray(post.immagini) ? post.immagini as { url: string; path: string }[] : []
      if ((post.immagine_url ? 1 : 0) + carosello.length >= 10) return json({ error: 'al massimo 10 immagini per post (limite dell\'album di Telegram)' }, 400)
      const path = `post-${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${est}`
      const { error: eUp } = await admin.storage.from('social-media').upload(path, bytes, { contentType: mime, upsert: false })
      if (eUp) return json({ error: 'caricamento immagine: ' + eUp.message }, 502)
      const { data: pub } = admin.storage.from('social-media').getPublicUrl(path)
      const agg = post.immagine_url
        ? { immagini: [...carosello, { url: pub.publicUrl, path }], aggiornato_da: email }
        : { immagine_url: pub.publicUrl, immagine_path: path, aggiornato_da: email }
      await admin.from('s_post').update(agg).eq('id', id)
      return json({ ok: true, immagine_url: pub.publicUrl, quante: (post.immagine_url ? 1 : 0) + carosello.length + 1 })
    }
    if (op === 'immagine_rimuovi') {
      /* Si toglie per POSIZIONE (0 = copertina). Togliendo la copertina, la prima del
         carosello prende il suo posto: l'elenco resta senza buchi. */
      const carosello = Array.isArray(post.immagini) ? post.immagini as { url: string; path: string }[] : []
      const tutte = (post.immagine_url ? [{ url: post.immagine_url, path: post.immagine_path }] : []).concat(carosello)
      const i = Number.isInteger(body.indice) ? Number(body.indice) : 0
      if (i < 0 || i >= tutte.length) return json({ error: 'nessuna immagine in quella posizione' }, 400)
      const via = tutte.splice(i, 1)[0]
      if (via?.path) await admin.storage.from('social-media').remove([via.path]).catch(() => null)
      await admin.from('s_post').update({
        immagine_url: tutte[0]?.url || null, immagine_path: tutte[0]?.path || null,
        immagini: tutte.length > 1 ? tutte.slice(1) : null, aggiornato_da: email,
      }).eq('id', id)
      return json({ ok: true, quante: tutte.length })
    }

    /* 18/09/2026 - I canali che il bot ha visto di recente: serve a trovare il
       chat_id del canale di prova senza cercarlo a mano. Telegram lo mostra solo
       se in quel canale e' stato scritto qualcosa da poco E il bot e' fra gli
       amministratori: e' un limite di getUpdates, non un guasto. */
    if (op === 'canali_bot') {
      const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
      if (!TOKEN) return json({ error: 'secret TELEGRAM_BOT_TOKEN non impostato' }, 501)
      const me = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`).then((x) => x.json()).catch(() => ({}))
      const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?limit=100`)
      const j = await r.json().catch(() => ({})) as Record<string, any>
      if (!r.ok || !j.ok) return json({ error: 'Telegram: ' + (j.description || r.status) }, 502)
      const visti = new Map<string, Record<string, string>>()
      for (const u of (j.result || []) as Record<string, any>[]) {
        const c = u.channel_post?.chat || u.my_chat_member?.chat || u.message?.chat || u.edited_channel_post?.chat
        if (!c) continue
        visti.set(String(c.id), { id: String(c.id), titolo: c.title || c.username || String(c.id), tipo: c.type })
      }
      return json({ ok: true, bot: me?.result?.username || null, canali: [...visti.values()] })
    }

    /* PROVA: si manda al canale di prova per vedere come esce. NON tocca lo stato
       del post ne' «uscito su»: non e' una pubblicazione, e si puo' fare anche su
       una bozza - e' li' che serve. Passa dalla stessa mandaSuTelegram della
       pubblicazione vera, altrimenti proverebbe qualcosa di diverso. */
    if (op === 'pubblica' && body.prova) {
      const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
      if (!TOKEN) return json({ error: 'secret TELEGRAM_BOT_TOKEN non impostato' }, 501)
      const { data: cfgP } = await admin.from('s_config').select('valore').eq('chiave', 'telegram_canale_prova').maybeSingle()
      const chatProva = String(cfgP?.valore || '').trim()
      if (!chatProva) return json({ error: 'canale di prova non impostato: va scritto in s_config.telegram_canale_prova, e il bot deve esserne amministratore' }, 400)
      let testoP = String(body.testo || post.testo_telegram || '').trim()
      if (!testoP) return json({ error: 'testo Telegram vuoto' }, 400)
      if (post.video_url && !testoP.includes(String(post.video_url))) testoP = testoP + '\n\n' + post.video_url
      if (lunghezzaVisibile(testoP) > 4096) return json({ error: `testo Telegram troppo lungo: ${lunghezzaVisibile(testoP)} caratteri visibili, il limite è 4096` }, 400)
      const esitoP = await mandaSuTelegram(TOKEN, chatProva, post, testoP)
      if (esitoP.errore) return json({ error: esitoP.errore }, 502)
      canali.prova = {
        at: new Date().toISOString(), da: email, chat: chatProva,
        message_id: esitoP.tg?.result?.message_id,
        ...(esitoP.formattazioneTolta ? { formattazione_tolta: true } : {}),
      }
      await admin.from('s_post').update({ canali_pubblicati: canali, aggiornato_da: email }).eq('id', id)
      return json({ ok: true, prova: true, chat: chatProva, message_id: esitoP.tg?.result?.message_id, formattazione_tolta: esitoP.formattazioneTolta })
    }

    if (!['approvato', 'pubblicato'].includes(post.stato)) return json({ error: 'si pubblica solo un post approvato' }, 400)

    if (op === 'pubblica') {
      if (canali.telegram?.message_id && !body.di_nuovo) return json({ error: 'già pubblicato su Telegram (message_id ' + canali.telegram.message_id + ')' }, 409)
      const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
      if (!TOKEN) return json({ error: 'secret TELEGRAM_BOT_TOKEN non impostato: pubblica a mano e segna il post come pubblicato' }, 501)
      const { data: cfg } = await admin.from('s_config').select('valore').eq('chiave', 'telegram_canale').maybeSingle()
      const chat = cfg?.valore
      if (!chat) return json({ error: 's_config.telegram_canale vuoto' }, 500)
      let testo = String(body.testo || post.testo_telegram || '').trim()
      if (!testo) return json({ error: 'testo Telegram vuoto' }, 400)
      /* Il video non si carica da nessuna parte: si manda il LINK, che Telegram rende
         cliccabile e - quando non ci sono foto - apre anche l'anteprima. Se chi scrive
         l'ha gia' messo nel testo non si ripete. */
      if (post.video_url && !testo.includes(String(post.video_url))) testo = testo + '\n\n' + post.video_url
      if (lunghezzaVisibile(testo) > 4096) return json({ error: `testo Telegram troppo lungo: ${lunghezzaVisibile(testo)} caratteri visibili, il limite è 4096` }, 400)
      /* con l'immagine di testa: foto col testo come didascalia (limite Telegram
         1024 caratteri VISIBILI, cioè senza i segni); se il testo è più lungo,
         foto e poi messaggio a parte. Il testo esce formattato (parse_mode HTML). */
      const esito = await mandaSuTelegram(TOKEN, chat, post, testo)
      if (esito.errore) return json({ error: esito.errore }, 502)
      const tg = esito.tg || {}
      const formattazioneTolta = esito.formattazioneTolta
      canali.telegram = { message_id: tg.result?.message_id, chat: chat, at: new Date().toISOString(), da: email, ...(formattazioneTolta ? { formattazione_tolta: true } : {}) }
      await admin.from('s_post').update({
        canali_pubblicati: canali, stato: 'pubblicato', pubblicato_il: post.pubblicato_il || new Date().toISOString(),
        testo_telegram: testo, aggiornato_da: email,
      }).eq('id', id)
      return json({ ok: true, message_id: tg.result?.message_id, chat, formattazione_tolta: formattazioneTolta })
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
        titolo, corpo: postInHtmlNotizia(testo), categoria, priorita: post.pilastro === 'avviso' ? 'urgente' : 'normale',
        autore: 'Area Sicurezza e Salute', data_pubbl: new Date().toISOString().slice(0, 10),
        link_esterno: post.fonte_url || null, immagine_url: post.immagine_url || null, pubblicata: true,
        /* 18/09/2026: le altre immagini fanno il carosello nella pagina Notizie, e il
           video di YouTube ci esce con copertina e tasto play (parte solo al tocco). */
        immagini: Array.isArray(post.immagini) && post.immagini.length
          ? (post.immagini as { url: string }[]).map((x) => x?.url).filter(Boolean) : null,
        video_url: post.video_url || null,
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
