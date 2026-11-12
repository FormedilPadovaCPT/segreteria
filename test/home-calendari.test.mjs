// Cruscotto: agenda e orario dei corsi (12/11/2026).
// Dati INVENTATI: il repository è pubblico.
//
// Quello che questi controlli tengono fermo:
//   · l'orario dei corsi parte da oggi: i giorni passati non ci sono;
//   · mattina e pomeriggio si decidono sull'ora di Roma, non su quella UTC
//     scritta nel database (12:30Z d'inverno sono le 13:30: pomeriggio);
//   · nessuna lezione da oggi in avanti si perde fra le due fasce;
//   · un titolo che non ha la forma dell'import resta intero, senza codice inventato;
//   · l'agenda resta l'elenco per giorni e segna il giorno di oggi;
//   · il cruscotto usa questo modulo e ogni tessera ha il corpo che scorre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { giornoEvento, oraRoma, leggiCorso, orarioCorsi, htmlOrarioCorsi, agendaElenco } from '../js/home-calendari.js';

const ev = (titolo, inizio, fine, extra = {}) => ({ titolo, inizio, fine, tutto_il_giorno: false, luogo: 'PADOVA', link: 'https://esempio.it/e', ...extra });
const CORSI = [
  ev('900 · CORSO DI IERI · teorico', '2026-11-11T07:30:00+00:00', '2026-11-11T11:30:00+00:00'),
  ev('901 · CORSO DI PROVA (tipo A) · teorico (giornata 1 di 2)', '2026-11-12T07:30:00+00:00', '2026-11-12T11:30:00+00:00'),
  ev('901 · CORSO DI PROVA (tipo A) · teorico (giornata 1 di 2)', '2026-11-12T12:30:00+00:00', '2026-11-12T16:30:00+00:00'),
  ev('902 · ALTRO CORSO · pratico (giornata 2 di 2 — corso iniziato il 11/11)', '2026-11-13T07:00:00+00:00', '2026-11-13T11:00:00+00:00', { luogo: 'SEDE ESTERNA' }),
  ev('Riunione docenti <b>', '2026-11-13T13:00:00+00:00', '2026-11-13T15:00:00+00:00', { link: null }),
];
const OGGI = '2026-11-12';

test('giorno e ora sono quelli di Roma', () => {
  assert.equal(oraRoma('2026-11-12T12:30:00+00:00'), '13:30');
  assert.equal(oraRoma('2026-07-01T12:30:00+00:00'), '14:30', 'd\'estate due ore');
  assert.equal(giornoEvento(ev('x', '2026-11-12T23:30:00+00:00')), '2026-11-13', 'le 23:30 UTC sono già il giorno dopo');
  assert.equal(giornoEvento({ inizio: '2026-11-10T00:00:00+00:00', tutto_il_giorno: true }), '2026-11-10', 'tutto il giorno: la data scritta');
});

test('il titolo del corso si scompone solo se ha la forma dell\'import', () => {
  assert.deepEqual(leggiCorso(CORSI[1].titolo), { codice: '901', nome: 'CORSO DI PROVA (tipo A)', fase: 'teorico (giornata 1 di 2)', pratico: false });
  assert.equal(leggiCorso(CORSI[3].titolo).pratico, true);
  assert.deepEqual(leggiCorso('Riunione docenti'), { codice: '', nome: 'Riunione docenti', fase: '', pratico: false });
  assert.equal(leggiCorso('A · B · C').nome, 'A · B · C', 'senza codice numerico e senza fase resta com\'è');
});

test('l\'orario parte da oggi e non perde lezioni', () => {
  const o = orarioCorsi(CORSI, OGGI);
  assert.deepEqual(o.giorni.map((g) => g.giorno), ['2026-11-12', '2026-11-13']);
  assert.equal(o.lezioni, 4, 'le quattro da oggi in avanti, non quella di ieri');
  assert.equal(o.giorni[0].mattina.length, 1);
  assert.equal(o.giorni[0].pomeriggio.length, 1, '12:30Z = 13:30 a Roma: pomeriggio');
  assert.equal(o.giorni[1].pomeriggio[0].titolo, 'Riunione docenti <b>');
  assert.deepEqual(orarioCorsi(CORSI, '2026-12-01'), { giorni: [], lezioni: 0 });
});

test('la griglia: oggi segnato, titoli protetti, niente quando non c\'è niente', () => {
  const h = htmlOrarioCorsi(CORSI, OGGI);
  assert.match(h, /--col:2/);
  assert.match(h, /hm-or-oggi/);
  assert.ok(!h.includes('CORSO DI IERI'));
  assert.ok(!h.includes('<b>"') && h.includes('Riunione docenti &lt;b&gt;'), 'il titolo non entra come HTML');
  assert.match(h, /hm-or-pratico/);
  assert.match(h, /SEDE ESTERNA/, 'la sede sta nel dettaglio');
  assert.equal((h.match(/data-or-det=/g) || []).length, 4);
  assert.equal(htmlOrarioCorsi(CORSI, '2026-12-01'), '');
  assert.equal(htmlOrarioCorsi([], OGGI), '');
});

test('l\'agenda è l\'elenco per giorni, con oggi segnato', () => {
  const h = agendaElenco([ev('Ufficio', '2026-11-12T00:00:00+00:00', null, { tutto_il_giorno: true, luogo: '' }), ...CORSI.slice(0, 2)], OGGI);
  assert.equal((h.match(/hm-giorno/g) || []).length, 2, 'due giorni, due titoli');
  assert.equal((h.match(/data-oggi/g) || []).length, 1);
  assert.match(h, /tutto il giorno/);
  assert.ok(h.indexOf('CORSO DI IERI') < h.indexOf('data-oggi'), 'i giorni passati restano, sopra');
  assert.equal(agendaElenco([], OGGI), '');
});

test('il cruscotto usa il modulo e ogni tessera ha il corpo che scorre', () => {
  const home = readFileSync(new URL('../js/home.js', import.meta.url), 'utf8');
  assert.match(home, /from '\.\/home-calendari\.js'/);
  assert.match(home, /<div class="hm-corpo">\$\{corpo\}<\/div>/);
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.hm-corpo\{max-height:\d+px;overflow-y:auto/);
});
