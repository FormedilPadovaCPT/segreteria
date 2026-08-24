/* ============================================================
   Timbro di protocollo sui PDF.
   Due impaginazioni, come in Access:
     · blocco  → riquadro in alto a sinistra della prima pagina
     · striscia→ fascia verticale sul bordo sinistro di ogni pagina
   Il QR contiene: Prot_<n> <data> <oggetto> <nominativo>
   Il QR è disegnato come vettore (quadratini), così resta nitido
   in stampa e non serve incorporare immagini.
   ============================================================ */

import { PDFDocument, rgb, StandardFonts, degrees } from 'https://esm.sh/pdf-lib@1.17.1';
import qrcode from 'https://esm.sh/qrcode-generator@1.4.4';
import { sb, state, esc, dataIt } from './app.js';
import { BUCKET, ENTE } from './config.js';

const ARANCIO = rgb(0.906, 0.314, 0.059);
const GRIGIO = rgb(0.337, 0.361, 0.400);
const NERO = rgb(0.1, 0.1, 0.12);

/* ── testo del QR ─────────────────────────────────────────── */
export function testoQr(p) {
  const nominativo = p.impresa_nome || p.persona || p.alla_ca || '';
  return [
    `Prot_${p.numero}`,
    dataIt(p.data_prot),
    (p.oggetto || '').slice(0, 90),
    nominativo.slice(0, 60),
  ].filter(Boolean).join(' ');
}

/* ── disegna il QR come griglia di quadratini ─────────────── */
function disegnaQr(page, testo, x, y, lato) {
  const qr = qrcode(0, 'M');
  qr.addData(testo);
  qr.make();
  const n = qr.getModuleCount();
  const passo = lato / n;
  page.drawRectangle({ x, y, width: lato, height: lato, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      page.drawRectangle({
        x: x + c * passo,
        y: y + lato - (r + 1) * passo,
        width: passo + 0.2,
        height: passo + 0.2,
        color: NERO,
      });
    }
  }
}

/* ── impaginazione a blocco (prima pagina) ────────────────── */
function timbroBlocco(page, p, font, bold) {
  const { height } = page.getSize();
  const L = 26, W = 208, H = 92;
  const y = height - H - 26;

  page.drawRectangle({ x: L, y, width: W, height: H, color: rgb(1, 1, 1), opacity: 0.92 });
  page.drawRectangle({ x: L, y, width: W, height: H, borderColor: ARANCIO, borderWidth: 1.4 });
  page.drawRectangle({ x: L, y: y + H - 17, width: W, height: 17, color: ARANCIO });

  page.drawText(ENTE.nome, { x: L + 7, y: y + H - 13, size: 8.5, font: bold, color: rgb(1, 1, 1) });

  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';
  page.drawText(`PROTOCOLLO IN ${dir}`, { x: L + 7, y: y + H - 31, size: 7, font: bold, color: GRIGIO });
  page.drawText(`n° ${p.numero}`, { x: L + 7, y: y + H - 52, size: 17, font: bold, color: ARANCIO });
  page.drawText(`del ${dataIt(p.data_prot)}`, { x: L + 7, y: y + H - 66, size: 8.5, font, color: NERO });
  page.drawText(ENTE.area, { x: L + 7, y: y + 8, size: 6.5, font, color: GRIGIO });

  disegnaQr(page, testoQr(p), L + W - 66, y + 12, 58);
}

/* ── impaginazione a striscia (tutte le pagine) ───────────── */
function timbroStriscia(page, p, font, bold) {
  const { height } = page.getSize();
  const larg = 30;

  page.drawRectangle({ x: 0, y: 0, width: larg, height, color: rgb(1, 1, 1), opacity: 0.9 });
  page.drawRectangle({ x: larg - 2.2, y: 0, width: 2.2, height, color: ARANCIO });

  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';
  const testo = `${ENTE.nome} · PROTOCOLLO IN ${dir} n° ${p.numero} del ${dataIt(p.data_prot)}`;

  page.drawText(testo, {
    x: 19, y: 96, size: 8.5, font: bold, color: GRIGIO, rotate: degrees(90),
  });

  disegnaQr(page, testoQr(p), 3, 24, 24);
}

/* ── applica il timbro e salva il nuovo file ──────────────── */
export async function timbraAllegato(attId, protocollo, stile) {
  if (!stile) stile = await chiediStile();
  if (!stile) throw new Error('Timbro annullato');

  const { data: att, error: e1 } = await sb.from('s_prot_allegati').select('*').eq('id', attId).single();
  if (e1) throw new Error(e1.message);

  const { data: file, error: e2 } = await sb.storage.from(BUCKET).download(att.path);
  if (e2) throw new Error(e2.message);

  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  if (stile === 'striscia') pdf.getPages().forEach((pg) => timbroStriscia(pg, protocollo, font, bold));
  else timbroBlocco(pdf.getPages()[0], protocollo, font, bold);

  pdf.setSubject(`Protocollo ${protocollo.direzione} n° ${protocollo.numero} del ${dataIt(protocollo.data_prot)}`);
  const bytes = await pdf.save();

  const nome = att.nome.replace(/\.pdf$/i, '') + `_prot${protocollo.numero}.pdf`;
  const path = att.path.replace(/([^/]+)$/, `${Date.now()}_timbrato.pdf`);

  const { error: e3 } = await sb.storage.from(BUCKET)
    .upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
  if (e3) throw new Error(e3.message);

  await sb.from('s_prot_allegati').insert({
    protocollo_id: protocollo.id,
    nome, path, mime: 'application/pdf',
    dimensione: bytes.length, timbrato: true, created_by: state.email,
  });

  return { nome, path };
}

/* ── scelta dell'impaginazione ────────────────────────────── */
function chiediStile() {
  return new Promise((risolvi) => {
    const bg = document.createElement('div');
    bg.className = 'drawer-bg';
    bg.style.zIndex = 60;
    bg.innerHTML = `
      <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;
                  border-radius:10px;padding:22px;width:min(420px,92vw);box-shadow:var(--ombra)">
        <h3 style="margin:0 0 6px;font-size:17px">Come applico il timbro?</h3>
        <p style="margin:0 0 16px;color:var(--testo-soft);font-size:13px">
          Il QR riporterà numero, data, oggetto e nominativo.
        </p>
        <button class="btn btn-primary btn-block" data-s="blocco" style="margin-top:0">
          Blocco in alto a sinistra <small style="font-weight:400">— solo prima pagina</small>
        </button>
        <button class="btn btn-ghost btn-block" data-s="striscia">
          Striscia sul bordo <small style="font-weight:400">— su tutte le pagine</small>
        </button>
        <button class="btn btn-ghost btn-block" data-s="">Annulla</button>
      </div>`;
    document.body.appendChild(bg);
    bg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]');
      if (!b && e.target !== bg) return;
      const scelta = b ? b.dataset.s : '';
      bg.remove();
      risolvi(scelta || null);
    });
  });
}
