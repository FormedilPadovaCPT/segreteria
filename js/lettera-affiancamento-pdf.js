/* ============================================================
   Il PDF della lettera di affiancamento (21/10/2026), sulla carta
   intestata Formedil delle nomine (nomine-pdf.js). Restituisce i byte
   e i due riquadri dove firma-documenti appone le firme: a destra il
   Direttore, a sinistra il tecnico per accettazione.
   Sta da solo, senza core.js, perché lo si possa provare anche fuori
   dal browser.
   ============================================================ */

import { dataIt, spezza, testoPdf } from './comune.js';
import { COLORI } from './config.js';
import { apriDocumento, intestazione } from './nomine-pdf.js';
import { nominativo } from './lettera-affiancamento-regole.js';

const A4 = [595.28, 841.89];
const SX = 57, DX = 538;

export async function pdfLettera({ affiancato, testo, sigla, dataLettera }) {
  const m = await apriDocumento();
  const { doc, font, bold, rgb } = m;
  const nero = rgb(0.12, 0.12, 0.12);
  const grigio = rgb(...COLORI.grigio);
  const pagina = doc.addPage(A4);
  let y = intestazione(pagina, m);
  const scrivi = (t, x, yy, f = font, s = 10.5, c = nero) => pagina.drawText(testoPdf(t), { x, y: yy, size: s, font: f, color: c });

  /* destinatario a destra, data e protocollo a sinistra */
  scrivi('Al', 330, y, font, 10.5, grigio);
  scrivi(nominativo(affiancato), 330, y - 14, bold);
  if (affiancato.email) scrivi(affiancato.email, 330, y - 28, font, 9.5, grigio);
  scrivi(`Padova, ${dataIt(dataLettera)}`, SX, y);
  scrivi(sigla, SX, y - 14, font, 9.5, grigio);
  y -= 62;

  scrivi('Oggetto:', SX, y, bold);
  scrivi(testo.oggetto, SX + 50, y, bold);
  y -= 26;

  for (const p of testo.paragrafi) {
    for (const r of spezza(font, 10.5, testoPdf(p), DX - SX, 30)) { scrivi(r, SX, y); y -= 15; }
    y -= 8;
  }

  /* le due firme: a destra il Direttore, a sinistra il tecnico per accettazione */
  y -= 18;
  scrivi('Il Direttore', 330, y, bold);
  scrivi('Per accettazione — il tecnico', SX, y, bold);
  scrivi(nominativo(affiancato), SX, y - 13, font, 9.5, grigio);
  const riquadroDirettore = { pagina: 0, x: 330, y: y - 16 - 60, w: 150, h: 60 };
  const riquadroTecnico = { pagina: 0, x: SX, y: y - 26 - 60, w: 150, h: 60 };
  if (riquadroTecnico.y < 40) throw new Error('Il testo è troppo lungo per una pagina: accorcia il periodo o i nomi.');
  return { byte: new Uint8Array(await doc.save()), riquadroDirettore, riquadroTecnico };
}
