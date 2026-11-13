// (13/11/2026) NESSUNA SCRITTURA CON L'ESITO NON LETTO.
// supabase-js non lancia quando il database rifiuta: restituisce `error`. Un
// `await sb.from(...).update(...)` il cui risultato non viene assegnato dice «fatto»
// anche quando non è vero. Il 13/11/2026 ce n'erano 58 in 14 moduli (più 22 nelle
// fatture dei tecnici): sono passate tutte da `scrivi()` di core.js, che lancia.
// Questa prova fallisce se ne ricompare una. La seconda parte verifica `scrivi()`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const js = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* fine dell'istruzione che comincia in `i`: il primo «;» a parentesi bilanciate */
function fineIstruzione(t, i) {
  let liv = 0;
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if ('([{'.includes(c)) liv++;
    else if (')]}'.includes(c)) { liv--; if (liv < 0) return -1; }
    else if (c === ';' && liv === 0) return j;
    else if (c === '\'' || c === '"' || c === '`') {
      const q = c; j++;
      while (j < t.length && t[j] !== q) { if (t[j] === '\\') j++; j++; }
    }
  }
  return -1;
}

export function scrittureNonControllate(t) {
  const trovate = [];
  for (const m of t.matchAll(/await\s+sb\s*\.\s*(from|rpc)\(/g)) {
    let k = m.index - 1;
    while (k >= 0 && ' \t'.includes(t[k])) k--;
    const prima = t.slice(Math.max(0, k - 80), k + 1);
    // il risultato è assegnato, restituito o passato a qualcosa (scrivi(…), Promise.all([…]), …)
    if (/(=|return|\(|,|\[|:|\?|&&|\|\||await)\s*$/.test(prima) && !/(\)|else|\{|;|\})\s*$/.test(prima)) continue;
    const j = fineIstruzione(t, m.index);
    if (j < 0) continue;
    const istr = t.slice(m.index, j + 1);
    if (m[1] === 'from' && !/\.(insert|update|delete|upsert)\(/.test(istr)) continue;   // una lettura buttata non fa danni
    trovate.push({ riga: t.slice(0, m.index).split('\n').length, testo: istr.replace(/\s+/g, ' ').slice(0, 110) });
  }
  return trovate;
}

test('il rilevatore vede una scrittura non controllata (la prova sa fallire)', () => {
  const rotto = `async function f() {\n  await sb.from('x').update({ a: 1 }).eq('id', 1);\n  if (y) await sb.from('x').delete().eq('id', 2);\n  await sb.rpc('fai_qualcosa', { p: 1 });\n}`;
  assert.equal(scrittureNonControllate(rotto).length, 3);
  const sano = `async function f() {\n  const { error } = await sb.from('x').update({ a: 1 }).eq('id', 1);\n  await scrivi(sb.from('x').delete().eq('id', 2), 'x');\n  const r = await Promise.all([sb.from('x').select('*')]);\n  await sb.from('x').select('*');\n  return await sb.rpc('leggi');\n}`;
  assert.deepEqual(scrittureNonControllate(sano), []);
});

test('nessun modulo della segreteria ha scritture con l\'esito non letto', () => {
  const colpevoli = [];
  for (const f of fs.readdirSync(js).filter((n) => n.endsWith('.js'))) {
    for (const s of scrittureNonControllate(fs.readFileSync(path.join(js, f), 'utf8'))) colpevoli.push(`${f}:${s.riga} ${s.testo}`);
  }
  assert.deepEqual(colpevoli, [], 'scritture il cui esito non viene letto: passale da scrivi(query, cosa) di core.js');
});

test('scrivi() lancia se il database rifiuta e restituisce i dati se accetta', async () => {
  /* core.js crea il client Supabase all'import: qui se ne prova la sola logica, ricopiata dal sorgente */
  const core = fs.readFileSync(path.join(js, 'core.js'), 'utf8');
  const m = core.match(/export class ErroreScrittura[\s\S]*?\n\}\nexport async function scrivi[\s\S]*?\n\}/);
  assert.ok(m, 'scrivi() ed ErroreScrittura non trovate in core.js');
  const { scrivi, ErroreScrittura } = new Function(m[0].replace(/export /g, '') + '\nreturn { scrivi, ErroreScrittura };')();
  assert.deepEqual(await scrivi(Promise.resolve({ data: [1], error: null }), 'prova'), [1]);
  await assert.rejects(() => scrivi(Promise.resolve({ data: null, error: { message: 'violata la policy' } }), 'Fattura NON annullata'),
    (e) => e instanceof ErroreScrittura && /Fattura NON annullata: violata la policy/.test(e.message));
});
