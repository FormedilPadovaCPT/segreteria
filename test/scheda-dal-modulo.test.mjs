// node test/scheda-dal-modulo.test.mjs
// (06/11/2026, deciso dall'utente) La scheda del cantiere nasce dai dati che l'impresa scrive nel modulo del portale,
// dopo che la segreteria li ha visti. Dati INVENTATI.
import assert from 'node:assert';
import fs from 'node:fs';
import { schedaDaModulo, committenteDaModulo, metri } from '../js/cantiere-incarico-regole.js';
import { cantiereDaModulo } from '../supabase/functions/portale-richieste/cantiere-visita.js';

/* dal modulo alla pratica (ricezione) alla scheda (segreteria): la catena intera */
const pratica = cantiereDaModulo({
  indirizzo_cantiere: 'Via Appia Monterosso', comune_cantiere: 'ABANO TERME', cant_lat: '45.3601', cant_lng: '11.7909',
  cant_descrizione: 'Spogliatoi palestra', cant_tip_int: '4', cant_tip_ope: '8', cant_data_inizio: '2026-10-15',
  cant_data_fine: '2027-03-31', cant_importo: '3', cant_cnce: 'c901', comm_natura: 'pubblico', comm_tipo: 'giuridica',
  comm_ragione_sociale: 'Comune di Abano Terme', comm_cf: '80008890281', comm_contatto: 'lavori@comune.example',
}, null);
const f = schedaDaModulo(pratica);
assert.strictEqual(f.cantiere_tip_int, 4); assert.strictEqual(f.cantiere_tip_ope, 8); assert.strictEqual(f.cantiere_importo, 3);
assert.strictEqual(f.data_inizio_lavori, '2026-10-15'); assert.strictEqual(f.data_ult, '2027-03-31', 'la fine va in data_ult: la durata la calcola il database');
assert.strictEqual(f.cantiere_cnce, 'C901'); assert.strictEqual(f.cantiere_descrizione, 'Spogliatoi palestra');
assert.strictEqual(f.lat, 45.3601); assert.strictEqual(f.geocode_status, 'manuale', 'il punto segnato a mano non si ricalcola');
assert.ok(!('cantiere_durata' in f) && !('cantiere_tip_ope_altro' in f));
/* scheda di prima (solo indirizzo e comune): niente da aggiungere */
assert.deepStrictEqual(schedaDaModulo({ indirizzo: 'VIA X', comune: 'PADOVA' }), {});
assert.deepStrictEqual(schedaDaModulo({ tip_int: 5, importo: 11, lat: 0, lng: 0 }), {}, 'valori fuori elenco e punto nel mare: niente');

/* il committente */
const c = committenteDaModulo(pratica.committente);
assert.strictEqual(c.chiave, '80008890281');
assert.strictEqual(c.riga.committente_nome, 'COMUNE DI ABANO TERME');
assert.strictEqual(c.riga.committente_tipo, 1, '1 = pubblico come nel gestionale');
assert.strictEqual(c.riga.tipo_sogg, 'PG'); assert.strictEqual(c.riga.piva, '80008890281');
assert.strictEqual(c.riga.email, 'lavori@comune.example'); assert.strictEqual(c.riga.telefono, null);
const pf = committenteDaModulo({ natura: 'privato', tipo: 'fisica', nome: 'Mario', cognome: 'Rossi', contatto: '333 1234567' });
assert.strictEqual(pf.chiave, null, 'senza CF non si crea: lo completa il tecnico');
assert.strictEqual(pf.riga.committente_nome, 'MARIO ROSSI'); assert.strictEqual(pf.riga.committente_tipo, 2); assert.strictEqual(pf.riga.telefono, '333 1234567');
assert.strictEqual(committenteDaModulo(null), null);

/* i cantieri vicini al segnaposto */
assert.strictEqual(metri({ lat: 45.4064, lng: 11.8768 }, { lat: 45.4064, lng: 11.8768 }), 0);
const m = metri({ lat: 45.4064, lng: 11.8768 }, { lat: 45.4073, lng: 11.8768 });
assert.ok(m >= 99 && m <= 101, '0,0009 gradi di latitudine sono circa 100 m: ' + m);

/* il riquadro: i dati del modulo si vedono e si possono escludere prima di salvare */
const js = fs.readFileSync(new URL('../js/cantiere-incarico.js', import.meta.url), 'utf8');
assert.ok(/id="ci-n-modulo" checked/.test(js), 'casella «Usa i dati del modulo», spuntata');
assert.ok(/usaModulo \? schedaDaModulo\(modulo\) : \{\}/.test(js), 'senza la spunta la scheda nasce come prima');
assert.ok(/stesso CNCE del modulo/.test(js) && /dal punto del modulo/.test(js), 'doppioni cercati per CNCE e per vicinanza');
const ip = fs.readFileSync(new URL('../js/imprese-previste.js', import.meta.url), 'utf8');
assert.ok(/or\('impresa_email_ref\.is\.null,impresa_email_ref\.eq\.'\)/.test(ip), 'l\'e-mail entra in anagrafica solo se il campo è vuoto');
console.log('scheda-dal-modulo: tutto ok');
