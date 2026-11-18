// Il cartiglio in testa alle mail protocollate non porta la cartella del
// vault (deciso dall'utente il 18/11/2026: era uscito «2_AREE/Team_Tecnici/…»
// nelle mail dei Prot_26-27_0155, 0158, 0160, 0162 e 0164).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timbroHtml, timbroTesto } from '../supabase/functions/send-protocollo/timbro-mail.js';

const p = {
  codice: 'Prot_26-27_0164', esercizio: '26-27', numero: 164, data_prot: '2026-11-18', direzione: 'OUT',
  oggetto: 'Contratto di collaborazione: documenti ancora da inviare (Caon P.I. Franco)',
  ufficio: 'Segreteria Area Sicurezza e Salute', impresa_nome: 'FORMEDIL PADOVA', mezzo: 'e-mail',
  cartella: '2_AREE/Team_Tecnici/Caon_Franco', referente: 'Squizzato Sig. Renato',
};

test('nel cartiglio HTML la cartella non c\'è', () => {
  const h = timbroHtml(p, { qrSrc: 'cid:qr' });
  assert.doesNotMatch(h, /Caon_Franco|2_AREE/);
});

test('nel testo semplice la cartella non c\'è', () => {
  assert.doesNotMatch(timbroTesto(p), /Caon_Franco|2_AREE/);
});

test('il referente resta, a tutta larghezza', () => {
  const h = timbroHtml(p, { qrSrc: 'cid:qr' });
  assert.match(h, /colspan="2"[^>]*>Squizzato Sig\. Renato</);
});

test('senza referente l\'ultima riga non c\'è', () => {
  const h = timbroHtml({ ...p, referente: '' }, { qrSrc: 'cid:qr' });
  assert.doesNotMatch(h, /Squizzato/);
});

test('le altre caselle restano: oggetto, ufficio, destinatario, mezzo, numero', () => {
  const h = timbroHtml(p, { qrSrc: 'cid:qr' });
  for (const t of ['Prot_26-27_0164', 'documenti ancora da inviare', 'Segreteria Area Sicurezza e Salute', 'FORMEDIL PADOVA', 'e-mail']) {
    assert.ok(h.includes(t), t);
  }
});
