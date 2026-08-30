/* ============================================================
   Le due stampe della maschera Nomine, ricalcate sui report
   di Access:

   - FOGLIO PRESENZE: per un ruolo, le persone con nomina attiva
     in questo momento — nominativo, CF, mansione, ente, e lo
     spazio bianco a destra per la firma;
   - ELENCO NOMINE: le nomine del ruolo come filtrate a video,
     con data di registrazione, inizio incarico (verde), fine
     nomina (rosa), mansione e contatti.

   Sono fogli interni: non varcano la porta dell'ufficio, quindi
   NON si protocollano (è la definizione stessa di protocollo).
   ============================================================ */

import { ENTE, COLORI } from './config.js';
import { pdfLib } from './cdn.js';
import { dataIt, oggiIso } from './comune.js';

const A4 = [595.28, 841.89];
const SX = 57, DX = 538;

async function apriDocumento() {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  let logo = null;
  try {
    const bytes = new Uint8Array(await (await fetch('img/logo.png')).arrayBuffer());
    logo = await doc.embedPng(bytes);
  } catch { /* la carta regge anche senza */ }
  return { doc, font, bold, italic, logo, rgb };
}

/* La carta intestata Formedil in testa alla pagina; torna la y utile. */
function intestazione(pagina, m) {
  const { font, bold, logo, rgb } = m;
  const arancio = rgb(...COLORI.arancio);
  const grigio = rgb(...COLORI.grigio);
  let y = 800;
  if (logo) {
    const w = 120, h = (logo.height / logo.width) * w;
    pagina.drawImage(logo, { x: SX, y: y - h + 8, width: w, height: h });
  }
  const righe = [
    [ENTE.nome, bold, 10, arancio],
    [ENTE.sotto, bold, 8.5, grigio],
    ["Ente Unico per la Formazione e la Sicurezza per il settore", font, 6.5, grigio],
    ["dell'Edilizia ed affini della Provincia di Padova", font, 6.5, grigio],
    ['ANCE PADOVA  FENEAL UIL  FILCA CISL  FILLEA CGIL', bold, 6.5, grigio],
    ['Accreditamento Regione Veneto L.R. N. 19 del 09.08.02 cod. A0119', font, 6.5, grigio],
    ['CF 80006850285 - P IVA 02585760289 - CCIAA PD n. REA 294715', font, 6.5, grigio],
    [`${ENTE.indirizzo} — tel. ${ENTE.tel}`, font, 6.5, grigio],
    [`${ENTE.email} — ${ENTE.web}`, font, 6.5, grigio],
  ];
  let yDx = y;
  for (const [testo, f, dim, colore] of righe) {
    pagina.drawText(testo, { x: 250, y: yDx, size: dim, font: f, color: colore });
    yDx -= dim + 2.5;
  }
  y = Math.min(yDx, y - 60) - 8;
  pagina.drawLine({ start: { x: SX, y }, end: { x: DX, y }, thickness: 1.2, color: arancio });
  return y - 30;
}

function piede(pagina, m, n, tot) {
  const { font, rgb } = m;
  const grigio = rgb(...COLORI.grigio);
  pagina.drawText(`Stampato il ${dataIt(oggiIso())}`, { x: DX - 90, y: 42, size: 8, font, color: grigio });
  pagina.drawText(`Pagina ${n} di ${tot}`, { x: 297 - 25, y: 30, size: 8, font, color: grigio });
}

function scarica(bytes, nome) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── FOGLIO PRESENZE ──────────────────────────────────────── */
export async function foglioPresenze(ruolo, righe) {
  const m = await apriDocumento();
  const { doc, font, bold, italic, rgb } = m;
  const nero = rgb(0.12, 0.12, 0.12);
  const grigio = rgb(...COLORI.grigio);
  const sfondo = rgb(0.955, 0.955, 0.96);

  const H = 62;                              // altezza riga-firma
  const perPagina = Math.floor((680 - 90) / H) + 4;
  const pagine = Math.max(1, Math.ceil(righe.length / perPagina));
  for (let pg = 0; pg < pagine; pg++) {
    const pagina = doc.addPage(A4);
    let y = intestazione(pagina, m);
    pagina.drawText('FOGLIO PRESENZE', { x: 297 - m.bold.widthOfTextAtSize('FOGLIO PRESENZE', 22) / 2, y, size: 22, font: bold, color: grigio });
    y -= 30;
    const st = ruolo || '';
    pagina.drawText(st, { x: 297 - italic.widthOfTextAtSize(st, 13) / 2, y, size: 13, font: italic, color: nero });
    pagina.drawLine({ start: { x: 297 - italic.widthOfTextAtSize(st, 13) / 2, y: y - 3 }, end: { x: 297 + italic.widthOfTextAtSize(st, 13) / 2, y: y - 3 }, thickness: .7, color: nero });
    y -= 34;

    for (const r of righe.slice(pg * perPagina, (pg + 1) * perPagina)) {
      if (y < 80) break;
      pagina.drawRectangle({ x: SX, y: y - H + 14, width: DX - SX, height: H - 6, color: sfondo });
      pagina.drawText(r.nominativo, { x: SX + 10, y: y - 6, size: 13, font: italic, color: nero });
      if (r.cf) pagina.drawText(r.cf, { x: SX + 10, y: y - 19, size: 7.5, font, color: grigio });
      pagina.drawText([r.mansione, ''].filter(Boolean).join(''), { x: SX + 10, y: y - 36, size: 8, font: italic, color: grigio });
      if (r.ente) pagina.drawText(r.ente, { x: 250, y: y - 36, size: 8, font: italic, color: grigio });
      /* lo spazio a destra resta bianco: è per la firma */
      pagina.drawLine({ start: { x: 370, y: y - 40 }, end: { x: DX - 12, y: y - 40 }, thickness: .5, color: grigio });
      y -= H;
    }
    piede(pagina, m, pg + 1, pagine);
  }
  scarica(new Uint8Array(await doc.save()), `foglio-presenze-${(ruolo || 'nomine').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}

/* ── ELENCO NOMINE ────────────────────────────────────────── */
export async function elencoNomine(ruolo, righe) {
  const m = await apriDocumento();
  const { doc, font, bold, italic, rgb } = m;
  const nero = rgb(0.12, 0.12, 0.12);
  const grigio = rgb(...COLORI.grigio);
  const verde = rgb(0.85, 0.93, 0.85);
  const rosa = rgb(0.97, 0.88, 0.88);

  const H = 66;
  const perPagina = 9;
  const pagine = Math.max(1, Math.ceil(righe.length / perPagina));
  for (let pg = 0; pg < pagine; pg++) {
    const pagina = doc.addPage(A4);
    let y = intestazione(pagina, m);
    pagina.drawText('Nomine', { x: 297 - m.font.widthOfTextAtSize('Nomine', 26) / 2, y, size: 26, font, color: grigio });
    y -= 26;
    const st = (ruolo || 'Tutti i ruoli').toUpperCase();
    pagina.drawText(st, { x: 297 - bold.widthOfTextAtSize(st, 13) / 2, y, size: 13, font: bold, color: nero });
    y -= 20;
    for (const [testo, x] of [['DataReg', SX], ['Nominativo', SX + 65], ['Inizio / fine incarico', 250], ['Ente / mansione', 360], ['Contatti', 455]]) {
      pagina.drawText(testo, { x, y, size: 7.5, font: italic, color: grigio });
    }
    y -= 12;

    for (const r of righe.slice(pg * perPagina, (pg + 1) * perPagina)) {
      if (y < 90) break;
      pagina.drawLine({ start: { x: SX, y: y + 4 }, end: { x: DX, y: y + 4 }, thickness: .4, color: grigio });
      pagina.drawText(r.data_reg ? dataIt(r.data_reg) : '', { x: SX, y: y - 8, size: 8.5, font, color: nero });
      pagina.drawText(r.nominativo.slice(0, 30), { x: SX + 65, y: y - 8, size: 9, font: bold, color: nero });
      if (r.cf) pagina.drawText(r.cf, { x: SX + 65, y: y - 19, size: 7.5, font, color: grigio });
      /* inizio (verde) e fine (rosa) come nel report Access */
      pagina.drawRectangle({ x: 250, y: y - 14, width: 95, height: 13, color: verde });
      pagina.drawText(r.data_inizio ? dataIt(r.data_inizio) : '—', { x: 255, y: y - 11, size: 8.5, font, color: nero });
      pagina.drawRectangle({ x: 250, y: y - 30, width: 95, height: 13, color: rosa });
      pagina.drawText(r.data_fine ? dataIt(r.data_fine) : '', { x: 255, y: y - 27, size: 8.5, font, color: nero });
      if (r.ente) pagina.drawText(r.ente.slice(0, 22), { x: 360, y: y - 8, size: 8, font, color: nero });
      if (r.mansione) pagina.drawText(r.mansione.slice(0, 24), { x: 360, y: y - 20, size: 8.5, font: italic, color: nero });
      let yC = y - 8;
      for (const c of [r.email, r.cellulare, r.telefono].filter(Boolean).slice(0, 3)) {
        pagina.drawText(String(c).slice(0, 32), { x: 455, y: yC, size: 7.5, font, color: nero });
        yC -= 10;
      }
      if (r.note) pagina.drawText(('Note: ' + r.note).slice(0, 110), { x: SX + 65, y: y - 42, size: 7, font: italic, color: grigio });
      y -= H;
    }
    piede(pagina, m, pg + 1, pagine);
  }
  scarica(new Uint8Array(await doc.save()), `elenco-nomine-${(ruolo || 'tutte').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}
