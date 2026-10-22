// (22/10/2026, segnalato dall'utente) la linguetta «Persone» della scheda impresa
// sommava dipendenti, nomine e RLS: 3 persone diventavano 6. Conta le persone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const imp = readFileSync(new URL('../js/imprese.js', import.meta.url), 'utf8');
const corpo = imp.slice(imp.indexOf('function personeDistinte'), imp.indexOf('function disegnaScheda'));
const personeDistinte = new Function(corpo + '\nreturn personeDistinte')();

const persone = [
  { persona_id: 'A', cf: 'RSSMRA80A01G224X', nominativo: 'Rossi Mario' },
  { persona_id: 'B', cf: 'BNCLGU75B02G224Y', nominativo: 'Bianchi Luigi' },
  { persona_id: 'C', cf: 'VRDNNA90C43G224Z', nominativo: 'Verdi Anna' },
];

test('tre persone, ciascuna anche con una nomina: il conteggio è 3, non 6', () => {
  const nomine = persone.map((p) => ({ persona_id: p.persona_id, nominativo: p.nominativo }));
  assert.equal(personeDistinte({ persone, nomine, rls: [] }), 3);
});

test('nomina non agganciata e RLS riconosciuti dal nominativo o dal codice fiscale', () => {
  const nomine = [{ persona_id: null, nominativo: 'MARIO ROSSI' }];
  const rls = [{ rls_cf: 'bnclgu75b02g224y', rls_cognome: 'Bianchi', rls_nome: 'Luigi' }];
  assert.equal(personeDistinte({ persone, nomine, rls }), 3);
});

test('il caso vero: Centro Veneto Servizi, 3 dipendenti e 3 nomine coi titoli → 3', () => {
  const p = [
    { persona_id: 'g', cf: null, nominativo: 'Bruscagnin Gianni' },
    { persona_id: 'a', cf: null, nominativo: 'Ramazzotto Alberto' },
    { persona_id: 'r', cf: 'LNGRRT61B14D442T', nominativo: 'Longo Roberto' },
  ];
  const agganciate = [
    { persona_id: 'r', nominativo: 'Longo Sig. Roberto' },
    { persona_id: 'g', nominativo: 'Bruscagnin Sig. Gianni' },
    { persona_id: 'a', nominativo: 'Ramazzotto Geom. Alberto' },
  ];
  assert.equal(personeDistinte({ persone: p, nomine: agganciate, rls: [] }), 3);
  const sciolte = agganciate.map((x) => ({ ...x, persona_id: null }));
  assert.equal(personeDistinte({ persone: p, nomine: sciolte, rls: [] }), 3, 'anche senza aggancio, dal nominativo senza titoli');
});

test('le persone che stanno solo fra nomine o RLS si contano', () => {
  const nomine = [{ persona_id: null, nominativo: 'Neri Paolo' }];
  const rls = [{ rls_cf: '', rls_nominativo: 'Gialli Sara' }];
  assert.equal(personeDistinte({ persone, nomine, rls }), 5);
});

test('due rapporti della stessa persona contano una volta', () => {
  assert.equal(personeDistinte({ persone: [...persone, { ...persone[0] }] }), 3);
});

test('due omonimi con codici fiscali diversi restano due', () => {
  const rls = [{ rls_cf: 'RSSMRA85D01L736K', rls_cognome: 'Rossi', rls_nome: 'Mario' }];
  assert.equal(personeDistinte({ persone, rls }), 4);
});

test('la linguetta usa il conteggio delle persone, non la somma delle righe', () => {
  assert.match(imp, /data-tab="persone">Persone <span class="cnt">\$\{personeDistinte\(scheda\)\}/);
  assert.doesNotMatch(imp, /n\('persone'\) \+ n\('nomine'\) \+ n\('rls'\)/);
});
