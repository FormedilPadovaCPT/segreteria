// La lettera di incarico passa al tecnico per accettazione (14/10/2026).
// Prove sulla forma del sorgente della funzione, che gira su Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const fn = leggi('../supabase/functions/firma-documenti/index.ts');

test('il ruolo incaricato esiste in funzione, database e app', () => {
  assert.match(fn, /const RUOLI = \['presidente', 'direttore', 'rpf', 'docente', 'incaricato', 'personale'\]/, 'dal 21/10/2026 anche «personale» (documenti al personale)');
  assert.match(leggi('../supabase/sql/2026_10_14_firme_incaricato.sql'), /'docente', 'incaricato'\)\)/);
  assert.match(leggi('../js/firme.js'), /incaricato: 'tecnico per accettazione'/);
});

test('firma il tecnico incaricato: la riga è sua per indirizzo e basta un accesso del personale', () => {
  assert.match(fn, /if \(String\(r\.firmatario_email\)\.toLowerCase\(\) !== io\) return json/);
  assert.match(fn, /: rl === 'incaricato' \? await ruolo\('is_personale'\)/);
  assert.match(fn, /if \(rl === 'docente' \|\| rl === 'incaricato' \|\| rl === 'personale'\) \{/, 'la firma scansionata del tecnico');
});

test('accoda: solo la segreteria, solo su un documento firmato e senza firme in attesa, sul PDF firmato', () => {
  assert.match(fn, /\['richiedi', 'avvisa', 'ritira', 'autografa', 'accoda'\]\.includes\(azione\)/);
  const i = fn.indexOf("if (azione === 'accoda')");
  const a = fn.slice(i, i + 4200);
  assert.match(a, /if \(r\.stato !== 'firmata' \|\| !r\.file_firmato\)/);
  assert.match(a, /some\(\(x: Riga\) => x\.stato !== 'firmata'\)/);
  assert.match(a, /Number\(x\.ordine\) > Number\(r\.ordine\)/, 'si accoda solo all\'ultima firma');
  assert.match(a, /file_originale: r\.file_firmato, file_precedente: r\.file_firmato, sha256_originale: impronta/);
  assert.match(a, /ordine: Number\(r\.ordine\) \+ 1 \+ i/);
  /* (28/10/2026) il controllo vale per ogni riquadro, anche quelli in `altri` */
  assert.match(a, /tuttiRiquadri\(rq\)\.some\(\(q\) => q\.pagina >= pdf\.getPageCount\(\)\)/);
});

test('la mail al tecnico dice «per accettazione»', () => {
  assert.match(fn, /firma\$\{rl === 'incaricato' \? ' per accettazione' : ''\}:/);
});
