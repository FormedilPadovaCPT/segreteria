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

/* ── applica il timbro e salva il nuovo file ────────────────
   Se non gli si dice gia' come e dove, apre l'anteprima: si vede
   il foglio, si trascina il timbro dove e' bianco, e solo allora
   si applica. L'originale non viene toccato: il timbrato si
   affianca come nuovo allegato.                                */
export async function timbraAllegato(attId, protocollo, scelta) {
  const { data: att, error: e1 } = await sb.from('s_prot_allegati').select('*').eq('id', attId).single();
  if (e1) throw new Error(e1.message);

  const { data: file, error: e2 } = await sb.storage.from(BUCKET).download(att.path);
  if (e2) throw new Error(e2.message);
  const byte = new Uint8Array(await file.arrayBuffer());

  if (!scelta) {
    const { scegliTimbro } = await import('./anteprima-timbro.js');
    scelta = await scegliTimbro(protocollo, byte);
  }
  if (!scelta) throw new Error('Timbro annullato');

  const pdf = await PDFDocument.load(byte, { ignoreEncryption: true });
  await applicaTimbro(pdf, protocollo, scelta.stile, DEPS, scelta.posizione);
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
