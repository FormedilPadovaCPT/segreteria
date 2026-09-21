// L'orario di una giornata di corso (21/09/2026). Dati INVENTATI.
//
// Il caso che ha fatto nascere il modulo: una lezione del SOLO pomeriggio
// usciva «e 14:30–18:00», nella scheda corso e sul registro stampato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orarioGiornata } from '../js/corsi-orari.js';

const ora = (t) => (t ? String(t).slice(0, 5) : '');
const fascia = (d, a) => [ora(d), ora(a)].filter(Boolean).join('–');
const testo = (g) => orarioGiornata(g, fascia);

test('solo pomeriggio: niente «e» davanti', () => {
  assert.equal(testo({ dalle: null, alle: null, dalle2: '14:30:00', alle2: '18:00:00' }),
    '14:30–18:00');
});

test('due turni: la «e» sta in mezzo', () => {
  assert.equal(testo({ dalle: '09:00:00', alle: '13:00:00', dalle2: '14:30:00', alle2: '18:00:00' }),
    '09:00–13:00 e 14:30–18:00');
});

test('solo mattina', () => {
  assert.equal(testo({ dalle: '09:00:00', alle: '13:00:00', dalle2: null, alle2: null }),
    '09:00–13:00');
});

test('nessun orario: stringa vuota, non una «e» sola', () => {
  assert.equal(testo({ dalle: null, alle: null, dalle2: null, alle2: null }), '');
  assert.equal(testo({}), '');
  assert.equal(testo(null), '');
});

test('turno aperto a metà: si mostra l\'ora che c\'è', () => {
  // capita con una giornata salvata a metà: meglio l'ora sola che niente
  assert.equal(testo({ dalle: '09:00:00', alle: null }), '09:00');
  assert.equal(testo({ dalle2: '14:30:00', alle2: null }), '14:30');
});
