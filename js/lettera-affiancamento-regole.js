/* ============================================================
   LETTERA DI AFFIANCAMENTO — le regole senza DOM (21/10/2026)

   Il testo è quello dettato dal Direttore nella mail del 20/10/2026
   «Formazione e affiancamenti nuovi tecnici»: le visite del tecnico
   nuovo in affiancamento sono a fini di formazione, si fanno a nome
   dell'ente coi tecnici indicati, e il tecnico è tenuto a sicurezza,
   disposizioni del tecnico a cui è affiancato, privacy e segretezza.
   La lettera serve a dare copertura assicurativa, dire perché è in
   cantiere e disporre su privacy e segretezza; la firma il Direttore
   e poi il tecnico per accettazione.

   ⚠️ L'ente è FORMEDIL PADOVA, mai «la Scuola» (correzione dell'utente
   del 21/10/2026): la mail del Direttore diceva «lettera della Scuola».
   Qui stanno testo, nome del file, cartella e riferimento della firma:
   li provano i test, e la maschera (lettera-affiancamento.js) li usa.
   ============================================================ */

import { dataIt } from './comune.js';

export const ENTE_LETTERA = 'FORMEDIL PADOVA';

/* chi non è un tecnico che va in cantiere: la segreteria (che sta
   in `tecnici` per firmare i verbali) e il tecnico di prova */
const NON_TECNICI = ['cpt@formedilpadova.it', 'cptpd@did.formedilpadova.it'];
export function tecnicoVero(t) {
  return !!t && t.attivo !== false && t.tecnico_id !== 'TEC-PROVA-2026'
    && !NON_TECNICI.includes(String(t.email || '').toLowerCase());
}

/* «Ing. Claudio Simonetto»; senza titolo il solo nome */
export function nominativo(t) {
  return [t?.titolo, t?.tecnico_nome, t?.tecnico_cognome].filter(Boolean).join(' ').trim();
}

/* «Ing. Paolo Balladore, Arch. Nicola De Marco e Franco Caon» */
export function elenco(nomi) {
  const v = (nomi || []).filter(Boolean);
  if (v.length <= 1) return v[0] || '';
  return `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}`;
}

/* il periodo come si legge nella frase */
export function periodo(dal, al) {
  if (dal && al) return `dal ${dataIt(dal)} al ${dataIt(al)}`;
  if (dal) return `a partire dal ${dataIt(dal)}`;
  return '';
}

/* Il testo della lettera: oggetto e paragrafi. Nessun dato inventato:
   periodo e tecnici che affiancano sono quelli scelti nella maschera. */
export function testoLettera({ affiancato, tutori = [], dal = '', al = '' }) {
  if (!nominativo(affiancato)) throw new Error('Manca il tecnico affiancato.');
  /* «del tecnico Ing. …»: col titolo davanti «il Ing.» non si può scrivere */
  const chi = `tecnico ${nominativo(affiancato)}`;
  const nomiTutori = elenco(tutori.map(nominativo));
  const quando = periodo(dal, al);
  if (!tutori.length) throw new Error('Manca almeno un tecnico che affianca.');
  return {
    oggetto: 'Visite in cantiere in affiancamento a fini di formazione',
    paragrafi: [
      `Con la presente ${ENTE_LETTERA} comunica che le visite in cantiere in affiancamento del ${chi}${quando ? ', ' + quando + ',' : ''} sono effettuate a fini di formazione.`,
      `Le visite sono effettuate a nome di ${ENTE_LETTERA} ${tutori.length === 1 ? 'dal tecnico' : 'dai tecnici'} ${nomiTutori}, ${tutori.length === 1 ? 'al quale' : 'ai quali'} il ${chi} è affiancato.`,
      `Il ${chi} è tenuto al rispetto di tutte le normative di sicurezza e delle disposizioni impartite dal tecnico a cui è affiancato, ed è altresì tenuto al rispetto delle norme sulla privacy e sulla segretezza professionale per tutto ciò di cui viene a conoscenza durante le visite.`,
      `La presente lettera evidenzia il motivo della presenza del ${chi} in cantiere, che avviene per conto di ${ENTE_LETTERA} ai fini della copertura assicurativa, e dispone in merito a privacy e segretezza. Va restituita controfirmata per accettazione.`,
    ],
  };
}

/* Il testo intero, per il campo `note` del protocollo (regola del
   02/10/2026: ogni protocollo porta il testo completo del documento) */
export function testoPerProtocollo(t) {
  return [`Oggetto: ${t.oggetto}`, '', ...t.paragrafi, '', 'Il Direttore', '', 'Per accettazione — il tecnico'].join('\n');
}

const pezzo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* aaaa_mm_gg_INC_Formedil-Padova_affiancamento-visite_Cognome-Nome_Prot_26-27_NNNN.pdf */
export function nomeFile(dataIso, t, sigla, firmata = false) {
  const data = String(dataIso || '').slice(0, 10).replace(/-/g, '_');
  return `${data}_INC_Formedil-Padova_affiancamento-visite_${pezzo(t.tecnico_cognome)}-${pezzo(t.tecnico_nome)}${sigla ? '_' + sigla : ''}${firmata ? '_firmata' : ''}.pdf`;
}

/* la cartella della persona in Team_Tecnici: Nome_Cognome, come le sorelle */
export function cartellaTecnico(t) {
  const n = `${t.tecnico_nome || ''} ${t.tecnico_cognome || ''}`.trim().replace(/\s+/g, '_');
  return `2_AREE/Team_Tecnici/${n}`;
}

/* una catena di firme viva per tecnico: rigenerare la lettera ritira
   le righe non ancora firmate e tiene lo stesso numero di protocollo */
export const RIF_PREFISSO = 'affiancamento:';
export function rifAffiancamento(tecnicoId) {
  return `${RIF_PREFISSO}${tecnicoId}`;
}
