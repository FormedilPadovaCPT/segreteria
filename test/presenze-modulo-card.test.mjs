// La card in testa al modulo della richiesta (veste «Modulo + tessera», 20/10/2026, scelta dall'utente
// con le indicazioni di Patrizia): il residuo in grande e «ancora disponibili». Per i permessi
// sindacali invece NESSUN residuo: il monte RSU è del gruppo (regola del 22/09/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardRichiesta, testoSaldoRichiesta } from '../js/presenze-doc.js';

const R3 = { id: 3, tipo: 'recupero', data_inizio: '2026-10-19', ore: '2', monte: 'banca_ore',
  banca_righe: [{ id: 1269, data: '2026-09-07', ore_min: 120, note: 'x' }], banca_saldo_prima_min: 120 };

test('recupero (la richiesta n° 3): 0:00 ore ancora disponibili, 2:00 dalla banca ore', () => {
  const c = cardRichiesta(R3, null);
  assert.equal(c.titolo, 'BANCA ORE DOPO QUESTA RICHIESTA');
  assert.equal(c.grande, '0:00');
  assert.equal(c.sotto, 'ore ancora disponibili');
  assert.equal(c.richiesta, '2:00 ore dalla banca ore');
  assert.equal(c.quota, 1);
  assert.match(cardRichiesta({ ...R3, banca_righe: null }, null).nota, /non dice da quali ore/);
  assert.equal(cardRichiesta({ ...R3, banca_righe: [], banca_saldo_prima_min: 0 }, null).sotto, 'ore di recupero anticipato');
});

test('ferie: i giorni ancora disponibili dalla fotografia del saldo (numeri veri del 20/10/2026)', () => {
  const saldo = { monte: 'ferie', nome: 'Ferie', oggiMin: 3598, chiestaMin: 960, dopoMin: 2638, oggiG: '8', chiestaG: '2', dopoG: '5,9', registrata: false };
  const c = cardRichiesta({ id: 7, tipo: 'ferie', monte: 'ferie', data_inizio: '2026-12-22', data_fine: '2026-12-23' }, saldo, { tipo: 'Ferie' });
  assert.equal(c.titolo, 'FERIE DOPO QUESTA RICHIESTA');
  assert.equal(c.grande, '5,9');
  assert.equal(c.sotto, 'giorni ancora disponibili');
  assert.equal(c.sotto2, '43,97 ore');
  assert.equal(c.richiesta, '2 giorni di ferie (16,00 ore)');
  assert.equal(c.nota, 'dal 22/12/2026 al 23/12/2026');
  assert.equal(testoSaldoRichiesta(saldo), 'ferie a oggi 8 giorni, 59,97 h · dopo questa richiesta 5,9 giorni, 43,97 h');
});

test('permesso: scala le ex festività; senza saldo lo si dice', () => {
  const saldo = { monte: 'ex_festivita', nome: 'Ex festività', oggiMin: 9694, chiestaMin: 120, dopoMin: 9574, oggiG: '21,5', chiestaG: '0,3', dopoG: '21,3' };
  const c = cardRichiesta({ id: 8, tipo: 'permesso', monte: 'permessi', data_inizio: '2026-11-05', ore: '2' }, saldo, { tipo: 'Permesso' });
  assert.equal(c.titolo, 'EX FESTIVITÀ E PERMESSI DOPO QUESTA RICHIESTA');
  assert.equal(c.grande, '21,3');
  assert.equal(c.richiesta, '2:00 ore di permesso');
  const senza = cardRichiesta({ id: 9, tipo: 'ferie', monte: 'ferie', data_inizio: '2026-12-22', ore: '8' }, null, { tipo: 'Ferie' });
  assert.match(senza.nota, /manca la spettanza/);
  assert.equal(senza.grande, '8:00');
});

test('permesso sindacale RSU e riunione sindacale: le ore richieste, mai un residuo', () => {
  for (const tipo of ['permesso_rsu', 'riunione_sindacale']) {
    const c = cardRichiesta({ id: 1, tipo, monte: 'permessi_rsu', data_inizio: '2026-09-22', ore: '2' }, null, { tipo: 'Permesso sindacale RSU', monte: 'Permessi sindacali RSU' });
    assert.equal(c.grande, '2:00');
    assert.equal(c.sotto, 'ore richieste');
    assert.doesNotMatch(JSON.stringify(c), /disponibil|residuo:|rimast/i, tipo + ': nessun residuo');
    assert.match(c.nota, /non si calcola un residuo/);
  }
});

test('ore supplementari: la scelta del lavoratore', () => {
  assert.equal(cardRichiesta({ id: 4, tipo: 'supplementari', ore: '1.5', compenso: 'recupero' }, null).richiesta, 'da recuperare: vanno in banca ore');
  assert.equal(cardRichiesta({ id: 4, tipo: 'supplementari', ore: '1.5', compenso: 'paga' }, null).grande, '1:30');
});
