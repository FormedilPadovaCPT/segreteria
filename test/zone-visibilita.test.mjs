// «Vede solo le sue visite»: la casella di chi è segreteria (28/09/2026).
// Dati INVENTATI: il repository è pubblico.
//
// La segreteria aveva spuntato il proprio nome e continuava a vedere tutto:
// giusto così, nel database ne è esente. Sbagliata era la schermata, che
// offriva una casella senza effetto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indirizziEsenti, statoCasella } from '../js/zone-visibilita.js';

const ruoli = [
  { email: 'Segreteria@esempio.example', ruolo: 'segreteria', stato: 'attivo' },
  { email: 'capo@esempio.example', ruolo: 'admin', stato: 'attivo' },
  { email: 'ex@esempio.example', ruolo: 'segreteria', stato: 'sospeso' },
  { email: 'coord@esempio.example', ruolo: 'coordinatore', stato: 'attivo' },
  { email: null, ruolo: 'segreteria', stato: 'attivo' },
];

test('esenti sono solo segreteria e admin attivi, a maiuscole ignorate', () => {
  assert.deepEqual([...indirizziEsenti(ruoli)].sort(), ['capo@esempio.example', 'segreteria@esempio.example']);
  assert.equal(indirizziEsenti(null).size, 0);
});

test('un tecnico qualunque ha la casella viva, spuntata o no', () => {
  const e = indirizziEsenti(ruoli);
  assert.deepEqual(statoCasella({ email: 'tecnico@esempio.example', vede_solo_proprie: true }, e),
    { esente: false, spuntata: true, spenta: false, nota: '' });
  assert.equal(statoCasella({ email: 'coord@esempio.example', vede_solo_proprie: false }, e).spenta, false);
  assert.equal(statoCasella({ email: 'ex@esempio.example', vede_solo_proprie: false }, e).spenta, false);
  assert.equal(statoCasella({ email: null, vede_solo_proprie: false }, e).spenta, false);
});

test('chi è segreteria ha la casella spenta e la ragione scritta', () => {
  const s = statoCasella({ email: 'SEGRETERIA@esempio.example ', vede_solo_proprie: false }, indirizziEsenti(ruoli));
  assert.equal(s.spenta, true);
  assert.match(s.nota, /segreteria/);
});

test('se la spunta è rimasta, la casella resta viva per poterla togliere', () => {
  const s = statoCasella({ email: 'segreteria@esempio.example', vede_solo_proprie: true }, indirizziEsenti(ruoli));
  assert.equal(s.spenta, false);
  assert.match(s.nota, /non ha effetto/);
});

test('ruoli non letti: non si spegne niente', () => {
  assert.equal(statoCasella({ email: 'segreteria@esempio.example', vede_solo_proprie: false }, null).spenta, false);
});
