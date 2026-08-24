/* ============================================================
   Valori di riferimento delle tendine.
   In Access gli stessi concetti erano scritti in più modi
   ("e-mail" / "E-Mail" / "e-smail", "Squizzato Renato" /
   "Squizzato Sig. Renato"): qui si scrive in un modo solo,
   mentre in lettura lo storico resta com'è.
   ============================================================ */

export const UFFICI = [
  'Segreteria Area Sicurezza e Salute',
  'Segreteria',
  'Direzione',
  'Presidenza',
  'Amministrazione',
  'Ufficio Formazione Continua',
  'Consiglio',
];

export const MEZZI = [
  'e-mail',
  'PEC',
  'Consegna a mano',
  'Lettera',
  'Raccomandata',
  'Pony Express',
  'Fax',
  'Altro',
];

/* Normalizza le varianti storiche per i filtri e le statistiche */
export function normalizzaMezzo(v) {
  const s = (v || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('e-m') || s.startsWith('em') || s === 'e-smail' || s === 'mail') return 'e-mail';
  if (s.startsWith('postacert') || s === 'pec') return 'PEC';
  if (s.startsWith('consegn')) return 'Consegna a mano';
  if (s.startsWith('fax')) return 'Fax';
  if (s.startsWith('raccom')) return 'Raccomandata';
  if (s.startsWith('pony')) return 'Pony Express';
  if (s.startsWith('letter')) return 'Lettera';
  return v.trim();
}

export function normalizzaUfficio(v) {
  const s = (v || '').trim();
  if (!s) return '';
  if (/segr.*sicurezza/i.test(s)) return 'Segreteria Area Sicurezza e Salute';
  return s;
}

/* ── Lettere di incarico: i pulsanti della vecchia maschera OUT ── */
export const MODELLI_LETTERA = [
  {
    id: 'incarico_assev_cantieri',
    nome: 'Incarico asseverazione (firma Presidente, con cantieri)',
    tipo_doc: 'Lettera di Incarico',
    cartella: 'CARTELLA - ASSEVERAZIONE - Lettere Di Incarico',
    note: 'Ricordare il n° di protocollo sul foglio t_ASS.',
    campi: ['destinatario', 'impresa', 'cantieri', 'compenso', 'periodo'],
  },
  {
    id: 'incarico_assev_secondo',
    nome: 'Incarico asseverazione, 2° asseveratore',
    tipo_doc: 'Lettera di Incarico',
    cartella: 'CARTELLA - ASSEVERAZIONE - Lettere Di Incarico',
    campi: ['destinatario', 'impresa', 'cantieri', 'compenso', 'periodo'],
  },
  {
    id: 'incarico_assev_lup',
    nome: 'Incarico asseverazione LUP',
    tipo_doc: 'Lettera di Incarico',
    cartella: 'CARTELLA - ASSEVERAZIONE - Lettere Di Incarico',
    campi: ['destinatario', 'impresa', 'compenso', 'periodo'],
  },
  {
    id: 'fine_assev_marchio',
    nome: 'Fine asseverazione — utilizzo del marchio',
    tipo_doc: 'Asseverazione varie',
    cartella: 'CARTELLA - ASSEVERAZIONE - Documenti',
    campi: ['destinatario', 'impresa', 'scadenza'],
  },
  {
    id: 'incarico_docenza',
    nome: 'Incarico di docenza',
    tipo_doc: 'Lettera di Incarico',
    cartella: 'CARTELLA - Lettere Di Incarico DOCENZE',
    campi: ['destinatario', 'corso', 'date', 'ore', 'compenso'],
  },
  {
    id: 'incarico_progetti',
    nome: 'Incarico progetti (firma Presidente)',
    tipo_doc: 'Lettera di Incarico',
    cartella: 'CARTELLA - Contratti Tecnici CPT',
    note: 'Ricordare il n° di protocollo sul foglio t_Soft.',
    campi: ['destinatario', 'progetto', 'compenso', 'periodo'],
  },
  {
    id: 'incarico_generica',
    nome: 'Lettera di incarico generica',
    tipo_doc: 'Lettera di Incarico',
    cartella: '',
    campi: ['destinatario', 'oggetto_incarico', 'compenso', 'periodo'],
  },
];

export const ETICHETTE_CAMPI = {
  destinatario: 'Destinatario (nome e qualifica)',
  impresa: 'Impresa',
  cantieri: 'Cantieri interessati',
  compenso: 'Compenso pattuito',
  periodo: 'Periodo di svolgimento',
  scadenza: 'Scadenza',
  corso: 'Corso',
  date: 'Date delle lezioni',
  ore: 'Ore di docenza',
  progetto: 'Progetto',
  oggetto_incarico: "Oggetto dell'incarico",
};
