// node --test test/chiusura-cantiere-incarichi.test.mjs
// (05/10/2026) Nel cruscotto, chiudendo un cantiere proposto dal tecnico, la conferma dice quali incarichi si
// chiudono con lui e quali restano aperti (incarichi_del_cantiere). La chiusura vera la fa il database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const home = readFileSync(new URL('../js/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const pezzo = home.match(/async function incarichiDelCantiere\(cantiereId\) \{[\s\S]*?\n\}\n/);
const crea = (risposta) => new Function('sb', pezzo[0] + '\nreturn incarichiDelCantiere;')({ rpc: async (f) => { assert.equal(f, 'incarichi_del_cantiere'); return risposta; } });

test('la funzione esiste e la conferma la legge prima di chiudere', () => {
  assert.ok(pezzo, 'manca incarichiDelCantiere in js/home.js');
  assert.match(home, /const inc = await incarichiDelCantiere\(p\.cantiere_id\);\n    if \(!confirm\(`[^`]*\$\{inc\}/);
});

test('nomina chi si chiude e chi resta, col perché', async () => {
  const t = await crea({ data: [
    { id: 965, tipo_richiesta: 'Serie di visite', tecnico_nome: 'Tecnico Uno', si_chiude: true, stage: false, altri_cantieri_aperti: 0 },
    { id: 975, tipo_richiesta: 'Serie di visite', tecnico_nome: 'Tecnico Due', si_chiude: false, stage: false, altri_cantieri_aperti: 1 },
  ], error: null })('C1');
  assert.ok(t.includes("Si chiude anche l'incarico:\n· #965 Serie di visite — Tecnico Uno"));
  assert.ok(t.includes('· #975 Serie di visite — Tecnico Due (ha un altro cantiere aperto)'));
});

test('nessun incarico: niente da aggiungere; lettura fallita: si dice', async () => {
  assert.equal(await crea({ data: [], error: null })('C1'), '');
  const t = await crea({ data: null, error: { message: 'timeout' } })('C1');
  assert.match(t, /Non sono riuscito a leggere gli incarichi del cantiere \(timeout\)/);
});
