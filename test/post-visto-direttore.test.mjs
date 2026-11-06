// node --test test/post-visto-direttore.test.mjs
// (06/11/2026, deciso dall'utente) I post social non li approva più la segreteria: li manda al Coordinatore
// (visto, poi comunque al Direttore) o direttamente al Direttore, che approva nella pagina «📣 Comunicazione»
// del gestionale. Il blocco vero è nel database (trigger s_post_regola e funzioni s_post_manda/ritira/decidi,
// supabase/sql/2026_11_06_post_visto_coordinatore_direttore.sql; prova in tests-db/47): qui si tiene fermo
// che la pagina Comunicazione della segreteria non offra più la scorciatoia e mostri che cosa hanno detto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const leggi = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const com = leggi('js/comunicazione.js');
const sql = leggi('supabase/sql/2026_11_06_post_visto_coordinatore_direttore.sql');

test('la segreteria non approva da sé: niente più «✅ Approva» né stato approvato scritto dalla pagina', () => {
  assert.ok(!com.includes('id="pd-approva"'), 'il pulsante «Approva» non c\'è più');
  assert.ok(!/stato: 'approvato'/.test(com), 'la pagina non scrive mai stato = approvato');
  assert.match(sql, /if new\.stato = 'approvato' then\s+raise exception 'Un post lo approva il Direttore/, 'e il database lo rifiuta comunque');
});

test('si manda al Coordinatore o al Direttore, dopo aver salvato', () => {
  assert.match(com, /id="pd-al-coord"/);
  assert.match(com, /id="pd-al-dir"/);
  const salva = com.indexOf("if (!await salva({}, 'Salvato.')) { attendi(btn, false); return; }");
  const rpc = com.indexOf("sb.rpc('s_post_manda', { p_post: id, p_verso: verso, p_nota: nota.trim() || null })");
  assert.ok(salva > 0 && rpc > salva, 'prima si salva il testo a schermo, poi parte');
  assert.match(com, /sb\.rpc\('s_post_ritira', \{ p_post: id \}\)/, 'e si può ritirare');
});

test('mentre aspetta il post è fermo, e la pagina lo dice', () => {
  assert.match(com, /const IN_ATTESA = \['al_coordinatore', 'al_direttore'\];/);
  assert.match(com, /if \(attende && !Object\.keys\(extra\)\.length\) return true;/, 'il salvataggio non tocca un post che aspetta');
  assert.match(com, /\$\{attende \? '' : '<button class="btn btn-ghost" id="pd-salva">/, 'niente «Salva» mentre aspetta');
  assert.match(com, /Mentre aspetta il post non si cambia/);
});

test('le note di Coordinatore e Direttore arrivano alla segreteria', () => {
  assert.match(com, /sb\.from\('s_post_passaggi'\)\.select\('\*'\)/, 'si leggono i passaggi');
  assert.match(com, /if \(ePa\) toast\('Non sono riuscito a leggere i visti e le approvazioni/, 'una lettura fallita si dice');
  assert.match(com, /Indicazioni del Direttore, da applicare prima di pubblicare/);
  assert.match(com, /l\\'approvazione vale: applicale e pubblica, senza ripassare dal Direttore/, 'approvato con indicazioni non riapre il post');
  for (const campo of ['nota.nota', "x.nota || ''",'x.nota_richiesta', 'u.nota.slice(0, 90)', 'x.deciso_da_nome || \'\'']) {
    assert.ok(com.includes('esc(' + campo + ')'), `${campo} deve passare da esc()`);
  }
});

test('nel database: il visto del Coordinatore non basta, passa al Direttore', () => {
  assert.match(sql, /if p_esito = 'visto' then\n\s+\/\* il visto non basta/);
  assert.match(sql, /'visto_coordinatore'/);
  assert.match(sql, /'post_' \|\| p_esito/, 'un evento di notifica per esito: push_accoda scarta lo stesso evento entro 2 minuti');
  assert.match(sql, /'\.\/\?vista=comunicazione'/, 'la notifica apre la pagina Comunicazione del gestionale');
});
