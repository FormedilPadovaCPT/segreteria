// Mappa delle aree dei tecnici e quartieri condivisi (07/10/2026, chiesto dall'utente).
// La mappa colora i comuni ISTAT per area, Padova a schema coi 6 quartieri, a strisce ciò che è in più aree,
// tratteggiato ciò che non ha area; i nomi dei comuni soppressi contano solo se il comune nuovo non ha area.
// La scheda «Tecnici e zone» condivide un comune (zone_condividi) senza toglierlo all'area di prima.
// Girano con `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calcolaMappa, disegna, norm } from '../js/mappa-zone.js';

const geo = JSON.parse(fs.readFileSync(new URL('../img/mappa-comuni-pd.json', import.meta.url), 'utf8'));
const nomi = geo.comuni.map((c) => c.nome);
const aree = [{ area_id: 51, tecnici: ['De Marco Nicola'] }, { area_id: 53, tecnici: ['Visentini Tommaso'] }, { area_id: 58, tecnici: ['Cuccato'] }];

test('i confini: 101 comuni ISTAT della provincia, Padova compresa, coi comuni fusi di oggi', () => {
  assert.equal(geo.comuni.length, 101);
  for (const n of ['PADOVA', 'BORGO VENETO', 'SANTA CATERINA D ESTE', 'VO', 'ARQUA PETRARCA']) assert.ok(geo.comuni.some((c) => c.norm === n), n);
  assert.ok(geo.comuni.every((c) => /^M[\d.,LMZ-]+Z$/.test(c.d) && c.x > 0 && c.y > 0), 'percorsi e punti dei nomi');
  assert.ok(fs.statSync(new URL('../img/mappa-comuni-pd.json', import.meta.url)).size < 80000, 'leggero');
});

test('i nomi delle zone si riconoscono anche scritti diversi', () => {
  assert.equal(norm("ARQUA' PETRARCA"), norm('Arquà Petrarca'));
  assert.equal(norm("VO'"), norm("Vo'"));
  const m = calcolaMappa(aree, [{ area_id: 51, comune_nome: 'GAZZO PADOVANO' }, { area_id: 58, comune_nome: "MASERA' DI PADOVA" }], nomi);
  assert.deepEqual(m.comune.GAZZO, [51]);
  assert.deepEqual(m.comune['MASERA DI PADOVA'], [58]);
  assert.deepEqual(m.fuori, []);
});

test('quartiere condiviso: due aree, a strisce', () => {
  const m = calcolaMappa(aree, [
    { area_id: 51, comune_nome: 'PADOVA', quartiere: 1 }, { area_id: 53, comune_nome: 'PADOVA', quartiere: 1 },
    { area_id: 51, comune_nome: 'PADOVA', quartiere: 2 }], nomi);
  assert.deepEqual(m.quartiere[1], [51, 53]);
  assert.deepEqual(m.quartiere[2], [51]);
  const svg = disegna(geo, m);
  assert.ok(/<pattern id="str-51-53"/.test(svg), 'strisce coi due colori');
  assert.ok(/Q1 Centro/.test(svg) && /Padova, i 6 quartieri \(schema\)/.test(svg), 'riquadro a schema');
});

test('comuni soppressi: contano solo se il comune nuovo non ha area', () => {
  let m = calcolaMappa(aree, [{ area_id: 58, comune_nome: 'BORGO VENETO' }, { area_id: 51, comune_nome: 'SALETTO' }], nomi);
  assert.deepEqual(m.comune['BORGO VENETO'], [58], 'Borgo Veneto ha la sua area: Saletto non la cambia');
  m = calcolaMappa(aree, [{ area_id: 58, comune_nome: 'CARCERI' }], nomi);
  assert.deepEqual(m.comune['SANTA CATERINA D ESTE'], [58], 'senza area propria vale il nome vecchio');
  assert.deepEqual(m.soppressiUsati, ['CARCERI']);
});

test('i comuni senza area si vedono', () => {
  const m = calcolaMappa(aree, [{ area_id: 51, comune_nome: 'LIMENA' }], nomi);
  assert.equal(m.senzaArea.length, 99, 'tutti tranne Limena e Padova');
  assert.ok(/url\(#senza-area\)/.test(disegna(geo, m)));
});

test('la scheda Tecnici e zone: condividi, segno ⇄, mappa', () => {
  const zt = fs.readFileSync(new URL('../js/zone-tecnici.js', import.meta.url), 'utf8');
  assert.ok(/sb\.rpc\('zone_condividi', \{ p_comune: r\.comune_nome, p_quartiere: r\.quartiere, p_area: Number\(dest\.value\) \}\)/.test(zt), 'dal clic sul comune');
  assert.ok(/\? await sb\.rpc\('zone_condividi', \{ p_comune: c, p_quartiere: q, p_area: area \}\)/.test(zt), 'da «+ Comune» con la spunta');
  assert.ok(/zt-condiviso/.test(zt) && /' ⇄' : ''/.test(zt), 'i condivisi hanno il segno');
  assert.ok(/import\('\.\/mappa-zone\.js'\)/.test(zt) && /id="zt-mappa"/.test(zt), 'il pulsante della mappa');
  const sql = fs.readFileSync(new URL('../supabase/sql/2026_10_07_zone_condivise.sql', import.meta.url), 'utf8');
  assert.ok(/drop index if exists public\.zone_aree_comuni_uno_aperto;/.test(sql) && /zone_aree_comuni_uno_aperto_per_area/.test(sql), 'un comune una volta per area');
});
