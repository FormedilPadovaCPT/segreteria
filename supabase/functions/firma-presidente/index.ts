// Supabase Edge Function – firma-documenti
// IL REGISTRO DELLE FIRME NELL'APP (13/10/2026) — lotto 1 del fascicolo corso
// digitale. Generalizza `firma-presidente` (04/10/2026), che resta pubblicata
// con lo stesso codice finché l'app asseverazione non passa a questo nome.
//
// Chi firma: il Presidente (lettere di incarico), il Direttore, il
// responsabile del progetto formativo (RPF) e i docenti dei corsi — tecnici
// CPT con l'accesso che hanno, o docenti esterni col ruolo «docente». Tutti
// con lo stesso meccanismo: la segreteria conserva nel bucket la fotografia
// esatta del PDF, il firmatario la legge nell'app e preme «Firmo», la firma
// scansionata (se c'è) e il testo «Firmato nell'app il … alle … - Nome» si
// appongono SU QUEL PDF dopo aver ricontrollato l'impronta. È una firma
// elettronica semplice: vale per l'autenticazione, l'immagine è un di più.
//
// Documenti a più firme (scheda formativa: docente poi RPF; verbale di
// verifica: esaminatori poi RPF): una riga per firmatario, in CATENA
// ordinata. La riga 1 nasce `in_attesa`, le altre `in_coda`; quando la N è
// firmata, la N+1 prende come originale il PDF firmato della N e passa
// `in_attesa`: ogni firmatario vede le firme già apposte.
//
//   richiedi   (segreteria)  documenti[]: tipo, rif, titolo, nome_file,
//              file_originale (originali/…), corso_id?, protocollo_id?,
//              destinatario?, firmatari[]: { ruolo, email?, persona_id?,
//              riquadro {pagina,x,y,w,h} }. Senza firmatari e col solo
//              `riquadro`: il Presidente (compatibile con l'asseverazione).
//              Avvisa il primo firmatario: mail + notifica 🔔.
//   avvisa     (segreteria)  rimanda la mail a chi ha documenti in attesa.
//   firma      (firmatario)  firma la riga `id`; promuove la riga seguente.
//   rimanda    (firmatario)  non firma, col motivo; la catena si ferma.
//   ritira     (segreteria)  tutta la catena del documento esce dagli elenchi.
//   autografa  (segreteria)  la riga `id` è stata firmata A MANO: la
//              scansione caricata in autografe/… prende il posto della firma
//              nell'app, con la data; la catena prosegue.
//
// Mittente della mail: cptpd@did.formedilpadova.it (service account),
// Reply-To cpt@formedilpadova.it. Secret: GOOGLE_SERVICE_ACCOUNT_JSON.

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

const BUCKET = 'firme-presidente'          // il nome del bucket resta quello del 04/10
const BUCKET_TECNICI = 'firme-tecnici'
const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const GESTIONALE = 'https://formedilpadovacpt.github.io/gestionale-visite/'
const TIPI = ['incarico_assev', 'incarico_docenza', 'accettazione_incarico', 'scheda_formativa',
  'progetto_formativo', 'registro_giornata', 'registro_corso', 'verbale_verifica', 'documento']
const RUOLI = ['presidente', 'direttore', 'rpf', 'docente']
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/* dove ciascuno trova le sue firme, e come lo si chiama nella mail */
const PAGINA: Record<string, string> = {
  presidente: `${GESTIONALE}?vista=direzione`, direttore: `${GESTIONALE}?vista=direzione`,
  rpf: `${GESTIONALE}?vista=formazione`, docente: `${GESTIONALE}?vista=formazione`,
}
const DOVE: Record<string, string> = {
  presidente: 'pagina Presidenza del gestionale visite', direttore: 'pagina Direzione del gestionale visite',
  rpf: 'pagina Formazione del gestionale visite, sezione «Le mie firme»',
  docente: 'pagina Formazione del gestionale visite, sezione «Le mie firme»',
}

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
const pulito = (s: string) => String(s || '').replace(/[^\w.\-]+/g, '_')

type Riga = Record<string, any>
type Conf = Record<string, string>

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

    const { data: cfg } = await sb.from('s_config').select('chiave, valore').in('chiave', [
      'presidente_email', 'presidente_nome', 'presidente_firma_id',
      'direttore_email', 'direttore_nome', 'direttore_firma_id',
      'responsabile_formativo_email', 'responsabile_formativo_nome', 'responsabile_formativo_firma_id',
    ])
    const conf: Conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))

    /* chi può fare che cosa: l'errore di lettura vale «no» */
    const ruolo = async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await sbUtente.rpc(fn, args)
      return !error && data === true
    }

    if (['richiedi', 'avvisa', 'ritira', 'autografa'].includes(azione)) {
      if (!(await ruolo('is_segreteria'))) return json({ error: 'Le richieste di firma le gestisce la segreteria.' }, 403)
    } else if (!['firma', 'rimanda'].includes(azione)) {
      return json({ error: 'Azione non prevista' }, 400)
    }

    /* ── la segreteria registra uno o più documenti da firmare ── */
    if (azione === 'richiedi') {
      const docs = (Array.isArray(corpo?.documenti) ? corpo.documenti : []).slice(0, 20)
      if (!docs.length) return json({ error: 'Nessun documento indicato' }, 400)
      const fatti: Riga[] = []
      const daAvvisare = new Set<string>()
      for (const d of docs) {
        const tipo = String(d?.tipo || '')
        const rif = String(d?.rif || '').trim()
        const file = String(d?.file_originale || '')
        if (!TIPI.includes(tipo) || !rif || !file.startsWith('originali/') || !String(d?.titolo || '').trim()) {
          throw new Error('Documento incompleto: servono tipo, riferimento, titolo e il PDF caricato.')
        }
        /* i firmatari: l'elenco nuovo, oppure il solo Presidente col riquadro (04/10) */
        const elenco = Array.isArray(d?.firmatari) && d.firmatari.length
          ? d.firmatari : [{ ruolo: 'presidente', riquadro: d?.riquadro }]
        if (elenco.length > 8) throw new Error('Troppe firme per un documento (massimo 8).')
        const firmatari: Riga[] = []
        for (const f of elenco) {
          const rl = String(f?.ruolo || '')
          if (!RUOLI.includes(rl)) throw new Error(`Ruolo del firmatario non previsto: «${rl}».`)
          const r = f?.riquadro || {}
          const rq = { pagina: Number(r.pagina), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }
          if (!Object.values(rq).every((n) => Number.isFinite(n)) || rq.pagina < 0 || rq.w <= 0 || rq.h <= 0) {
            throw new Error(`Non so dove va la firma (${rl}) su «${d.titolo}»: riquadro mancante.`)
          }
          const email = await emailFirmatario(sb, conf, rl, f)
          if (!MAIL_RE.test(email)) throw new Error(`Non trovo l'indirizzo con cui ${descrizioneRuolo(rl)} entra nell'app.`)
          if (firmatari.some((x) => x.email === email)) throw new Error(`${email} compare due volte fra i firmatari.`)
          firmatari.push({ ruolo: rl, email, riquadro: rq })
        }
        /* il PDF dev'esserci davvero: se ne prende l'impronta, che si
           ricontrolla al momento della firma; ogni riquadro sta nel documento */
        const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(file)
        if (eD || !blob) throw new Error(`Non trovo il PDF caricato (${file}).`)
        const byte = new Uint8Array(await blob.arrayBuffer())
        const pdf = await PDFDocument.load(byte)
        for (const f of firmatari) {
          if (f.riquadro.pagina >= pdf.getPageCount()) throw new Error('Il riquadro di una firma cade fuori dal documento.')
        }
        const impronta = await sha256(byte)
        const corsoId = Number.isInteger(Number(d?.corso_id)) && Number(d?.corso_id) > 0 ? Number(d.corso_id) : null
        const protId = Number.isInteger(Number(d?.protocollo_id)) && Number(d?.protocollo_id) > 0 ? Number(d.protocollo_id) : null

        /* una catena viva per documento: se qualcuno ha già firmato non si
           tocca (prima si ritira); le righe non ancora firmate si ritirano e
           si rifanno (lettera rigenerata, firmatari cambiati) */
        const { data: vive, error: eV } = await sb.from('s_firme').select('id, stato, firmatario_email')
          .eq('tipo', tipo).eq('rif', rif).in('stato', ['in_coda', 'in_attesa', 'firmata'])
        if (eV) throw new Error('Non riesco a leggere le richieste esistenti: ' + eV.message)
        if ((vive || []).some((v: Riga) => v.stato === 'firmata')) {
          throw new Error(`«${String(d.titolo).trim()}» ha già una firma apposta: per rifarla, prima si ritira la richiesta.`)
        }
        if ((vive || []).length) {
          const { error } = await sb.from('s_firme')
            .update({ stato: 'ritirata', ritirata_il: new Date().toISOString(), ritirata_da: io })
            .in('id', (vive || []).map((v: Riga) => v.id))
          if (error) throw new Error(error.message)
        }
        const righe = firmatari.map((f, i) => ({
          tipo, rif, titolo: String(d.titolo).trim().slice(0, 300),
          destinatario: d?.destinatario ? String(d.destinatario).slice(0, 200) : null,
          protocollo_id: protId, corso_id: corsoId,
          nome_file: String(d?.nome_file || file.split('/').pop()).slice(0, 250),
          file_originale: file, sha256_originale: impronta, riquadro: f.riquadro,
          firmatario_email: f.email, firmatario_ruolo: f.ruolo, ordine: i + 1,
          stato: i === 0 ? 'in_attesa' : 'in_coda', richiesta_da: io,
        }))
        const { data: ins, error: eS } = await sb.from('s_firme').insert(righe).select('id, rif, ordine, firmatario_email, firmatario_ruolo, stato')
        if (eS) throw new Error('Richiesta non registrata: ' + eS.message)
        fatti.push(...(ins || []))
        daAvvisare.add(firmatari[0].email)
      }
      const avvisi: Riga[] = []
      for (const email of daAvvisare) avvisi.push(await avvisaFirmatario(sb, conf, email))
      /* per chi chiama con un documento solo (le lettere), `avviso` è quello del primo firmatario */
      return json({ ok: true, richieste: fatti, avviso: avvisi[0] || { inviata: false, errore: 'nessuno da avvisare' }, avvisi })
    }

    if (azione === 'avvisa') {
      const solo = String(corpo?.email || '').toLowerCase()
      const { data: att, error } = await sb.from('s_firme').select('firmatario_email').eq('stato', 'in_attesa')
      if (error) return json({ ok: false, avviso: { inviata: false, errore: 'non sono riuscito a leggere l\'elenco: ' + error.message } })
      const email = [...new Set((att || []).map((x: Riga) => String(x.firmatario_email).toLowerCase()))]
        .filter((e) => !solo || e === solo)
      if (!email.length) return json({ ok: true, avviso: { inviata: false, errore: 'niente in attesa di firma' }, avvisi: [] })
      const avvisi: Riga[] = []
      for (const e of email) avvisi.push(await avvisaFirmatario(sb, conf, e))
      return json({ ok: true, avviso: avvisi[0], avvisi })
    }

    const id = Number(corpo?.id)
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Documento non indicato' }, 400)
    const { data: r, error: eR } = await sb.from('s_firme').select('*').eq('id', id).maybeSingle()
    if (eR) throw new Error('Non sono riuscito a leggere la richiesta: ' + eR.message)
    if (!r) return json({ error: 'Documento non trovato' }, 404)

    if (azione === 'ritira') {
      /* tutta la catena di quel documento */
      const { data: cat } = await sb.from('s_firme').select('id, stato').eq('tipo', r.tipo).eq('rif', r.rif)
        .in('stato', ['in_coda', 'in_attesa', 'firmata'])
      if (!(cat || []).length) return json({ ok: true, gia: true })
      const { error } = await sb.from('s_firme')
        .update({ stato: 'ritirata', ritirata_il: new Date().toISOString(), ritirata_da: io })
        .in('id', (cat || []).map((x: Riga) => x.id))
      if (error) throw new Error(error.message)
      return json({ ok: true, ritirate: (cat || []).length })
    }

    if (r.stato !== 'in_attesa') {
      return json({ error: r.stato === 'firmata' ? 'Questo documento è già firmato.'
        : r.stato === 'in_coda' ? 'Questo documento aspetta prima la firma di chi viene prima nella catena.'
        : 'Questo documento non aspetta più la firma.' }, 409)
    }

    /* ── chi firma dev'essere il firmatario della riga, col ruolo vero ── */
    if (azione === 'firma' || azione === 'rimanda') {
      if (String(r.firmatario_email).toLowerCase() !== io) return json({ error: 'Questo documento non aspetta la tua firma.' }, 403)
      const rl = String(r.firmatario_ruolo)
      const ok = rl === 'presidente' ? await ruolo('is_presidente')
        : rl === 'direttore' ? await ruolo('is_direttore')
        : rl === 'rpf' ? await ruolo('is_rpf')
        : r.corso_id ? await ruolo('is_docente_del_corso', { p_corso: r.corso_id })
        : (await ruolo('is_docente')) || (await ruolo('is_personale'))
      if (!ok) return json({ error: `Per firmare serve l'accesso di ${descrizioneRuolo(rl)}${r.corso_id ? ' di questo corso' : ''}.` }, 403)
    }
    /* il nome del firmatario, per il testo sul PDF e per gli avvisi */
    _nomi.set(String(r.firmatario_email).toLowerCase(),
      await nomeFirmatario(sb, conf, String(r.firmatario_ruolo), String(r.firmatario_email).toLowerCase()))

    if (azione === 'rimanda') {
      const motivo = String(corpo?.motivo || '').trim()
      if (motivo.length < 3) return json({ error: 'Scrivi in due righe perché non lo firmi: torna alla segreteria.' }, 400)
      const { error } = await sb.from('s_firme').update({
        stato: 'rimandata', rimandata_il: new Date().toISOString(), rimandata_motivo: motivo.slice(0, 1000),
      }).eq('id', id).eq('stato', 'in_attesa')
      if (error) throw new Error(error.message)
      /* la catena si ferma: chi veniva dopo non ha più niente da firmare */
      await sb.from('s_firme').update({ stato: 'ritirata', ritirata_il: new Date().toISOString(), ritirata_da: 'catena' })
        .eq('tipo', r.tipo).eq('rif', r.rif).eq('stato', 'in_coda')
      await avvisaSegreteria(sb, 'firma_rimandata', `${nomeBreve(conf, r)} ha rimandato un documento`,
        `«${r.titolo}» non è stato firmato: c'è il motivo nell'app.`, `firma-${id}`)
      return json({ ok: true })
    }

    /* ── firma nell'app, o a mano (autografa) ── */
    const adesso = new Date()
    let firmato: Uint8Array
    let percorso: string
    if (azione === 'autografa') {
      const file = String(corpo?.file || '')
      if (!file.startsWith('autografe/')) throw new Error('Serve la scansione caricata in autografe/.')
      const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(file)
      if (eD || !blob) throw new Error('Non trovo la scansione caricata.')
      firmato = new Uint8Array(await blob.arrayBuffer())
      try { await PDFDocument.load(firmato) } catch { throw new Error('La scansione non è un PDF leggibile.') }
      percorso = file
    } else {
      const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(r.file_originale)
      if (eD || !blob) throw new Error('Non trovo il documento da firmare.')
      const originale = new Uint8Array(await blob.arrayBuffer())
      if ((await sha256(originale)) !== r.sha256_originale) {
        throw new Error('Il documento non è più quello che è stato chiesto di firmare: avvisa la segreteria.')
      }
      const firmaByte = await immagineFirma(sb, conf, r)
      const pdf = await PDFDocument.load(originale)
      const rq = r.riquadro as { pagina: number; x: number; y: number; w: number; h: number }
      const pg = pdf.getPage(rq.pagina)
      if (firmaByte) {
        let img
        try { img = await pdf.embedPng(firmaByte) } catch { img = await pdf.embedJpg(firmaByte) }
        const k = Math.min(rq.w / img.width, rq.h / img.height)
        const w = img.width * k, h = img.height * k
        pg.drawImage(img, { x: rq.x, y: rq.y + (rq.h - h) / 2, width: w, height: h })
      }
      const { data: g, ora } = oraRoma(adesso)
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const nome = nomeBreve(conf, r)
      /* senza immagine il testo sta nel riquadro, non sotto: è lui la firma */
      pg.drawText(`Firmato nell'app il ${g} alle ${ora}${nome ? ` - ${nome}` : ''}`, {
        x: rq.x, y: firmaByte ? rq.y - 7 : rq.y + rq.h / 2 - 3, size: firmaByte ? 6 : 8, font,
        color: firmaByte ? rgb(0.45, 0.47, 0.5) : rgb(0.2, 0.2, 0.2),
      })
      pdf.setModificationDate(adesso)
      firmato = await pdf.save()
      percorso = `firmate/${id}_${pulito(r.nome_file)}`
      const { error: eU } = await sb.storage.from(BUCKET).upload(percorso, firmato, { contentType: 'application/pdf', upsert: true })
      if (eU) throw new Error('Firma apposta ma non salvata: ' + eU.message)
    }
    const impronta = await sha256(firmato)
    const aMano = azione === 'autografa'
    const dataAut = aMano ? String(corpo?.data || adesso.toISOString().slice(0, 10)).slice(0, 10) : null
    const { data: agg, error: eF } = await sb.from('s_firme').update({
      stato: 'firmata', firmata_da: aMano ? `a mano (registrata da ${io})` : io, firmata_il: adesso.toISOString(),
      file_firmato: percorso, sha256_firmato: impronta,
      ...(aMano ? { autografo_il: dataAut, autografo_da: io } : {}),
    }).eq('id', id).eq('stato', 'in_attesa').select('id')
    if (eF) throw new Error(eF.message)
    if (!agg?.length) return json({ error: 'Nel frattempo la richiesta è cambiata: ricarica la pagina.' }, 409)

    /* la catena: la riga seguente prende il PDF firmato come originale */
    const { data: next } = await sb.from('s_firme').select('id, firmatario_email')
      .eq('tipo', r.tipo).eq('rif', r.rif).eq('ordine', Number(r.ordine) + 1).eq('stato', 'in_coda').maybeSingle()
    let seguente: Riga | null = null
    if (next) {
      const { error } = await sb.from('s_firme').update({
        stato: 'in_attesa', file_precedente: percorso, file_originale: percorso, sha256_originale: impronta,
        richiesta_il: adesso.toISOString(),
      }).eq('id', next.id).eq('stato', 'in_coda')
      if (error) console.warn('catena, riga seguente:', error.message)
      else seguente = { id: next.id, avviso: await avvisaFirmatario(sb, conf, String(next.firmatario_email).toLowerCase()) }
    }
    await avvisaSegreteria(sb, 'firma_fatta', aMano ? 'Firma a mano registrata' : `${nomeBreve(conf, r)} ha firmato`,
      `«${r.titolo}»${seguente ? ': passa alla firma seguente.' : ' è firmato: la versione firmata è pronta nell\'app.'}`, `firma-${id}`)
    return json({ ok: true, firmata_il: adesso.toISOString(), file_firmato: percorso, seguente })
  } catch (e) {
    console.error('firma-documenti:', e)
    return json({ error: (e as Error).message }, 400)
  }
})

/* ── chi è il firmatario di un ruolo ─────────────────────────── */
function descrizioneRuolo(rl: string) {
  return rl === 'presidente' ? 'il Presidente' : rl === 'direttore' ? 'il Direttore'
    : rl === 'rpf' ? 'il responsabile del progetto formativo' : 'il docente'
}

/* l'indirizzo con cui il firmatario entra nell'app */
async function emailFirmatario(sb: any, conf: Conf, rl: string, f: Riga): Promise<string> {
  if (rl === 'presidente') return String(conf.presidente_email || '').trim().toLowerCase()
  if (rl === 'direttore') return String(conf.direttore_email || '').trim().toLowerCase()
  if (rl === 'rpf') return String(conf.responsabile_formativo_email || '').trim().toLowerCase()
  /* docente: l'indirizzo dato, oppure la persona → tecnico o accesso docente */
  const dato = String(f?.email || '').trim().toLowerCase()
  if (dato) return dato
  const pid = String(f?.persona_id || '').trim()
  if (!pid) return ''
  const { data: t } = await sb.from('tecnici').select('email').eq('persona_id', pid).eq('attivo', true).limit(1)
  if (t?.[0]?.email) return String(t[0].email).toLowerCase()
  const { data: a } = await sb.from('app_ruoli').select('email').eq('persona_id', pid).eq('stato', 'attivo').limit(1)
  return a?.[0]?.email ? String(a[0].email).toLowerCase() : ''
}

/* il nome che compare sotto la firma e nella mail */
async function nomeFirmatario(sb: any, conf: Conf, rl: string, email: string): Promise<string> {
  if (rl === 'presidente') return String(conf.presidente_nome || '').trim()
  if (rl === 'direttore') return String(conf.direttore_nome || '').trim()
  if (rl === 'rpf') return String(conf.responsabile_formativo_nome || '').trim()
  const { data: t } = await sb.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome').ilike('email', email.replace(/[\\%_]/g, (c: string) => '\\' + c)).limit(1)
  if (t?.[0]) return [t[0].titolo, t[0].tecnico_nome, t[0].tecnico_cognome].filter(Boolean).join(' ').trim()
  const { data: a } = await sb.from('app_ruoli').select('nome').ilike('email', email.replace(/[\\%_]/g, (c: string) => '\\' + c)).limit(1)
  return String(a?.[0]?.nome || '').trim()
}
const _nomi = new Map<string, string>()
function nomeBreve(conf: Conf, r: Riga) {
  const rl = String(r.firmatario_ruolo)
  if (rl === 'presidente') return String(conf.presidente_nome || '').trim()
  if (rl === 'direttore') return String(conf.direttore_nome || '').trim()
  if (rl === 'rpf') return String(conf.responsabile_formativo_nome || '').trim()
  return _nomi.get(String(r.firmatario_email).toLowerCase()) || descrizioneRuolo(rl)
}

/* la firma scansionata del firmatario, se c'è: Drive per le cariche
   (s_config), il bucket firme-tecnici per i tecnici (tecnici.firma_url),
   Drive per un docente esterno (app_ruoli.firma_drive_id). Senza, null:
   vale il solo testo. */
async function immagineFirma(sb: any, conf: Conf, r: Riga): Promise<Uint8Array | null> {
  const rl = String(r.firmatario_ruolo)
  const email = String(r.firmatario_email).toLowerCase()
  _nomi.set(email, await nomeFirmatario(sb, conf, rl, email))
  let driveId = rl === 'presidente' ? conf.presidente_firma_id
    : rl === 'direttore' ? conf.direttore_firma_id
    : rl === 'rpf' ? conf.responsabile_formativo_firma_id : ''
  if (rl === 'docente') {
    const lett = email.replace(/[\\%_]/g, (c: string) => '\\' + c)
    const { data: t } = await sb.from('tecnici').select('firma_url').ilike('email', lett).limit(1)
    const url = String(t?.[0]?.firma_url || '')
    const marker = `/${BUCKET_TECNICI}/`
    if (url.includes(marker)) {
      const path = decodeURIComponent(url.split(marker)[1].split('?')[0])
      const { data: blob, error } = await sb.storage.from(BUCKET_TECNICI).download(path)
      if (!error && blob) return new Uint8Array(await blob.arrayBuffer())
      console.warn('firma del tecnico non letta:', error?.message)
    }
    const { data: a } = await sb.from('app_ruoli').select('firma_drive_id').ilike('email', lett).limit(1)
    driveId = String(a?.[0]?.firma_drive_id || '')
  }
  if (!driveId) return null
  try {
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const tokD = await getToken(sa, SCOPE_DRIVE)
    const rf = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`, {
      headers: { Authorization: `Bearer ${tokD}` },
    })
    if (!rf.ok) throw new Error(`Drive ha risposto ${rf.status}`)
    return new Uint8Array(await rf.arrayBuffer())
  } catch (e) {
    /* la firma vale per l'autenticazione: senza immagine si firma col solo testo, e si dice nel log */
    console.warn('firma scansionata non letta da Drive:', (e as Error).message)
    return null
  }
}

/* la notifica alla segreteria: a ogni accesso di segreteria attivo */
async function avvisaSegreteria(sb: any, evento: string, titolo: string, testo: string, tag: string) {
  try {
    const { data } = await sb.from('app_ruoli').select('email').in('ruolo', ['segreteria', 'admin']).eq('stato', 'attivo')
    for (const x of (data || []) as { email: string }[]) {
      await sb.rpc('push_accoda', { p_email: x.email, p_evento: evento, p_titolo: titolo, p_testo: testo, p_url: './', p_tag: tag })
    }
  } catch (e) { console.warn('avviso segreteria:', (e as Error).message) }
}

/* la mail e la notifica a UN firmatario con TUTTO quello che aspetta la sua
   firma: un elenco solo, così più richieste insieme fanno una mail sola.
   Il testo si legge dal database: è la regola che permette l'invio
   automatico (eccezione 6 del 04/10/2026, estesa a tutti i firmatari). */
async function avvisaFirmatario(sb: any, conf: Conf, a: string) {
  const { data: att, error } = await sb.from('s_firme')
    .select('id, titolo, destinatario, protocollo_id, richiesta_il, firmatario_ruolo, corso_id')
    .eq('stato', 'in_attesa').ilike('firmatario_email', a.replace(/[\\%_]/g, (c: string) => '\\' + c)).order('richiesta_il')
  if (error) return { inviata: false, a, errore: 'non sono riuscito a leggere l\'elenco: ' + error.message }
  const righe = (att || []) as Riga[]
  if (!righe.length) return { inviata: false, a, errore: 'niente in attesa di firma' }
  if (!MAIL_RE.test(a)) return { inviata: false, a, errore: 'indirizzo del firmatario non valido' }
  const rl = String(righe[0].firmatario_ruolo)
  const nome = await nomeFirmatario(sb, conf, rl, a)
  _nomi.set(a, nome)

  const ids = righe.map((x) => x.id)
  const protIds = righe.map((x) => x.protocollo_id).filter(Boolean)
  const { data: pp } = protIds.length ? await sb.from('s_protocollo').select('id, codice').in('id', protIds) : { data: [] }
  const codDi = Object.fromEntries(((pp || []) as Riga[]).map((p) => [p.id, p.codice]))

  try {
    await sb.rpc('push_accoda', {
      p_email: a, p_evento: 'firma_documento',
      p_titolo: righe.length === 1 ? 'Un documento da firmare' : `${righe.length} documenti da firmare`,
      p_testo: `Li trovi nella ${DOVE[rl] || 'pagina Formazione'}: si leggono e si firmano dall'app.`,
      p_url: rl === 'presidente' || rl === 'direttore' ? './?vista=direzione' : './?vista=formazione', p_tag: 'firme-documenti',
    })
  } catch (e) { console.warn('push firmatario:', (e as Error).message) }

  const una = righe.length === 1
  const saluto = rl === 'presidente' ? 'Gentile Presidente,' : rl === 'direttore' ? 'Gentile Direttore,'
    : nome ? `Gentile ${nome},` : 'Gentile docente,'
  const lei = rl === 'presidente' || rl === 'direttore'
  const testo = [
    saluto,
    '',
    una
      ? `c'è un documento che aspetta la ${lei ? 'sua' : 'tua'} firma:`
      : `ci sono ${righe.length} documenti che aspettano la ${lei ? 'sua' : 'tua'} firma:`,
    righe.map((x) => `- ${x.titolo}${x.protocollo_id && codDi[x.protocollo_id] ? ` (Prot. ${codDi[x.protocollo_id]})` : ''}`).join('\n'),
    '',
    `>>>> ✍️ Apri i documenti e firma (da firmare: ${DOVE[rl]}):`,
    PAGINA[rl],
    '',
    'Si apre il documento e si preme «Firmo». La firma viene apposta sul documento con la data e l\'ora. Se qualcosa non va, «Rimando» con due righe di motivo lo riporta alla segreteria.',
    '',
    lei ? 'Se serve anche l\'originale firmato a mano, resta in Direzione.' : 'Se preferisci firmare su carta, dillo alla segreteria: la scansione prende il posto della firma nell\'app.',
    '',
    'Cordiali saluti.',
  ].join('\n')
  const aChi = rl === 'presidente' ? `alla c.a. del Presidente${nome ? ` ${nome}` : ''}`
    : rl === 'direttore' ? `alla c.a. del Direttore${nome ? ` ${nome}` : ''}` : `alla c.a. di ${nome || a}`
  const oggetto = oggettoUfficio(una ? `Un documento da firmare - ${aChi}` : `${righe.length} documenti da firmare - ${aChi}`)

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
    await sb.from('s_firme').update({ avviso_il: adesso, avviso_esito: `inviato a ${a}` }).in('id', ids)
    return { inviata: true, a, documenti: ids.length }
  } catch (e) {
    const msg = (e as Error).message
    await sb.from('s_firme').update({ avviso_esito: `non inviato: ${msg}`.slice(0, 500) }).in('id', ids)
    return { inviata: false, a, errore: msg }
  }
}
