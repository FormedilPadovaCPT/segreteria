// Calendario, inserimento unico, riscontro con la busta e scadenze delle ferie.
//
// Nato il 02/10/2026 dal confronto con 20 buste paga: gli errori venivano da
// ferie scritte solo nella griglia (29-31/12/2025, 05/01/2026), da festivi
// registrati come ferie (25-26/12/2024, 01/01 e 06/01/2025) e dai giorni
// generati a 8 ore dal lunedì al venerdì. I casi qui sotto sono quelli veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pasqua, festivoDi, giorniDaGenerare, causaleDaNota, incongruenzeMese,
  maturatoMesi, saldoAlMese, riscontroBusta, scadenzeFerie, saldoMonte, oreCentesimi,
} from '../js/presenze-doc.js';

const orario = { dal: '2026-01-01', lun_min: 360, mar_min: 480, mer_min: 480, gio_min: 480, ven_min: 0, sab_min: 0, dom_min: 0 };
const R = 'Renato Squizzato';

test('Pasqua e i festivi, patrono di Padova compreso; il 4 novembre no', () => {
  assert.equal(pasqua(2025), '2025-04-20');
  assert.equal(pasqua(2026), '2026-04-05');
  assert.equal(festivoDi('2026-04-06'), 'Lunedì dell’Angelo');
  assert.equal(festivoDi('2026-06-13'), 'Sant’Antonio, patrono di Padova');
  assert.equal(festivoDi('2025-12-26'), 'Santo Stefano');
  assert.equal(festivoDi('2026-11-04'), null);
});

test('le ferie di Natale si generano sull\'orario: festivi e riposi saltati, lunedì 6 ore', () => {
  const g = giorniDaGenerare('2025-12-22', '2026-01-07', orario);
  const lavoro = g.filter((x) => !x.salta);
  assert.deepEqual(lavoro.map((x) => `${x.data.slice(5)}:${x.ore_min / 60}`),
    ['12-22:6', '12-23:8', '12-24:8', '12-29:6', '12-30:8', '12-31:8', '01-05:6', '01-07:8']);
  assert.match(g.find((x) => x.data === '2025-12-25').salta, /Natale/);
  assert.match(g.find((x) => x.data === '2026-01-02').salta, /riposo/, 'il venerdì è riposo');
});

test('senza orario si resta come prima: lunedì-venerdì a 8 ore, ma i festivi si saltano', () => {
  const g = giorniDaGenerare('2026-06-01', '2026-06-05', null).filter((x) => !x.salta);
  assert.deepEqual(g.map((x) => x.data.slice(5)), ['06-01', '06-03', '06-04', '06-05']);
  assert.ok(g.every((x) => x.ore_min === 480));
});

test('la nota della griglia dice la causale di banca ore', () => {
  assert.equal(causaleDaNota('FERIE'), 'Ferie');
  assert.equal(causaleDaNota('FERIE ex festività'), 'Ex festività');
  assert.equal(causaleDaNota('permesso 1 ora'), 'Permesso');
  assert.equal(causaleDaNota('RECUPERO'), 'Recupero');
  assert.equal(causaleDaNota('Permesso RSU dalle 8.30 alle 10.30'), null, 'il sindacale ha i suoi monti');
  assert.equal(causaleDaNota('riunione tecnici'), null);
});

test('incongruenze: ferie solo nella griglia (29/12/2025), ferie su un festivo, malattia ignorata', () => {
  const presenze = [
    { dipendente: R, data: '2025-12-29', tot_min: 0, note: 'Ferie' },
    { dipendente: R, data: '2025-12-23', tot_min: 0, note: 'Malattia' },
    { dipendente: R, data: '2025-12-25', tot_min: 0, note: 'Festività' },
  ];
  const extra = [{ id: 9, dipendente: R, data: '2025-12-25', causale: 'Ferie', ore_min: 480 }];
  const inc = incongruenzeMese({ presenze, extra, orario });
  const tipi = inc.map((x) => `${x.data.slice(5)}:${x.tipo}`);
  assert.ok(tipi.includes('12-29:manca-movimento'));
  assert.equal(inc.find((x) => x.tipo === 'manca-movimento').ore_min, 360, 'lunedì: 6 ore dall\'orario');
  assert.ok(tipi.includes('12-25:su-festivo'));
  assert.ok(!tipi.some((t) => t.startsWith('12-23')), 'la malattia sta nella sola griglia');
});

test('una giornata in pari non dà avvisi', () => {
  const inc = incongruenzeMese({
    presenze: [{ dipendente: R, data: '2026-08-05', tot_min: 0, note: 'FERIE' }],
    extra: [{ id: 1, dipendente: R, data: '2026-08-05', causale: 'Ferie', ore_min: 480 }], orario,
  });
  assert.deepEqual(inc, []);
});

test('maturato come la busta: 13,33 h al mese, conguaglio a dicembre', () => {
  assert.equal(oreCentesimi(maturatoMesi(160 * 60, 8)), '106,64');
  assert.equal(oreCentesimi(maturatoMesi(26.68 * 60, 8)), '17,76');
  assert.equal(oreCentesimi(maturatoMesi(160 * 60, 12)), '160,00');
});

// la busta di agosto 2026: ferie 94,00 + 106,64 − 130,00 = 70,64
const sp26 = [{ anno: 2026, monte: 'ferie', spettanza_min: '9600.00', residuo_iniziale_min: '5640.00' }];
const righe26 = [
  { data: '2026-01-05', causale: 'Ferie', ore_min: 360 },
  { data: '2026-06-01', causale: 'Ferie', ore_min: 360 }, { data: '2026-06-29', causale: 'Ferie', ore_min: 360 },
  { data: '2026-08-10', causale: 'Ferie', ore_min: 112 * 60 },
  { data: '2026-09-01', causale: 'Ferie', ore_min: 480 },
];

test('saldo a fine agosto come il RESIDUO TOT. della busta', () => {
  const x = saldoAlMese(sp26, righe26, 'ferie', 2026, 8);
  assert.equal(oreCentesimi(x.goduto), '130,00');
  assert.equal(oreCentesimi(x.residuo), '70,64');
});

test('riscontro: in pari quando coincide, la differenza quando manca una riga', () => {
  const busta = [{ anno: 2026, mese: 8, monte: 'ferie', goduto_ac_min: '7800.00', residuo_tot_min: '4238.40' }];
  assert.equal(riscontroBusta(busta, sp26, righe26)[0].ok, true);
  const senza = righe26.filter((r) => r.data !== '2026-06-29');
  const r = riscontroBusta(busta, sp26, senza)[0];
  assert.equal(r.ok, false);
  assert.equal(oreCentesimi(r.diffGoduto), '-6,00');
});

test('scadenze: le ferie godute consumano prima il residuo; il resto scade il 30 giugno di due anni dopo', () => {
  const s = saldoMonte(2026, sp26, { 2026: 154 * 60 });          // 94 + 160 − 154 = 100
  assert.deepEqual(scadenzeFerie(s, 2026).map((z) => [oreCentesimi(z.ore_min), z.origine, z.scadenza]),
    [['100,00', 2026, '2028-06-30']]);
  const poco = saldoMonte(2026, sp26, { 2026: 30 * 60 });         // 64 h del residuo 2025 restano
  assert.deepEqual(scadenzeFerie(poco, 2026).map((z) => [oreCentesimi(z.ore_min), z.origine, z.scadenza]),
    [['64,00', 2025, '2027-06-30'], ['160,00', 2026, '2028-06-30']]);
});
