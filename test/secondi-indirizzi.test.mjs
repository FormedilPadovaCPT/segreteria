// Secondi indirizzi (28/09/2026). Dati INVENTATI: il repository è pubblico.
//
// Chi non legge la casella d'ufficio riceve ogni bozza anche al secondo
// indirizzo. Quello d'ufficio resta: è l'account con cui entra nelle app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allarga, inLista } from '../js/secondi-indirizzi.js';

const mappa = new Map([['esperto@ufficio.example', 'esperto@casa.example']]);

test('chi ha un secondo indirizzo li riceve tutti e due, nell\'ordine', () => {
  assert.deepEqual(allarga(['coord@ufficio.example', 'Esperto@Ufficio.example'], mappa),
    ['coord@ufficio.example', 'Esperto@Ufficio.example', 'esperto@casa.example']);
});

test('chi non ce l\'ha resta com\'è', () => {
  assert.deepEqual(allarga(['impresa@esempio.example'], mappa), ['impresa@esempio.example']);
  assert.deepEqual(allarga([], mappa), []);
  assert.deepEqual(allarga(['a@esempio.example'], new Map()), ['a@esempio.example']);
});

test('niente doppioni, nemmeno se il secondo indirizzo era già scritto a mano', () => {
  assert.deepEqual(allarga(['esperto@ufficio.example', 'ESPERTO@casa.example'], mappa),
    ['esperto@ufficio.example', 'esperto@casa.example']);
  assert.deepEqual(allarga(['esperto@casa.example', 'esperto@ufficio.example'], mappa),
    ['esperto@casa.example', 'esperto@ufficio.example']);
});

test('in copia non si ripete chi è già fra i destinatari', () => {
  assert.deepEqual(allarga(['esperto@ufficio.example', 'coord@ufficio.example'], mappa, ['esperto@casa.example', 'esperto@ufficio.example']),
    ['coord@ufficio.example']);
});

test('la riga «A» si legge anche scritta come testo', () => {
  assert.deepEqual(inLista('a@esempio.example, b@esempio.example;c@esempio.example '), ['a@esempio.example', 'b@esempio.example', 'c@esempio.example']);
  assert.deepEqual(inLista(''), []);
});
