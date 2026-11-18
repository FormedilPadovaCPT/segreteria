// La scheda del corso a tutta pagina, a linguette (18/11/2026, proposta A scelta dall'utente).
// Dati INVENTATI. Funzioni pure di js/corsi-scheda.js più la forma del sorgente di corsi.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SCHEDE, OGNI_MS, contaFirme, impronta, firmeNuove, schedaIniziale, numeriScheda,
  htmlBarra, htmlLinguette, htmlAvviso, htmlScheda, eraAperta, ricordaScheda,
} from '../js/corsi-scheda.js';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const corsi = leggi('../js/corsi.js');
const scheda = leggi('../js/corsi-scheda.js');
const core = leggi('../js/core.js');
const pq = leggi('../js/corsi-presenze-qr.js');
const aiuto = leggi('../js/aiuto.js');
const css = leggi('../css/app.css');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FIRME = [
  { id: 1, stato: 'confermata', iscritto_id: 10, fuori_orario: false },
  { id: 2, stato: 'ricevuta', iscritto_id: 11, fuori_orario: false },
  { id: 3, stato: 'ricevuta', iscritto_id: 12, fuori_orario: true },
  { id: 4, stato: 'ricevuta', iscritto_id: null, fuori_orario: false },
  { id: 5, stato: 'respinta', iscritto_id: 13, fuori_orario: false },
];

test('i conteggi delle firme seguono la sezione «Firme dal QR»', () => {
  const n = contaFirme(FIRME);
  assert.deepEqual(n, { totale: 5, ricevute: 3, inOrario: 1, fuoriOrario: 1, ignote: 1, confermate: 1, respinte: 1, guardare: 3 });
  assert.equal(contaFirme(null).guardare, 0);
});

test('l\'impronta cambia con una firma nuova o con uno stato cambiato, non con l\'ordine', () => {
  const a = impronta(FIRME);
  assert.equal(impronta([...FIRME].reverse()), a);
  assert.notEqual(impronta([...FIRME, { id: 6, stato: 'ricevuta' }]), a);
  assert.notEqual(impronta(FIRME.map((f) => (f.id === 2 ? { ...f, stato: 'confermata' } : f))), a);
});

test('le firme nuove sono quelle che non c\'erano alla lettura prima', () => {
  assert.deepEqual(firmeNuove([1, 2, 3], FIRME).map((f) => f.id), [4, 5]);
  assert.deepEqual(firmeNuove([1, 2, 3, 4, 5], FIRME), []);
});

test('da quale linguetta si parte: firme se ce ne sono da guardare, altrimenti riepilogo; ricaricando si resta', () => {
  assert.equal(schedaIniziale({ ricordata: 'iscritti', apertura: true, guardare: 2 }), 'firme');
  assert.equal(schedaIniziale({ ricordata: 'iscritti', apertura: true, guardare: 0 }), 'riepilogo');
  assert.equal(schedaIniziale({ ricordata: 'iscritti', apertura: false, guardare: 5 }), 'iscritti');
  assert.equal(schedaIniziale({ ricordata: 'inventata', apertura: false, guardare: 0 }), 'riepilogo');
});

test('i numeri della barra: annullati e sostituiti fuori, questionario e test solo se ci sono', () => {
  const iscritti = [
    { id: 1, esito: 'iscritto', quest_compilato: true, attestato_numero: '1/2026' },
    { id: 2, esito: 'iscritto', quest_compilato: false },
    { id: 3, esito: 'annullato', quest_compilato: true, attestato_numero: '2/2026' },
  ];
  const n = numeriScheda({
    c: { pres_codice: 'P1-AAAA', quest_codice: 'Q', test_previsto: true },
    iscritti, firme: FIRME, coda: [{ stato: 'nuova' }, { stato: 'confermata' }],
    prove: [{ esito: 'superato' }, { esito: 'non_superato' }, { esito: 'annullata' }],
  });
  assert.equal(n.iscritti, 2);
  assert.equal(n.izDaGuardare, 1);
  assert.equal(n.quest, 1);
  assert.equal(n.test, 2);
  assert.equal(n.testSuperati, 1);
  assert.equal(n.attestati, 1);
  assert.equal(n.firme.guardare, 3);
  const spento = numeriScheda({ c: { rilascio_attestato: false }, iscritti, firme: [], coda: [], prove: [] });
  assert.equal(spento.quest, null);
  assert.equal(spento.test, null);
  assert.equal(spento.attestati, null);
  assert.equal(spento.presAperte, false);
});

test('la barra accende le firme da guardare e porta ogni numero alla sua linguetta', () => {
  const n = numeriScheda({ c: { pres_codice: 'P' }, iscritti: [{ id: 1 }], firme: FIRME, coda: [], prove: [] });
  const h = htmlBarra(n);
  assert.match(h, /id="cs-n-firme" data-cs-vai="firme"/);
  assert.match(h, /cs-acceso/);
  assert.match(h, /cs-pallino/);
  assert.match(h, /1 in orario · 1 fuori orario · 1 non riconosciuta/);
  for (const vai of ['iscritti', 'firme', 'quest', 'documenti']) assert.match(h, new RegExp(`data-cs-vai="${vai}"`));
  const calmo = htmlBarra(numeriScheda({ c: { pres_codice: 'P' }, iscritti: [], firme: [FIRME[0]], coda: [], prove: [] }));
  assert.doesNotMatch(calmo, /cs-acceso/);
  assert.match(calmo, /tutte guardate/);
  assert.match(htmlBarra(numeriScheda({ c: {}, iscritti: [], firme: [], coda: [], prove: [] })), /firme dal QR non aperte/);
});

test('le linguette: una sola attiva, il pallino sulle firme solo se ce ne sono da guardare', () => {
  const n = numeriScheda({ c: { pres_codice: 'P' }, iscritti: [], firme: FIRME, coda: [], prove: [] });
  const h = htmlLinguette('iscritti', n);
  assert.equal((h.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(h, /id="cs-l-iscritti"[^>]*aria-selected="true"/);
  assert.match(h, /Firme dal QR<span class="cs-pallino">/);
  assert.equal(SCHEDE.length, 7);
  assert.doesNotMatch(htmlLinguette('firme', { ...n, firme: contaFirme([]) }), /cs-pallino/);
});

test('l\'avviso della firma nuova scappa nomi e ore che vengono dal database', () => {
  const h = htmlAvviso([{ nominativo: 'Rossi <b>Mario</b>', tipo: 'entrata', ora: '14:31' }], esc);
  assert.match(h, /Firma nuova: Rossi &lt;b&gt;Mario&lt;\/b&gt;, entrata alle 14:31/);
  assert.match(htmlAvviso([{ nominativo: 'A' }, { nominativo: 'B', tipo: 'uscita', ora: '18:30' }], esc), /2 firme nuove: B, uscita alle 18:30/);
  assert.equal(htmlAvviso([], esc), '');
});

test('la scheda: tutte le parti nel documento, una sola visibile; ricaricando si resta sulla stessa', () => {
  const numeri = numeriScheda({ c: { pres_codice: 'P' }, iscritti: [], firme: FIRME, coda: [], prove: [] });
  const parti = Object.fromEntries(SCHEDE.map(([k]) => [k, `<p>${k}</p>`]));
  const h = htmlScheda({ corsoId: 332, apertura: true, numeri, parti });
  assert.equal((h.match(/data-cs-pann=/g) || []).length, 7);
  assert.equal((h.match(/class="cs-pann"/g) || []).length, 1, 'una sola parte visibile');
  assert.match(h, /class="cs-pann" data-cs-pann="firme"/, 'con firme da guardare si parte dalle firme');
  assert.ok(eraAperta(332, false));
  assert.ok(!eraAperta(332, true), 'a scheda chiusa è un\'apertura nuova');
  assert.ok(!eraAperta(331, false));
  ricordaScheda('iscritti');
  const h2 = htmlScheda({ corsoId: 332, apertura: false, numeri, parti });
  assert.match(h2, /class="cs-pann" data-cs-pann="iscritti"/);
});

test('apriCorso usa la scheda a linguette e ne divide le parti senza perderne', () => {
  assert.match(corsi, /htmlScheda\(\{ corsoId: c\.id, apertura, numeri, parti \}\)/);
  assert.match(corsi, /classList\.add\('drawer-pieno'\)/);
  assert.match(corsi, /collegaScheda\(\$\('#drawer-body'\)/);
  for (const k of SCHEDE.map(([x]) => x)) assert.match(corsi, new RegExp(`\\n    ${k}: \``), `parte ${k}`);
  /* ogni sezione di prima è ancora nella scheda, nella parte giusta */
  const parte = (k) => corsi.split(`\n    ${k}: \``)[1].split('\n`,')[0];
  assert.match(parte('riepilogo'), /id="co-addg"/);
  assert.match(parte('riepilogo'), /sezioneProm\(/);
  assert.match(parte('docenti'), /id="co-geninc"/);
  assert.match(parte('iscritti'), /id="co-addiscr"/);
  assert.match(parte('iscrizioni'), /sezioneIscr\(/);
  assert.match(parte('firme'), /sezionePres\(/);
  assert.match(parte('quest'), /sezioneQuest\(/);
  assert.match(parte('quest'), /sezioneTest\(/);
  assert.match(parte('documenti'), /sezioneMateriali\(/);
  assert.match(parte('documenti'), /id="co-registro"/);
  /* apriDrawer toglie la larghezza a tutta pagina alle schede che non la chiedono */
  assert.match(core, /classList\.remove\('drawer-xl', 'drawer-pieno'\)/);
  assert.match(css, /\.drawer\.drawer-pieno\{/);
});

test('la rilettura delle firme: ogni 30 secondi, solo lettura, e un errore si dice', () => {
  assert.equal(OGNI_MS, 30000);
  assert.match(scheda, /sb\.from\('s_corsi_firme_presenza'\)\s*\n?\s*\.select\(/);
  assert.doesNotMatch(scheda, /\.(update|insert|delete|upsert)\(/, 'la scheda non scrive niente');
  assert.match(scheda, /firme non rilette/);
  assert.match(scheda, /clearInterval\(memoria\.timer\)/);
  /* l'ascolto dei clic sta sulla scheda che rinasce, non su #drawer-body che resta */
  assert.match(scheda, /radice\?\.addEventListener\('click'/);
  assert.doesNotMatch(scheda, /body\.addEventListener\(/);
  /* le righe delle firme hanno il loro id, per evidenziare quelle nuove */
  assert.match(pq, /<tr data-pq-riga="\$\{f\.id\}"/);
});

test('le nuvolette di aiuto spiegano linguette, numeri e avviso', () => {
  for (const id of ['cs-n-iscritti', 'cs-n-firme', 'cs-n-conf', 'cs-n-quest', 'cs-n-test', 'cs-n-att',
    'cs-l-riepilogo', 'cs-l-docenti', 'cs-l-iscritti', 'cs-l-iscrizioni', 'cs-l-firme', 'cs-l-quest', 'cs-l-documenti',
    'cs-avviso-vai']) {
    assert.ok(aiuto.includes(`'${id}':`), `nuvoletta per ${id}`);
  }
});
