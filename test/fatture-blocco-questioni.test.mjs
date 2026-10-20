// node --test test/fatture-blocco-questioni.test.mjs
// (20/10/2026) Una fattura che copre un verbale con una questione aperta (segnalata dal Coordinatore e non chiusa,
// o verbale riaperto e non richiuso) non va in pagamento. Il blocco vero è nel database (trigger su
// s_fatture_tecnici, gestionale-visite/supabase/sql/2026_10_20_questioni_verbali.sql; prova in tests-db/45):
// qui si tiene fermo che la segreteria lo veda PRIMA, e che il mandato non prenda un numero per fatture bloccate.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const leggi = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const mandati = leggi('js/fatture-tecnici-mandati.js');
const fatture = leggi('js/fatture-tecnici-fatture.js');

test('il mandato controlla i verbali prima di prendere il numero', () => {
  const controllo = mandati.indexOf("sb.rpc('fattura_questioni_aperte', { p_fatture: ids })");
  const numero = mandati.indexOf("sb.from('s_mandati_pagamento').insert(");
  assert.ok(controllo > 0, 'il controllo c\'è');
  assert.ok(numero > 0 && controllo < numero, 'e viene prima del numero del mandato, che non va bruciato');
  assert.match(mandati, /if \(eBB\) throw new Error\('Non sono riuscito a controllare/, 'una lettura fallita ferma il mandato, non lo lascia passare');
});

test('le fatture bloccate non si spuntano per il mandato', () => {
  assert.match(mandati, /bloccate\[f\.id\] \? 'disabled title="Ha verbali con questioni aperte"' : 'checked'/);
});

test('se le fatture non passano «in mandato» lo si dice', () => {
  assert.match(mandati, /const \{ error: eMand \} = await sb\.from\('s_fatture_tecnici'\)\.update\(\{ stato: 'mandato'/);
  assert.match(mandati, /if \(eMand\) throw new Error/);
});

test('il dettaglio della fattura dice perché non può andare in pagamento', () => {
  assert.match(fatture, /sb\.rpc\('fattura_questioni_aperte', \{ p_fatture: \[f\.id\] \}\)/);
  assert.match(fatture, /⛔ Non può andare in pagamento:/);
  assert.match(fatture, /blocco\.error \?/, 'e se la lettura fallisce lo dice invece di tacere');
});
