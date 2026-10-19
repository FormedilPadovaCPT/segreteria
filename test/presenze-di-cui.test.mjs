// La riga «di cui» del permesso sindacale a ore (19/10/2026).
// Il 22/09 e il 24/09/2026 «Genera le righe» aveva scritto la riga «PERMESSO SINDACALE RSU»
// a zero e la segreteria ci aveva messo le ore a mano (120 e 180 minuti). Ora le scrive l'app,
// e la riga resta fuori dal totale: è una quota della giornata, non un'ora in più.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totaleRigaGenerata, CAUSALI_DI_CUI, eRipartizione, totaleOre } from '../js/presenze-doc.js';

test('permesso RSU e riunione sindacale a ore: la riga porta le ore e non si somma', () => {
  for (const causale of CAUSALI_DI_CUI) {
    const riga = { note: causale.toUpperCase(), tot_min: totaleRigaGenerata(causale, 120, true) };
    assert.equal(riga.tot_min, 120, causale);
    assert.ok(eRipartizione(riga), `${causale}: la nota maiuscola la rende un «di cui»`);
    const giornata = { note: 'Permesso sindacale RSU dalle 10.00 alle 12.00', tot_min: 481 };
    assert.equal(totaleOre([giornata, riga]), 481, `${causale}: il totale del giorno resta quello lavorato`);
  }
});

test('le altre causali restano a zero: con delle ore verrebbero sommate come lavorate', () => {
  for (const causale of ['Permesso', 'Recupero', 'Ferie', 'Ex festività', 'ROL', 'Permessi legge 104/92']) {
    assert.equal(totaleRigaGenerata(causale, 120, true), 0, causale);
    assert.equal(eRipartizione({ note: causale.toUpperCase(), tot_min: 120 }), false, `${causale} si sommerebbe`);
  }
});

test('su più giorni, o senza ore scritte, la riga sindacale resta a zero come prima', () => {
  assert.equal(totaleRigaGenerata('Permesso sindacale RSU', 480, false), 0);
  assert.equal(totaleRigaGenerata('Riunione sindacale', 480, false), 0);
});
