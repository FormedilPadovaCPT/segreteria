// node --test test/oggetto-prefisso-doppio.test.mjs
// (06/11/2026) Il Prot_26-27_0114 è uscito con «FORMEDIL Padova -AREA SICUREZZA E SALUTE-» due volte nell'oggetto:
// send-protocollo mette il prefisso davanti all'oggetto della mail, che lo aveva già, e oggettoUfficio ne toglieva uno solo.
// Ora lo toglie tutte le volte che c'è in testa, e la copia del portale fa lo stesso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { oggettoUfficio, OGGETTO_UFFICIO } from '../js/firma.js';

const P = OGGETTO_UFFICIO;
const radice = join(dirname(fileURLToPath(import.meta.url)), '..');

test('il prefisso ripetuto resta uno solo', () => {
  assert.equal(oggettoUfficio(`${P} ${P} Verbali definitivi`), `${P} Verbali definitivi`);
  assert.equal(oggettoUfficio(`${P} Formedil Padova - Area Sicurezza e Salute - Verbali`), `${P} Verbali`);
});

test('i casi di prima non cambiano', () => {
  assert.equal(oggettoUfficio('Verbali definitivi'), `${P} Verbali definitivi`);
  assert.equal(oggettoUfficio(`${P} Verbali definitivi`), `${P} Verbali definitivi`);
  assert.equal(oggettoUfficio('Formedil Padova - Area Sicurezza e Salute - Verbali'), `${P} Verbali`);
  assert.equal(oggettoUfficio(''), P);
  assert.equal(oggettoUfficio(P), P);
});

test('la forma di send-protocollo con un oggetto che ha già il prefisso', () => {
  const centrale = `${P} Verbali definitivi dei sopralluoghi`;
  assert.equal(oggettoUfficio(`${P} ${centrale} Prot. 0114`), `${P} Verbali definitivi dei sopralluoghi Prot. 0114`);
});

test('la copia del portale toglie il prefisso tutte le volte', () => {
  const ts = readFileSync(join(radice, 'supabase', 'functions', 'portale-richieste', 'mail.ts'), 'utf8');
  assert.match(ts, /while \(PREFISSO_UFFICIO\.test\(resto\)\) resto = resto\.replace\(PREFISSO_UFFICIO, ''\)/);
});
