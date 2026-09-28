// Promemoria delle lezioni e materiali del corso (28/09/2026).
// Dati INVENTATI: il repository è pubblico.
//
// Quello che questi controlli tengono fermo:
//   · il promemoria vale per OGNI lezione, non solo per la prima;
//   · se il giro salta un giorno il promemoria parte al giro dopo, ma
//     MAI il giorno stesso della lezione né a lezione passata;
//   · un corso non aperto, o senza giorni impostati, non manda niente;
//   · una mail per indirizzo: il referente di dieci iscritti ne riceve una;
//   · a un indirizzo dell'impresa si parla all'ufficio, non alla persona;
//   · le note della giornata (appunti dell'ufficio) non escono mai;
//   · senza materiali la mail degli attestati resta quella di prima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  giorniFra, dataEstesa, orarioEsteso, corsoRicorda, partenza, giornateDaRicordare,
  iscrittiDaAvvisare, indirizzoDi, raggruppaPerIndirizzo, testoPromemoria,
  materialiValidi, testoMateriali,
} from '../js/corsi-promemoria-testo.js';
import { testoInvioAttestati } from '../js/corsi-anagrafica.js';

const CORSO = { id: 900, titolo: 'Ponteggi — aggiornamento', stato: 'aperto', promemoria_giorni: 2, sede: 'Via di Prova 1, Padova', modalita: 'aula' };
const G1 = { id: 1, corso_id: 900, data: '2026-10-08', dalle: '09:00:00', alle: '13:00:00', note: 'APPUNTO INTERNO' };
const G2 = { id: 2, corso_id: 900, data: '2026-10-15', dalle2: '14:00:00', alle2: '18:00:00', aula: 'Aula 2' };

test('le date si contano senza fusi orari e si scrivono per esteso', () => {
  assert.equal(giorniFra('2026-10-06', '2026-10-08'), 2);
  assert.equal(giorniFra('2026-10-24', '2026-10-26'), 2);   // a cavallo del cambio dell'ora
  assert.equal(dataEstesa('2026-10-08'), 'giovedì 8 ottobre 2026');
  assert.equal(partenza(G1, 2), '2026-10-06');
});

test('l’orario unisce i turni con «e» solo se ci sono tutti e due', () => {
  assert.equal(orarioEsteso(G1), 'dalle 09:00 alle 13:00');
  assert.equal(orarioEsteso(G2), 'dalle 14:00 alle 18:00');
  assert.equal(orarioEsteso({ dalle: '09:00', alle: '13:00', dalle2: '14:00', alle2: '18:00' }), 'dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00');
  assert.equal(orarioEsteso({}), '');
});

test('manda promemoria solo il corso aperto con i giorni impostati', () => {
  assert.equal(corsoRicorda(CORSO), true);
  assert.equal(corsoRicorda({ ...CORSO, promemoria_giorni: null }), false);
  assert.equal(corsoRicorda({ ...CORSO, promemoria_giorni: 0 }), false);
  for (const stato of ['bozza', 'svolto', 'chiuso', 'annullato']) assert.equal(corsoRicorda({ ...CORSO, stato }), false, stato);
});

test('ogni lezione ha il suo promemoria, nella sua finestra', () => {
  const da = (oggi) => giornateDaRicordare([CORSO], [G1, G2], oggi).map((g) => g.id);
  assert.deepEqual(da('2026-10-05'), []);        // tre giorni prima: presto
  assert.deepEqual(da('2026-10-06'), [1]);       // due giorni prima
  assert.deepEqual(da('2026-10-07'), [1]);       // il giro di ieri è saltato: parte oggi
  assert.deepEqual(da('2026-10-08'), []);        // il giorno stesso no
  assert.deepEqual(da('2026-10-13'), [2]);       // la seconda lezione ha il suo
  assert.deepEqual(da('2026-10-16'), []);        // a corso finito niente
});

test('un corso chiuso o senza promemoria non ricorda niente', () => {
  assert.deepEqual(giornateDaRicordare([{ ...CORSO, stato: 'chiuso' }], [G1], '2026-10-06'), []);
  assert.deepEqual(giornateDaRicordare([{ ...CORSO, promemoria_giorni: null }], [G1], '2026-10-06'), []);
});

test('chi è annullato o sostituito non riceve il promemoria', () => {
  const ii = [{ id: 1, esito: 'in_attesa' }, { id: 2, esito: 'annullato' }, { id: 3, esito: 'sostituito' }, { id: 4, esito: null }];
  assert.deepEqual(iscrittiDaAvvisare(ii).map((i) => i.id), [1, 4]);
});

test('l’indirizzo: prima il suo, in coda quello dell’impresa', () => {
  assert.deepEqual(indirizzoDi({ email_iscrizione: ' Mario@Prova.it ' }, { email: 'x@prova.it' }, { email: 'ufficio@prova.it' }), { email: 'mario@prova.it', origine: 'iscrizione' });
  assert.deepEqual(indirizzoDi({}, { email: '', email2: 'due@prova.it' }, null), { email: 'due@prova.it', origine: 'persona' });
  assert.deepEqual(indirizzoDi({ email_iscrizione: 'non-è-una-mail' }, null, { email: 'ufficio@prova.it' }), { email: 'ufficio@prova.it', origine: 'impresa' });
  assert.deepEqual(indirizzoDi({}, null, null), { email: null, origine: null });
});

test('una mail per indirizzo, e chi non ha indirizzo si dichiara', () => {
  const { gruppi, senza } = raggruppaPerIndirizzo([
    { iscritto_id: 1, nominativo: 'Rossi Mario', email: 'ufficio@prova.it', origine: 'impresa' },
    { iscritto_id: 2, nominativo: 'Bianchi Luca', email: 'ufficio@prova.it', origine: 'impresa' },
    { iscritto_id: 3, nominativo: 'Verdi Anna', email: 'anna@prova.it', origine: 'iscrizione' },
    { iscritto_id: 4, nominativo: 'Neri Ugo', email: null, origine: null },
  ]);
  assert.equal(gruppi.length, 2);
  assert.deepEqual(gruppi[0].righe.map((r) => r.iscritto_id), [1, 2]);
  assert.deepEqual(senza.map((r) => r.iscritto_id), [4]);
});

test('il promemoria alla persona: dati del corso, mai le note interne', () => {
  const { oggetto, corpo, aPersona } = testoPromemoria({
    corso: CORSO, giornata: G1, giornate: [G2, G1], oggi: '2026-10-06', contatto: 'ufficio@prova.it',
    partecipanti: [{ nominativo: 'Verdi Anna', origine: 'iscrizione' }],
  });
  assert.equal(aPersona, true);
  assert.match(corpo, /^Gentile Verdi Anna,/);
  assert.match(corpo, /le ricordiamo la sua iscrizione a «Ponteggi — aggiornamento»/);
  assert.match(corpo, /\*\*Lezione 1 di 2:\*\* giovedì 8 ottobre 2026, dalle 09:00 alle 13:00/);
  assert.match(corpo, /\*\*Dove:\*\* Via di Prova 1, Padova/);
  assert.match(corpo, /Le lezioni successive:\n- giovedì 15 ottobre 2026, dalle 14:00 alle 18:00/);
  assert.match(corpo, /scrivendo a ufficio@prova\.it/);
  assert.doesNotMatch(corpo, /APPUNTO INTERNO/);
  assert.doesNotMatch(corpo, /domani/);
  assert.equal(oggetto, 'Promemoria lezione 1 di 2 - Ponteggi — aggiornamento - giovedì 8 ottobre 2026');
});

test('il promemoria del giorno prima dice «domani»', () => {
  const { corpo } = testoPromemoria({ corso: CORSO, giornata: G1, giornate: [G1], oggi: '2026-10-07', partecipanti: [{ nominativo: 'Verdi Anna', origine: 'persona' }] });
  assert.match(corpo, /\*\*Quando:\*\* domani, giovedì 8 ottobre 2026/);
  assert.doesNotMatch(corpo, /Le lezioni successive/);
});

test('all’indirizzo dell’impresa si parla all’ufficio, anche per un iscritto solo', () => {
  const uno = testoPromemoria({ corso: CORSO, giornata: G2, giornate: [G1, G2], partecipanti: [{ nominativo: 'Rossi Mario', origine: 'impresa' }] });
  assert.equal(uno.aPersona, false);
  assert.match(uno.corpo, /vi ricordiamo l’iscrizione a «Ponteggi — aggiornamento» del partecipante:\n- Rossi Mario/);
  assert.match(uno.corpo, /\*\*Dove:\*\* Via di Prova 1, Padova - Aula 2/);
  const due = testoPromemoria({ corso: CORSO, giornata: G2, giornate: [G1, G2], partecipanti: [{ nominativo: 'Rossi Mario', origine: 'iscrizione' }, { nominativo: 'Bianchi Luca', origine: 'iscrizione' }] });
  assert.match(due.corpo, /dei partecipanti:\n- Rossi Mario\n- Bianchi Luca/);
  assert.match(due.corpo, /se qualcuno non può partecipare/i);
});

test('la videoconferenza si dichiara', () => {
  const { corpo } = testoPromemoria({ corso: { ...CORSO, modalita: 'videoconferenza', sede: null }, giornata: G1, giornate: [G1], partecipanti: [{ nominativo: 'Verdi Anna', origine: 'persona' }] });
  assert.match(corpo, /\*\*Modalità:\*\* videoconferenza/);
  assert.doesNotMatch(corpo, /\*\*Dove:\*\*/);
});

test('i materiali: solo quelli con titolo e link vero', () => {
  const mm = materialiValidi([
    { titolo: 'Slide', url: 'https://drive.google.com/file/d/abc/view' },
    { titolo: '', url: 'https://prova.it/x' },
    { titolo: 'Senza link', url: '' },
    { titolo: 'Non è un link', url: 'javascript:alert(1)' },
  ]);
  assert.deepEqual(mm, [{ titolo: 'Slide', url: 'https://drive.google.com/file/d/abc/view' }]);
  assert.deepEqual(materialiValidi(null), []);
});

test('i materiali nella mail, con la data entro cui scaricarli', () => {
  const righe = testoMateriali([{ titolo: 'Slide', url: 'https://prova.it/a' }, { titolo: 'Dispensa', url: 'https://prova.it/b' }], '2026-11-30').join('\n');
  assert.match(righe, /\*\*I materiali del corso\*\*\n- Slide: https:\/\/prova\.it\/a\n- Dispensa: https:\/\/prova\.it\/b/);
  assert.match(righe, /Vi consigliamo di scaricarli il prima possibile: restano a disposizione fino al lunedì 30 novembre 2026\./);
  const uno = testoMateriali([{ titolo: 'Slide', url: 'https://prova.it/a' }], null, { aPersona: true }).join('\n');
  assert.match(uno, /Le consigliamo di scaricarlo il prima possibile\./);
  assert.deepEqual(testoMateriali([], '2026-11-30'), []);
});

test('la mail degli attestati porta i materiali, e senza materiali resta com’era', () => {
  const senza = testoInvioAttestati({ corso: CORSO, righe: [{ nominativo: 'Rossi Mario' }], modo: 'persona', mittente: 'La Segreteria' });
  assert.doesNotMatch(senza, /material/i);
  const con = testoInvioAttestati({
    corso: { ...CORSO, materiali: [{ titolo: 'Slide', url: 'https://prova.it/a' }], materiali_fino_al: '2026-11-30' },
    righe: [{ nominativo: 'Rossi Mario' }], modo: 'persona', mittente: 'La Segreteria',
  });
  assert.match(con, /in allegato il suo attestato/);
  assert.match(con, /- Slide: https:\/\/prova\.it\/a/);
  assert.match(con, /Le consigliamo di scaricarlo il prima possibile: resta a disposizione fino al lunedì 30 novembre 2026\./);
  assert.ok(con.indexOf('Slide') < con.indexOf('Grazie e cordiali saluti.'));
});
