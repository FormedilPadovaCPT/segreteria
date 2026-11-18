// La mail «Iscrizione confermata» col codice per firmare (18/11/2026, eccezione 13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testoConfermaIscrizione } from '../js/corsi-promemoria-testo.js';

const corso = { id: 332, titolo: 'L’attività ispettiva nei cantieri edili', sede: 'Aula magna' };
const giornate = [{ id: 1, data: '2026-12-15', dalle: '09:30', alle: '12:00' }];

test('a una persona: il suo codice in grande, data, sede, e niente scritto a mano', () => {
  const t = testoConfermaIscrizione({ corso, giornate, partecipanti: [{ nominativo: 'VERDI ANNA', origine: 'iscrizione', codice: 'K7PQR' }], contatto: 'cpt@formedilpadova.it', promemoria: true });
  assert.match(t.oggetto, /^Iscrizione confermata - L’attività ispettiva nei cantieri edili - martedì 15 dicembre 2026 - il suo codice per la firma$/);
  assert.match(t.corpo, /^Gentile VERDI ANNA,/);
  assert.match(t.corpo, /le confermiamo l’iscrizione/);
  assert.match(t.corpo, /IL SUO CODICE PER LA FIRMA DI PRESENZA:\s+K7PQR/);
  assert.match(t.corpo, /\*\*Dove:\*\* Aula magna/);
  assert.match(t.corpo, /riceverà un promemoria con lo stesso codice/);
  assert.ok(t.firmaHtml.includes('K7PQR'), 'il riquadro arancione col codice');
  assert.doesNotMatch(t.corpo, /gratuit/i, 'mai «gratuito» a stima');
});

test('a un referente: un elenco coi codici di ciascuno, e il promemoria solo se c’è', () => {
  const t = testoConfermaIscrizione({ corso, giornate, partecipanti: [
    { nominativo: 'ROSSI MARIO', origine: 'impresa', codice: 'AAAAA' }, { nominativo: 'BIANCHI LUCA', origine: 'impresa', codice: 'BBBBB' }] });
  assert.match(t.corpo, /^Buongiorno,/);
  assert.match(t.corpo, /- ROSSI MARIO:\s+AAAAA/);
  assert.match(t.corpo, /- BIANCHI LUCA:\s+BBBBB/);
  assert.match(t.oggetto, /i codici per la firma$/);
  assert.doesNotMatch(t.corpo, /promemoria/);
});

test('la copia nella funzione del server è identica al file della webapp', () => {
  const a = readFileSync(new URL('../js/corsi-promemoria-testo.js', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../supabase/functions/promemoria-corsi/corsi-promemoria-testo.js', import.meta.url), 'utf8');
  assert.equal(a.replace(/\r\n/g, '\n'), b.replace(/\r\n/g, '\n'));
});

test('l’app manda la conferma solo fuori dalla sala, e legge l’esito', () => {
  const js = readFileSync(new URL('../js/corsi-iscrizioni.js', import.meta.url), 'utf8');
  assert.match(js, /if \(r\.in_sala\) await scriviPresenzaSala\(r\.id\);\s+else await mandaConferma\(r\.id\);/);
  assert.match(js, /functions\.invoke\('promemoria-corsi', \{ body: \{ conferma_iscrizione: id \} \}\)/);
  assert.match(js, /la mail di conferma NON è partita/);
});
