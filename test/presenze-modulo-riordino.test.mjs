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

test('il riquadro del saldo sta al punto 4 per tutti i tipi, mai nella riga del periodo (terza scansione)', () => {
  const sez3 = pdf.slice(pdf.indexOf("sezione(3, 'PERIODO RICHIESTO')"), pdf.indexOf('/* 4: da dove vengono le ore'));
  assert.match(sez3, /const riquadroSaldo = \(yy\) => \{[\s\S]*T\('DOPO LA RICHIESTA'[\s\S]*T\(card\.grande/);
  assert.doesNotMatch(sez3, /riquadroSaldo\(y\)/);
  for (const titolo of ["'DETTAGLIO RECUPERO ORE", "'SALDO DEL MONTE ORE'", "'VISITA MEDICA"]) {
    const i = pdf.indexOf(`sezione(4, ${titolo}`);
    assert.ok(i > 0, titolo);
    assert.match(pdf.slice(i, i + 300), /if \(cardSaldo\) riquadroSaldo\(y - 6\)/, titolo);
  }
  assert.doesNotMatch(pdf, /\['Dopo la richiesta', 450\]/, 'la colonna «Dopo la richiesta» delle ferie è sparita');
});

test('la firma di chi chiede anche sulla presa visione, e il riquadro verde per ogni richiesta decisa', () => {
  assert.match(pdf, /T\('Firma del dipendente \(presa visione\)'[\s\S]{0,300}if \(firmaDip\)/);
  const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');
  assert.match(src, /function vistoDaRichiesta\(r\) \{\s*if \(!\['approvata', 'respinta'\]\.includes\(r\.aut_stato\)\) return null;/);
  assert.match(src, /pdfRichiestaFerie\(r, vistoDaRichiesta\(r\), await firmaDirettoreSe\(r\)/);
  assert.match(src, /if \(r\.aut_modalita !== 'app' \|\| !conf\.direttore_firma_id\) return null;/, 'firma del Direttore solo se ha deciso dall’app');
});

test('sezione 1 col solo nome, la data della richiesta dopo «Padova, lì»', () => {
  const sez1 = pdf.slice(pdf.indexOf("sezione(1, 'DATI DEL RICHIEDENTE')"), pdf.indexOf("sezione(2, 'TIPO DI RICHIESTA')"));
  assert.doesNotMatch(sez1, /DATA RICHIESTA|'ORE'/);
  assert.match(pdf, /T\('Padova, lì'[^\n]*\n\s*T\(dataIt\(\(r\.created_at/);
});
