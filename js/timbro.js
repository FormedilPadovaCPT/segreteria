/* ============================================================
   Timbro di protocollo sui PDF — lato browser.
   Il disegno vero e proprio sta in timbro-disegno.js, condiviso
   con gli strumenti da riga di comando: qui si caricano le
   librerie dal CDN, si scarica il file dallo storage, si timbra
   e si risalva. Cosi' il timbro e' uno solo.
   ============================================================ */

import { sb, state, siglaProtocollo } from './core.js';
import { BUCKET } from './config.js';
import { pdfLib, qrGen } from './cdn.js';
import { applicaTimbro, testoQr } from './timbro-disegno.js';

const { PDFDocument, rgb, StandardFonts, degrees } = await pdfLib();
const qrcode = await qrGen();

/* Le librerie che il disegno si aspetta di ricevere dall'esterno. */
const DEPS = { rgb, degrees, StandardFonts, qrcode };

export { testoQr };

/* ── applica il timbro e salva il nuovo file ──────────────── */
export async function timbraAllegato(attId, protocollo, stile) {
  if (!stile) stile = await chiediStile();
  if (!stile) throw new Error('Timbro annullato');

  const { data: att, error: e1 } = await sb.from('s_prot_allegati').select('*').eq('id', attId).single();
  if (e1) throw new Error(e1.message);

  const { data: file, error: e2 } = await sb.storage.from(BUCKET).download(att.path);
  if (e2) throw new Error(e2.message);

  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  await applicaTimbro(pdf, protocollo, stile, DEPS);
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
