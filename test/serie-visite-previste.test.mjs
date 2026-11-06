// node --test test/serie-visite-previste.test.mjs
// (06/11/2026, deciso dall'utente) Una serie è di norma di 10 visite, ma la segreteria può proporne un numero
// diverso (per esempio 30) e il Direttore lo autorizza. Prima l'app passava sempre «nessun numero» all'incarico,
// e quindi valeva sempre il 10 del database. Ora il numero sta sulla pratica, esce sul foglio di autorizzazione,
// si blocca dopo l'approvazione e passa all'incarico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leggiVisitePreviste, visitePrevisteDi, visitePrevisteIncarico, VISITE_SERIE_BASE } from '../js/serie-visite.js';

const v = readFileSync(new URL('../js/visite.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const aiuto = readFileSync(new URL('../js/aiuto.js', import.meta.url), 'utf8');

test('il numero scritto nel campo', () => {
  assert.deepEqual(leggiVisitePreviste('30'), { valore: 30 });
  assert.deepEqual(leggiVisitePreviste(' 5 '), { valore: 5 });
  assert.deepEqual(leggiVisitePreviste(String(VISITE_SERIE_BASE)), { valore: null }, '10 è la base: resta vuoto');
  assert.deepEqual(leggiVisitePreviste(''), { valore: null });
  for (const x of ['0', '101', '2.5', 'dieci', '-3']) assert.ok(leggiVisitePreviste(x).errore, `«${x}» non si accetta`);
});

test('quante visite valgono e che cosa va all\'incarico', () => {
  assert.equal(visitePrevisteDi({}), 10);
  assert.equal(visitePrevisteDi({ visite_previste: 30 }), 30);
  assert.equal(visitePrevisteIncarico({ tipo_richiesta: 'serie', visite_previste: 30 }), 30);
  assert.equal(visitePrevisteIncarico({ tipo_richiesta: 'serie', visite_previste: null }), null, 'vuoto: decide il database (10)');
  assert.equal(visitePrevisteIncarico({ tipo_richiesta: 'visita', visite_previste: 30 }), null, 'una visita singola non prende il numero');
});

test('la pratica passa il numero all\'incarico', () => {
  assert.ok(!/visitePreviste: null,/.test(v), 'non più «nessun numero» fisso');
  assert.match(v, /visitePreviste: visitePrevisteIncarico\(p\)/);
});

test('il campo c\'è solo per le serie e si blocca dopo l\'approvazione', () => {
  assert.match(v, /p\.tipo_richiesta === 'serie' \? `<div class="field"><label>Visite della serie/);
  assert.match(v, /id="vs-previste"/);
  assert.match(v, /p\.incarico_id \|\| p\.aut_stato === 'approvata' \? 'disabled/);
});

test('il numero esce sul foglio al Direttore e si salva con la richiesta e col visto', () => {
  assert.match(v, /\['Visite della serie', `\$\{visitePrevisteDi\(p\)\}/);
  assert.match(v, /const q = visiteValide\(daMaschera\(p\)\);\n\s+const campi = campiVisita\(q\);/, 'richiesta di autorizzazione');
  assert.match(v, /const q = visiteValide\(daMaschera\(p\)\);\n\s+const \{ pdfAutorizzazioneCampi \}/, 'visto del Direttore');
  assert.match(v, /\.\.\.campiIncarico\(q, \$\('#vs-tecnico'\)/, 'l\'incarico nasce col numero del foglio');
  assert.equal((v.match(/\{ visite_previste: q\.visite_previste \}/g) || []).length, 2, 'si salva alla richiesta e al visto');
});

test('la nuvoletta del campo', () => {
  assert.match(aiuto, /'vs-previste':/);
});
