// node test/presa-visione-evidente.test.mjs
// (12/10/2026, chiesto da Patrizia) La presa visione del mandato: riquadro arancione con freccia e pulsante
// grande nel pannello, e in cima alla pagina Amministrazione l'avviso che apre il primo mandato da firmare.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../js/amministrazione.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
assert.ok(/class="btn btn-primary mp-firma-btn" id="mp-visto">✍️ Prendo visione e firmo</.test(js), 'pulsante grande nel pannello');
assert.ok(!/btn-sm" id="mp-visto"/.test(js), 'il pulsante piccolo non c\'è più');
assert.ok(/id="mp-apri-primo"/.test(js) && /\$\('#mp-apri-primo'\)\?\.addEventListener\('click', \(\) => dettaglioMandato\(primo\.id\)\)/.test(js), 'avviso in cima che apre il primo');
assert.ok(/\.mp-firma-btn\{[^}]*font-size:17px/.test(css) && /@keyframes mpFreccia/.test(css) && /prefers-reduced-motion:reduce\)\{\.mp-freccia/.test(css), 'stile: grande, freccia che si muove, ferma per chi lo chiede');
console.log('ok — presa visione in evidenza');
