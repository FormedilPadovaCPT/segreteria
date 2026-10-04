// Supabase Edge Function – firma-presidente
// I documenti a firma del Presidente si firmano NELL'APP (04/10/2026).
//
// Chiesto dall'utente: le lettere di incarico — del gruppo di verifica
// dell'asseverazione e di docenza dei corsi — sono a firma del Presidente,
// e il giro di carta «richiede un sacco di tempo». Da oggi:
//
//   richiedi  (segreteria)  la segreteria ha caricato nel bucket
//             `firme-presidente/originali/` il PDF protocollato — la
//             fotografia esatta di quello che il Presidente leggerà — e qui
//             si registra la richiesta; poi parte l'AVVISO al Presidente,
//             mail + notifica 🔔. ⚠️ La mail parte da sola: è la terza
//             eccezione INTERNA alla regola «le mail le manda una persona»
//             (dopo l'avviso di pagamento e l'avviso al coordinatore), decisa
//             dall'utente il 04/10/2026, e regge per lo stesso motivo: il
//             testo si legge tutto dal database, chi chiama passa solo dati
//             del documento che il database già conosce.
//   avvisa    (segreteria)  rimanda la mail con tutto quello che aspetta.
//   firma     (Presidente)  si ricontrolla l'impronta del PDF, si appone la
//             firma scansionata (s_config.presidente_firma_id, su Drive) nel
//             riquadro registrato con la richiesta, con sotto data, ora e
//             nome, e si salva la versione firmata accanto all'originale.
//             L'originale non si tocca. Avviso 🔔 alla segreteria.
//   rimanda   (Presidente)  non firma, con due righe di motivo.
//   ritira    (segreteria)  la richiesta non serve più (lettera annullata,
//             da rifare): esce dall'elenco del Presidente.
//
// La firma vale solo dopo il «Firmo»: chi la vuole sul documento passa da
// qui. Firma solo il Presidente (s_config.presidente_email), non il
// Vicepresidente: scelta dell'utente.
//
// Mittente della mail: cptpd@did.formedilpadova.it (la casella che il
// service account impersona), Reply-To cpt@formedilpadova.it.
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (gmail.send e drive).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL, SCOPE_DRIVE } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync), firma-logo.js
// è la versione che scarica il logo dal sito — come in avviso-approvazione.
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

const BUCKET = 'firme-presidente'
const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const PAGINA_PRESIDENZA = 'https://formedilpadovacpt.github.io/gestionale-visite/?vista=direzione'
const TIPI = ['incarico_assev', 'incarico_docenza']
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
const sha256 = async (b: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')
const oraRoma = (d: Date) => {
  const f = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)
  const v = (t: string) => f.find((p) => p.type === t)?.value || ''
  return { data: `${v('day')}/${v('month')}/${v('year')}`, ora: `${v('hour')}:${v('minute')}` }
}

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
      .in('chiave', ['presidente_email', 'presidente_nome', 'presidente_firma_id'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))
    const presEmail = String(conf.presidente_email || '').trim().toLowerCase()

    /* chi può fare che cosa: l'errore di lettura vale «no» */
    const ruolo = async (fn: string) => {
      const { data, error } = await sbUtente.rpc(fn)
      return !error && data === true
    }

    if (azione === 'richiedi' || azione === 'avvisa' || azione === 'ritira') {
      if (!(await ruolo('is_segreteria'))) return json({ error: 'La richiesta di firma la fa la segreteria.' }, 403)
    } else if (azione === 'firma' || azione === 'rimanda') {
      if (!(await ruolo('is_presidente'))) return json({ error: 'Firma solo il Presidente, col suo accesso.' }, 403)
    } else {
      return json({ error: 'Azione non prevista' }, 400)
    }

    /* ── la segreteria registra uno o più documenti da firmare ── */
    if (azione === 'richiedi') {
      const docs = (Array.isArray(corpo?.documenti) ? corpo.documenti : []).slice(0, 20)
      if (!docs.length) return json({ error: 'Nessun documento indicato' }, 400)
      const fatti: Riga[] = []
      for (const d of docs) {
        const tipo = String(d?.tipo || '')
        const rif = String(d?.rif || '').trim()
        const file = String(d?.file_originale || '')
        if (!TIPI.includes(tipo) || !rif || !file.startsWith('originali/') || !String(d?.titolo || '').trim()) {
          throw new Error('Documento incompleto: servono tipo, riferimento, titolo e il PDF caricato.')
        }
        const r = d?.riquadro || {}
        const rq = { pagina: Number(r.pagina), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }
        if (!Object.values(rq).every((n) => Number.isFinite(n)) || rq.pagina < 0 || rq.w <= 0 || rq.h <= 0) {
          throw new Error('Non so dove va la firma su questo documento (riquadro mancante).')
        }
        /* il PDF dev'esserci davvero: se ne prende l'impronta, che si
           ricontrolla al momento della firma */
        const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(file)
        if (eD || !blob) throw new Error(`Non trovo il PDF caricato (${file}).`)
        const byte = new Uint8Array(await blob.arrayBuffer())
        const pdf = await PDFDocument.load(byte)
        if (rq.pagina >= pdf.getPageCount()) throw new Error('Il riquadro della firma cade fuori dal documento.')
        const impronta = await sha256(byte)

        const dati = {
          tipo, rif, titolo: String(d.titolo).trim().slice(0, 300),
          destinatario: d?.destinatario ? String(d.destinatario).slice(0, 200) : null,
          protocollo_id: Number.isInteger(Number(d?.protocollo_id)) && Number(d?.protocollo_id) > 0 ? Number(d.protocollo_id) : null,
          nome_file: String(d?.nome_file || file.split('/').pop()).slice(0, 250),
          file_originale: file, sha256_originale: impronta, riquadro: rq,
        }
        /* un documento ha una sola richiesta viva: se aspetta ancora la
           firma si aggiorna la fotografia (lettera rigenerata), se è già
           firmata non si tocca — prima va ritirata */
        const { data: viva } = await sb.from('s_firme_presidente').select('id, stato')
          .eq('tipo', tipo).eq('rif', rif).in('stato', ['in_attesa', 'firmata']).maybeSingle()
        if (viva?.stato === 'firmata') {
          throw new Error(`«${dati.titolo}» è già firmata dal Presidente: per farla firmare di nuovo, prima si ritira la firma.`)
        }
        const { data: riga, error: eS } = viva
          ? await sb.from('s_firme_presidente').update({ ...dati, richiesta_da: io, richiesta_il: new Date().toISOString() })
            .eq('id', viva.id).select().single()
          : await sb.from('s_firme_presidente').insert({ ...dati, richiesta_da: io }).select().single()
        if (eS) throw new Error('Richiesta non registrata: ' + eS.message)
        fatti.push(riga)
      }
      const avviso = await avvisaPresidente(sb, conf, presEmail)
      return json({ ok: true, richieste: fatti.map((r) => ({ id: r.id, rif: r.rif })), avviso })
    }

    if (azione === 'avvisa') {
      return json({ ok: true, avviso: await avvisaPresidente(sb, conf, presEmail) })
    }

    const id = Number(corpo?.id)
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Documento non indicato' }, 400)
    const { data: r, error: eR } = await sb.from('s_firme_presidente').select('*').eq('id', id).maybeSingle()
    if (eR) throw new Error('Non sono riuscito a leggere la richiesta: ' + eR.message)
    if (!r) return json({ error: 'Documento non trovato' }, 404)

    if (azione === 'ritira') {
      if (!['in_attesa', 'firmata'].includes(r.stato)) return json({ ok: true, gia: true })
      const { error } = await sb.from('s_firme_presidente')
        .update({ stato: 'ritirata', ritirata_il: new Date().toISOString(), ritirata_da: io }).eq('id', id)
      if (error) throw new Error(error.message)
      return json({ ok: true })
    }

    if (r.stato !== 'in_attesa') {
      return json({ error: r.stato === 'firmata' ? 'Questo documento è già firmato.' : 'Questo documento non aspetta più la firma.' }, 409)
    }

    if (azione === 'rimanda') {
      const motivo = String(corpo?.motivo || '').trim()
      if (motivo.length < 3) return json({ error: 'Scrivi in due righe perché non lo firmi: torna alla segreteria.' }, 400)
      const { error } = await sb.from('s_firme_presidente').update({
        stato: 'rimandata', rimandata_il: new Date().toISOString(), rimandata_motivo: motivo.slice(0, 1000),
      }).eq('id', id).eq('stato', 'in_attesa')
      if (error) throw new Error(error.message)
      await avvisaSegreteria(sb, 'firma_rimandata', 'Il Presidente ha rimandato un documento',
        `«${r.titolo}» non è stato firmato: c'è il motivo nell'app.`, `firma-${id}`)
      return json({ ok: true })
    }

    /* ── firma ── */
    const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(r.file_originale)
    if (eD || !blob) throw new Error('Non trovo il documento da firmare.')
    const originale = new Uint8Array(await blob.arrayBuffer())
    if ((await sha256(originale)) !== r.sha256_originale) {
      throw new Error('Il documento non è più quello che è stato chiesto di firmare: avvisa la segreteria.')
    }
    if (!conf.presidente_firma_id) throw new Error('La firma del Presidente non è caricata (s_config.presidente_firma_id).')
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const tokD = await getToken(sa, SCOPE_DRIVE)
    const rf = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(conf.presidente_firma_id)}?alt=media`, {
      headers: { Authorization: `Bearer ${tokD}` },
    })
    if (!rf.ok) throw new Error('Non riesco a leggere la firma del Presidente da Drive.')
    const firmaByte = new Uint8Array(await rf.arrayBuffer())

    const pdf = await PDFDocument.load(originale)
    let img
    try { img = await pdf.embedPng(firmaByte) } catch { img = await pdf.embedJpg(firmaByte) }
    const rq = r.riquadro as { pagina: number; x: number; y: number; w: number; h: number }
    const pg = pdf.getPage(rq.pagina)
    const k = Math.min(rq.w / img.width, rq.h / img.height)
    const w = img.width * k, h = img.height * k
    pg.drawImage(img, { x: rq.x, y: rq.y + (rq.h - h) / 2, width: w, height: h })
    const adesso = new Date()
    const { data: g, ora } = oraRoma(adesso)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const nome = String(conf.presidente_nome || '').trim()
    pg.drawText(`Firmato nell'app il ${g} alle ${ora}${nome ? ` - ${nome}` : ''}`, {
      x: rq.x, y: rq.y - 7, size: 6, font, color: rgb(0.45, 0.47, 0.5),
    })
    pdf.setModificationDate(adesso)
    const firmato = await pdf.save()
    const percorso = `firmate/${id}_${String(r.nome_file).replace(/[^\w.\-]+/g, '_')}`
    const { error: eU } = await sb.storage.from(BUCKET).upload(percorso, firmato, { contentType: 'application/pdf', upsert: true })
    if (eU) throw new Error('Firma apposta ma non salvata: ' + eU.message)
    const { data: agg, error: eF } = await sb.from('s_firme_presidente').update({
      stato: 'firmata', firmata_da: io, firmata_il: adesso.toISOString(),
      file_firmato: percorso, sha256_firmato: await sha256(firmato),
    }).eq('id', id).eq('stato', 'in_attesa').select('id')
    if (eF) throw new Error(eF.message)
    if (!agg?.length) return json({ error: 'Nel frattempo la richiesta è cambiata: ricarica la pagina.' }, 409)
    await avvisaSegreteria(sb, 'firma_fatta', 'Il Presidente ha firmato',
      `«${r.titolo}» è firmato: la versione firmata è pronta nell'app.`, `firma-${id}`)
    return json({ ok: true, firmata_il: adesso.toISOString(), file_firmato: percorso })
  } catch (e) {
    console.error('firma-presidente:', e)
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

/* la mail e la notifica al Presidente con TUTTO quello che aspetta la sua
   firma: un elenco solo, così più richieste insieme fanno una mail sola */
async function avvisaPresidente(sb: any, conf: Record<string, string>, a: string) {
  const { data: att, error } = await sb.from('s_firme_presidente')
    .select('id, titolo, destinatario, protocollo_id, richiesta_il').eq('stato', 'in_attesa').order('richiesta_il')
  if (error) return { inviata: false, errore: 'non sono riuscito a leggere l\'elenco: ' + error.message }
  const righe = (att || []) as Riga[]
  if (!righe.length) return { inviata: false, errore: 'niente in attesa di firma' }
  if (!MAIL_RE.test(a)) return { inviata: false, errore: 'manca l\'indirizzo del Presidente in s_config.presidente_email' }

  const ids = righe.map((x) => x.id)
  const protIds = righe.map((x) => x.protocollo_id).filter(Boolean)
  const { data: pp } = protIds.length
    ? await sb.from('s_protocollo').select('id, codice').in('id', protIds)
    : { data: [] }
  const codDi = Object.fromEntries(((pp || []) as Riga[]).map((p) => [p.id, p.codice]))

  try {
    await sb.rpc('push_accoda', {
      p_email: a, p_evento: 'firma_presidente',
      p_titolo: righe.length === 1 ? 'Un documento da firmare' : `${righe.length} documenti da firmare`,
      p_testo: 'Li trovi nella pagina Presidenza: si leggono e si firmano dall\'app.',
      p_url: './?vista=direzione', p_tag: 'firme-presidente',
    })
  } catch (e) { console.warn('push presidente:', (e as Error).message) }

  const nome = String(conf.presidente_nome || '').trim()
  const una = righe.length === 1
  const testo = [
    'Gentile Presidente,',
    '',
    una
      ? 'c\'è un documento che aspetta la sua firma:'
      : `ci sono ${righe.length} documenti che aspettano la sua firma:`,
    righe.map((x) => `- ${x.titolo}${x.protocollo_id && codDi[x.protocollo_id] ? ` (Prot. ${codDi[x.protocollo_id]})` : ''}`).join('\n'),
    '',
    'Si leggono e si firmano dall\'app, nella pagina Presidenza del gestionale visite: si apre il documento e si preme «Firmo». La firma viene apposta sul documento con la data e l\'ora. Se qualcosa non va, «Rimando» con due righe di motivo lo riporta alla segreteria.',
    '',
    '>>> Apri i documenti da firmare:',
    PAGINA_PRESIDENZA,
    '',
    'Se serve anche l\'originale firmato a mano, resta in Direzione.',
    '',
    'Cordiali saluti.',
  ].join('\n')
  const oggetto = oggettoUfficio(una ? `Un documento da firmare - alla c.a. del Presidente${nome ? ` ${nome}` : ''}`
    : `${righe.length} documenti da firmare - alla c.a. del Presidente${nome ? ` ${nome}` : ''}`)

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
    await sb.from('s_firme_presidente').update({ avviso_il: adesso, avviso_esito: `inviato a ${a}` }).in('id', ids)
    return { inviata: true, a, documenti: ids.length }
  } catch (e) {
    const msg = (e as Error).message
    await sb.from('s_firme_presidente').update({ avviso_esito: `non inviato: ${msg}`.slice(0, 500) }).in('id', ids)
    return { inviata: false, errore: msg }
  }
}
