// Prospetto presenze di un PERIODO scelto a mano.
//
// Nato il 01/10/2026: Nicola De Marco fattura ogni tre mesi, ma con la scuola
// chiusa ad agosto a Patrizia si manda giugno-settembre. I numeri qui sotto
// sono le sue giornate vere di quei mesi (6 a giugno, 5 a luglio, nessuna ad
// agosto, 4 a settembre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mesiDelPeriodo, raggruppaPeriodo, etichettaPeriodo } from '../js/presenze-doc.js';

const g = (data, tot_min, note = null) => ({ data, tot_min, note });
const nicola = [
  g('2026-06-08', 180), g('2026-06-11', 60), g('2026-06-15', 360, 'convegno'),
  g('2026-06-18', 210), g('2026-06-22', 225), g('2026-06-23', 60),
  g('2026-07-02', 240), g('2026-07-08', 240), g('2026-07-20', 120), g('2026-07-27', 292), g('2026-07-29', 76),
  g('2026-09-10', 180), g('2026-09-17', 180), g('2026-09-21', 180), g('2026-09-23', 270),
];

test('i mesi del periodo sono tutti, anche quello senza presenze', () => {
  assert.deepEqual(mesiDelPeriodo('2026-06-01', '2026-09-30').map((x) => x.mese), [6, 7, 8, 9]);
  assert.deepEqual(mesiDelPeriodo('2026-12-01', '2027-02-28').map((x) => `${x.anno}-${x.mese}`), ['2026-12', '2027-1', '2027-2']);
  assert.deepEqual(mesiDelPeriodo('2026-09-30', '2026-06-01'), []);
});

test('giugno-settembre di Nicola: ore e giorni per mese, agosto vuoto ma presente', () => {
  const m = raggruppaPeriodo(nicola, '2026-06-01', '2026-09-30');
  assert.deepEqual(m.map((x) => [x.mese, x.giorni, x.totMin]), [
    [6, 6, 1095], [7, 5, 968], [8, 0, 0], [9, 4, 810],
  ]);
  assert.equal(m.reduce((s, x) => s + x.totMin, 0), 2873);
});

test('le giornate fuori dalle date scelte restano fuori, anche dentro un mese toccato', () => {
  const m = raggruppaPeriodo(nicola, '2026-06-15', '2026-07-08');
  assert.deepEqual(m.map((x) => [x.mese, x.giorni]), [[6, 4], [7, 2]]);
});

test('il permesso sindacale si mostra ma non si somma, come nel foglio del mese', () => {
  const righe = [g('2026-09-22', 480), g('2026-09-22', 120, 'PERMESSO SINDACALE RSU')];
  const [set] = raggruppaPeriodo(righe, '2026-09-01', '2026-09-30');
  assert.equal(set.righe.length, 2);
  assert.equal(set.totMin, 480);
  assert.equal(set.giorni, 1);
});

test('il periodo si scrive coi nomi dei mesi quando è fatto di mesi interi', () => {
  assert.equal(etichettaPeriodo('2026-06-01', '2026-09-30'), 'giugno – settembre 2026');
  assert.equal(etichettaPeriodo('2026-12-01', '2027-02-28'), 'dicembre 2026 – febbraio 2027');
  assert.equal(etichettaPeriodo('2026-08-01', '2026-08-31'), 'agosto 2026');
  assert.match(etichettaPeriodo('2026-06-10', '2026-09-30'), /^dal 10\/06\/2026 al 30\/09\/2026$/);
});
