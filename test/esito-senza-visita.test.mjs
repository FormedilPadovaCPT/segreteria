// L'uscita senza verbale «cantiere finito / non trovato» (07/10/2026, piano approvato dall'utente): nel cruscotto la
// segreteria vede l'esito con la nota del tecnico e chiude l'incarico; nella chiusura del mese l'uscita si paga come
// una visita (parte e del calcolo), e la parte c) non la conta una seconda volta. Girano con `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const home = fs.readFileSync(new URL('../js/home.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = fs.readFileSync(new URL('../supabase/sql/2026_10_07_prestazioni_senza_visita.sql', import.meta.url), 'utf8');

test('il cruscotto: esito, nota del tecnico, chiusura', () => {
  assert.ok(/esito_senza_visita, esito_data, esito_nota'\)\n\s*\.eq\('stato', 'eseguito'\)/.test(home), 'legge l\'esito degli eseguiti');
  assert.ok(/if \(r\.esito_senza_visita\) \{/.test(home) && /data-chiudi-esito="\$\{r\.id\}"/.test(home));
  // (12/10/2026) se l'uscita si paga lo decide la segreteria: due pulsanti, «non si paga» chiede il motivo
  assert.ok(/data-paga="1"[^>]*>💶 Chiudi e paga</.test(home) && /data-paga="0"[^>]*>🚫 Chiudi senza pagare</.test(home), 'i due pulsanti');
  assert.ok(/sb\.rpc\('incarico_esito_chiudi', \{ p_id: id, p_pagare: paga, p_motivo: motivo \}\)/.test(home) && /if \(error\) return toast\('Non chiuso: '/.test(home));
  assert.ok(/if \(!motivo\.trim\(\)\) return toast\('Senza motivo non si chiude/.test(home), 'senza motivo non parte');
});

test('il cruscotto mostra le foto, e dice se non le legge', () => {
  assert.ok(/from\('incarichi_foto'\)\.select\('incarico_id, drive_url'\)\.in\('incarico_id', conEsito\)/.test(home));
  assert.ok(/📷 foto \$\{k \+ 1\}/.test(home) && /foto non lette/.test(home));
});

test('il calcolo: l\'uscita si paga come una visita, una volta sola', () => {
  assert.ok(/'sorgente', 'senza_visita'/.test(sql) && /'tipo', 'visita_prima'/.test(sql));
  assert.ok(/public\.s_tariffa\('visita_prima', i\.esito_data, p_tecnico\)/.test(sql), 'tariffa della visita, alla data dell\'uscita');
  assert.ok(/and i\.esito_data between v_dal and v_al/.test(sql), 'nel mese in cui è andato');
  assert.ok(/and i\.esito_senza_visita is null {3}-- 07\/10\/2026/.test(sql), 'la parte c) la esclude');
  assert.ok(/a\.data_delibera is not null or a\.data_parere is not null/.test(sql), 'resta la regola delle asseverazioni a fine processo');
});

test('la decisione della segreteria: «non si paga» resta fuori dalla chiusura del mese', () => {
  const dec = fs.readFileSync(new URL('../supabase/sql/2026_10_12_prestazioni_senza_visita_decisione.sql', import.meta.url), 'utf8');
  assert.ok(/and i\.esito_pagare is distinct from false/.test(dec), 'non si paga: fuori');
  assert.ok(/when i\.esito_pagare is null\s+then 'la segreteria non ha ancora deciso se pagarla/.test(dec), 'non ancora deciso: la riga resta, con l’avviso');
});
