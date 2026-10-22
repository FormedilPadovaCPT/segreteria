// La firma del dipendente sul modulo della richiesta (22/10/2026, chiesto dall'utente): la firma
// scansionata della segreteria va SOLO sulle richieste di chi la possiede, in tutti e tre i punti in
// cui il modulo si genera (scarica, mail al Direttore, visto del Direttore). Si legge il file come
// testo: presenze.js importa Supabase e in Node non si carica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../js/presenze-doc.js', import.meta.url), 'utf8');

test('la firma si legge da s_config e vale solo per il dipendente che la possiede', () => {
  assert.match(src, /'segreteria_firma_id', 'segreteria_firma_nome'/);
  const corpo = src.slice(src.indexOf('async function firmaDipendente'), src.indexOf('async function firmaDipendente') + 600);
  assert.match(corpo, /r\.dipendente[\s\S]*!==[\s\S]*conf\.segreteria_firma_nome/);
  assert.match(corpo, /leggiByte\(conf\.segreteria_firma_id\)/);
  assert.match(corpo, /catch \{ return null; \}/, 'se la lettura non riesce il modulo esce senza firma');
});

test('tutti i moduli generati portano la firma del dipendente', () => {
  const chiamate = src.match(/pdfRichiestaFerie\([^;]*\);/g) || [];
  assert.equal(chiamate.length, 3);
  for (const c of chiamate) assert.match(c, /await firmaDipendente\(r\)\)/, c);
});

test('nel PDF: riga «Firma del dipendente» sempre, immagine solo se c’è la firma', () => {
  assert.match(doc, /export async function pdfRichiestaFerie\(r, visto, firmaByte, saldo, et = \{\}, firmaDip = null\)/);
  assert.match(doc, /if \(firmaDip\) \{[\s\S]*embedPng\(firmaDip\)/);
  assert.match(doc, /T\('Firma del dipendente', xf, yl - 11/);
});
