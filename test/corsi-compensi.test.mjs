// Compensi degli incarichi di docenza: la tariffa proposta non è € 65
// per tutti, il forfait non si perde in un ricalcolo, e una correzione
// fatta dopo che la lettera è uscita resta scritta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forfait, calcolaCorrispettivo, tariffaDaTabella, proponiTariffa, variazioneNote, testoCompenso,
} from '../js/corsi-compensi.js';

const TARIFFE = [
  { codice: 'docenza_ora', importo: '50.00', valido_dal: '2018-01-01', valido_al: null, tecnico_id: null },
  { codice: 'conferenza_ora', importo: '50.00', valido_dal: '2020-01-01', valido_al: null, tecnico_id: null },
];

test('la conferenza di cantiere si paga la tariffa di contratto, non i 65 dei progetti', () => {
  const p = proponiTariffa({
    corso: { tipo: 'conferenza_cantiere' }, progetto: { id: 17, titolo: 'Conferenza di cantiere', finanziamento: null },
    tariffe: TARIFFE, tariffaContratto: null, tariffaDefault: 65, data: '2026-07-07',
  });
  assert.equal(p.importo, 50);
  assert.match(p.motivo, /conferenza/);
});

test('dentro un progetto finanziato NON si inventa una tariffa: vale il contratto, e il motivo avvisa', () => {
  const p = proponiTariffa({
    corso: { tipo: 'corso' }, progetto: { id: 13, titolo: 'Palestra della sicurezza', finanziamento: '200000' },
    tariffe: TARIFFE, tariffaContratto: null, tariffaDefault: 65, data: '2026-09-23',
  });
  // in archivio i progetti hanno 52, 60, 65, 90, 100 €/h: non esiste «la tariffa dei progetti»
  assert.equal(p.importo, 50);
  assert.match(p.motivo, /progetto finanziato/);
  assert.match(p.motivo, /corretta a mano/);
});

test('la formazione interna ai tecnici vale la tariffa di contratto, non i 65 dei progetti passati', () => {
  const p = proponiTariffa({
    corso: { tipo: 'corso', titolo: 'Formazione Tecnici Area Sicurezza e Salute' }, progetto: null,
    tariffe: TARIFFE, tariffaContratto: null, tariffaDefault: 65, data: '2026-09-23',
  });
  assert.equal(p.importo, 50);
});

test('il contratto del tecnico batte la tariffa generale', () => {
  const p = proponiTariffa({
    corso: { tipo: 'corso' }, progetto: null, tariffe: TARIFFE,
    tariffaContratto: 70, tariffaDefault: 65, data: '2026-09-23',
  });
  assert.equal(p.importo, 70);
  assert.match(p.motivo, /contratto/);
});

test('senza contratto e fuori progetto vale la docenza di contratto (€ 50)', () => {
  const p = proponiTariffa({
    corso: { tipo: 'corso' }, progetto: null, tariffe: TARIFFE,
    tariffaContratto: null, tariffaDefault: 65, data: '2026-09-23',
  });
  assert.equal(p.importo, 50);
});

test('una tariffa scaduta non si propone, e quella del tecnico ha la precedenza', () => {
  const t = [...TARIFFE,
    { codice: 'docenza_ora', importo: '40.00', valido_dal: '2010-01-01', valido_al: '2017-12-31', tecnico_id: null },
    { codice: 'docenza_ora', importo: '80.00', valido_dal: '2018-01-01', valido_al: null, tecnico_id: 'DM' }];
  assert.equal(tariffaDaTabella(t, 'docenza_ora', '2015-06-01'), 40);
  assert.equal(tariffaDaTabella(t, 'docenza_ora', '2026-09-23'), 50);
  assert.equal(tariffaDaTabella(t, 'docenza_ora', '2026-09-23', 'DM'), 80);
  assert.equal(tariffaDaTabella(t, 'visita_prima', '2026-09-23'), null);
});

test('il corrispettivo si calcola solo quando ci sono davvero ore e tariffa', () => {
  assert.equal(calcolaCorrispettivo(2, 65), 130);
  assert.equal(calcolaCorrispettivo(1.5, 50), 75);
  assert.equal(calcolaCorrispettivo('', 50), null);
  assert.equal(calcolaCorrispettivo(3, null), null);
});

test('il forfait è la riga col compenso ma senza il conto ore × tariffa', () => {
  assert.equal(forfait({ ore: null, tariffa_oraria: null, corrispettivo: 300 }), true);
  assert.equal(forfait({ ore: 2, tariffa_oraria: null, corrispettivo: 300 }), true);
  assert.equal(forfait({ ore: 2, tariffa_oraria: 65, corrispettivo: 130 }), false);
  assert.equal(forfait({ ore: 2, tariffa_oraria: 65, corrispettivo: null }), false);
});

test('a forfait la lettera NON scrive «per ogni ora di docenza»', () => {
  const t = testoCompenso({ nominativo: 'Rossi Ing. Mario', qualita: 'ospite', corrispettivo: 300 });
  assert.match(t, /compenso forfettario di € 300,00/);
  assert.ok(!/per ogni ora/.test(t));
});

test('a ore la lettera resta quella di sempre, col totale', () => {
  const t = testoCompenso({ nominativo: 'DE Marco Arch. Nicola', ore: 2, tariffa_oraria: 65, corrispettivo: 130 });
  assert.match(t, /per ogni ora di docenza/);
  assert.match(t, /€ 65,00/);
  assert.match(t, /complessivo per 2 ore: € 130,00/);
});

test('correggere dopo la lettera lascia scritto che cosa è cambiato', () => {
  const riga = variazioneNote(
    { ore: 2, tariffa_oraria: 65, corrispettivo: 130 },
    { ore: 3, tariffa_oraria: 50, corrispettivo: 150 },
    'cptpd@did.formedilpadova.it', '19/09/2026', 'Prot. 2570-out');
  assert.match(riga, /ore 2 → 3/);
  assert.match(riga, /tariffa € 65,00 → € 50,00/);
  assert.match(riga, /corrispettivo € 130,00 → € 150,00/);
  assert.match(riga, /Prot\. 2570-out/);
});

test('se non cambia nessun numero non si sporca la nota', () => {
  const uguale = { ore: 2, tariffa_oraria: 65, corrispettivo: 130 };
  assert.equal(variazioneNote(uguale, { ...uguale, note: 'altro' }, 'x', '19/09/2026', null), null);
});
