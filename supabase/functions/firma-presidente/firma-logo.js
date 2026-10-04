/* ============================================================
   IL LOGO DELLA FIRMA, PER LA EDGE FUNCTION — non incorporato.

   ⚠️ Questa NON è una copia di js/firma-logo.js, ed è voluto.
   Nella webapp il logo è una stringa base64 di 18.688 caratteri
   dentro al modulo: sul sito viaggia come file e arriva intatta.
   Qui no: la funzione si distribuisce passando il testo dei file
   attraverso un'API, e in quel passaggio la stringa è stata
   TRONCATA di 451 caratteri — proprio dentro alla lunga fila di «A»
   dei metadati del JPEG, dove nessuno se ne accorge. Il risultato è
   un base64 non decodificabile: Outlook non protesta, mostra
   semplicemente la mail senza logo (successo il 07/09/2026,
   sull'inoltro del Prot. 2019-in).

   Quindi qui dentro non c'è nessuna stringa lunga da ricopiare: il
   logo si prende a runtime dal SITO, che è il file versionato in git
   (img/logo-firma.jpg), e si controlla con lo SHA-256. Se non
   combacia non si allega niente: meglio una mail senza logo che una
   con l'immagine rotta.

   `LOGO_FIRMA_B64` è esportata con `let` apposta: firma.js la importa
   e in ESM il legame è vivo, quindi vede il valore che caricaLogo()
   ci scrive dentro, senza che firma.js debba cambiare di una riga.
   ============================================================ */

export const LOGO_FIRMA_MIME = 'image/jpeg';
export const LOGO_FIRMA_LARGHEZZA = 230;
export const LOGO_FIRMA_ALTEZZA = 74;

/* Il file ufficiale: sta in git (segreteria/img/logo-firma.jpg) ed è
   pubblicato da GitHub Pages. Un solo posto, per la webapp e per qui. */
export const LOGO_URL = 'https://formedilpadovacpt.github.io/segreteria/img/logo-firma.jpg';
/* sha256sum img/logo-firma.jpg — 14.014 byte */
export const LOGO_SHA256 = '1e0efb34b4bfd02a363fe7c793e25e1c4bb866a4e34d2f3021c497a800a2d6b6';

export let LOGO_FIRMA_B64 = '';

const esadecimale = (buf) => [...new Uint8Array(buf)]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/* Da chiamare PRIMA di comporre il messaggio. Non lancia: se il logo
   non arriva o non è quello giusto lo dice a chi chiama, che toglie
   l'immagine dalla firma. */
export async function caricaLogo() {
  if (LOGO_FIRMA_B64) return { ok: true, giaCaricato: true };
  try {
    const r = await fetch(LOGO_URL);
    if (!r.ok) return { ok: false, motivo: `il sito ha risposto ${r.status}` };
    const byte = new Uint8Array(await r.arrayBuffer());
    const sha = esadecimale(await crypto.subtle.digest('SHA-256', byte));
    if (sha !== LOGO_SHA256) {
      return { ok: false, motivo: `impronta diversa da quella attesa (${sha.slice(0, 12)}…)` };
    }
    let bin = '';
    const PEZZO = 0x8000;
    for (let i = 0; i < byte.length; i += PEZZO) bin += String.fromCharCode(...byte.subarray(i, i + PEZZO));
    LOGO_FIRMA_B64 = btoa(bin);
    return { ok: true, byte: byte.length };
  } catch (e) {
    return { ok: false, motivo: (e && e.message) || String(e) };
  }
}
