// Test degli indirizzi proposti nelle mail di un protocollo.
// Dati INVENTATI: il repository è pubblico, niente nominativi né indirizzi veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chiaveNominativo, dividiIndirizzi, vociIndirizzi, raccogliDestinatari, E_NOTA, vociDaGruppo,
} from '../js/mail-indirizzi.js';

test('un gruppo entra tutto in «A»; chi non ha indirizzo resta fuori e si dice', () => {
  const { voci, senzaEmail, dominioVecchio } = vociDaGruppo([
    { nominativo: 'Rossi Arch. Mario', mansione: 'Consigliere', email: 'mario.rossi@esempio.example' },
    { nominativo: 'Verdi Ing. Luca', mansione: 'Presidente', email: 'presidente@scuolaedilepadova.net' },
    { nominativo: 'Neri Sig. Paolo', mansione: 'Consigliere', email: '' },
    { nominativo: 'Gialli Geom. Anna', mansione: null, email: 'non-e-un-indirizzo' },
  ], 'Commissione di prova');
  assert.deepEqual(voci.map((v) => [v.email, v.ruolo, v.gruppo]), [
    ['mario.rossi@esempio.example', 'to', 'Gruppo «Commissione di prova»'],
    ['presidente@scuolaedilepadova.net', 'to', 'Gruppo «Commissione di prova»'],
  ]);
  assert.equal(voci[0].etichetta, 'Rossi Arch. Mario — Consigliere');
  assert.match(voci[1].etichetta, /dominio vecchio/);
  assert.deepEqual(senzaEmail, ['Neri Sig. Paolo', 'Gialli Geom. Anna']);
  assert.deepEqual(dominioVecchio, ['Verdi Ing. Luca']);
});

test('i membri del gruppo passano per la stessa raccolta dei destinatari', () => {
  const { voci } = vociDaGruppo([
    { nominativo: 'Rossi Mario', email: 'Mario.Rossi@esempio.example' },
    { nominativo: 'Rossi Mario (doppione)', email: 'mario.rossi@esempio.example' },
  ], 'Prova');
  assert.deepEqual(raccogliDestinatari(voci).to, ['Mario.Rossi@esempio.example']);
});

const impresa = {
  impresa_nome: 'EDILPROVA S.R.L.',
  impresa_email_ref: 'info@edilprova.example',
  impresa_email2: 'Info@Edilprova.example',   // doppione con maiuscole
  impresa_email3: '',
  pec: 'edilprova@pec.example',
};

test('il nominativo si riconosce senza titoli e in qualunque ordine', () => {
  assert.equal(chiaveNominativo('Arch. Mario De Rossi'), chiaveNominativo('De Rossi Arch. Mario'));
  assert.equal(chiaveNominativo('Rag.ra Anna Bianchi'), chiaveNominativo('BIANCHI ANNA'));
  assert.equal(chiaveNominativo('Dott.ssa Làura Neri'), 'laura neri');
});

test('la persona indicata va in «A», l\'impresa resta da spuntare', () => {
  const voci = vociIndirizzi({
    impresa,
    nominativi: ['Rag.ra Anna Bianchi'],
    personeTrovate: [
      { nome: 'Anna', cognome: 'Bianchi', titolo: 'Rag.ra', email: 'anna@edilprova.example', email2: 'anna.b@altro.example' },
      { nome: 'Luca', cognome: 'Bianchi', email: 'luca@edilprova.example' },
    ],
  });
  const ruolo = (e) => { const v = voci.find((x) => x.email === e); return v ? v.ruolo : 'assente'; };
  assert.equal(ruolo('anna@edilprova.example'), 'to');
  assert.equal(ruolo('anna.b@altro.example'), null);
  assert.equal(ruolo('luca@edilprova.example'), 'assente');   // altro nome: non proposto
  assert.equal(ruolo('info@edilprova.example'), null);
  assert.equal(ruolo('edilprova@pec.example'), null);
  assert.equal(voci.filter((v) => v.email.toLowerCase() === 'info@edilprova.example').length, 1);
});

test('senza persona riconosciuta va in «A» la e-mail principale dell\'impresa', () => {
  const voci = vociIndirizzi({ impresa, nominativi: ['Qualcuno Che Non C\'è'], personeTrovate: [] });
  assert.equal(voci.find((v) => v.email === 'info@edilprova.example').ruolo, 'to');
});

test('due persone con lo stesso nome: nessuna preselezione', () => {
  const voci = vociIndirizzi({
    impresa,
    nominativi: ['Mario Verdi'],
    personeTrovate: [
      { nome: 'Mario', cognome: 'Verdi', email: 'mario1@example.it' },
      { nome: 'MARIO', cognome: 'VERDI', email: 'mario2@example.it' },
    ],
  });
  assert.equal(voci.find((v) => v.email === 'mario1@example.it').ruolo, null);
  assert.equal(voci.find((v) => v.email === 'mario2@example.it').ruolo, null);
  assert.match(voci.find((v) => v.email === 'mario1@example.it').gruppo, /stesso nome/);
  // e allora torna in «A» l'impresa, perché nessuna persona è stata scelta
  assert.equal(voci.find((v) => v.email === 'info@edilprova.example').ruolo, 'to');
});

test('persone dell\'impresa proposte ma non spuntate, senza doppioni', () => {
  const voci = vociIndirizzi({
    impresa,
    personeImpresa: [{ nome: 'Paolo', cognome: 'Gialli', email: 'paolo@edilprova.example' }, { nome: 'X', cognome: 'Y', email: 'info@edilprova.example' }],
  });
  assert.equal(voci.find((v) => v.email === 'paolo@edilprova.example').ruolo, null);
  assert.equal(voci.filter((v) => v.email.toLowerCase() === 'info@edilprova.example').length, 1);
});

test('A e Cc: niente doppioni, gli indirizzi a mano si controllano', () => {
  const voci = [
    { email: 'a@example.it', ruolo: 'to' },
    { email: 'b@example.it', ruolo: 'cc' },
    { email: 'c@example.it', ruolo: null },
  ];
  const r = raccogliDestinatari(voci, dividiIndirizzi('A@example.it; d@example.it'), dividiIndirizzi('b@example.it, non-una-mail, e@example.it'));
  assert.deepEqual(r.to, ['a@example.it', 'd@example.it']);
  assert.deepEqual(r.cc, ['b@example.it', 'e@example.it']);
  assert.deepEqual(r.nonValidi, ['non-una-mail']);
});

test('le note del vault non sono documenti', () => {
  assert.equal(E_NOTA('2026_09_14_ASSEV_Prova_piano_Prot_2569-out.md'), true);
  assert.equal(E_NOTA('Richieste.base'), true);
  assert.equal(E_NOTA('2026_09_14_ASSEV_Prova_piano_Prot_2569-out.pdf'), false);
});
