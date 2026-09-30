// Prova del RIEPILOGO ATTIVITÀ DA FATTURARE con il modulo vero dell'app (js/fatture-tecnici-doc.js):
// lo compone su mesi finti di varia lunghezza e dice quante pagine escono. Nata il 30/09/2026, quando
// il riepilogo di 16 visite andava in seconda pagina per la sola firma.
//
//   cd strumenti/prova-riepilogo
//   node --import ./registra.mjs prova.mjs              conta le pagine (esce con errore se un caso non torna)
//   node --import ./registra.mjs prova.mjs --pdf <dir>  salva anche i PDF, per guardarli
//
// pdf-lib nel browser arriva da un CDN: qui ganci.mjs lo prende da strumenti/node_modules (npm install in strumenti/).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..').split(path.sep).join('/');
const modulo = `${APP}/js/fatture-tecnici-doc.js`;
const uscita = process.argv[2] === '--pdf' ? (process.argv[3] || '.') : null;
const fetchVero = globalThis.fetch;
globalThis.fetch = async (u, ...r) => {
  if (String(u) === 'img/logo.png') { const b = fs.readFileSync(`${APP}/img/logo.png`); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
  return fetchVero(u, ...r);
};
console.log = ((l) => (...a) => { if (!String(a[0]).startsWith('[cdn]')) l(...a); })(console.log);

const { pdfRiepilogo } = await import(pathToFileURL(modulo).href);

const IMPRESE = ['ICM S.P.A.', 'COSTRUZIONI EDILI SARTORATO SRL', 'BARZON COSTRUZIONI GENERALI S.R.L.', 'PREARO COSTRUZIONI S.R.L.', 'Venice Costruzioni restauri srl', 'RUFFATO MARIO S.R.L.', 'FRANCESCHINI F.LLI S.N.C.', 'Costruzioni edili Rossi Andrea'];
function visite(perAccesso, tipo = 'visita_prima') {
  const out = []; let n = 860;
  for (const [acc, quante] of perAccesso) for (let i = 0; i < quante; i++) {
    n++;
    out.push({ tipo, data: `2026-09-${String(1 + (n % 28)).padStart(2, '0')}`, impresa: IMPRESE[n % IMPRESE.length], stage: false,
      accesso_n: String(1 + (n % 12)), nr_verbale: `CPT/25_26/0${n}`, rlst: n % 6 === 0, importo: 100, tariffa_unitaria: 100, tipo_accesso: acc, cantiere_id: 'c' + n });
  }
  return out;
}
const altre = (k) => Array.from({ length: k }, (_, i) => ({ tipo: i ? 'asseverazione' : 'docenza', data: '2026-09-23', descrizione: i ? 'Pratica P 2026/0' + i + ' — impresa di prova, giornate registrate' : 'Corso n° 203 — Formazione Tecnici Area Sicurezza e Salute', quantita: i ? 1.5 : 4, unita: i ? 'giorno' : 'ora', tariffa_unitaria: i ? 320 : 50, importo: i ? 480 : 200 }));
const lordo = (n, f) => Math.round(n * (1 + f.cassa_pct / 100) * (1 + f.iva_pct / 100) * 100) / 100;
function dati(nome, prest, fisc, note) {
  const tot = prest.reduce((s, r) => s + r.importo, 0);
  const vis = prest.filter((r) => r.tipo.startsWith('visita_'));
  return { tecnico: nome, prestazioni: prest, fisc, rlstPct: vis.length ? Math.round(vis.filter((r) => r.rlst).length / vis.length * 100) : 0, rlstMinimo: 20,
    totNetto: tot, totLordo: lordo(tot, fisc), cantieriVisitati: vis.length, note, arretrate: 0 };
}
const ORD = { regime: 'ordinario', cassa_pct: 4, iva_pct: 22 }; const FORF = { regime: 'forfettario', cassa_pct: 4, iva_pct: 0 };
const inc = (ass) => ({ id: 931, anno: 2026, mese: 9, area_zona: 53, cantieri_assegnati: ass, altro: 0 });
const prot = { id: 4764, codice: '2601-out', numero: 2601, direzione: 'OUT', data_prot: '2026-09-30' };

/* nome, incarico, dati, pagine attese */
const CASI = [
  ['de-marco-16', inc(16), dati('De Marco Arch. Nicola', visite([[5, 2], [8, 12], [7, 2]]), FORF, ''), 1],
  ['de-marco-16-piu-3-altre', inc(16), dati('De Marco Arch. Nicola', [...visite([[5, 2], [8, 12], [7, 2]]), ...altre(3)], FORF, ''), 1],
  ['visentini-31', inc(30), dati('Visentini Arch. Tommaso', visite([[5, 19], [8, 10], [7, 2]]), ORD, ''), 1],
  ['caon-16-con-nota', inc(20), dati('Caon P.I. Franco', visite([[5, 16]]), ORD, 'Nota della segreteria: il verbale 0913 è stato importato senza la tipologia di visita, come scritto sul modulo. Una seconda riga di nota per vedere come va a capo quando il testo è lungo e supera la larghezza della pagina.'), 1],
  ['mese-pieno-40', inc(40), dati('Camuffo Arch. Marco', visite([[5, 25], [8, 9], [7, 4], [4, 2]]), ORD, ''), 2],
  ['mese-pienissimo-60', inc(60), dati('Camuffo Arch. Marco', [...visite([[5, 40], [8, 12], [7, 8]]), ...altre(2)], ORD, ''), 2],
  ['due-tipi-24', inc(24), dati('Visentini Arch. Tommaso', [...visite([[5, 18], [7, 2]]), ...visite([[9, 4]], 'visita_stage')], ORD, ''), 1],
  ['solo-docenza', inc(0), dati('De Marco Arch. Nicola', altre(1), FORF, ''), 1],
];
const { PDFDocument } = await import(pathToFileURL(`${APP}/strumenti/node_modules/pdf-lib/dist/pdf-lib.esm.js`).href);
let sbagliati = 0;
for (const [nome, i, d, attese] of CASI) {
  const byte = await pdfRiepilogo(i, prot, d);
  const pagine = (await PDFDocument.load(byte)).getPageCount();
  if (uscita) fs.writeFileSync(path.join(uscita, nome + '.pdf'), byte);
  const ok = pagine === attese;
  if (!ok) sbagliati++;
  console.log(`${ok ? 'OK     ' : 'DIVERSO'} ${nome.padEnd(26)} pagine: ${pagine}${ok ? '' : ` (attese ${attese})`}   ${d.prestazioni.length} righe`);
}
if (sbagliati) { console.log(`
${sbagliati} casi non tornano`); process.exitCode = 1; }
