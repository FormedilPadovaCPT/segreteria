// node test/imprese-previste.test.mjs
// (06/11/2026, chiesto dall'utente) Imprese previste anche sui cantieri senza CNCE: la segreteria le indica dalla
// pratica, legate al cantiere; quelle della Cassa restano legate al CNCE e non si toccano.
import assert from 'node:assert';
import fs from 'node:fs';
import { filtroPreviste, previsteUniche } from '../js/imprese-previste-regole.js';

/* il filtro legge le due fonti, e solo quelle che ci sono */
assert.strictEqual(filtroPreviste('C9013755684', 'daf47bd8'), 'cnce.eq."C9013755684",cantiere_id.eq."daf47bd8"');
assert.strictEqual(filtroPreviste('', 'daf47bd8'), 'cantiere_id.eq."daf47bd8"', 'cantiere senza CNCE: solo le righe del cantiere');
assert.strictEqual(filtroPreviste('C1', null), 'cnce.eq."C1"');
assert.strictEqual(filtroPreviste('C"1,x', ''), 'cnce.eq."C1,x"', 'virgolette tolte: il valore resta fra virgolette e non rompe il filtro');

/* una impresa una volta sola, e vince la Cassa */
const u = previsteUniche([
  { impresa_cf: '00251920286', impresa_nome: 'GALIAZZO', fonte: 'segreteria' },
  { impresa_cf: '00251920286 ', impresa_nome: 'GALIAZZO F.LLI', fonte: 'cassa' },
  { impresa_cf: '0123', impresa_nome: 'ALFA', fonte: 'segreteria' },
  { impresa_cf: '', impresa_nome: 'senza codice' },
]);
assert.strictEqual(u.length, 2);
assert.strictEqual(u[0].impresa_nome, 'ALFA');
assert.strictEqual(u[1].fonte, 'cassa');

/* il riquadro: righe della Cassa senza ✕, si cancellano solo quelle della segreteria */
const js = fs.readFileSync(new URL('../js/imprese-previste.js', import.meta.url), 'utf8');
assert.ok(/\.delete\(\)\.eq\('id', id\)\.eq\('fonte', 'segreteria'\)/.test(js), 'si toglie solo una riga della segreteria');
assert.ok(/fonte: 'segreteria'/.test(js), 'la riga nuova dice che è della segreteria');
assert.ok(/r\.fonte === 'segreteria' \? `<button/.test(js), 'la ✕ solo sulle righe della segreteria');
const ci = fs.readFileSync(new URL('../js/cantiere-incarico.js', import.meta.url), 'utf8');
assert.strictEqual((ci.match(/Previste\.collega\(p\)/g) || []).length, 2, 'il riquadro si rifà col cantiere scelto e dopo il salvataggio');

console.log('imprese-previste: tutto ok');
