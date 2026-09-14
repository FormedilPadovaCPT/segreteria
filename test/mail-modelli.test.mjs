// Test dei modelli di mail per tipo di documento del protocollo (14/09/2026).
// Dati INVENTATI: il repository è pubblico, niente nominativi né indirizzi veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  testoProposto, salutoProposto, nomeImpresaLeggibile, modelloProtocollato,
} from '../js/lookups.js';
import { vociIndirizzi, raccogliDestinatari } from '../js/mail-indirizzi.js';

const impresa = {
  impresa_nome: 'EDILPROVA S.R.L.',
  impresa_email_ref: 'info@edilprova.example',
  pec: 'edilprova@pec.example',
};
const gruppoVerifica = [
  { email: 'rossi@tecnici.example', nome: 'Rossi Arch. Mario', ruolo: 'verificatore', rgv: true },
  { email: 'bianchi@tecnici.example', nome: 'Bianchi Ing. Anna', ruolo: 'osservatore', rgv: false },
];
const PIANO = 51;
const PROGRAMMA = 34;

test('il nome tutto maiuscolo diventa leggibile, quello già scritto bene resta', () => {
  assert.equal(nomeImpresaLeggibile('EDILPROVA S.R.L.'), 'Edilprova S.r.l.');
  assert.equal(nomeImpresaLeggibile('DE PROVA COSTRUZIONI SRL'), 'De Prova Costruzioni S.r.l.');
  assert.equal(nomeImpresaLeggibile("EDIL-PROVA DI D'ANGELO SNC"), "Edil-Prova Di D'Angelo S.n.c.");
  assert.equal(nomeImpresaLeggibile('Edilprova s.r.l.'), 'Edilprova s.r.l.');
});

test('piano 5.D.4: saluto al gruppo di verifica e testo usuale', () => {
  const p = { tipo_doc_id: PIANO, impresa_nome: 'EDILPROVA S.R.L.' };
  assert.equal(salutoProposto(p), 'G.d.V.\ne.p.c.\nSpett.le Edilprova S.r.l.,');
  assert.equal(testoProposto(p), 'Trasmetto modulo per il piano di verifica da concordare con l\'Impresa.');
  assert.doesNotMatch(testoProposto(p), /cordialmente/i);
});

test('programma 5.D.3: saluto solito, testo usuale e la norma allegata', () => {
  const p = { tipo_doc_id: PROGRAMMA, impresa_nome: 'EDILPROVA S.R.L.' };
  assert.equal(salutoProposto(p), 'Gent.le EDILPROVA S.R.L.,\nbuongiorno,');
  assert.equal(testoProposto(p), 'Trasmetto modulo per il programma di verifica e copia UNI 11751-1.');
  assert.equal(modelloProtocollato(p).allegati.length, 1);
});

test('le note del protocollo vincono sul testo usuale; senza modello niente', () => {
  assert.equal(testoProposto({ tipo_doc_id: PIANO, note: 'Testo scritto apposta.' }), 'Testo scritto apposta.');
  assert.equal(testoProposto({ tipo_doc_id: 9999 }), '');
  assert.equal(salutoProposto({ tipo_doc_id: 9999, alla_ca: 'Sig. Prova' }), 'Gent.le Sig. Prova,\nbuongiorno,');
});

test('piano 5.D.4: il gruppo di verifica in «A», impresa e persona indicata in «Cc»', () => {
  const voci = vociIndirizzi({
    impresa,
    nominativi: ['Verdi Luca'],
    personeTrovate: [{ nome: 'Luca', cognome: 'Verdi', email: 'luca@edilprova.example' }],
    gruppoVerifica,
    modello: modelloProtocollato({ tipo_doc_id: PIANO }),
  });
  const { to, cc } = raccogliDestinatari(voci);
  assert.deepEqual(to, ['rossi@tecnici.example', 'bianchi@tecnici.example']);
  assert.deepEqual(cc, ['luca@edilprova.example']);
  assert.equal(voci[0].gruppo, 'Gruppo di verifica');
  assert.match(voci[0].etichetta, /verificatore \(RGV\)/);
  assert.match(voci[1].etichetta, /osservatore/);
});

test('piano 5.D.4 senza persona: la e-mail principale dell\'impresa va in «Cc»', () => {
  const voci = vociIndirizzi({ impresa, gruppoVerifica, modello: modelloProtocollato({ tipo_doc_id: PIANO }) });
  const { to, cc } = raccogliDestinatari(voci);
  assert.deepEqual(to, ['rossi@tecnici.example', 'bianchi@tecnici.example']);
  assert.deepEqual(cc, ['info@edilprova.example']);
});

test('piano 5.D.4 senza gruppo di verifica: resta l\'impresa in «A», mai una mail senza destinatari', () => {
  const voci = vociIndirizzi({ impresa, gruppoVerifica: [], modello: modelloProtocollato({ tipo_doc_id: PIANO }) });
  assert.deepEqual(raccogliDestinatari(voci).to, ['info@edilprova.example']);
});

test('programma 5.D.3: impresa in «A», gruppo di verifica in «Cc»', () => {
  const voci = vociIndirizzi({ impresa, gruppoVerifica, modello: modelloProtocollato({ tipo_doc_id: PROGRAMMA }) });
  const { to, cc } = raccogliDestinatari(voci);
  assert.deepEqual(to, ['info@edilprova.example']);
  assert.deepEqual(cc, ['rossi@tecnici.example', 'bianchi@tecnici.example']);
});

test('altri tipi: il gruppo di verifica, se passato, resta da spuntare', () => {
  const voci = vociIndirizzi({ impresa, gruppoVerifica, modello: {} });
  assert.equal(voci.find((v) => v.email === 'rossi@tecnici.example').ruolo, null);
  assert.deepEqual(raccogliDestinatari(voci).to, ['info@edilprova.example']);
});
