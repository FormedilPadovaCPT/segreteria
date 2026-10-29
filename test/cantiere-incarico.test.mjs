// node test/cantiere-incarico.test.mjs
// (29/10/2026, deciso dall'utente) La segreteria sceglie nella pratica il cantiere dell'incarico dall'anagrafica:
// un lotto solo oppure tutti i lotti del complesso. Senza cantiere l'incarico di una richiesta di visita non nasce.
import assert from 'node:assert';
import fs from 'node:fs';
import { comuneAnagrafica, testoRicerca, separaCivico, etichettaCantiere, sceltaDaSalvare } from '../js/cantiere-incarico-regole.js';

/* il comune del modulo come lo vuole l'anagrafica */
assert.strictEqual(comuneAnagrafica('PADOVA - Q3 EST (Brenta - Venezia, Forcellini - Camin)'), 'PADOVA');
assert.strictEqual(comuneAnagrafica('PADOVA - Q1 (Centro storico)'), 'PADOVA');
assert.strictEqual(comuneAnagrafica('Abano Terme'), 'ABANO TERME');
assert.strictEqual(comuneAnagrafica('SAN MARTINO DI LUPARI'), 'SAN MARTINO DI LUPARI');
assert.strictEqual(comuneAnagrafica(null), '');

/* il testo cercato non rompe il filtro .or() */
assert.strictEqual(testoRicerca('via Boccaccio, 4 (lotto 2)'), 'via Boccaccio 4 lotto 2');
assert.strictEqual(testoRicerca('a'), '');

/* indirizzo e civico dal campo unico del modulo */
assert.deepStrictEqual(separaCivico('VIA GIOVANNI BOCCACCIO SNC'), { indirizzo: 'VIA GIOVANNI BOCCACCIO', civico: 'SNC' });
assert.deepStrictEqual(separaCivico('via Marghera 4/6'), { indirizzo: 'VIA MARGHERA', civico: '4/6' });
assert.deepStrictEqual(separaCivico('Via Matteotti'), { indirizzo: 'VIA MATTEOTTI', civico: 'SNC' });
assert.deepStrictEqual(separaCivico('Via Dei Colli, 152'), { indirizzo: 'VIA DEI COLLI', civico: '152' });

/* l'etichetta non ripete il lotto se c'è già */
assert.strictEqual(etichettaCantiere({ cantiere_indirizzo: 'VIA ROMA', cantiere_civico: '1', lotto: '2', comune_nome: 'PADOVA' }), 'VIA ROMA 1 – lotto 2 · PADOVA');
assert.strictEqual(etichettaCantiere({ cantiere_etichetta: 'Tram SIR3 – lotto 2', lotto: '2' }), 'Tram SIR3 – lotto 2');

/* che cosa si salva */
const lotti = [{ cantiere_id: 'R' }, { cantiere_id: 'L2' }, { cantiere_id: 'L3' }];
assert.deepStrictEqual(sceltaDaSalvare({ cercato: 'L2', lotti, scelta: 'L3' }), { cantiere_id: 'L3', tutti_i_lotti: false });
assert.deepStrictEqual(sceltaDaSalvare({ cercato: 'L2', lotti, scelta: 'tutti' }), { cantiere_id: 'L2', tutti_i_lotti: true });
assert.deepStrictEqual(sceltaDaSalvare({ cercato: 'X', lotti: [], scelta: 'X' }), { cantiere_id: 'X', tutti_i_lotti: false });
assert.deepStrictEqual(sceltaDaSalvare({ cercato: 'X', lotti: [{ cantiere_id: 'X' }], scelta: 'tutti' }), { cantiere_id: 'X', tutti_i_lotti: false }, 'senza lotti «tutti» non ha senso');
assert.strictEqual(sceltaDaSalvare({ cercato: null, lotti, scelta: 'tutti' }), null);
assert.strictEqual(sceltaDaSalvare({ cercato: 'L2', lotti, scelta: 'ALTRO' }), null, 'un lotto che non è del complesso non si salva');

/* l'incarico della richiesta di visita non nasce senza cantiere, e porta i lotti */
const inc = fs.readFileSync(new URL('../js/incarico-tecnico.js', import.meta.url), 'utf8');
assert.ok(/if \(serveCantiere && !\(cantiereId \|\| pratica\.cantiere_id\)\) \{/.test(inc), 'senza cantiere non si crea');
assert.ok(/tutti_i_lotti: !!\(tuttiLotti \?\? pratica\.tutti_i_lotti\),/.test(inc), 'l\'incarico porta «tutti i lotti»');
const vis = fs.readFileSync(new URL('../js/visite.js', import.meta.url), 'utf8');
assert.ok(/cantiereId: p\.cantiere_id \|\| null, tuttiLotti: !!p\.tutti_i_lotti, serveCantiere: true,/.test(vis), 'la richiesta passa il suo cantiere');
assert.ok(/visitePreviste: null,/.test(vis), 'le visite previste le mette il database, non il numero dei cantieri');
assert.ok(/collegaCantiereIncarico\(p, \{/.test(vis), 'il riquadro è nella scheda della pratica');
const ui = fs.readFileSync(new URL('../js/cantiere-incarico.js', import.meta.url), 'utf8');
assert.ok(/sb\.rpc\('lotti_del_cantiere'/.test(ui), 'il complesso è quello del gestionale');
assert.ok(/from\('incarichi'\)\.update\(v\)\.eq\('id', p\.incarico_id\)/.test(ui), 'l\'incarico già creato prende lo stesso cantiere');
assert.ok(/se c'è già, a maiuscole e spazi ignorati/.test(ui), 'prima di creare una scheda si cercano i doppioni');

console.log('cantiere-incarico: ok');
