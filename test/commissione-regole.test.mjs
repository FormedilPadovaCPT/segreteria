// La pagina «Commissione Sicurezza» (09/11/2026): stato dell'accesso, azione da fare, testo del benvenuto.
// Dati INVENTATI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statoAccesso, azione, testoBenvenuto, CARICHE } from '../js/commissione-regole.js';
import { mailDaNote } from '../js/lookups.js';

const base = { nomina_id: 7, nominativo: 'Mario <b>Rossi</b>', carica: 'consigliere', email: 'mario.rossi@esempio.it' };

test('lo stato dell\'accesso si legge, non si deduce', () => {
  assert.equal(statoAccesso({ ...base, accesso: null }).testo, 'nessun accesso');
  assert.equal(statoAccesso({ ...base, accesso: { account: true, stato: 'revocato', stessa_persona: true } }).testo, 'accesso chiuso');
  assert.equal(statoAccesso({ ...base, accesso: { account: true, stato: 'attivo', stessa_persona: false, nome: 'Luigi Bianchi' } }).testo, 'accesso di Luigi Bianchi');
  assert.equal(statoAccesso({ ...base, accesso: { account: true, stato: 'attivo', stessa_persona: true, password_da_cambiare: true, ultimo_accesso: '2026-09-28T18:00:00Z' } }).testo, 'mai entrato',
    'chi non ha cambiato la password provvisoria non è entrato, anche se qualcuno ha provato l\'account');
  assert.equal(statoAccesso({ ...base, accesso: { account: true, stato: 'attivo', stessa_persona: true, password_cambiata: '2026-10-21T08:00:00Z' } }).testo, 'primo accesso il 21/10/2026');
});

test('un pulsante per ogni cosa da fare, con la spiegazione', () => {
  assert.match(azione({ ...base, da_fare: 'crea' }), /data-cm-crea="7"[^>]*data-aiuto=/);
  assert.match(azione({ ...base, da_fare: 'riapri' }), /Riapri l'accesso/);
  assert.match(azione({ ...base, da_fare: 'subentro' }), /data-cm-subentro="1"/);
  assert.match(azione({ ...base, da_fare: 'carica' }), /data-cm-carica="7"/);
  assert.match(azione({ ...base, da_fare: 'manca_cf' }), /codice fiscale/);
  assert.match(azione({ ...base, da_fare: 'ok', accesso: { password_da_cambiare: true } }), /data-cm-benvenuto="7"/, 'chi non è mai entrato: il benvenuto');
  assert.doesNotMatch(azione({ ...base, da_fare: 'ok', accesso: { password_da_cambiare: false } }), /<button/, 'chi è entrato: niente da fare');
});

test('il benvenuto è nelle note del protocollo OUT: intestazioni, saluto, corpo, niente firma, niente password', () => {
  const t = testoBenvenuto({ ...base, carica: 'vicepresidente' });
  assert.match(t, /^Da: cpt@formedilpadova\.it\nA: mario\.rossi@esempio\.it\nOggetto: /, 'la prima riga è «Da:»');
  const m = mailDaNote(t);
  assert.ok(m, 'l\'app la scompone come mail');
  assert.match(m.saluto, /^Gent\.le /);
  assert.match(m.testo, /in qualità di Vicepresidente della Commissione Sicurezza/);
  assert.match(m.testo, /Cordiali saluti$/, 'finisce con la chiusura: la firma la mette la mail');
  assert.match(m.testo, /codice fiscale, scritto tutto in maiuscolo/);
  assert.doesNotMatch(t, /[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/, 'il codice fiscale non si scrive');
  assert.match(t, /FORMEDIL PADOVA/);
  assert.doesNotMatch(t, /Scuola Edile CPT|CPT Padova/, 'l\'ente si chiama FORMEDIL PADOVA');
  assert.equal(CARICHE.consigliere, 'Consigliere');
});

test('la pagina è collegata e i testi del database passano da esc()', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../js/commissione.js', import.meta.url), 'utf8');
  assert.match(html, /data-view="commissione">🏛️ Commissione Sicurezza<\/button>/);
  assert.match(html, /<div id="commissione-host" class="condensa"><\/div>/);
  assert.match(app, /if \(vista === 'commissione'\)/);
  for (const c of ['m.nominativo', 'm.email || \'—\'','f.nome || f.email', 'f.email', 'e.email', 'e.dettaglio', 'e.message']) {
    assert.ok(js.includes('esc(' + c + ')'), c + ' passa da esc()');
  }
  assert.match(js, /sb\.functions\.invoke\('commissione-accesso'/, 'l\'account lo crea il server');
  assert.doesNotMatch(js, /auth\.admin|service_role|SERVICE_ROLE/, 'nel browser niente chiave d\'amministrazione');
});
