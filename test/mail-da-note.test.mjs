// La mail registrata nelle note di un protocollo (dal 02/10/2026: testo completo
// con intestazioni) non deve finire tale e quale nella maschera di invio
// (Prot_26-27_0009, 03/10/2026); .eml e .md non si allegano mai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailDaNote, testoProposto, salutoProposto } from '../js/lookups.js';
import { NON_SI_ALLEGA } from '../js/mail-indirizzi.js';

const NOTE = `Da: Formedil Padova - Area Sicurezza e Salute <cpt@formedilpadova.it>
A: progetti@taglianigruppoadv.it
Cc: direzione@formedilpadova.it, ufficiostampa@taglianigruppoadv.it
Oggetto: FORMEDIL Padova -AREA SICUREZZA E SALUTE- R: Materiali - Prot. Prot_26-27_0009
Allegati: a.html; b.pdf

Gentile Chiara Cavada,

rispondo alla vostra mail del 2 ottobre.

In allegato:
1. il codice;
2. una nota.

Cordiali saluti

Renato Squizzato
Area Sicurezza e Salute | FORMEDIL PADOVA`;

test('la mail registrata si scompone: saluto a parte, niente intestazioni né firma', () => {
  const m = mailDaNote(NOTE);
  assert.equal(m.saluto, 'Gentile Chiara Cavada,');
  assert.ok(m.testo.startsWith('rispondo alla vostra mail'));
  assert.ok(m.testo.endsWith('Cordiali saluti'));
  assert.ok(!/^(Da|A|Cc|Oggetto|Allegati):/m.test(m.testo));
  assert.ok(!m.testo.includes('Renato Squizzato'));
  assert.ok(m.testo.includes('1. il codice;'));
});

test('maschera: testo e saluto proposti dalla mail registrata', () => {
  const p = { note: NOTE, persona: 'Cavada Chiara', tipo_doc_id: 16 };
  assert.equal(salutoProposto(p), 'Gentile Chiara Cavada,');
  assert.ok(testoProposto(p).startsWith('rispondo'));
});

test('le note senza intestazioni restano come sono', () => {
  const p = { note: 'Si trasmette la fattura.\nGrazie', persona: 'Rossi Mario' };
  assert.equal(mailDaNote(p.note), null);
  assert.equal(testoProposto(p), 'Si trasmette la fattura.\nGrazie');
  assert.equal(salutoProposto(p), 'Gent.le Rossi Mario,\nbuongiorno,');
});

test('mail senza saluto né chiusura: tutto il corpo', () => {
  const m = mailDaNote('Oggetto: prova\n\nRiga uno.\nRiga due.');
  assert.deepEqual(m, { saluto: '', testo: 'Riga uno.\nRiga due.' });
});

test('.eml e .md non si allegano; PDF, HTML e .msg sì', () => {
  assert.equal(NON_SI_ALLEGA('bozza_Prot_26-27_0009.eml'), true);
  assert.equal(NON_SI_ALLEGA('nota.md'), true);
  assert.equal(NON_SI_ALLEGA('nota.PDF'), false);
  assert.equal(NON_SI_ALLEGA('codice.html'), false);
  assert.equal(NON_SI_ALLEGA('mail_originale.msg'), false);
});
