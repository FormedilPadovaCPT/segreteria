/* ============================================================
   Dove mettere il timbro senza coprire niente — lato Node.

   Il ragionamento vero sta in ../js/spazio.js, condiviso con
   l'anteprima del browser: se il programma proponesse un punto e
   l'anteprima ne mostrasse un altro, non ci si fiderebbe piu' di
   nessuno dei due. Qui si fa solo il lavoro sporco: aprire il PDF,
   disegnare la pagina su una tela e passare i pixel di la'.
   ============================================================ */

import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mappaDaPixel, cercaLibero } from '../js/spazio.js';

/* Disegna la pagina e restituisce la mappa dell'inchiostro. */
export async function mappaPagina(percorsoPdf, { numeroPagina = 1, cella = 4, scala = 1 } = {}) {
  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(percorsoPdf)),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  const pagina = await doc.getPage(numeroPagina);
  const vista = pagina.getViewport({ scale: scala });

  const tela = createCanvas(Math.ceil(vista.width), Math.ceil(vista.height));
  const ctx = tela.getContext('2d');
  ctx.fillStyle = '#ffffff';        // il PDF non porta il fondo: lo mettiamo noi
  ctx.fillRect(0, 0, tela.width, tela.height);
  await pagina.render({ canvasContext: ctx, viewport: vista }).promise;

  const px = ctx.getImageData(0, 0, tela.width, tela.height).data;
  const m = mappaDaPixel(px, tela.width, tela.height, {
    larghezzaPt: vista.width / scala,
    altezzaPt: vista.height / scala,
    cella,
  });
  return { ...m, pagine: doc.numPages };
}

export async function trovaSpazio(percorsoPdf, w, h, {
  numeroPagina = 1, margine = 16, aria = 7, cella = 4, scala = 1,
} = {}) {
  const mappa = await mappaPagina(percorsoPdf, { numeroPagina, cella, scala });
  return { ...cercaLibero(mappa, w, h, { margine, aria }), mappa };
}

/* ── le posizioni fisse, per chi sceglie a mano ───────────── */
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
