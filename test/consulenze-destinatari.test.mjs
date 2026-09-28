// Risposta a una consulenza: chi ha risposto e chi va in copia (28/09/2026).
// Dati INVENTATI: il repository è pubblico.
//
// Regola dell'utente: in copia il coordinatore e, se non ha risposto lui,
// anche chi ha fornito la risposta. Prima andava in copia solo il
// coordinatore, e come autore restava scritta la segreteria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiHaRisposto, copiaRisposta } from '../js/consulenze-destinatari.js';

const SEGR = 'segreteria@esempio.example';
const COORD = 'coordinatore@esempio.example';
const ESPERTO = 'esperto@esempio.example';
const IMPRESA = 'info@impresa.example';

test('ha risposto la persona a cui il quesito è stato girato', () => {
  assert.equal(chiHaRisposto({ girata_a: ESPERTO, risposta_da: SEGR }, SEGR), ESPERTO);
  assert.equal(chiHaRisposto({ girata_a: ESPERTO }, SEGR), ESPERTO);
});

test('senza giro vale chi è scritto come autore, se non è la segreteria', () => {
  assert.equal(chiHaRisposto({ risposta_da: COORD }, SEGR), COORD);
  assert.equal(chiHaRisposto({ risposta_da: SEGR.toUpperCase() }, SEGR), SEGR);
  assert.equal(chiHaRisposto({}, SEGR), SEGR);
});

test('risponde un altro: in copia coordinatore e chi ha risposto', () => {
  assert.deepEqual(copiaRisposta({ pratica: { email: IMPRESA, girata_a: ESPERTO }, coordinatore: COORD, emailSegreteria: SEGR }),
    [COORD, ESPERTO]);
});

test('risponde il coordinatore: in copia una volta sola', () => {
  assert.deepEqual(copiaRisposta({ pratica: { email: IMPRESA, girata_a: 'Coordinatore@esempio.example' }, coordinatore: COORD, emailSegreteria: SEGR }),
    [COORD]);
});

test('risponde la segreteria: in copia il solo coordinatore', () => {
  assert.deepEqual(copiaRisposta({ pratica: { email: IMPRESA, risposta_da: SEGR }, coordinatore: COORD, emailSegreteria: SEGR }),
    [COORD]);
});

test('mai in copia l\'impresa, né un indirizzo scritto male', () => {
  assert.deepEqual(copiaRisposta({ pratica: { email: IMPRESA, girata_a: IMPRESA }, coordinatore: COORD, emailSegreteria: SEGR }), [COORD]);
  assert.deepEqual(copiaRisposta({ pratica: { email: IMPRESA, girata_a: 'non-un-indirizzo' }, coordinatore: null, emailSegreteria: SEGR }), []);
});
