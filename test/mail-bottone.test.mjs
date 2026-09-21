// Il pulsante delle mail (21/09/2026). Dati INVENTATI: il repository è pubblico.
//
// Quel che questi controlli tengono fermo non è l'estetica ma le due
// ragioni per cui il pulsante è fatto così: il rilievo dev'essere un
// BORDO (Outlook per Windows ignora le ombre) e sotto al tasto
// dev'esserci sempre l'indirizzo scritto, perché qualche programma di
// posta blocca i link dentro i riquadri colorati.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bottoneMail, bloccoAzioneMail, corpoInHtml } from '../js/firma.js';

const URL_PROVA = 'https://esempio.example/app#pratica-1';

test('il rilievo è un bordo pieno, non un\'ombra', () => {
  const h = bottoneMail({ href: URL_PROVA, testo: 'Apri la pratica' });
  assert.match(h, /border-bottom:3px solid #A83A0B/);
  assert.ok(!/box-shadow/.test(h), 'in Outlook per Windows box-shadow sparisce: non va usato');
  assert.match(h, /bgcolor="#E7500F"/, 'lo sfondo va anche come attributo, per i client che ignorano lo stile');
  assert.match(h, /Apri la pratica &rarr;/);
});

test('a tutta larghezza cambia solo la misura, non la sostanza', () => {
  const h = bottoneMail({ href: URL_PROVA, testo: 'Valuta la visita', larga: true });
  assert.match(h, /width="100%"/);
  assert.match(h, /display:block/);
  assert.match(h, /border-bottom:4px solid #A83A0B/);
});

test('il blocco porta sempre l\'indirizzo scritto sotto al tasto', () => {
  const h = bloccoAzioneMail({
    titolo: 'Com\'è andata la visita?', testo: 'Un minuto del Vostro tempo.',
    href: URL_PROVA, etichetta: 'Valuta la visita',
  });
  assert.match(h, /Se il pulsante non si apre/);
  assert.ok(h.split(URL_PROVA).length - 1 >= 2, 'l\'indirizzo compare sul tasto e in chiaro');
  assert.match(h, /Com'è andata la visita\?/);
});

test('titolo e testo sono facoltativi: resta il solo tasto', () => {
  const h = bloccoAzioneMail({ href: URL_PROVA, etichetta: 'Apri' });
  assert.match(h, /Apri &rarr;/);
  assert.ok(!/<p style="margin:0 0 6px/.test(h), 'senza titolo non si disegna una riga vuota');
});

test('la riga «>>> Etichetta (nota): indirizzo» diventa il blocco', () => {
  const corpo = [
    'Egr. Direttore,', '',
    'in allegato la richiesta di autorizzazione.', '',
    '>>> Autorizza dall\'app (si apre direttamente la pratica):',
    URL_PROVA, '',
    'Distinti saluti.',
  ].join('\n');
  const h = corpoInHtml(corpo);
  assert.match(h, /Autorizza dall'app &rarr;/);
  assert.match(h, /si apre direttamente la pratica/);
  assert.match(h, /Egr\. Direttore,/);
  assert.match(h, /Distinti saluti\./);
  // l'indirizzo non resta anche come riga di testo nuda prima del blocco
  assert.ok(!/<p[^>]*>.*>&gt;&gt;&gt;/.test(h), 'il marcatore non deve comparire nell\'HTML');
});

test('un testo senza marcatore non viene interpretato', () => {
  const h = corpoInHtml('Buongiorno,\n\nvedete https://esempio.example/pagina per il dettaglio.');
  assert.ok(!/border-bottom:3px solid/.test(h), 'nessun pulsante dove non è stato chiesto');
  assert.match(h, /<a href="https:\/\/esempio\.example\/pagina"/, 'il link resta un link nel testo');
});

test('il marcatore senza nota funziona lo stesso', () => {
  const h = corpoInHtml(`>>> Apri il mandato nell'app:\n${URL_PROVA}`);
  assert.match(h, /Apri il mandato nell'app &rarr;/);
});
