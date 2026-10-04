// Il nome del .eml che send-protocollo restituisce all'app.
// Dalla serie unica (01/10/2026) il codice porta già «Prot_»: fino al
// 04/10/2026 il file usciva «Prot_Prot_26-27_0009_invio.eml».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeFileEml, siglaProt, testoQrTimbro } from '../supabase/functions/send-protocollo/timbro-mail.js';

test('serie unica: il prefisso Prot_ una volta sola', () => {
  assert.equal(nomeFileEml('Prot_26-27_0009', 'protocollato'), 'Prot_26-27_0009_invio.eml');
  assert.equal(nomeFileEml('Prot_26-27_0009', 'notifica'), 'Prot_26-27_0009_notifica.eml');
  assert.doesNotMatch(nomeFileEml('Prot_26-27_0009', 'protocollato'), /Prot_Prot_/);
});

test('storico: il codice nudo prende il prefisso, come prima', () => {
  assert.equal(nomeFileEml('2603-out', 'protocollato'), 'Prot_2603-out_invio.eml');
  assert.equal(nomeFileEml('2048-in', 'notifica'), 'Prot_2048-in_notifica.eml');
  assert.equal(nomeFileEml(2554, 'protocollato'), 'Prot_2554_invio.eml');
});

test('i caratteri vietati nei nomi di file diventano trattini', () => {
  assert.equal(nomeFileEml('12/2026', 'protocollato'), 'Prot_12-2026_invio.eml');
  assert.equal(nomeFileEml('a' + String.fromCharCode(92) + 'b:c', 'protocollato'), 'Prot_a-b-c_invio.eml');
});

test('siglaProt e il QR del timbro usano la stessa regola', () => {
  assert.equal(siglaProt('Prot_26-27_0001'), 'Prot_26-27_0001');
  assert.equal(siglaProt('2603-out'), 'Prot_2603-out');
  assert.match(testoQrTimbro({ codice: 'Prot_26-27_0009', data_prot: '2026-10-03' }), /^Prot_26-27_0009 03\/10\/2026/);
  assert.match(testoQrTimbro({ numero: 2603, direzione: 'OUT', data_prot: '2026-09-30' }), /^Prot_2603-out /);
});
