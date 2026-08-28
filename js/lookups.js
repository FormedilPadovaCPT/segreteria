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

/* ── Documenti che il timbro non lo vogliono ───────────────
   L'attestato di asseverazione esce già completo: porta il proprio
   protocollo, la validità e la firma, e va all'impresa così com'è.
   Il timbro del registro non aggiungerebbe niente e sporcherebbe un
   documento che ha già tutto (regola dell'utente, 28/08/2026).
   Attenzione: il protocollo lo prende lo stesso — è il timbro sul
   foglio che non ci va, non la registrazione.
   ────────────────────────────────────────────────────────── */
export const TIPI_SENZA_TIMBRO = [/attestato/i];

export function vuoleTimbro(descrizioneTipo) {
  const t = (descrizioneTipo || '').trim();
  if (!t) return true;
  return !TIPI_SENZA_TIMBRO.some((r) => r.test(t));
}

export const PERCHE_NIENTE_TIMBRO =
  'L\'attestato esce già completo di protocollo, validità e firma: il timbro non ci va. '
  + 'Il protocollo lo prende lo stesso.';

/* ── Le lettere di incarico non stanno più qui ─────────────
   Non vivono nel protocollo: vivono nella tabella della pratica
   che le genera — per l'asseverazione la t_ASS, che tiene i suoi
   campi (impresa, tecnico asseveratore, compenso, giorni/uomo,
   periodo, firmatari) e conserva in `Prot_assInc` il numero di
   protocollo in uscita della lettera.
   La lettera quindi si genera di là, e di qua chiede solo il
   numero. Il modello e il disegno della carta intestata restano
   nella storia del repository (fino al commit d27b428, file
   js/lettere.js) per quando si ricostruiranno al posto giusto.
   ────────────────────────────────────────────────────────── */
