// (13/11/2026) verify_jwt di ogni funzione server sta in supabase/config.toml, non più
// solo nel pannello di Supabase. Qui si controlla che:
//  1. ogni cartella in supabase/functions abbia la sua riga (una funzione nuova non
//     si pubblica «come viene»);
//  2. le funzioni raggiungibili SENZA accesso siano esattamente quelle dell'elenco qui
//     sotto: aprirne una al pubblico vuol dire toccare questo file, cioè deciderlo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toml = fs.readFileSync(path.join(radice, 'supabase', 'config.toml'), 'utf8');

/* lettura minima del TOML: [functions.nome] seguito da verify_jwt = true|false */
const config = {};
for (const m of toml.matchAll(/^\[functions\.([a-z0-9-]+)\]\s*\r?\nverify_jwt\s*=\s*(true|false)/gm)) config[m[1]] = m[2] === 'true';

/* si difendono da sé (parola d'ordine dei giri automatici, tetto di richieste, risposta 410) */
const SENZA_ACCESSO = ['attestati-verifica', 'calendario-post', 'password-dimenticata', 'portale-richieste',
  'posta-locale', 'questionari-pubblica', 'redazione-social', 'ricezione-portale'];

test('ogni funzione server ha la sua riga in config.toml', () => {
  const cartelle = fs.readdirSync(path.join(radice, 'supabase', 'functions'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
  assert.ok(cartelle.length >= 25, 'cartelle delle funzioni non lette');
  assert.deepEqual(cartelle.filter((c) => !(c in config)), [], 'funzioni senza riga in supabase/config.toml');
  assert.deepEqual(Object.keys(config).filter((c) => !cartelle.includes(c)), [], 'righe di config.toml senza cartella');
});

test('senza accesso rispondono solo le funzioni dichiarate', () => {
  assert.deepEqual(Object.keys(config).filter((k) => config[k] === false).sort(), [...SENZA_ACCESSO].sort());
});
