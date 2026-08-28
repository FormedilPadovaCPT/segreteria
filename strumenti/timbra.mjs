#!/usr/bin/env node
/* ============================================================
   Timbra un PDF da riga di comando, con LO STESSO timbro della
   webapp: il disegno arriva da ../js/timbro-disegno.js, che non
   carica niente e si fa passare le librerie dall'esterno. Qui
   gliele passiamo da npm, nel browser arrivano dal CDN.

   Perche' esiste: serve a timbrare in automatico un documento
   appena protocollato, e a **ritimbrare oggi un documento
   vecchio col numero e la data di allora** — che e' l'unica
   forma di ristampa chiesta dall'ufficio.

   I dati del protocollo si passano da fuori (--dati o --json),
   non li legge dal database: cosi' lo strumento fa una cosa
   sola, non ha bisogno di credenziali e si puo' provare offline.

   Il PDF originale NON viene toccato: il timbrato si affianca
   (regola d'oro 6 — l'originale si conserva).

   Uso
   ---
     node timbra.mjs --pdf <file.pdf> --json <protocollo.json> [opzioni]
     node timbra.mjs --pdf <file.pdf> --dati '{"numero":2554,...}'

   Opzioni
     --stile blocco            (predefinito) riquadro 200x66 sulla
                               prima pagina: numero, data, QR e i
                               riferimenti in corpo minuscolo
     --stile minimo            riquadro 140x46: solo ente, numero,
                               data e QR, per quando lo spazio e' poco
     --stile striscia          fascia verticale sul bordo di ogni pagina
     --dove auto               cerca da solo un punto bianco della
                               pagina e ci mette il timbro
     --dove alto-sinistra      oppure alto-destra, basso-sinistra,
                               basso-destra, centro
     --dove 120,600            oppure le coordinate in punti PDF,
                               misurate dall'angolo in basso a sinistra
     --out <file.pdf>          dove scrivere; se manca, accanto
                               all'originale con il codice in coda
     --forza                   timbra anche i tipi che non lo
                               vogliono (gli attestati)

   Campi del protocollo che il timbro usa: numero, esercizio,
   direzione, data_prot, oggetto, impresa_nome, persona, alla_ca,
   mezzo, data_doc, ufficio, cartella, referente, tipo_doc_txt.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import qrcode from 'qrcode-generator';

import { applicaTimbro, misuraTimbro } from '../js/timbro-disegno.js';
import { trovaSpazio, angolo, ANGOLI } from './trova-spazio.mjs';
import { codiceProtocollo, siglaProtocollo, dataIt } from '../js/comune.js';
import { vuoleTimbro, PERCHE_NIENTE_TIMBRO } from '../js/lookups.js';

const DEPS = { rgb, degrees, StandardFonts, qrcode };

/* ── argomenti ────────────────────────────────────────────── */
function argomenti(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (!v.startsWith('--')) continue;
    const nome = v.slice(2);
    const dopo = argv[i + 1];
    if (dopo === undefined || dopo.startsWith('--')) a[nome] = true;
    else { a[nome] = dopo; i++; }
  }
  return a;
}

function esci(messaggio) {
  console.error('\n' + messaggio + '\n');
  process.exit(1);
}

/* ── controlli sul protocollo ─────────────────────────────── */
function controlla(p) {
  const mancanti = ['numero', 'direzione', 'data_prot'].filter((c) => !p[c]);
  if (mancanti.length) {
    esci(`Nel protocollo mancano campi indispensabili: ${mancanti.join(', ')}.\n`
       + 'Senza numero, direzione e data il timbro direbbe una cosa falsa.');
  }
  if (!['IN', 'OUT'].includes(String(p.direzione).toUpperCase())) {
    esci(`Direzione non valida: ${p.direzione}. Dev'essere IN oppure OUT.`);
  }
  p.direzione = String(p.direzione).toUpperCase();
  return p;
}

/* ── programma ────────────────────────────────────────────── */
async function main() {
  const a = argomenti(process.argv);

  if (a.aiuto || a.help || (!a.pdf && !a.json && !a.dati)) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('   ============================================================ */')[0]
      .replace('/* ============================================================\n', ''));
    process.exit(a.pdf ? 1 : 0);
  }

  if (!a.pdf) esci('Manca --pdf: quale documento devo timbrare?');
  if (!fs.existsSync(a.pdf)) esci(`Non trovo il file: ${a.pdf}`);
  if (!/\.pdf$/i.test(a.pdf)) esci('Il timbro si applica solo ai PDF.');

  let grezzo;
  if (a.json) {
    if (!fs.existsSync(a.json)) esci(`Non trovo il file dei dati: ${a.json}`);
    grezzo = fs.readFileSync(a.json, 'utf8');
  } else if (typeof a.dati === 'string') {
    grezzo = a.dati;
  } else {
    esci('Mancano i dati del protocollo: usa --json <file> oppure --dati \'{...}\'.');
  }

  let p;
  try { p = JSON.parse(grezzo); }
  catch (e) { esci('I dati del protocollo non sono JSON valido: ' + e.message); }
  p = controlla(p);

  /* Gli attestati escono gia' completi: il timbro non ci va. */
  if (!vuoleTimbro(p.tipo_doc_txt) && !a.forza) {
    esci(`Tipo documento «${p.tipo_doc_txt}»: ${PERCHE_NIENTE_TIMBRO}\n`
       + 'Se in questo caso lo vuoi lo stesso, aggiungi --forza.');
  }

  const stile = ['striscia', 'minimo', 'blocco'].includes(a.stile) ? a.stile : 'blocco';
  const codice = codiceProtocollo(p);

  const pdf = await PDFDocument.load(fs.readFileSync(a.pdf), { ignoreEncryption: true });
  const pagine = pdf.getPageCount();

  /* Dove va il blocco. La striscia sta sul bordo per definizione:
     li' non c'e' niente da scegliere. */
  let posizione = null;
  let comeDetto = 'in alto a sinistra (predefinito)';
  if (a.dove && stile === 'blocco') {
    const { larghezza: bw, altezza: bh } = misuraTimbro(p, stile);
    const prima = pdf.getPage(0);
    const { width: pw, height: ph } = prima.getSize();

    if (a.dove === 'auto') {
      const esito = await trovaSpazio(a.pdf, bw, bh);
      if (!esito.trovato) esci('Non riesco a posizionare il timbro: ' + esito.motivo);
      posizione = { x: esito.x, y: esito.y };
      const inchiostro = esito.mappa.percentualeSporca;
      comeDetto = esito.libero
        ? `trovato da solo: x=${esito.x} y=${esito.y}, su spazio bianco davvero`
        : `trovato da solo: x=${esito.x} y=${esito.y}, ma NON e' pulito: `
          + `copre ${esito.sporche} celle su cui c'e' qualcosa`;
      comeDetto += `
           pagina occupata al ${inchiostro}%`;
      if (inchiostro > 60) {
        comeDetto += ' — molto piena, guarda il foglio prima di fidarti';
      }
    } else if (/^\d+\s*,\s*\d+$/.test(String(a.dove))) {
      const [x, y] = String(a.dove).split(',').map((n) => Number(n.trim()));
      posizione = { x, y };
      comeDetto = `alle coordinate che hai dato: x=${x} y=${y}`;
    } else if (ANGOLI.includes(a.dove)) {
      posizione = angolo(a.dove, pw, ph, bw, bh);
      comeDetto = a.dove.replace('-', ' a ');
    } else {
      esci(`Non capisco --dove ${a.dove}.\nUsa: auto, ${ANGOLI.join(', ')}, oppure due numeri come 120,600.`);
    }
  } else if (a.dove && stile === 'striscia') {
    esci('--dove non vale per la striscia: sta sul bordo per definizione.');
  }

  await applicaTimbro(pdf, p, stile, DEPS, posizione);

  const uscita = a.out || path.join(
    path.dirname(a.pdf),
    path.basename(a.pdf, path.extname(a.pdf)) + `_${siglaProtocollo(p)}.pdf`.replace(/\//g, '-'),
  );
  if (fs.existsSync(uscita) && !a.sovrascrivi) {
    esci(`Esiste gia': ${uscita}\nNon lo sovrascrivo. Usa --out per un altro nome, o --sovrascrivi.`);
  }

  fs.writeFileSync(uscita, await pdf.save());

  console.log(`Timbrato   ${codice}  del ${dataIt(p.data_prot)}  (${p.direzione === 'IN' ? 'entrata' : 'uscita'})`);
  const dove = stile === 'striscia'
    ? (pagine === 1 ? ' — sulla sola pagina' : ` — su tutte le ${pagine} pagine`)
    : ' — solo sulla prima pagina';
  console.log(`Stile      ${stile}${dove}`);
  if (stile === 'blocco') console.log(`Posizione  ${comeDetto}`);
  console.log(`Originale  ${a.pdf}   (non toccato)`);
  console.log(`Timbrato   ${uscita}`);
}

main().catch((e) => esci('Timbro non riuscito: ' + (e.stack || e.message)));
