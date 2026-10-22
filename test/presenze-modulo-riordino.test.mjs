// Il modulo della richiesta riordinato dalla scansione corretta a mano dall'utente (22/10/2026,
// richiesta n° 17): in alto solo «Questa richiesta»; il saldo dopo la richiesta nella riga del periodo
// (sezione 3); nella sezione 1 solo il nome; la data della richiesta dopo «Padova, lì».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../js/presenze-doc.js', import.meta.url), 'utf8');
const pdf = doc.slice(doc.indexOf('export async function pdfRichiestaFerie'), doc.indexOf('export function testoSaldoRichiesta'));

test('in alto solo «Questa richiesta», senza il numero grande', () => {
  const testa = pdf.slice(pdf.indexOf('const card = cardRichiesta'), pdf.indexOf('let nSez'));
  assert.match(testa, /T\('QUESTA RICHIESTA', xd/);
  assert.doesNotMatch(testa, /T\(card\.grande/);
});

test('il saldo sta nella sezione 3, solo quando la card dice un saldo', () => {
  const sez3 = pdf.slice(pdf.indexOf("sezione(3, 'PERIODO RICHIESTO')"), pdf.indexOf('/* 4: da dove vengono le ore'));
  assert.match(sez3, /if \(cardSaldo\) \{[\s\S]*T\('DOPO LA RICHIESTA'[\s\S]*T\(card\.grande/);
});

test('sezione 1 col solo nome, la data della richiesta dopo «Padova, lì»', () => {
  const sez1 = pdf.slice(pdf.indexOf("sezione(1, 'DATI DEL RICHIEDENTE')"), pdf.indexOf("sezione(2, 'TIPO DI RICHIESTA')"));
  assert.doesNotMatch(sez1, /DATA RICHIESTA|'ORE'/);
  assert.match(pdf, /T\('Padova, lì'[^\n]*\n\s*T\(dataIt\(\(r\.created_at/);
});
