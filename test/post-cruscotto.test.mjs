// Post per i social nel cruscotto (17/11/2026): in attesa (e se chi decide li ha aperti), rimandati, approvati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadroPost, quantiPost, righePost, passoVisto, passoData, giorniFra } from '../js/post-cruscotto.js';

const post = [
  { id: 99, titolo: 'Convegno ITL', stato: 'al_direttore', data_programmata: '2026-11-19' },
  { id: 117, titolo: 'Richiamo <ITL>', stato: 'al_direttore', data_programmata: '2026-12-09' },
  { id: 5, titolo: 'Rimandato', stato: 'bozza' },
  { id: 6, titolo: 'Bozza mai mandata', stato: 'bozza' },
  { id: 7, titolo: 'Ritirato', stato: 'bozza' },
  { id: 8, titolo: 'Approvato con indicazioni', stato: 'approvato', data_programmata: '2026-11-16' },
  { id: 9, titolo: 'Dal Coordinatore', stato: 'al_coordinatore' },
];
const pass = [
  { id: 75, post_id: 99, verso: 'direttore', stato: 'in_attesa', richiesto_il: '2026-11-17T10:04:40Z', visti: { direttore: { nome: 'X', il: '2026-11-17T11:44:00Z' } } },
  { id: 76, post_id: 117, verso: 'direttore', stato: 'in_attesa', richiesto_il: '2026-11-17T10:04:50Z', visti: {} },
  { id: 1, post_id: 5, verso: 'coordinatore', stato: 'modifiche', richiesto_il: '2026-11-10T08:00:00Z', deciso_il: '2026-11-11T08:00:00Z', nota: 'cambia la norma' },
  { id: 2, post_id: 7, verso: 'direttore', stato: 'non_approvato', richiesto_il: '2026-11-01T08:00:00Z' },
  { id: 3, post_id: 7, verso: 'direttore', stato: 'ritirato', richiesto_il: '2026-11-02T08:00:00Z' },
  { id: 4, post_id: 8, verso: 'direttore', stato: 'approvato_indicazioni', richiesto_il: '2026-11-12T08:00:00Z', deciso_il: '2026-11-13T09:00:00Z', nota: 'togli il punto esclamativo' },
  { id: 10, post_id: 9, verso: 'coordinatore', stato: 'in_attesa', richiesto_il: '2026-11-16T08:00:00Z' },
];

test('i tre mucchi', () => {
  const q = quadroPost(post, pass);
  assert.deepEqual(q.attesa.map((r) => r.p.id), [9, 99, 117], 'in attesa, dal più vecchio');
  assert.deepEqual(q.rimandati.map((r) => r.p.id), [5], 'una bozza mai mandata o ritirata dalla segreteria non è «rimandata»');
  assert.deepEqual(q.approvati.map((r) => r.p.id), [8]);
  assert.equal(quantiPost(q), 5);
  assert.equal(quantiPost(null), 0);
});

test('aperto o no da chi decide', () => {
  assert.match(passoVisto(pass[0]), /aperto dal Direttore il 17\/11\/2026 alle 12:44, non ancora deciso/);
  assert.match(passoVisto(pass[1]), /il Direttore non l'ha ancora aperto/);
  const pres = passoVisto({ verso: 'presidenza', visti: { presidente: { il: '2026-11-17T08:00:00Z' } }, decisioni: { vicepresidente: { esito: 'approvato' } } });
  assert.match(pres, /aperto dal Presidente/);
  assert.match(pres, /il Vicepresidente ha deciso: approvato/);
});

test('la data in programma', () => {
  assert.equal(giorniFra('2026-11-17', '2026-11-19'), 2);
  assert.match(passoData({ data_programmata: '2026-11-19' }, '2026-11-17', 'manca l\'approvazione'), /hm-passo-err.*in programma il 19\/11\/2026, manca l'approvazione/);
  assert.match(passoData({ data_programmata: '2026-11-18' }, '2026-11-17', ''), /in programma domani/);
  assert.match(passoData({ data_programmata: '2026-11-16' }, '2026-11-17', ''), /doveva uscire il 16\/11\/2026/);
  assert.doesNotMatch(passoData({ data_programmata: '2026-12-09' }, '2026-11-17', ''), /hm-passo/);
  assert.equal(passoData({}, '2026-11-17', ''), '');
});

test('le righe aprono il post e il testo passa da esc', () => {
  const h = righePost(quadroPost(post, pass), '2026-11-17');
  assert.match(h, /data-vista="comunicazione" data-id="117"/);
  assert.match(h, /Richiamo &lt;ITL&gt;/);
  assert.match(h, /il Coordinatore chiede modifiche: «cambia la norma»/);
  assert.match(h, /con indicazioni da applicare: «togli il punto esclamativo»/);
  assert.match(h, /doveva uscire il 16\/11\/2026/);
  assert.doesNotMatch(h, /Bozza mai mandata|Ritirato/);
});
