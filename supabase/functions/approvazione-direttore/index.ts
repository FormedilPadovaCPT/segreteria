// Supabase Edge Function – approvazione-direttore
// Il preventivo dell'asseverazione si fa approvare dal Direttore NELL'APP
// prima di uscire a sua firma (12/10/2026).
//
// Chiesto dall'utente: il preventivo 5.D.2 usciva subito con timbro e firma
// del Direttore. Da oggi:
//
//   richiedi  (segreteria)  l'app asseverazione ha caricato nel bucket
//             `approvazioni-direttore/bozze/` la BOZZA del preventivo — senza
//             firma, con la scritta BOZZA — e qui si registra la richiesta con
//             l'impronta dei dati; poi parte l'AVVISO al Direttore, mail +
//             notifica 🔔. ⚠️ La mail parte da sola: è la SETTIMA eccezione
//             INTERNA alla regola «le mail le manda una persona», decisa
//             dall'utente il 12/10/2026, e regge come le altre: il testo si
//             legge tutto dal database.
//   avvisa    (segreteria)  rimanda la mail con tutto quello che aspetta.
//   ritira    (segreteria)  la richiesta non serve più: esce dall'elenco.
//   approva   (Direttore)   si ricontrolla l'impronta della bozza e si
//             registra l'approvazione, con la nota se c'è. Notifica 🔔 alla
//             segreteria: ora «Protocolla e genera» si accende.
//   rimanda   (Direttore)   non approva, con la nota che dice che cosa
//             cambiare. Notifica 🔔 alla segreteria.
//
// Dal 14/10/2026 (chiesto dall'utente) passano di qui anche il PROGRAMMA 5.D.3
// e il PIANO 5.D.4, che escono anch'essi a sua firma: tipi `programma_assev`
// e `piano_assev`, stesso giro. I testi parlano di «documenti».
//
// Il PDF con timbro e firma lo genera poi l'app asseverazione quando si
// protocolla, e solo se l'approvazione è viva e i dati del preventivo sono
// ancora quelli approvati (impronta_dati). Approva solo il Direttore
// (is_direttore, s_config.direttore_email).
//
// Mittente della mail: cptpd@did.formedilpadova.it (la casella che il
// service account impersona), Reply-To cpt@formedilpadova.it.
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (gmail.send).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync), firma-logo.js
// è la versione che scarica il logo dal sito — come in firma-presidente.
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, oggettoUfficio, paginaHtml, corpoInHtml, LOGO_FIRMA_CID } from './firma.js'
// @ts-ignore modulo JS senza tipi
import { caricaLogo } from './firma-logo.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const BUCKET = 'approvazioni-direttore'
const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const PAGINA_DIREZIONE = 'https://formedilpadovacpt.github.io/gestionale-visite/?vista=direzione'
const TIPI = ['preventivo_assev', 'programma_assev', 'piano_assev']
/* come si chiama il documento nei testi: l'articolo serve per «il …» */
const NOME_TIPO: Record<string, string> = {
  preventivo_assev: 'il preventivo 5.D.2',
  programma_assev: 'il programma di verifica 5.D.3',
  piano_assev: 'il piano di verifica 5.D.4',
}
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const IMPRONTA_RE = /^[0-9a-f]{64}$/

const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')
const euro = (n: unknown) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

type Riga = Record<string, any>

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUtente.auth.getUser()
    const io = String(u?.user?.email || '').toLowerCase()
    if (!io) return json({ error: 'accesso non autorizzato' }, 401)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const corpo = await req.json().catch(() => ({}))
    const azione = String(corpo?.azione || '')

    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['direttore_email', 'direttore_nome'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))
    const dirEmail = String(conf.direttore_email || '').trim().toLowerCase()

    /* chi può fare che cosa: l'errore di lettura vale «no» */
    const ruolo = async (fn: string) => {
      const { data, error } = await sbUtente.rpc(fn)
      return !error && data === true
    }

    if (azione === 'richiedi' || azione === 'avvisa' || azione === 'ritira') {
      if (!(await ruolo('is_segreteria'))) return json({ error: 'L\'approvazione al Direttore la chiede la segreteria.' }, 403)
    } else if (azione === 'approva' || azione === 'rimanda') {
      if (!(await ruolo('is_direttore'))) return json({ error: 'Approva solo il Direttore, col suo accesso.' }, 403)
    } else {
      return json({ error: 'Azione non prevista' }, 400)
    }

    /* ── la segreteria registra il documento da approvare ── */
    if (azione === 'richiedi') {
      const tipo = String(corpo?.tipo || '')
      const rif = String(corpo?.rif || '').trim()
      const file = String(corpo?.file_bozza || '')
      const impronta = String(corpo?.impronta_dati || '')
      const titolo = String(corpo?.titolo || '').trim()
      if (!TIPI.includes(tipo) || !rif || !file.startsWith('bozze/') || !titolo || !IMPRONTA_RE.test(impronta)) {
        return json({ error: 'Richiesta incompleta: servono tipo, riferimento, titolo, impronta e la bozza caricata.' }, 400)
      }
      /* la bozza dev'esserci davvero: se ne prende l'impronta, che si
         ricontrolla quando il Direttore approva */
      const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(file)
      if (eD || !blob) return json({ error: `Non trovo la bozza caricata (${file}).` }, 400)
      const bozza = new Uint8Array(await blob.arrayBuffer())
      const dati = {
        tipo, rif, titolo: titolo.slice(0, 300),
        dettaglio: corpo?.dettaglio && typeof corpo.dettaglio === 'object' ? corpo.dettaglio : {},
        impronta_dati: impronta, file_bozza: file, sha256_bozza: await sha256(bozza),
      }
      const { data: viva, error: eV } = await sb.from('s_approvazioni_direttore').select('id, stato, impronta_dati')
        .eq('tipo', tipo).eq('rif', rif).in('stato', ['in_attesa', 'approvata']).maybeSingle()
      if (eV) throw new Error('Non sono riuscito a leggere le richieste già fatte: ' + eV.message)
      /* già approvato così com'è: niente da chiedere */
      if (viva?.stato === 'approvata' && viva.impronta_dati === impronta) {
        return json({ ok: true, gia_approvata: true, id: viva.id })
      }
      const adesso = new Date().toISOString()
      /* approvato, ma i dati sono cambiati: quell'approvazione non vale più */
      if (viva?.stato === 'approvata') {
        const { error } = await sb.from('s_approvazioni_direttore')
          .update({ stato: 'superata', chiusa_da: io, chiusa_il: adesso }).eq('id', viva.id).eq('stato', 'approvata')
        if (error) throw new Error('Non sono riuscito a chiudere l\'approvazione di prima: ' + error.message)
      }
      /* in attesa: si aggiorna la fotografia (preventivo corretto prima che il Direttore decidesse) */
      const { data: riga, error: eS } = viva?.stato === 'in_attesa'
        ? await sb.from('s_approvazioni_direttore').update({ ...dati, richiesta_da: io, richiesta_il: adesso })
          .eq('id', viva.id).select().single()
        : await sb.from('s_approvazioni_direttore').insert({ ...dati, richiesta_da: io }).select().single()
      if (eS) throw new Error('Richiesta non registrata: ' + eS.message)
      const avviso = await avvisaDirettore(sb, conf, dirEmail)
      return json({ ok: true, id: riga.id, avviso })
    }

    if (azione === 'avvisa') {
      return json({ ok: true, avviso: await avvisaDirettore(sb, conf, dirEmail) })
    }

    const id = Number(corpo?.id)
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Documento non indicato' }, 400)
    const { data: r, error: eR } = await sb.from('s_approvazioni_direttore').select('*').eq('id', id).maybeSingle()
    if (eR) throw new Error('Non sono riuscito a leggere la richiesta: ' + eR.message)
    if (!r) return json({ error: 'Documento non trovato' }, 404)

    if (azione === 'ritira') {
      if (r.stato !== 'in_attesa') return json({ ok: true, gia: true })
      const { error } = await sb.from('s_approvazioni_direttore')
        .update({ stato: 'ritirata', chiusa_da: io, chiusa_il: new Date().toISOString() }).eq('id', id).eq('stato', 'in_attesa')
      if (error) throw new Error(error.message)
      return json({ ok: true })
    }

    if (r.stato !== 'in_attesa') {
      return json({ error: r.stato === 'approvata' ? 'Questo documento è già approvato.' : 'Questo documento non aspetta più la tua approvazione.' }, 409)
    }

    const nota = String(corpo?.nota || '').trim().slice(0, 1000)
    if (azione === 'rimanda') {
      if (nota.length < 3) return json({ error: 'Scrivi in due righe che cosa va cambiato: torna alla segreteria.' }, 400)
      const { data: agg, error } = await sb.from('s_approvazioni_direttore').update({
        stato: 'rimandata', decisa_da: io, decisa_il: new Date().toISOString(), nota,
      }).eq('id', id).eq('stato', 'in_attesa').select('id')
      if (error) throw new Error(error.message)
      if (!agg?.length) return json({ error: 'Nel frattempo la richiesta è cambiata: ricarica la pagina.' }, 409)
      await avvisaSegreteria(sb, 'approvazione_rimandata', `Il Direttore ha rimandato ${NOME_TIPO[r.tipo] || 'un documento'}`,
        `«${r.titolo}»: c'è la sua nota nell'app.`, `approvazione-${id}`)
      return json({ ok: true })
    }

    /* ── approva: la bozza dev'essere ancora quella che ha letto ── */
    const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(r.file_bozza)
    if (eD || !blob) throw new Error('Non trovo la bozza da approvare.')
    if ((await sha256(new Uint8Array(await blob.arrayBuffer()))) !== r.sha256_bozza) {
      throw new Error('La bozza non è più quella che è stata chiesta di approvare: avvisa la segreteria.')
    }
    const adesso = new Date().toISOString()
    const { data: agg, error: eA } = await sb.from('s_approvazioni_direttore').update({
      stato: 'approvata', decisa_da: io, decisa_il: adesso, nota: nota || null,
    }).eq('id', id).eq('stato', 'in_attesa').select('id')
    if (eA) throw new Error(eA.message)
    if (!agg?.length) return json({ error: 'Nel frattempo la richiesta è cambiata: ricarica la pagina.' }, 409)
    await avvisaSegreteria(sb, 'approvazione_fatta', 'Il Direttore ha approvato',
      `«${r.titolo}»: ora si può protocollare e generare con timbro e firma.`, `approvazione-${id}`)
    return json({ ok: true, approvata_il: adesso })
  } catch (e) {
    console.error('approvazione-direttore:', e)
    return json({ error: (e as Error).message }, 400)
  }
})

/* la notifica alla segreteria: a ogni accesso di segreteria attivo */
async function avvisaSegreteria(sb: any, evento: string, titolo: string, testo: string, tag: string) {
  try {
    const { data } = await sb.from('app_ruoli').select('email').in('ruolo', ['segreteria', 'admin']).eq('stato', 'attivo')
    for (const x of (data || []) as { email: string }[]) {
      await sb.rpc('push_accoda', { p_email: x.email, p_evento: evento, p_titolo: titolo, p_testo: testo, p_url: './', p_tag: tag })
    }
  } catch (e) { console.warn('avviso segreteria:', (e as Error).message) }
}

/* la mail e la notifica al Direttore con TUTTO quello che aspetta la sua
   approvazione: un elenco solo, così più richieste insieme fanno una mail */
async function avvisaDirettore(sb: any, conf: Record<string, string>, a: string) {
  const { data: att, error } = await sb.from('s_approvazioni_direttore')
    .select('id, tipo, titolo, dettaglio, richiesta_il').eq('stato', 'in_attesa').order('richiesta_il')
  if (error) return { inviata: false, errore: 'non sono riuscito a leggere l\'elenco: ' + error.message }
  const righe = (att || []) as Riga[]
  if (!righe.length) return { inviata: false, errore: 'niente in attesa di approvazione' }
  if (!MAIL_RE.test(a)) return { inviata: false, errore: 'manca l\'indirizzo del Direttore in s_config.direttore_email' }
  const ids = righe.map((x) => x.id)

  try {
    await sb.rpc('push_accoda', {
      p_email: a, p_evento: 'approvazione_direttore',
      p_titolo: righe.length === 1 ? 'Un documento da approvare' : `${righe.length} documenti da approvare`,
      p_testo: 'Li trovi nella pagina Direzione: si leggono e si approvano dall\'app.',
      p_url: './?vista=direzione', p_tag: 'approvazioni-direttore',
    })
  } catch (e) { console.warn('push direttore:', (e as Error).message) }

  const nome = String(conf.direttore_nome || '').trim()
  const una = righe.length === 1
  const voce = (x: Riga) => {
    const d = x.dettaglio || {}
    const parti = [
      d.giornate != null ? `${String(d.giornate).replace('.', ',')} giornate` : null,
      d.totale != null ? euro(d.totale) : null,
      Array.isArray(d.sotto_minimo) && d.sotto_minimo.length ? 'sotto il minimo della norma, con motivazione' : null,
    ].filter(Boolean)
    return `- ${x.titolo}${parti.length ? ` (${parti.join(', ')})` : ''}`
  }
  const testo = [
    'Gentile Direttore,',
    '',
    una
      ? 'c\'è un documento di asseverazione che aspetta la sua approvazione prima di uscire a sua firma:'
      : `ci sono ${righe.length} documenti di asseverazione che aspettano la sua approvazione prima di uscire a sua firma:`,
    righe.map(voce).join('\n'),
    '',
    '>>>> ✅ Apri i documenti e approva (da approvare: pagina Direzione del gestionale visite):',
    PAGINA_DIREZIONE,
    '',
    'Si apre la bozza e si preme «Approvo». Se qualcosa non va, «Rimando» con due righe di nota lo riporta alla segreteria. Preventivo, programma e piano prendono il numero di protocollo, il timbro e la sua firma solo dopo l\'approvazione.',
    '',
    'Cordiali saluti.',
  ].join('\n')
  const oggetto = oggettoUfficio(una ? `Un documento da approvare - alla c.a. del Direttore${nome ? ` ${nome}` : ''}`
    : `${righe.length} documenti da approvare - alla c.a. del Direttore${nome ? ` ${nome}` : ''}`)

  const adesso = new Date().toISOString()
  try {
    const logo = await caricaLogo()
    let html = paginaHtml(corpoInHtml(testo))
    if (!logo.ok) {
      html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
    }
    const mime = componiEml({
      from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
      to: a, cc: [], oggetto, corpo: testo, html, unsent: false,
    })
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const token = await getToken(sa, SCOPE_GMAIL)
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toB64Url(mime) }),
    })
    const out = await res.json()
    if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
    await sb.from('s_approvazioni_direttore').update({ avviso_il: adesso, avviso_esito: `inviato a ${a}` }).in('id', ids)
    return { inviata: true, a, documenti: ids.length }
  } catch (e) {
    const msg = (e as Error).message
    await sb.from('s_approvazioni_direttore').update({ avviso_esito: `non inviato: ${msg}`.slice(0, 500) }).in('id', ids)
    return { inviata: false, errore: msg }
  }
}
