#!/usr/bin/env node
/* ============================================================
   Controlla che il timbro stia dentro al proprio riquadro.

   Perche' esiste: il 28/08/2026 l'ultima riga del blocco (cartella
   e referente) e' finita FUORI dalla cornice, sopra il testo del
   documento — avevo lasciato 25 punti per tre righe che ne
   chiedono 37, e non l'avevo verificato. A occhio, su un timbro
   alto 68 punti, non si vede finche' non lo si ingrandisce.

   Come controlla: disegna il timbro su un foglio bianco, **rende
   la pagina e misura il rettangolo dell'inchiostro**. Se un solo
   segno esce dalla cornice dichiarata, il rettangolo misurato e'
   piu' grande di quello dichiarato e il controllo fallisce. Non
   guarda il testo: guarda i pixel, quindi vede anche le linee.

   Uso:  node verifica-timbro.mjs
   Esce con codice 1 se qualcosa non torna.
   ============================================================ */

import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { applicaTimbro, misuraTimbro } from '../js/timbro-disegno.js';

const DEPS = { rgb, degrees, StandardFonts, qrcode };
const A4 = [595.28, 841.89];
const SOGLIA = 245;

/* Il rettangolo che racchiude tutto l'inchiostro della pagina,
   in punti PDF con l'origine in basso a sinistra. */
async function riquadroInchiostro(byte) {
  const doc = await getDocument({ data: new Uint8Array(byte), verbosity: 0 }).promise;
  const pagina = await doc.getPage(1);
  const vista = pagina.getViewport({ scale: 2 });      // 2 px per punto: si vedono anche i fili da 0,3
  const tela = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
  const ctx = tela.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tela.width, tela.height);
  await pagina.render({ canvasContext: ctx, viewport: vista }).promise;

  const px = ctx.getImageData(0, 0, tela.width, tela.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < tela.height; y++) {
    for (let x = 0; x < tela.width; x++) {
      const i = (y * tela.width + x) * 4;
      if (px[i] > SOGLIA && px[i + 1] > SOGLIA && px[i + 2] > SOGLIA) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x0 === Infinity) return null;
  const s = 2;
  return {
    x: x0 / s, y: (tela.height - 1 - y1) / s,
    dx: (x1 - x0 + 1) / s, dy: (y1 - y0 + 1) / s,
  };
}

const CASI = {
  'minimo indispensabile': { numero: 1, esercizio: '26-27', direzione: 'IN', data_prot: '2026-10-01' },
  'tutti i campi': {
    numero: 1, esercizio: '26-27', direzione: 'IN', data_prot: '2026-10-01',
    oggetto: 'Convocazione riunione di coordinamento - Mercoledi 15 luglio ore 17:00',
    impresa_nome: 'CAVINATO SRL', mezzo: 'e-mail',
    ufficio: 'Segreteria Area Sicurezza e Salute',
    cartella: 'CARTELLA - Comunicazioni Tecnici CPT', referente: 'Squizzato Sig. Renato',
  },
  'caso peggiore': {
    numero: 4044, direzione: 'OUT', data_prot: '2026-09-30',
    oggetto: 'Trasmissione della documentazione richiesta in merito alla verifica periodica delle attrezzature di sollevamento presenti in cantiere, con i relativi allegati e le dichiarazioni',
    impresa_nome: 'COSTRUZIONI DAL MASO S.N.C. DI DAL MASO PIETRO & C.',
    mezzo: 'PostaCert.', ufficio: 'Ufficio Formazione Continua',
    cartella: 'CARTELLA - ASSEVERAZIONE - Documenti e verbali del gruppo di verifica',
    referente: 'Parasiliti Collazzo Ing. Matilde',
  },
};

const POSA = { x: 120, y: 400 };
const TOLLERANZA = 1.5;   // il bordo ha spessore, e l'antialiasing sbava di poco

let guai = 0;

for (const stile of ['blocco', 'minimo']) {
  for (const [nome, p] of Object.entries(CASI)) {
    const doc = await PDFDocument.create();
    doc.addPage(A4);
    await applicaTimbro(doc, p, stile, DEPS, POSA);
    const misurato = await riquadroInchiostro(await doc.save());
    const atteso = misuraTimbro(p, stile);

    const fuoriSx = POSA.x - misurato.x;
    const fuoriGiu = POSA.y - misurato.y;
    const fuoriDx = (misurato.x + misurato.dx) - (POSA.x + atteso.larghezza);
    const fuoriSu = (misurato.y + misurato.dy) - (POSA.y + atteso.altezza);
    const sbordi = { sinistra: fuoriSx, sotto: fuoriGiu, destra: fuoriDx, sopra: fuoriSu };

    const rotti = Object.entries(sbordi).filter(([, v]) => v > TOLLERANZA);
    const esito = rotti.length ? 'FUORI' : 'dentro';
    if (rotti.length) guai++;

    console.log(
      `${stile.padEnd(8)} ${nome.padEnd(24)} dichiarato ${atteso.larghezza}x${atteso.altezza}`
      + `  misurato ${misurato.dx.toFixed(1)}x${misurato.dy.toFixed(1)}  ${esito}`
      + (rotti.length ? '  →  sborda ' + rotti.map(([k, v]) => `${k} di ${v.toFixed(1)}pt`).join(', ') : ''),
    );
  }
}

console.log(guai
  ? `\n${guai} controlli falliti: c'e' del disegno fuori dal riquadro.`
  : '\nTutto dentro al riquadro, in ogni stile e in ogni caso di prova.');
process.exit(guai ? 1 : 0);
