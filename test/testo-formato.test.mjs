// Il testo delle mail reso in HTML (25/09/2026). Dati INVENTATI: il repository è pubblico.
//
// Quello che questi controlli tengono fermo: gli a capo e i paragrafi
// escono come <p> e <br>, MAI con white-space:pre-line (Outlook per
// Windows la ignora e appiattisce tutto su una riga); gli elenchi
// scritti con «- » e «1. » diventano elenchi veri; **grassetto** e
// _corsivo_ funzionano solo a inizio/fine parola, così un indirizzo con
// il trattino basso o una moltiplicazione restano come sono.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testoInHtml } from '../js/firma.js';

test('riga vuota = paragrafo, a capo semplice = <br>', () => {
  const h = testoInHtml('Prima riga\nseconda riga\n\nSecondo paragrafo');
  assert.equal((h.match(/<p /g) || []).length, 2);
  assert.match(h, /Prima riga<br>\nseconda riga<\/p>/);
  assert.match(h, /<p [^>]*>Secondo paragrafo<\/p>/);
  assert.ok(!/white-space/.test(h), 'Outlook ignora white-space: gli a capo devono essere <br>');
});

test('più righe vuote non fanno paragrafi vuoti, e gli spazi in coda spariscono', () => {
  const h = testoInHtml('Uno   \n\n\n\nDue');
  assert.equal((h.match(/<p /g) || []).length, 2);
  assert.ok(!/<p [^>]*><\/p>/.test(h));
});

test('«- » e «• » fanno un elenco puntato, «1. » e «1) » uno numerato', () => {
  const h = testoInHtml('Vi chiediamo:\n- il DVR aggiornato\n• il POS\n\n1. prima cosa\n2) seconda cosa\nGrazie.');
  assert.equal((h.match(/<ul /g) || []).length, 1);
  assert.equal((h.match(/<ol /g) || []).length, 1);
  assert.equal((h.match(/<li /g) || []).length, 4);
  assert.match(h, /<li [^>]*>il DVR aggiornato<\/li>/);
  assert.match(h, /<li [^>]*>seconda cosa<\/li>/);
  assert.match(h, /<\/ol>\n<p [^>]*>Grazie\.<\/p>/, 'la riga dopo l\'elenco è un paragrafo nuovo');
  assert.ok(!/- il DVR/.test(h), 'il trattino non resta nel testo');
});

test('una riga rientrata continua la voce di elenco', () => {
  const h = testoInHtml('- voce lunga\n  che continua\n- altra');
  assert.match(h, /<li [^>]*>voce lunga<br>\nche continua<\/li>/);
});

test('grassetto e corsivo, solo a inizio e fine parola', () => {
  assert.match(testoInHtml('Entro il **30 settembre** e non oltre'), /<strong>30 settembre<\/strong>/);
  assert.match(testoInHtml('un termine _perentorio_.'), /<em>perentorio<\/em>\./);
  assert.match(testoInHtml('un termine *perentorio*, dunque'), /<em>perentorio<\/em>,/);
  const email = testoInHtml('scrivete a mario_rossi_bianchi@esempio.example grazie');
  assert.ok(!/<em>/.test(email), 'il trattino basso dentro un indirizzo non è corsivo');
  assert.match(email, /mailto:mario_rossi_bianchi@esempio\.example/);
  assert.ok(!/<em>/.test(testoInHtml('2 * 3 * 4 = 24')), 'gli asterischi di una moltiplicazione restano');
  assert.ok(!/<strong>/.test(testoInHtml('** non è grassetto **')));
});

test('«**grassetto**» a inizio riga non è una voce di elenco', () => {
  const h = testoInHtml('**Attenzione** alla scadenza');
  assert.ok(!/<ul/.test(h));
  assert.match(h, /<p [^>]*><strong>Attenzione<\/strong> alla scadenza<\/p>/);
});

test('il testo resta testo: niente HTML iniettabile', () => {
  const h = testoInHtml('<script>x</script> e a < b');
  assert.ok(!/<script>/.test(h));
  assert.match(h, /&lt;script&gt;/);
});

test('stile su misura per le lettere con carattere proprio', () => {
  const h = testoInHtml('Riga', { font: 'Georgia', colore: '#000', interlinea: '1.6' });
  assert.match(h, /font-family:Georgia;font-size:14px;line-height:1\.6;color:#000;/);
});
