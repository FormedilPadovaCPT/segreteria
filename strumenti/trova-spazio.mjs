/* ============================================================
   Dove mettere il timbro senza coprire il documento.

   Legge dove sta il testo sulla pagina e cerca un rettangolo
   libero grande quanto il timbro. A parita' di spazio libero
   preferisce l'alto a sinistra, che e' il posto tradizionale del
   timbro di protocollo.

   ⚠️ LIMITE DA SAPERE: guarda **solo il testo**. Un logo, una
   foto, una tabella disegnata a linee o un documento scansionato
   (che e' tutto immagine, senza testo) risultano «bianchi» e il
   timbro ci finisce sopra. Per questo la funzione restituisce
   anche quanto testo ha trovato: se e' poco o zero, chi chiama
   deve **dubitare** del risultato e far vedere il foglio a una
   persona, non fidarsi del numero.
   ============================================================ */

import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/* Riquadri occupati dal testo della pagina, in coordinate PDF
   (origine in basso a sinistra, come li vuole pdf-lib). */
export async function riquadriTesto(percorsoPdf, numeroPagina = 1) {
  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(percorsoPdf)),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pagina = await doc.getPage(numeroPagina);
  const { width, height } = pagina.getViewport({ scale: 1 });
  const contenuto = await pagina.getTextContent();

  const riquadri = [];
  for (const i of contenuto.items) {
    if (!i.str || !i.str.trim()) continue;
    const x = i.transform[4];
    const y = i.transform[5];
    const w = i.width || 0;
    const h = i.height || Math.abs(i.transform[3]) || 8;
    /* y del transform e' la linea di base: il riquadro scende un po' sotto */
    riquadri.push({ x, y: y - h * 0.25, w, h: h * 1.25 });
  }
  return { larghezza: width, altezza: height, riquadri, pagine: doc.numPages };
}

const sovrappone = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function areaCoperta(candidato, riquadri) {
  let area = 0;
  for (const r of riquadri) {
    if (!sovrappone(candidato, r)) continue;
    const dx = Math.min(candidato.x + candidato.w, r.x + r.w) - Math.max(candidato.x, r.x);
    const dy = Math.min(candidato.y + candidato.h, r.y + r.h) - Math.max(candidato.y, r.y);
    area += dx * dy;
  }
  return area;
}

/* Il posto migliore per un timbro largo `w` e alto `h`.
   `margine` = quanto stare lontani dal bordo del foglio.
   `aria`    = quanto stare lontani dal testo.                 */
export async function trovaSpazio(percorsoPdf, w, h, {
  numeroPagina = 1, margine = 18, aria = 6, passo = 8,
} = {}) {
  const pag = await riquadriTesto(percorsoPdf, numeroPagina);
  const cerca = { w: w + aria * 2, h: h + aria * 2 };

  const xMin = margine, xMax = pag.larghezza - margine - cerca.w;
  const yMin = margine, yMax = pag.altezza - margine - cerca.h;
  if (xMax < xMin || yMax < yMin) {
    return { trovato: false, motivo: 'il timbro e\' piu\' grande della pagina', pagina: pag };
  }

  let migliore = null;
  /* dall'alto verso il basso e da sinistra a destra: il primo posto
     completamente libero che si incontra e' quello piu' in alto a
     sinistra, cioe' dove il timbro sta per tradizione */
  for (let y = yMax; y >= yMin; y -= passo) {
    for (let x = xMin; x <= xMax; x += passo) {
      const c = { x, y, w: cerca.w, h: cerca.h };
      const coperta = areaCoperta(c, pag.riquadri);
      if (coperta === 0) {
        return {
          trovato: true, libero: true,
          x: Math.round(x + aria), y: Math.round(y + aria),
          coperta: 0, pagina: pag,
        };
      }
      if (!migliore || coperta < migliore.coperta) {
        migliore = { x: Math.round(x + aria), y: Math.round(y + aria), coperta };
      }
    }
  }

  /* Nessun posto del tutto libero: si dice qual e' il meno peggio,
     ma si dichiara che copre qualcosa. Non si finge di aver vinto. */
  return { trovato: true, libero: false, ...migliore, pagina: pag };
}

/* Le quattro posizioni fisse, per chi vuole scegliere a mano. */
export function angolo(nome, larghezzaPagina, altezzaPagina, w, h, margine = 26) {
  const mappa = {
    'alto-sinistra': { x: margine, y: altezzaPagina - h - margine },
    'alto-destra': { x: larghezzaPagina - w - margine, y: altezzaPagina - h - margine },
    'basso-sinistra': { x: margine, y: margine },
    'basso-destra': { x: larghezzaPagina - w - margine, y: margine },
    centro: { x: (larghezzaPagina - w) / 2, y: (altezzaPagina - h) / 2 },
  };
  return mappa[nome] || null;
}

export const ANGOLI = ['alto-sinistra', 'alto-destra', 'basso-sinistra', 'basso-destra', 'centro'];
