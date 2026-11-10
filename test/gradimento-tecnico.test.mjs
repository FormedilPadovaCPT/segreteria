// Il gradimento al tecnico della visita (10/11/2026, deciso dall'utente). Dati INVENTATI.
//
// Regole provate qui:
//  - va al tecnico della visita, il secondo tecnico e il coordinatore in copia;
//  - indirizzi ripetuti tolti: se il tecnico è il coordinatore, una mail sola;
//  - parte anche col voto basso;
//  - nella mail NON ci sono recapito, e-mail o «vuole essere contattato» di chi ha compilato;
//  - il testo di chi compila è escapato (è testo di un estraneo dentro una mail dell'ente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { destinatariGradimento, mailTecnico, messaggioMime } from '../supabase/functions/portale-richieste/mail.ts';

const COORD = 'coordinatore.prova@esempio.it';

test('al tecnico, col coordinatore in copia', () => {
  assert.deepEqual(destinatariGradimento([{ email: 'tecnico.prova@esempio.it' }], COORD),
    { a: 'tecnico.prova@esempio.it', cc: [COORD] });
});

test('il secondo tecnico va in copia, prima del coordinatore', () => {
  assert.deepEqual(destinatariGradimento([{ email: 'uno@esempio.it' }, { email: 'due@esempio.it' }], COORD),
    { a: 'uno@esempio.it', cc: ['due@esempio.it', COORD] });
});

test('se il tecnico è il coordinatore gli arriva una volta sola', () => {
  assert.deepEqual(destinatariGradimento([{ email: 'Coordinatore.Prova@esempio.it' }], COORD),
    { a: 'Coordinatore.Prova@esempio.it', cc: [] });
});

test('senza indirizzo del tecnico non si manda niente (nemmeno al solo coordinatore)', () => {
  assert.equal(destinatariGradimento([{ email: '' }, { email: null }], COORD), null);
  assert.equal(destinatariGradimento([{ email: 'non è un indirizzo' }], COORD), null);
});

const Q = {
  nr_verbale: 'CPT/26_27/9999', data_visita: '2026-11-05', utilita: 2,
  motivi: 'Non ha spiegato <b>niente</b>', azione_dopo: 'Niente', commento: 'Riga uno\nRiga due',
  qst_contatto: 'Sì', recapito_contatto: '333 0000000', email: 'compilante.prova@esempio.it',
};

test('parte anche col voto basso, e l\'oggetto dice il voto', () => {
  const m = mailTecnico(Q, 'Mario');
  assert.match(m.oggetto, /verbale CPT\/26_27\/9999: 2 su 5/);
  assert.match(m.html, /2 su 5 — poco utile/);
  assert.match(m.html, /Gentile Mario,/);
  assert.match(m.html, /05\/11\/2026/);
});

test('niente recapito né e-mail di chi ha compilato', () => {
  const { html } = mailTecnico(Q, 'Mario');
  assert.ok(!html.includes('333 0000000'), 'il recapito resta alla segreteria');
  assert.ok(!html.includes('compilante.prova@esempio.it'), 'l\'indirizzo di chi compila non va al tecnico');
  assert.ok(!/contattat/i.test(html), 'niente «vuole essere contattato»');
});

test('il testo di chi compila è escapato', () => {
  const { html } = mailTecnico(Q, 'Mario');
  assert.ok(!html.includes('<b>niente</b>'));
  assert.match(html, /&lt;b&gt;niente&lt;\/b&gt;/);
  assert.match(html, /Riga uno<br>Riga due/);
});

test('il messaggio porta il Cc e l\'oggetto col prefisso dell\'ufficio', () => {
  const mime = messaggioMime({ a: 'uno@esempio.it', cc: ['due@esempio.it', COORD], rispondiA: 'cpt@formedilpadova.it', oggetto: 'Prova', html: '<p>x</p>' });
  assert.match(mime, /\r\nCc: due@esempio\.it, coordinatore\.prova@esempio\.it\r\n/);
  assert.match(mime, /Reply-To: cpt@formedilpadova\.it/);
  assert.throws(() => messaggioMime({ a: 'uno@esempio.it', cc: ['due@esempio.it\r\nBcc: x@y.it'], oggetto: 'x', html: 'x' }));
  const senza = messaggioMime({ a: 'uno@esempio.it', oggetto: 'Prova', html: 'x' });
  assert.ok(!/\r\nCc:/.test(senza), 'senza copia niente riga Cc');
});

test('il portale la chiama solo per il questionario, una volta sola', () => {
  const src = readFileSync(new URL('../supabase/functions/portale-richieste/index.ts', import.meta.url), 'utf8');
  assert.match(src, /tipo === 'qst' && !esito\.mail_tecnico_il/);
  assert.match(src, /gradimentoAlTecnico\(sb, sa, p\.id\)/);
});
