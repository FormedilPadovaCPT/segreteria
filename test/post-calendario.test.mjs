// node --test test/post-calendario.test.mjs
// (06/11/2026, chiesto dall'utente) Un post approvato dal Direttore con la data «Da pubblicare il» va da solo nel
// calendario di cptpd@ alle 9:30 di quel giorno, con la notifica; pubblicato, l'evento resta segnato «✅ Pubblicato».
// Lo fa il database (trigger s_post_calendario → funzione calendario-post; prova in tests-db/48): qui si tiene
// fermo che la funzione rispetti le scelte dell'utente e che la pagina dica che cosa c'è in calendario.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const leggi = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fn = leggi('supabase/functions/calendario-post/index.ts');
const sql = leggi('supabase/sql/2026_11_06b_post_calendario.sql');
const com = leggi('js/comunicazione.js');

test('le scelte dell\'utente: calendario di cptpd@, 9:30, l\'evento resta dopo la pubblicazione', () => {
  assert.match(sql, /\('post_calendario_id', 'cptpd@did\.formedilpadova\.it'/);
  assert.match(sql, /\('post_calendario_ora', '09:30'/);
  assert.match(fn, /if \(p\.stato === 'approvato' && p\.data_programmata\)/, 'solo un post approvato e con la data');
  assert.match(fn, /summary: pubblicato \? `✅ Pubblicato: \$\{titolo\}` : `📣 Pubblica il post: \$\{titolo\}`/);
  assert.match(fn, /reminders: pubblicato \? \{ useDefault: false, overrides: \[\] \} : \{ useDefault: false, overrides: \[\{ method: 'popup', minutes: 0 \}\] \}/,
    'notifica all\'ora dell\'evento finché è da pubblicare, nessuna dopo');
  assert.match(fn, /\} else if \(ev\) \{\n\s+await G\('DELETE'/, 'tornato in bozza o scartato: l\'evento si toglie');
});

test('nessuno riceve niente: niente invitati, niente mail di Google', () => {
  assert.ok(!/attendees/.test(fn), 'l\'evento non ha invitati');
  assert.ok(!/sendUpdates=all/.test(fn), 'Google non manda inviti');
  assert.ok((fn.match(/sendUpdates=none/g) || []).length >= 4);
});

test('chi può chiamare la funzione', () => {
  assert.match(fn, /if \(!cfg\.calendario_post_token \|\| gettone !== cfg\.calendario_post_token\) return json\(\{ error: 'accesso non autorizzato' \}, 401\)/);
  assert.match(fn, /utente\.rpc\('is_segreteria'\)/, 'dalla pagina: solo la segreteria');
  assert.match(fn, /if \(corpo\?\.tutti === true\) \{\n\s+if \(!segreteria\)/, 'il riallineamento di tutti solo dalla segreteria');
});

test('il trigger non blocca mai il salvataggio del post', () => {
  assert.match(sql, /exception when others then\n\s+raise warning 's_post_calendario_avvisa/);
  assert.match(sql, /url := 'https:\/\/utdantrfugnmqsuujxbe\.supabase\.co\/functions\/v1\/calendario-post'/);
});

test('la pagina dice che cosa c\'è in calendario e lo lascia riallineare', () => {
  assert.match(com, /📅 <strong>Promemoria in calendario:<\/strong>/);
  assert.ok(com.includes('esc(p.calendario_esito)'), 'l\'esito passa da esc()');
  assert.match(com, /sb\.functions\.invoke\('calendario-post', \{ body: \{ post_id: id \} \}\)/);
  assert.match(com, /\['approvato', 'pubblicato'\]\.includes\(p\.stato\) \? '<button class="btn btn-ghost btn-sm" id="pd-cal"/);
});
