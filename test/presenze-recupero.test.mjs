// Recupero: da quali ore si scala e saldo della banca ore sulla richiesta (19/10/2026).
//
// Dai rilievi del Direttore sulla richiesta n° 3 (recupero di 2 ore del 19/10/2026):
// «manca il riferimento a quando sono maturate le ore da scalare, oppure
// l'ammontare della banca ore». Il caso vero: in banca ore erano aperte le 2:00 di
// ore supplementari del 07/09/2026 (riga 1269) e il recupero del 19/10, già
// scritto a mano (riga 1283) prima del nulla osta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { righeDaRecuperare, proponiRighe, saldoPrimaDellaRichiesta, fotografiaBanca, bancaRichiesta,
  righeTestoBanca, chiusuraRecupero, notaRecupero } from '../js/presenze-doc.js';

const aperteVere = [
  { id: 1269, data: '2026-09-07', causale: 'Ore supplementari', ore_min: 120, pagato: false, chiuso: false,
    note: 'chiesto al direttore di proseguire fino alle 18.00 recupero appena possibile' },
  { id: 1283, data: '2026-10-19', causale: 'Recupero', ore_min: 120, pagato: false, chiuso: false, note: 'Recupero 2 ore dalle 14.00 alle 16.00' },
];
const richiesta3 = { id: 3, tipo: 'recupero', dipendente: 'Renato Squizzato', data_inizio: '2026-10-19', data_fine: '2026-10-19', ore: '2' };

test('caso vero: si propone la riga del 07/09 e il saldo prima è 2:00, non lo 0:00 del recupero già scritto', () => {
  const righe = righeDaRecuperare(aperteVere);
  assert.deepEqual(righe.map((e) => e.id), [1269], 'il recupero non è un\'ora da recuperare');
  assert.deepEqual(proponiRighe(righe, 120), [1269]);
  assert.equal(saldoPrimaDellaRichiesta(aperteVere, richiesta3), 120,
    'il recupero scritto a mano nel giorno della richiesta è questa richiesta: non si conta nel «prima»');
  const foto = fotografiaBanca(righe, [1269], saldoPrimaDellaRichiesta(aperteVere, richiesta3));
  const testo = righeTestoBanca(bancaRichiesta({ ...richiesta3, ...foto }));
  assert.match(testo[0], /prima di questa richiesta 2:00, dopo 0:00/);
  assert.match(testo[1], /07\/09\/2026: 2:00 \(riga 1269\)/);
  assert.equal(testo.length, 2, 'righe che coprono esattamente le ore: nessun avviso');
});

test('il recupero di un\'altra richiesta, anche nello stesso giorno, scala il saldo', () => {
  const aperte = [...aperteVere.slice(0, 1), { id: 9, data: '2026-10-19', causale: 'Recupero', ore_min: 60, chiuso: false, note: 'Richiesta n° 7 — recupera ID 1' }];
  assert.equal(saldoPrimaDellaRichiesta(aperte, richiesta3), 60);
  const sua = [...aperteVere.slice(0, 1), { id: 9, data: '2026-10-25', causale: 'Recupero', ore_min: 60, chiuso: false, note: 'Richiesta n° 3' }];
  assert.equal(saldoPrimaDellaRichiesta(sua, richiesta3), 120, 'la riga che nomina questa richiesta non si conta');
});

test('le pagate e le chiuse non sono ore da recuperare; si propongono prima le più vecchie', () => {
  const aperte = [
    { id: 3, data: '2026-05-02', causale: 'Ore supplementari', ore_min: 60, pagato: false, chiuso: false },
    { id: 1, data: '2026-03-01', causale: 'Ore supplementari', ore_min: 90, pagato: true, chiuso: false },
    { id: 2, data: '2026-04-01', causale: 'ore supplementari', ore_min: 60, pagato: false, chiuso: false },
    { id: 4, data: '2026-02-01', causale: 'Ore supplementari', ore_min: 60, pagato: false, chiuso: true },
  ];
  const righe = righeDaRecuperare(aperte);
  assert.deepEqual(righe.map((e) => e.id), [2, 3]);
  assert.deepEqual(proponiRighe(righe, 60), [2], 'basta la più vecchia');
  assert.deepEqual(proponiRighe(righe, 90), [2, 3]);
});

test('senza scelta lo si dice; nessuna riga = recupero anticipato; righe che non bastano = avviso', () => {
  assert.match(righeTestoBanca(bancaRichiesta(richiesta3))[0], /non dice da quali ore/);
  const anticipo = righeTestoBanca(bancaRichiesta({ ...richiesta3, banca_righe: [], banca_saldo_prima_min: 0 }));
  assert.match(anticipo.join('\n'), /dopo -2:00/);
  assert.match(anticipo.join('\n'), /Recupero anticipato/);
  const poche = righeTestoBanca(bancaRichiesta({ ...richiesta3, banca_righe: [{ id: 5, data: '2026-09-01', ore_min: 60 }], banca_saldo_prima_min: 60 }));
  assert.match(poche.join('\n'), /coprono 1:00 su 2:00/);
  assert.equal(bancaRichiesta({ ...richiesta3, tipo: 'ferie' }), null, 'le ferie non toccano la banca ore');
});

test('le partite si chiudono solo se le righe sono aperte e valgono esattamente il recupero', () => {
  assert.equal(chiusuraRecupero(120, [{ id: 1269, ore_min: 120, pagato: false, chiuso: false }]).chiudi, true);
  assert.equal(chiusuraRecupero(120, [{ id: 1269, ore_min: 180, pagato: false, chiuso: false }]).chiudi, false);
  assert.equal(chiusuraRecupero(120, [{ id: 1269, ore_min: 120, pagato: false, chiuso: true }]).chiudi, false,
    'una riga già chiusa nel frattempo non si richiude due volte');
  assert.equal(chiusuraRecupero(120, []).chiudi, false);
});

test('la nota del recupero dice da quali righe viene, come in Access', () => {
  assert.equal(notaRecupero({ id: 3, banca_righe: [{ id: 1269 }] }), 'Richiesta n° 3 — recupera ID 1269');
  assert.equal(notaRecupero({ id: 4, banca_righe: [{ id: 1246 }, { id: 1248 }] }), 'Richiesta n° 4 — recupera ID 1246+1248');
  assert.equal(notaRecupero({ id: 5, banca_righe: [] }), 'Richiesta n° 5');
});
