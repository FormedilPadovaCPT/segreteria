/* ============================================================
   INDIRIZZI DELLE MAIL DI UN PROTOCOLLO — la parte senza pagina
   e senza database (14/09/2026).

   Chiesto dall'utente: quando si scrive a un'impresa o a una
   persona, gli indirizzi che l'anagrafica conosce si SPUNTANO —
   «A» per i destinatari, «Cc» per la copia — invece di ritrovarseli
   tutti in un campo di testo da correggere a mano; e altre persone
   si aggiungono in copia cercandole. Il dialogo sta in mail.js;
   qui la logica, che si prova con node --test.

   Prima il dialogo cercava le persone del protocollo per la sola
   prima parola del nominativo e ne prendeva solo `email`: con
   «Pagnacco Dr. Andrea» andava, con «Arch. Nicola De Marco»
   cercava il cognome «Nicola».
   ============================================================ */

/* Titoli e pezzi di titolo che restano spezzando sui punti
   («Rag.ra» → «rag» + «ra», «Dott.ssa» → «dott» + «ssa»). */
const TITOLI = new Set([
  'sig', 'sigra', 'sigg', 'rag', 'ragra', 'geom', 'ing', 'arch', 'dott', 'dottssa', 'dssa',
  'avv', 'prof', 'profssa', 'ssa', 'per', 'ind', 'cav', 'uff',
]);

/** Le parole di un nominativo senza titoli, accenti e maiuscole. */
export function paroleNominativo(testo) {
  return String(testo ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !TITOLI.has(w));
}

/** «Arch. Nicola De Marco», «De Marco Arch. Nicola» → «marco nicola» (ordine indifferente). */
export function chiaveNominativo(testo) {
  return paroleNominativo(testo).sort().join(' ');
}

export const EMAIL_VALIDA = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;

/** «a@b.it, c@d.it; e@f.it» → ['a@b.it', 'c@d.it', 'e@f.it'] */
export function dividiIndirizzi(testo) {
  return String(testo ?? '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
}

const chiave = (e) => String(e ?? '').trim().toLowerCase();

/** Il nome per esteso di una riga di `persone`. */
export function nomeDiPersona(p) {
  return [p?.cognome, p?.titolo, p?.nome].filter(Boolean).join(' ').trim();
}

/**
 * Le righe del dialogo: una per indirizzo, con da dove viene e se è già
 * spuntato. `ruolo` vale 'to', 'cc' oppure null (non spuntato).
 *
 * Preselezione, perché la mail di solito va a UNA persona:
 *   - la persona nominata nel protocollo («persona», «alla c.a.»), se il
 *     nominativo corrisponde a UNA sola persona dell'anagrafica: la sua
 *     prima e-mail in «A»;
 *   - altrimenti la e-mail principale dell'impresa in «A»;
 *   - PEC, seconde e-mail e persone dell'impresa restano da spuntare.
 *   - per l'inoltro interno, gli indirizzi dell'ufficio proposti in «A».
 *
 * Il modello del tipo di documento (lookups.js, MODELLI_PROTOCOLLATO) può
 * spostare i ruoli (14/09/2026): con `modello.a = 'gdv'` il gruppo di
 * verifica va in «A» e quello che sarebbe andato in «A» dell'impresa passa
 * in «Cc» (il piano 5.D.4); con `modello.cc = 'gdv'` il gruppo di verifica
 * va in «Cc» (il programma 5.D.3). Senza gruppo di verifica non si sposta
 * niente: meglio l'impresa in «A» che una mail senza destinatari.
 */
export function vociIndirizzi({
  impresa = null,
  nominativi = [],
  personeTrovate = [],
  personeImpresa = [],
  interni = [],
  gruppoVerifica = [],
  incaricati = [],
  modello = {},
} = {}) {
  /* con `modello.a = 'incaricato'` (la lettera di incarico) va in «A» il
     tecnico a cui la lettera è intestata, e il resto torna da spuntare */
  const conEmail = (l) => l.some((g) => EMAIL_VALIDA.test(String(g.email ?? '').trim()));
  const gdvInA = modello.a === 'gdv' && conEmail(gruppoVerifica);
  const incaricatoInA = modello.a === 'incaricato' && conEmail(incaricati);
  const gdvInCc = modello.cc === 'gdv';
  const voci = [];
  const aggiungiGdv = () => {
    for (const g of gruppoVerifica) {
      const ruolo = g.ruolo === 'osservatore' ? 'osservatore' : `verificatore${g.rgv ? ' (RGV)' : ''}`;
      aggiungi(g.email, `${g.nome || ''} — ${ruolo}`.trim(), 'Gruppo di verifica', gdvInA ? 'to' : gdvInCc ? 'cc' : null);
    }
  };
  const aggiungi = (email, etichetta, gruppo, ruolo = null) => {
    const e = String(email ?? '').trim();
    if (!EMAIL_VALIDA.test(e)) return;
    const gia = voci.find((v) => chiave(v.email) === chiave(e));
    if (gia) {
      if (!gia.ruolo && ruolo) gia.ruolo = ruolo;
      return;
    }
    voci.push({ email: e, etichetta, gruppo, ruolo });
  };

  for (const i of interni) aggiungi(i.email, i.nome || '', 'Ufficio', 'to');

  /* la lettera di incarico: il tecnico incaricato in testa, in «A» */
  if (incaricatoInA) {
    for (const t of incaricati) aggiungi(t.email, t.nome ? `${t.nome} — incaricato` : 'incaricato', 'Tecnico incaricato', 'to');
  }

  /* il piano 5.D.4: il gruppo di verifica in testa, in «A» */
  if (gdvInA) aggiungiGdv();

  /* le persone nominate nel protocollo, riconosciute per nome e cognome */
  let personaPreselezionata = false;
  const chiavi = [...new Set(nominativi.map(chiaveNominativo).filter(Boolean))];
  for (const k of chiavi) {
    const corrispondenti = personeTrovate.filter((p) => chiaveNominativo(`${p.nome ?? ''} ${p.cognome ?? ''}`) === k);
    corrispondenti.forEach((p) => {
      const unica = corrispondenti.length === 1;
      [p.email, p.email2, p.email3].forEach((e, n) => {
        const pre = unica && n === 0 && !!String(e ?? '').trim();
        if (pre) personaPreselezionata = true;
        aggiungi(e, nomeDiPersona(p), unica ? 'Persona indicata nel protocollo' : 'Persone con lo stesso nome — scegli quella giusta', pre ? 'to' : null);
      });
    });
  }

  if (impresa) {
    const nome = impresa.impresa_nome || 'impresa';
    const principale = String(impresa.impresa_email_ref ?? '').trim();
    aggiungi(principale, `${nome} — e-mail`, 'Impresa', !personaPreselezionata && principale && !interni.length ? 'to' : null);
    aggiungi(impresa.impresa_email2, `${nome} — seconda e-mail`, 'Impresa');
    aggiungi(impresa.impresa_email3, `${nome} — terza e-mail`, 'Impresa');
    aggiungi(impresa.pec, `${nome} — PEC`, 'Impresa');
  }

  for (const p of personeImpresa) {
    [p.email, p.email2, p.email3].forEach((e) => aggiungi(e, nomeDiPersona(p), 'Altre persone dell\'impresa'));
  }

  if (!gdvInA) aggiungiGdv();
  /* col gruppo di verifica o l'incaricato in «A», il resto va per conoscenza
     se il modello lo dice (il piano: l'impresa in «Cc»), altrimenti torna
     da spuntare */
  if (gdvInA || incaricatoInA) {
    const inA = new Set(['Gruppo di verifica', 'Tecnico incaricato']);
    voci.forEach((v) => { if (!inA.has(v.gruppo) && v.ruolo === 'to') v.ruolo = modello.cc === 'impresa' ? 'cc' : null; });
  }

  return voci;
}

/**
 * Destinatari e copia dalle righe spuntate più i campi liberi. Un indirizzo
 * in «A» non si ripete in «Cc»; maiuscole e spazi non fanno doppioni.
 * Restituisce anche gli indirizzi scritti a mano che non sembrano e-mail.
 */
export function raccogliDestinatari(voci, liberiTo = [], liberiCc = []) {
  const to = [];
  const cc = [];
  const visti = new Set();
  const nonValidi = [];
  const metti = (lista, e) => {
    const k = chiave(e);
    if (!k || visti.has(k)) return;
    visti.add(k);
    lista.push(String(e).trim());
  };
  voci.filter((v) => v.ruolo === 'to').forEach((v) => metti(to, v.email));
  liberiTo.forEach((e) => (EMAIL_VALIDA.test(e) ? metti(to, e) : nonValidi.push(e)));
  voci.filter((v) => v.ruolo === 'cc').forEach((v) => metti(cc, v.email));
  liberiCc.forEach((e) => (EMAIL_VALIDA.test(e) ? metti(cc, e) : nonValidi.push(e)));
  return { to, cc, nonValidi };
}

/** Le note del vault non sono documenti da allegare (né da agganciare). */
export const E_NOTA = (nome) => /\.(md|base|canvas)$/i.test(String(nome ?? ''));
