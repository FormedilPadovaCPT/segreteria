/* ============================================================
   Timbro di protocollo sui PDF — lato browser.
   Il disegno vero e proprio sta in timbro-disegno.js, condiviso
   con gli strumenti da riga di comando: qui si caricano le
   librerie dal CDN, si scarica il file dallo storage, si timbra
   e si risalva. Cosi' il timbro e' uno solo.
   ============================================================ */

import { sb, state, siglaProtocollo } from './core.js';
import { leggiByte, caricaByte, cestina, dove } from './drive.js';
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

  if (!att.drive_file_id) throw new Error('Questo allegato non sta su Drive: non posso rileggerlo.');
  const byte = await leggiByte(att.drive_file_id);

  if (!scelta) {
    const { scegliTimbro } = await import('./anteprima-timbro.js');
    scelta = await scegliTimbro(protocollo, byte);
  }
  if (!scelta) throw new Error('Timbro annullato');

  const pdf = await PDFDocument.load(byte, { ignoreEncryption: true });
  await applicaTimbro(pdf, protocollo, scelta.stile, DEPS, scelta.posizione);
  const bytes = await pdf.save();

  /* ⚠️ Il timbrato nasce NELLA STESSA CARTELLA dell'originale: il
     documento sta dove le regole di smistamento hanno deciso, e il
     timbro non e' una ragione per spostarlo. */
  let dovEra = null;
  try { dovEra = await dove(att.drive_file_id); } catch { /* si ripiega sulla zona d'attesa */ }

  const nome = att.nome.replace(/\.pdf$/i, '') + `_${siglaProtocollo(protocollo)}.pdf`;
  const su = await caricaByte(protocollo, nome, bytes, 'application/pdf', dovEra?.parent_id || null);

  await sb.from('s_prot_allegati').insert({
    protocollo_id: protocollo.id,
    nome: su.file_name || nome, mime: 'application/pdf',
    dimensione: bytes.length, timbrato: true, created_by: state.email,
    drive_file_id: su.drive_file_id, drive_url: su.drive_url,
  });

  /* Che fare dell'originale: lo decide chi timbra, ogni volta. Di una
     circolare si tiene la sola copia protocollata; di un contratto
     firmato o di una scansione unica si conserva l'originale. */
  if (scelta.originale === 'cestina') {
    await cestina(att.drive_file_id);
    await sb.from('s_prot_allegati').delete().eq('id', att.id);
  }

  return {
    nome: su.file_name || nome,
    drive_url: su.drive_url,
    cartella: dovEra?.cartella || su.cartella || null,
    originale: scelta.originale === 'cestina' ? 'cestinato' : 'conservato',
  };
}
