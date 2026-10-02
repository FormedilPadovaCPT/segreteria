// Ore sui progetti e saldi di ferie e permessi (02/10/2026).
//
// - Una riga di dettaglio può servire a più progetti: la progettazione CAM
//   2021-22 è dei due corsi CAM, e l'utente ha deciso «metà ore ciascuno».
// - Il saldo di ferie e permessi si calcola dalle ore spettanti scritte dalla
//   busta paga, mai ricavate a stima; il goduto dalle righe vere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contaAttivita, contaProgetti, csvContatori, saldoMonte, godutoPerAnno, oreInMinuti } from '../js/presenze-doc.js';

const R = 'Renato Squizzato';
const ex = (id, data, causale, ore_min) => ({ id, dipendente: R, data, causale, ore_min, pagato: false, recuperato: false });

test('progettazione CAM divisa a metà fra i due corsi: il totale resta quello delle righe', () => {
  const att = contaAttivita({
    extra: [ex(1, '2021-09-15', 'Progettazione CAM (Direttiva Costruzioni)', 240), ex(2, '2021-09-15', 'Progettazione SPISAL (2021 AUDIT)', 240),
      ex(3, '2021-09-16', 'GSuite', 120)],
    presenze: [],
    collegamenti: [{ extra_id: 1, progetto_id: 6, quota: 0.5 }, { extra_id: 1, progetto_id: 7, quota: 0.5 }, { extra_id: 2, progetto_id: 4, quota: 1 }],
    nomiProgetti: { 4: 'Auditor', 6: 'CAM imprenditori', 7: 'CAM preposti' },
  });
  const { progetti, senzaProgettoMin } = contaProgetti(att);
  const ore = Object.fromEntries(progetti.map((g) => [g.nome, g.totMin]));
  assert.deepEqual(ore, { Auditor: 240, 'CAM imprenditori': 120, 'CAM preposti': 120 });
  assert.equal(senzaProgettoMin, 120, 'GSuite non è di nessun progetto e si dice');
  const csv = csvContatori(att);
  assert.match(csv, /CAM imprenditori \(50%\) \+ CAM preposti \(50%\)/);
});

test('saldo: residuo dalla busta paga + spettanza − goduto', () => {
  const s = saldoMonte(2026, [{ anno: 2026, spettanza_min: 176 * 60, residuo_iniziale_min: 40 * 60, fonte: 'busta paga 12/2025' }], { 2026: 158 * 60 });
  assert.equal(s.saldo, (40 + 176 - 158) * 60);
  assert.equal(s.residuoDa, 'busta-paga');
});

test('residuo non scritto: si riporta il saldo dell\'anno prima, se c\'è', () => {
  const sp = [{ anno: 2025, spettanza_min: 176 * 60, residuo_iniziale_min: 0 }, { anno: 2026, spettanza_min: 176 * 60, residuo_iniziale_min: null }];
  const s = saldoMonte(2026, sp, { 2025: 128 * 60, 2026: 158 * 60 });
  assert.equal(s.residuoIniziale, 48 * 60);
  assert.equal(s.residuoDa, 'anno-prima');
  assert.equal(s.saldo, (48 + 176 - 158) * 60);
});

test('senza spettanza dell\'anno il saldo NON si inventa', () => {
  const s = saldoMonte(2026, [], { 2026: 158 * 60 });
  assert.equal(s.saldo, null);
  assert.equal(s.goduto, 158 * 60);
});

test('il goduto si conta dalle sole righe della causale del monte', () => {
  const righe = [
    { data: '2026-08-10', causale: 'Ferie', ore_min: 480 }, { data: '2026-08-11', causale: 'ferie ', ore_min: 480 },
    { data: '2026-03-02', causale: 'Permesso', ore_min: 120 }, { data: '2026-09-22', causale: 'Permesso sindacale RSU', ore_min: 120 },
    { data: '2025-12-29', causale: 'Ferie', ore_min: 480 },
  ];
  assert.deepEqual(godutoPerAnno(righe, 'ferie'), { 2026: 960, 2025: 480 });
  assert.deepEqual(godutoPerAnno(righe, 'permessi'), { 2026: 120 }, 'il permesso RSU non scala i permessi del contratto');
});

test('le ore si scrivono come in ufficio: 176, 176,5, 176:30, 8.30', () => {
  assert.equal(oreInMinuti('176'), 176 * 60);
  assert.equal(oreInMinuti('176,5'), 176 * 60 + 30);
  assert.equal(oreInMinuti('176:30'), 176 * 60 + 30);
  assert.equal(oreInMinuti('8.30'), 8 * 60 + 30, '«8.30» sono 8 ore e mezza, come nel resto della scheda');
  assert.equal(oreInMinuti(''), null);
  assert.ok(Number.isNaN(oreInMinuti('tante')));
});
