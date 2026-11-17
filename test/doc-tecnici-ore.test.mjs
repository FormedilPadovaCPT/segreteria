// Documenti dei tecnici: attestato di base + aggiornamenti a ore.
// Le soglie vengono dalla norma (formatore: D.I. 6/3/2013; coordinatore:
// art. 98 e all. XIV D.Lgs. 81/2008, interpello 19/2014), non dal codice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statoConOre, dettaglioOre, requisitoAOre, aggiungiMesiIso } from '../js/doc-tecnici-ore.js';

const FORMATORI = { id: 8, ore_soglia: 24, ore_soglia_corsi: 8, durata_mesi: 36, preavviso_giorni: 90, docenza_alternativa: true, recupero_ore: true };
const COORD = { id: 6, ore_soglia: 40, ore_soglia_corsi: null, durata_mesi: 60, preavviso_giorni: 90, docenza_alternativa: false, recupero_ore: false, periodo_mobile: true, decadenza_mesi: 120 };
const att = (data) => ({ tipo: 'attestato', data_inizio: data });
const agg = (data, ore, corsi) => ({ tipo: 'aggiornamento', data_inizio: data, ore, ore_di_corso: corsi });
const doc = (data, ore) => ({ tipo: 'docenza', data_inizio: data, ore });

test('un requisito senza soglia non è a ore', () => {
  assert.equal(requisitoAOre({ durata_mesi: 12 }), false);
  assert.equal(requisitoAOre(FORMATORI), true);
});

test('righe senza tipo: si usa la logica di sempre', () => {
  assert.equal(statoConOre(FORMATORI, [{ data_inizio: '2026-10-27', data_fine: '2029-10-27' }], '2026-11-17'), null);
});

test('Simonetto: attestato del 2016 e nessun aggiornamento → scaduto dal 17/01/2019', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17')], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2019-01-17');
  assert.equal(s.manca, 24);
});

test('24 ore con 8 in corsi nel triennio: quel periodo è a posto, poi serve il successivo', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17'), agg('2017-05-10', 16, 8), agg('2018-11-02', 8, 0)], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2022-01-17'); // il secondo triennio (2019-2022) è vuoto
});

test('catena di tre trienni coperti: valido fino alla fine del periodo aperto', () => {
  const righe = [att('2016-01-17'),
    agg('2017-02-01', 24, 8), agg('2020-02-01', 24, 8), agg('2023-02-01', 24, 8)];
  const s = statoConOre(FORMATORI, righe, '2026-11-17');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2028-01-17');
  assert.equal(s.periodo.inizio, '2025-01-17');
});

test('24 ore ma solo 4 in corsi: non basta, servono almeno 8 in corsi', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17'), agg('2017-02-01', 24, 4)], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2019-01-17');
});

test('più registrazioni si sommano: 4 + 8 + 12 = 24', () => {
  const s = statoConOre(FORMATORI, [att('2024-03-01'), agg('2024-06-01', 4, 4), agg('2025-02-01', 8, 4), agg('2026-03-01', 12, 0)], '2026-11-17');
  assert.equal(s.ore, 24);
  assert.equal(s.corsi, 8);
  assert.equal(s.classe, 'ok');
});

test('periodo aperto ma ore mancanti: valido, poi «in scadenza» nel preavviso', () => {
  const righe = [att('2024-03-01'), agg('2025-02-01', 10, 8)];
  assert.equal(statoConOre(FORMATORI, righe, '2026-11-17').classe, 'ok'); // fine 01/03/2027, 104 giorni
  const s = statoConOre(FORMATORI, righe, '2027-01-10');
  assert.equal(s.classe, 'scade');
  assert.equal(s.manca, 14);
});

test('la docenza vale in alternativa: 24 ore di docenza bastano', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17'), doc('2017-03-01', 24)], '2026-11-17');
  assert.equal(s.scadenza, '2022-01-17'); // primo triennio coperto dalla docenza, secondo vuoto
  const s2 = statoConOre(FORMATORI, [att('2024-03-01'), doc('2025-03-01', 24)], '2026-11-17');
  assert.equal(s2.classe, 'ok');
});

test('la docenza non conta dove la norma non la ammette', () => {
  const s = statoConOre(COORD, [att('2021-01-01'), doc('2022-01-01', 40)], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
});

test('le ore fatte prima dell\'attestato di base non contano', () => {
  const s = statoConOre(FORMATORI, [att('2024-03-01'), agg('2023-12-01', 24, 8)], '2026-11-17');
  assert.equal(s.ore, 0);
});

test('l\'ultimo attestato di base riparte da capo', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17'), att('2026-10-27')], '2026-11-17');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2029-10-27');
});

// Coordinatore: quinquennio mobile (Accordo 59/CSR 2025, Parte III; FAQ Ministero
// 27/03/2026 n. 8; FAQ Regione Veneto «CSE e CSP»), decadenza dopo 10 anni.
test('coordinatore: nei primi cinque anni dall\'abilitazione non servono ore', () => {
  const s = statoConOre(COORD, [att('2023-01-01')], '2026-11-17');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2028-01-01');
});

test('coordinatore: quinquennio mobile, le ore escono una per una', () => {
  const righe = [att('2015-01-01'), agg('2019-06-01', 16), agg('2022-03-01', 24)];
  const s = statoConOre(COORD, righe, '2026-11-17');
  // oggi negli ultimi cinque anni ci sono solo 24 ore: era valido fino al 01/06/2024,
  // quando le 16 ore del 2019 sono uscite dalla finestra
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2024-06-01');
  assert.equal(s.ore, 24);
  assert.equal(s.manca, 16);
});

test('coordinatore: valido oggi, e si sa già fino a quando senza altre ore', () => {
  const righe = [att('2015-01-01'), agg('2022-03-01', 24), agg('2025-05-01', 16)];
  const s = statoConOre(COORD, righe, '2026-11-17');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2027-03-01'); // poi le 24 ore del 2022 escono
  assert.equal(statoConOre(COORD, righe, '2027-01-10').classe, 'scade');
});

test('coordinatore: l\'aggiornamento fatto in ritardo rimette in regola', () => {
  const righe = [att('2015-01-01'), agg('2019-06-01', 16), agg('2022-03-01', 24), agg('2026-10-01', 16)];
  const s = statoConOre(COORD, righe, '2026-11-17');
  assert.equal(s.classe, 'ok');
  assert.equal(s.ore, 40);
});

test('coordinatore: dieci anni senza aggiornamenti → titolo decaduto, si rifà il corso', () => {
  const s = statoConOre(COORD, [att('2005-01-31'), agg('2016-03-01', 40)], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.decaduto, true);
  assert.equal(s.scadenza, '2015-01-31');
  assert.match(dettaglioOre(s), /titolo decaduto/);
  // un nuovo corso abilitante riparte da capo
  const n = statoConOre(COORD, [att('2005-01-31'), att('2024-05-01')], '2026-11-17');
  assert.equal(n.classe, 'ok');
  assert.equal(n.scadenza, '2029-05-01');
});

test('coordinatore: il conteggio parte dal corso da 120 ore se manca l\'attestato proprio', () => {
  const s = statoConOre(COORD, [agg('2022-01-10', 40)], '2026-11-17', [{ data_inizio: '2021-02-01' }]);
  assert.equal(s.scadenza, '2027-01-10');
  assert.equal(s.classe, 'scade'); // 54 giorni, dentro il preavviso
  const senza = statoConOre(COORD, [agg('2022-01-10', 40)], '2026-11-17', []);
  assert.equal(senza.classe, 'senzadata');
});

test('coordinatore: le ore con data futura non contano', () => {
  const s = statoConOre(COORD, [att('2015-01-01'), agg('2027-02-01', 40)], '2026-11-17');
  assert.equal(s.ore, 0);
});

test('coordinatore: la frase dice gli ultimi cinque anni', () => {
  const s = statoConOre(COORD, [att('2015-01-01'), agg('2022-03-01', 24)], '2026-11-17');
  assert.match(dettaglioOre(s, (x) => x), /ultimi cinque anni \(dal 2021-11-17\): 24 ore su 40/);
});

test('la frase per l\'etichetta dice periodo, ore e soglie', () => {
  const s = statoConOre(FORMATORI, [att('2024-03-01'), agg('2025-02-01', 10, 8)], '2026-11-17');
  const t = dettaglioOre(s, (x) => x);
  assert.match(t, /periodo dal 2024-03-01 al 2027-03-01/);
  assert.match(t, /10 ore su 24/);
  assert.match(t, /di cui in corsi di aggiornamento 8 su 8/);
  assert.match(t, /docenza 0 ore su 24 \(in alternativa\)/);
});

test('le date si sommano sui mesi senza spostarsi', () => {
  assert.equal(aggiungiMesiIso('2016-01-17', 36), '2019-01-17');
  assert.equal(aggiungiMesiIso('2021-02-01', 60), '2026-02-01');
});

// Formatore sospeso finché non recupera (scelta dell'utente del 17/11/2026: la norma non lo dice)
test('formatore: le ore fatte dopo la fine del triennio lo rimettono in regola per quel triennio', () => {
  const righe = [att('2016-01-17'), agg('2020-05-01', 24, 8)];
  const s = statoConOre(FORMATORI, righe, '2026-11-17');
  // il 2020 copre il primo triennio (2016-2019) in ritardo; il secondo (2019-2022) resta vuoto
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2022-01-17');
  const con2021 = statoConOre(FORMATORI, [...righe, agg('2021-06-01', 24, 8)], '2026-11-17');
  assert.equal(con2021.scadenza, '2025-01-17'); // ora è il terzo triennio a mancare
});

test('formatore: il recupero deve coprire anche le 8 ore di corso', () => {
  const s = statoConOre(FORMATORI, [att('2016-01-17'), agg('2020-05-01', 24, 2)], '2026-11-17');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2019-01-17');
});

test('formatore: si può recuperare anche con la docenza', () => {
  const s = statoConOre(FORMATORI, [att('2024-03-01'), doc('2023-01-01', 24)], '2026-11-17');
  assert.equal(s.classe, 'ok'); // docenza prima della base non conta, ma il triennio è ancora aperto
  const r = statoConOre(FORMATORI, [att('2016-01-17'), doc('2019-06-01', 24), agg('2020-02-01', 24, 8), agg('2023-02-01', 24, 8)], '2026-11-17');
  assert.equal(r.classe, 'ok');
  assert.equal(r.scadenza, '2028-01-17');
});
