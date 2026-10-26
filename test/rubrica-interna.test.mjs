// (26/10/2026, chiesto dall'utente) fra i pulsantini «Aggiungi dall'ufficio» della
// mail protocollata ci sono anche Balladore e l'Ufficio corsi sicurezza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUBRICA_INTERNA, emailAssegnatario } from '../js/lookups.js';

test('Balladore e Ufficio corsi sono nella rubrica interna', () => {
  const mail = RUBRICA_INTERNA.map((r) => r.email);
  assert.ok(mail.includes('paolo.balladore@did.formedilpadova.it'));
  assert.ok(mail.includes('corsi@formedilpadova.it'));
  assert.equal(new Set(mail).size, mail.length, 'nessun indirizzo doppio');
});

test('il coordinatore resta quello che le maschere trovano per primo', () => {
  assert.equal(RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)).email, 'nicola.demarco@did.formedilpadova.it');
});

test('un protocollo assegnato a Balladore propone il suo indirizzo', () => {
  assert.equal(emailAssegnatario('Balladore Ing. Paolo'), 'paolo.balladore@did.formedilpadova.it');
  assert.equal(emailAssegnatario('Squizzato Sig. Renato'), 'cptpd@did.formedilpadova.it');
});
