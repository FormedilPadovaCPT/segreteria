// Le due mail del portale servizi, portate da Apps Script (v4.6 del 06/09/2026)
// alla funzione portale-richieste il 12/09/2026.
//
// Stessa grafica, scelta dall'utente: la conferma a chi compila (fascia
// arancione, logo in negativo, numero e data di ricevuta, inviti a Telegram e
// all'app servizi) e la scheda pratica per la segreteria (logo, servizio,
// numero grande, tre caselle, pulsanti, campi raggruppati per soggetto).
// Differenze volute rispetto ad Apps Script, tutte dovute alla strada diretta:
//  - il pulsante porta alla PRATICA (#segnalazione-<id>), che esiste gia'
//    quando la mail parte; prima portava alla vista, perche' la pratica
//    nasceva con l'import delle 6:30;
//  - nella segnalazione il campo «notifica» e' il nome di chi segnala, e
//    compare come tale in «Chi segnala» (in Apps Script finiva sotto
//    Cantiere con l'etichetta «Notifica preliminare», che e' del modulo notifica);
//  - nella notifica cantiere (12/09/2026) «rl_» e' il RESPONSABILE DEI LAVORI:
//    Apps Script lo etichettava «Legale rappresentante», lo metteva nella
//    casella in testa e salutava lui nella conferma, che invece va a chi ha
//    compilato. Qui la casella e il saluto sono di chi comunica.
//
// Solo tabelle e stili in linea: e' l'unica cosa che i client di posta rendono
// in modo uniforme. Il logo e' un PNG RGB su GitHub Pages, non incorporato:
// le stringhe lunghe si rompono nel deploy delle edge function (07/09/2026).

export const MITTENTE = 'cptpd@did.formedilpadova.it'
export const NOME_MITTENTE = 'Formedil Padova – Area Sicurezza e Salute'
export const EMAIL_UFFICIO = 'cpt@formedilpadova.it'

const MAIL = {
  LOGO_BIANCO: 'https://formedilpadovacpt.github.io/servizi/img/email/logo_formedil_padova_bianco.png',
  APP_SERVIZI: 'https://formedilpadovacpt.github.io/servizi/',
  APP_SEGRETERIA: 'https://formedilpadovacpt.github.io/segreteria/',
  TELEGRAM: 'https://t.me/+jYCAI6BlfGxhMTE0',
  FONT: "'Barlow',Arial,Helvetica,sans-serif",
  FONT_COND: "'Barlow Condensed','Arial Narrow',Arial,sans-serif",
  ARANCIO: '#E7500F', GRIGIO: '#565C66', VERDE: '#95C22F', INK: '#2c2c2a',
  GRIGIO_TESTO: '#565C66', GRIGIO_CHIARO: '#8a8b8f', RIGA: '#e8e6e0',
}

export const TIPO_LABEL: Record<string, string> = {
  rlst: 'Affidamento RLST', rls: 'Comunicazione RLS', conf: 'Conferenza di Cantiere',
  vis: 'Visita in Cantiere', cons: 'Richiesta Consulenza', att: 'Attestazione DM 132/2024',
  not: 'Notifica Cantiere', seg: 'Segnalazione Cantiere', qst: 'Questionario Sopralluogo',
}

const TITOLO_CONFERMA: Record<string, string> = {
  rlst: 'Richiesta di affidamento RLST ricevuta',
  rls: 'Comunicazione RLS ricevuta',
  conf: 'Richiesta di Conferenza di Cantiere ricevuta',
  vis: 'Richiesta di visita ricevuta',
  cons: 'Richiesta di consulenza ricevuta',
  att: 'Richiesta di Attestazione DM 132/2024 ricevuta',
  not: 'Notifica Cantiere ricevuta',
  seg: 'Segnalazione Cantiere ricevuta',
  qst: 'Questionario ricevuto',
}

/* deep link dell'app segreteria per tipo: #<prefisso>-<id> apre la pratica */
const LINK_PRATICA: Record<string, string> = {
  seg: 'segnalazione', not: 'notifica', cons: 'consulenza', vis: 'visita', conf: 'conferenza', att: 'attestazione',
}
/* le viste che non aprono la singola pratica da link: si apre la vista */
const LINK_VISTA: Record<string, string> = { rlst: 'rlst', rls: 'rls', qst: 'questionari' }

type Dati = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function escHtml(v: unknown): string {
  return s(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(v: unknown): string {
  const t = s(v)
  if (!t) return ''
  const p = t.substring(0, 10).split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : t
}

/* «4 settembre 2026, ore 23:12» nel fuso di Roma */
export function mailDataOra(d = new Date()): string {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const v = (t: string) => parti.find((x) => x.type === t)?.value || ''
  return `${v('day')} ${v('month')} ${v('year')}, ore ${v('hour')}:${v('minute')}`
}

function mailBottone(testo: string, url: string, stile: 'arancio' | 'grigio' | 'bianco'): string {
  const base = `display:inline-block;font-family:${MAIL.FONT};font-weight:600;font-size:14px;` +
    'text-decoration:none;padding:11px 18px;border-radius:4px;'
  const stili = {
    arancio: `background:${MAIL.ARANCIO};color:#ffffff;border:2px solid ${MAIL.ARANCIO};`,
    grigio: `background:${MAIL.GRIGIO};color:#ffffff;border:2px solid ${MAIL.GRIGIO};`,
    bianco: `background:#ffffff;color:${MAIL.ARANCIO};border:2px solid ${MAIL.ARANCIO};`,
  }
  return `<a href="${escHtml(url)}" style="${base}${stili[stile]}">${escHtml(testo)}</a>`
}

function mailDocumento(righeHtml: string, o: { senzaFirma?: boolean; notaFinale?: string } = {}): string {
  const firma = o.senzaFirma ? '' : `
  <tr><td style="padding:26px 32px 0;font-family:${MAIL.FONT};font-size:13px;color:${MAIL.GRIGIO_TESTO};line-height:1.7">
    <p style="margin:0;color:${MAIL.INK};font-weight:600">Formedil Padova – Area Sicurezza e Salute</p>
    <p style="margin:0">Via Basilicata 10 – 35127 Padova &nbsp;·&nbsp; Tel. 049 761168 (int. 4)</p>
    <p style="margin:0"><a href="mailto:cpt@formedilpadova.it" style="color:${MAIL.ARANCIO};text-decoration:none">cpt@formedilpadova.it</a>
      &nbsp;·&nbsp; <a href="https://www.formedilpadova.it" style="color:${MAIL.ARANCIO};text-decoration:none">www.formedilpadova.it</a></p>
  </td></tr>`
  const privacy = o.notaFinale ||
    'Informativa privacy ai sensi del D.Lgs. 196/2003 e GDPR (Reg. UE 2016/679) su ' +
    `<a href="https://www.formedilpadova.it" style="color:${MAIL.ARANCIO};text-decoration:none">www.formedilpadova.it</a>.`
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f0ec;font-family:${MAIL.FONT}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f0ec;padding:28px 12px">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;box-shadow:0 2px 14px rgba(0,0,0,.08)">
  ${righeHtml}
  ${firma}
  <tr><td style="padding:20px 32px 22px">
    <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;color:#9a9a96;border-top:1px solid ${MAIL.RIGA};padding-top:12px;line-height:1.6">${privacy}</p>
  </td></tr>
  <tr><td style="background:${MAIL.GRIGIO};padding:11px 32px;text-align:center">
    <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;color:rgba(255,255,255,.65)">Formedil Padova – Scuola Costruzioni Giuseppe Jappelli · Area Sicurezza e Salute</p>
  </td></tr>
</table></td></tr></table></body></html>`
}

function nominativo(d: Dati, pre: string): string {
  return [d[pre + 'titolo'], d[pre + 'nome'], d[pre + 'cognome']].map(s).filter(Boolean).join(' ')
}

const PAROLA_UTILITA: Record<number, string> = {
  1: 'per niente utile', 2: 'poco utile', 3: 'così così', 4: 'utile', 5: 'molto utile',
}

/* Le tre caselle in testa alla mail interna: cambiano per servizio */
function riassuntoCpt(tipo: string, d: Dati) {
  const c: { t: string; v: string; s?: string }[] = []
  /* il questionario non ha impresa ne' cantiere: la visita a cui si riferisce,
     il giudizio e chi aspetta una telefonata. Dal 18/09/2026 il voto e' uno
     solo — quanto e' stata utile — e le tre scale di prima restano solo sulle
     risposte vecchie */
  if (tipo === 'qst') {
    const v = Number(d.utilita)
    const vecchie = [d.scala_aspettative, d.scala_professionale, d.scala_facilita].map(s).filter(Boolean).join(' · ')
    return [
      {
        t: 'Visita',
        v: s(d.nr_verbale) || s(d.tecnico) || 'non collegata a un verbale',
        s: [s(d.nr_verbale) ? s(d.tecnico) : '', d.data_visita ? 'del ' + fmtDate(d.data_visita) : ''].filter(Boolean).join(' — '),
      },
      Number.isInteger(v) && v >= 1 && v <= 5
        ? { t: 'Utile?', v: `${v} su 5 — ${PAROLA_UTILITA[v]}`, s: s(d.motivi) || s(d.azione_dopo) }
        : { t: 'Voti (1-5)', v: vecchie || 'non indicati', s: vecchie ? 'aspettative · professionalità · facilità' : '' },
      { t: 'Contatto', v: s(d.qst_contatto) || 'non indicato', s: s(d.recapito_contatto) },
    ]
  }
  if (d.piva || d.cf_impresa) {
    c.push({ t: 'P.IVA', v: s(d.piva || d.cf_impresa), s: d.codice_ceiv ? 'CEIV ' + s(d.codice_ceiv) : '' })
  } else {
    c.push({ t: 'Cantiere', v: s(d.comune_cantiere), s: s(d.indirizzo_cantiere) })
  }
  const cantieriAtt = ['c1', 'c2', 'c3', 'c4'].filter((p) => d[p + '_comune'] || d[p + '_indirizzo']).length
  const oggetto = ({
    cons: ['Consulenza', s(d.tipi_consulenza)],
    conf: ['Richiesta', s(d.tipo_richiesta), s(d.comune_cantiere)],
    vis: ['Visita', s(d.vis_tipo_visita), s(d.comune_cantiere)],
    seg: ['Motivo', s(d.motivo), s(d.stato_lavori)],
    not: ['Lavori', d.data_inizio ? 'dal ' + fmtDate(d.data_inizio) : '', d.importo_lavori ? 'importo ' + s(d.importo_lavori) : ''],
    rlst: ['Lavoratori', s(d.num_lavoratori), s(d.ccnl)],
    rls: ['RLS', nominativo(d, 'rls_'), s(d.rls_elezione)],
    att: ['Cantieri proposti', cantieriAtt ? String(cantieriAtt) : '', s(d.cassa_edile_provincia)],
    qst: ['Questionario', 'Valutazione sopralluogo', ''],
  } as Record<string, string[]>)[tipo] || ['Servizio', TIPO_LABEL[tipo] || tipo, '']
  c.push({ t: oggetto[0], v: oggetto[1], s: oggetto[2] })

  if (tipo === 'seg') {
    c.push({ t: 'Chi segnala', v: s(d.notifica) || s(d.email) || 'anonimo', s: s(d.telefono) || s(d.email) })
  } else if (tipo === 'not') {
    c.push({ t: 'Chi comunica', v: nominativo(d, '') || s(d.email), s: s(d.ragione_sociale) || s(d.telefono || d.email) })
  } else if (nominativo(d, 'ref_')) {
    c.push({ t: 'Referente', v: nominativo(d, 'ref_'), s: s(d.ref_cellulare || d.ref_telefono || d.cellulare || d.telefono) })
  } else if (nominativo(d, 'rl_') || nominativo(d, 'lr_')) {
    c.push({ t: 'Legale rappresentante', v: nominativo(d, 'rl_') || nominativo(d, 'lr_'), s: s(d.cellulare || d.telefono) })
  } else if (nominativo(d, '')) {
    c.push({ t: 'Chi comunica', v: nominativo(d, ''), s: s(d.telefono || d.email) })
  } else {
    c.push({ t: 'Chi segnala', v: s(d.email), s: s(d.telefono) })
  }
  return c
}

const ETICHETTE_CAMPI: Record<string, string> = {
  ragione_sociale: 'Ragione sociale', piva: 'P.IVA', cf_impresa: 'CF impresa', codice_ceiv: 'Codice CEIV',
  email: 'E-mail', telefono: 'Telefono', cellulare: 'Cellulare',
  indirizzo_legale: 'Sede legale', comune_legale: 'Comune sede legale',
  indirizzo_amm: 'Sede amministrativa', comune_amm: 'Comune sede amm.', indirizzo_sede: 'Sede',
  indirizzo_impresa: 'Indirizzo', comune_impresa: 'Comune', telefono_impresa: 'Telefono',
  cassa_edile_provincia: 'Cassa Edile (provincia)', ccnl: 'CCNL', num_lavoratori: 'N. lavoratori',
  rspp_nome: 'RSPP', rspp_ruolo: 'Ruolo RSPP',
  tipi_consulenza: 'Tipo di consulenza', tipo_richiesta: 'Tipo di richiesta', vis_tipo_visita: 'Tipo di visita',
  comune_cantiere: 'Comune', indirizzo_cantiere: 'Indirizzo', motivo: 'Motivo', note: 'Note',
  stato_lavori: 'Stato dei lavori', imprese_presenti: 'Imprese presenti', notifica: 'Notifica preliminare',
  data_verbale: 'Data verbale', luogo_riunione: 'Luogo riunione', data_compilazione: 'Data compilazione',
  data_comunicazione: 'Data comunicazione', protocollo: 'Protocollo',
  data_inizio: 'Inizio lavori', data_fine: 'Fine lavori', durata_giorni: 'Durata (giorni)',
  importo_lavori: 'Importo lavori', max_lavoratori: 'Max lavoratori in cantiere',
  num_imprese: 'N. imprese', num_autonomi: 'N. lavoratori autonomi', note_cantiere: 'Note',
  codice_fiscale: 'Codice fiscale', cf: 'Codice fiscale', cf_persona: 'CF persona',
  tipo: 'Tipo', indirizzo: 'Indirizzo', comune: 'Comune', titolo: 'Titolo', nome: 'Nome', cognome: 'Cognome',
  indirizzo_persona: 'Indirizzo persona', comune_persona: 'Comune persona', telefono_persona: 'Telefono persona',
  /* questionario sul sopralluogo */
  tecnico: 'Tecnico', data_visita: 'Data della visita', scopi_visita: 'Scopo della visita',
  nr_verbale: 'Verbale', utilita: 'Quanto è stata utile (1-5)', motivi: 'Motivi indicati',
  azione_dopo: 'Dopo la visita', commento: 'Ha scritto', riferimento_esito: 'Collegamento alla visita',
  scala_aspettative: 'Aspettative soddisfatte (1-5)', qst_ruolo_chiaro: 'Ruolo e obiettivi spiegati',
  scala_professionale: 'Professionalità del tecnico (1-5)', qst_suggerimenti: 'Suggerimenti pratici',
  scala_facilita: 'Suggerimenti facili da applicare (1-5)', qst_nuovi_rischi: 'Nuovi rischi individuati',
  qst_misure: 'Misure adottate dopo la visita', aree_monitorate: 'Aree monitorate',
  scala_serv1: 'Conosce l\'Area Sicurezza e Salute (1-5)', scala_serv2: 'Conosce le visite in cantiere (1-5)',
  scala_serv3: 'Conosce la consulenza (1-5)', scala_serv4: 'Conosce la formazione (1-5)',
  scala_serv5: 'Conosce corsi e seminari (1-5)', suggerimenti_testo: 'Proposte di miglioramento',
  qst_aggiornamenti: 'Vuole ricevere aggiornamenti', qst_contatto: 'Vuole essere contattato', recapito_contatto: 'Recapito',
}
function etichettaCampo(key: string, prefisso: string, tipo: string): string {
  if (tipo === 'seg' && key === 'notifica') return 'Nome e cognome'
  const k = prefisso && key.indexOf(prefisso) === 0 ? key.substring(prefisso.length) : key
  if (ETICHETTE_CAMPI[k]) return ETICHETTE_CAMPI[k]
  const t = k.replace(/_/g, ' ').replace(/\bcf\b/g, 'CF').replace(/\bpiva\b/g, 'P.IVA')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

type Gruppo = { titolo: string; righe: [string, string][]; html?: boolean }

/* Notifica: gli elenchi JSON di figure professionali e imprese, una riga per
   voce (come figureLeggibili/impreseLeggibili di Apps Script). Il testo esce
   da qui NON escapato: lo escapa chi lo mette nella mail. */
function voci(v: unknown): Dati[] {
  try {
    const a = typeof v === 'string' ? JSON.parse(v || '[]') : v
    return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').slice(0, 30) : []
  } catch { return [] }
}
function figureLeggibili(v: unknown): string {
  return voci(v).map((f) => [f.ruolo, [f.titolo, f.nome, f.cognome].map(s).filter(Boolean).join(' '), f.cf, f.email, f.telefono]
    .map(s).filter(Boolean).join(' – ')).filter(Boolean).join('\n')
}
function impreseLeggibili(v: unknown): string {
  return voci(v).map((i) => [i.ruolo, i.ragione_sociale, i.piva ? 'P.IVA ' + s(i.piva) : '', i.cod_cassa ? 'Cassa Edile ' + s(i.cod_cassa) : '',
    [i.indirizzo, i.comune].map(s).filter(Boolean).join(', '), i.email]
    .map(s).filter(Boolean).join(' – ')).filter(Boolean).join('\n')
}

/* Raggruppa i campi compilati per soggetto; cio' che non rientra in
   nessun gruppo finisce in «Richiesta». */
function gruppiCampiCpt(tipo: string, d: Dati): Gruppo[] {
  const ESCLUDI = ['tipo_modulo', 'timestamp', 'pdf_base64', 'pdf_nome',
    'pdf_verbale_base64', 'pdf_verbale_nome', 'pdf_formazione_base64', 'pdf_formazione_nome',
    'seg_photo_base64', 'privacy', 'figure_json', 'imprese_json', 'submission_id', 'foto_url',
    /* doppioni: il portale manda il tipo di visita e le scale dei servizi con due nomi */
    'tipo_visita', 'serv_area_sicurezza', 'serv_visite_cantiere', 'serv_consulenza', 'serv_formazione', 'serv_corsi',
    /* il riferimento firmato del questionario e' la chiave del link: nella mail
       non serve (c'e' il numero del verbale, che e' il dato leggibile) e chi la
       legge non deve avere in mano il modo di compilarne altri per quella visita */
    'riferimento', 'visita_id']
  const usati: Record<string, boolean> = {}
  const dati = Object.entries(d).filter(([k, v]) => v && !ESCLUDI.includes(k))
  const isData = (k: string) => /^data_|_il$|_nato_il$/.test(k)
  const val = (k: string, v: unknown) => (isData(k) ? fmtDate(v) : s(v))

  const CHIAVI_IMPRESA = ['ragione_sociale', 'piva', 'cf_impresa', 'codice_ceiv', 'email', 'telefono', 'cellulare',
    'indirizzo_legale', 'comune_legale', 'indirizzo_amm', 'comune_amm', 'indirizzo_sede', 'ccnl', 'num_lavoratori',
    'indirizzo_impresa', 'comune_impresa', 'telefono_impresa', 'cassa_edile_provincia']
  const CHIAVI_CANTIERE = ['comune_cantiere', 'indirizzo_cantiere', 'data_inizio', 'data_fine', 'durata_giorni',
    'importo_lavori', 'max_lavoratori', 'num_imprese', 'num_autonomi', 'note_cantiere', 'stato_lavori',
    'imprese_presenti', 'notifica', 'motivo']
  const CHIAVI_COMUNICANTE = ['titolo', 'nome', 'cognome', 'codice_fiscale', 'email', 'telefono']

  const definizioni: { titolo: string; chiavi?: string[]; prefisso?: string; nominativo?: string }[] = [
    tipo === 'seg'
      ? { titolo: 'Chi segnala', chiavi: ['notifica', ...CHIAVI_COMUNICANTE], nominativo: '' }
      : tipo === 'not'
        ? { titolo: 'Chi comunica', chiavi: ['data_comunicazione', 'ragione_sociale', ...CHIAVI_COMUNICANTE], nominativo: '' }
        : { titolo: 'Impresa', chiavi: CHIAVI_IMPRESA },
    { titolo: tipo === 'not' ? 'Responsabile dei lavori' : 'Legale rappresentante', prefisso: 'rl_', nominativo: 'rl_' },
    { titolo: 'Legale rappresentante', prefisso: 'lr_', nominativo: 'lr_' },
    { titolo: 'RSPP', prefisso: 'rspp_' },
    { titolo: 'Referente', prefisso: 'ref_', nominativo: 'ref_' },
    { titolo: 'RLS', prefisso: 'rls_', nominativo: 'rls_' },
    { titolo: 'Committente', prefisso: 'committente_', nominativo: 'committente_' },
    { titolo: 'Cantiere', chiavi: CHIAVI_CANTIERE },
    { titolo: 'Cantieri proposti', prefisso: 'c1_' }, { titolo: 'Cantiere 2', prefisso: 'c2_' },
    { titolo: 'Cantiere 3', prefisso: 'c3_' }, { titolo: 'Cantiere 4', prefisso: 'c4_' },
    { titolo: 'Dichiarazioni', prefisso: 'decl_' },
  ]

  const gruppi: Gruppo[] = []
  for (const def of definizioni) {
    const pre = def.prefisso || ''
    const propri = dati.filter(([k]) => !usati[k] && (def.chiavi ? def.chiavi.includes(k) : k.indexOf(pre) === 0))
    if (!propri.length) continue
    const righe: [string, string][] = []
    if (def.nominativo !== undefined) {
      const nome = nominativo(d, def.nominativo)
      if (nome) {
        righe.push(['Nominativo', nome])
        for (const x of ['titolo', 'nome', 'cognome']) usati[def.nominativo + x] = true
      }
    }
    for (const [k, v] of propri) {
      if (usati[k]) continue
      usati[k] = true
      righe.push([etichettaCampo(k, pre, tipo), val(k, v)])
    }
    if (righe.length) gruppi.push({ titolo: def.titolo, righe })
  }
  const resto = dati.filter(([k]) => !usati[k]).map(([k, v]) => [etichettaCampo(k, '', tipo), val(k, v)] as [string, string])
  if (resto.length) gruppi.push({ titolo: 'Richiesta', righe: resto })
  return gruppi
}

/* ── MAIL ALLA SEGRETERIA: scheda pratica ───────────────────────────────── */
export function mailInterna(tipo: string, d: Dati, prog: number,
  o: { praticaId?: number | null; fotoUrls?: string[]; allegati?: [string, string][]; scartati?: string[] } = {}): { oggetto: string; html: string } {
  const label = TIPO_LABEL[tipo] || tipo
  /* per il questionario in testa va la visita, non l'impresa (che non c'e');
     e se il voto e' basso lo si dice subito, perche' e' la riga da leggere per
     prima e un giudizio cosi' invecchia male */
  const qstBasso = tipo === 'qst' && Number(d.utilita) >= 1 && Number(d.utilita) <= 2
  const impresa = (s(d.ragione_sociale) || nominativo(d, '') ||
    (tipo === 'qst'
      ? [qstBasso ? 'Voto basso —' : '', s(d.nr_verbale) ? 'verbale ' + s(d.nr_verbale) : '',
         d.tecnico ? 'sopralluogo di ' + s(d.tecnico) : ''].filter(Boolean).join(' ') || 'Questionario'
      : '') || s(d.comune_cantiere) || 'Nuova richiesta').slice(0, 120)
  const quando = mailDataOra()

  const caselle = riassuntoCpt(tipo, d).map((c, i) => `
      <td style="padding:10px 12px;background:#faf9f6;border:1px solid ${MAIL.RIGA};${i ? 'border-left:none;' : ''}vertical-align:top;width:33%">
        <p style="margin:0;font-family:${MAIL.FONT};font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:${MAIL.GRIGIO_CHIARO};font-weight:600">${escHtml(c.t)}</p>
        <p style="margin:2px 0 0;font-family:${MAIL.FONT};font-size:13px;font-weight:600;color:${MAIL.INK}">${escHtml(c.v || '—')}</p>
        ${c.s ? `<p style="margin:0;font-family:${MAIL.FONT};font-size:12.5px;color:${MAIL.GRIGIO_TESTO}">${escHtml(c.s)}</p>` : ''}
      </td>`).join('')

  const urlApp = MAIL.APP_SEGRETERIA + (o.praticaId && LINK_PRATICA[tipo] ? `#${LINK_PRATICA[tipo]}-${o.praticaId}`
    : LINK_VISTA[tipo] ? `#vista-${LINK_VISTA[tipo]}` : '')
  const bottoni = `<td style="padding-right:8px">${mailBottone('Apri la pratica nell\'app segreteria', urlApp, 'arancio')}</td>` +
    (d.email ? `<td><a href="mailto:${escHtml(d.email)}" style="font-family:${MAIL.FONT};font-size:13px;color:${MAIL.GRIGIO_TESTO}">Rispondi a chi ha compilato</a></td>` : '')

  const gruppi = gruppiCampiCpt(tipo, d)
  /* Notifica cantiere: figure professionali e imprese come elenchi leggibili */
  if (tipo === 'not') {
    const aRighe = (t: string) => escHtml(t).replace(/\n/g, '<br>')
    const fig = figureLeggibili(d.figure_json)
    const imp = impreseLeggibili(d.imprese_json)
    if (fig) gruppi.push({ titolo: 'Figure professionali', righe: [['Elenco', aRighe(fig)]], html: true })
    if (imp) gruppi.push({ titolo: 'Imprese previste in cantiere', righe: [['Elenco', aRighe(imp)]], html: true })
  }
  if (o.fotoUrls && o.fotoUrls.length) {
    gruppi.push({
      titolo: 'Foto', html: true,
      righe: o.fotoUrls.map((u, i) => [`Foto ${i + 1}`, `<a href="${escHtml(u)}" style="color:${MAIL.ARANCIO}">Apri su Drive</a>`]),
    })
  }
  if (o.allegati && o.allegati.length) {
    gruppi.push({
      titolo: 'Allegati', html: true,
      righe: o.allegati.map(([et, u]) => [et, `<a href="${escHtml(u)}" style="color:${MAIL.ARANCIO}">Apri su Drive</a>`]),
    })
  }
  /* foto o PDF lasciati fuori perche' non validi: chi ha compilato crede di
     averli mandati, e la segreteria deve saperlo per chiederli */
  if (o.scartati && o.scartati.length) {
    gruppi.push({ titolo: 'Allegati non accettati', righe: o.scartati.map((t, i) => [`Motivo ${i + 1}`, t]) })
  }

  const sezioni = gruppi.map((g) => `
  <tr><td style="padding:18px 28px 0">
    <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${MAIL.ARANCIO};font-weight:600;border-bottom:2px solid ${MAIL.ARANCIO};padding-bottom:5px">${escHtml(g.titolo)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-family:${MAIL.FONT};font-size:13px;line-height:1.5">
      ${g.righe.map(([k, v], i) => `<tr${i < g.righe.length - 1 ? ' style="border-bottom:1px solid #f0efe9"' : ''}>` +
        `<td style="padding:6px 10px 6px 0;color:${MAIL.GRIGIO_CHIARO};width:170px;vertical-align:top">${escHtml(k)}</td>` +
        `<td style="padding:6px 0;color:${MAIL.INK}">${g.html ? v : escHtml(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}
    </table>
  </td></tr>`).join('')

  const righe = `
  <tr><td style="background:${MAIL.GRIGIO};padding:16px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${MAIL.LOGO_BIANCO}" width="170" alt="Formedil Padova" style="display:block;border:0"></td>
      <td align="right" style="font-family:${MAIL.FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.7);font-weight:600">Portale servizi · diretto</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${MAIL.ARANCIO};padding:16px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top">
        <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.85);font-weight:600">${escHtml(label)}</p>
        <p style="margin:2px 0 0;font-family:${MAIL.FONT};font-size:22px;font-weight:600;color:#ffffff;line-height:1.2">${escHtml(impresa)}</p>
      </td>
      <td align="right" style="vertical-align:top;white-space:nowrap;padding-left:16px">
        <p style="margin:0;font-family:${MAIL.FONT_COND};font-size:34px;font-weight:700;color:#ffffff;line-height:1">n. ${prog}</p>
        <p style="margin:0;font-family:${MAIL.FONT};font-size:12px;color:rgba(255,255,255,.85)">${escHtml(quando)}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:18px 28px 0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>${caselle}</tr></table>
  </td></tr>
  <tr><td style="padding:16px 28px 0">
    <table cellpadding="0" cellspacing="0"><tr>${bottoni}</tr></table>
  </td></tr>
  ${sezioni}`

  return {
    oggetto: `[${label} #${prog}] ${impresa}`,
    html: mailDocumento(righe, {
      senzaFirma: true,
      notaFinale: 'Inviato automaticamente dal Portale Formedil Padova. Rispondendo a questa mail si scrive a chi ha compilato il modulo. ' +
        'La richiesta è arrivata dalla cassetta del portale direttamente al database: la pratica è già nell\'app segreteria (il riepilogo PDF lo genera l\'app al protocollo).',
    }),
  }
}

/* ── CONFERMA A CHI COMPILA ─────────────────────────────────────────────── */
export function mailConferma(tipo: string, d: Dati, prog: number): { oggetto: string; html: string } {
  const label = TIPO_LABEL[tipo] || tipo
  const titolo = TITOLO_CONFERMA[tipo] || (label + ' ricevuta')
  const quando = mailDataOra()

  /* ⚠️ TESTO FISSO, senza niente di quel che ha scritto chi compila (revisione
     di sicurezza 13/09/2026). L'indirizzo lo sceglie lui: nome, ragione sociale
     o indirizzo del cantiere ripetuti qui farebbero della conferma un messaggio
     a nome dell'ente con un testo scelto da chiunque — il veicolo perfetto per
     un phishing. Prima il saluto era personale; e' il prezzo della difesa. */
  const nonVoi = `<p style="margin:12px 0 0;font-size:13px;color:${MAIL.GRIGIO_TESTO}">Se non avete inviato voi questa richiesta, ignorate questo messaggio.</p>`
  /* Comunicazione RLS e Notifica Cantiere non sono richieste: «la vostra
     Comunicazione RLS», non «la vostra richiesta Comunicazione RLS»
     (utente, 15/09/2026) */
  const cosa = tipo === 'rls' || tipo === 'not' ? '' : 'richiesta '
  const corpo = tipo === 'seg' ? `
      <p style="margin:0 0 12px">Gentile utente,</p>
      <p style="margin:0 0 12px">grazie per la collaborazione: abbiamo ricevuto la vostra Segnalazione Cantiere il <strong>${escHtml(quando)}</strong>.</p>
      <p style="margin:0">Il nostro ufficio prenderà in carico la pratica nel più breve tempo possibile. Il nome di chi segnala resta riservato e non viene comunicato all'impresa.</p>${nonVoi}`
    : tipo === 'qst' ? `
      <p style="margin:0 0 12px">Gentile utente,</p>
      <p style="margin:0">grazie per il tempo dedicato al questionario, ricevuto il <strong>${escHtml(quando)}</strong>. Le vostre risposte ci aiutano a migliorare il servizio di sopralluogo.</p>${nonVoi}`
    : `
      <p style="margin:0 0 12px">Gentile utente,</p>
      <p style="margin:0 0 12px">abbiamo ricevuto la vostra ${cosa}<strong>${escHtml(label)}</strong> il <strong>${escHtml(quando)}</strong>.</p>
      <p style="margin:0">Il nostro ufficio prenderà in carico la pratica e vi contatterà a breve. Per qualsiasi comunicazione citate il numero di ricevuta.</p>${nonVoi}`

  const righe = `
  <tr><td style="background:${MAIL.ARANCIO};padding:24px 32px 22px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${MAIL.LOGO_BIANCO}" width="230" alt="Formedil Padova – Scuola Costruzioni Giuseppe Jappelli" style="display:block;border:0"></td>
      <td align="right" style="vertical-align:top">
        <span style="display:inline-block;background:rgba(255,255,255,.18);color:#ffffff;font-family:${MAIL.FONT};font-size:12px;font-weight:600;letter-spacing:.04em;padding:5px 10px;border-radius:3px;white-space:nowrap">Ricevuta n. ${prog}</span>
      </td>
    </tr></table>
    <p style="margin:22px 0 0;font-family:${MAIL.FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.8);font-weight:500">Area Sicurezza e Salute</p>
    <p style="margin:4px 0 0;font-family:${MAIL.FONT};font-size:24px;font-weight:600;color:#ffffff;line-height:1.25">${escHtml(titolo)}</p>
  </td></tr>
  <tr><td style="padding:26px 32px 0;font-family:${MAIL.FONT};font-size:14.5px;color:${MAIL.INK};line-height:1.7">
    ${corpo}
  </td></tr>
  <tr><td style="padding:22px 32px 0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#eaf3de;border-left:4px solid ${MAIL.VERDE};padding:13px 16px;font-family:${MAIL.FONT};font-size:13.5px;color:#3b6d11;line-height:1.6">
        I servizi di Formedil Padova sono <strong>completamente gratuiti</strong> per le imprese iscritte alla CEIV in regola con i versamenti.</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:26px 32px 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${MAIL.RIGA}"><tr>
      <td style="padding:18px 20px;width:50%;border-right:1px solid ${MAIL.RIGA};vertical-align:top">
        <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MAIL.GRIGIO_CHIARO};font-weight:600">Novità e avvisi</p>
        <p style="margin:6px 0 12px;font-family:${MAIL.FONT};font-size:14px;line-height:1.5;color:${MAIL.INK}">Norme, scadenze e campagne dell'Area, in un canale pubblico.</p>
        ${mailBottone('Seguici su Telegram', MAIL.TELEGRAM, 'grigio')}
      </td>
      <td style="padding:18px 20px;width:50%;vertical-align:top">
        <p style="margin:0;font-family:${MAIL.FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${MAIL.GRIGIO_CHIARO};font-weight:600">Altri servizi</p>
        <p style="margin:6px 0 12px;font-family:${MAIL.FONT};font-size:14px;line-height:1.5;color:${MAIL.INK}">Visite, consulenze, RLST, conferenze di cantiere: si chiedono dall'app.</p>
        ${mailBottone('Apri l\'app servizi', MAIL.APP_SERVIZI, 'arancio')}
      </td>
    </tr></table>
  </td></tr>`

  /* «FORMEDIL Padova -AREA SICUREZZA E SALUTE-» davanti lo mette messaggioMime */
  return { oggetto: `${label} – ricevuta n. ${prog}`, html: mailDocumento(righe) }
}

/* ── messaggio MIME per l'API Gmail ─────────────────────────────────────── */
function b64utf8(t: string): string {
  const bytes = new TextEncoder().encode(t)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const parolaIntestazione = (t: string) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${b64utf8(t)}?=`)
/* niente a capo negli indirizzi: e' da li' che passerebbe un'intestazione in piu' */
const indirizzo = (t: string) => {
  const v = String(t || '').trim()
  if (/[\r\n<>,;]/.test(v)) throw new Error('indirizzo e-mail non valido: ' + v.slice(0, 80))
  return v
}

/* ogni oggetto comincia con «FORMEDIL Padova -AREA SICUREZZA E SALUTE-»
   (regola dell'utente, 14/09/2026): la stessa di firma.js, qui per le mail
   del portale */
const OGGETTO_UFFICIO = 'FORMEDIL Padova -AREA SICUREZZA E SALUTE-'
export function oggettoUfficio(oggetto: string): string {
  const resto = String(oggetto ?? '').replace(/[\r\n]+/g, ' ').trim()
    .replace(/^formedil\s+padova\b(\s*[-–—]\s*area\s+sicurezza\s+e\s+salute\b)?\s*[-–—]?\s*/i, '')
  return resto ? `${OGGETTO_UFFICIO} ${resto}` : OGGETTO_UFFICIO
}

export function messaggioMime(m: { a: string; rispondiA?: string; oggetto: string; html: string }): string {
  const righe = [
    `From: ${parolaIntestazione(NOME_MITTENTE)} <${MITTENTE}>`,
    `To: ${indirizzo(m.a)}`,
  ]
  if (m.rispondiA) righe.push(`Reply-To: ${indirizzo(m.rispondiA)}`)
  righe.push(
    `Subject: ${parolaIntestazione(oggettoUfficio(m.oggetto))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64utf8(m.html).replace(/.{76}/g, '$&\r\n'),
  )
  return righe.join('\r\n')
}
