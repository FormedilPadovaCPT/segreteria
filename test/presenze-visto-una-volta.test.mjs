// Il visto del Direttore si registra una volta sola (22/10/2026): la richiesta n° 17 è stata approvata
// tre volte dal telefono e su Drive sono finiti tre moduli col visto. Prima di depositare si rilegge
// lo stato dal database. Si legge il file come testo: presenze.js importa Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');

test('decidiRichiesta rilegge lo stato PRIMA di depositare il modulo su Drive', () => {
  const corpo = src.slice(src.indexOf('async function decidiRichiesta'), src.indexOf('function esitoCartaceo'));
  const rilettura = corpo.indexOf(".select('aut_stato').eq('id', r.id)");
  const deposito = corpo.indexOf("action: 'upload'");
  assert.ok(rilettura > 0, 'rilegge lo stato');
  assert.ok(deposito > rilettura, 'la rilettura viene prima del deposito');
  assert.match(corpo, /\['approvata', 'respinta'\]\.includes\(ora\.aut_stato\)[\s\S]*?return;/);
  assert.match(corpo, /if \(errOra\) throw/, 'se non si rilegge, non si deposita');
});

test('per il Direttore la lista si ridisegna in #presenze-host, senza «host is null» (foto del 22/10/2026)', () => {
  const corpo = src.slice(src.indexOf('async function renderFerie'), src.indexOf('async function renderFerie') + 900);
  assert.match(corpo, /\|\| \$\('#pz-corpo'\) \|\| \(state\.soloDirettore \? \$\('#presenze-host'\) : null\)/);
  assert.match(corpo, /if \(!host\) return;/);
});
