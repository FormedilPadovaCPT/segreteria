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
import { toast } from './core.js';

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

/* La mail «da doppio clic»: oggetto con data e ora, cc alla Direzione,
   corpo da completare — nata in persona.js per i campi email della
   persona, generalizzata il 03/09/2026 perché la stessa comodità serve
   in OGNI campo mail del gestionale (impresa, nomina, referente corso…),
   non solo lì. `chi` è il nome da mettere in oggetto e nel saluto: la
   persona, l'impresa, il referente — quel che ha senso nel contesto. */
export function bozzaMailRapida(indirizzo, chi) {
  const nome = chi || indirizzo;
  const ora = new Date();
  const zeri = (n) => String(n).padStart(2, '0');
  const quando = `${zeri(ora.getDate())}/${zeri(ora.getMonth() + 1)}/${ora.getFullYear()} ${zeri(ora.getHours())}:${zeri(ora.getMinutes())}:${zeri(ora.getSeconds())}`;
  scaricaEml({
    to: indirizzo,
    cc: ['direzione@formedilpadova.it'],
    oggetto: `FORMEDIL PADOVA - Area Sicurezza e Salute - Invio - del ${quando} - ${nome}.`,
    corpo: `Gent.le ${nome},
buongiorno,



Distinti saluti.`,
    nomeFile: `mail-${(indirizzo.split('@')[0] || 'destinatario')}.eml`,
  });
  toast(`Bozza scaricata per ${indirizzo}: aprila (Outlook parte in composizione) e premi Invia.`, 'ok');
}

/* Attacca il doppio clic a tutti i campi mail di una maschera in un
   colpo solo. Un campo si marca con `data-mail="1"` sull'<input>; il
   nome da usare in oggetto/saluto sta in `data-mail-chi` (facoltativo,
   altrimenti si usa l'indirizzo stesso). Va richiamata ogni volta che
   la maschera si ridisegna, come gli altri addEventListener. */
export function collegaDoppioClickMail(host) {
  host.querySelectorAll('input[data-mail]').forEach((inp) => {
    if (!inp.title) inp.title = 'Doppio clic per scrivere una mail';
    inp.addEventListener('dblclick', () => {
      const a = inp.value.trim();
      if (!a) return toast('Campo email vuoto.', 'err');
      bozzaMailRapida(a, inp.dataset.mailChi || '');
    });
  });
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
