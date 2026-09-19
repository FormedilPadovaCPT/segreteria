// Cronologia dello stato in Cassa Edile: che cosa si dice e, soprattutto,
// che cosa NON si deve dire. Le date dello storico sono quelle delle liste,
// non del giorno del cambio: la scheda non deve mai scrivere «dal 30/09»
// per un dato che viene da una lista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodoTesto, ordinaPeriodi, cronologiaCassaHtml } from '../js/cassa-storico.js';

test('un periodo da lista dice «dalla lista del», mai «dal»', () => {
  const t = periodoTesto({ fonte: 'lista', visto_dal: '2026-08-30', visto_fino: '2026-08-30' });
  assert.equal(t, 'dalla lista del 30/08/2026');
  assert.ok(!/^dal /.test(t));
});

test('se più liste lo confermano, si dice fino a quale', () => {
  const t = periodoTesto({ fonte: 'lista', visto_dal: '2026-08-30', visto_fino: '2026-10-31' });
  assert.equal(t, 'dalla lista del 30/08/2026 · confermato fino alla lista del 31/10/2026');
});

test('lo stato che era in anagrafica è un «risultava», non un inizio', () => {
  assert.equal(periodoTesto({ fonte: 'anagrafica', visto_dal: '2025-05-08' }), 'risultava al 08/05/2025');
  assert.equal(periodoTesto({ fonte: 'anagrafica', visto_dal: null }), 'da data non nota');
});

test('il cambio a mano ha un giorno vero, e lo dice', () => {
  assert.equal(periodoTesto({ fonte: 'manuale', visto_dal: '2026-09-19', visto_fino: '2026-09-19' }), 'dal 19/09/2026');
});

test('in testa l\'attuale, poi dal più recente', () => {
  const o = ordinaPeriodi([
    { id: 1, stato: 'Attiva', visto_dal: '2026-08-30', attuale: false },
    { id: 3, stato: 'Attiva', visto_dal: '2026-10-31', attuale: true },
    { id: 2, stato: 'Sospesa', visto_dal: '2026-09-30', attuale: false },
    { id: 0, stato: 'Cessata', visto_dal: null, attuale: false },
  ]);
  assert.deepEqual(o.map((p) => p.id), [3, 2, 1, 0]);
});

test('la tabella: stato, attuale, e la spiegazione sulle date', () => {
  const html = cronologiaCassaHtml([
    { id: 1, stato: 'Sospesa', visto_dal: '2026-08-30', visto_fino: '2026-08-30', attuale: false, fonte: 'lista', cod_ceiv: '10039102' },
    { id: 2, stato: 'Non più in lista', visto_dal: '2026-09-30', visto_fino: '2026-09-30', attuale: true, fonte: 'lista', nota: 'prima: Sospesa' },
  ]);
  assert.match(html, /Non più in lista/);
  assert.match(html, /attuale/);
  assert.match(html, /10039102/);
  assert.match(html, /fra quali due liste/);
  assert.ok(html.indexOf('Non più in lista') < html.indexOf('>Sospesa<'), 'l\'attuale sta sopra');
});

test('quello che arriva dal database si scrive protetto', () => {
  const html = cronologiaCassaHtml([{ id: 1, stato: '<b>x</b>', attuale: true, fonte: 'manuale', nota: '<script>' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('nessun periodo: si dice dove si è guardato, non «non iscritta»', () => {
  const html = cronologiaCassaHtml([], '2026-08-30');
  assert.match(html, /Nessuno stato registrato/);
  assert.match(html, /30\/08\/2026/);
  assert.ok(!/non iscritta/i.test(html));
});
