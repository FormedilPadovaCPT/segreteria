/* ============================================================
   CANTIERI CRITICI — i testi che escono dall'ufficio
   (17/09/2026; testo della lettera validato dall'utente)

   La comunicazione all'impresa per il mancato accesso al cantiere
   sostituisce la stampa Access «Com_ins_CPT_PD_rev.04» (serie
   parallela NNN/aaaaINS, firmata dal Presidente). Da oggi:
   · la firma la SEGRETERIA e prende un protocollo OUT del registro;
   · va per MAIL ORDINARIA; nei casi più critici in più l'Amministrazione
     la inoltra dalla PEC aziendale alla PEC dell'impresa;
   · NON dice più che «la pratica sarà sottoposta agli organi dell'Ente»
     (tolto dall'utente): chiede di ricontattare entro il termine.

   Funzioni pure, senza browser né database: le prova
   test/cantieri-critici-doc.test.mjs.
   ============================================================ */

import { dataIt } from './comune.js';
import { ENTE } from './config.js';

export const TIPO_DOC_ACCESSO_NEGATO = 67;   /* s_tipo_doc */
/* dove stanno già le lettere della serie INS (81 file «…_Prot302-2019-ins»):
   la convenzione era nella cartella, non andava inventata una cartella nuova */
export const CARTELLA_VAULT = '2_AREE/Sopralluoghi/comunicazioni_imprese';

const ENTE_CHI_SIAMO =
  'Formedil Padova, ente paritetico costituito da ANCE Padova e da FeNEAL-UIL, FILCA-CISL e FILLEA-CGIL, ' +
  'cura la prevenzione degli infortuni nei cantieri edili della provincia.';

const persona = (d) => [d.presente_titolo, d.presente_nome, d.presente_cognome].filter(Boolean).join(' ');

/* che cosa è successo, detto all'impresa: solo quello che il tecnico ha scritto */
export function fraseMotivo(d) {
  if (d.motivo === 'nessuno_presente') return 'il cantiere era chiuso e non era presente nessuno';
  if (d.motivo === 'rifiutato') {
    const chi = persona(d);
    if (!chi && !d.presente_qualifica) return "l'accesso non è stato consentito";
    return "l'accesso non è stato consentito da " + (chi || 'una persona presente')
      + (d.presente_qualifica ? `, in qualità di ${d.presente_qualifica}` : '');
  }
  return 'non si sono determinate le condizioni per effettuare la visita';
}

const contatti = (o) => `la Segreteria (tel. ${ENTE.tel} int. 4, ${ENTE.email})`
  + (o.tecnico ? ` o il tecnico di zona (${o.tecnico}${o.tecnicoTel ? `, tel. ${o.tecnicoTel}` : ''})` : '');

export const oggettoLettera = (d) => `Tentativo di visita in cantiere del ${dataIt(d.data_evento)} — ${d.cantiere_breve || d.cantiere_desc}.`;

/* o = { tecnico, tecnicoTel, termine (iso) } */
export function paragrafiAccessoNegato(d, o = {}) {
  return [
    ENTE_CHI_SIAMO,
    `Nell'ambito delle visite programmate, il ${dataIt(d.data_evento)} il nostro tecnico${o.tecnico ? ' ' + o.tecnico : ''} `
      + `non ha potuto effettuare il sopralluogo nel Vs. cantiere di ${d.cantiere_breve || d.cantiere_desc}: ${fraseMotivo(d)}.`,
    `La visita è un'attività di assistenza all'impresa, non un'ispezione. Vi chiediamo di contattare ${contatti(o)} `
      + `entro il ${dataIt(o.termine)} per concordarla.`,
    'Distinti saluti.',
  ];
}

/* prec = { sigla, data_prot } del protocollo della comunicazione (o del sollecito) precedente */
export function paragrafiSollecito(d, prec, o = {}) {
  return [
    `Facendo seguito alla nostra comunicazione Prot. ${prec.sigla} del ${dataIt(prec.data_prot)}, relativa al tentativo di visita `
      + `del ${dataIt(d.data_evento)} nel Vs. cantiere di ${d.cantiere_breve || d.cantiere_desc}, non ci risultano a oggi Vostri contatti.`,
    `La visita è un'attività di assistenza all'impresa, non un'ispezione. Vi rinnoviamo l'invito a contattare ${contatti(o)} `
      + `entro il ${dataIt(o.termine)} per concordarla.`,
    'Distinti saluti.',
  ];
}

/* il corpo della mail che accompagna la lettera */
export function corpoMail(d, o = {}, sollecito = false) {
  return `${o.saluto || 'Spett.le Impresa'},

si trasmette in allegato ${sollecito ? 'il sollecito relativo alla' : 'la'} comunicazione relativa al tentativo di visita del ${dataIt(d.data_evento)} nel cantiere di ${d.cantiere_breve || d.cantiere_desc}.

Vi chiediamo di contattarci entro il ${dataIt(o.termine)} per concordare la visita.`;
}

/* la richiesta all'Amministrazione di inoltrare dalla PEC aziendale (casi più critici) */
export function corpoRichiestaPec(d, prot, pec) {
  return `Ciao Patrizia,

ti chiedo di inoltrare dalla PEC aziendale la comunicazione allegata (${prot}), già inviata oggi per mail ordinaria.

Destinatario PEC: ${pec || '(da rilevare: PEC dell\'impresa non presente in anagrafica)'}
Impresa: ${d.impresa_nome}
Oggetto: FORMEDIL Padova -AREA SICUREZZA E SALUTE- ${oggettoLettera(d).replace(/\.$/, '')} ${prot}

Quando è partita fammi avere la ricevuta di consegna, che la metto agli atti.

Grazie.`;
}

/* dal testo libero del cantiere a una forma corta per nomi file */
export function slug(s, max = 40) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'x';
}

/* come i vicini di cartella: aaaa_mm_gg_COMU_<Impresa>_esito-visita-cantiere-<Comune>_Prot… —
   qui «accesso-negato-cantiere-<Comune>», più il n° del caso che lo rende unico.
   Il protocollo nel nome lo aggiunge il caricamento su Drive. */
export const nomeFileLettera = (d, dataIso, sollecito = false, comune = '') =>
  `${dataIso.replace(/-/g, '_')}_COMU_${slug(d.impresa_nome)}_${sollecito ? 'sollecito-' : ''}accesso-negato-cantiere-${comune ? slug(comune, 30) + '-' : ''}n${d.id}.pdf`;

/* ── TAPPA 3: decisioni e segnalazione agli organi di vigilanza ──
   Chi decide (precisato dall'utente, 17/09/2026): se segnalare a SPISAL
   e/o ITL lo decidono la PRESIDENZA e poi la COMMISSIONE SICUREZZA; il
   Direttore conferma. La conferenza di cantiere è sempre una PROPOSTA:
   l'impresa non è obbligata. La Cassa Edile va in copia SOLO sulla
   segnalazione. Il merito di una segnalazione lo scrive il coordinatore:
   l'app mette lo scheletro e si rifiuta di far uscire il segnaposto. */

export const TIPO_DOC_SEGNALAZIONE = 68;        /* s_tipo_doc */
export const TIPO_DOC_CONFERENZA = 58;
export const SEGNAPOSTO_MERITO = '[DA SCRIVERE — a cura del coordinatore: le criticità riscontrate, che cosa è stato segnalato all\'impresa e che cosa non è stato sanato]';

/* a chi va: a = in «A», pc = per conoscenza. `contatti` = s_config.organi_vigilanza_contatti */
export const DESTINAZIONI = {
  spisal_pc_itl: ['SPISAL, e per conoscenza ITL', ['spisal'], ['itl']],
  itl_pc_spisal: ['ITL, e per conoscenza SPISAL', ['itl'], ['spisal']],
  spisal: ['solo SPISAL', ['spisal'], []],
  itl: ['solo ITL', ['itl'], []],
};
export function destinatariSegnalazione(scelta, contatti, conCeiv = true) {
  const [, a, pc] = DESTINAZIONI[scelta] || DESTINAZIONI.spisal_pc_itl;
  const mail = (k) => contatti?.[k]?.a || '';
  return {
    a: a.map(mail).filter(Boolean),
    cc: [...pc.map(mail), conCeiv ? mail('ceiv') : ''].filter(Boolean),
    intestazione: [...a.map((k) => `Spett.le ${contatti?.[k]?.ente || k.toUpperCase()},`),
      ...(pc.length ? ['e.p.c.', ...pc.map((k) => `Spett.le ${contatti?.[k]?.ente || k.toUpperCase()},`)] : [])].join('\n'),
    allaCa: contatti?.[a[0]]?.alla_ca || contatti?.[pc[0]]?.alla_ca || '',
  };
}

export const oggettoSegnalazione = (d) => `Invio Segnalazione criticità cantiere ${d.cantiere_breve || d.cantiere_desc} – Impresa ${d.impresa_nome}`;

/* verbali = [{nr_verbale, data_visita}] scelti fra quelli del cantiere.
   `merito` = il testo scritto dal coordinatore nel gestionale visite
   (s_cantieri_critici.testo_merito): se c'è prende il posto del segnaposto. */
export function scheletroSegnalazione(d, verbali, intestazione, merito = '') {
  const n = verbali.length;
  const elenco = verbali.map((v) => `${v.nr_verbale} del ${dataIt(v.data_visita)}`).join(', ');
  return `${intestazione}
buongiorno,

in allegato trasmetto ${n === 1 ? 'la relazione relativa al sopralluogo effettuato' : `le relazioni relative ai ${n} sopralluoghi effettuati`} nel cantiere di ${d.cantiere_breve || d.cantiere_desc}${elenco ? ` (${n === 1 ? 'verbale' : 'verbali'} ${elenco})` : ''}, impresa ${d.impresa_nome}.

${String(merito || '').trim() || SEGNAPOSTO_MERITO}

Alla luce di quanto sopra, si ritiene opportuno trasmettere formalmente ${n === 1 ? 'la relazione' : 'le relazioni'} per le valutazioni e gli eventuali provvedimenti del caso.

Resto a disposizione per ogni chiarimento.

Distinti saluti.`;
}

export function corpoUlterioreVisita(d, nome, indicazioni) {
  return `Ciao ${nome || ''},

per il cantiere di ${d.cantiere_breve || d.cantiere_desc} (impresa ${d.impresa_nome}), caso n° ${d.id} del ${dataIt(d.data_evento)}, si è deciso di fare un'ulteriore visita.
${indicazioni ? `\n${indicazioni}\n` : ''}
A visita fatta il verbale si aggancia da solo al caso; se l'accesso viene negato di nuovo, segnalalo dal gestionale.`;
}

export function corpoPropostaConferenza(d, o = {}) {
  return `${o.saluto || 'Spett.le Impresa'},

in relazione al Vs. cantiere di ${d.cantiere_breve || d.cantiere_desc}, Formedil Padova Vi propone una conferenza di cantiere: un incontro di informazione sulla sicurezza tenuto da un nostro tecnico direttamente in cantiere, per i Vostri lavoratori, sui rischi delle lavorazioni in corso.

È una proposta: l'adesione è libera. Se siete interessati Vi chiediamo di contattare la Segreteria (tel. ${ENTE.tel} int. 4, ${ENTE.email})${o.termine ? ` entro il ${dataIt(o.termine)}` : ''} per concordare data e argomenti.

Distinti saluti.`;
}

/* il fascicolo per chi decide: Presidenza o Commissione Sicurezza. Interno: niente protocollo. */
export function corpoDemanda(d, eventi, verbali, a) {
  const crono = (eventi || []).filter((e) => e.tipo !== 'stato').map((e) => `- ${dataIt(String(e.created_at).slice(0, 10))} — ${e.testo || e.tipo}`).join('\n');
  const vv = (verbali || []).map((v) => `- ${v.nr_verbale} del ${dataIt(v.data_visita)}${v.ipc ? ` — IPC ${v.ipc}` : ''}${v.segnalazione ? ' — il tecnico propone la segnalazione' : ''}`).join('\n');
  return `${a === 'commissione' ? 'Alla Commissione Sicurezza' : 'Alla Presidenza'},

si sottopone il caso n° ${d.id} del registro dei cantieri critici, per decidere se e come procedere (ulteriori visite, proposta di conferenza di cantiere, segnalazione a SPISAL e/o ITL).

Cantiere: ${d.cantiere_breve || d.cantiere_desc}
Impresa: ${d.impresa_nome}
Origine: ${d.origine === 'proposta_segnalazione' ? 'il tecnico propone nel verbale la segnalazione agli organi di vigilanza' : 'accesso al cantiere negato al tecnico'} — ${dataIt(d.data_evento)}
Tecnico: ${d.tecnico_nome || '—'}
Note del tecnico: ${d.note || '—'}
${vv ? `\nVerbali sul cantiere:\n${vv}\n` : ''}${crono ? `\nChe cosa è stato fatto finora:\n${crono}\n` : ''}
La decisione verrà registrata nel caso; l'eventuale segnalazione agli organi di vigilanza esce con la conferma del Direttore.`;
}

/* la richiesta di conferma al Direttore, col link che apre il caso nell'app
   (il suo ingresso è limitato: vede il caso e può solo confermare o no) */
export function corpoRichiestaConferma(d, eventi, verbali, link) {
  const decisioni = (eventi || []).filter((e) => e.tipo === 'decisione_organo').map((e) => `- ${e.testo}`).join('\n');
  const vv = (verbali || []).map((v) => `- ${v.nr_verbale} del ${dataIt(v.data_visita)}${v.ipc ? ` — IPC ${v.ipc}` : ''}${v.segnalazione ? ' — il tecnico propone la segnalazione' : ''}`).join('\n');
  return `Egr. Direttore,

si chiede la conferma per la segnalazione agli organi di vigilanza (SPISAL e/o ITL) del cantiere di ${d.cantiere_breve || d.cantiere_desc}, impresa ${d.impresa_nome} — caso n° ${d.id} del registro dei cantieri critici.
${decisioni ? `\nDecisione degli organi dell'Ente:\n${decisioni}\n` : '\nIn cronologia non è ancora registrata la decisione di Presidenza / Commissione Sicurezza.\n'}${vv ? `\nVerbali sul cantiere:\n${vv}\n` : ''}
Conferma dall'app (si apre sul caso, con tutta la cronologia):
${link}

In alternativa basta rispondere a questa mail: la conferma verrà registrata dalla segreteria.`;
}
