// L'ASSEMBLEA SINDACALE (02/11/2026): art. 17 lett. B del CCNL Formazione Professionale 2024-2027,
// 12 ore retribuite per anno formativo dal 1° settembre. È la «Riunione sindacale» di sempre: la
// causale non cambia. L'assemblea è già autorizzata: la richiesta nasce approvata, senza nulla osta.
// Il conteggio sta nel database (s_assemblea_ore), provato in tests-db/46_assemblea_sindacale.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');
const amm = readFileSync(new URL('../js/amministrazione.js', import.meta.url), 'utf8');
const aiuto = readFileSync(new URL('../js/aiuto.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/sql/2026_11_02_ferie_assemblea_sindacale.sql', import.meta.url), 'utf8');

test('la causale resta «Riunione sindacale», sul monte dei permessi sindacali', () => {
  assert.match(src, /tipo: 'riunione_sindacale', etichetta: 'Assemblea sindacale[^']*', monte: 'permessi_sindacali', causale: 'Riunione sindacale'/);
});

test('la partecipazione nasce approvata, senza nulla osta, con la fotografia del contatore', () => {
  assert.match(src, /assemblea \? \{ aut_stato: 'approvata', aut_modalita: 'assemblea'/);
  assert.match(src, /assemblea_foto: assembleaFoto/);
  assert.match(src, /r\.aut_modalita === 'assemblea' \? 'non serve/);
  assert.match(amm, /r\.aut_modalita === 'assemblea' \? 'non serve/);
});

test('il contatore si legge dal database, non si calcola nella pagina', () => {
  assert.match(src, /sb\.rpc\('s_assemblea_ore'/);
  assert.match(sql, /create or replace function public\.s_assemblea_ore/);
  assert.match(sql, /\('presenze_assemblea_ore_annue', '12'/);
  assert.match(sql, /\('presenze_assemblea_inizio_anno', '09-01'/);
  assert.match(sql, /lower\(btrim\(e\.causale\)\) = 'riunione sindacale'/);
  /* una lettura fallita non diventa «zero ore usate» */
  assert.match(sql, /if not public\.is_segreteria\(\) then\s+raise exception/);
  assert.match(src, /Non sono riuscito a leggere le ore di assemblea/);
});

test('il pulsante ha la sua nuvoletta', () => {
  assert.match(aiuto, /'fr-crea': '.*assemblea sindacale/);
});
