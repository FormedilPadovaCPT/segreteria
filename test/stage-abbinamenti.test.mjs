// Test della lettura degli abbinamenti allievi-aziende (Word della Scuola).
// Dati INVENTATI: i nominativi veri degli allievi (in parte minorenni) non
// entrano nel repository, che e' pubblico. Le forme dei file invece sono
// quelle reali: Stanghella con le etichette, Padova nato da un .doc con
// tabelle annidate, elenco spezzato in due tabelle e niente P.IVA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leggiDocumentXml, analizzaIntestazione, analizzaAzienda, leggiAbbinamenti,
  candidatiComune, scegliComune, comuneDaElenco, pulisciIndirizzo, tecnicoDalFile,
  testoNotaIncarico, nomeFileElenco, cartellaElenco, annoScolasticoDi, chiaveNome, normNome,
  leggiModelloRighe, leggiDataCella,
} from '../js/stage-abbinamenti.js';

/* ── piccolo costruttore di XML di Word e di zip (senza compressione) ── */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&apos;');
const p = (...righe) => `<w:p>${righe.map((r, i) => `${i ? '<w:br/>' : ''}<w:r><w:t xml:space="preserve">${esc(r)}</w:t></w:r>`).join('')}</w:p>`;
const tc = (...contenuto) => `<w:tc><w:tcPr/>${contenuto.join('')}</w:tc>`;
const tr = (...celle) => `<w:tr>${celle.join('')}</w:tr>`;
const tbl = (...righe) => `<w:tbl><w:tblPr/>${righe.join('')}</w:tbl>`;
const doc = (corpo) => `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${corpo}</w:body></w:document>`;

function zip(nome, testo) {
  const dati = new TextEncoder().encode(testo);
  const nomeB = new TextEncoder().encode(nome);
  const loc = new Uint8Array(30 + nomeB.length);
  const dl = new DataView(loc.buffer);
  dl.setUint32(0, 0x04034b50, true); dl.setUint16(8, 0, true);
  dl.setUint32(18, dati.length, true); dl.setUint32(22, dati.length, true); dl.setUint16(26, nomeB.length, true);
  loc.set(nomeB, 30);
  const cen = new Uint8Array(46 + nomeB.length);
  const dc = new DataView(cen.buffer);
  dc.setUint32(0, 0x02014b50, true); dc.setUint16(10, 0, true);
  dc.setUint32(20, dati.length, true); dc.setUint32(24, dati.length, true); dc.setUint16(28, nomeB.length, true);
  dc.setUint32(42, 0, true);
  cen.set(nomeB, 46);
  const fine = new Uint8Array(22);
  const df = new DataView(fine.buffer);
  df.setUint32(0, 0x06054b50, true); df.setUint16(8, 1, true); df.setUint16(10, 1, true);
  df.setUint32(12, cen.length, true); df.setUint32(16, loc.length + dati.length, true);
  const out = new Uint8Array(loc.length + dati.length + cen.length + fine.length);
  out.set(loc, 0); out.set(dati, loc.length); out.set(cen, loc.length + dati.length); out.set(fine, loc.length + dati.length + cen.length);
  return out;
}

const INTESTAZIONE_ST = [p('ABBINAMENTO ALLIEVI - AZIENDE'), p('STAGE 2° OPERATORE EDILE 2025 - 2026 STANGHELLA'),
  p('dal 27 aprile al 27 maggio 2026'), p('dal lunedì al venerdì - 7 ore al giorno'), p('totale ore: 154 ore')].join('');

test('intestazione: classe, sede, anno scolastico, periodo e ore', () => {
  const h = analizzaIntestazione(['ABBINAMENTO ALLIEVI - AZIENDE', 'STAGE 2° OPERATORE EDILE 2025 - 2026 STANGHELLA',
    'dal 27 aprile al 27 maggio 2026', 'dal lunedì al venerdì - 7 ore al giorno', 'totale ore: 154 ore']);
  assert.equal(h.classe, 2);
  assert.equal(h.sede, 'Stanghella');
  assert.equal(h.anno_scolastico, '2025-2026');
  assert.equal(h.dal, '2026-04-27');
  assert.equal(h.al, '2026-05-27');
  assert.equal(h.ore_giorno, 7);
  assert.equal(h.ore_totali, 154);

  const a = analizzaIntestazione(['STAGE 3° OPERATORE EDILE 2024 - 2025 STANGHELLA', 'dal 30 settembre 2024 al 9 gennaio 2025']);
  assert.equal(a.dal, '2024-09-30', 'periodo a cavallo di due anni');
  assert.equal(a.al, '2025-01-09');

  const n = analizzaIntestazione(['Abbinamento ALLIEVI - AZIENDE STAGE 2^ OPERATORE EDILE 2024- 2025 PADOVA', 'Dal 10/03/2025 al 12/05/2025']);
  assert.equal(n.classe, 2);
  assert.equal(n.sede, 'Padova');
  assert.equal(n.dal, '2025-03-10', 'date numeriche');
});

test('cella azienda con le etichette (Stanghella)', () => {
  const a = analizzaAzienda(['ROSSI COSTRUZIONI SRL', 'Sede legale:', 'Via Roma, 1 – 35043 Monselice (PD)',
    'Cod. Fiscale: 01234567890', 'P.IVA: 01234567890', 'Tel: 0429-123456', 'Mail: info@rossi.example',
    'Legale rappresentante: ROSSI MARIO', 'C.F. legale rappresentante: RSSMRA70A01F382X',
    'Sede cantieri:', '1) VIA VERDI – 35043 MONSELICE (PD)', '2) VIA BIANCHI – 35040 VESCOVANA (PD)',
    'Tutor aziendale: ROSSI LUCA 340-1234567', 'Tutor formativo: BIANCHI PAOLO', 'Tutor scolastico: VERDI ANNA', 'Tecnico CPT:']);
  assert.equal(a.ragione_sociale, 'ROSSI COSTRUZIONI SRL');
  assert.equal(a.partita_iva, '01234567890');
  assert.equal(a.sede, 'Via Roma, 1 - 35043 Monselice (PD)');
  assert.equal(a.email, 'info@rossi.example');
  assert.equal(a.legale_rappresentante, 'ROSSI MARIO');
  assert.equal(a.cf_legale_rappresentante, 'RSSMRA70A01F382X');
  assert.deepEqual(a.cantieri, ['VIA VERDI - 35043 MONSELICE (PD)', 'VIA BIANCHI - 35040 VESCOVANA (PD)']);
  assert.deepEqual(a.tutor_aziendale, { nome: 'ROSSI LUCA', telefono: '340-1234567' });
  assert.equal(a.tutor_scuola, 'VERDI ANNA');
});

test('cella azienda della stampa unione (Padova): citta, telefono e mail sulla riga del nome', () => {
  const a = analizzaAzienda(["NERI COSTRUZIONI DI NERI ALDO FOSSO' (VE) 339 1234567 neri@example.it", 'via Breo 48', "FOSSO' (VE)",
    'Legale rappresentante NERI ALDO', "Sedi cantiere: via Piove 31 Fiesso D'Artico (VE)",
    'Tutor aziendale NERI ALDO 339 1234567', 'Tutor formativo Bianchi Paolo', 'Tutor Scuola: Verdi Anna']);
  assert.equal(a.ragione_sociale, 'NERI COSTRUZIONI DI NERI ALDO');
  assert.equal(a.partita_iva, null);
  assert.equal(a.email, 'neri@example.it');
  assert.deepEqual(a.cantieri, ["via Piove 31 Fiesso D'Artico (VE)"]);
  assert.equal(a.tutor_scuola, 'Verdi Anna');

  const b = analizzaAzienda(['ALFA S.A.S.', 'VIA DEGLI ALPINI 5 ALBIGNASEGO (PD) -', 'Legale rappresentante: ORSI LUIGI', "Cantieri: VIA CA' BRUSA' 2B - 35025 CARTURA (PD)"]);
  assert.equal(b.legale_rappresentante, 'ORSI LUIGI', 'l\'etichetta «Cantieri:» chiude il legale rappresentante');
  assert.equal(b.cantieri.length, 1);

  const c = analizzaAzienda(['BETA SRL', 'Cod. Fiscale:', 'Legale Rappresentante: GIALLI ELENA', 'P.IVA: 09876543210']);
  assert.equal(c.codice_fiscale, null, 'un CF vuoto non si prende pezzi della riga dopo');
  assert.equal(c.partita_iva, '09876543210');
});

test('Word di Padova: tabelle annidate, elenco spezzato in due tabelle', async () => {
  const xml = doc(
    p('ABBINAMENTO ALLIEVI - AZIENDE') + p('STAGE 2° OPERATORE EDILE 2025 - 2026 PADOVA') + p('dal 27 APRILE 2026 al 27 MAGGIO 2026') +
    tbl(
      tr(tc(p('Nominativo corsista')), tc(p('Azienda')), tc(p('Orario di Presenza Aziendale')), tc(p('TECNICO'))),
      tr(tc(tbl(tr(tc(p('ALFA')), tc(p('UNO'))))), tc(p('GAMMA SRL'), p('via Roma 1 Padova'), p('Sedi cantiere:'), p('via Tunisi Padova')), tc(p('8,00-12,00')), tc(p('CAMUFFO'))),
    ) + p('') +
    tbl(tr(tc(p('BETA'), p('DUE')), tc(p('DELTA SRL'), p("Sedi cantiere: VIA ROMA, 32 - 35040 VESCOVANA (PD)")), tc(p('7.30-12.00')), tc(p('VISINTINI')))),
  );
  const letto = await leggiAbbinamenti(zip('word/document.xml', xml));
  assert.equal(letto.intestazione.sede, 'Padova');
  assert.equal(letto.righe.length, 2, 'la seconda tabella non si perde');
  assert.equal(letto.righe[0].allievo, 'ALFA UNO', 'nome e cognome in celle annidate');
  assert.equal(letto.righe[0].tecnico_file, 'CAMUFFO');
  assert.equal(letto.righe[1].allievo, 'BETA DUE');
  assert.equal(letto.righe[1].azienda.ragione_sociale, 'DELTA SRL');
});

test('Word di Stanghella senza colonna TECNICO', async () => {
  const xml = doc(INTESTAZIONE_ST + tbl(
    tr(tc(p('NOMINATIVO ALLIEVO')), tc(p('DATI DELL’AZIENDA')), tc(p('ORARIO DI PRESENZA'))),
    tr(tc(p('ROSSI ANNA')), tc(p('ROSSI COSTRUZIONI SRL'), p('P.IVA: 01234567890'), p('Sede cantieri:'), p('1) VIA VERDI – 35043 MONSELICE (PD)')), tc(p('08.00 – 12.00', '14.00 – 17.00'))),
  ));
  const letto = await leggiAbbinamenti(zip('word/document.xml', xml));
  assert.equal(letto.righe.length, 1);
  assert.equal(letto.righe[0].tecnico_file, null);
  assert.equal(letto.righe[0].orario, '08.00 - 12.00; 14.00 - 17.00');
  assert.equal(letto.righe[0].azienda.partita_iva, '01234567890');
});

test('un file che non e un Word si rifiuta con un messaggio chiaro', async () => {
  await assert.rejects(() => leggiAbbinamenti(new TextEncoder().encode('%PDF-1.7 non sono un docx')), /Word/);
  await assert.rejects(() => leggiAbbinamenti(zip('word/document.xml', doc(p('solo testo')))), /tabella/);
});

test('i codici della stampa unione non entrano nel testo', () => {
  const xml = doc(tbl(tr(tc('<w:p><w:r><w:instrText> MERGEFIELD "azienda" </w:instrText></w:r><w:r><w:t>ZETA SRL</w:t></w:r></w:p>'))));
  assert.deepEqual(leggiDocumentXml(xml).tabelle[0][0][0], ['ZETA SRL']);
});

test('comune del cantiere dall\'indirizzo', () => {
  const comuni = [
    { nome: "Fiesso d'Artico", prov: 'VE' }, { nome: 'Dolo', prov: 'VE' }, { nome: 'Monselice', prov: 'PD' },
    { nome: 'Casale di Scodosia', prov: 'PD' }, { nome: 'Solesino', prov: 'PD' }, { nome: 'Mira', prov: 'VE' },
    { nome: 'Vigonza', prov: 'PD' }, { nome: 'Valdastico', prov: 'VI' },
  ];
  const c = (t) => scegliComune(candidatiComune(t), comuni)?.nome || null;
  assert.equal(c("via Piove 31 Fiesso D'Artico (VE)"), "Fiesso d'Artico");
  assert.equal(c('VIA NICOLO\' DE CONTI – 35043 MONSELICE (PD)'), 'Monselice');
  assert.equal(c('VIA CAZZAGHETTO 89 ARINO DI DOLO 30031 (VE)'), 'Dolo', 'il nome prima del CAP');
  assert.equal(c('PIAZZA GIACOMO MATTEOTTI, 1 - 35040 CASALE DI SCODOSIA (PD)'), 'Casale di Scodosia');
  assert.equal(c('VIA XX SETTEMBRE, 236 - 35047 SOLESINO'), 'Solesino', 'CAP senza provincia');
  assert.equal(c('Via Giare 172 Mira (VE) (PD)'), 'Mira');
  assert.equal(c('Via Aldo Moro 11/13 Busa di Vigonza (PD)-Via Garibaldi 29'), 'Vigonza');
  assert.equal(c('via Tunisi Padova (zona Arcella)'), null);
  assert.equal(comuneDaElenco('via Tunisi Padova (zona Arcella)', ['PADOVA', 'PADOVA - Q3 Est', 'VIGONZA']), 'PADOVA', 'ultima risorsa: le zone');
});

test('via e civico senza CAP, citta e provincia', () => {
  assert.equal(pulisciIndirizzo("VIA NICOLO' DE CONTI - 35043 MONSELICE (PD)", 'MONSELICE'), "VIA NICOLO' DE CONTI");
  assert.equal(pulisciIndirizzo('Via Aldo Moro 11/13 Busa di Vigonza (PD)', 'VIGONZA'), 'Via Aldo Moro 11/13');
  assert.equal(pulisciIndirizzo('Via delle Tine, 1-2-3 - 44022 Comacchio (FE)', 'COMACCHIO'), 'Via delle Tine, 1-2-3');
  assert.equal(pulisciIndirizzo('via Tunisi Padova (zona Arcella)', 'PADOVA'), 'via Tunisi');
  assert.equal(pulisciIndirizzo('VIA ROMA, 32 - 35040 VESCOVANA (PD)', 'VESCOVANA'), 'VIA ROMA, 32');
});

test('tecnico dalla colonna del file, anche scritto male', () => {
  const tecnici = [
    { email: 'caon@x', tecnico_cognome: 'Caon' }, { email: 'demarco@x', tecnico_cognome: 'De Marco' },
    { email: 'visentini@x', tecnico_cognome: 'Visentini' }, { email: 'camuffo@x', tecnico_cognome: 'Camuffo' },
    { email: 'canova@x', tecnico_cognome: 'Canova' },
  ];
  assert.equal(tecnicoDalFile('CAON', tecnici), 'caon@x');
  assert.equal(tecnicoDalFile('DE MARCO', tecnici), 'demarco@x');
  assert.equal(tecnicoDalFile('VISINTINI', tecnici), 'visentini@x', 'refuso nel file');
  assert.equal(tecnicoDalFile('NESSUNO', tecnici), null);
  assert.equal(tecnicoDalFile('', tecnici), null);
  assert.equal(tecnicoDalFile('Tecnico CPT: CAMUFFO', tecnici), 'camuffo@x');
});

test('la nota dell\'incarico: la prima riga e\' quella che legge la relazione allo stagista', () => {
  const h = { classe: 2, sede: 'Padova', anno_scolastico: '2025-2026', dal: '2026-04-27', al: '2026-05-27', ore_giorno: 7 };
  const nota = testoNotaIncarico(h, { orario: '8-12; 13-16', tutor: 'ROSSI LUCA', tutor_tel: '340 1', tutor_scuola: 'Verdi Anna', cantieri: ['a', 'b'] }, '2026-04-28');
  // la stessa espressione di stage-relazione.js (gestionale visite)
  const m = nota.match(/stage\s+(dal\s+[^,;\n]+?)(?=\s{2,}|[,;\n]|$)/i);
  assert.equal(m?.[1], 'dal 27/04/2026 al 27/05/2026');
  assert.match(nota, /Tutor aziendale: ROSSI LUCA 340 1/);
  assert.match(nota, /Sedi di cantiere: 1\) a; 2\) b/);
  assert.match(nota, /arrivato il 28\/04\/2026/);
});

test('nomi a convenzione del vault e anno scolastico', () => {
  const h = { classe: 3, sede: 'Stanghella', anno_scolastico: '2026-2027' };
  assert.equal(nomeFileElenco(h, '2026-10-09'), '2026_10_09_ELEN_Formedil-Padova_abbinamento-allievi-aziende-stage-3-OE-Stanghella-2026-2027.docx');
  assert.equal(cartellaElenco('2026-04-29'), '2026 04 29 STAGE');
  assert.equal(annoScolasticoDi('2026-09-10'), '2026-2027');
  assert.equal(annoScolasticoDi('2026-04-28'), '2025-2026');
});

test('modello Excel: dati elenco e allievi, colonne riconosciute dal titolo', () => {
  const elenco = [
    ['Campo', 'Valore', 'Come compilarlo'],
    ['Sede', 'Stanghella', ''], ['Classe', '3', ''], ['Anno scolastico', '2026-2027', ''],
    ['Stage dal', '2026-10-12', ''], ['Stage al', '09/12/2026', ''], ['Ore al giorno', '8', ''],
    ['Tutor scuola', 'Verdi Anna', ''], ['Tutor formativo', 'Bianchi Paolo', ''], ['Note', '', ''],
  ];
  const allievi = [
    // colonne in ordine diverso dal modello: si riconoscono dal titolo
    ['Ragione sociale impresa', 'Cognome allievo', 'Nome allievo', 'Partita IVA impresa', 'Cantiere via', 'Cantiere civico',
      'Cantiere comune', 'Cantiere provincia', 'Altri cantieri', 'Tutor aziendale', 'Telefono tutor', 'Orario in azienda', 'Note'],
    ['EDILE ESEMPIO SRL', 'Rossi', 'Marco', '01234567890', 'Via Roma', '12', 'Monselice', 'pd', 'Via Verdi 3, Este (PD); Via Po 1, Solesino (PD)', 'Bianchi Luca', '340 1234567', 'lun-ven 8-12 / 13-17', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['ALTRA SRL', 'Neri', 'Sara', '123', '', '', '', '', '', '', '', '', 'cantiere da definire'],
  ];
  const r = leggiModelloRighe(elenco, allievi);
  assert.deepEqual(
    { sede: r.intestazione.sede, classe: r.intestazione.classe, anno: r.intestazione.anno_scolastico, dal: r.intestazione.dal, al: r.intestazione.al, ore: r.intestazione.ore_giorno },
    { sede: 'Stanghella', classe: 3, anno: '2026-2027', dal: '2026-10-12', al: '2026-12-09', ore: 8 },
  );
  assert.equal(r.righe.length, 2, 'la riga vuota si salta');
  const [a, b] = r.righe;
  assert.equal(a.allievo, 'ROSSI MARCO');
  assert.equal(a.azienda.partita_iva, '01234567890');
  assert.deepEqual(a.cantiere, { via: 'Via Roma', civico: '12', comune: 'Monselice', prov: 'PD' });
  assert.deepEqual(a.azienda.cantieri, ['Via Roma 12 - Monselice (PD)', 'Via Verdi 3, Este (PD)', 'Via Po 1, Solesino (PD)']);
  assert.deepEqual(a.azienda.tutor_aziendale, { nome: 'Bianchi Luca', telefono: '340 1234567' });
  assert.equal(a.azienda.tutor_scuola, 'Verdi Anna', 'dal foglio Dati elenco');
  assert.equal(a.azienda.tutor_formativo, 'Bianchi Paolo');
  assert.equal(a.avvisi.length, 0);
  assert.equal(b.azienda.partita_iva, null, 'P.IVA sbagliata non si usa');
  assert.ok(b.avvisi.some((x) => /non valida/.test(x)));
  assert.ok(b.avvisi.some((x) => /Comune/.test(x)));
});

test('modello Excel: senza le colonne del modello si rifiuta', () => {
  assert.throws(() => leggiModelloRighe([], [['Colonna A', 'Colonna B'], ['x', 'y']]), /colonne del modello/);
});

test('date delle celle', () => {
  assert.equal(leggiDataCella('2026-04-27'), '2026-04-27');
  assert.equal(leggiDataCella('27/04/2026'), '2026-04-27');
  assert.equal(leggiDataCella('7.5.26'), '2026-05-07');
  assert.equal(leggiDataCella(''), null);
  assert.equal(leggiDataCella('domani'), null);
});

test('ricerca dell\'impresa per nome', () => {
  assert.equal(chiaveNome('Impresa edile Bortolotto Stefano s.r.l.'), 'bortolotto');
  assert.equal(normNome('VETTORAZZO COSTRUZIONI S.R.L.'), normNome('Vettorazzo Costruzioni srl'));
});
