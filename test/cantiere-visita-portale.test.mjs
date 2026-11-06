// node test/cantiere-visita-portale.test.mjs
// (06/11/2026, deciso dall'utente) La richiesta di visita del portale porta il cantiere completo: posizione,
// intervento, opera, date, importo, CNCE, committente e altre imprese. Dati INVENTATI.
import assert from 'node:assert';
import { cantiereDaModulo, committenteDaModulo, VOCI_CANTIERE } from '../supabase/functions/portale-richieste/cantiere-visita.js';

const d = {
  indirizzo_cantiere: 'Via Appia Monterosso', civico_cantiere: '', comune_cantiere: 'ABANO TERME',
  cant_lat: '45.360123456', cant_lng: '11.790987654', cant_descrizione: 'Ampliamento scuola, spogliatoi palestra',
  cant_tip_int: '4', cant_tip_ope: '8', cant_data_inizio: '2026-10-15', cant_data_fine: '2027-03-31', cant_importo: '3',
  cant_cnce: ' c9013755684 ', comm_natura: 'pubblico', comm_tipo: 'giuridica', comm_ragione_sociale: 'Comune di Abano Terme',
  comm_nome: 'da ignorare', comm_cf: '80008890281', comm_contatto: '049 0000000',
};
const c = cantiereDaModulo(d, [{ ragione_sociale: 'ALFA SRL', piva: '01234567890', ruolo: 'Impresa subappaltatrice' }]);
assert.strictEqual(c.indirizzo, 'Via Appia Monterosso');
assert.ok(!('civico' in c), 'civico vuoto: la chiave non c\'è');
assert.strictEqual(c.lat, 45.360123); assert.strictEqual(c.lng, 11.790988, 'sei decimali');
assert.strictEqual(c.tip_int, 4); assert.strictEqual(c.tip_ope, 8); assert.strictEqual(c.importo, 3);
assert.ok(!('tip_ope_altro' in c), 'senza «Altro» la descrizione dell\'opera non si tiene');
assert.strictEqual(c.cnce, 'C9013755684');
assert.strictEqual(c.data_inizio, '2026-10-15'); assert.strictEqual(c.data_fine, '2027-03-31');
assert.deepStrictEqual(c.committente, { natura: 'pubblico', tipo: 'giuridica', nome: null, cognome: null,
  ragione_sociale: 'Comune di Abano Terme', cf: '80008890281', contatto: '049 0000000' }, 'società: nome e cognome non si tengono');
assert.strictEqual(c.imprese.length, 1);

/* valori storti: vuoti, non errori */
const s = cantiereDaModulo({ indirizzo_cantiere: 'Via X', comune_cantiere: 'PADOVA', cant_tip_int: '5', cant_tip_ope: '17',
  cant_importo: '11', cant_lat: '0', cant_lng: '0', cant_data_inizio: '2026-02-30', cant_data_fine: 'domani' }, null);
assert.deepStrictEqual(Object.keys(s).sort(), ['comune', 'indirizzo'], '«Altro» intervento, opera 17, importo «non disponibile», punto nel mare, date impossibili: tutto vuoto');
assert.ok(!('lat' in cantiereDaModulo({ comune_cantiere: 'X', cant_lat: '', cant_lng: '' })), 'senza punto niente coordinate');
/* fine prima dell'inizio */
assert.ok(!('data_fine' in cantiereDaModulo({ comune_cantiere: 'X', cant_data_inizio: '2026-05-01', cant_data_fine: '2026-04-01' })));
/* opera Altro tiene la descrizione */
assert.strictEqual(cantiereDaModulo({ comune_cantiere: 'X', cant_tip_ope: '16', cant_tip_ope_altro: 'parcheggio' }).tip_ope_altro, 'parcheggio');
/* senza indirizzo né comune non c'è cantiere */
assert.strictEqual(cantiereDaModulo({ cant_tip_int: '1' }), null);
/* committente persona */
const p = committenteDaModulo({ comm_natura: 'privato', comm_tipo: 'fisica', comm_nome: 'Mario', comm_cognome: 'Rossi', comm_ragione_sociale: 'x', comm_cf: 'rssmra80a01g224x' });
assert.strictEqual(p.ragione_sociale, null); assert.strictEqual(p.cf, 'RSSMRA80A01G224X');
assert.strictEqual(committenteDaModulo({ comm_natura: 'boh' }), null, 'valori fuori elenco: nessun committente');
/* le voci leggibili sono quelle del gestionale */
assert.strictEqual(VOCI_CANTIERE.cant_tip_ope[16], 'Altro'); assert.strictEqual(VOCI_CANTIERE.cant_importo[10], 'oltre 15.000.000 €');
console.log('cantiere-visita-portale: tutto ok');
