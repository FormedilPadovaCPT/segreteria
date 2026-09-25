/* ============================================================
   I DATI CHE SERVONO PER L'ATTESTATO (21/09/2026).

   Chiesto dall'utente: «quando in un corso si inserisce un
   corsista a cui mancano dati in anagrafica che sono
   indispensabili nell'attestato, il programma deve avvisare,
   magari evidenziandolo in rosso, ed eventualmente sarebbe utile
   predisporre una mail con i dati che necessitano, così la
   segreteria può inviarla e completare».

   ⚠️ IL PUNTO È ACCORGERSENE PRIMA, NON DOPO. Oggi un attestato
   si genera lo stesso: `pdfAttestato` stampa «—» dove il dato
   manca, e il nome del file resta senza codice fiscale. Il
   risultato è un certificato incompleto in mano a una persona, e
   se ne accorge lei. Qui si vede al momento dell'iscrizione,
   quando il dato si può ancora chiedere.

   Modulo PURO: niente rete, niente database, niente DOM — così si
   prova con `node --test`. Chi disegna e chi manda la mail sta in
   corsi.js.

   Che cosa finisce davvero sull'attestato (pdfAttestato in
   corsi-doc.js, riquadro «Dati del corsista»):
     · nome e cognome        ← iscritto.nominativo
     · codice fiscale        ← iscritto.cf
     · luogo e data nascita  ← persone.comune_nascita / data_nascita
     · ragione sociale       ← iscritto.impresa_txt  (non sugli
                               attestati di sola PARTECIPAZIONE)
     · in qualità di / ruolo ← iscritto.ruolo / mansione
   ============================================================ */

/* ── che cosa serve, e quanto ──
   `grave: true` = senza quel dato l'attestato esce sbagliato o
   incompleto, e va chiesto. `grave: false` = si può emettere lo
   stesso (esce «—»), ma è meglio averlo. */
export const CAMPI_ATTESTATO = [
  { campo: 'cf', etichetta: 'Codice fiscale', dove: 'iscritto', grave: true,
    perche: 'va sull’attestato e nel nome del file' },
  { campo: 'data_nascita', etichetta: 'Data di nascita', dove: 'persona', grave: true,
    perche: 'va sull’attestato' },
  { campo: 'comune_nascita', etichetta: 'Luogo di nascita', dove: 'persona', grave: true,
    perche: 'va sull’attestato' },
  { campo: 'impresa_txt', etichetta: 'Impresa (ragione sociale)', dove: 'iscritto', grave: 'salvo_partecipazione',
    perche: 'va sull’attestato come ragione sociale' },
  { campo: 'ruolo', etichetta: 'In qualità di', dove: 'iscritto', grave: false,
    perche: 'compare sull’attestato' },
  { campo: 'mansione', etichetta: 'Ruolo aziendale', dove: 'iscritto', grave: false,
    perche: 'compare sull’attestato' },
];

const vuoto = (v) => v == null || String(v).trim() === '';

/* ⚠️ Un attestato di sola PARTECIPAZIONE non stampa la ragione
   sociale (lo dice pdfAttestato): chiederla sarebbe chiedere un
   dato che non serve. */
function grave(campo, corso) {
  if (campo.grave === 'salvo_partecipazione') return (corso?.tipo_attestato || 'frequenza') !== 'partecipazione';
  return campo.grave === true;
}

/* ── che cosa manca a questo iscritto ──
   `persona` è la riga di `persone` agganciata (può mancare: un
   iscritto scritto a mano non ha persona_id, e allora di lui non
   si sa nulla oltre a quello che è stato digitato).

   Tre esiti, e la differenza conta:
     · mancanti      → da chiedere alla persona o all'impresa;
     · daCompletare  → utili, non bloccanti;
     · recuperabili  → ⚠️ il dato C'È in anagrafica ma non è finito
                       sulla riga del corso. Non si chiede a
                       nessuno: si copia. */
export function datiMancantiAttestato(iscritto = {}, persona = null, corso = null) {
  const mancanti = [];
  const daCompletare = [];
  const recuperabili = [];

  for (const c of CAMPI_ATTESTATO) {
    const suIscritto = c.dove === 'iscritto' ? iscritto[c.campo] : undefined;
    const suPersona = persona ? persona[c.campo] : undefined;
    const valore = c.dove === 'iscritto' ? (vuoto(suIscritto) ? undefined : suIscritto) : suPersona;

    if (!vuoto(valore)) continue;
    /* il codice fiscale è l'unico campo che vive in tutti e due i
       posti: se c'è in anagrafica, la riga del corso si completa
       da sé invece di scrivere a qualcuno */
    if (c.dove === 'iscritto' && !vuoto(suPersona)) {
      recuperabili.push({ ...c, valore: String(suPersona).trim() });
      continue;
    }
    (grave(c, corso) ? mancanti : daCompletare).push(c);
  }
  return { mancanti, daCompletare, recuperabili, senzaAnagrafica: !persona && !iscritto.persona_id };
}

/* riassunto da mettere nella riga della tabella */
export function riassuntoMancanti(esito) {
  if (!esito.mancanti.length) return '';
  return esito.mancanti.map((c) => c.etichetta.toLowerCase()).join(', ');
}

/* ── A CHI SI SCRIVE: all'impresa o alla persona ──
   (21/09/2026, precisato dall'utente: «deve essere possibile sia
   un'opzione che l'altra, perché non sempre son persone della
   stessa impresa oppure sono liberi professionisti»).

   ⚠️ Non è la stessa mail scritta a due indirizzi diversi: cambia
   chi è il soggetto. All'impresa si dice «i partecipanti che avete
   iscritto»; a un libero professionista quella frase non vuol dire
   niente, e gli si chiedono i SUOI dati. Il modo lo sceglie la
   segreteria, che sa chi ha davanti. */

/* i gruppi: uno per impresa, oppure uno per persona */
export function raggruppaRichieste(righe, modo = 'impresa') {
  const r = righe || [];
  if (modo === 'persona') {
    return r.map((x) => ({ chiave: `p${x.id}`, etichetta: x.nominativo, righe: [x], modo }));
  }
  const g = new Map();
  for (const x of r) {
    /* chi non ha un'impresa fa gruppo a sé anche in modo «impresa»:
       metterli tutti insieme sotto «senza impresa» scriverebbe a uno
       dei destinatari l'elenco dei dati di persone che non conosce */
    const k = x.impresa_id || x.impresa_txt || `__solo_${x.id}`;
    if (!g.has(k)) g.set(k, { chiave: String(k), etichetta: x.impresa_txt || x.nominativo, righe: [], modo });
    g.get(k).righe.push(x);
  }
  return [...g.values()];
}

/* ── il testo ──
   ⚠️ Non si chiede il dato «per l'anagrafica»: si dice a che cosa
   serve, perché chi risponde capisca perché vale la pena. */
export function testoRichiestaDati({ corso, righe, modo = 'impresa', mittente = 'La Segreteria' } = {}) {
  const r = righe || [];
  const una = r.length === 1;
  const titolo = corso?.titolo ? `\u00ab${corso.titolo}\u00bb` : 'il corso';
  const aPersona = modo === 'persona';

  const elenco = aPersona
    ? (r[0] ? [...r[0].mancanti, ...(r[0].daCompletare || [])] : []).map((c) => `- ${c.etichetta}`).join('\n')
    : r.map((x) => {
      const che = [...x.mancanti, ...(x.daCompletare || [])].map((c) => c.etichetta).join(', ');
      return `- ${x.nominativo}: ${che || 'dati da confermare'}`;
    }).join('\n');

  const quanti = r[0] ? r[0].mancanti.length + (r[0].daCompletare || []).length : 0;
  const apertura = aPersona
    ? [
      r[0]?.nominativo ? `Gentile ${r[0].nominativo},` : 'Buongiorno,',
      '',
      `per poter rilasciare il suo attestato di ${titolo} ${quanti === 1 ? 'ci manca questo dato' : 'ci mancano questi dati'}:`,
    ]
    : [
      'Buongiorno,',
      '',
      una
        ? `per poter rilasciare l\u2019attestato di ${titolo} ci manca qualche dato del partecipante che avete iscritto:`
        : `per poter rilasciare gli attestati di ${titolo} ci mancano alcuni dati dei partecipanti che avete iscritto:`,
    ];

  return [
    ...apertura,
    elenco,
    '',
    'Sono i dati che vengono stampati sull\u2019attestato: senza, il certificato uscirebbe incompleto.',
    aPersona
      ? 'Pu\u00f2 rispondere a questa mail indicandoli; li registriamo noi.'
      : 'Potete rispondere a questa mail indicandoli; li registriamo noi.',
    '',
    'Grazie e cordiali saluti.',
    mittente,
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
}

/* ── LA MAIL CHE ACCOMPAGNA GLI ATTESTATI (25/09/2026) ──
   Stesso principio del modo impresa/persona di sopra: all'impresa si dice
   «in allegato gli attestati dei partecipanti che avete iscritto», alla
   persona «in allegato il suo attestato» — non è la stessa mail a un
   indirizzo diverso, cambia il soggetto a cui ci si rivolge. */
export function testoInvioAttestati({ corso, righe, modo = 'impresa', mittente = 'La Segreteria' } = {}) {
  const r = righe || [];
  const una = r.length === 1;
  const titolo = corso?.titolo ? `«${corso.titolo}»` : 'il corso';
  const aPersona = modo === 'persona';

  const corpo = aPersona
    ? [
      r[0]?.nominativo ? `Gentile ${r[0].nominativo},` : 'Buongiorno,',
      '',
      `in allegato il suo attestato di ${titolo}.`,
    ]
    : [
      'Buongiorno,',
      '',
      una
        ? `in allegato l’attestato di ${titolo} del partecipante che avete iscritto:`
        : `in allegato gli attestati di ${titolo} dei partecipanti che avete iscritto:`,
      r.map((x) => `- ${x.nominativo}`).join('\n'),
    ];

  return [...corpo, '', 'Grazie e cordiali saluti.', mittente]
    .filter((x, i, a) => !(x === '' && a[i - 1] === ''))
    .join('\n');
}

/* ── gli indirizzi che l'app conosce ──
   L'ordine cambia col modo, e non è un dettaglio: scrivendo a una
   persona il suo indirizzo viene prima di quello dell'ufficio, e
   viceversa. Quello dell'impresa resta in coda come ripiego —
   dichiarato, non nascosto.
   ⚠️ Non si sceglie per conto della segreteria: si propongono. */
export function destinatariPossibili(righe, modo = 'impresa') {
  const ordine = modo === 'persona'
    ? ['email_iscrizione', 'email_persona', 'email_impresa']
    : ['email_impresa', 'email_iscrizione', 'email_persona'];
  const out = new Map();
  for (const campo of ordine) {
    for (const x of righe || []) {
      const v = String(x[campo] || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || out.has(v)) continue;
      out.set(v, { email: v, chi: x.impresa_txt || x.nominativo, campo });
    }
  }
  return [...out.values()];
}
