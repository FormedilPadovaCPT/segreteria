// La mail protocollata dei servizi passa dalla funzione di «Invia protocollato»
// (18/11/2026): qui la parte senza browser. Dati INVENTATI: il repository è pubblico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dividiLettera, noteDaMail, MITTENTE_NOTE } from '../js/bozza-protocollata-testo.js';
import { mailDaNote } from '../js/lookups.js';

test('apertura e corpo: il primo blocco col saluto va sotto il cartiglio', () => {
  const r = dividiLettera('Spett.le ENTE DI PROVA,\nbuongiorno,\n\nin allegato trasmetto la relazione.\n\nDistinti saluti.');
  assert.equal(r.saluto, 'Spett.le ENTE DI PROVA,\nbuongiorno,');
  assert.equal(r.messaggio, 'in allegato trasmetto la relazione.\n\nDistinti saluti.');
});

test('senza un saluto riconoscibile tutto è corpo: l\'apertura la sceglie la funzione', () => {
  const r = dividiLettera('in allegato la relazione.\n\nDistinti saluti.');
  assert.equal(r.saluto, '');
  assert.equal(r.messaggio, 'in allegato la relazione.\n\nDistinti saluti.');
  assert.deepEqual(dividiLettera('Spett.le ENTE,'), { saluto: '', messaggio: 'Spett.le ENTE,' });
});

test('le note hanno il testo completo e mailDaNote le rilegge', () => {
  const note = noteDaMail({
    to: 'info@impresa.example', cc: ['coord@esempio.example', 'esperto@esempio.example'],
    oggetto: 'FORMEDIL Padova -AREA SICUREZZA E SALUTE- Riscontro Prot. Prot_26-27_0001',
    saluto: 'Spett.le IMPRESA DI PROVA,\nalla c.a. Sig. Mario Rossi,',
    messaggio: 'Vi rispondiamo quanto segue.\n\nDistinti saluti.',
  });
  const righe = note.split('\n');
  assert.equal(righe[0], `Da: ${MITTENTE_NOTE}`);
  assert.equal(righe[1], 'A: info@impresa.example');
  assert.equal(righe[2], 'Cc: coord@esempio.example, esperto@esempio.example');
  assert.match(righe[3], /^Oggetto: FORMEDIL Padova/);
  assert.equal(righe[4], 'Allegati: nessuno');
  assert.equal(righe[5], '');
  const m = mailDaNote(note);
  assert.equal(m.saluto, 'Spett.le IMPRESA DI PROVA,');
  assert.match(m.testo, /Vi rispondiamo quanto segue\.\n\nDistinti saluti\.$/);
});

test('senza copia non c\'è la riga Cc; gli allegati si elencano', () => {
  const note = noteDaMail({ to: ['a@esempio.example'], oggetto: 'X', allegati: ['uno.pdf', 'due.pdf'], messaggio: 'Testo.' });
  assert.ok(!/^Cc:/m.test(note));
  assert.match(note, /^Allegati: uno\.pdf; due\.pdf$/m);
});

// Il difetto del 18/11: i moduli scrivevano il protocollo come riga di testo.
// Se torna quella forma, questo test deve fallire.
test('consulenze e cantieri critici non compongono più la mail protocollata da sé', () => {
  for (const f of ['../js/consulenze.js', '../js/cantieri-critici.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(src.includes('preparaBozzaProtocollata'), `${f}: non passa da preparaBozzaProtocollata`);
    assert.ok(!/corpo: `Protocollo (N° )?\$\{/.test(src), `${f}: il protocollo è ancora scritto come riga di testo`);
  }
});
