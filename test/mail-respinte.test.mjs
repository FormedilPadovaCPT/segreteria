// Leggere un rapporto di mancata consegna (21/09/2026).
// Dati INVENTATI: il repository è pubblico — gli indirizzi sono di fantasia
// e i verbali non esistono.
//
// Quello che questi controlli tengono fermo:
//   · l'oggetto di una mail è CODIFICATO: senza decodificarlo il numero di
//     verbale resta nascosto e il rimbalzo non si aggancia a niente
//     (visto alla prima prova sulla casella vera);
//   · un rinvio «delayed» non è un indirizzo sbagliato e non deve passare;
//   · un rapporto può elencare PIÙ indirizzi falliti, e vanno presi tutti;
//   · l'oggetto che si conserva è quello del messaggio ORIGINALE, non
//     «Delivery Status Notification (Failure)», che non dice niente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodificaOggetto, falliti, oggettiCandidati, oggettoOriginale, numeroVerbale,
} from '../js/mail-respinte-lettura.js';

const OGGETTO_Q = '=?UTF-8?Q?FORMEDIL_Padova_=2DAREA_SICUREZZA_E_SALUTE=2D_Cantiere_?='
  + '=?UTF-8?Q?di_via_Perit=C3=B9_3_CPT/25=5F26/0874?=';

test('l’oggetto codificato si legge, e con lui il numero di verbale', () => {
  const chiaro = decodificaOggetto(OGGETTO_Q);
  assert.match(chiaro, /FORMEDIL Padova -AREA SICUREZZA E SALUTE- Cantiere di via Peritù 3/);
  assert.equal(numeroVerbale([chiaro], ''), 'CPT/25_26/0874');
  // e senza decodifica non si troverebbe: è il motivo per cui la funzione esiste
  assert.equal(numeroVerbale([OGGETTO_Q], ''), null);
});

test('la codifica base64 dell’oggetto si legge allo stesso modo', () => {
  const b64 = '=?UTF-8?B?' + Buffer.from('Verbale CPT/25_26/0099 — Peritù', 'utf8').toString('base64') + '?=';
  assert.equal(numeroVerbale([decodificaOggetto(b64)], ''), 'CPT/25_26/0099');
});

test('un oggetto normale non si rovina passando dal decodificatore', () => {
  assert.equal(decodificaOggetto('Cantiere di via Roma CPT/25_26/0001'), 'Cantiere di via Roma CPT/25_26/0001');
});

const RAPPORTO = [
  'Reporting-MTA: dns; googlemail.com',
  '',
  'Final-Recipient: rfc822; mario.inesistente@esempio.invalid',
  'Action: failed',
  'Status: 5.1.1',
  "Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does",
  '  not exist. Please try double-checking the recipient.',
  '',
  'Final-Recipient: rfc822; ufficio@esempio-lento.invalid',
  'Action: delayed',
  'Status: 4.4.7',
  '',
  'Final-Recipient: rfc822; seconda.impresa@esempio.invalid',
  'Action: failed',
  'Status: 5.2.1',
  'Diagnostic-Code: smtp; 552 mailbox full',
].join('\r\n');

test('si prendono tutti gli indirizzi falliti, e solo quelli', () => {
  const f = falliti(RAPPORTO);
  assert.deepEqual(f.map((x) => x.destinatario),
    ['mario.inesistente@esempio.invalid', 'seconda.impresa@esempio.invalid']);
  assert.equal(f[0].codice, '5.1.1');
  // ⚠️ la riga piegata si riunisce, o il motivo arriverebbe tagliato a metà
  assert.match(f[0].motivo, /does not exist/);
  assert.equal(f[1].codice, '5.2.1');
});

test('un rinvio non è un indirizzo sbagliato', () => {
  const f = falliti(['Final-Recipient: rfc822; tardi@esempio.invalid', 'Action: delayed', 'Status: 4.4.7'].join('\n'));
  assert.equal(f.length, 0, 'un 4.x.x in coda non deve far partire nessun avviso');
});

test('lo stesso indirizzo elencato due volte fa una riga sola', () => {
  const due = [RAPPORTO, '', 'Final-Recipient: rfc822; mario.inesistente@esempio.invalid',
    'Action: failed', 'Status: 5.1.1'].join('\r\n');
  assert.equal(falliti(due).filter((x) => x.destinatario === 'mario.inesistente@esempio.invalid').length, 1);
});

test('quello che non è un rapporto non produce niente', () => {
  assert.deepEqual(falliti('Buongiorno, le confermo la visita di domani.'), []);
  assert.deepEqual(falliti(''), []);
});

test('si conserva l’oggetto del messaggio originale, non quello del rapporto', () => {
  const candidati = oggettiCandidati(
    ['Delivery Status Notification (Failure)'],
    `----- Original message -----\r\nSubject: ${OGGETTO_Q}\r\nTo: tizio@esempio.invalid\r\n`,
  );
  const o = oggettoOriginale(candidati);
  assert.match(o, /CPT\/25_26\/0874/);
  assert.equal(numeroVerbale(candidati, ''), 'CPT/25_26/0874');
});

test('senza il verbale resta comunque un oggetto leggibile, mai quello del daemon', () => {
  const candidati = oggettiCandidati(
    ['Undelivered Mail Returned to Sender'],
    'Subject: =?UTF-8?Q?Iscrizione_al_corso?=\r\n',
  );
  assert.equal(oggettoOriginale(candidati), 'Iscrizione al corso');
  assert.equal(numeroVerbale(candidati, ''), null, 'senza numero non si inventa un aggancio');
});

test('se c’è solo l’oggetto del daemon si tiene quello: meglio poco che niente', () => {
  assert.equal(oggettoOriginale(['Delivery Status Notification (Failure)']),
    'Delivery Status Notification (Failure)');
  assert.equal(oggettoOriginale([]), null);
});
