// Il permesso per VISITA MEDICA (22/10/2026): art. 45 c.4 del CCNL Formazione Professionale
// 2024-2027. 18 ore l'anno su un contatore suo, che non scala ferie, permessi né banca ore;
// oltre le 18 la richiesta passa lo stesso e le ore in più vanno in banca ore come «Recupero» (c.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contatoreVisite, ripartisciVisita, righeTestoVisita, cardRichiesta, famigliaCausale, causaleDaNota,
  CAUSALI_ASSENZA_GIORNO, CAUSALI_SALDO, VISITE_TETTO_MIN, tettoVisite, testoTetto } from '../js/presenze-doc.js';

const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');
const amm = readFileSync(new URL('../js/amministrazione.js', import.meta.url), 'utf8');

const righe = [
  { data: '2026-03-10', causale: 'Visita medica', ore_min: 600 },
  { data: '2026-06-02', causale: 'visita medica ', ore_min: 360 },
  { data: '2025-11-04', causale: 'Visita medica', ore_min: 480 },   // anno prima: non conta
  { data: '2026-05-05', causale: 'Permesso', ore_min: 240 },         // altro monte: non conta
];

test('il tetto è 18 ore e si conta per anno solare, sulla sola causale «Visita medica»', () => {
  assert.equal(VISITE_TETTO_MIN, 1080);
  const v = contatoreVisite(righe, 2026, 60);
  assert.equal(v.usateMin, 960);
  assert.equal(v.residuoMin, 120);
  assert.equal(v.dentroMin, 60);
  assert.equal(v.oltreMin, 0);
  assert.equal(v.dopoMin, 60);
});

test('oltre le 18 ore la richiesta non si blocca: la parte in più va a recupero', () => {
  const v = contatoreVisite(righe, 2026, 300);
  assert.equal(v.dentroMin, 120);
  assert.equal(v.oltreMin, 180);
  assert.equal(v.dopoMin, 0);
  assert.deepEqual(ripartisciVisita([{ data: '2026-10-23', ore_min: 300 }], v.dentroMin), [
    { data: '2026-10-23', causale: 'Visita medica', ore_min: 120 },
    { data: '2026-10-23', causale: 'Recupero', ore_min: 180 },
  ]);
  assert.deepEqual(ripartisciVisita([{ data: '2026-10-23', ore_min: 300 }], 0), [{ data: '2026-10-23', causale: 'Recupero', ore_min: 300 }]);
  const t = righeTestoVisita({ ...v, per_se: true, ssn: true, fuori_orario_no: true });
  assert.match(t.join('\n'), /3:00 ore vanno oltre le 18:00 annue/);
  assert.match(t.join('\n'), /art\. 45 c\.3/);
});

test('contatore a parte: non scala ferie, ex festività né ROL, e non è banca ore', () => {
  assert.ok(!CAUSALI_SALDO.includes('Visita medica'));
  assert.equal(famigliaCausale('Visita medica'), 'assenza');
  assert.ok(CAUSALI_ASSENZA_GIORNO.includes('Visita medica'));
  assert.equal(causaleDaNota('VISITA MEDICA'), 'Visita medica');
});

test('la card del modulo dice le ore rimaste delle 18, e se si va oltre', () => {
  const v = { ...contatoreVisite(righe, 2026, 60), per_se: true, ssn: true, fuori_orario_no: true };
  const c = cardRichiesta({ id: 20, tipo: 'visita_medica', data_inizio: '2026-10-23', ore: '1', visita_foto: v }, null);
  assert.equal(c.titolo, 'VISITE MEDICHE: ORE RIMASTE DOPO');
  assert.equal(c.grande, '1:00');
  assert.match(c.nota, /contatore a parte/);
  const oltre = cardRichiesta({ id: 21, tipo: 'visita_medica', data_inizio: '2026-10-23', ore: '5', visita_foto: contatoreVisite(righe, 2026, 300) }, null);
  assert.match(oltre.nota, /3:00 ore oltre le 18:00 annue/);
  assert.match(cardRichiesta({ id: 22, tipo: 'visita_medica', ore: '1' }, null).richiesta, /non letto/);
});

test('la maschera: tipo, monte, tre dichiarazioni obbligatorie e niente procedura inventata', () => {
  assert.match(src, /tipo: 'visita_medica', etichetta: 'Permesso per visita medica', monte: 'visite_mediche'/);
  assert.match(src, /fr-vm-perse[\s\S]*fr-vm-ssn[\s\S]*fr-vm-orario/);
  assert.match(src, /!\$\('#fr-vm-perse'\)\.checked \|\| !\$\('#fr-vm-ssn'\)\.checked \|\| !\$\('#fr-vm-orario'\)\.checked/);
  assert.match(src, /va chiesta all’ufficio personale/);
  assert.match(src, /visita_foto: visitaFoto/);
  /* le righe generate: ripartite fra le 18 ore e il recupero */
  assert.match(src, /righeExtra = ripartisciVisita\(giorni, v\.dentroMin\)/);
  assert.match(src, /insert\(righeExtra\.map/);
  assert.match(amm, /visita_medica: 'Permesso per visita medica'/);
});

test('part-time: il tetto si riproporziona sull’orario settimanale (30 su 36 → 15 ore, 22/10/2026)', () => {
  /* l'orario vero di Renato Squizzato dal 01/01/2026: lunedì 6 ore, martedì-giovedì 8 */
  const orario = { lun_min: 360, mar_min: 480, mer_min: 480, gio_min: 480, ven_min: 0, sab_min: 0, dom_min: 0 };
  const t = tettoVisite(orario);
  assert.equal(t.settimanaMin, 1800);
  assert.equal(t.tettoMin, 900);
  const v = contatoreVisite(righe, 2026, 120, t);
  assert.equal(v.tettoMin, 900);
  assert.equal(v.residuoMin, 0, '16 ore già usate su 15');
  assert.equal(v.oltreMin, 120);
  assert.match(testoTetto(v), /^15:00 \(18 ore in proporzione all’orario di 30:00 su 36:00 settimanali\)$/);
  assert.match(righeTestoVisita(v).join(' '), /oltre le 15:00 annue/);
  /* tempo pieno, o orario non scritto: 18 ore */
  assert.equal(tettoVisite({ lun_min: 480, mar_min: 480, mer_min: 480, gio_min: 480, ven_min: 240 }).tettoMin, 1080);
  assert.equal(tettoVisite(null).tettoMin, 1080);
  assert.equal(testoTetto(contatoreVisite([], 2026, 60)), '18:00');
  /* nella maschera e nel conteggio il tetto viene dall'orario della persona alla data */
  assert.match(src, /tettoVisite\(orarioValido\(orari \|\| \[\], data \|\| oggiIso\(\)\)\)/);
});
