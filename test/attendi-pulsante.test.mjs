// Il pulsante che resta con la rotellina (28/09/2026). Dati INVENTATI.
//
// Dopo un await, event.currentTarget vale null: `attendi(ev.currentTarget, false)`
// scritto dopo un await esce alla prima riga (`if (!btn) return`) e non
// riabilita niente. Dove la scheda non viene ridisegnata subito dopo —
// i rami di errore — il pulsante resta spento finché non si ricarica.
// Erano 106 chiamate in 25 moduli. Il pulsante si salva all'inizio del
// gestore (`const btn = ev.currentTarget;`) e si usa quello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const JS = fileURLToPath(new URL('../js/', import.meta.url));

// core.js non si importa da Node (usa il documento): si prende la funzione dal sorgente
const sorgente = readFileSync(JS + 'core.js', 'utf8').match(/export function attendi[\s\S]*?\r?\n}\r?\n/)[0];
const attendi = new Function('return ' + sorgente.replace('export ', ''))();

class Pulsante extends EventTarget { dataset = {}; innerHTML = 'Salva'; disabled = false; }
const salvataggioFallito = () => Promise.resolve({ error: { message: 'rete assente' } });
async function premi(gestore) {
  const b = new Pulsante();
  b.addEventListener('click', gestore);
  b.dispatchEvent(new Event('click'));
  await new Promise((r) => setTimeout(r, 5));
  return b;
}

test('il difetto esiste: dopo un await currentTarget è vuoto e il pulsante resta spento', async () => {
  let visto = 'mai letto';
  const b = await premi(async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await salvataggioFallito();
    visto = ev.currentTarget;
    attendi(ev.currentTarget, false);
    if (error) return;
  });
  assert.equal(visto, null);
  assert.equal(b.disabled, true, 'se questo cambia, il browser non si comporta più così e la regola va riletta');
});

test('col pulsante salvato all\'inizio il ramo di errore lo riaccende', async () => {
  const b = await premi(async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true);
    const { error } = await salvataggioFallito();
    attendi(btn, false);
    if (error) return;
  });
  assert.equal(b.disabled, false);
  assert.equal(b.innerHTML, 'Salva');
});

/* Il controllo sui moduli. Vieta la forma anche prima di un await, dove
   funzionerebbe: costa una riga e non obbliga chi legge a contare gli await. */
const VIETATO = /attendi\(\s*\w+\.currentTarget\s*,\s*false|\.currentTarget\.disabled\s*=\s*false/;
const trova = (testo) => testo.split(/\r?\n/).map((r, i) => (VIETATO.test(r) ? i + 1 : 0)).filter(Boolean);

test('il controllo sa fallire: riconosce le due forme sbagliate', () => {
  assert.deepEqual(trova('a\n  if (error) { attendi(ev.currentTarget, false); return; }\n'), [2]);
  assert.deepEqual(trova('attendi(e.currentTarget, false);'), [1]);
  assert.deepEqual(trova('} finally { ev.currentTarget.disabled = false; }'), [1]);
  assert.deepEqual(trova('attendi(ev.currentTarget, true);\nattendi(btn, false);'), []);
});

test('nessun modulo riaccende il pulsante passando da currentTarget', () => {
  const trovati = [];
  for (const f of readdirSync(JS).filter((x) => x.endsWith('.js'))) {
    for (const riga of trova(readFileSync(JS + f, 'utf8'))) trovati.push(`js/${f}:${riga}`);
  }
  assert.deepEqual(trovati, [], 'salvare il pulsante all\'inizio del gestore: const btn = ev.currentTarget;');
});
