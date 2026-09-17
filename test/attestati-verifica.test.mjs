// node test/attestati-verifica.test.mjs
import assert from 'node:assert/strict';
import { ALFABETO, generaCodice, formattaCodice, serieVerificabile, urlVerifica } from '../js/attestati-verifica.js';

// l'alfabeto non ha caratteri che si confondono
for (const ch of '01OI') assert.ok(!ALFABETO.includes(ch), `alfabeto senza ${ch}`);
assert.equal(ALFABETO.length, 32);

// codice: 10 caratteri dell'alfabeto, diversi da un giro all'altro
const c1 = generaCodice();
assert.match(c1, /^[A-HJ-NP-Z2-9]{10}$/);
assert.notEqual(generaCodice(), c1);
assert.equal(generaCodice(() => new Uint8Array(10)), 'AAAAAAAAAA');
assert.equal(generaCodice(() => Uint8Array.from([31, 32, 63, 255, 0, 1, 2, 3, 4, 5])), '9A99ABCDEF');

assert.equal(formattaCodice('abcdefghjk'), 'ABCDE-FGHJK');
assert.equal(formattaCodice('ABCDE-FGHJK'), 'ABCDE-FGHJK');

// solo la serie nuova N/aaaa è verificabile; lo storico (6664) no
assert.ok(serieVerificabile('12/2026'));
assert.ok(!serieVerificabile('6664'));
assert.ok(!serieVerificabile(''));

// l'indirizzo del QR: niente dati personali, numero col trattino
assert.equal(urlVerifica('12/2026', 'abcdefghjk'), 'https://formedilpadovacpt.github.io/servizi/verifica/?n=12-2026&c=ABCDEFGHJK');
assert.equal(urlVerifica('3/2027', 'X', 'https://esempio.it/v'), 'https://esempio.it/v/?n=3-2027&c=X');

console.log('attestati-verifica: tutti i casi passano');
