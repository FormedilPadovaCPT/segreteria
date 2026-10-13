// Il fascicolo del corso in segreteria (13/10/2026, lotto 3 del fascicolo corso digitale).
// Dati INVENTATI. Prove sulla forma del sorgente: i moduli importano core.js (browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const corsi = leggi('../js/corsi.js');
const tip = leggi('../js/corsi-tipologie.js');
const att = leggi('../js/corsi-attestati.js');
const anag = leggi('../js/corsi-anagrafica.js');
const fn = leggi('../supabase/functions/documenti-corso/index.ts');
const sql = leggi('../supabase/sql/2026_10_13_progetto_formativo_verbale.sql');

test('la scheda corso ha la sezione Fascicolo con progetto e verbale in firma', () => {
  assert.match(corsi, /function sezioneFascicolo\(c, verbale, firmaProg, firmaVerb, iscritti\)/);
  assert.match(corsi, /\$\{c\.tipologia_id \? `<hr[^`]*📁 Fascicolo del corso/);
  assert.match(corsi, /id="fs-prog-firma"/);
  assert.match(corsi, /id="fs-verb-firma"/);
  assert.match(corsi, /firmeDi\('progetto_formativo', \[`progetto:\$\{c\.id\}`\]\)/);
  assert.match(corsi, /firmeDi\('verbale_verifica', \[`verbale:\$\{verbale\.id\}`\]\)/);
});

test('in firma: il PDF lo disegna documenti-corso e i firmatari li dice il PDF', () => {
  assert.match(tip, /export async function mandaInFirmaProgetto\(c\)/);
  assert.match(tip, /tipo: 'progetto_formativo', rif: `progetto:\$\{c\.id\}`, corso_id: c\.id, titolo: r\.titolo, nome_file: r\.nome_file, byte: r\.byte, firmatari: r\.firmatari/);
  assert.match(tip, /tipo: 'verbale_verifica', rif: `verbale:\$\{v\.id\}`, corso_id: c\.id/);
  assert.match(tip, /sb\.rpc\('corso_progetto_stato', \{ p_corso: c\.id, p_stato: 'in_firma' \}\)/);
  assert.match(tip, /sb\.rpc\('corso_verbale_stato', \{ p_id: v\.id, p_stato: 'in_firma' \}\)/);
  assert.match(tip, /if \(c\.progetto_stato !== 'pronto'\) return toast\(/, 'si manda in firma solo un progetto pronto');
});

test('il corso dice da dove nasce, se la conferenza è formativa e il codice Socrate', () => {
  assert.match(corsi, /const ORIGINI = \{ progetto_finanziato:/);
  assert.match(corsi, /origine_tipo: \$\('#fc-origine'\)\.value \|\| null,/);
  assert.match(corsi, /codice_socrate: \$\('#fc-socrate'\)\.value\.trim\(\) \|\| null,/);
  assert.match(corsi, /formativa: \$\('#fc-tipo'\)\.value === 'conferenza_cantiere' \? \$\('#fc-formativa'\)\.checked : null,/, 'formativa solo per le conferenze');
});

test('gli attestati di un corso dell\'Accordo aspettano il verbale firmato, e la mansione è grave per i corsi a catalogo', () => {
  assert.match(att, /sb\.rpc\('corso_e_accordo', \{ p_corso: c\.id \}\)/);
  assert.match(att, /gli attestati si emettono dopo il verbale di verifica finale firmato/);
  assert.match(att, /Non riesco a verificare se il corso è dell\\'Accordo/, 'un errore di lettura si dice, non vale «non è dell\'Accordo»');
  assert.match(anag, /grave: 'se_tipologia'/);
  assert.match(anag, /if \(campo\.grave === 'se_tipologia'\) return !!corso\?\.tipologia_id;/);
});

test('la funzione documenti-corso disegna i tre documenti e il database fa da guardiano', () => {
  for (const a of ['scheda_formativa', 'progetto_formativo', 'verbale_verifica']) assert.match(fn, new RegExp(`azione === '${a}'`));
  assert.match(fn, /export async function disegnaProgetto\(/);
  assert.match(fn, /export async function disegnaVerbale\(/);
  assert.match(fn, /cf: '80006850285', piva: '02585760289'/, 'i dati del soggetto formatore come nei modelli dell\'Ufficio Corsi');
  assert.match(sql, /create trigger trg_s_corsi_iscritti_guardia_attestato/);
  assert.match(sql, /l''attestato si emette dopo il verbale di verifica finale firmato/);
  assert.match(sql, /ammessi senza mansione/);
});
