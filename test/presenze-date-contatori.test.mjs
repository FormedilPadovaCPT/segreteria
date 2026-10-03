// node test/presenze-date-contatori.test.mjs
// (03/10/2026, da CodeQL #19 «DOM text reinterpreted as HTML») Le due date dei contatori si leggono da campi della
// pagina e tornano nell'HTML: si accettano solo se sono date, e nell'HTML passano da esc().
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const qui = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(qui, '..', 'js', 'presenze.js'), 'utf8');

const m = src.match(/const soloData = \(v, ripiego\) => \([^\n]+\);/);
assert.ok(m, 'non trovo soloData in presenze.js');
const soloData = new Function(m[0] + ' return soloData;')();
assert.strictEqual(soloData('2026-10-03', 'x'), '2026-10-03');
assert.strictEqual(soloData('', '2026-01-01'), '2026-01-01', 'un campo svuotato lascia la data di prima');
assert.strictEqual(soloData('"><img src=x onerror=alert(1)>', '2026-01-01'), '2026-01-01', 'quello che non è una data non entra');
assert.strictEqual(soloData('2026-10-03T10:00', '2026-01-01'), '2026-01-01');
assert.strictEqual(soloData(undefined, '2026-01-01'), '2026-01-01');

assert.ok(src.includes('value="${esc(contDa)}"') && src.includes('value="${esc(contA)}"'), 'le due date entrano nell’HTML passando da esc()');
assert.ok(!/value="\$\{cont(Da|A)\}"/.test(src), 'le date non devono tornare nell’HTML così come sono');
assert.ok(src.includes('contDa = soloData(e.target.value, contDa)') && src.includes('contA = soloData(e.target.value, contA)')
  && src.includes('contDa = soloData(b.dataset.da, contDa); contA = soloData(b.dataset.a, contA)'), 'ogni lettura dalla pagina passa da soloData');
console.log('presenze-date-contatori: ok');
