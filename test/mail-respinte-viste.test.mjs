// Mail tornate indietro: quali sono di un verbale e quali no (02/10/2026).
// Dati INVENTATI: il repository è pubblico.
//
// Quello che questi controlli tengono fermo:
//   · un rimbalzo senza numero di verbale NON finisce fra i «verbali non
//     consegnati» (la prima riga vera era una ricevuta inoltrata a un
//     indirizzo scritto male);
//   · nessuna riga si perde nella divisione;
//   · il cruscotto usa questa regola, e il gestionale la stessa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dividiRespinte, eDiUnVerbale } from '../js/mail-respinte-viste.js';

const RIGHE = [
  { id: 1, destinatario: 'ammirazione@esempio.it', nr_verbale: null, oggetto_originale: 'Fw: una ricevuta' },
  { id: 2, destinatario: 'impresa@esempio.it', nr_verbale: 'CPT/25_26/0874' },
  { id: 3, destinatario: 'altro@esempio.it', nr_verbale: '   ' },
  { id: 4, destinatario: 'cse@esempio.it', nr_verbale: 'CPT/26_27/0003' },
];

test('senza numero di verbale non è un verbale non consegnato', () => {
  assert.equal(eDiUnVerbale(RIGHE[0]), false);
  assert.equal(eDiUnVerbale(RIGHE[2]), false, 'un numero di soli spazi non è un numero');
  assert.equal(eDiUnVerbale(RIGHE[1]), true);
  assert.equal(eDiUnVerbale(null), false);
});

test('la divisione non perde righe e le mette dalla parte giusta', () => {
  const { verbali, altre } = dividiRespinte(RIGHE);
  assert.deepEqual(verbali.map((r) => r.id), [2, 4]);
  assert.deepEqual(altre.map((r) => r.id), [1, 3]);
  assert.equal(verbali.length + altre.length, RIGHE.length);
  assert.deepEqual(dividiRespinte(null), { verbali: [], altre: [] });
});

test('il cruscotto divide con questa regola e ha le due schede', () => {
  const home = readFileSync(new URL('../js/home.js', import.meta.url), 'utf8');
  assert.match(home, /import \{ dividiRespinte \} from '\.\/mail-respinte-viste\.js'/);
  assert.match(home, /dividiRespinte\(respinte\)/);
  assert.match(home, /Altre mail tornate indietro/);
  assert.match(home, /oggetto_originale/, 'senza l’oggetto la riga non dice di che mail si tratta');
  assert.equal((home.match(/id="hm-respinte-cerca"/g) || []).length, 1, 'il bottone «Cerca adesso» è uno solo');
});
