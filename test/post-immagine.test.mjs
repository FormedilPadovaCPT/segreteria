// L'immagine proposta dei post (09/11/2026): che cosa propone l'app a partire dal post. Dati INVENTATI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proposta, numeroInTesta, puntiDelTesto, titoloPulito, senzaSegni, aCapo, MODELLI } from '../js/post-immagine.js';

test('il numero in testa alla prima riga diventa il numero grande, così com\'è scritto', () => {
  assert.deepEqual(numeroInTesta('28 volte in un anno: aperture verso il vuoto senza protezione'),
    { numero: '28', didascalia: 'volte in un anno', resto: 'aperture verso il vuoto senza protezione' });
  assert.equal(numeroInTesta('71,2% dei cantieri migliora').numero, '71,2%');
  assert.equal(numeroInTesta('40.992 controlli in un anno').numero, '40.992');
  assert.deepEqual(numeroInTesta('Dal 18 novembre: due giornate di formazione'), { numero: '18', didascalia: 'novembre', resto: 'due giornate di formazione' });
  assert.equal(numeroInTesta('Quando il tecnico torna'), null, 'senza numero in testa, niente numero grande');
  assert.equal(numeroInTesta('Dei 66 cantieri trovati'), null, 'un numero dentro la frase non si stacca');
});

test('la proposta dal post', () => {
  const p1 = proposta({ titolo: '3/9 · Messa a terra', pilastro: 'cantiere', gancio: '5 volte in un anno: messa a terra non verificata' });
  assert.equal(p1.modello, 'numero');
  assert.equal(p1.titolo, 'Messa a terra', 'senza il numero della serie');
  assert.equal(p1.occhiello, 'Dal cantiere');
  assert.equal(p1.numero, '5');
  const p2 = proposta({ titolo: 'Che cosa può fare un\'impresa', pilastro: 'servizi', gancio: 'Quattro cose:',
    testo_telegram: '**TITOLO**\nQuattro cose:\n- proteggere bordi;\n- tenere i **documenti**;\n- controllare la cassetta;\n- seguire le subappaltatrici.' });
  assert.equal(p2.modello, 'elenco');
  assert.deepEqual(p2.punti, ['proteggere bordi', 'tenere i documenti', 'controllare la cassetta', 'seguire le subappaltatrici']);
  const p3 = proposta({ titolo: 'Patente a crediti', pilastro: 'normativa', gancio: 'Cambiano i requisiti dichiarabili' });
  assert.equal(p3.modello, 'frase');
  assert.equal(p3.frase, 'Cambiano i requisiti dichiarabili');
  assert.equal(proposta({}).occhiello, 'Area Sicurezza e Salute');
  assert.ok(MODELLI.foto, 'c\'è il modello con la foto');
});

test('pulizia dei segni e a capo', () => {
  assert.equal(senzaSegni('**grassetto** e [link](https://x.it) ++sotto++'), 'grassetto e link sotto');
  assert.equal(titoloPulito('9/9 · Che cosa fare'), 'Che cosa fare');
  assert.deepEqual(puntiDelTesto('1. uno\n2) due\n• tre\ntesto'), ['uno', 'due', 'tre']);
  const misura = (t) => t.length * 10;
  assert.deepEqual(aCapo('uno due tre quattro', 80, misura), ['uno due', 'tre', 'quattro']);
  const r = aCapo('uno due tre quattro cinque sei', 80, misura, 2);
  assert.equal(r.length, 2);
  assert.ok(r[1].endsWith('…'), 'oltre il massimo di righe si chiude con …');
});

test('la scheda del post ha l\'immagine proposta, e niente QR né link dentro', () => {
  const com = readFileSync(new URL('../js/comunicazione.js', import.meta.url), 'utf8');
  const gr = readFileSync(new URL('../js/post-grafica.js', import.meta.url), 'utf8');
  assert.match(com, /\$\{htmlGrafica\(p, immagini\(p\)\.length\)\}/);
  assert.match(com, /collegaGrafica\(\$\('#drawer-body'\), p,/);
  assert.match(gr, /op: 'immagine', id: p\.id, mime: 'image\/jpeg', base64/, 'si carica dalla stessa strada del «Carica»');
  assert.doesNotMatch(gr, /qrcode|QR\(|https?:\/\/[^'"\s]*formedilpadova/i, 'nell\'immagine niente QR né indirizzi');
  assert.match(gr, /img\/logo-post-positivo\.png/);
  for (const c of ['p.immagine_suggerita', 'c.occhiello', 'c.titolo', 'c.numero', 'c.didascalia', 'c.frase', 'c.piede', 'v']) {
    assert.ok(gr.includes('esc(' + c), c + ' passa da esc()');
  }
});
