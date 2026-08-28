/* ============================================================
   Disegno del timbro di protocollo — solo geometria e testo.
   Due impaginazioni, come in Access:
     · blocco   → riquadro in alto a sinistra della prima pagina
     · striscia → fascia verticale sul bordo sinistro di ogni pagina

   Qui non si carica niente: pdf-lib e il generatore di QR
   arrivano da fuori, nel parametro `deps`. È quello che permette
   allo stesso timbro di uscire dal browser (librerie da CDN) e
   da Node (librerie da npm), senza scriverlo due volte — due
   timbri diventerebbero due timbri diversi al primo ritocco.

   Il timbro porta sempre il numero e la data DEL PROTOCOLLO, mai
   quelli del giorno in cui lo si stampa: è ciò che rende valida
   la ritimbratura di un documento del 2013 fatta oggi.
   ============================================================ */

import { ENTE } from './config.js';
import { dataIt, codiceProtocollo, siglaProtocollo } from './comune.js';

const tavolozza = (rgb) => ({
  ARANCIO: rgb(0.906, 0.314, 0.059),
  GRIGIO: rgb(0.337, 0.361, 0.400),
  NERO: rgb(0.1, 0.1, 0.12),
  BIANCO: rgb(1, 1, 1),
});

/* ── testo del QR ─────────────────────────────────────────── */
export function testoQr(p) {
  const nominativo = p.impresa_nome || p.persona || p.alla_ca || '';
  return [
    siglaProtocollo(p),
    dataIt(p.data_prot),
    (p.oggetto || '').slice(0, 90),
    nominativo.slice(0, 60),
  ].filter(Boolean).join(' ');
}

/* ── il QR come griglia di quadratini, non come immagine ───
   Disegnato a vettore resta nitido in stampa a qualunque
   ingrandimento, e il PDF non si porta dietro un bitmap.       */
function disegnaQr(page, testo, x, y, lato, deps, col) {
  const qr = deps.qrcode(0, 'M');
  qr.addData(testo);
  qr.make();
  const n = qr.getModuleCount();
  const passo = lato / n;
  page.drawRectangle({ x, y, width: lato, height: lato, color: col.BIANCO });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      page.drawRectangle({
        x: x + c * passo,
        y: y + lato - (r + 1) * passo,
        width: passo + 0.2,
        height: passo + 0.2,
        color: col.NERO,
      });
    }
  }
}

/* ── le due forme del timbro ───────────────────────────────
   «blocco»  (predefinito) intestazione con numero, data e QR, e
             sotto i riferimenti su due colonne, in corpo minuscolo
             e interlinea strettissima — solo numero e data restano
             leggibili a distanza. 200 x 66 punti, cioe' poco piu'
             del timbro che l'ufficio usa in Access (circa 184 x 52).
   «minimo»  solo ente, numero, data e QR: 140 x 46. Per quando sul
             foglio lo spazio e' poco; il resto si legge nel registro
             o inquadrando il QR.

   In tutti e due i casi **l'ingombro non dipende dal contenuto**:
   il testo che non ci sta viene mandato a capo e poi tagliato con i
   puntini. Era il difetto della versione precedente, che cresceva
   con quello che ci si scriveva dentro.                          */

const MISURE = {
  blocco: { larghezza: 200, altezza: 66 },
  minimo: { larghezza: 140, altezza: 46 },
};

export function misuraTimbro(p, stile = 'blocco') {
  return { ...(MISURE[stile] || MISURE.blocco) };
}

/* qualche chiamante cerca ancora il nome vecchio */
export const misuraBlocco = (p) => misuraTimbro(p, 'blocco');

function taglia(testo, font, size, larghezza) {
  let t = String(testo || '');
  if (font.widthOfTextAtSize(t, size) <= larghezza) return t;
  while (t && font.widthOfTextAtSize(t + '…', size) > larghezza) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function ancora(page, W, H, posizione, margine = 26) {
  const { width: LARG, height } = page.getSize();
  const L = posizione ? Math.max(2, Math.min(posizione.x, LARG - W - 2)) : margine;
  const y = posizione ? Math.max(2, Math.min(posizione.y, height - H - 2)) : height - H - margine;
  return { L, y };
}

function cornice(page, col, L, y, W, H) {
  page.drawRectangle({ x: L, y, width: W, height: H, color: col.BIANCO, opacity: 0.94 });
  page.drawRectangle({ x: L, y, width: W, height: H, borderColor: col.ARANCIO, borderWidth: 0.9 });
}

function fascia(page, col, bold, L, y, W, H, alta) {
  page.drawRectangle({ x: L, y: y + H - alta, width: W, height: alta, color: col.ARANCIO });
  page.drawText(`${ENTE.nome} · ${ENTE.area}`.toUpperCase(),
    { x: L + 4, y: y + H - alta + 2.6, size: 4.6, font: bold, color: col.BIANCO });
}

/* numero e data: le due sole cose che restano leggibili a distanza */
function capo(page, col, font, bold, p, L, y, H, barra) {
  page.drawText(p.esercizio ? codiceProtocollo(p) : `n° ${p.numero}`,
    { x: L + 5, y: y + H - barra - 13, size: 10.5, font: bold, color: col.ARANCIO });
  page.drawText(`del ${dataIt(p.data_prot)}`,
    { x: L + 5, y: y + H - barra - 23, size: 7, font, color: col.NERO });
}

/* ── blocco (predefinito) ─────────────────────────────────── */
export function timbroBlocco(page, p, font, bold, deps, posizione) {
  const col = tavolozza(deps.rgb);
  const { larghezza: W, altezza: H } = MISURE.blocco;
  const { L, y } = ancora(page, W, H, posizione);
  const BARRA = 9, QR = 28, PASSO = 6;

  cornice(page, col, L, y, W, H);
  fascia(page, col, bold, L, y, W, H, BARRA);
  capo(page, col, font, bold, p, L, y, H, BARRA);
  disegnaQr(page, testoQr(p), L + W - 5 - QR, y + H - BARRA - QR - 3, QR, deps, col);

  const ySep = y + H - BARRA - QR - 7;
  page.drawLine({
    start: { x: L + 4, y: ySep }, end: { x: L + W - 4, y: ySep },
    thickness: 0.4, color: col.ARANCIO,
  });

  /* Riferimenti su due colonne, corpo 5 e interlinea 6: si leggono
     col foglio in mano, non servono a leggersi da lontano. */
  const COL = 97;
  const voce = (dx, largh, i, etichetta, valore) => {
    if (!valore) return;
    const yy = ySep - 6 - i * PASSO;
    page.drawText(etichetta, { x: L + 5 + dx, y: yy, size: 4.2, font: bold, color: col.GRIGIO });
    page.drawText(taglia(valore, font, 5, largh - 27),
      { x: L + 5 + dx + 27, y: yy, size: 5, font, color: col.NERO });
  };

  voce(0, COL, 0, 'OGGETTO', p.oggetto);
  voce(0, COL, 1, 'DA/A', p.impresa_nome || p.persona);
  voce(0, COL, 2, 'MEZZO', p.mezzo);
  voce(COL, W - COL - 8, 0, 'UFFICIO', p.ufficio);
  voce(COL, W - COL - 8, 1, 'CARTELLA', p.cartella);
  voce(COL, W - COL - 8, 2, 'RIF.', p.referente);
}

/* ── minimo: per quando lo spazio e' poco ─────────────────── */
export function timbroMinimo(page, p, font, bold, deps, posizione) {
  const col = tavolozza(deps.rgb);
  const { larghezza: W, altezza: H } = MISURE.minimo;
  const { L, y } = ancora(page, W, H, posizione);
  const BARRA = 10, QR = 32, PAD = 5;

  cornice(page, col, L, y, W, H);
  fascia(page, col, bold, L, y, W, H, BARRA);
  capo(page, col, font, bold, p, L, y, H, BARRA);
  disegnaQr(page, testoQr(p), L + W - PAD - QR, y + (H - BARRA - QR) / 2 + 1, QR, deps, col);
}

/* ── impaginazione a striscia (tutte le pagine) ────────────
   Niente QR qui: in 24 punti di lato verrebbe illeggibile, e un
   QR che non si legge e' peggio di nessun QR. Chi vuole il codice
   a lettura ottica usa il blocco. Senza QR la striscia si
   restringe e disturba ancora meno il documento sotto.          */
export function timbroStriscia(page, p, font, bold, deps) {
  const col = tavolozza(deps.rgb);
  const { height } = page.getSize();
  const larg = 20;

  page.drawRectangle({ x: 0, y: 0, width: larg, height, color: col.BIANCO, opacity: 0.9 });
  page.drawRectangle({ x: larg - 2, y: 0, width: 2, height, color: col.ARANCIO });

  const testo = `${ENTE.nome} - ${ENTE.area} - ${siglaProtocollo(p)} del ${dataIt(p.data_prot)}`;
  const misura = bold.widthOfTextAtSize(testo, 8.5);

  page.drawText(testo, {
    /* centrata sull'altezza della pagina, cosi' regge anche l'A3 */
    x: 13.5, y: Math.max(24, (height - misura) / 2),
    size: 8.5, font: bold, color: col.GRIGIO, rotate: deps.degrees(90),
  });
}

/* ── applica il timbro a un PDF già aperto ────────────────── */
export async function applicaTimbro(pdf, protocollo, stile, deps, posizione) {
  const font = await pdf.embedFont(deps.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(deps.StandardFonts.HelveticaBold);

  if (stile === 'striscia') pdf.getPages().forEach((pg) => timbroStriscia(pg, protocollo, font, bold, deps));
  else if (stile === 'minimo') timbroMinimo(pdf.getPages()[0], protocollo, font, bold, deps, posizione);
  else timbroBlocco(pdf.getPages()[0], protocollo, font, bold, deps, posizione);

  pdf.setSubject(`Protocollo ${siglaProtocollo(protocollo)} del ${dataIt(protocollo.data_prot)}`);
  return pdf;
}
