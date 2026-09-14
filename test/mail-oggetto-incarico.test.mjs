// Oggetto delle mail dell'ufficio e lettera di incarico (14/09/2026).
// Dati INVENTATI: il repository è pubblico, niente nominativi né indirizzi veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oggettoUfficio, OGGETTO_UFFICIO, componiEml } from '../js/firma.js';
import { modelloProtocollato, oggettoProposto, testoProposto } from '../js/lookups.js';
import { vociIndirizzi, raccogliDestinatari } from '../js/mail-indirizzi.js';

const P = 'FORMEDIL Padova -AREA SICUREZZA E SALUTE-';
const INCARICO = 5;

test('ogni oggetto comincia con «FORMEDIL Padova -AREA SICUREZZA E SALUTE-»', () => {
  assert.equal(OGGETTO_UFFICIO, P);
  assert.equal(oggettoUfficio('Conferma consulenza'), `${P} Conferma consulenza`);
  assert.equal(oggettoUfficio(`${P} Invio prova Prot. 1`), `${P} Invio prova Prot. 1`);
});

test('le forme vecchie si riscrivono, non si raddoppiano', () => {
  assert.equal(oggettoUfficio('Formedil Padova - Area Sicurezza e Salute - Conferma visita'), `${P} Conferma visita`);
  assert.equal(oggettoUfficio('FORMEDIL PADOVA - Area Sicurezza e Salute - Mandato n° 3'), `${P} Mandato n° 3`);
  assert.equal(oggettoUfficio('FORMEDIL PADOVA -AREA SICUREZZA E SALUTE- Prot. 12 del 01/01/2026'), `${P} Prot. 12 del 01/01/2026`);
  assert.equal(oggettoUfficio('Formedil Padova – Area Sicurezza e Salute – post social: prova'), `${P} post social: prova`);
  assert.equal(oggettoUfficio('Formedil Padova - Quesito tecnico da Edilprova'), `${P} Quesito tecnico da Edilprova`);
  assert.equal(oggettoUfficio('Formedil Padovana corsi'), `${P} Formedil Padovana corsi`);
  assert.equal(oggettoUfficio(''), P);
});

test('la bozza .eml porta l\'oggetto con il prefisso', () => {
  const eml = componiEml({ to: 'a@example.it', oggetto: 'Conferma visita', corpo: 'prova', firma: false });
  assert.match(eml, /\r\nSubject: FORMEDIL Padova -AREA SICUREZZA E SALUTE- Conferma visita\r\n/);
});

test('lettera di incarico per l\'asseverazione: oggetto e testo usuali', () => {
  const p = { tipo_doc_id: INCARICO, oggetto: 'Lettera di incarico per attività di asseverazione' };
  assert.equal(oggettoProposto(p), 'Invio Lettera di incarico per attività di asseverazione');
  assert.equal(testoProposto(p), 'si trasmette pdf da ritornare firmato.');
  /* quella fatta dall'app ha un altro oggetto: la riconosce il gruppo di verifica */
  const app = { tipo_doc_id: INCARICO, oggetto: 'Incarico per l\'attività di verifica ai fini dell\'asseverazione — EDILPROVA' };
  assert.deepEqual(modelloProtocollato(app), {});
  assert.equal(oggettoProposto(app, { incaricoAsseverazione: true }), 'Invio Lettera di incarico per attività di asseverazione');
});

test('le altre lettere di incarico (docenza, pre-verifica) restano senza modello', () => {
  for (const oggetto of ['Lettera di incarico per attività di docenza', 'Lettera di incarico per attività di pre-verifica per asseverazione']) {
    const p = { tipo_doc_id: INCARICO, oggetto };
    assert.deepEqual(modelloProtocollato(p), {});
    assert.equal(oggettoProposto(p), oggetto);
    assert.equal(testoProposto(p), '');
  }
});

test('la lettera di incarico va in «A» al tecnico incaricato, il resto da spuntare', () => {
  const voci = vociIndirizzi({
    impresa: { impresa_nome: 'EDILPROVA S.R.L.', impresa_email_ref: 'info@edilprova.example' },
    nominativi: ['Rossi Arch. Mario'],
    personeTrovate: [{ nome: 'Mario', cognome: 'Rossi', email: 'mario.personale@example.it' }],
    incaricati: [{ email: 'rossi@tecnici.example', nome: 'Rossi Arch. Mario' }],
    modello: modelloProtocollato({ tipo_doc_id: INCARICO }, { incaricoAsseverazione: true }),
  });
  const { to, cc } = raccogliDestinatari(voci);
  assert.deepEqual(to, ['rossi@tecnici.example']);
  assert.deepEqual(cc, []);
  assert.equal(voci[0].gruppo, 'Tecnico incaricato');
});

test('lettera di Access senza incaricato collegato: resta la persona indicata', () => {
  const voci = vociIndirizzi({
    nominativi: ['Rossi Arch. Mario'],
    personeTrovate: [{ nome: 'Mario', cognome: 'Rossi', email: 'rossi@tecnici.example' }],
    incaricati: [],
    modello: modelloProtocollato({ tipo_doc_id: INCARICO, oggetto: 'Lettera di incarico per attività di asseverazione' }),
  });
  assert.deepEqual(raccogliDestinatari(voci).to, ['rossi@tecnici.example']);
});
