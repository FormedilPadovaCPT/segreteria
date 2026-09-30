// Il passo del tecnico negli elenchi dei servizi CPT: che cosa si scrive sotto lo stato della pratica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passoTecnico, passoHtml } from '../js/passo-tecnico.js';

const inc = (x) => ({ id: 1084, stato: 'aperto', tecnico_nome: 'De Marco Arch. Nicola', ...x });

test('il passo segue l\'incarico: non aperto, visto, accettato, rifiutato, eseguito', () => {
  assert.deepEqual(passoTecnico(1084, inc({})), { tipo: 'fermo', testo: '⏳ De Marco Arch. Nicola non l\'ha ancora aperto' });
  assert.equal(passoTecnico(1084, inc({ presa_visione_il: '2026-09-24T15:00:00Z' })).tipo, 'attesa');
  assert.deepEqual(passoTecnico(1084, inc({ presa_visione_il: '2026-09-24T15:23:36Z', accettato_il: '2026-09-24T15:23:36Z' })),
    { tipo: 'ok', testo: '✅ accettato da De Marco Arch. Nicola il 24/09/2026' }, 'il caso Noventa');
  const rif = passoTecnico(1084, inc({ accettato_il: '2026-09-24T15:00:00Z', rifiutato_il: '2026-09-26T09:00:00Z', rifiuto_motivo: 'fuori zona' }));
  assert.equal(rif.tipo, 'err'); assert.match(rif.testo, /rifiutato da .* il 26\/09\/2026 — fuori zona/, 'il rifiuto vince sull\'accettazione di prima');
  assert.match(passoTecnico(1084, inc({ accettato_il: '2026-09-24T15:00:00Z', eseguito_il: '2026-10-02T10:00:00Z' })).testo, /eseguito da .* il 02\/10\/2026/);
  assert.equal(passoTecnico(1084, inc({ stato: 'eseguito' })).tipo, 'ok');
});

test('lettura fallita o incarico mancante non diventano «non l\'ha aperto»', () => {
  assert.equal(passoTecnico(null, null), null, 'pratica senza incarico: niente pastiglia');
  assert.equal(passoTecnico(1084, null).tipo, 'err');
  assert.match(passoTecnico(1084, null).testo, /non trovato nel gestionale/);
  assert.equal(passoTecnico(1084, inc({ accettato_il: '2026-09-24T15:00:00Z' }), true).tipo, 'err');
  assert.match(passoTecnico(1084, undefined, true).testo, /non sono riuscito a leggere/);
});

test('nella cella: solo per le pratiche aperte con un incarico', () => {
  const passi = { di: { 1084: inc({ accettato_il: '2026-09-24T15:23:36Z' }) }, errore: false };
  assert.match(passoHtml({ stato: 'autorizzata', incarico_id: 1084 }, passi), /hm-passo-ok">✅ accettato da De Marco Arch\. Nicola il 24\/09\/2026</);
  assert.equal(passoHtml({ stato: 'chiusa', incarico_id: 1084 }, passi), '', 'pratica chiusa: non serve più');
  assert.equal(passoHtml({ stato: 'autorizzata', incarico_id: null }, passi), '');
  assert.equal(passoHtml({ stato: 'autorizzata', incarico_id: 1084 }, null), '');
  assert.match(passoHtml({ stato: 'assegnata', incarico_id: 77 }, { di: {}, errore: true }), /hm-passo-err/);
  assert.match(passoHtml({ stato: 'assegnata', incarico_id: 77 }, { di: { 77: { tecnico_nome: '<b>x' } }, errore: false }), /&lt;b&gt;x/, 'il nome passa da esc');
});
