// node test/mail-pulsante-evidenza.test.mjs
// (12/10/2026) «>>>> Etichetta (nota):» fa il pulsante IN EVIDENZA (a tutta riga, riquadro col bordo
// arancione): lo usano le mail che chiedono a Direttore e Presidente di decidere o firmare.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { corpoInHtml, componiEml } from '../js/firma.js';

const L = 'https://formedilpadovacpt.github.io/segreteria/#visita-12';
const forte = corpoInHtml(`Egr. Direttore,\n\n>>>> ✅ Apri la pratica e autorizza (si apre direttamente nell'app):\n${L}\n\nDistinti saluti.`);
assert.match(forte, /border:3px solid #/, 'riquadro col bordo');
assert.match(forte, /width="100%"/, 'pulsante a tutta riga');
assert.match(forte, /✅ Apri la pratica e autorizza &rarr;/, 'etichetta senza il quarto segno');
assert.doesNotMatch(forte, /&gt;/, 'nessun «>» rimasto nel testo');
assert.match(forte, /👉 Si apre direttamente nell&#39;app|👉 Si apre direttamente nell'app/, 'la nota diventa il titolo, con la maiuscola');

const normale = corpoInHtml(`>>> Apri il mandato nell'app:\n${L}`);
assert.doesNotMatch(normale, /border:3px solid/, 'i tre segni restano il pulsante di sempre');

// i moduli che scrivono a Direttore e Presidente usano la forma in evidenza
const leggi = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
for (const f of ['visite', 'segnalazioni', 'consulenze', 'conferenze', 'presenze']) {
  assert.match(leggi(`../js/${f}.js`), /^>>>> ✅ Apri la (pratica|richiesta) e autorizza/m, f);
}
assert.match(leggi('../js/cantieri-critici-doc.js'), /^>>>> ✅ Apri il caso e conferma/m);
assert.match(leggi('../supabase/functions/approvazione-direttore/index.ts'), /'>>>> ✅ Apri i preventivi e approva/);
assert.match(leggi('../supabase/functions/firma-presidente/index.ts'), /'>>>> ✍️ Apri i documenti e firma/);

// il messaggio intero regge (righe entro i 998 caratteri)
const eml = componiEml({ to: 'x@y.it', oggetto: 'prova', corpo: `>>>> ✅ Apri la pratica e autorizza (nota):\n${L}` });
assert.ok(eml.split('\r\n').every((r) => r.length <= 998));
console.log('ok — pulsante in evidenza per Direttore e Presidente');
