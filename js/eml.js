/* ============================================================
   Bozze .eml per Outlook, con allegati.

   La riga «X-Unsent: 1» fa aprire il file nella finestra di
   composizione invece che come messaggio ricevuto: si rilegge,
   si sceglie l'account (cpt@formedilpadova.it) e si preme Invia
   a mano. È il confine di sempre: quello che esce dall'ufficio
   lo manda una persona.

   Dal 03/09/2026 ogni bozza porta la firma vera dell'ufficio —
   logo, orari, servizi, nota privacy — in HTML, con la versione in
   righe accanto per chi non legge l'HTML. Il messaggio lo compone
   js/firma.js, che è lo stesso modulo usato dalle mail del
   protocollo (edge function send-protocollo): una firma sola.
   ============================================================ */

import { componiEml, FIRMA_SEGRETERIA } from './firma.js';

export { FIRMA_SEGRETERIA };

/* Per le mail SENZA allegato: mailto: apre direttamente la finestra
   di composizione dell'app di posta predefinita (Outlook), senza
   passare da un file. Il protocollo mailto non puo' portare allegati
   né HTML (quindi nemmeno il logo): quando serve una delle due cose
   resta la strada del .eml. */
export function apriMailto({ to = '', cc = [], oggetto = '', corpo = '' }) {
  const p = new URLSearchParams();
  if (cc.length) p.set('cc', cc.join(','));
  p.set('subject', oggetto);
  p.set('body', corpo);
  /* URLSearchParams codifica gli spazi come «+», che i client di posta
     leggono alla lettera: si riportano alla forma %20 */
  window.location.href = `mailto:${encodeURIComponent(to)}?${p.toString().replace(/\+/g, '%20')}`;
}

/* Compone la bozza e la scarica. `allegati` = [{nome, byte, mime?}].
   Il corpo si scrive in righe; se un modulo ci ha già accodato
   FIRMA_SEGRETERIA non fa danno, viene riconosciuta e sostituita
   dalla firma completa. `firma: false` per una mail senza firma. */
export function scaricaEml({ to = '', cc = [], oggetto, corpo, allegati = [], nomeFile = 'bozza.eml', firma = true }) {
  const eml = componiEml({ to, cc, oggetto, corpo, allegati, firma, unsent: true });
  scaricaTesto(eml, nomeFile);
}

function scaricaTesto(eml, nomeFile) {
  const url = URL.createObjectURL(new Blob([new TextEncoder().encode(eml)], { type: 'message/rfc822' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
