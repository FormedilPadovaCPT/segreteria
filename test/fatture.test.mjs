// Test del calcolo economico delle fatture dei tecnici: lordo con cassa e IVA
// secondo il regime, importo in lettere come sulla stampa Access, formato euro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lordoDi, inLettere, euro } from '../js/comune.js';

test('lordo = netto x (1 + cassa) x (1 + IVA)', () => {
  assert.equal(lordoDi(100, { cassa_pct: 4, iva_pct: 22 }), 126.88, 'ordinario');
  assert.equal(lordoDi(100, { cassa_pct: 4, iva_pct: 0 }), 104, 'forfettario: cassa si, IVA no');
  assert.equal(lordoDi(800, { cassa_pct: 4, iva_pct: 22 }), 1015.04, 'Balladore sul report storico');
  assert.equal(lordoDi(100, { cassa_pct: 5, iva_pct: 0 }), 105, 'forfettario con cassa 5');
  assert.equal(lordoDi(100), 126.88, 'senza regime vale l\'ordinario');
  assert.equal(lordoDi(0, { cassa_pct: 4, iva_pct: 22 }), 0);
  assert.equal(lordoDi(33.33, { cassa_pct: 4, iva_pct: 22 }), 42.29, 'arrotondato al centesimo');
});

test('importo in lettere come sulla stampa Access', () => {
  assert.equal(inLettere(3538.08), 'tremilacinquecentotrentotto/08');
  assert.equal(inLettere(126.88), 'centoventisei/88');
  assert.equal(inLettere(1000), 'mille/00');
  assert.equal(inLettere(2000), 'duemila/00');
  assert.equal(inLettere(0), 'zero/00');
  assert.equal(inLettere(21), 'ventuno/00', 'la vocale cade davanti a uno');
  assert.equal(inLettere(28), 'ventotto/00', 'la vocale cade davanti a otto');
  assert.equal(inLettere(180), 'centottanta/00');
  assert.equal(inLettere(1000000), 'unmilione/00');
});

test('formato euro italiano', () => {
  assert.equal(euro(12345.5), '12.345,50');
  assert.equal(euro(1234.5), '1234,50', 'in italiano (CLDR) sotto le 5 cifre non si raggruppa');
  assert.equal(euro(0), '0,00');
  assert.equal(euro(null), '0,00');
});
