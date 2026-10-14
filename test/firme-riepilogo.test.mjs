// Firme del Presidente: un riepilogo deciso dalla segreteria, non una mail
// a ogni documento (14/10/2026). Dati INVENTATI. La funzione gira su
// Supabase: qui si prova la forma del sorgente e, estraendola, la funzione
// che compone il messaggio dopo una richiesta di firma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const fn = leggi('../supabase/functions/firma-documenti/index.ts');
const firme = leggi('../js/firme.js');

/* esitoAvvisi è pura: la si estrae dal modulo, che importa core.js (browser) */
const corpo = firme.slice(firme.indexOf('export function esitoAvvisi'), firme.indexOf('/* l\'errore di una edge function'));
const esitoAvvisi = new Function(`${corpo.replace('export function', 'function')}; return esitoAvvisi;`)();

test('richiedi: il firmatario a raccolta non riceve né mail né notifica', () => {
  const i = fn.indexOf("if (azione === 'richiedi')"), j = fn.indexOf("if (azione === 'avvisa')");
  const r = fn.slice(i, j);
  assert.match(r, /if \(aRaccolta\(firmatari\[0\]\.ruolo\)\) perRiepilogo\.set/);
  assert.match(r, /else daAvvisare\.add\(firmatari\[0\]\.email\)/);
  assert.match(r, /avvisi\.push\(inRaccolta\(email, rl\)\)/);
  assert.match(r, /i === 0 && aRaccolta\(f\.ruolo\) \? \{ avviso_esito: ESITO_RACCOLTA \}/);
});

test('la catena: anche la firma seguente a raccolta non avvisa', () => {
  assert.match(fn, /select\('id, firmatario_email, firmatario_ruolo'\)/);
  assert.match(fn, /avviso: raccolta \? inRaccolta\(a, String\(next\.firmatario_ruolo\)\) : await avvisaFirmatario/);
});

test('avvisa: senza indirizzo esclude i ruoli a raccolta, con indirizzo solo quello', () => {
  const i = fn.indexOf("if (azione === 'avvisa')");
  const a = fn.slice(i, i + 1400);
  assert.match(a, /solo \? String\(x\.firmatario_email\)\.toLowerCase\(\) === solo : !aRaccolta\(x\.firmatario_ruolo\)/);
});

test('la configurazione: chiave assente = Presidente, vuota = nessuno', () => {
  assert.match(fn, /'firme_avviso_raccolto_ruoli',/);
  assert.match(fn, /conf\.firme_avviso_raccolto_ruoli \?\? 'presidente'/);
  assert.match(firme, /cfg \? cfg\.valore \?\? '' : 'presidente'/);
});

test('il riepilogo segna i documenti nuovi solo se ce ne sono anche di già segnalati', () => {
  assert.match(fn, /const segnaNuovi = righe\.some\(nuovo\) && righe\.some\(\(x\) => !nuovo\(x\)\)/);
  assert.match(fn, /\$\{segnaNuovi && nuovo\(x\) \? ' \[nuovo\]' : ''\}/);
});

test('il cruscotto ha il pulsante del riepilogo, e il richiamo generico non tocca il Presidente', () => {
  assert.match(firme, /data-fp-riepilogo="\$\{esc\(g\.email\)\}"/);
  assert.match(firme, /azione: 'avvisa', email: b\.dataset\.fpRiepilogo/);
  assert.match(firme, /Ricorda agli altri firmatari/);
  const aiuto = leggi('../js/aiuto.js');
  assert.ok(aiuto.includes("'p:avvisa il presidente':"));
  assert.ok(aiuto.includes("'p:ricorda agli altri firmatari':"));
});

test('esitoAvvisi: a raccolta è un esito buono, non un errore', () => {
  const [t, tipo] = esitoAvvisi({ avviso: { inviata: false, raccolto: true, a: 'p@e.it', ruolo: 'presidente' }, avvisi: [{ inviata: false, raccolto: true, a: 'p@e.it', ruolo: 'presidente' }] }, 'Lettera Prot_26-27_0099');
  assert.equal(tipo, 'ok');
  assert.match(t, /spazio firme del Presidente/);
  assert.match(t, /Avvisa/);
});

test('esitoAvvisi: mail partita, e mail non partita', () => {
  assert.deepEqual(esitoAvvisi({ avvisi: [{ inviata: true, a: 'doc@e.it' }] }, 'Scheda'), ['Scheda in firma: mail mandata a doc@e.it.', 'ok']);
  const [t, tipo] = esitoAvvisi({ avvisi: [{ inviata: false, a: 'doc@e.it', errore: 'Gmail giù' }] }, 'Verbale');
  assert.equal(tipo, 'err');
  assert.match(t, /Gmail giù/);
});

test('le due funzioni pubblicate restano identiche', () => {
  assert.equal(leggi('../supabase/functions/firma-presidente/index.ts'), fn);
});
