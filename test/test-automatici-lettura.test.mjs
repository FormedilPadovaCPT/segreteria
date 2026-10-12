// node test/test-automatici-lettura.test.mjs
// (12/10/2026) Il cruscotto diceva «Test del database: nessun giro registrato» con il giro del 05/10 riuscito e
// scritto in s_test_automatici: leggeva le ultime 40 righe delle due suite insieme, e le prove nel browser (più
// giri al giorno) spingevano fuori quella del lunedì. L'ultimo verdetto si legge per suite.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const js = readFileSync(new URL('../js/home.js', import.meta.url), 'utf8');

const m = /const pTestAuto = \(async \(\) => \{ try \{([\s\S]*?)\} catch \(e\) \{ testAutoErr/.exec(js);
assert.ok(m, 'lettura dei verdetti trovata');
assert.ok(!/\.limit\(40\)/.test(m[1]), 'niente più «ultime 40 righe di tutte le suite»');

// prova: 47 righe del browser più recenti non nascondono quella del database
const righe = [{ id: 1, suite: 'database', esito: 'riuscita' }, ...Array.from({ length: 47 }, (_, i) => ({ id: 2 + i, suite: 'browser', esito: 'riuscita' }))];
const sb = { from: () => {
  let suite = null, lim = Infinity;
  const q = { select: () => q, eq: (_c, v) => { suite = v; return q; }, order: () => q, limit: (n) => { lim = n; return q; },
    then: (r) => r({ data: righe.filter(x => !suite || x.suite === suite).sort((a, b) => b.id - a.id).slice(0, lim), error: null }) };
  return q;
} };
const ctx = { testAuto: { database: null, browser: null }, testAutoErr: null };
const corpo = m[1].replace(/testAutoErr/g, 'ctx.testAutoErr').replace(/testAuto\b/g, 'ctx.testAuto');
await new Function('sb', 'ctx', 'return (async()=>{' + corpo + '})()')(sb, ctx);
assert.strictEqual(ctx.testAutoErr, null);
assert.strictEqual(ctx.testAuto.database?.id, 1, 'il giro del database si vede anche dopo 47 giri del browser');
assert.strictEqual(ctx.testAuto.browser?.id, 48, 'del browser l’ultimo');

// una lettura fallita si dice, non diventa «nessun giro»
const sbKo = { from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, then: (r) => r({ data: null, error: { message: 'permesso negato' } }) }; return q; } };
const ctx2 = { testAuto: { database: null, browser: null }, testAutoErr: null };
await new Function('sb', 'ctx', 'return (async()=>{' + corpo + '})()')(sbKo, ctx2);
assert.strictEqual(ctx2.testAutoErr, 'permesso negato');
console.log('ok — verdetti dei test letti per suite');
