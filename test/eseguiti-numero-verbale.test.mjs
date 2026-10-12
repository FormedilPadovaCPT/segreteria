// node test/eseguiti-numero-verbale.test.mjs
// (12/10/2026) Nel cruscotto, «Visite eseguite dai tecnici» mostrava il codice interno della visita («verbale
// 1a8c54aa-57a1-…») al posto del numero del verbale. Ora si legge visite.nr_verbale; se la lettura fallisce lo si dice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const home = fs.readFileSync(new URL('../js/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
assert.ok(/from\('visite'\)\.select\('visita_id, nr_verbale'\)\.in\('visita_id', conVisita\)/.test(home), 'legge il numero del verbale');
assert.ok(!/verbale \$\{esc\(String\(r\.visita_id\)\)\}/.test(home), 'il codice interno non si mostra più');
assert.ok(/verbale \$\{esc\(String\(r\._nrVerbale\)\)\}/.test(home) && /numero del verbale non letto/.test(home), 'numero, oppure «non letto»');
console.log('ok — numero del verbale nelle visite eseguite');
