// Il registro delle firme generale (13/10/2026, lotto 1 del fascicolo corso digitale).
// Dati INVENTATI. Qui: la riduzione di una catena di firme a una riga sola
// (riassuntoCatena è pura) e i pezzi che devono stare dove devono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');

import { riassuntoCatena } from '../js/firme-regole.js';
const src = leggi('../js/firme.js');

const riga = (o) => ({ id: o.id, ordine: o.ordine || 1, stato: o.stato, firmatario_email: o.email || 'x@y.it', firmatario_ruolo: o.ruolo || 'docente',
  file_firmato: o.stato === 'firmata' ? `firmate/${o.id}.pdf` : null, firmata_il: o.stato === 'firmata' ? '2026-10-13T10:00:00Z' : null, usata_il: null, autografo_il: null });

test('una firma sola in attesa: resta in attesa, prossimo = il firmatario', () => {
  const r = riassuntoCatena([riga({ id: 1, stato: 'in_attesa', ruolo: 'presidente', email: 'p@e.it' })]);
  assert.equal(r.stato, 'in_attesa');
  assert.deepEqual(r.prossimo, { email: 'p@e.it', ruolo: 'presidente' });
  assert.equal(r.file_firmato, null);
  assert.equal(r.totale, 1);
});

test('catena docente → RPF: dopo la prima firma è ancora in attesa, dell\'RPF', () => {
  const r = riassuntoCatena([
    riga({ id: 2, ordine: 2, stato: 'in_attesa', ruolo: 'rpf', email: 'rpf@e.it' }),
    riga({ id: 1, ordine: 1, stato: 'firmata', ruolo: 'docente', email: 'doc@e.it' }),
  ]);
  assert.equal(r.stato, 'in_attesa');
  assert.equal(r.firmate, 1);
  assert.equal(r.totale, 2);
  assert.equal(r.prossimo.ruolo, 'rpf');
  assert.equal(r.file_firmato, null, 'il PDF firmato vale solo a catena completa');
});

test('catena completa: firmata, e il PDF è quello dell\'ultima firma', () => {
  const r = riassuntoCatena([
    riga({ id: 1, ordine: 1, stato: 'firmata', ruolo: 'docente' }),
    riga({ id: 2, ordine: 2, stato: 'firmata', ruolo: 'rpf' }),
  ]);
  assert.equal(r.stato, 'firmata');
  assert.equal(r.file_firmato, 'firmate/2.pdf');
  assert.equal(r.id, 2);
});

test('una rimandata ferma la catena: lo stato è rimandata anche se la seconda è in coda', () => {
  const r = riassuntoCatena([
    riga({ id: 1, ordine: 1, stato: 'rimandata', ruolo: 'docente' }),
    riga({ id: 2, ordine: 2, stato: 'in_coda', ruolo: 'rpf' }),
  ]);
  assert.equal(r.stato, 'rimandata');
});

test('la segreteria chiede le firme a firma-documenti, con i firmatari e il corso', () => {
  assert.match(src, /functions\.invoke\('firma-documenti', \{ body: \{ azione: 'richiedi', documenti \} \}\)/);
  assert.match(src, /firmatari/);
  assert.doesNotMatch(src, /'firma-presidente'/, 'il nome vecchio della funzione non si usa più');
  assert.match(src, /\.from\('s_firme'\)/);
  assert.doesNotMatch(src, /from\('s_firme_presidente'\)/);
});

test('la lettera di docenza dice chi firma (il Presidente, poi il docente per accettazione) e di quale corso è', () => {
  const corsi = leggi('../js/corsi.js');
  assert.match(corsi, /const firmatari = \[\{ ruolo: 'presidente', riquadro: esito\.riquadro \}\];/);
  /* (14/10/2026) il docente con un accesso alle app firma la lettera stessa, nel suo riquadro */
  assert.match(corsi, /if \(docenteInApp\) firmatari\.push\(\{ ruolo: 'docente', persona_id: k\.persona_id, riquadro: esito\.riquadroDocente \}\);/);
  assert.match(leggi('../js/corsi-doc.js'), /esito\.riquadroDocente = \{ pagina: /);
  assert.match(corsi, /tipo: 'incarico_docenza', rif: `docenza:\$\{k\.id\}`, protocollo_id: prot\.id, corso_id: c\.id,/);
  assert.match(corsi, /from '\.\/firme\.js'/);
});

test('il nome vecchio del modulo resta un rimando', () => {
  assert.match(leggi('../js/firme-presidente.js'), /export \* from '\.\/firme\.js';/);
});

test('la funzione firma-documenti: catena, ruoli, firmatario', () => {
  const fn = leggi('../supabase/functions/firma-documenti/index.ts');
  assert.match(fn, /stato: i === 0 \? 'in_attesa' : 'in_coda'/, 'la prima firma è in attesa, le altre in coda');
  assert.match(fn, /\.eq\('ordine', Number\(r\.ordine\) \+ 1\)\.eq\('stato', 'in_coda'\)/, 'firmata la N, si promuove la N+1');
  assert.match(fn, /if \(String\(r\.firmatario_email\)\.toLowerCase\(\) !== io\) return json\(\{ error: 'Questo documento non aspetta la tua firma\.' \}, 403\)/, 'firma solo il firmatario della riga');
  assert.match(fn, /await ruolo\('is_docente_del_corso', \{ p_corso: r\.corso_id \}\)/, 'il docente firma solo i documenti dei suoi corsi');
  /* (23/10/2026) senza la firma scansionata NON si firma: il solo testo non basta più */
  assert.match(fn, /if \(fr\.stato !== 'ok' \|\| !fr\.byte\) return json\(\{ error: messaggioFirma\(fr, String\(r\.firmatario_ruolo\)\) \}, 409\)/, 'senza immagine la firma è rifiutata');
  assert.doesNotMatch(fn, /senza immagine il testo sta nel riquadro/, 'il ramo «solo testo» non esiste più');
  assert.match(fn, /const fd = await immagineFirma\(sb, conf, 'docente', io\)\n\s+if \(fd\.stato !== 'ok'\) return json/, 'accettazione e registro si fermano prima di creare PDF e riga');
  assert.match(fn, /if \(azione === 'ho_firma'\)/, 'la schermata può chiedere se la firma c\'è');
  assert.match(fn, /stato: 'illeggibile'/, 'un errore di lettura non è un\'assenza: messaggio diverso');
  assert.match(fn, /const TIPI = \['incarico_assev', 'incarico_docenza', 'accettazione_incarico', 'scheda_formativa'/);
  assert.equal(fn, leggi('../supabase/functions/firma-presidente/index.ts'), 'firma-presidente (nome vecchio, usato dall\'asseverazione) ha lo stesso codice');
});
