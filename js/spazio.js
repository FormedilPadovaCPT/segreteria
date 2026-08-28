/* ============================================================
   Trovare uno spazio bianco su una pagina gia' disegnata.

   Qui non si carica niente e non si apre nessun PDF: si riceve
   l'immagine della pagina gia' resa (i pixel) e si risponde
   «il timbro ci sta qui». Sta in un modulo a se' perche' serve
   in due posti — l'anteprima nel browser e lo strumento da riga
   di comando — e l'algoritmo dev'essere lo stesso: se il
   programma propone un punto e l'anteprima ne mostra un altro,
   non ci si fida piu' di nessuno dei due.

   Il metodo: la pagina si divide in celle quadrate; una cella e'
   «sporca» se contiene anche un solo pixel non bianco. Poi si
   cerca il primo rettangolo di celle tutte pulite grande quanto
   il timbro, scendendo dall'alto e andando da sinistra — cosi' a
   parita' di spazio vince l'alto a sinistra, che e' il posto
   tradizionale del timbro di protocollo.

   ⚠️ Guarda l'inchiostro, non il testo. E' voluto: leggendo il
   testo non si vedono le firme, i loghi, le righe delle tabelle
   ne' i documenti scansionati, che di testo non ne hanno. Una
   prima versione leggeva il testo e ha timbrato sopra una firma.
   ============================================================ */

/* Un pixel piu' scuro di questo conta come inchiostro. Sotto 250
   perche' le scansioni hanno il fondo grigino, e altrimenti
   risulterebbe sporca tutta la pagina. */
export const SOGLIA = 245;

/* `dati` sono i byte RGBA di una ImageData (browser o canvas di
   Node), `largPx`/`altPx` le dimensioni in pixel di quell'immagine,
   `larghezzaPt`/`altezzaPt` la pagina in punti PDF. */
export function mappaDaPixel(dati, largPx, altPx, {
  larghezzaPt, altezzaPt, cella = 4, soglia = SOGLIA,
} = {}) {
  const scalaX = largPx / larghezzaPt;
  const scalaY = altPx / altezzaPt;
  const colonne = Math.ceil(larghezzaPt / cella);
  const righe = Math.ceil(altezzaPt / cella);
  const sporca = new Uint8Array(colonne * righe);

  for (let y = 0; y < altPx; y++) {
    const r = Math.min(righe - 1, Math.floor((y / scalaY) / cella));
    for (let x = 0; x < largPx; x++) {
      const i = (y * largPx + x) * 4;
      if (dati[i] > soglia && dati[i + 1] > soglia && dati[i + 2] > soglia) continue;
      sporca[r * colonne + Math.min(colonne - 1, Math.floor((x / scalaX) / cella))] = 1;
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

  let celleSporche = 0;
  for (let i = 0; i < sporca.length; i++) celleSporche += sporca[i];

  return {
    larghezza: larghezzaPt, altezza: altezzaPt,
    cella, colonne, righe, somme, celleSporche,
    percentualeSporca: Math.round((celleSporche / (colonne * righe)) * 1000) / 10,
  };
}

/* quante celle sporche dentro un rettangolo di celle
   (riga e colonna contate dall'ALTO, come nell'immagine) */
export function sporcheIn(m, c0, r0, nc, nr) {
  const L = m.colonne + 1;
  const c1 = c0 + nc, r1 = r0 + nr;
  return m.somme[r1 * L + c1] - m.somme[r0 * L + c1] - m.somme[r1 * L + c0] + m.somme[r0 * L + c0];
}

/* Il posto per un timbro largo `w` e alto `h`, in punti PDF con
   l'origine in basso a sinistra.
     margine = distanza minima dal bordo del foglio
     aria    = quanto stare lontani da quello che c'e' gia'      */
export function cercaLibero(m, w, h, { margine = 16, aria = 7 } = {}) {
  const nc = Math.ceil((w + aria * 2) / m.cella);
  const nr = Math.ceil((h + aria * 2) / m.cella);
  const cMin = Math.floor(margine / m.cella);
  const rMin = Math.floor(margine / m.cella);
  const cMax = m.colonne - nc - cMin;
  const rMax = m.righe - nr - rMin;

  if (cMax < cMin || rMax < rMin) {
    return { trovato: false, motivo: 'il timbro non ci sta nella pagina' };
  }

  const inPunti = (c, r) => ({
    x: Math.round(c * m.cella + aria),
    y: Math.round(m.altezza - r * m.cella - nr * m.cella + aria),
  });

  let migliore = null;
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const sporche = sporcheIn(m, c, r, nc, nr);
      if (sporche === 0) return { trovato: true, libero: true, sporche: 0, ...inPunti(c, r) };
      if (!migliore || sporche < migliore.sporche) migliore = { sporche, ...inPunti(c, r) };
    }
  }

  /* Niente di completamente pulito: si dice qual e' il meno peggio
     e si dichiara che copre qualcosa. Non si finge di aver vinto. */
  return { trovato: true, libero: false, ...migliore };
}
