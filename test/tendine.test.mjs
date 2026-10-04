// Le tendine non devono perdere il valore che sta nel database (04/10/2026).
// Il caso che ha aperto il controllo: una maschera mostrava la prima voce al
// posto di un valore fuori elenco, e salvando senza toccare il dato vero si perdeva.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opzioniTendina } from '../js/comune.js';

const scelto = (html) => (html.match(/<option value="([^"]*)" selected>/) || [])[1];

test('un valore fuori elenco resta scelto, «com\'è scritto»', () => {
  const h = opzioniTendina(['DIPENDENTE', 'TITOLARE'], 'CAPOCANTIERE');
  assert.equal(scelto(h), 'CAPOCANTIERE');
  assert.match(h, /CAPOCANTIERE \(com'è scritto\)/);
});
test('un valore vuoto resta vuoto, non diventa la prima voce', () => {
  assert.equal(scelto(opzioniTendina(['e-mail', 'PEC'], null)), '');
  assert.equal(scelto(opzioniTendina(['e-mail', 'PEC'], '')), '');
});
test('un valore in elenco è scelto senza aggiunte', () => {
  const h = opzioniTendina([['docente', 'Docente'], ['relatore', 'Relatore']], 'relatore');
  assert.equal(scelto(h), 'relatore');
  assert.doesNotMatch(h, /com'è scritto/);
});
