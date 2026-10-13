// (13/10/2026, chiesto dall'utente) le ricerche delle imprese dicono lo stato:
// stato nella lista della Cassa e cessazione nel Registro Imprese. La cessata in
// Cassa può entrare in un verbale; la cessata nel Registro Imprese «deve sparire».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const imp = readFileSync(new URL('../js/imprese.js', import.meta.url), 'utf8');
const ra = readFileSync(new URL('../js/ricerca-anagrafica.js', import.meta.url), 'utf8');

test('la ricerca mostra lo stato in Cassa e la cessazione dalla stessa RPC', () => {
  assert.match(imp, /pillCassa\(i\.stato_cassa\)/);
  assert.match(imp, /i\.cessata_il \? ` <span class="pill"/);
  assert.doesNotMatch(imp, /cessate\.set\(/, 'niente più lettura a parte senza controllo dell’errore');
});

test('attiva o sospesa contano come iscritte (regola del 01/10/2026)', () => {
  const corpo = imp.slice(imp.indexOf('function pillCassa'), imp.indexOf('/* ══════════════ SCHEDA'));
  const pillCassa = new Function('esc', corpo + '\nreturn pillCassa')((s) => String(s));
  assert.match(pillCassa('Sospesa'), /pill-prima/);
  assert.match(pillCassa('Attiva', true), /C\.E\.I\.V\. attiva/);
  assert.match(pillCassa('Cessata'), /pill-off/);
  assert.equal(pillCassa(''), '');
  assert.match(imp, /\/\^\(attiva\|sospesa\)\$\/i\.test\(String\(i\.stato_cassa/, 'il logo della scheda è acceso anche per le sospese');
});

test('il selettore delle imprese toglie le cessate nel Registro Imprese, non quelle in Cassa', () => {
  assert.match(ra, /filter\(\(r\) => !cessataOggi\(r\)\)/);
  const corpo = ra.slice(ra.indexOf('export function cessataOggi'), ra.indexOf('/* La riga completa'));
  const cessataOggi = new Function(corpo.replace('export ', '') + '\nreturn cessataOggi')();
  assert.equal(cessataOggi({ cessata_il: '2020-01-01' }), true);
  assert.equal(cessataOggi({ cessata_il: '2999-01-01' }), false, 'cessazione futura: ancora sceglibile');
  assert.equal(cessataOggi({ stato_cassa: 'Cessata' }), false, 'la cessata in Cassa resta');
  assert.equal(cessataOggi({}), false);
});
