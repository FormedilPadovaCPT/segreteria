/* ============================================================
   Dove mettere il timbro senza coprire niente.

   Come funziona: la pagina viene **disegnata** e si guardano i
   pixel. Non si legge il testo — leggendo il testo non si vedono
   le firme, i loghi, le righe delle tabelle, i timbri gia' messi,
   e soprattutto non si vede NIENTE di un documento scansionato,
   che e' tutto immagine. La prima versione di questo file leggeva
   il testo e ha timbrato sopra una firma: e' il motivo per cui
   ora guarda l'inchiostro.

   La pagina si divide in celle quadrate; una cella e' «sporca» se
   contiene anche un solo pixel non bianco. Poi si cerca il primo
   rettangolo di celle tutte pulite grande quanto il timbro,
   scendendo dall'alto e andando da sinistra: cosi' a parita' di
   spazio vince l'alto a sinistra, che e' il posto tradizionale
   del timbro di protocollo.
   ============================================================ */

import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/* Un pixel piu' scuro di questo conta come inchiostro. Sotto 250
   perche' le scansioni hanno il fondo grigino e altrimenti
   risulterebbe sporca tutta la pagina. */
const SOGLIA = 245;

/* ── mappa dell'inchiostro ────────────────────────────────── */
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
  ctx.fillStyle = '#ffffff';                 // il PDF non porta il fondo: lo mettiamo noi
  ctx.fillRect(0, 0, tela.width, tela.height);
  await pagina.render({ canvasContext: ctx, viewport: vista }).promise;

  const px = ctx.getImageData(0, 0, tela.width, tela.height).data;
  const larghezzaPt = vista.width / scala;
  const altezzaPt = vista.height / scala;
  const colonne = Math.ceil(larghezzaPt / cella);
  const righe = Math.ceil(altezzaPt / cella);
  const sporca = new Uint8Array(colonne * righe);

  for (let y = 0; y < tela.height; y++) {
    const rigaCella = Math.min(righe - 1, Math.floor((y / scala) / cella));
    for (let x = 0; x < tela.width; x++) {
      const i = (y * tela.width + x) * 4;
      if (px[i] > SOGLIA && px[i + 1] > SOGLIA && px[i + 2] > SOGLIA) continue;
      sporca[rigaCella * colonne + Math.min(colonne - 1, Math.floor((x / scala) / cella))] = 1;
    }
  }

  /* tabella delle somme cumulate: dopo, ogni rettangolo si valuta
     con quattro letture invece di scorrerlo tutto */
  const somme = new Int32Array((colonne + 1) * (righe + 1));
  for (let r = 0; r < righe; r++) {
    for (let c = 0; c < colonne; c++) {
      somme[(r + 1) * (colonne + 1) + (c + 1)] =
        sporca[r * colonne + c]
        + somme[r * (colonne + 1) + (c + 1)]
        + somme[(r + 1) * (colonne + 1) + c]
        - somme[r * (colonne + 1) + c];
    }
  }

  const celleSporche = sporca.reduce((a, b) => a + b, 0);
  return {
    larghezza: larghezzaPt,
    altezza: altezzaPt,
    pagine: doc.numPages,
    cella, colonne, righe, somme,
    celleSporche,
    percentualeSporca: Math.round((celleSporche / (colonne * righe)) * 1000) / 10,
  };
}

/* quante celle sporche dentro un rettangolo di celle (riga/colonna
   contate dall'ALTO, come nell'immagine) */
function sporcheIn(m, c0, r0, nc, nr) {
  const L = m.colonne + 1;
  const c1 = c0 + nc, r1 = r0 + nr;
  return m.somme[r1 * L + c1] - m.somme[r0 * L + c1] - m.somme[r1 * L + c0] + m.somme[r0 * L + c0];
}

/* ── il posto migliore per un timbro largo `w` e alto `h` ──────
   `margine` = distanza minima dal bordo del foglio
   `aria`    = quanto stare lontani da quello che c'e' gia'
   Le coordinate tornano in punti PDF, origine in basso a sinistra. */
export async function trovaSpazio(percorsoPdf, w, h, {
  numeroPagina = 1, margine = 16, aria = 7, cella = 4, scala = 1,
} = {}) {
  const m = await mappaPagina(percorsoPdf, { numeroPagina, cella, scala });

  const nc = Math.ceil((w + aria * 2) / cella);
  const nr = Math.ceil((h + aria * 2) / cella);
  const cMin = Math.floor(margine / cella);
  const rMin = Math.floor(margine / cella);
  const cMax = m.colonne - nc - cMin;
  const rMax = m.righe - nr - rMin;

  if (cMax < cMin || rMax < rMin) {
    return { trovato: false, motivo: 'il timbro non ci sta nella pagina', mappa: m };
  }

  let migliore = null;
  for (let r = rMin; r <= rMax; r++) {          // dall'alto verso il basso
    for (let c = cMin; c <= cMax; c++) {        // da sinistra a destra
      const sporche = sporcheIn(m, c, r, nc, nr);
      if (sporche === 0) {
        return {
          trovato: true, libero: true, sporche: 0, mappa: m,
          ...inPunti(m, c, r, nr, aria),
        };
      }
      if (!migliore || sporche < migliore.sporche) {
        migliore = { sporche, ...inPunti(m, c, r, nr, aria) };
      }
    }
  }

  /* Niente di completamente pulito: si dice qual e' il meno peggio
     e si dichiara che copre qualcosa. Non si finge di aver vinto. */
  return { trovato: true, libero: false, mappa: m, ...migliore };
}

/* da riga/colonna (dall'alto) a coordinate PDF (dal basso) */
function inPunti(m, c, r, nr, aria) {
  const x = c * m.cella + aria;
  const altoPt = r * m.cella;
  const y = m.altezza - altoPt - nr * m.cella + aria;
  return { x: Math.round(x), y: Math.round(y) };
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
