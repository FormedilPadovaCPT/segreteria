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
//              riquadro {pagina,x,y,w,h, altri?: [{pagina,x,y,w,h}]} } —
//              `altri` (28/10/2026): la stessa firma in più punti. Senza firmatari e col solo
//              `riquadro`: il Presidente (compatibile con l'asseverazione).
//              Avvisa il primo firmatario: mail + notifica 🔔 — TRANNE i
//              ruoli «a raccolta» (s_config.firme_avviso_raccolto_ruoli,
//              di norma il Presidente: 14/10/2026, chiesto dall'utente per
//              non disturbarlo a ogni documento). Per loro la richiesta
//              resta nel suo spazio firme e la mail la decide la segreteria.
//   avvisa     (segreteria)  { email? } una mail sola con TUTTO quello che
//              aspetta la firma di quell'indirizzo (il riepilogo). Senza
//              email: a tutti quelli che hanno documenti in attesa, esclusi
//              i ruoli a raccolta, che si avvisano solo per nome.
//   firma      (firmatario)  firma la riga `id`; promuove la riga seguente.
//   rimanda    (firmatario)  non firma, col motivo; la catena si ferma.
//   ho_firma   (firmatario, 23/10/2026)  id = la sua riga: dice se la firma
//              scansionata c'è (ok / manca / illeggibile), per avvisare
//              PRIMA di premere «Firmo». Non scrive niente.
//   BLOCCO (23/10/2026, chiesto dall'utente dopo il documento firmato da un
//   tecnico senza scansione): «firma», «accetta_incarico» e «firma_registro»
//   si rifiutano se la firma scansionata del firmatario non c'è o non si
//   legge. Il testo da solo non basta più; la firma a mano («autografa»)
//   resta com'era. Il controllo sta qui e non solo nel pulsante.
//   ritira     (segreteria)  tutta la catena del documento esce dagli elenchi.
//   accoda     (segreteria, 14/10/2026)  id = l'ULTIMA riga firmata di un
//              documento: si aggiungono firmatari in coda alla catena
//              (firmatari[] come in richiedi). Il primo firma il PDF già
//              firmato. Serve alle lettere di incarico firmate dal
//              Presidente prima che esistesse la firma del tecnico
//              incaricato «per accettazione» (ruolo `incaricato`).
//   autografa  (segreteria)  la riga `id` è stata firmata A MANO: la
//              scansione caricata in autografe/… prende il posto della firma
//              nell'app, con la data; la catena prosegue.
//   accetta_incarico (docente, lotto 5, 14/10/2026)  id = s_corsi_incarichi:
//              il PDF dell'accettazione lo disegna documenti-corso, qui si
//              carica, si registra la riga (firmatario = chi chiama) e si
//              firma subito. Serve la lettera già firmata dal Presidente.
//   firma_registro (docente, lotto 5)  id = s_corsi_giornate: il registro
//              della giornata, stessa strada; i docenti della giornata in
//              catena, chi chiama per primo. Rifiutato finché ci sono firme
//              dal QR da guardare o iscritti senza presenza segnata.
//   ⚠️ Sono le due sole firme che non chiede la segreteria: il docente
//   firma ciò che riguarda solo lui e che il database ha già controllato.
//
// Mittente della mail: cptpd@did.formedilpadova.it (service account),
// Reply-To cpt@formedilpadova.it. Secret: GOOGLE_SERVICE_ACCOUNT_JSON.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { PDFDocument, rgb, StandardFonts, BlendMode } from 'https://esm.sh/pdf-lib@1.17.1'
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
// (21/10/2026) «personale»: chi riceve un documento al personale che chiede la firma
// (pagina Documenti del gestionale, funzione documenti-personale); una copia per persona
const RUOLI = ['presidente', 'direttore', 'rpf', 'docente', 'incaricato', 'personale']
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/* dove ciascuno trova le sue firme, e come lo si chiama nella mail */
const PAGINA: Record<string, string> = {
  presidente: `${GESTIONALE}?vista=direzione`, direttore: `${GESTIONALE}?vista=direzione`,
  rpf: `${GESTIONALE}?vista=formazione`, docente: `${GESTIONALE}?vista=formazione`,
  incaricato: `${GESTIONALE}?vista=formazione`,
  personale: `${GESTIONALE}?vista=documenti`,
}
const DOVE: Record<string, string> = {
  presidente: 'pagina Presidenza del gestionale visite', direttore: 'pagina Direzione del gestionale visite',
  rpf: 'pagina Formazione del gestionale visite, sezione «Le mie firme»',
  docente: 'pagina Formazione del gestionale visite, sezione «Le mie firme»',
  incaricato: 'pagina Formazione del gestionale visite, sezione «Le mie firme»',
  personale: 'pagina Documenti del gestionale visite, riquadro «Documenti da firmare»',
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

/* (28/10/2026) un firmatario può firmare in più punti dello stesso documento:
   la lettera di docenza ha le firme sotto la lettera E sotto l'accordo, e fino
   a oggi la seconda restava vuota. `altri` sono i riquadri in più, stessa forma;
   la firma e la riga «Firmato nell'app…» vanno in tutti. Senza `altri` è come prima. */
type Riquadro = { pagina: number; x: number; y: number; w: number; h: number; altri?: Riquadro[] }
function unRiquadro(r: any): Riquadro | null {
  const q = { pagina: Number(r?.pagina), x: Number(r?.x), y: Number(r?.y), w: Number(r?.w), h: Number(r?.h) }
  return Object.values(q).every((n) => Number.isFinite(n)) && q.pagina >= 0 && q.w > 0 && q.h > 0 ? q : null
}
function leggiRiquadro(r: any): Riquadro | null {
  const q = unRiquadro(r)
  if (!q) return null
  const altri = (Array.isArray(r?.altri) ? r.altri : []).slice(0, 4).map(unRiquadro)
  if (altri.some((a: Riquadro | null) => !a)) return null
  return altri.length ? { ...q, altri: altri as Riquadro[] } : q
}
const tuttiRiquadri = (r: Riquadro) => [r, ...(r.altri || [])]

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
    let azione = String(corpo?.azione || '')

    const { data: cfg } = await sb.from('s_config').select('chiave, valore').in('chiave', [
      'presidente_email', 'presidente_nome', 'presidente_firma_id',
      'direttore_email', 'direttore_nome', 'direttore_firma_id',
      'responsabile_formativo_email', 'responsabile_formativo_nome', 'responsabile_formativo_firma_id',
      'firme_avviso_raccolto_ruoli',
    ])
    const conf: Conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))
    /* (14/10/2026) i ruoli che NON si avvisano a ogni richiesta: si accumula
       e la segreteria manda un riepilogo quando decide. Chiave assente =
       il Presidente; chiave vuota = nessuno (si torna alla mail subito). */
    const raccolti = new Set(String(conf.firme_avviso_raccolto_ruoli ?? 'presidente')
      .split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))
    const aRaccolta = (ruolo: unknown) => raccolti.has(String(ruolo || '').toLowerCase())
    const inRaccolta = (a: string, ruolo: string) => ({
      inviata: false, raccolto: true, a, ruolo,
      motivo: `nessuna mail adesso: il documento aspetta nello spazio firme ${ruolo === 'presidente' ? 'del Presidente' : `(${descrizioneRuolo(ruolo)})`}, e il riepilogo lo manda la segreteria dal cruscotto`,
    })

    /* chi può fare che cosa: l'errore di lettura vale «no» */
    const ruolo = async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await sbUtente.rpc(fn, args)
      return !error && data === true
    }

    if (['richiedi', 'avvisa', 'ritira', 'autografa', 'accoda'].includes(azione)) {
      if (!(await ruolo('is_segreteria'))) return json({ error: 'Le richieste di firma le gestisce la segreteria.' }, 403)
    } else if (!['firma', 'rimanda', 'ho_firma', 'accetta_incarico', 'firma_registro'].includes(azione)) {
      return json({ error: 'Azione non prevista' }, 400)
    }

    /* ── il docente firma da sé: accettazione dell'incarico, registro della giornata (lotto 5) ── */
    if (azione === 'accetta_incarico' || azione === 'firma_registro') {
      const oggetto = Number(corpo?.id)
      if (!Number.isInteger(oggetto) || oggetto <= 0) return json({ error: 'Documento non indicato' }, 400)
      const tipo = azione === 'accetta_incarico' ? 'accettazione_incarico' : 'registro_giornata'
      const rif = azione === 'accetta_incarico' ? `incarico:${oggetto}` : `giornata:${oggetto}`
      /* niente firma scansionata, niente PDF né riga: ci si ferma prima di creare qualcosa */
      const fd = await immagineFirma(sb, conf, 'docente', io)
      if (fd.stato !== 'ok') return json({ error: messaggioFirma(fd, 'docente') }, 409)
      let corsoId = 0
      if (azione === 'accetta_incarico') {
        /* l'incarico si legge col token di chi chiama: la RLS dà al docente solo il suo */
        const { data: inc, error: eI } = await sbUtente.from('s_corsi_incarichi').select('id, corso_id, persona_id, accettato_il').eq('id', oggetto).maybeSingle()
        if (eI) throw new Error('Non riesco a leggere l\'incarico: ' + eI.message)
        if (!inc) return json({ error: 'Incarico non trovato, o non è il tuo.' }, 404)
        if (inc.accettato_il) return json({ error: 'Questo incarico è già accettato.' }, 409)
        const { data: mia } = await sbUtente.rpc('mia_persona_id')
        if (!inc.persona_id || !mia || String(inc.persona_id) !== String(mia)) return json({ error: 'Questo incarico non è il tuo.' }, 403)
        const { data: lett } = await sb.from('s_firme').select('id').eq('tipo', 'incarico_docenza').eq('rif', `docenza:${oggetto}`).eq('stato', 'firmata').limit(1)
        if (!lett?.length) return json({ error: 'La lettera di incarico non è ancora firmata dal Presidente: l\'accettazione viene dopo.' }, 409)
        corsoId = Number(inc.corso_id)
      } else {
        const { data: g, error: eG } = await sbUtente.from('s_corsi_giornate').select('id, corso_id').eq('id', oggetto).maybeSingle()
        if (eG) throw new Error('Non riesco a leggere la giornata: ' + eG.message)
        if (!g) return json({ error: 'Giornata non trovata, o non la puoi vedere.' }, 404)
        corsoId = Number(g.corso_id)
        if (!(await ruolo('is_docente_del_corso', { p_corso: corsoId }))) return json({ error: 'Il registro della giornata lo firma un docente del corso.' }, 403)
        const { data: pronto, error: eP } = await sbUtente.rpc('corso_docente_registro_pronto', { p_giornata: oggetto })
        if (eP) throw new Error('Non riesco a controllare la giornata: ' + eP.message)
        if (!pronto?.ok) return json({ error: `Il registro non si può ancora firmare: ${pronto?.motivo || 'controlla la giornata'}.` }, 409)
      }
      /* una catena viva per documento: se c'è già la mia riga in attesa si firma quella */
      const { data: vive, error: eV } = await sb.from('s_firme').select('id, stato, firmatario_email, ordine')
        .eq('tipo', tipo).eq('rif', rif).in('stato', ['in_coda', 'in_attesa', 'firmata']).order('ordine')
      if (eV) throw new Error('Non riesco a leggere le firme esistenti: ' + eV.message)
      const mia = (vive || []).find((v: Riga) => String(v.firmatario_email).toLowerCase() === io)
      let idDaFirmare: number | null = null
      if (mia) {
        if (mia.stato === 'firmata') return json({ error: 'Hai già firmato questo documento.' }, 409)
        if (mia.stato === 'in_coda') return json({ error: 'Questo registro aspetta prima la firma di un altro docente della giornata.' }, 409)
        idDaFirmare = Number(mia.id)
      } else {
        if ((vive || []).length) return json({ error: 'Questo documento ha già firme in corso di altri firmatari: avvisa la segreteria.' }, 409)
        /* il PDF lo disegna documenti-corso, col token di chi chiama (vale la sua RLS) */
        const rd = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/documenti-corso`, {
          method: 'POST',
          headers: { Authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ azione: tipo, id: oggetto }),
        })
        const dd = await rd.json().catch(() => ({}))
        if (!rd.ok || dd?.error || !dd?.pdf_base64) throw new Error('PDF non generato: ' + (dd?.error || `risposta ${rd.status}`))
        const byte = Uint8Array.from(atob(String(dd.pdf_base64)), (ch: string) => ch.charCodeAt(0))
        const file = `originali/${tipo}_${oggetto}_${Date.now()}_${pulito(String(dd.nome_file || 'documento.pdf'))}`
        const { error: eU } = await sb.storage.from(BUCKET).upload(file, byte, { contentType: 'application/pdf', upsert: true })
        if (eU) throw new Error('PDF non salvato: ' + eU.message)
        const impronta = await sha256(byte)
        const righe: Riga[] = []
        for (const f of (Array.isArray(dd.firmatari) ? dd.firmatari : []) as Riga[]) {
          const email = await emailFirmatario(sb, conf, 'docente', f)
          /* un docente senza accesso all'app non entra nella catena: firma su carta */
          if (!MAIL_RE.test(email) || righe.some((r) => r.firmatario_email === email)) continue
          const rq = leggiRiquadro(f?.riquadro)
          if (!rq) continue
          righe.push({
            tipo, rif, titolo: String(dd.titolo || '').slice(0, 300), corso_id: corsoId,
            nome_file: String(dd.nome_file || '').slice(0, 250), file_originale: file, sha256_originale: impronta,
            riquadro: rq,
            firmatario_email: email, firmatario_ruolo: 'docente', richiesta_da: io,
          })
        }
        if (!righe.some((r) => r.firmatario_email === io)) {
          return json({ error: 'Nel documento non c\'è un riquadro di firma per te: controlla di essere fra i docenti della giornata.' }, 409)
        }
        /* chi chiama firma per primo; gli altri docenti della giornata seguono in catena */
        righe.sort((a, b) => Number(b.firmatario_email === io) - Number(a.firmatario_email === io))
        righe.forEach((r, i) => { r.ordine = i + 1; r.stato = i === 0 ? 'in_attesa' : 'in_coda' })
        const { data: ins, error: eS } = await sb.from('s_firme').insert(righe).select('id, firmatario_email')
        if (eS) throw new Error('Richiesta non registrata: ' + eS.message)
        idDaFirmare = Number(((ins || []) as Riga[]).find((x) => String(x.firmatario_email).toLowerCase() === io)?.id) || null
      }
      if (!idDaFirmare) throw new Error('Riga di firma non trovata.')
      /* da qui in poi è una firma come le altre: la riga è mia, in attesa, col ruolo docente del corso */
      azione = 'firma'
      corpo.id = idDaFirmare
    }

    /* ── la segreteria registra uno o più documenti da firmare ── */
    if (azione === 'richiedi') {
      const docs = (Array.isArray(corpo?.documenti) ? corpo.documenti : []).slice(0, 20)
      if (!docs.length) return json({ error: 'Nessun documento indicato' }, 400)
      const fatti: Riga[] = []
      const daAvvisare = new Set<string>()
      const perRiepilogo = new Map<string, string>()   // email → ruolo, i firmatari a raccolta
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
          const rq = leggiRiquadro(f?.riquadro)
          if (!rq) throw new Error(`Non so dove va la firma (${rl}) su «${d.titolo}»: riquadro mancante.`)
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
          if (tuttiRiquadri(f.riquadro).some((q) => q.pagina >= pdf.getPageCount())) throw new Error('Il riquadro di una firma cade fuori dal documento.')
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
          ...(i === 0 && aRaccolta(f.ruolo) ? { avviso_esito: ESITO_RACCOLTA } : {}),
        }))
        const { data: ins, error: eS } = await sb.from('s_firme').insert(righe).select('id, rif, ordine, firmatario_email, firmatario_ruolo, stato')
        if (eS) throw new Error('Richiesta non registrata: ' + eS.message)
        fatti.push(...(ins || []))
        if (aRaccolta(firmatari[0].ruolo)) perRiepilogo.set(firmatari[0].email, firmatari[0].ruolo)
        else daAvvisare.add(firmatari[0].email)
      }
      const avvisi: Riga[] = []
      for (const email of daAvvisare) avvisi.push(await avvisaFirmatario(sb, conf, email))
      for (const [email, rl] of perRiepilogo) avvisi.push(inRaccolta(email, rl))
      /* per chi chiama con un documento solo (le lettere), `avviso` è quello del primo firmatario */
      return json({ ok: true, richieste: fatti, avviso: avvisi[0] || { inviata: false, errore: 'nessuno da avvisare' }, avvisi })
    }

    if (azione === 'avvisa') {
      const solo = String(corpo?.email || '').trim().toLowerCase()
      const { data: att, error } = await sb.from('s_firme').select('firmatario_email, firmatario_ruolo').eq('stato', 'in_attesa')
      if (error) return json({ ok: false, avviso: { inviata: false, errore: 'non sono riuscito a leggere l\'elenco: ' + error.message } })
      /* senza indirizzo: tutti, ma non i ruoli a raccolta — quelli si avvisano
         solo chiamandoli per nome (il pulsante «Avvisa il Presidente») */
      const email = [...new Set(((att || []) as Riga[])
        .filter((x) => solo ? String(x.firmatario_email).toLowerCase() === solo : !aRaccolta(x.firmatario_ruolo))
        .map((x) => String(x.firmatario_email).toLowerCase()))]
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

    /* ── firmatari in coda a una catena già firmata (14/10/2026) ── */
    if (azione === 'accoda') {
      if (r.stato !== 'firmata' || !r.file_firmato) return json({ error: 'Si accoda solo a un documento già firmato.' }, 409)
      const { data: cat, error: eC } = await sb.from('s_firme').select('id, stato, ordine, firmatario_email')
        .eq('tipo', r.tipo).eq('rif', r.rif).in('stato', ['in_coda', 'in_attesa', 'firmata'])
      if (eC) throw new Error('Non riesco a leggere la catena: ' + eC.message)
      if ((cat || []).some((x: Riga) => x.stato !== 'firmata')) return json({ error: 'Il documento ha ancora una firma in attesa.' }, 409)
      if ((cat || []).some((x: Riga) => Number(x.ordine) > Number(r.ordine))) return json({ error: 'Questa non è l\'ultima firma del documento: ricarica la pagina.' }, 409)
      const elenco = (Array.isArray(corpo?.firmatari) ? corpo.firmatari : []).slice(0, 4)
      if (!elenco.length) return json({ error: 'Nessun firmatario da aggiungere.' }, 400)
      const { data: blob, error: eD } = await sb.storage.from(BUCKET).download(r.file_firmato)
      if (eD || !blob) throw new Error('Non trovo il documento firmato.')
      const byte = new Uint8Array(await blob.arrayBuffer())
      const pdf = await PDFDocument.load(byte)
      const impronta = await sha256(byte)
      const gia = new Set((cat || []).map((x: Riga) => String(x.firmatario_email).toLowerCase()))
      const righe: Riga[] = []
      for (const [i, f] of elenco.entries()) {
        const rl = String(f?.ruolo || '')
        if (!RUOLI.includes(rl)) throw new Error(`Ruolo del firmatario non previsto: «${rl}».`)
        const rq = leggiRiquadro(f?.riquadro)
        if (!rq || tuttiRiquadri(rq).some((q) => q.pagina >= pdf.getPageCount())) {
          throw new Error(`Non so dove va la firma (${rl}) su «${r.titolo}».`)
        }
        const email = await emailFirmatario(sb, conf, rl, f)
        if (!MAIL_RE.test(email)) throw new Error(`Non trovo l'indirizzo con cui ${descrizioneRuolo(rl)} entra nell'app.`)
        if (gia.has(email)) throw new Error(`${email} ha già firmato questo documento.`)
        gia.add(email)
        righe.push({
          tipo: r.tipo, rif: r.rif, titolo: r.titolo, destinatario: r.destinatario, protocollo_id: r.protocollo_id,
          corso_id: r.corso_id, nome_file: r.nome_file, riquadro: rq, firmatario_email: email, firmatario_ruolo: rl,
          ordine: Number(r.ordine) + 1 + i, richiesta_da: io,
          ...(i === 0
            ? { stato: 'in_attesa', file_originale: r.file_firmato, file_precedente: r.file_firmato, sha256_originale: impronta,
                ...(aRaccolta(rl) ? { avviso_esito: ESITO_RACCOLTA } : {}) }
            : { stato: 'in_coda', file_originale: r.file_firmato, sha256_originale: impronta }),
        })
      }
      const { data: ins, error: eI } = await sb.from('s_firme').insert(righe).select('id, ordine, firmatario_email, firmatario_ruolo, stato')
      if (eI) throw new Error('Firmatari non aggiunti: ' + eI.message)
      const primo = righe[0]
      const avviso = aRaccolta(primo.firmatario_ruolo) ? inRaccolta(String(primo.firmatario_email), String(primo.firmatario_ruolo))
        : await avvisaFirmatario(sb, conf, String(primo.firmatario_email))
      return json({ ok: true, richieste: ins || [], avviso, avvisi: [avviso] })
    }

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
    if (azione === 'firma' || azione === 'rimanda' || azione === 'ho_firma') {
      if (String(r.firmatario_email).toLowerCase() !== io) return json({ error: 'Questo documento non aspetta la tua firma.' }, 403)
      const rl = String(r.firmatario_ruolo)
      const ok = rl === 'presidente' ? await ruolo('is_presidente')
        : rl === 'direttore' ? await ruolo('is_direttore')
        : rl === 'rpf' ? await ruolo('is_rpf')
        /* il tecnico incaricato (14/10/2026): basta un accesso del personale, la riga è sua per indirizzo */
        : rl === 'incaricato' ? await ruolo('is_personale')
        /* (21/10/2026) i documenti al personale: come l'incaricato, la riga è sua per indirizzo */
        : rl === 'personale' ? await ruolo('is_personale')
        : r.corso_id ? await ruolo('is_docente_del_corso', { p_corso: r.corso_id })
        : (await ruolo('is_docente')) || (await ruolo('is_personale'))
      if (!ok) return json({ error: `Per firmare serve l'accesso di ${descrizioneRuolo(rl)}${r.corso_id ? ' di questo corso' : ''}.` }, 403)
    }
    /* il nome del firmatario, per il testo sul PDF e per gli avvisi */
    _nomi.set(String(r.firmatario_email).toLowerCase(),
      await nomeFirmatario(sb, conf, String(r.firmatario_ruolo), String(r.firmatario_email).toLowerCase()))

    if (azione === 'ho_firma') {
      const f = await immagineFirma(sb, conf, String(r.firmatario_ruolo), String(r.firmatario_email))
      return json({ ok: true, ha: f.stato === 'ok', stato: f.stato, fonte: f.fonte, messaggio: f.stato === 'ok' ? '' : messaggioFirma(f, String(r.firmatario_ruolo)) })
    }

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
      const fr = await immagineFirma(sb, conf, String(r.firmatario_ruolo), String(r.firmatario_email))
      if (fr.stato !== 'ok' || !fr.byte) return json({ error: messaggioFirma(fr, String(r.firmatario_ruolo)) }, 409)
      const firmaByte = fr.byte
      const pdf = await PDFDocument.load(originale)
      const rq = leggiRiquadro(r.riquadro)
      if (!rq || tuttiRiquadri(rq).some((q) => q.pagina >= pdf.getPageCount())) throw new Error('Non so dove va la firma: riquadro non valido.')
      let img
      try { img = await pdf.embedPng(firmaByte) } catch {
        try { img = await pdf.embedJpg(firmaByte) } catch {
          return json({ error: messaggioFirma({ stato: 'formato', fonte: fr.fonte }, String(r.firmatario_ruolo)) }, 409)
        }
      }
      const { data: g, ora } = oraRoma(adesso)
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const nome = nomeBreve(conf, r)
      for (const q of tuttiRiquadri(rq)) {
        const pg = pdf.getPage(q.pagina)
        const k = Math.min(q.w / img.width, q.h / img.height)
        const w = img.width * k, h = img.height * k
        /* (27/10/2026) «in moltiplicazione»: il bianco della scansione non copre il
           testo, così la firma a misura piena si può appoggiare sulla scritta della
           carica quando sotto lo spazio è poco (documento-firma-regole.js) */
        pg.drawImage(img, { x: q.x, y: q.y + (q.h - h) / 2, width: w, height: h, blendMode: BlendMode.Multiply })
        pg.drawText(`Firmato nell'app il ${g} alle ${ora}${nome ? ` - ${nome}` : ''}`, {
          x: q.x, y: q.y - 7, size: 6, font, color: rgb(0.45, 0.47, 0.5),
        })
      }
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
    const { data: next } = await sb.from('s_firme').select('id, firmatario_email, firmatario_ruolo')
      .eq('tipo', r.tipo).eq('rif', r.rif).eq('ordine', Number(r.ordine) + 1).eq('stato', 'in_coda').maybeSingle()
    let seguente: Riga | null = null
    if (next) {
      const raccolta = aRaccolta(next.firmatario_ruolo)
      const { error } = await sb.from('s_firme').update({
        stato: 'in_attesa', file_precedente: percorso, file_originale: percorso, sha256_originale: impronta,
        richiesta_il: adesso.toISOString(), ...(raccolta ? { avviso_esito: ESITO_RACCOLTA } : {}),
      }).eq('id', next.id).eq('stato', 'in_coda')
      if (error) console.warn('catena, riga seguente:', error.message)
      else {
        const a = String(next.firmatario_email).toLowerCase()
        seguente = { id: next.id, avviso: raccolta ? inRaccolta(a, String(next.firmatario_ruolo)) : await avvisaFirmatario(sb, conf, a) }
      }
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
    : rl === 'rpf' ? 'il responsabile del progetto formativo'
    : rl === 'incaricato' ? 'il tecnico incaricato'
    : rl === 'personale' ? 'chi riceve il documento' : 'il docente'
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

/* la firma scansionata del firmatario: Drive per le cariche (s_config), il
   bucket firme-tecnici per i tecnici (tecnici.firma_url), Drive per un
   docente esterno (app_ruoli.firma_drive_id). Dal 23/10/2026 senza firma
   NON si firma: l'esito dice se manca (`manca`) o se c'è ma non si legge
   (`illeggibile`), perché «non l'hai caricata» e «riprova fra poco» sono
   due messaggi diversi (un errore di lettura non è un'assenza).
   `fonte` serve al messaggio: il tecnico la carica da sé, gli altri la
   fa caricare alla segreteria. */
type EsitoFirma = { stato: 'ok' | 'manca' | 'illeggibile' | 'formato'; byte?: Uint8Array; fonte: 'carica' | 'tecnico' | 'esterno'; dettaglio?: string }
async function immagineFirma(sb: any, conf: Conf, rl: string, emailIn: string): Promise<EsitoFirma> {
  const email = String(emailIn).toLowerCase()
  _nomi.set(email, await nomeFirmatario(sb, conf, rl, email))
  let fonte: EsitoFirma['fonte'] = 'carica'
  let driveId = rl === 'presidente' ? conf.presidente_firma_id
    : rl === 'direttore' ? conf.direttore_firma_id
    : rl === 'rpf' ? conf.responsabile_formativo_firma_id : ''
  let erroreLettura = ''
  if (rl === 'docente' || rl === 'incaricato' || rl === 'personale') {
    fonte = 'esterno'
    const lett = email.replace(/[\\%_]/g, (c: string) => '\\' + c)
    const { data: t, error: eT } = await sb.from('tecnici').select('firma_url').ilike('email', lett).limit(1)
    if (eT) return { stato: 'illeggibile', fonte, dettaglio: eT.message }
    if (t?.length) fonte = 'tecnico'
    const url = String(t?.[0]?.firma_url || '')
    const marker = `/${BUCKET_TECNICI}/`
    if (url.includes(marker)) {
      const path = decodeURIComponent(url.split(marker)[1].split('?')[0])
      const { data: blob, error } = await sb.storage.from(BUCKET_TECNICI).download(path)
      if (!error && blob) return { stato: 'ok', byte: new Uint8Array(await blob.arrayBuffer()), fonte }
      erroreLettura = error?.message || 'file non leggibile'
      console.warn('firma del tecnico non letta:', erroreLettura)
    }
    const { data: a, error: eA } = await sb.from('app_ruoli').select('firma_drive_id').ilike('email', lett).limit(1)
    if (eA) return { stato: 'illeggibile', fonte, dettaglio: eA.message }
    driveId = String(a?.[0]?.firma_drive_id || '')
  }
  if (!driveId) return erroreLettura ? { stato: 'illeggibile', fonte, dettaglio: erroreLettura } : { stato: 'manca', fonte }
  try {
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const tokD = await getToken(sa, SCOPE_DRIVE)
    const rf = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`, {
      headers: { Authorization: `Bearer ${tokD}` },
    })
    if (!rf.ok) throw new Error(`Drive ha risposto ${rf.status}`)
    return { stato: 'ok', byte: new Uint8Array(await rf.arrayBuffer()), fonte }
  } catch (e) {
    console.warn('firma scansionata non letta da Drive:', (e as Error).message)
    return { stato: 'illeggibile', fonte, dettaglio: (e as Error).message }
  }
}

/* il messaggio che il firmatario legge quando non può firmare */
function messaggioFirma(e: Pick<EsitoFirma, 'stato' | 'fonte' | 'dettaglio'>, rl: string): string {
  if (e.stato === 'illeggibile') {
    return `Non sono riuscito a leggere la firma scansionata${e.dettaglio ? ` (${e.dettaglio})` : ''}: riprova fra poco; se resta così avvisa la segreteria.`
  }
  if (e.stato === 'formato') {
    return e.fonte === 'tecnico'
      ? 'La firma scansionata che hai caricato non è un\'immagine leggibile (servono PNG o JPG, il WEBP non va): caricala di nuovo con il pulsante «🖊 Firme» in alto e riprova.'
      : 'La firma scansionata caricata non è un\'immagine leggibile (servono PNG o JPG): avvisa la segreteria, che la ricarica.'
  }
  if (e.fonte === 'tecnico') {
    return 'Non hai caricato la tua firma scansionata, quindi non puoi firmare. Caricala dal gestionale con il pulsante «🖊 Firme» in alto (PNG o JPG) e poi torna qui.'
  }
  if (e.fonte === 'esterno') return 'Non risulta la tua firma scansionata, quindi non puoi firmare. Avvisa la segreteria: la carica e poi puoi firmare.'
  return `Per ${descrizioneRuolo(rl)} non è caricata la firma scansionata, quindi non si può firmare. Avvisa la segreteria: la carica e poi si firma.`
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
const ESITO_RACCOLTA = 'in attesa del riepilogo: lo manda la segreteria'

async function avvisaFirmatario(sb: any, conf: Conf, a: string) {
  const { data: att, error } = await sb.from('s_firme')
    .select('id, titolo, destinatario, protocollo_id, richiesta_il, avviso_il, firmatario_ruolo, corso_id')
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
  /* nel riepilogo si segnano i documenti arrivati dopo l'ultimo avviso,
     solo se ce ne sono anche di già segnalati (altrimenti sono tutti nuovi) */
  const nuovo = (x: Riga) => !x.avviso_il || new Date(x.avviso_il) < new Date(x.richiesta_il)
  const segnaNuovi = righe.some(nuovo) && righe.some((x) => !nuovo(x))
  const saluto = rl === 'presidente' ? 'Gentile Presidente,' : rl === 'direttore' ? 'Gentile Direttore,'
    : nome ? `Gentile ${nome},` : 'Gentile docente,'
  const lei = rl === 'presidente' || rl === 'direttore'
  const testo = [
    saluto,
    '',
    una
      ? `c'è un documento che aspetta la ${lei ? 'sua' : 'tua'} firma${rl === 'incaricato' ? ' per accettazione' : ''}:`
      : `ci sono ${righe.length} documenti che aspettano la ${lei ? 'sua' : 'tua'} firma${rl === 'incaricato' ? ' per accettazione' : ''}:`,
    righe.map((x) => `- ${x.titolo}${x.protocollo_id && codDi[x.protocollo_id] ? ` (Prot. ${codDi[x.protocollo_id]})` : ''}${segnaNuovi && nuovo(x) ? ' [nuovo]' : ''}`).join('\n'),
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
