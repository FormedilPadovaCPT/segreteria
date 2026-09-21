// I dati che servono per l'attestato (21/09/2026).
// Dati INVENTATI: il repository è pubblico.
//
// Quello che questi controlli tengono fermo:
//   · un dato che C'È in anagrafica ma non sulla riga del corso non si
//     chiede a nessuno: si copia (è il caso più frequente, e chiedere
//     all'impresa un codice fiscale che abbiamo già fa una brutta figura);
//   · un attestato di sola PARTECIPAZIONE non stampa la ragione sociale,
//     quindi non la si chiede;
//   · nome e cognome non sono nell'elenco: senza nominativo un iscritto
//     non esiste, lo impedisce già la maschera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  datiMancantiAttestato, riassuntoMancanti, raggruppaRichieste, testoRichiestaDati, destinatariPossibili,
} from '../js/corsi-anagrafica.js';

const CORSO = { titolo: 'Ponteggi — aggiornamento', tipo_attestato: 'frequenza' };
const COMPLETO = {
  nominativo: 'Rossi Mario', cf: 'RSSMRA80A01G224X', persona_id: 'p1',
  impresa_txt: 'EDILE DI PROVA SRL', ruolo: 'Dipendente', mansione: 'Carpentiere',
};
const PERSONA = { cf: 'RSSMRA80A01G224X', data_nascita: '1980-01-01', comune_nascita: 'PADOVA' };

test('un iscritto completo non ha niente da chiedere', () => {
  const e = datiMancantiAttestato(COMPLETO, PERSONA, CORSO);
  assert.deepEqual(e.mancanti, []);
  assert.deepEqual(e.daCompletare, []);
  assert.deepEqual(e.recuperabili, []);
  assert.equal(riassuntoMancanti(e), '');
});

test('senza nascita in anagrafica mancano luogo e data', () => {
  const e = datiMancantiAttestato(COMPLETO, { cf: COMPLETO.cf }, CORSO);
  assert.deepEqual(e.mancanti.map((c) => c.campo).sort(), ['comune_nascita', 'data_nascita']);
  assert.match(riassuntoMancanti(e), /data di nascita/);
});

test('il codice fiscale che c’è in anagrafica si COPIA, non si chiede', () => {
  const e = datiMancantiAttestato({ ...COMPLETO, cf: null }, PERSONA, CORSO);
  assert.deepEqual(e.mancanti, [], 'non va chiesto a nessuno');
  assert.deepEqual(e.recuperabili.map((c) => [c.campo, c.valore]), [['cf', 'RSSMRA80A01G224X']]);
});

test('il codice fiscale che non c’è da nessuna parte si chiede', () => {
  const e = datiMancantiAttestato({ ...COMPLETO, cf: '   ' }, { data_nascita: '1980-01-01', comune_nascita: 'PADOVA' }, CORSO);
  assert.deepEqual(e.mancanti.map((c) => c.campo), ['cf']);
  assert.deepEqual(e.recuperabili, []);
});

test('la ragione sociale serve sugli attestati di frequenza, non su quelli di partecipazione', () => {
  const senzaImpresa = { ...COMPLETO, impresa_txt: '' };
  assert.deepEqual(
    datiMancantiAttestato(senzaImpresa, PERSONA, CORSO).mancanti.map((c) => c.campo), ['impresa_txt']);
  const e = datiMancantiAttestato(senzaImpresa, PERSONA, { ...CORSO, tipo_attestato: 'partecipazione' });
  assert.deepEqual(e.mancanti, [], 'su un attestato di partecipazione la ragione sociale non si stampa');
  assert.deepEqual(e.daCompletare.map((c) => c.campo), ['impresa_txt']);
});

test('ruolo e mansione non bloccano: sono «da completare»', () => {
  const e = datiMancantiAttestato({ ...COMPLETO, ruolo: null, mansione: null }, PERSONA, CORSO);
  assert.deepEqual(e.mancanti, []);
  assert.deepEqual(e.daCompletare.map((c) => c.campo), ['ruolo', 'mansione']);
});

test('un iscritto scritto a mano, senza anagrafica, si riconosce', () => {
  const e = datiMancantiAttestato({ nominativo: 'Bianchi Ada' }, null, CORSO);
  assert.equal(e.senzaAnagrafica, true);
  assert.deepEqual(e.mancanti.map((c) => c.campo).sort(),
    ['cf', 'comune_nascita', 'data_nascita', 'impresa_txt']);
});

test('la mail dice chi e che cosa, e a che cosa serve', () => {
  const t = testoRichiestaDati({
    corso: CORSO,
    righe: [
      { nominativo: 'Rossi Mario', mancanti: [{ etichetta: 'Codice fiscale' }], daCompletare: [] },
      { nominativo: 'Bianchi Ada', mancanti: [{ etichetta: 'Luogo di nascita' }, { etichetta: 'Data di nascita' }], daCompletare: [] },
    ],
  });
  assert.match(t, /Ponteggi — aggiornamento/);
  assert.match(t, /- Rossi Mario: Codice fiscale/);
  assert.match(t, /- Bianchi Ada: Luogo di nascita, Data di nascita/);
  assert.match(t, /stampati sull’attestato/, 'si dice perché servono, non solo che servono');
  assert.ok(!/anagrafica/i.test(t), 'a chi legge «anagrafica» non dice niente');
});

test('con una persona sola la mail parla al singolare', () => {
  const t = testoRichiestaDati({ corso: CORSO, righe: [{ nominativo: 'Rossi Mario', mancanti: [{ etichetta: 'Codice fiscale' }], daCompletare: [] }] });
  assert.match(t, /ci manca qualche dato del partecipante/);
});

test('i destinatari si propongono senza doppioni e senza indirizzi rotti', () => {
  const d = destinatariPossibili([
    { nominativo: 'Rossi Mario', impresa_txt: 'EDILE SRL', email_iscrizione: 'Ufficio@Edile.example', email_impresa: 'ufficio@edile.example' },
    { nominativo: 'Bianchi Ada', impresa_txt: 'EDILE SRL', email_iscrizione: 'non-una-mail', email_persona: 'ada@esempio.example' },
  ]);
  assert.deepEqual(d.map((x) => x.email), ['ufficio@edile.example', 'ada@esempio.example']);
});

/* ── i due modi (21/09/2026, precisato dall'utente) ──
   Non sempre i corsisti sono della stessa impresa, e qualcuno è un libero
   professionista: dev'essere possibile sia una mail all'ufficio che una a
   testa, e non è la stessa mail a un indirizzo diverso — cambia il soggetto. */

const R = [
  { id: 1, nominativo: 'Rossi Mario', impresa_txt: 'EDILE SRL', impresa_id: 'IMP1',
    mancanti: [{ etichetta: 'Codice fiscale' }], daCompletare: [],
    email_impresa: 'ufficio@edile.example', email_iscrizione: 'mario@esempio.example' },
  { id: 2, nominativo: 'Verdi Ugo', impresa_txt: 'EDILE SRL', impresa_id: 'IMP1',
    mancanti: [{ etichetta: 'Luogo di nascita' }], daCompletare: [],
    email_impresa: 'ufficio@edile.example' },
  { id: 3, nominativo: 'Bianchi Ada', impresa_txt: '', impresa_id: '',
    mancanti: [{ etichetta: 'Luogo di nascita' }, { etichetta: 'Data di nascita' }], daCompletare: [],
    email_iscrizione: 'ada@esempio.example' },
];

test('per impresa: chi lavora insieme sta in un gruppo solo', () => {
  const g = raggruppaRichieste(R, 'impresa');
  assert.deepEqual(g.map((x) => [x.etichetta, x.righe.length]), [['EDILE SRL', 2], ['Bianchi Ada', 1]]);
});

test('chi non ha impresa non finisce in un mucchio con gli altri senza impresa', () => {
  const g = raggruppaRichieste([R[2], { ...R[2], id: 4, nominativo: 'Neri Ivo' }], 'impresa');
  assert.equal(g.length, 2, 'due liberi professionisti non si scrivono a vicenda i propri dati');
});

test('per persona: una bozza a testa', () => {
  const g = raggruppaRichieste(R, 'persona');
  assert.deepEqual(g.map((x) => x.etichetta), ['Rossi Mario', 'Verdi Ugo', 'Bianchi Ada']);
  assert.ok(g.every((x) => x.righe.length === 1));
});

test('alla persona si dà del lei e si chiedono i SUOI dati, non «i partecipanti che avete iscritto»', () => {
  const t = testoRichiestaDati({ corso: CORSO, righe: [R[2]], modo: 'persona' });
  assert.match(t, /Gentile Bianchi Ada,/);
  assert.match(t, /il suo attestato/);
  assert.match(t, /ci mancano questi dati:/);
  assert.match(t, /^- Luogo di nascita$/m, 'l\u2019elenco non ripete il nome: sta parlando con lei');
  assert.match(t, /Pu\u00f2 rispondere/);
  assert.ok(!/avete iscritto/.test(t), 'a un libero professionista quella frase non vuol dire niente');
});

test('con un dato solo la mail alla persona va al singolare', () => {
  const t = testoRichiestaDati({ corso: CORSO, righe: [R[0]], modo: 'persona' });
  assert.match(t, /ci manca questo dato:/);
});

test('l\u2019ordine degli indirizzi segue il modo', () => {
  assert.deepEqual(destinatariPossibili([R[0]], 'impresa').map((x) => x.email),
    ['ufficio@edile.example', 'mario@esempio.example']);
  assert.deepEqual(destinatariPossibili([R[0]], 'persona').map((x) => x.email),
    ['mario@esempio.example', 'ufficio@edile.example'],
    'scrivendo alla persona il suo indirizzo viene prima di quello dell\u2019ufficio');
});

test('si sa quando di una persona conosciamo solo l\u2019indirizzo dell\u2019impresa', () => {
  const d = destinatariPossibili([R[1]], 'persona');
  assert.deepEqual(d.map((x) => x.campo), ['email_impresa'], 'la maschera lo dichiara invece di farlo passare per suo');
});
