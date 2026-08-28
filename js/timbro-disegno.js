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
             sotto una griglia di caselle a filo sottile — come nel
             timbro Access dell'ufficio. Le caselle **non hanno
             etichette**: la posizione dice gia' cos'e' il valore, e
             i 27 punti che l'etichetta si mangiava vanno al testo,
             che cosi' si legge. 200 x 68 punti, poco piu' del
             timbro Access (circa 184 x 52).
   «minimo»  solo ente, numero, data e QR: 140 x 46. Per quando sul
             foglio lo spazio e' poco; il resto si legge nel registro
             o inquadrando il QR.

   In tutti e due i casi **l'ingombro non dipende dal contenuto**:
   il testo che non ci sta viene mandato a capo e poi tagliato con i
   puntini. Era il difetto della versione precedente, che cresceva
   con quello che ci si scriveva dentro.                          */

const MISURE = {
  blocco: { larghezza: 200, altezza: 68 },
  minimo: { larghezza: 140, altezza: 46 },
};

export function misuraTimbro(p, stile = 'blocco') {
  return { ...(MISURE[stile] || MISURE.blocco) };
}

/* qualche chiamante cerca ancora il nome vecchio */
export const misuraBlocco = (p) => misuraTimbro(p, 'blocco');

/* Manda a capo entro una larghezza, al massimo `maxRighe` righe;
   quel che avanza si chiude con i puntini, invece di far credere
   che il testo finisse li'. */
function aCapo(testo, font, size, larghezza, maxRighe) {
  const parole = String(testo || '').split(/\s+/).filter(Boolean);
  const righe = [];
  let riga = '';
  for (const par of parole) {
    const prova = riga ? riga + ' ' + par : par;
    if (font.widthOfTextAtSize(prova, size) <= larghezza) { riga = prova; continue; }
    if (riga) righe.push(riga);
    riga = par;
    if (righe.length === maxRighe) break;
  }
  if (riga && righe.length < maxRighe) righe.push(riga);
  if (righe.length === maxRighe && righe.join(' ').split(/\s+/).length < parole.length) {
    let ultima = righe[maxRighe - 1];
    while (ultima && font.widthOfTextAtSize(ultima + '…', size) > larghezza) ultima = ultima.slice(0, -1);
    righe[maxRighe - 1] = ultima.trimEnd() + '…';
  }
  return righe;
}

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
  const BARRA = 9, QR = 28;

  cornice(page, col, L, y, W, H);
  fascia(page, col, bold, L, y, W, H, BARRA);
  capo(page, col, font, bold, p, L, y, H, BARRA);
  disegnaQr(page, testoQr(p), L + W - 5 - QR, y + H - BARRA - QR - 3, QR, deps, col);

  /* ── la griglia sotto ─────────────────────────────────────
     Niente etichette: la posizione dice gia' cos'e' il valore, e
     lo spazio che l'etichetta si mangiava va al testo. Le caselle
     si separano con un filo sottilissimo, come in Access.        */
  const ySep = y + H - BARRA - QR - 6;
  const R1 = 16, R2 = 11;                    // oggetto | ufficio, poi due righe singole
  const COL = L + 116;                       // la colonna che divide
                                             // (a sinistra piu' spazio: i nomi
                                             //  delle cartelle sono lunghi)
  const filo = (a, b, c, d) => page.drawLine({
    start: { x: a, y: b }, end: { x: c, y: d }, thickness: 0.3, color: col.ARANCIO,
  });

  filo(L, ySep, L + W, ySep);
  filo(L, ySep - R1, L + W, ySep - R1);
  filo(L, ySep - R1 - R2, L + W, ySep - R1 - R2);
  filo(COL, y, COL, ySep);

  const P = 2.5;
  const largaSx = COL - L - P * 2;
  const largaDx = L + W - COL - P * 2;

  /* casella alta: due righe, per l'oggetto e per l'ufficio */
  const doppia = (x, largh, testo) => {
    if (!testo) return;
    aCapo(testo, font, 5.6, largh, 2).forEach((t, i) => page.drawText(t, {
      x, y: ySep - 7 - i * 6.6, size: 5.6, font, color: col.NERO,
    }));
  };
  doppia(L + P, largaSx, p.oggetto);
  doppia(COL + P, largaDx, p.ufficio);

  /* caselle a una riga */
  const singola = (x, largh, dy, testo) => {
    if (!testo) return;
    page.drawText(taglia(testo, font, 5.8, largh),
      { x, y: dy, size: 5.8, font, color: col.NERO });
  };
  const y2 = ySep - R1 - 7.5;
  const y3 = ySep - R1 - R2 - 7.5;
  singola(L + P, largaSx, y2, p.impresa_nome || p.persona);
  singola(COL + P, largaDx, y2, p.mezzo);
  singola(L + P, largaSx, y3, p.cartella);
  singola(COL + P, largaDx, y3, p.referente);
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
