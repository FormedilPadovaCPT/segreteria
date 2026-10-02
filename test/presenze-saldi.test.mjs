// Ore sui progetti e saldi di ferie e permessi (02/10/2026).
//
// - Una riga di dettaglio può servire a più progetti: la progettazione CAM
//   2021-22 è dei due corsi CAM, e l'utente ha deciso «metà ore ciascuno».
// - Il saldo di ferie e permessi si calcola dalle ore spettanti scritte dalla
//   busta paga, mai ricavate a stima; il goduto dalle righe vere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contaAttivita, contaProgetti, csvContatori, saldoMonte, godutoPerAnno, oreInMinuti, oreCentesimi, famigliaCausale } from '../js/presenze-doc.js';

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
  assert.deepEqual(godutoPerAnno(righe, 'ex_festivita'), { 2026: 120 }, 'il permesso RSU non scala le ex festività');
});

test('i monti sono quelli della busta: il «Permesso» e le «Ex festività» a ore scalano le ex festività, la «Festività» no', () => {
  const righe = [
    { data: '2026-02-16', causale: 'Permesso', ore_min: 60 }, { data: '2026-06-03', causale: 'Ex festività', ore_min: 120 },
    { data: '2026-06-02', causale: 'Festività', ore_min: 480 }, { data: '2026-04-06', causale: 'Festività', ore_min: 360 },
  ];
  assert.deepEqual(godutoPerAnno(righe, 'ex_festivita'), { 2026: 180 });
  assert.deepEqual(godutoPerAnno(righe, 'rol'), {});
});

test('busta paga di agosto 2026: con le ore della busta il saldo torna al centesimo', () => {
  // riquadro «Riposi»: FERIE residuo A.P. 94,00 + maturato 106,64 − goduto 130,00 = 70,64
  const res = oreInMinuti('94,00', { centesimi: true });
  const mat = oreInMinuti('106,64', { centesimi: true });
  const god = oreInMinuti('130,00', { centesimi: true });
  assert.equal(oreCentesimi(res + mat - god), '70,64');
  // EX FESTIVITÀ: 152,58 + 17,76 − 11,00 = 159,34 — «152.58» col punto è lo stesso numero
  const s = saldoMonte(2026, [{ anno: 2026, spettanza_min: oreInMinuti('17.76', { centesimi: true }), residuo_iniziale_min: oreInMinuti('152.58', { centesimi: true }) }],
    { 2026: oreInMinuti('11,00', { centesimi: true }) });
  assert.equal(oreCentesimi(s.saldo), '159,34');
});

test('le ore si scrivono come in ufficio: 176, 176,5, 176:30, 8.30', () => {
  assert.equal(oreInMinuti('176'), 176 * 60);
  assert.equal(oreInMinuti('176,5'), 176 * 60 + 30);
  assert.equal(oreInMinuti('176:30'), 176 * 60 + 30);
  assert.equal(oreInMinuti('8.30'), 8 * 60 + 30, '«8.30» sono 8 ore e mezza, come nel resto della scheda');
  assert.equal(oreInMinuti(''), null);
  assert.ok(Number.isNaN(oreInMinuti('tante')));
  assert.equal(oreInMinuti('8.30', { centesimi: true }), 8 * 60 + 18, 'dalla busta paga «8.30» sono 8,30 ore');
  assert.equal(oreInMinuti('8:30', { centesimi: true }), 8 * 60 + 30);
});

test('«Ex festività» e «ROL» sono assenze, non dettaglio attività', () => {
  assert.equal(famigliaCausale('Ex festività'), 'assenza');
  assert.equal(famigliaCausale('ROL'), 'assenza');
});

test('le spettanze arrivano dal database come testo («9597.60»): si sommano, non si concatenano', () => {
  const s = saldoMonte(2026, [{ anno: 2026, spettanza_min: '9597.60', residuo_iniziale_min: '5640.00' }], { 2026: 7800 });
  assert.equal(s.saldo, 5640 + 9597.6 - 7800);
  assert.equal(oreCentesimi(s.saldo), '123,96');
});

// Le ore in GIORNI sull'orario vero (02/10/2026, scelta dell'utente):
// part-time verticale lunedì 6 h, martedì-giovedì 8 h → un giorno vale 7,5 h.
import { orarioValido, inGiorni, testoGiorni } from '../js/presenze-doc.js';
const orarioRenato = { dal: '2026-01-01', lun_min: 360, mar_min: 480, mer_min: 480, gio_min: 480, ven_min: 0, sab_min: 0, dom_min: 0 };

test('100 ore di ferie sono 13,3 giorni: 3 settimane piene e 10 ore', () => {
  const g = inGiorni(100 * 60, orarioRenato);
  assert.equal(Math.round(g.giorni * 10) / 10, 13.3);
  assert.equal(g.settimane, 3);
  assert.equal(g.restoMin, 600);
  assert.equal(testoGiorni(100 * 60, orarioRenato), '≈ 13,3 giorni (3 settimane e 10:00 h)');
  assert.equal(testoGiorni(30 * 60, orarioRenato), '≈ 4 giorni (1 settimana)');
  assert.equal(testoGiorni(7.5 * 60, orarioRenato), '≈ 1 giorno');
});

test('senza orario i giorni non si inventano', () => {
  assert.equal(testoGiorni(6000, null), '');
  assert.equal(testoGiorni(6000, { dal: '2026-01-01' }), '', 'un orario tutto a zero non è un orario');
});

test('vale l\'orario in vigore alla data: un cambio non riscrive il passato', () => {
  const dopo = { ...orarioRenato, dal: '2027-01-01', lun_min: 480 };
  assert.equal(orarioValido([orarioRenato, dopo], '2026-10-02').dal, '2026-01-01');
  assert.equal(orarioValido([orarioRenato, dopo], '2027-03-01').dal, '2027-01-01');
  assert.equal(orarioValido([dopo], '2026-10-02'), null);
});

// Totale delle giornate disponibili (02/10/2026): ferie + ex festività, senza banca ore.
import { totaleSaldi } from '../js/presenze-doc.js';

test('totale: ferie + ex festività; il ROL vuoto non si cita, quello usato senza spettanza sì', () => {
  const ferie = saldoMonte(2026, [{ anno: 2026, spettanza_min: '9600.00', residuo_iniziale_min: '5640.00' }], { 2026: 154 * 60 });
  const exf = saldoMonte(2026, [{ anno: 2026, spettanza_min: '1600.80', residuo_iniziale_min: '9154.80' }], { 2026: 11 * 60 });
  const rolVuoto = saldoMonte(2026, [], {});
  const t = totaleSaldi([{ nome: 'Ferie', saldo: ferie }, { nome: 'Ex festività', saldo: exf }, { nome: 'ROL / PAR', saldo: rolVuoto }], 9);
  assert.equal(oreCentesimi(t.saldo), '268,26');          // 100,00 + 168,26
  assert.deepEqual(t.nomi, ['Ferie', 'Ex festività']);
  assert.deepEqual(t.senza, []);
  assert.equal(testoGiorni(t.saldo, orarioRenato), '≈ 35,8 giorni (8 settimane e 28:16 h)');
  const rolUsato = saldoMonte(2026, [], { 2026: 120 });
  assert.deepEqual(totaleSaldi([{ nome: 'Ferie', saldo: ferie }, { nome: 'ROL / PAR', saldo: rolUsato }], 9).senza, ['ROL / PAR']);
});

test('senza nessuna spettanza non c\'è un totale', () => {
  assert.equal(totaleSaldi([{ nome: 'Ferie', saldo: saldoMonte(2026, [], { 2026: 600 }) }], 9), null);
});

// Tessere in giorni (variante B, 02/10/2026): numero grande e settimane.
import { giorniNumero, settimaneGiorni } from '../js/presenze-doc.js';

test('tessere: il numero grande è in giorni, le settimane stanno sotto', () => {
  assert.equal(giorniNumero(221.59 * 60, orarioRenato), '29,5');
  assert.equal(settimaneGiorni(221.59 * 60, orarioRenato), '7 settimane e 1,5 giorni');
  assert.equal(giorniNumero(60 * 60, orarioRenato), '8');
  assert.equal(settimaneGiorni(60 * 60, orarioRenato), '2 settimane');
  assert.equal(settimaneGiorni(7.5 * 60, orarioRenato), '1 giorno');
  assert.equal(giorniNumero(6000, null), '', 'senza orario niente giorni');
});
