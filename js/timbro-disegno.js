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

const TESTA = 62;    // fascia dell'ente, codice, data
const PASSO = 10;    // interlinea di una voce
const CODA = 8;      // aria in fondo

/* ── quanto spazio occupa il blocco ────────────────────────
   L'altezza si calcola dal contenuto, non e' fissa: un timbro con
   due righe non deve essere alto come uno con sei. E' la prima
   difesa contro la sovrapposizione al documento sotto.          */
export function misuraBlocco(p) {
  const righe = [
    p.oggetto, p.impresa_nome || p.persona, p.mezzo, p.ufficio, p.cartella, p.referente,
  ].filter(Boolean).length;
  return { larghezza: 232, altezza: TESTA + righe * PASSO + CODA };
}

/* ── impaginazione a blocco ────────────────────────────────
   Posizione predefinita: in alto a sinistra. Si puo' spostare
   passando `posizione` = {x, y} in punti PDF, misurati dal
   basso-sinistra come vuole il formato.                        */
export function timbroBlocco(page, p, font, bold, deps, posizione) {
  const col = tavolozza(deps.rgb);
  const { width: LARG, height } = page.getSize();
  const { larghezza: W, altezza: H } = misuraBlocco(p);
  const L = posizione ? Math.max(4, Math.min(posizione.x, LARG - W - 4)) : 26;
  const y = posizione ? Math.max(4, Math.min(posizione.y, height - H - 4)) : height - H - 26;

  page.drawRectangle({ x: L, y, width: W, height: H, color: col.BIANCO, opacity: 0.93 });
  page.drawRectangle({ x: L, y, width: W, height: H, borderColor: col.ARANCIO, borderWidth: 1.2 });
  page.drawRectangle({ x: L, y: y + H - 13, width: W, height: 13, color: col.ARANCIO });

  page.drawText(`${ENTE.nome} · ${ENTE.area}`.toUpperCase().slice(0, 46),
    { x: L + 5, y: y + H - 9.5, size: 6.5, font: bold, color: col.BIANCO });

  /* Il codice e la data DI PROTOCOLLO: sono le due cose che il
     timbro aggiunge al foglio. La data del documento no: quella
     il documento ce l'ha gia' stampata sua.                     */
  const codice = codiceProtocollo(p);
  page.drawText(p.esercizio ? codice : `n° ${p.numero}`,
    { x: L + 6, y: y + H - 32, size: p.esercizio ? 12.5 : 16, font: bold, color: col.ARANCIO });
  page.drawText(`del ${dataIt(p.data_prot)}`,
    { x: L + 6, y: y + H - 45, size: 8, font, color: col.NERO });

  disegnaQr(page, testoQr(p), L + W - 46, y + H - 54, 40, deps, col);

  page.drawLine({
    start: { x: L + 5, y: y + H - 54 }, end: { x: L + W - 5, y: y + H - 54 },
    thickness: 0.5, color: col.ARANCIO,
  });

  const taglia = (t, size, larg) => {
    const orig = String(t || '');
    if (font.widthOfTextAtSize(orig, size) <= larg) return orig;
    let s = orig;
    while (s && font.widthOfTextAtSize(s + '…', size) > larg) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };

  let ry = y + H - TESTA + 2;
  const voce = (etichetta, valore) => {
    if (!valore) return;
    page.drawText(etichetta, { x: L + 6, y: ry, size: 5.5, font: bold, color: col.GRIGIO });
    page.drawText(taglia(valore, 7, W - 58), { x: L + 46, y: ry, size: 7, font, color: col.NERO });
    ry -= PASSO;
  };

  voce('OGGETTO', p.oggetto);
  voce('MITT./DEST.', p.impresa_nome || p.persona);
  voce('MEZZO', p.mezzo);
  voce('UFFICIO', p.ufficio);
  voce('CARTELLA', p.cartella);
  voce('REFERENTE', p.referente);
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
  else timbroBlocco(pdf.getPages()[0], protocollo, font, bold, deps, posizione);

  pdf.setSubject(`Protocollo ${siglaProtocollo(protocollo)} del ${dataIt(protocollo.data_prot)}`);
  return pdf;
}
