/* ============================================================
   Timbro di protocollo sui PDF.
   Due impaginazioni, come in Access:
     · blocco  → riquadro in alto a sinistra della prima pagina
     · striscia→ fascia verticale sul bordo sinistro di ogni pagina
   Il QR contiene: Prot_<n> <data> <oggetto> <nominativo>
   Il QR è disegnato come vettore (quadratini), così resta nitido
   in stampa e non serve incorporare immagini.
   ============================================================ */

import { sb, state, dataIt, codiceProtocollo, siglaProtocollo } from './core.js';
import { BUCKET, ENTE } from './config.js';
import { pdfLib, qrGen } from './cdn.js';

const { PDFDocument, rgb, StandardFonts, degrees } = await pdfLib();
const qrcode = await qrGen();

const ARANCIO = rgb(0.906, 0.314, 0.059);
const GRIGIO = rgb(0.337, 0.361, 0.400);
const NERO = rgb(0.1, 0.1, 0.12);

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

/* ── impaginazione a blocco (prima pagina) ──────────────────
   Riprende la griglia del timbro Access: numero e data in
   evidenza, poi mezzo, oggetto, ufficio, cartella e referente.  */
function timbroBlocco(page, p, font, bold) {
  const { height } = page.getSize();
  const L = 26, W = 268, H = 172;
  const y = height - H - 26;
  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';

  page.drawRectangle({ x: L, y, width: W, height: H, color: rgb(1, 1, 1), opacity: 0.93 });
  page.drawRectangle({ x: L, y, width: W, height: H, borderColor: ARANCIO, borderWidth: 1.4 });
  page.drawRectangle({ x: L, y: y + H - 16, width: W, height: 16, color: ARANCIO });

  page.drawText(`${ENTE.nome} · ${ENTE.area}`.toUpperCase().slice(0, 46),
    { x: L + 6, y: y + H - 12, size: 7, font: bold, color: rgb(1, 1, 1) });

  /* numero e data in evidenza */
  page.drawText(`PROTOCOLLO IN ${dir}`, { x: L + 7, y: y + H - 30, size: 6.5, font: bold, color: GRIGIO });
  const codice = codiceProtocollo(p);
  page.drawText(p.esercizio ? codice : `n° ${p.numero}`,
    { x: L + 7, y: y + H - 51, size: p.esercizio ? 13 : 17, font: bold, color: ARANCIO });
  page.drawText(`del ${dataIt(p.data_prot)}`, { x: L + 7, y: y + H - 65, size: 8.5, font, color: NERO });

  /* QR a destra */
  disegnaQr(page, testoQr(p), L + W - 62, y + H - 74, 54);

  /* griglia dei riferimenti */
  page.drawLine({
    start: { x: L + 6, y: y + H - 74 }, end: { x: L + W - 6, y: y + H - 74 },
    thickness: 0.6, color: ARANCIO,
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
    page.drawText(etichetta, { x: L + 7, y: ry, size: 6, font: bold, color: GRIGIO });
    page.drawText(taglia(valore, 7.5, W - 66), { x: L + 52, y: ry, size: 7.5, font, color: NERO });
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
function timbroStriscia(page, p, font, bold) {
  const { height } = page.getSize();
  const larg = 30;

  page.drawRectangle({ x: 0, y: 0, width: larg, height, color: rgb(1, 1, 1), opacity: 0.9 });
  page.drawRectangle({ x: larg - 2.2, y: 0, width: 2.2, height, color: ARANCIO });

  const dir = p.direzione === 'IN' ? 'ENTRATA' : 'USCITA';
  const rif = p.esercizio ? codiceProtocollo(p) : `n° ${p.numero}`;
  const testo = `${ENTE.nome} · PROTOCOLLO IN ${dir} ${rif} del ${dataIt(p.data_prot)}`;

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

  pdf.setSubject(`Protocollo ${siglaProtocollo(protocollo)} del ${dataIt(protocollo.data_prot)}`);
  const bytes = await pdf.save();

  const nome = att.nome.replace(/\.pdf$/i, '') + `_${siglaProtocollo(protocollo)}.pdf`;
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
