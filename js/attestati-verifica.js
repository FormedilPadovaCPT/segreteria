/* ============================================================
   VERIFICA PUBBLICA DEGLI ATTESTATI (17/09/2026, deciso dall'utente)

   Ogni attestato della serie N/aaaa porta un CODICE DI VERIFICA e un
   QR che punta alla pagina del portale servizi
   https://formedilpadovacpt.github.io/servizi/verifica/?n=12-2026&c=ABCDEFGHJK
   Chi lo inquadra vede se l'attestato è valido o revocato, con i soli
   dati minimi (iniziali, corso, ore, date).

   - Il codice nasce QUI, quando si genera l'attestato, perché deve
     finire dentro il QR. Dieci caratteri da un alfabeto senza 0/O/1/I
     (32 simboli, 50 bit): non si indovina, e si detta senza equivoci.
   - I dati li copia sul progetto Servizi la funzione attestati-verifica
     (vedi aggiornaVerificaPubblica in corsi.js); il codice in chiaro non
     esce mai, va solo la sua impronta.
   - Gli attestati storici (numero senza «/») non hanno codice né pagina:
     il loro QR resta testo, e senza codice fiscale.
   ============================================================ */

export const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const URL_VERIFICA_PREDEFINITA = 'https://formedilpadovacpt.github.io/servizi/verifica/';

/* rng(n) → Uint8Array di n byte casuali (iniettabile nei test) */
export function generaCodice(rng = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const byte = rng(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += ALFABETO[byte[i] % 32];   // 256 è multiplo di 32: nessuno sbilanciamento
  return out;
}

/* «ABCDEFGHJK» → «ABCDE-FGHJK», come si stampa */
export function formattaCodice(codice) {
  const c = String(codice || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c;
}

export function serieVerificabile(numero) {
  return /^\d{1,6}\/\d{4}$/.test(String(numero || ''));
}

export function urlVerifica(numero, codice, base = URL_VERIFICA_PREDEFINITA) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}?n=${encodeURIComponent(String(numero).replace('/', '-'))}&c=${encodeURIComponent(String(codice).toUpperCase())}`;
}
