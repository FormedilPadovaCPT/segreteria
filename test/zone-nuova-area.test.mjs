// node --test test/zone-nuova-area.test.mjs
// (05/10/2026) «Tecnici e zone»: la segreteria crea un'area nuova per un tecnico.
// L'area prende il numero dopo l'ultimo, nasce col tecnico da oggi e vuota; i comuni si aggiungono con «+ Comune».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leggi = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const js = leggi('../js/zone-tecnici.js');
const sql = leggi('../supabase/sql/2026_10_05_zone_crea_area.sql');
const aiuto = leggi('../js/aiuto.js');

test('il database: solo segreteria, numero dopo l’ultimo sotto lucchetto, tecnico da oggi', () => {
  const f = sql.match(/create or replace function public\.zone_crea_area\([\s\S]*?\nend \$\$;/);
  assert.ok(f, 'manca zone_crea_area');
  const corpo = f[0];
  assert.match(corpo, /security definer/);
  assert.match(corpo, /if not \(\(select public\.is_segreteria\(\)\) or session_user = 'postgres'\) then raise exception/);
  assert.match(corpo, /raise exception 'Il tecnico non è in servizio'/, 'un tecnico non in servizio non prende aree');
  const lucchetto = corpo.indexOf('lock table public.zone_aree in exclusive mode');
  const massimo = corpo.indexOf('select coalesce(max(area_id), 0) + 1 into n from public.zone_aree');
  assert.ok(lucchetto > 0 && massimo > lucchetto, 'il numero si calcola dopo il lucchetto, o due creazioni insieme prendono lo stesso');
  assert.match(corpo, /insert into public\.zone_aree_tecnici \(area_id, tecnico_id, nome, dal, fonte\)\s+values \(n, t\.tecnico_id, t\.cognome, current_date, 'scheda Tecnici e zone'\)/);
  assert.doesNotMatch(corpo, /zone_aree_comuni/, 'l’area nasce vuota: i comuni passano da zone_sposta');
  assert.match(sql, /revoke execute on function public\.zone_crea_area\(text, text, text\) from public, anon;/);
});

test('la schermata: pulsante, chiamata giusta, poi la finestra dei comuni sull’area nuova', () => {
  assert.match(js, /<h3>Aree <button type="button" class="btn btn-ghost btn-sm" id="zt-nuova-area">\+ Nuova area<\/button><\/h3>/);
  assert.match(js, /\$\('#zt-nuova-area'\)\?\.addEventListener\('click', apriNuovaArea\);/);
  const f = js.match(/function apriNuovaArea\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(f, 'manca apriNuovaArea');
  assert.match(f[0], /if \(!tec\) \{ toast\('Scegli il tecnico', 'err'\); return; \}/);
  assert.match(f[0], /sb\.rpc\('zone_crea_area', \{ p_tecnico: tec, p_etichetta: [^,]+, p_note: [^}]+\}\)/);
  assert.match(f[0], /if \(error\) \{ toast\('Area non creata: ' \+ error\.message, 'err'\); return; \}/, 'un errore si dice, non si tace');
  assert.match(f[0], /await render\(\);\n    apriAggiungi\(data\.area\);/);
});

test('le nuvolette dei due pulsanti', () => {
  assert.match(aiuto, /"zt-nuova-area": "/);
  assert.match(aiuto, /"zt-nuova-ok": "/);
});
