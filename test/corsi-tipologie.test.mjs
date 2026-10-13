// Tipologie di corso e scheda formativa, lato segreteria (13/10/2026, lotto 2 del fascicolo corso digitale).
// Dati INVENTATI. Il modulo importa core.js (browser): qui si prova la forma del sorgente e la
// funzione pura propostaDaTipologia, estratta dal testo (non ha dipendenze).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const src = leggi('../js/corsi-tipologie.js');
const corsi = leggi('../js/corsi.js');

test('la tipologia propone i campi del corso solo come proposta (il chiamante decide quando applicarla)', () => {
  assert.match(src, /export function propostaDaTipologia\(t\)/);
  assert.match(corsi, /if \(c\?\.id\) return;\n\s+const p = propostaDaTipologia\(tp\);/, 'sul corso esistente la scelta della tipologia non tocca i campi: i predefiniti valgono sul nuovo');
});

test('il corso nuovo congela la scheda formativa vigente e salva tipologia e firme QR', () => {
  assert.match(corsi, /scheda_formativa_id: dati\.tipologia_id \? \(schedaVigenteDi\(dati\.tipologia_id\)\?\.id \|\| null\) : null,/);
  assert.match(corsi, /tipologia_id: \$\('#fc-tipologia'\)\.value \? Number\(\$\('#fc-tipologia'\)\.value\) : null,/);
  assert.match(corsi, /firme_qr: \$\('#fc-qr'\)\.checked,/);
  assert.match(corsi, /\(com'è scritto\)/, 'una tipologia fuori elenco si mostra com\'è scritta');
});

test('le scritture passano dalle RPC e il PDF dalla funzione documenti-corso', () => {
  assert.match(src, /sb\.rpc\('tipologia_salva', \{ p \}\)/);
  assert.match(src, /sb\.rpc\('scheda_stato', \{ p_id: s\.id, p_stato: 'in_firma' \}\)/);
  assert.doesNotMatch(src, /from\('s_corsi_tipologie'\)\.(insert|update|delete|upsert)/);
  assert.match(src, /functions\.invoke\('documenti-corso', \{ body: \{ azione: 'scheda_formativa', id \} \}\)/);
});

test('in firma: i firmatari li dice il PDF (delegato, poi RPF) e il registro delle firme fa il resto', () => {
  assert.match(src, /tipo: 'scheda_formativa', rif: `scheda:\$\{s\.id\}`, titolo: r\.titolo, nome_file: r\.nome_file, byte: r\.byte, firmatari: r\.firmatari,/);
  assert.match(src, /import \{ chiediFirma \} from '\.\/firme\.js';/);
});

test('solo i campi cambiati, e niente da salvare se non si tocca nulla', () => {
  assert.match(src, /for \(const k of Object\.keys\(ora\)\) if \(!t \|\| String\(ora\[k\]\) !== String\(letto\[k\]\)\) p\[k\] =/);
  assert.match(src, /if \(t && Object\.keys\(p\)\.length === 1\) \{ toast\('Niente da salvare/);
});

test('l\'elenco dei corsi ha il pulsante del catalogo e la testata del corso dice la tipologia', () => {
  assert.match(corsi, /id="co-tipologie"/);
  assert.match(corsi, /\$\('#co-tipologie'\)\.addEventListener\('click', vistaTipologie\);/);
  assert.match(corsi, /\$\{c\.tipologia_id \? `<br>📋 tipologia: \$\{etichettaTipologia\(c\)\}` : ''\}/);
  assert.match(corsi, /try \{ await caricaTipologie\(\); \} catch \(e\) \{ tipErr = e\.message;/, 'se il catalogo non si legge la vista resta usabile');
});
