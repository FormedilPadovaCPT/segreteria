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
