// Test della lettura del mittente dalla mail che si protocolla (.eml, .msg).
// Dati INVENTATI: il repository è pubblico, niente nominativi né indirizzi veri.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indirizzoDaIntestazione, mittenteDaEml, mittenteDaMsg, mittenteDaFile,
} from '../js/mittente-mail.js';

test('intestazione «Nome <indirizzo>»: indirizzo e nome separati', () => {
  assert.deepEqual(indirizzoDaIntestazione('"Mario Rossi" <m.rossi@esempio.example>'),
    { email: 'm.rossi@esempio.example', nome: 'Mario Rossi' });
  assert.deepEqual(indirizzoDaIntestazione('info@esempio.example'), { email: 'info@esempio.example', nome: '' });
  assert.equal(indirizzoDaIntestazione('nessun indirizzo qui'), null);
  assert.equal(indirizzoDaIntestazione(''), null);
});

test('.eml: si risponde al «Reply-To» se c\'è, altrimenti al «From»', () => {
  const soloFrom = 'Received: da qualche parte\r\nFrom: =?UTF-8?Q?Luc=C3=ACa_Bianchi?= <lucia@esempio.example>\r\nTo: ufficio@esempio.example\r\nSubject: prova\r\n\r\nFrom: finto@nel-corpo.example\r\n';
  assert.deepEqual(mittenteDaEml(soloFrom), { email: 'lucia@esempio.example', nome: 'Lucìa Bianchi' });

  const conReplyTo = 'From: "Per conto di: studio@pec.example" <posta-certificata@pec.example>\r\nReply-To: studio@pec.example\r\nSubject: x\r\n\r\ncorpo';
  assert.equal(mittenteDaEml(conReplyTo).email, 'studio@pec.example');
});

test('.eml: l\'intestazione spezzata su due righe si ricompone', () => {
  const spezzata = 'Subject: x\nFrom: Ente di Prova con un nome lungo\n <segreteria@ente.example>\n\ncorpo';
  assert.deepEqual(mittenteDaEml(spezzata), { email: 'segreteria@ente.example', nome: 'Ente di Prova con un nome lungo' });
});

test('una bozza nostra non ancora spedita non ha mittente: null, non un indirizzo a caso', () => {
  assert.equal(mittenteDaEml('X-Unsent: 1\r\nTo: impresa@esempio.example\r\nSubject: avviso\r\n\r\ncorpo'), null);
});

/* ── un .msg finto, costruito a mano: intestazione, FAT, directory, mini FAT,
   mini flusso. Dentro: il mittente, il suo nome, e un allegato che porta un
   ALTRO mittente (una mail inoltrata), che non va letto. ── */
function msgFinto({ smtp, nome, headers, smtpAllegato }) {
  const SETT = 512;
  const utf16 = (t) => { const b = new Uint8Array(t.length * 2); [...t].forEach((c, i) => { b[i * 2] = c.charCodeAt(0) & 255; b[i * 2 + 1] = c.charCodeAt(0) >> 8; }); return b; };
  const flussi = [];
  const mini = [];
  const aggiungiFlusso = (contenuto) => {
    const primo = mini.length;
    const n = Math.max(1, Math.ceil(contenuto.length / 64));
    for (let i = 0; i < n; i++) mini.push(i === n - 1 ? 0xFFFFFFFE : primo + i + 1);
    flussi.push({ primo, contenuto });
    return { primo, dimensione: contenuto.length };
  };

  const voci = [];
  const voce = (nomeVoce, tipo, extra = {}) => voci.push({ nomeVoce, tipo, sinistra: 0xFFFFFFFF, destra: 0xFFFFFFFF, figlio: 0xFFFFFFFF, primo: 0, dimensione: 0, ...extra });
  voce('Root Entry', 5, { figlio: 1 });
  const radici = [];
  if (smtp != null) radici.push(['__substg1.0_5D01001F', utf16(smtp)]);
  if (nome != null) radici.push(['__substg1.0_0C1A001F', utf16(nome)]);
  if (headers != null) radici.push(['__substg1.0_007D001F', utf16(headers)]);
  radici.forEach(([n, c], i) => voce(n, 2, { ...aggiungiFlusso(c), destra: voci.length + 1 }));
  /* l'allegato: una cartella, con dentro il «mittente» di un'altra mail */
  voce('__attach_version1.0_#00000000', 1, { figlio: voci.length + 1 });
  voce('__substg1.0_5D01001F', 2, aggiungiFlusso(utf16(smtpAllegato)));

  const settoriDir = Math.ceil(voci.length / 4);
  const settoriMini = Math.ceil((mini.length * 64) / SETT);
  /* settori: 0 = FAT, poi directory, poi mini FAT, poi mini flusso */
  const primoDir = 1;
  const settMiniFat = primoDir + settoriDir;
  const primoMini = settMiniFat + 1;
  const totale = primoMini + settoriMini;
  voci[0].primo = primoMini;
  voci[0].dimensione = mini.length * 64;

  const file = new Uint8Array(SETT * (totale + 1));
  const dv = new DataView(file.buffer);
  [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].forEach((x, i) => { file[i] = x; });
  dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
  dv.setUint32(44, 1, true); dv.setUint32(48, primoDir, true);
  dv.setUint32(56, 4096, true); dv.setUint32(60, settMiniFat, true); dv.setUint32(64, 1, true);
  dv.setUint32(68, 0xFFFFFFFE, true); dv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(76 + i * 4, i === 0 ? 0 : 0xFFFFFFFF, true);

  const o = (s) => (s + 1) * SETT;
  /* FAT */
  for (let i = 0; i < 128; i++) dv.setUint32(o(0) + i * 4, 0xFFFFFFFF, true);
  dv.setUint32(o(0), 0xFFFFFFFD, true);
  const lega = (primo, n) => { for (let i = 0; i < n; i++) dv.setUint32(o(0) + (primo + i) * 4, i === n - 1 ? 0xFFFFFFFE : primo + i + 1, true); };
  lega(primoDir, settoriDir); lega(settMiniFat, 1); lega(primoMini, settoriMini);
  /* directory */
  voci.forEach((v, i) => {
    const b = o(primoDir) + i * 128;
    file.set(utf16(v.nomeVoce), b);
    dv.setUint16(b + 64, v.nomeVoce.length * 2 + 2, true);
    file[b + 66] = v.tipo;
    dv.setUint32(b + 68, v.sinistra, true); dv.setUint32(b + 72, v.destra, true); dv.setUint32(b + 76, v.figlio, true);
    dv.setUint32(b + 116, v.primo, true); dv.setUint32(b + 120, v.dimensione, true);
  });
  /* l'ultimo fratello della radice non ha un fratello a destra */
  const ultimoFratello = radici.length + 1;
  dv.setUint32(o(primoDir) + ultimoFratello * 128 + 72, 0xFFFFFFFF, true);
  /* mini FAT e mini flusso */
  for (let i = 0; i < 128; i++) dv.setUint32(o(settMiniFat) + i * 4, i < mini.length ? mini[i] : 0xFFFFFFFF, true);
  flussi.forEach((f) => file.set(f.contenuto, o(primoMini) + f.primo * 64));
  return file;
}

test('.msg: il mittente è quello della mail, non quello della mail allegata', () => {
  const msg = msgFinto({ smtp: 'm.rossi@esempio.example', nome: 'Mario Rossi', smtpAllegato: 'altro@inoltrata.example' });
  assert.deepEqual(mittenteDaMsg(msg), { email: 'm.rossi@esempio.example', nome: 'Mario Rossi' });
  assert.deepEqual(mittenteDaFile('Richiesta di visita.MSG', msg), { email: 'm.rossi@esempio.example', nome: 'Mario Rossi' });
});

test('.msg: il «Reply-To» delle intestazioni di trasporto vince sull\'indirizzo del mittente', () => {
  const msg = msgFinto({
    smtp: 'posta-certificata@pec.example', nome: 'Per conto di: studio@pec.example',
    headers: 'From: "Per conto di: studio@pec.example" <posta-certificata@pec.example>\r\nReply-To: studio@pec.example\r\n\r\n',
    smtpAllegato: 'altro@inoltrata.example',
  });
  assert.equal(mittenteDaMsg(msg).email, 'studio@pec.example');
});

test('.msg scritto dall\'ufficio (posta inviata): l\'indirizzo interno di Exchange non è una e-mail', () => {
  const msg = msgFinto({ smtp: '', nome: 'Ufficio', headers: 'X-Unsent: 1\r\nTo: impresa@esempio.example\r\n\r\n', smtpAllegato: 'altro@inoltrata.example' });
  assert.equal(mittenteDaMsg(msg), null);
});

test('un file che non è una mail dà null e non lancia', () => {
  assert.equal(mittenteDaMsg(new Uint8Array(4000)), null);
  assert.equal(mittenteDaMsg(new Uint8Array([1, 2, 3])), null);
  assert.equal(mittenteDaFile('lettera.pdf', new Uint8Array(100)), null);
  /* la firma giusta e poi spazzatura: settori che puntano fuori dal file */
  const rotto = new Uint8Array(2048).fill(0xFF);
  [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1].forEach((x, i) => { rotto[i] = x; });
  assert.equal(mittenteDaMsg(rotto), null);
});
