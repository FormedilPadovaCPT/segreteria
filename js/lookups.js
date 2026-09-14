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

/* ── Rubrica interna, per l'inoltro dei protocollati ───────
   Chi in ufficio riceve normalmente un documento protocollato.
   Gli indirizzi vengono da app_ruoli e dall'anagrafica del
   personale; non e' un organigramma, e' una scorciatoia per non
   riscrivere gli indirizzi a mano ogni volta. */
export const RUBRICA_INTERNA = [
  { nome: 'Pagnacco Dr. Andrea — Direttore', email: 'direzione@formedilpadova.it' },
  { nome: 'De Marco Arch. Nicola — Coordinatore', email: 'nicola.demarco@did.formedilpadova.it' },
  { nome: 'Presidenza', email: 'presidente@formedilpadova.it' },
  { nome: 'Vicepresidenza', email: 'vicepresidente@formedilpadova.it' },
  { nome: 'Amministrazione', email: 'amministrazione@formedilpadova.it' },
  { nome: 'Squizzato Sig. Renato — Segreteria', email: 'cptpd@did.formedilpadova.it' },
];

/* L'indirizzo di chi in ufficio ha in carico il documento: si cerca
   per cognome dentro al campo «Assegnato a» del protocollo. */
export function emailAssegnatario(allaCa) {
  const t = (allaCa || '').toLowerCase();
  if (!t) return null;
  const v = RUBRICA_INTERNA.find((x) => t.includes(x.nome.split(' ')[0].toLowerCase()));
  return v ? v.email : null;
}

/* ── Documenti che il timbro non lo vogliono ───────────────
   L'attestato di asseverazione esce già completo: porta il proprio
   protocollo, la validità e la firma, e va all'impresa così com'è.
   Il timbro del registro non aggiungerebbe niente e sporcherebbe un
   documento che ha già tutto (regola dell'utente, 28/08/2026).
   Attenzione: il protocollo lo prende lo stesso — è il timbro sul
   foglio che non ci va, non la registrazione.
   ────────────────────────────────────────────────────────── */
export const TIPI_SENZA_TIMBRO = [/attestato/i, /attestazione/i];

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

/* ============================================================
   TESTI PROPOSTI PER «INVIA PROTOCOLLATO»

   La maschera propone il testo delle `note` del protocollo. Quando
   sono vuote — ed è il caso normale dei documenti generati dalle app,
   che le note non le compilano — chi manda si trovava un campo bianco
   e scriveva il testo **dentro Outlook**: la mail usciva giusta, ma nel
   registro restava «nessun testo». È successo col preventivo di VILNAI
   (Prot. 2566-out del 09/09/2026), ed è la ragione di questo elenco.

   Si accostano al `tipo_doc_id`. «Cordialmente» lo mette la mail (e non
   lo ripete se è già in fondo al testo): qui sta il corpo.

   DAL 14/09/2026 (chiesto dall'utente) il modello dice anche A CHI va la
   mail di quel tipo di documento e con quale saluto, perché non tutti
   vanno all'impresa:
     - `saluto`   la riga d'apertura, se non è «Gent.le <nome>, buongiorno,».
                  {impresa} diventa il nome dell'impresa del protocollo;
     - `a`, `cc`  'gdv' = il gruppo di verifica della pratica di
                  asseverazione, 'impresa' = impresa e persone del protocollo;
     - `allegati` documenti che partono sempre con quel tipo (su Drive:
                  spostare un file non ne cambia l'id).
   ============================================================ */
export const MODELLI_PROTOCOLLATO = {
  /* 66 — Asseverazione Preventivo / contratto (5.D.2). Testo usato
     davvero nell'invio a VILNAI del 09/09/2026. */
  66: {
    testo: 'con la presente siamo a trasmettere il preventivo relativo alla richiesta di asseverazione, che potete trovare in allegato. In attesa di ricevere copia firmata per accettazione rimaniamo a disposizione per qualsiasi chiarimento o necessità di ulteriori dettagli.',
  },
  /* 51 — Asseverazione Piano di verifica (5.D.4): al gruppo di verifica,
     per conoscenza all'impresa. */
  51: {
    saluto: 'G.d.V.\ne.p.c.\nSpett.le {impresa},',
    testo: 'Trasmetto modulo per il piano di verifica da concordare con l\'Impresa.',
    a: 'gdv',
    cc: 'impresa',
  },
  /* 34 — Asseverazione Programma di verifica (5.D.3): all'impresa, in
     copia al gruppo di verifica, con la norma. */
  34: {
    testo: 'Trasmetto modulo per il programma di verifica e copia UNI 11751-1.',
    a: 'impresa',
    cc: 'gdv',
    allegati: [
      /* la norma protocollata in entrata col Prot. 1224 del 21/10/2019 */
      { nome: '2019-10-21_NORM_UNI-11751-1_asseverazione_Prot_1224.pdf', drive_file_id: '1AMQLhAc8uxE-i4jDkB7L4OxZeIPXyZHo' },
    ],
  },
};

/** Il modello del tipo di documento del protocollo (oggetto vuoto se non c'è). */
export function modelloProtocollato(p) {
  return MODELLI_PROTOCOLLATO[p?.tipo_doc_id] || {};
}

/** Il testo da proporre nella maschera: le note del protocollo, se ci
 *  sono; altrimenti quello standard del tipo di documento. */
export function testoProposto(p) {
  const note = (p?.note || '').trim();
  if (note) return note;
  return modelloProtocollato(p).testo || '';
}

/** Forme giuridiche come si scrivono in una lettera. */
const FORME = {
  srl: 'S.r.l.', srls: 'S.r.l.s.', snc: 'S.n.c.', sas: 'S.a.s.', spa: 'S.p.A.',
  scarl: 'S.c.a r.l.', sc: 'S.c.', coop: 'Coop.',
};

/** «VILNAI S.R.L.» → «Vilnai S.r.l.»: il nome tutto maiuscolo dell'anagrafica
 *  come lo si scrive in un saluto. Se ha già delle minuscole resta com'è. */
export function nomeImpresaLeggibile(nome) {
  const s = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (!s || /[a-zà-ù]/.test(s)) return s;
  return s.split(' ').map((w) => {
    const forma = FORME[w.toLowerCase().replace(/\./g, '')];
    if (forma) return forma;
    return w.toLowerCase().replace(/(^|['\-&/])([a-zà-ù])/g, (_, a, b) => a + b.toUpperCase());
  }).join(' ');
}

/** La riga d'apertura della mail: quella del modello, altrimenti la
 *  solita «Gent.le <nome>, buongiorno,». */
export function salutoProposto(p) {
  const m = modelloProtocollato(p);
  if (m.saluto) return m.saluto.replace('{impresa}', nomeImpresaLeggibile(p?.impresa_nome) || 'Impresa');
  const chi = (p?.persona || p?.alla_ca || p?.impresa_nome || '').trim();
  return `Gent.le ${chi},\nbuongiorno,`;
}
