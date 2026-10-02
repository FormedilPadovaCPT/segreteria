// Dettaglio attività e contatori delle presenze.
//
// Nato il 02/10/2026: dentro le ore lavorate si vuole dire che due ore erano
// una riunione o il progetto X, per contare ore per progetto, riunioni e
// formazione — senza che diventino straordinari o banca ore. L'ufficio lo
// faceva già da Access (202 righe dal 2016): la famiglia si decide dalla
// CAUSALE, così lo storico si legge come le righe nuove.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { famigliaCausale, contaAttivita, csvContatori } from '../js/presenze-doc.js';

test('ogni causale già presente nello storico finisce nella famiglia giusta', () => {
  const attese = {
    banca: ['Ore supplementari', 'Recupero', 'recupero', 'Pagato'],
    assenza: ['Ferie', 'Permesso', 'Malattia', 'Festività', 'Permessi legge 104/92', 'Permesso sindacale RSU', 'Riunione sindacale'],
    dettaglio: ['Riunione', 'Formazione', 'GSuite', 'Uff. Corsi', 'Progetto STRESS', 'Progettazione INAIL',
      'Progettazione SPISAL (2021 AUDIT)', 'Progettazione SPISAL (2018 MOG)', 'Progettazione CAM (Direttiva Costruzioni)',
      'Progetto SPISAL (2022 Sicuri si Diventa)', 'Progetto SPISAL (2022 Soft Skills sicurezza)',
      'Progetto SPISAL (2022 Simulatore)', 'Progettazione CNCPT (2021 progetti Formedil INAIL)'],
  };
  for (const [fam, causali] of Object.entries(attese)) {
    for (const c of causali) assert.equal(famigliaCausale(c), fam, `${c} dovrebbe essere ${fam}`);
  }
});

test('«Riunione» è dettaglio, «Riunione sindacale» no: non si confondono', () => {
  assert.equal(famigliaCausale('Riunione'), 'dettaglio');
  assert.equal(famigliaCausale('Riunione sindacale'), 'assenza');
});

test('un progetto che nel nome contiene «recupero» resta un dettaglio', () => {
  assert.equal(famigliaCausale('Progetto recupero edifici'), 'dettaglio');
});

const R = 'Renato Squizzato';
const ex = (id, data, causale, ore_min, extra = {}) => ({ id, dipendente: R, data, causale, ore_min, pagato: false, recuperato: false, ...extra });
const pr = (data, tot_min, note = null) => ({ dipendente: R, data, tot_min, note });

test('giornata di formazione con ore in più: il dettaglio conta tutto, le supplementari si leggono a parte', () => {
  // 08/10/2021 dello storico: AUDIT 7:00 e 7:00 di supplementari
  const [a] = contaAttivita({
    extra: [ex(1, '2021-10-08', 'Progettazione SPISAL (2021 AUDIT)', 420), ex(2, '2021-10-08', 'Ore supplementari', 420)],
    presenze: [pr('2021-10-08', 440)],
  });
  assert.equal(a.causale, 'Progettazione SPISAL (2021 AUDIT)');
  assert.equal(a.totMin, 420);
  assert.equal(a.righe[0].supplGiorno, 420);
  assert.deepEqual(a.righe[0].avvisi, []);
});

test('le anomalie dello storico si segnalano, e i conti restano quelli scritti', () => {
  // 31/08/2021: AUDIT 2:00 scritta due volte, una delle due «pagata»
  // 10/05/2022: 8:00 + 4:00 di AUDIT con 8:38 lavorate
  const [a] = contaAttivita({
    extra: [
      ex(1, '2021-08-31', 'Progettazione SPISAL (2021 AUDIT)', 120),
      ex(2, '2021-08-31', 'Progettazione SPISAL (2021 AUDIT)', 120, { pagato: true }),
      ex(3, '2022-05-10', 'Progettazione SPISAL (2021 AUDIT)', 480),
      ex(4, '2022-05-10', 'Progettazione SPISAL (2021 AUDIT)', 240),
    ],
    presenze: [pr('2021-08-31', 490), pr('2022-05-10', 518)],
  });
  assert.equal(a.totMin, 960, 'nessuna riga viene tolta: si conta quello che c’è');
  assert.equal(a.giorni, 2);
  assert.deepEqual(a.righe.map((r) => r.avvisi), [
    ['doppia'], ['doppia', 'spunte-storico'], ['oltre'], ['oltre'],
  ]);
  assert.equal(a.avvisi, 4);
});

test('il permesso sindacale non entra nelle ore lavorate del confronto', () => {
  const [a] = contaAttivita({
    extra: [ex(1, '2026-09-22', 'Riunione', 360)],
    presenze: [pr('2026-09-22', 360), pr('2026-09-22', 120, 'PERMESSO SINDACALE RSU')],
  });
  assert.equal(a.righe[0].lavorateGiorno, 360);
  assert.deepEqual(a.righe[0].avvisi, []);
});

test('grafie diverse della stessa causale si contano insieme e si dichiarano', () => {
  const [a] = contaAttivita({
    extra: [ex(1, '2026-01-10', 'Riunione', 60), ex(2, '2026-01-11', 'Riunione', 60), ex(3, '2026-01-12', 'riunione ', 30)],
    presenze: [],
  });
  assert.equal(a.causale, 'Riunione');
  assert.deepEqual(a.altreGrafie, ['riunione ']);
  assert.equal(a.totMin, 150);
  assert.ok(a.righe.every((r) => r.avvisi.includes('senza-presenze')));
  assert.equal(a.avvisi, 0, 'una giornata non registrata nel foglio non è un errore da guardare');
});

test('il CSV si apre in Excel italiano: punto e virgola, virgola decimale, testo protetto', () => {
  const att = contaAttivita({ extra: [ex(1, '2026-04-14', 'Riunione', 90, { note: 'Commissione; sicurezza' })], presenze: [pr('2026-04-14', 480)] });
  const csv = csvContatori(att);
  assert.ok(csv.startsWith('﻿'));
  const [testa, riga] = csv.slice(1).trim().split('\r\n');
  assert.match(testa, /^Attività;Data;Ore \(hh:mm\);Ore \(decimali\)/);
  assert.match(testa, /;Progetto;Note;Avvisi$/);
  assert.match(riga, /^Riunione;14\/04\/2026;1:30;1,50;8:00;;;"Commissione; sicurezza";$/);
});
