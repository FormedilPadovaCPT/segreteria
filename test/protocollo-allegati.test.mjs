// Più allegati su un protocollo, fin dalla prima maschera.
// Nato il 21/09/2026 da una segnalazione dell'utente: protocollando in uscita
// si poteva scegliere un file solo, e una lettera con i suoi allegati non si
// riusciva a registrare in un colpo. È lo stesso difetto che ha lasciato la
// bozza del Prot. 2582 senza allegati (s_prot_invii li registra vuoti): i
// documenti erano stati aggiunti a mano in Outlook.
// Si legge il sorgente come testo: protocollo.js importa Supabase dal CDN e
// in Node non si carica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/protocollo.js', import.meta.url), 'utf8');

/* il pezzo di codice che salva un protocollo nuovo */
const salvataggio = src.slice(src.indexOf('/* allegati + timbro'), src.indexOf('attendi(btn, false);\n  toast(`Protocollo'));

test('la maschera di creazione accetta più file', () => {
  const input = src.match(/<input type="file" id="c-file"[^>]*>/);
  assert.ok(input, 'il campo file della maschera di creazione non si trova');
  assert.match(input[0], /\bmultiple\b/, 'senza multiple si può scegliere un file solo');
});

test('il campo del dettaglio accetta più file', () => {
  const input = src.match(/<input type="file" id="att-file"[^>]*>/);
  assert.ok(input, 'il campo file del dettaglio non si trova');
  assert.match(input[0], /\bmultiple\b/);
});

test('chi carica per timbrare prende un file solo', () => {
  // il timbro si mette su un documento per volta: quei due punti devono
  // spegnere multiple prima di aprire la finestra dei file
  const spenti = [...src.matchAll(/inp\.multiple = false;/g)];
  assert.equal(spenti.length, 2, 'i due punti «carica e timbra» devono impostare multiple = false');
});

test('il salvataggio cicla su tutti i file scelti', () => {
  assert.match(salvataggio, /Array\.from\(\$\('#c-file'\)\?\.files \|\| \[\]\)/,
    'il salvataggio deve leggere tutti i file, non solo files[0]');
  assert.match(salvataggio, /for \(const \[i, file\] of files\.entries\(\)\)/);
});

test('solo il primo file è il principale e finisce sulla riga del protocollo', () => {
  assert.match(salvataggio, /const principale = i === 0;/);
  assert.match(salvataggio, /if \(principale\) \{[\s\S]*?from\('s_protocollo'\)\.update/,
    'drive_url sulla riga del protocollo va scritto solo per il principale');
});

test('il timbro si propone una volta sola, sul primo PDF', () => {
  assert.match(salvataggio, /if \(att && !daTimbrare && \/\\\.pdf\$\/i\.test\(file\.name\)\) daTimbrare = att\.id;/);
  assert.equal((salvataggio.match(/timbraAllegato\(/g) || []).length, 1,
    'timbraAllegato va chiamata una volta, non una per file');
});

test('un file che fallisce non ferma gli altri', () => {
  assert.match(salvataggio, /falliti\.push/);
  assert.match(salvataggio, /catch \(err\) \{\s*falliti\.push/);
  assert.match(salvataggio, /supera i \$\{LIMITE_MB\} MB/,
    'il file troppo grande si dichiara, non si perde in silenzio');
});

test('il caricamento multiplo dal dettaglio esiste ed è sequenziale', () => {
  const f = src.slice(src.indexOf('async function caricaAllegati('), src.indexOf('/* ── collegare un documento'));
  assert.ok(f.length > 200, 'caricaAllegati non si trova');
  assert.match(f, /for \(const file of files\)/, 'i caricamenti vanno uno dopo l\'altro, non in parallelo');
  assert.doesNotMatch(f, /Promise\.all/, 'in parallelo la cartella su Drive verrebbe creata due volte');
  assert.match(f, /if \(files\.length === 1\) return caricaAllegato\(files\[0\]\);/,
    'con un file solo deve restare il giro di prima, che sa anche timbrare');
});
