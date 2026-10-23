// node --test test/lettera-cantieri-proposti.test.mjs
// (23/10/2026) Il tecnico, dalla pagina Scadenze del gestionale, propone di chiudere un cantiere finito.
// Finché la proposta è aperta il rientro non è da assegnare: la lettera di incarico mensile lo toglie,
// come fanno la pagina Scadenze e il promemoria del lunedì (le tre liste coincidono, regola dell'08/09).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../js/fatture-tecnici.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const home = readFileSync(new URL('../js/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('la lettera legge le proposte aperte dei cantieri candidati', () => {
  assert.match(js, /\.from\('cantieri_proposte_chiusura'\)\.select\('cantiere_id'\)\.is\('esito', null\)\.in\('cantiere_id', ids\)/);
});

test('senza saperlo la lettera non si fa', () => {
  assert.match(js, /if \(ePc\) throw new Error\('non sono riuscito a leggere le proposte di chiusura/);
});

test('i cantieri proposti escono dai rientri della lettera', () => {
  assert.match(js, /\.filter\(\(v\) => !cant\[v\.cantiere_id\]\?\.cantiere_chiuso && !proposti\.has\(v\.cantiere_id\)\)/);
});

test('nella Scrivania la proposta dice quando il tecnico ha visto il cantiere finito, e la data va nella nota', () => {
  assert.match(home, /proposta_il, motivo, fine_constatata_il, cantieri\(/);
  assert.match(home, /p\.fine_constatata_il \? ` · finito il \$\{dataIt\(p\.fine_constatata_il\)\}` : ''/);
  assert.match(home, /\(p\.fine_constatata_il \? `Finito il \$\{dataIt\(p\.fine_constatata_il\)\}/);
});
