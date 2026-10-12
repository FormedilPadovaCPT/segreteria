// node test/risposte-verbali.test.mjs
// (12/10/2026) Le risposte ai verbali che tornano a cptpd@did si girano al tecnico che ha fatto la
// visita (edge function risposte-verbali). Qui le regole per riconoscerle, senza Gmail.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifica, indirizzo, nomeMittente, testoDaHtml, allegatiDaTenere, nomeFileSicuro, testoInoltro, dataOraIt,
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
