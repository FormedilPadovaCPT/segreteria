// La coda della lettera mensile di incarico in tre parti (07/10/2026, proposta approvata dall'utente):
// avviso del mese per tutti (s_incarichi_avvisi), nota per il singolo tecnico, testo fisso modificabile (s_config,
// storico in s_config_storia). Le annotazioni dell'app vanno in note_interne e non in lettera; le emoji non escono
// più «??»; tolta la riga che ripeteva il punto 1. Girano con `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { testoPdf } from '../js/comune.js';

const ft = fs.readFileSync(new URL('../js/fatture-tecnici.js', import.meta.url), 'utf8');
const doc = fs.readFileSync(new URL('../js/fatture-tecnici-doc.js', import.meta.url), 'utf8');
const aiuto = fs.readFileSync(new URL('../js/aiuto.js', import.meta.url), 'utf8');

test('le emoji nel PDF spariscono invece di diventare «??»', () => {
  assert.equal(testoPdf('📌 Assegnazione cantieri'), ' Assegnazione cantieri');
  assert.equal(testoPdf('📩 posta ✉️'), ' posta ');
  assert.equal(testoPdf('→ ✓ ☐'), '-> v [ ]', 'le traduzioni di prima restano');
  assert.equal(testoPdf('Città più €'), 'Città più €');
  assert.equal(testoPdf('Łódź'), '?ód?', 'una lettera che il PDF non ha resta segnata, non sparisce');
});

test('la lettera: avviso, nota, testo fisso; niente riga ripetuta', () => {
  const coda = doc.slice(doc.indexOf('la coda in tre parti'));
  const iA = coda.indexOf('if (d.avviso)'), iN = coda.indexOf('if (inc.note)'), iT = coda.indexOf('if (d.testo)');
  assert.ok(iA > 0 && iA < iN && iN < iT, 'in quest\'ordine');
  assert.ok(!/c\.scrivi\(`L'incarico vale per il mese indicato/.test(doc), 'tolta la riga che ripeteva il punto 1');
  assert.ok(/\$\{d\.avviso \? `\\n\$\{d\.avviso\}\\n` : ''\}\$\{inc\.note \?/.test(ft), 'anche nella mail');
});

test('l\'avviso del mese: si legge o la lettera non parte; il mese prima si ripropone ma non esce da solo', () => {
  assert.ok(/from\('s_incarichi_avvisi'\)\.select\('testo'\)\.eq\('anno', inc\.anno\)\.eq\('mese', inc\.mese\)/.test(ft));
  assert.ok(/if \(eAv\) throw new Error\('Non sono riuscito a leggere l\\'avviso del mese: '/.test(ft), 'lettura fallita = niente lettera');
  assert.ok(/non ancora salvato: nelle lettere non esce/.test(ft), 'il ripreso dal mese prima è dichiarato');
  assert.ok(/: await sb\.from\('s_incarichi_avvisi'\)\.delete\(\)/.test(ft), 'vuoto = avviso tolto');
});

test('testo fisso dall\'app, annotazioni interne fuori dalla lettera', () => {
  assert.ok(/sb\.from\('s_config'\)\.update\(\{ valore: v, updated_by: state\.email/.test(ft) && /\.eq\('chiave', 'incarico_visite_testo'\)/.test(ft));
  assert.ok(/if \(!v\) return toast\('Il testo fisso non può essere vuoto/.test(ft));
  assert.ok(/note_interne: inc\.note_interne \?/.test(ft) && !/note: inc\.note \? `\$\{inc\.note\}\\n\$\{nota\}` : nota/.test(ft), 'la chiusura senza attività scrive nelle annotazioni interne');
  for (const id of ['ft-avviso-salva', 'ft-testo-fisso', 'ft-tf-salva']) assert.ok(aiuto.includes(`"${id}": "`), `nuvoletta ${id}`);
  const sql = fs.readFileSync(new URL('../supabase/sql/2026_10_07_lettera_incarico_testi.sql', import.meta.url), 'utf8');
  assert.ok(/create table if not exists public\.s_incarichi_avvisi/.test(sql) && /create trigger trg_s_config_storia/.test(sql) && /9\) Comunicazioni con il CPT/.test(sql));
});
