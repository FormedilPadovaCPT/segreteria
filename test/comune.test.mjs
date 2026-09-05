// Test delle funzioni pure di js/comune.js — quelle che decidono come si
// scrive un numero di protocollo e a quale esercizio appartiene una data.
// Girano con `node --test test/` (nessuna dipendenza, nessun browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, dataIt, testoPdf, codiceProtocollo, siglaProtocollo, protocolloEsteso, esercizioDi } from '../js/comune.js';

test('esercizio dell\'ente: dal 1/10 al 30/9, forma AA-AA', () => {
  assert.equal(esercizioDi('2026-09-30'), '25-26');
  assert.equal(esercizioDi('2026-10-01'), '26-27');
  assert.equal(esercizioDi('2027-09-30'), '26-27');
  assert.equal(esercizioDi('2027-10-01'), '27-28');
  assert.equal(esercizioDi('2000-01-15'), '99-00', 'cambio di secolo');
});

test('protocollo storico: numero + direzione, mai il solo numero', () => {
  assert.equal(codiceProtocollo({ numero: 2554, direzione: 'OUT' }), '2554-out');
  assert.equal(codiceProtocollo({ numero: 2012, direzione: 'IN' }), '2012-in');
  assert.equal(siglaProtocollo({ numero: 2012, direzione: 'IN' }), 'Prot_2012-in');
  assert.equal(protocolloEsteso({ numero: 2012, direzione: 'IN' }), 'n° 2012 in entrata');
  assert.equal(protocolloEsteso({ numero: 7, direzione: 'OUT' }), 'n° 7 in uscita');
});

test('serie unica dal 1/10/2026: Prot_AA-AA_NNNN, stessa forma in ogni contesto', () => {
  const p = { esercizio: '26-27', numero: 1, direzione: 'IN' };
  assert.equal(codiceProtocollo(p), 'Prot_26-27_0001');
  assert.equal(siglaProtocollo(p), 'Prot_26-27_0001', 'nessun doppio prefisso');
  assert.equal(protocolloEsteso(p), 'Prot_26-27_0001');
  assert.equal(codiceProtocollo({ esercizio: '26-27', numero: 12345 }), 'Prot_26-27_12345', 'oltre le 4 cifre non si tronca');
});

test('il codice calcolato dal database vince su tutto', () => {
  assert.equal(codiceProtocollo({ codice: 'Prot_26-27_0042', numero: 99, direzione: 'IN' }), 'Prot_26-27_0042');
  assert.equal(codiceProtocollo(null), '');
  assert.equal(codiceProtocollo({}), '');
});

test('date e testo', () => {
  assert.equal(dataIt('2026-10-01'), '01/10/2026');
  assert.equal(dataIt('2026-10-01T08:30:00Z'), '01/10/2026');
  assert.equal(dataIt(''), '');
  assert.equal(esc('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
  assert.equal(testoPdf('SI □ NO ☑ → ok'), 'SI [ ] NO [x] -> ok', 'i caratteri fuori WinAnsi non fanno crollare il PDF');
  assert.equal(testoPdf('€ 100 – ok'), '€ 100 – ok', 'euro e trattino lungo restano');
});
