// I campi strutturati nella mail alla segreteria (21/09/2026). Dati INVENTATI.
//
// Il caso vero: la proposta di test «dtst #2» arrivava in mail col JSON delle
// domande, RISPOSTE CORRETTE comprese. Il primo controllo è quello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  domandeLeggibili, personeLeggibili, risposteLeggibili,
  riassuntoStrutturato, sembraStrutturato, RESA_STRUTTURATA,
} from '../supabase/functions/portale-richieste/leggibili.js';

const DOMANDE = JSON.stringify([
  { testo: 'PROVA — a che altezza serve l\'imbracatura?', tipo: 'scelta', punti: 1,
    opzioni: ['Mai', 'Sopra i 2 metri'], corrette: ['Sopra i 2 metri'] },
  { testo: 'Descrivi il rischio', tipo: 'testo', punti: 2 },
]);

test('le risposte corrette NON finiscono nella mail', () => {
  const t = domandeLeggibili(DOMANDE);
  assert.ok(!/Sopra i 2 metri/.test(t), 'la soluzione non deve comparire');
  assert.ok(!/"corrette"/.test(t), 'niente campo «corrette» del JSON');
  assert.ok(!/Mai/.test(t), 'nemmeno le opzioni sbagliate');
  assert.ok(!/opzioni":/.test(t), 'niente JSON');
  assert.match(t, /Opzioni e soluzioni si leggono nell'app/);
});

test('delle domande si legge il testo, il tipo e quante opzioni', () => {
  const t = domandeLeggibili(DOMANDE);
  assert.match(t, /1\. PROVA — a che altezza serve l'imbracatura\?/);
  assert.match(t, /scelta · 1 punto · 2 opzioni/);
  assert.match(t, /2\. Descrivi il rischio \(testo · 2 punti\)/);
});

test('delle persone iscritte niente codice fiscale né nascita', () => {
  const t = personeLeggibili(JSON.stringify([
    { cognome: 'Rossi', nome: 'Mario', cf: 'RSSMRA80A01G224X', nato_il: '1980-01-01',
      impresa: 'Edilprova S.r.l.', ruolo: 'operaio' },
  ]));
  assert.match(t, /1\. Rossi Mario — Edilprova S\.r\.l\. — operaio/);
  assert.ok(!/RSSMRA80A01G224X/.test(t), 'il CF resta nella pratica');
  assert.ok(!/1980/.test(t));
  assert.match(t, /si leggono nell'app/);
});

test('le risposte del questionario si leggono come domanda: risposta', () => {
  const t = risposteLeggibili(JSON.stringify([
    { domanda: 'Quanto è stata utile?', risposta: '5' },
    { domanda: 'Che cosa è servito?', risposta: ['Gli esempi', 'La check-list'] },
  ]));
  assert.match(t, /1\. Quanto è stata utile\?: 5/);
  assert.match(t, /2\. Che cosa è servito\?: Gli esempi, La check-list/);
});

test('una forma che non si riconosce non diventa JSON, ma un conteggio', () => {
  const strano = JSON.stringify([{ a: 1 }, { b: 2 }, { c: 3 }]);
  assert.equal(riassuntoStrutturato(strano, 'voci'), '3 voci — si leggono nell\'app');
  assert.equal(risposteLeggibili(strano), '3 risposte — si leggono nell\'app');
  assert.ok(!/\{/.test(risposteLeggibili(strano)));
});

test('si riconosce quando un valore è un elenco travestito da stringa', () => {
  assert.equal(sembraStrutturato('[{"a":1}]'), true);
  assert.equal(sembraStrutturato('{"a":1}'), true);
  assert.equal(sembraStrutturato([{ a: 1 }]), true);
  assert.equal(sembraStrutturato('Via Roma 3'), false);
  assert.equal(sembraStrutturato(''), false);
  assert.equal(sembraStrutturato(null), false);
});

test('i tre campi noti hanno la loro resa', () => {
  for (const k of ['domande', 'persone', 'risposte']) {
    assert.equal(typeof RESA_STRUTTURATA[k], 'function', k);
  }
});

test('un campo vuoto non inventa un elenco', () => {
  assert.equal(domandeLeggibili('[]'), 'si legge nell\'app');
  assert.equal(personeLeggibili(null), 'si legge nell\'app');
});
