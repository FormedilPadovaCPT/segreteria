// La lettera di affiancamento dei tecnici nuovi (21/10/2026, dalla mail del Direttore del 20/10):
// testo con FORMEDIL PADOVA e mai «la Scuola», firma del Direttore poi del tecnico per accettazione,
// protocollo in uscita col testo intero nelle note, PDF nella cartella del tecnico. Girano con `node --test test/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  tecnicoVero, nominativo, elenco, periodo, testoLettera, testoPerProtocollo, nomeFile, cartellaTecnico, rifAffiancamento,
} from '../js/lettera-affiancamento-regole.js';

const SIMONETTO = { tecnico_id: 'a', titolo: 'Ing.', tecnico_nome: 'Claudio', tecnico_cognome: 'Simonetto', email: 'claudio.simonetto@did.formedilpadova.it', attivo: true };
const BORDINA = { tecnico_id: 'b', titolo: null, tecnico_nome: 'Amedeo', tecnico_cognome: 'Bordina', email: 'amedeo.bordina@did.formedilpadova.it', attivo: true };
const DE_MARCO = { tecnico_id: 'c', titolo: 'Arch.', tecnico_nome: 'Nicola', tecnico_cognome: 'De Marco', email: 'nicola.demarco@did.formedilpadova.it', attivo: true };
const CAON = { tecnico_id: 'd', titolo: null, tecnico_nome: 'Franco', tecnico_cognome: 'Caon', email: 'franco.caon@did.formedilpadova.it', attivo: true };
const mod = fs.readFileSync(new URL('../js/lettera-affiancamento.js', import.meta.url), 'utf8');
const pdf = fs.readFileSync(new URL('../js/lettera-affiancamento-pdf.js', import.meta.url), 'utf8');

test('l\'ente è FORMEDIL PADOVA, mai «la Scuola»', () => {
  const t = testoLettera({ affiancato: SIMONETTO, tutori: [DE_MARCO, CAON], dal: '2026-11-02' });
  const tutto = testoPerProtocollo(t);
  assert.ok(!/scuola/i.test(tutto), tutto);
  assert.ok(tutto.includes('a nome di FORMEDIL PADOVA dai tecnici Arch. Nicola De Marco e Franco Caon'));
});

test('i quattro punti del Direttore ci sono tutti', () => {
  const t = testoPerProtocollo(testoLettera({ affiancato: SIMONETTO, tutori: [DE_MARCO], dal: '2026-11-02', al: '2026-11-30' }));
  assert.ok(t.includes('dal 02/11/2026 al 30/11/2026'));
  assert.ok(/fini di formazione/.test(t));
  assert.ok(/normative di sicurezza/.test(t) && /disposizioni impartite dal tecnico a cui è affiancato/.test(t));
  assert.ok(/privacy/.test(t) && /segretezza professionale/.test(t));
  assert.ok(/copertura assicurativa/.test(t));
  assert.ok(/controfirmata per accettazione/.test(t));
  assert.ok(t.includes('dal tecnico Arch. Nicola De Marco, al quale'), 'singolare con un solo tecnico');
});

test('«del tecnico Ing. …», mai «il Ing.»; senza titolo solo il nome', () => {
  const t = testoPerProtocollo(testoLettera({ affiancato: BORDINA, tutori: [CAON], dal: '2026-11-02' }));
  assert.ok(t.includes('del tecnico Amedeo Bordina, a partire dal 02/11/2026,'));
  assert.ok(!/\bil (Ing|Arch|Geom)\./.test(testoPerProtocollo(testoLettera({ affiancato: SIMONETTO, tutori: [CAON], dal: '2026-11-02' }))));
});

test('senza affiancato o senza tecnici che affiancano non si scrive niente', () => {
  assert.throws(() => testoLettera({ affiancato: null, tutori: [CAON] }), /affiancato/);
  assert.throws(() => testoLettera({ affiancato: SIMONETTO, tutori: [] }), /almeno un tecnico/);
});

test('nome del file, cartella e riferimento della firma', () => {
  assert.equal(nomeFile('2026-10-21', DE_MARCO, 'Prot_26-27_0041'), '2026_10_21_INC_Formedil-Padova_affiancamento-visite_De-Marco-Nicola_Prot_26-27_0041.pdf');
  assert.equal(nomeFile('2026-10-21', SIMONETTO, 'Prot_26-27_0041', true), '2026_10_21_INC_Formedil-Padova_affiancamento-visite_Simonetto-Claudio_Prot_26-27_0041_firmata.pdf');
  assert.equal(cartellaTecnico(BORDINA), '2_AREE/Team_Tecnici/Amedeo_Bordina');
  assert.equal(rifAffiancamento('a'), 'affiancamento:a');
  assert.equal(elenco(['A', 'B', 'C']), 'A, B e C');
  assert.equal(periodo('', ''), '');
  assert.equal(nominativo(SIMONETTO), 'Ing. Claudio Simonetto');
});

test('la segreteria e il tecnico di prova non sono tecnici da affiancare', () => {
  assert.equal(tecnicoVero(SIMONETTO), true);
  assert.equal(tecnicoVero({ ...SIMONETTO, email: 'cpt@formedilpadova.it' }), false);
  assert.equal(tecnicoVero({ ...SIMONETTO, tecnico_id: 'TEC-PROVA-2026' }), false);
  assert.equal(tecnicoVero({ ...SIMONETTO, attivo: false }), false);
});

test('firma a catena: prima il Direttore, poi il tecnico per accettazione; protocollo OUT col testo nelle note', () => {
  const iD = mod.indexOf("ruolo: 'direttore'"), iT = mod.indexOf("ruolo: 'incaricato'");
  assert.ok(iD > 0 && iD < iT, 'Direttore prima del tecnico');
  assert.ok(/direzione: 'OUT'/.test(mod) && /note: testoPerProtocollo\(testo\)/.test(mod));
  assert.ok(/intestazione\(pagina, m\)/.test(pdf) && !/from '\.\/core\.js'/.test(pdf), 'carta intestata delle nomine, PDF senza core.js');
  assert.ok(/scaricaEml\(/.test(mod) && !/send-protocollo|invia\(/.test(mod), 'la mail la manda una persona');
});
