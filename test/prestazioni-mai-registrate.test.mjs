// Le attività dei mesi già chiusi mai entrate in un riepilogo (07/10/2026, proposta approvata dall'utente).
// Caso: la docenza di De Marco alla Formazione tecnici (corso 203), settembre chiuso senza registrarla: nessuna
// chiusura la riproponeva. Ora la chiusura le mostra senza spunta (s_prestazioni_mai_registrate); se si pagano
// restano del loro mese, se no si registrano come chiuse col motivo. Girano con `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ft = fs.readFileSync(new URL('../js/fatture-tecnici.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const aiuto = fs.readFileSync(new URL('../js/aiuto.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../supabase/sql/2026_10_07_prestazioni_mai_registrate.sql', import.meta.url), 'utf8');

test('la chiusura le legge e le mostra senza spunta; una lettura fallita si dice', () => {
  assert.ok(/sb\.rpc\('s_prestazioni_mai_registrate', \{ p_tecnico: t\.tecnico_id, p_anno: anno, p_mese: mese \}\)/.test(ft));
  assert.ok(/\[\.\.\.arretrate, \.\.\.maiReg, \.\.\.\(calc \|\| \[\]\)\]/.test(ft), 'in elenco con le altre');
  assert.ok(/sel: !r\.fattura_id && !r\.chiusa_il && !r\.mai/.test(ft), 'senza spunta');
  assert.ok(/\$\{eMai \? `<div class="dt-doc-riga"[^`]*Non sono riuscito a cercare le attività dei mesi passati/.test(ft), 'lettura fallita ≠ nessuna');
});

test('pagate restano del loro mese; non pagate si registrano chiuse col motivo', () => {
  const f = ft.slice(ft.indexOf('function rigaPrestazione('), ft.indexOf('function datiRiepilogo('));
  const riga = new Function('cursore', 'nomeTec', 'meseRange', 'state', `${f}; return rigaPrestazione;`)(
    '2026-10', () => 'De Marco', (a, m) => ({ da: `${a}-${String(m).padStart(2, '0')}-01` }), { email: 'seg@x' });
  const r = riga({ tecnico_id: 'T' }, { mai: true, origine_anno: 2026, origine_mese: 9, data: '2026-09-19', tipo: 'docenza', corso_incarico_id: 143, importo: 0 }, 931, 'nota');
  assert.equal(r.anno, 2026); assert.equal(r.mese, 9, 'resta di settembre');
  assert.equal(r.corso_incarico_id, 143); assert.equal(r.incarico_mensile_id, 931); assert.equal(r.note, 'nota');
  assert.ok(/\.\.\.\(r\.mai \? \{\} : \{ anno, mese \}\)/.test(ft), 'nel congelamento il mese della chiusura vale solo per le altre');
  assert.ok(/righe\.filter\(\(r\) => r\.mai && !r\.sel\)/.test(ft) && /sb\.rpc\('s_prestazioni_chiudi', \{ p_ids: \(ins \|\| \[\]\)\.map\(\(x\) => x\.id\), p_motivo: motivo\.trim\(\) \}\)/.test(ft));
  assert.ok(aiuto.includes('"cm-chiudi-mai": "'), 'nuvoletta');
});

test('il database: solo righe senza prestazione dei mesi prima, mai quelli ancora aperti', () => {
  assert.ok(/where e->>'prestazione_id' is null/.test(sql));
  assert.ok(/im\.stato = 'aperto'/.test(sql) && /continue when exists/.test(sql), 'un mese aperto si chiude da sé');
  assert.ok(/raise exception 'Non autorizzato'/.test(sql) && /revoke execute on function public\.s_prestazioni_mai_registrate/.test(sql));
});
