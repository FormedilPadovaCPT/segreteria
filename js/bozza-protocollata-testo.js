/* ============================================================
   La mail protocollata scritta da un modulo dei servizi — la parte
   senza browser (18/11/2026).

   Perché esiste: «Trasmetti la risposta all'impresa» delle consulenze e
   la segnalazione agli organi dei cantieri critici prendevano il numero
   e poi componevano la mail da sé, con il protocollo scritto in una
   riga di testo in testa. Il cartiglio col QR (banda arancione, numero,
   data, griglia) lo disegna soltanto la funzione send-protocollo, la
   stessa di «Invia protocollato»: da lì devono passare tutte le mail
   protocollate in uscita. Caso: risposta alla consulenza m10 (impresa
   Basso, Prot_26-27_0158), uscita senza cartiglio.

   Qui le due cose che servono prima e dopo la chiamata:
   - dividiLettera: il testo scritto dal modulo diviso in apertura
     («Spett.le …, / buongiorno,») e corpo, perché la funzione mette
     l'apertura sotto il cartiglio e il corpo dopo;
   - noteDaMail: il testo completo della mail per il campo note del
     protocollo, nella forma che `mailDaNote` (lookups.js) sa rileggere
     (regola del 02/10/2026: prima riga «Da:», poi A, Cc, Oggetto,
     Allegati, riga vuota, saluto e corpo, senza firma).
   ============================================================ */

export const MITTENTE_NOTE = 'Formedil Padova - Area Sicurezza e Salute <cpt@formedilpadova.it>';

/* L'apertura è il primo blocco del testo, fino alla prima riga vuota,
   se ha l'aria di un saluto; altrimenti tutto è corpo e l'apertura la
   sceglie la funzione («Gent.le <persona>, buongiorno,»). */
const APERTURA = /^(gent\.?(le|mo|ma|ili)?|gentil[ei]ssim[oa]|gentile|spett\.?(le|abile)?|egregi[oa]|alla c\.a\.|buongiorno|buonasera)\b/i;

export function dividiLettera(testo) {
  const t = String(testo ?? '').replace(/\r\n/g, '\n').trim();
  const k = t.indexOf('\n\n');
  const primo = (k >= 0 ? t.slice(0, k) : t).trim();
  if (k < 0 || !APERTURA.test(primo)) return { saluto: '', messaggio: t };
  return { saluto: primo, messaggio: t.slice(k).trim() };
}

const lista = (x) => (Array.isArray(x) ? x : String(x ?? '').split(/[,;]/))
  .map((s) => String(s).trim()).filter(Boolean);

export function noteDaMail({ to, cc = [], oggetto = '', allegati = [], saluto = '', messaggio = '' }) {
  const copia = lista(cc);
  const nomi = lista(allegati);
  return [
    `Da: ${MITTENTE_NOTE}`,
    `A: ${lista(to).join(', ')}`,
    ...(copia.length ? [`Cc: ${copia.join(', ')}`] : []),
    `Oggetto: ${String(oggetto).replace(/[\r\n]+/g, ' ').trim()}`,
    `Allegati: ${nomi.length ? nomi.join('; ') : 'nessuno'}`,
    '',
    ...(String(saluto).trim() ? [String(saluto).trim(), ''] : []),
    String(messaggio).trim(),
  ].join('\n');
}

export { lista as listaIndirizzi };
