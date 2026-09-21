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
  datiMancantiAttestato, riassuntoMancanti, testoRichiestaDati, destinatariPossibili,
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
