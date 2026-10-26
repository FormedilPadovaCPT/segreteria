// node test/risposte-verbali.test.mjs
// (12/10/2026) Le risposte ai verbali che tornano a cptpd@did si girano al tecnico che ha fatto la
// visita (edge function risposte-verbali). Qui le regole per riconoscerle, senza Gmail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifica, indirizzo, nomeMittente, testoDaHtml, allegatiDaTenere, nomeFileSicuro, testoInoltro, dataOraIt,
  testoNuovo, ringraziamento, rigaGradimento,
} from '../js/risposte-verbali-lettura.js';

const H = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const OGG = 'Re: FORMEDIL Padova -AREA SICUREZZA E SALUTE- Cantiere di VIA ROMA 30 CPT/26_27/0029 - LESSIO ROMOLO & F.LLI S.N.C. - Limena - Arch. Tommaso Visentini - 09/10/2026';

test('la risposta del CSE di Limena si riconosce e si gira', () => {
  const c = classifica(H({ From: 'geom.sinigaglia@libero.it', Subject: OGG }));
  assert.equal(c.nr, 'CPT/26_27/0029');
  assert.equal(c.da, 'geom.sinigaglia@libero.it');
  assert.equal(c.escludi, null);
});

test('oggetto codificato (RFC 2047): il numero si trova lo stesso', () => {
  const cod = '=?UTF-8?B?' + Buffer.from(OGG, 'utf8').toString('base64') + '?=';
  const c = classifica(H({ From: '"Mario Rossi" <m.rossi@impresa.it>', Subject: cod }));
  assert.equal(c.nr, 'CPT/26_27/0029');
  assert.equal(c.mittente, 'Mario Rossi');
});

test('senza numero di verbale non c\'entra', () => {
  assert.equal(classifica(H({ From: 'a@b.it', Subject: 'Re: preventivo corso' })).nr, null);
});

test('da dentro l\'ente non si gira (colleghi, l\'ufficio, i nostri avvisi)', () => {
  for (const f of ['cpt@formedilpadova.it', 'Nicola <nicola.demarco@did.formedilpadova.it>', 'x@scuolaedilepadova.net', 'cptpd@did.formedilpadova.it']) {
    assert.match(classifica(H({ From: f, Subject: OGG })).escludi || '', /dentro l'ente/, f);
  }
});

test('risposte automatiche e ricevute non si girano', () => {
  assert.ok(classifica(H({ From: 'a@b.it', Subject: OGG, 'Auto-Submitted': 'auto-replied' })).escludi);
  assert.ok(classifica(H({ From: 'a@b.it', Subject: 'Risposta automatica: ' + OGG })).escludi);
  assert.ok(classifica(H({ From: 'a@b.it', Subject: 'Letto: ' + OGG })).escludi);
  assert.ok(classifica(H({ From: 'posta-certificata@pec.it', Subject: 'CONSEGNA: ' + OGG })).escludi);
  assert.ok(classifica(H({ From: 'a@b.it', Subject: OGG, Precedence: 'bulk' })).escludi);
  assert.ok(classifica(H({ From: 'MAILER-DAEMON@x.it', Subject: OGG })).escludi);
  // una persona vera con Auto-Submitted: no
  assert.equal(classifica(H({ From: 'a@b.it', Subject: OGG, 'Auto-Submitted': 'no' })).escludi, null);
  // ⚠️ una risposta arrivata da PEC È una risposta vera
  const pec = classifica(H({ From: 'per conto di: a@pec.it <posta-certificata@pec.aruba.it>', 'Reply-To': 'a@pec.it', Subject: 'POSTA CERTIFICATA: ' + OGG }));
  assert.equal(pec.escludi, null);
  assert.equal(pec.rispondiA, 'a@pec.it', 'il «Rispondi» va al mittente vero, non alla PEC');
});

test('indirizzo e nome del mittente', () => {
  assert.equal(indirizzo('"Rossi, Mario" <M.Rossi@Impresa.IT>'), 'm.rossi@impresa.it');
  assert.equal(indirizzo('m.rossi@impresa.it'), 'm.rossi@impresa.it');
  assert.equal(nomeMittente('m.rossi@impresa.it'), 'm.rossi@impresa.it');
});

test('testo da HTML', () => {
  assert.equal(testoDaHtml('<html><head><style>p{}</style></head><p>Buongiorno,</p><p>ok&nbsp;fatto &amp; verificato<br>Saluti</p>'),
    'Buongiorno,\nok fatto & verificato\nSaluti');
});

test('allegati: via i loghi delle firme, restano documenti e foto incollate', () => {
  const t = allegatiDaTenere([
    { nome: 'logo.png', inline: true, dimensione: 4000 },
    { nome: 'foto-cantiere.jpg', inline: true, dimensione: 900000 },
    { nome: 'POS.pdf', inline: false, dimensione: 3000 },
    { nome: '', inline: false, dimensione: 100 },
  ]).map((x) => x.nome);
  assert.deepEqual(t, ['foto-cantiere.jpg', 'POS.pdf']);
  assert.equal(nomeFileSicuro('Verbale "è" ok/1.pdf'), 'Verbale _e_ ok_1.pdf');
});

test('il testo dell\'inoltro: chi ha scritto, il verbale, la mail com\'è', () => {
  const t = testoInoltro({
    nomeTecnico: 'Arch. Tommaso Visentini', nr: 'CPT/26_27/0029', impresa: 'LESSIO ROMOLO & F.LLI S.N.C.', dataVisita: '2026-10-09',
    mittente: 'geom.sinigaglia@libero.it', da: 'geom.sinigaglia@libero.it', data: '12/10/2026, 19:09', oggetto: OGG,
    corpo: 'Buongiorno, ho verificato il corretto uso dei DPI.', allegati: ['foto.jpg'], coordinatoreInCopia: true,
  });
  assert.match(t, /^Gentile Arch\. Tommaso Visentini,/);
  assert.match(t, /risposta al verbale CPT\/26_27\/0029 \(LESSIO ROMOLO & F\.LLI S\.N\.C\., visita del 09\/10\/2026\)/);
  assert.match(t, /la risposta va a chi ha scritto \(geom\.sinigaglia@libero\.it\)\. Il coordinatore è in copia\./);
  assert.match(t, /Da: geom\.sinigaglia@libero\.it\nData: 12\/10\/2026, 19:09\nOggetto: /, 'le righe vuote non spezzano l\'intestazione');
  assert.match(t, /ho verificato il corretto uso dei DPI/);
  assert.match(t, /Allegati: foto\.jpg/);
  assert.doesNotMatch(t, /\n\n\n/);
});

test('ora italiana', () => {
  assert.match(dataOraIt(Date.UTC(2026, 9, 12, 17, 9)), /12\/10\/2026.*19:09/);
});

test('la copia nella funzione è identica all\'originale', () => {
  for (const f of ['risposte-verbali-lettura.js', 'mail-respinte-lettura.js', 'firma.js']) {
    const o = fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
    const k = fs.readFileSync(new URL(`../supabase/functions/risposte-verbali/${f}`, import.meta.url), 'utf8');
    assert.equal(k, o, `${f}: npm run firma-sync`);
  }
});

/* ── 26/10/2026: i ringraziamenti diventano gradimento, senza voto e senza risposta ── */
const BIASIBETTI = 'Ricevuto\nRingrazio per il prezioso lavoro svolto\nCordiali saluti\n\nBiasibetti ing. Marco\n\nDa: Formedil Padova CPT <cptpd@did.formedilpadova.it>\nInviato: giovedì 15 ottobre 2026 17:08\nA: studiobiasibetti@gmail.com\nOggetto: FORMEDIL Padova -AREA SICUREZZA E SALUTE- ...\n\nSpett.le impresa ... errore ... rettifica';
const SINIGAGLIA = 'Buongiorno e grazie per la consulenza svolta.\nEseguirò un sopralluogo in cantiere nella giornata di lunedì per una verifica dei punti evidenziati nel verbale di sopralluogo e trasmetterò un puntuale riscontro.\nCordiali saluti\n\nIl giorno ven 9 ott 2026 alle ore 18:32 Formedil Padova CPT <cptpd@did.formedilpadova.it> ha scritto:\n> Spett.le impresa';

test('il testo nuovo si ferma dove comincia la mail citata', () => {
  assert.equal(testoNuovo(BIASIBETTI), 'Ricevuto\nRingrazio per il prezioso lavoro svolto\nCordiali saluti\n\nBiasibetti ing. Marco');
  assert.ok(!/Spett\.le/.test(testoNuovo(SINIGAGLIA)));
  assert.equal(testoNuovo('ok\n-----Original Message-----\nbla'), 'ok');
  assert.equal(testoNuovo('Grazie!\n> citato'), 'Grazie!');
});

test('i ringraziamenti veri del 10 e del 15 ottobre si riconoscono', () => {
  assert.equal(ringraziamento(BIASIBETTI), true, 'Biasibetti: «errore» e «rettifica» stanno nella mail citata, non contano');
  assert.equal(ringraziamento(SINIGAGLIA), true);
  assert.equal(ringraziamento('Complimenti al vostro tecnico, molto preciso.'), true);
});

test('non sono ringraziamenti: niente grazie, contestazioni, grazie di cortesia in fondo', () => {
  assert.equal(ringraziamento('Buongiorno, facendo seguito alla mail del 10/10/2026 comunico che ho verificato il corretto uso dei DPI.'), false);
  assert.equal(ringraziamento('Grazie, ma il verbale riporta un\'impresa sbagliata: va rettificato.'), false);
  assert.equal(ringraziamento('Buongiorno,\n' + 'nel cantiere di via Roma sono state sistemate le recinzioni e i parapetti. '.repeat(6) + '\nGrazie'), false);
  assert.equal(ringraziamento(''), false);
  assert.equal(ringraziamento('Da: x\nGrazie mille'), false, 'il grazie sta solo nella parte citata');
});

test('la riga di gradimento non inventa il voto e dice da dove viene', () => {
  const r = rigaGradimento({ gmailId: 'abc', ricevutaIl: '2026-10-15T15:11:19Z', mittente: 'Marco Biasibetti', da: 'studiobiasibetti@gmail.com',
    corpo: BIASIBETTI, nr: 'CPT/26_27/0034', visita: { visita_id: 'V1', data_visita: '2026-10-15' }, tecnico: 'Arch. Tommaso Visentini' });
  assert.equal(r.fonte, 'mail');
  assert.equal(r.submission_id, 'mail:abc', 'un giro ripetuto non la registra due volte');
  assert.equal(r.stato, 'ricevuto');
  assert.equal(r.visita_id, 'V1');
  assert.equal(r.commento, testoNuovo(BIASIBETTI));
  for (const k of ['utilita', 'motivi', 'azione_dopo', 'contatto_richiesto', 'recapito_contatto']) assert.ok(!(k in r), `${k}: non lo ha scritto nessuno`);
  assert.match(r.note_ufficio, /Nessun voto/);
  assert.match(r.note_ufficio, /non si risponde/);
  assert.equal(rigaGradimento({ gmailId: 'x', corpo: 'Grazie', nr: 'CPT/26_27/0099' }).riferimento_esito, 'verbale non trovato');
});

test('la funzione registra il gradimento e non risponde a chi ha scritto', () => {
  const src = fs.readFileSync(new URL('../supabase/functions/risposte-verbali/index.ts', import.meta.url), 'utf8');
  assert.match(src, /ringraziamento\(corpo\)/);
  assert.match(src, /from\('s_questionari_sopralluogo'\)\s*\.upsert\(/);
  assert.match(src, /onConflict: 'submission_id', ignoreDuplicates: true/);
  /* l'unica mail che parte è l'inoltro al tecnico: nessun invio verso chi ha scritto */
  assert.equal((src.match(/messages\/send/g) || []).length, 1);
});
