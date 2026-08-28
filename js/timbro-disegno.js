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

/* ── impaginazione a blocco (prima pagina) ────────────────── */
export function timbroBlocco(page, p, font, bold, deps) {
  const col = tavolozza(deps.rgb);
  const { height } = page.getSize();
  const L = 26, W = 268, H = 172;
  const y = height - H - 26;
  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';

  page.drawRectangle({ x: L, y, width: W, height: H, color: col.BIANCO, opacity: 0.93 });
  page.drawRectangle({ x: L, y, width: W, height: H, borderColor: col.ARANCIO, borderWidth: 1.4 });
  page.drawRectangle({ x: L, y: y + H - 16, width: W, height: 16, color: col.ARANCIO });

  page.drawText(`${ENTE.nome} · ${ENTE.area}`.toUpperCase().slice(0, 46),
    { x: L + 6, y: y + H - 12, size: 7, font: bold, color: col.BIANCO });

  /* numero e data in evidenza */
  const codice = codiceProtocollo(p);
  page.drawText(`PROTOCOLLO IN ${dir}`, { x: L + 7, y: y + H - 30, size: 6.5, font: bold, color: col.GRIGIO });
  page.drawText(p.esercizio ? codice : `n° ${p.numero}`,
    { x: L + 7, y: y + H - 51, size: p.esercizio ? 13 : 17, font: bold, color: col.ARANCIO });
  page.drawText(`del ${dataIt(p.data_prot)}`, { x: L + 7, y: y + H - 65, size: 8.5, font, color: col.NERO });

  disegnaQr(page, testoQr(p), L + W - 62, y + H - 74, 54, deps, col);

  page.drawLine({
    start: { x: L + 6, y: y + H - 74 }, end: { x: L + W - 6, y: y + H - 74 },
    thickness: 0.6, color: col.ARANCIO,
  });

  const taglia = (t, size, larg) => {
    const orig = String(t || '');
    if (font.widthOfTextAtSize(orig, size) <= larg) return orig;
    let s = orig;
    while (s && font.widthOfTextAtSize(s + '…', size) > larg) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };

  let ry = y + H - 86;
  const voce = (etichetta, valore) => {
    if (!valore) return;
    page.drawText(etichetta, { x: L + 7, y: ry, size: 6, font: bold, color: col.GRIGIO });
    page.drawText(taglia(valore, 7.5, W - 66), { x: L + 52, y: ry, size: 7.5, font, color: col.NERO });
    ry -= 11.5;
  };

  voce('OGGETTO', p.oggetto);
  voce('MITT./DEST.', p.impresa_nome || p.persona);
  voce('MEZZO', p.mezzo);
  voce('DATA DOC.', dataIt(p.data_doc));
  voce('UFFICIO', p.ufficio);
  voce('CARTELLA', p.cartella);
  voce('REFERENTE', p.referente);
}

/* ── impaginazione a striscia (tutte le pagine) ───────────── */
export function timbroStriscia(page, p, font, bold, deps) {
  const col = tavolozza(deps.rgb);
  const { height } = page.getSize();
  const larg = 30;

  page.drawRectangle({ x: 0, y: 0, width: larg, height, color: col.BIANCO, opacity: 0.9 });
  page.drawRectangle({ x: larg - 2.2, y: 0, width: 2.2, height, color: col.ARANCIO });

  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';
  const rif = p.esercizio ? codiceProtocollo(p) : `n° ${p.numero}`;
  const testo = `${ENTE.nome} · PROTOCOLLO IN ${dir} ${rif} del ${dataIt(p.data_prot)}`;

  page.drawText(testo, {
    x: 19, y: 96, size: 8.5, font: bold, color: col.GRIGIO, rotate: deps.degrees(90),
  });

  disegnaQr(page, testoQr(p), 3, 24, 24, deps, col);
}

/* ── applica il timbro a un PDF già aperto ────────────────── */
export async function applicaTimbro(pdf, protocollo, stile, deps) {
  const font = await pdf.embedFont(deps.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(deps.StandardFonts.HelveticaBold);

  if (stile === 'striscia') pdf.getPages().forEach((pg) => timbroStriscia(pg, protocollo, font, bold, deps));
  else timbroBlocco(pdf.getPages()[0], protocollo, font, bold, deps);

  pdf.setSubject(`Protocollo ${siglaProtocollo(protocollo)} del ${dataIt(protocollo.data_prot)}`);
  return pdf;
}
