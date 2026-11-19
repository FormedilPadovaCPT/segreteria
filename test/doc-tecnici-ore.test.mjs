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

// Attestato da prima del D.Lgs. 81/2008: l'obbligo di aggiornamento decorre
// dal 15/05/2008 (Allegato XIV). Caso vero: Balladore, corso del 10/10/1997.
const COORD08 = { ...COORD, aggiornamento_dal: '2008-05-15' };
const BALLADORE = [agg('2008-02-12', 12), agg('2017-11-06', 6), agg('2019-12-12', 16), agg('2021-11-04', 40),
  agg('2023-08-22', 1), agg('2024-05-10', 3), agg('2024-11-23', 20), agg('2025-01-23', 3), agg('2025-03-28', 4),
  agg('2025-04-17', 4), agg('2025-05-20', 2), agg('2025-05-20', 2), agg('2025-05-20', 2)];

test('coordinatore con attestato del 1997: i dieci anni non partono dal corso ma dal 15/05/2008', () => {
  const corso = [{ data_inizio: '1997-10-10' }];
  const prima = statoConOre(COORD, BALLADORE.map((r) => ({ ...r })), '2026-11-18', corso);
  assert.equal(prima.decaduto, true); // senza la regola: decaduto dal 10/10/2007
  const s = statoConOre(COORD08, BALLADORE.map((r) => ({ ...r })), '2026-11-18', corso);
  assert.equal(s.decaduto, undefined);
  assert.equal(s.classe, 'ok');
  assert.equal(s.ore, 41);
  assert.equal(s.scadenza, '2029-05-10');
  assert.equal(s.grazia_fino, '2013-05-15');
  assert.equal(s.decorrenza, '2008-05-15');
  assert.equal(s.doc.data_inizio, '1997-10-10');
});

test('coordinatore con attestato anteriore e nessun aggiornamento dal 2008: decade il 15/05/2018', () => {
  const s = statoConOre(COORD08, [att('2005-01-31'), agg('2026-03-01', 4)], '2026-11-18');
  assert.equal(s.decaduto, true);
  assert.equal(s.scadenza, '2018-05-15');
});

test('coordinatore con attestato successivo al 2008: la decorrenza non cambia niente', () => {
  const a = statoConOre(COORD, [att('2015-01-01'), agg('2022-03-01', 24)], '2026-11-17');
  const b = statoConOre(COORD08, [att('2015-01-01'), agg('2022-03-01', 24)], '2026-11-17');
  assert.deepEqual({ ...b, decorrenza: undefined }, { ...a, decorrenza: undefined });
  assert.equal(b.decorrenza, null);
});

test('coordinatore con attestato anteriore, nei primi cinque anni dalla decorrenza: la frase lo dice', () => {
  const s = statoConOre(COORD08, [att('2001-06-01')], '2010-01-01');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2013-05-15');
  assert.match(dettaglioOre(s), /decorre dal 2008-05-15/);
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

test('coordinatore: nei primi cinque anni la frase dice che le ore non servono e conta dall\'abilitazione', () => {
  // caso Caon del 18/11/2026: corso 120 ore il 21/12/2024, prima corsi che non contano
  const s = statoConOre(COORD, [att('2024-12-21'), agg('2022-01-21', 4), agg('2025-04-17', 4)], '2026-11-18');
  const f = dettaglioOre(s, (x) => x);
  assert.match(f, /primi cinque anni dall'abilitazione \(2024-12-21\): le ore non servono fino al 2029-12-21; registrate finora 4 ore su 40/);
  assert.doesNotMatch(f, /dal 2021/);
});

test('coordinatore: finiti i primi cinque anni la frase torna agli ultimi cinque anni', () => {
  const s = statoConOre(COORD, [att('2020-06-01'), agg('2025-06-01', 40)], '2026-11-18');
  assert.match(dettaglioOre(s, (x) => x), /^ultimi cinque anni \(dal 2021-11-18\): 40 ore su 40$/);
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

// Requisiti a scadenza (18/11/2026): la regola di sempre, ora condivisa col gestionale.
import { statoScadenza, testoScadenza } from '../js/doc-tecnici-ore.js';
const CONTRATTO = { rinnovo: 'tacito', durata_mesi: 12, preavviso_giorni: 60 };
const POLIZZA = { rinnovo: 'scadenza', durata_mesi: 12, preavviso_giorni: 60 };

test('scadenze: il contratto a rinnovo tacito corre da solo finché nessuno disdice', () => {
  const s = statoScadenza(CONTRATTO, [{ data_inizio: '2025-04-17' }], '2026-11-18');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2027-04-17');
  assert.equal(testoScadenza(s, (x) => x), '2027-04-17 ⟳');
  const d = statoScadenza(CONTRATTO, [{ data_inizio: '2025-04-17', disdetto_il: '2026-01-10' }], '2026-11-18');
  assert.equal(d.classe, 'scaduto', 'disdetto: non si rinnova più');
});

test('scadenze: la polizza va in scadenza dentro il preavviso e poi scade', () => {
  assert.equal(statoScadenza(POLIZZA, [{ data_inizio: '2026-01-05', data_fine: '2027-01-05' }], '2026-11-18').classe, 'scade');
  assert.equal(statoScadenza(POLIZZA, [{ data_inizio: '2025-01-05', data_fine: '2026-01-05' }], '2026-11-18').classe, 'scaduto');
  assert.equal(statoScadenza(POLIZZA, [{ data_inizio: '2026-09-30', data_fine: '2027-09-30' }], '2026-11-18').classe, 'ok');
  assert.equal(statoScadenza(POLIZZA, [{ descrizione: 'senza date' }], '2026-11-18').classe, 'senzadata');
  assert.equal(statoScadenza(POLIZZA, [], '2026-11-18').classe, 'mancante');
});

test('scadenze: conta l\'ultima riga, non la più lunga', () => {
  const s = statoScadenza(POLIZZA, [{ data_inizio: '2014-02-08', data_fine: '2017-02-08' }, { data_inizio: '2024-02-08', data_fine: '2025-02-08' }], '2026-11-18');
  assert.equal(s.doc.data_inizio, '2024-02-08');
  assert.equal(s.classe, 'scaduto');
});

// Tecnico verificatore UNI 11751-2, punto 6.2 (18/11/2026): nel triennio 16 ore
// su MOG, SGSL, audit e almeno 3 verifiche di asseverazione che insieme facciano 6 g/u.
const TV = { ore_soglia: 16, durata_mesi: 36, preavviso_giorni: 180, verifiche_soglia: 3, verifiche_gu_soglia: 6 };
const ver = (d, gu) => ({ tipo: 'verifica', data_inizio: d, gu });

test('verificatore: ore e verifiche insieme, i 6 g/u sono il totale', () => {
  const righe = [att('2026-04-23'), agg('2026-06-10', 16), ver('2026-11-10', 3.5), ver('2027-03-01', 1), ver('2027-09-01', 1.5)];
  const s = statoConOre(TV, righe, '2027-10-01');
  assert.equal(s.classe, 'ok');
  assert.equal(s.verifiche, 3);
  assert.equal(s.verifiche_gu, 6);
  assert.match(dettaglioOre(s, (x) => x), /verifiche di asseverazione 3 su 3, 6 g\/u su 6/);
});

test('verificatore: le ore da sole non bastano, e il triennio chiuso senza verifiche è scaduto', () => {
  const righe = [att('2023-04-23'), agg('2024-01-10', 16), ver('2024-05-01', 4)];
  const s = statoConOre(TV, righe, '2026-11-18');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2026-04-23');
  assert.equal(s.manca_verifiche, 2);
});

test('verificatore: dentro il preavviso con le verifiche mancanti è da programmare', () => {
  const righe = [att('2024-01-15'), agg('2025-01-10', 16), ver('2025-05-01', 4), ver('2026-05-01', 3)];
  const s = statoConOre(TV, righe, '2026-11-18');
  assert.equal(s.classe, 'scade');
  assert.equal(s.scadenza, '2027-01-15');
  assert.equal(s.manca_verifiche, 1);
  assert.equal(s.manca_gu, 0);
});

test('verificatore: una verifica futura (piano) non conta ancora', () => {
  const s = statoConOre(TV, [att('2026-04-23'), ver('2026-12-15', 3)], '2026-11-18');
  assert.equal(s.verifiche, 0);
});

// Qualifica del verificatore (UNI 11751-2, 6.1, criterio 2): 10 giorni di affiancamento.
const TVQ = { ...TV, affiancamento_giorni_soglia: 10 };
const oss = (d, giornate, gu = 3.5) => ({ tipo: 'verifica', data_inizio: d, gu, ruolo: 'osservatore', giornate });

test('verificatore: senza 10 giorni di affiancamento non è operativo', () => {
  const s = statoConOre(TVQ, [att('2026-04-23'), oss('2026-11-10', 3.5), oss('2026-11-09', 4.5)], '2026-11-18');
  assert.equal(s.classe, 'senzadata');
  assert.equal(s.affiancamento, 8);
  assert.match(s.testo, /affiancamento 8 giorni su 10: non ancora operativo/);
});

test('verificatore: gli affiancamenti fatti prima dell\'attestato contano', () => {
  const s = statoConOre(TVQ, [att('2026-04-23'), oss('2025-10-10', 6), oss('2025-11-24', 4)], '2026-11-18');
  assert.notEqual(s.classe, 'senzadata');
});

test('verificatore: con la qualifica riconosciuta si passa al mantenimento', () => {
  const s = statoConOre(TVQ, [att('2026-04-23'), { tipo: 'riconoscimento', data_inizio: '2026-07-29' }], '2026-11-18');
  assert.equal(s.classe, 'ok');
  assert.equal(s.scadenza, '2029-04-23');
  assert.equal(s.verifiche, 0);
});

// (18/11/2026) che cosa copre ogni polizza: una frase per requisito, diversa per ciascuno
import { spiegaRequisito } from '../js/doc-tecnici-ore.js';
test('ogni polizza del contratto ha la sua spiegazione, e non si confondono', () => {
  const prof = spiegaRequisito({ codice: 'polizza_rc_prof' });
  const terzi = spiegaRequisito({ codice: 'polizza_rc_terzi' });
  const inf = spiegaRequisito({ codice: 'polizza_infortuni' });
  for (const s of [prof, terzi, inf, spiegaRequisito({ codice: 'contratto' })]) assert.ok(s.length > 40);
  assert.equal(new Set([prof, terzi, inf]).size, 3);
  assert.match(prof, /errore/);
  assert.match(terzi, /persona, a un animale o a una cosa/);
  assert.match(inf, /Copre te/);
  assert.equal(spiegaRequisito({ codice: 'agg_coordinatore' }), '');
  assert.equal(spiegaRequisito(null), '');
});

// (19/11/2026) FORMEDIL Italia, Prot_26-27_0165: le ore dei corsi da coordinatore valgono
// per il formatore solo se pertinenti all'area tematica. Le righe segnate restano contate,
// ma il conteggio dice quante sono da validare.
test('formatore: le ore da validare per area tematica contano, e il dettaglio le dice', () => {
  const righe = [att('2023-12-03'), { ...agg('2024-05-06', 3, 3), area_da_validare: true }, agg('2025-04-17', 4, 4)];
  const s = statoConOre(FORMATORI, righe, '2026-11-19');
  assert.equal(s.ore, 7);
  assert.equal(s.ore_da_validare, 3);
  assert.match(dettaglioOre(s), /3 ore da validare per area tematica/);
});
test('formatore: senza righe segnate il dettaglio non parla di validazione', () => {
  const s = statoConOre(FORMATORI, [att('2023-12-03'), agg('2025-04-17', 4, 4)], '2026-11-19');
  assert.equal(s.ore_da_validare, 0);
  assert.doesNotMatch(dettaglioOre(s), /da validare/);
});
test('formatore: il recupero tardivo non conta due volte le ore (Prot_26-27_0165)', () => {
  // triennio 2016-2019 senza ore, 24 ore nel 2020: vanno al triennio scaduto,
  // il successivo (2019-2022) resta vuoto e scade il 17/01/2022
  const s = statoConOre(FORMATORI, [att('2016-01-17'), agg('2020-03-01', 24, 8)], '2026-11-19');
  assert.equal(s.classe, 'scaduto');
  assert.equal(s.scadenza, '2022-01-17');
});

// (19/11/2026) coordinatore «valido da confermare»: con la riga da_confermare un esito
// «scaduto/decaduto» si mostra come valido da confermare; senza, il conto resta com'era.
test('coordinatore: senza aggiornamenti 2008-2018 decade, ma con la riga «da confermare» è valido da confermare', () => {
  const base = [agg('2023-03-29', 2), agg('2024-11-29', 6)];
  const orig = [{ data_inizio: '2005-01-31' }];
  const C = { ...COORD, aggiornamento_dal: '2008-05-15' };
  const s = statoConOre(C, base, '2026-11-19', orig);
  assert.equal(s.classe, 'scaduto');
  const c = statoConOre(C, [...base, { tipo: 'da_confermare', data_inizio: '2026-11-19' }], '2026-11-19', orig);
  assert.equal(c.classe, 'senzadata');
  assert.equal(c.da_confermare, true);
  assert.equal(c.scaduto_il, s.scadenza);
  assert.equal(c.testo, 'valido da confermare');
  assert.match(dettaglioOre(c), /valido da confermare/);
});
test('la riga «da confermare» non tocca un requisito in regola', () => {
  const r = [agg('2024-01-10', 20), agg('2025-01-10', 20), { tipo: 'da_confermare', data_inizio: '2026-11-19' }];
  const s = statoConOre(COORD, r, '2026-11-19', [{ data_inizio: '2015-01-31' }]);
  assert.notEqual(s.da_confermare, true);
});
