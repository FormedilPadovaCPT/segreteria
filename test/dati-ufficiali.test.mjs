// Dati ufficiali nella scheda impresa della segreteria (06/10/2026): lo stesso controllo del gestionale
// (InfoCamere + VIES), ma pensato per recuperare i dati MANCANTI senza sovrascrivere quelli già curati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { richiesta, proposte, tabella, intestazione } from '../js/dati-ufficiali.js';

const resp = {
  infocamere: { esito: 'ok', dati: {
    ragione_sociale: 'EDIL TOGNETTO S.R.L.', cf: '02524300239', stato: 'ATTIVA', nace: '41.20', data_registrazione: '2001-01-01',
    forma_giuridica: "SOCIETA' A RESPONSABILITA' LIMITATA", forma_app: 'S.r.l.',
    indirizzo: 'VIA POLESINE, 189/2', cap: '37043', comune: 'CASTAGNARO', prov: 'VR' } },
  vies: { esito: 'ok', chiave: '02524300239', dati: { ragione_sociale: 'EDIL TOGNETTO SRL', indirizzo: 'VIA POLESINE 189/2' } },
};

test('che cosa si chiede: la P.IVA da dove c’è, il codice fiscale dal titolare o dalla chiave', () => {
  assert.deepEqual(richiesta({ piva: 'IT 02524300239', cf: '', chiave: '02524300239' }), { piva: '02524300239', cf: '02524300239' });
  assert.deepEqual(richiesta({ piva: '', cf: 'RSSMRA80A01G224K', chiave: '01234567890' }), { piva: '01234567890', cf: 'RSSMRA80A01G224K' });
  assert.deepEqual(richiesta({ piva: '', cf: '', chiave: 'RSSMRA80A01G224K' }), { piva: '', cf: 'RSSMRA80A01G224K' });
  assert.equal(richiesta({ piva: 'abc', cf: '', chiave: '1907' }), null, 'niente di interrogabile: non si chiede');
});

test('si spunta da solo solo ciò che manca; ciò che è diverso si vede ma non si sostituisce da solo', () => {
  const r = proposte(resp, { impresa_id: '02524300239', impresa_nome: 'Tognetto costruzioni', piva: '02524300239', impresa_cf: '',
    indirizzo: 'via Polesine 189 int 2', comune: 'Castagnaro', cap: '', prov: '', tipo_impresa: '' });
  const di = (c) => r.find((x) => x.campo === c);
  assert.equal(di('impresa_nome').stato, 'diverso', 'un nome diverso non si sostituisce da solo');
  assert.equal(proposte(resp, { impresa_nome: 'Edil Tognetto srl' }).find((x) => x.campo === 'impresa_nome').stato, 'uguale', 'S.R.L. e srl: punteggiatura e maiuscole non contano');
  assert.equal(di('piva').stato, 'uguale');
  assert.equal(di('impresa_cf').stato, 'mancante');
  assert.equal(di('indirizzo').stato, 'diverso');
  assert.equal(di('comune').stato, 'uguale', 'maiuscole a parte, è lo stesso');
  assert.equal(di('cap').stato, 'mancante');
  assert.equal(di('prov').stato, 'mancante');
  assert.equal(di('tipo_impresa').stato, 'mancante');
  assert.ok(!r.some((x) => x.campo === 'impresa_id'), 'la chiave coincide: nessuna riga');
  const html = tabella(r);
  const spuntate = (html.match(/data-du-riga="\d+" checked/g) || []).length;
  assert.equal(spuntate, r.filter((x) => x.stato === 'mancante').length, 'spuntate solo le righe mancanti');
  assert.ok((html.match(/data-du-riga="\d+" title="Nella scheda c'è un altro valore/g) || []).length === 2, 'le due righe diverse hanno la casella vuota');
});

test('la chiave non si cambia da qui: si rimanda a «Cambia la chiave»', () => {
  const r = proposte(resp, { impresa_id: '02524000239', piva: '', impresa_cf: '' });
  const k = r.find((x) => x.campo === 'impresa_id');
  assert.ok(k && k.stato === 'bloccato' && /Cambia la chiave/.test(k.nota));
  assert.ok(!/data-du-riga="\d+"[^>]*>\s*<\/td>\s*<td>Codice fiscale \(chiave\)/.test(tabella(r)), 'la riga della chiave non ha casella');
});

test('solo VIES (ditta individuale, o InfoCamere spento): nome e indirizzo, niente forma né CF', () => {
  const r = proposte({ infocamere: { esito: 'non_trovata' }, vies: resp.vies }, { impresa_id: 'RSSMRA80A01G224K', impresa_nome: '' });
  assert.deepEqual(r.map((x) => x.campo).sort(), ['impresa_nome', 'indirizzo', 'piva']);
  assert.equal(r.find((x) => x.campo === 'impresa_nome').fonte, 'VIES');
});

test('un’impresa cessata nel Registro si dice in testa, con che cosa fare', () => {
  const h = intestazione({ infocamere: { esito: 'ok', dati: { stato: 'CESSATA' } }, vies: { esito: 'non_valida', chiave: '01234567890' } });
  assert.ok(/risulta <b>CESSATA<\/b>/.test(h) && /Cessata il \(Registro Imprese\)/.test(h));
  assert.ok(/non risulta attiva/.test(h));
  const n = intestazione(resp);
  assert.ok(/data-du-ateco="41\.20"/.test(n), 'il codice NACE si può portare nella ricerca ATECO');
});

test('i dati arrivano da fuori: si scrivono sempre con esc', () => {
  const r = proposte({ infocamere: { esito: 'ok', dati: { ragione_sociale: '<img src=x onerror=alert(1)>' } } }, {});
  assert.ok(!/<img/.test(tabella(r)));
});

test('la scheda impresa monta il riquadro e lo aggancia: propone, non salva', () => {
  const imp = readFileSync(new URL('../js/imprese.js', import.meta.url), 'utf8');
  const du = readFileSync(new URL('../js/dati-ufficiali.js', import.meta.url), 'utf8');
  assert.ok(/import \{ pannelloHtml as pannelloDatiUfficiali, aggancia as agganciaDatiUfficiali \} from '\.\/dati-ufficiali\.js'/.test(imp));
  assert.ok(/\$\{pannelloDatiUfficiali\(\)\}/.test(imp) && /agganciaDatiUfficiali\(\{/.test(imp));
  assert.ok(du.includes("functions.invoke('dati-impresa-ufficiali'"), 'la stessa funzione del gestionale');
  assert.ok(!/s_aggiorna_impresa|\.from\('imprese'\)/.test(du), 'il riquadro non scrive nel database: si salva con «Salva le modifiche»');
  assert.ok(/Non sono riuscito a leggere i dati ufficiali/.test(du), 'una lettura fallita si dice');
  assert.ok(!/^import /m.test(du), 'modulo senza import: deve girare anche in Node');
});
