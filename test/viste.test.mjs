// Ogni voce del menu deve avere la sua sezione e la sua riga in mostraVista.
// Nato il 10/09/2026: la vista «Stage allievi» aveva pulsante, sezione e rotta
// in app.js, ma mancava nella mappa di core.js — cliccandola si apriva il
// registro di protocollo, e nessun test se n'era accorto.
// Si leggono i file come testo: core.js importa Supabase dal CDN e in Node
// non si carica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const radice = new URL('../', import.meta.url);
const leggi = (f) => readFileSync(new URL(f, radice), 'utf8');

const html = leggi('index.html');
const core = leggi('js/core.js');
const app = leggi('js/app.js');

/* le voci del menu che aprono una vista (data-view), tranne le azioni del protocollo */
const vociMenu = [...new Set([...html.matchAll(/class="nav-item"[^>]*data-view="([a-z-]+)"/g)].map((m) => m[1]))]
  .filter((v) => !['nuovo-in', 'nuovo-out'].includes(v));

/* le chiavi della mappa di mostraVista */
const corpoMappa = core.slice(core.indexOf('export function mostraVista'));
const mappa = corpoMappa.slice(corpoMappa.indexOf('{'), corpoMappa.indexOf('};'));
const chiavi = new Set([...mappa.matchAll(/['"]?([a-z-]+)['"]?\s*:\s*'#view-/g)].map((m) => m[1]));

test('il menu ha delle voci e la mappa delle chiavi', () => {
  assert.ok(vociMenu.length > 10, `voci trovate: ${vociMenu.length}`);
  assert.ok(chiavi.size > 10, `chiavi trovate: ${chiavi.size}`);
});

test('ogni voce del menu è nella mappa di mostraVista (altrimenti si apre il registro)', () => {
  const mancanti = vociMenu.filter((v) => !chiavi.has(v));
  assert.deepEqual(mancanti, [], `da aggiungere in core.js mostraVista: ${mancanti.join(', ')}`);
});

test('ogni voce del menu ha la sua sezione in index.html', () => {
  const idVista = (v) => (mappa.match(new RegExp(`['"]?${v}['"]?\\s*:\\s*'#([a-z-]+)'`)) || [])[1];
  const mancanti = vociMenu.filter((v) => chiavi.has(v) && !html.includes(`id="${idVista(v)}"`));
  assert.deepEqual(mancanti, [], `sezione mancante in index.html per: ${mancanti.join(', ')}`);
});

test('ogni voce del menu ha la sua rotta in app.js', () => {
  const mancanti = vociMenu.filter((v) => v !== 'registro' && !app.includes(`vista === '${v}'`));
  assert.deepEqual(mancanti, [], `rotta mancante in app.js vaiA per: ${mancanti.join(', ')}`);
});
