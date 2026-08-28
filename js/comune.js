/* ============================================================
   Funzioni pure, senza dipendenze: nessun Supabase, nessun DOM,
   nessuna libreria caricata da CDN.
   Stanno in un modulo a sé perché servono in due mondi diversi —
   il browser (che passa da core.js) e Node (gli strumenti da riga
   di comando, che devono timbrare un PDF senza aprire una pagina).
   Se il modo di scrivere un numero di protocollo vivesse dentro
   core.js, Node non potrebbe leggerlo senza tirarsi dietro il
   client Supabase.
   ============================================================ */

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function dataIt(iso) {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return g && m && a ? `${g}/${m}/${a}` : iso;
}

export function oggiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── come si scrive il numero di protocollo ────────────────
   Fino al 30/09/2026 due registri separati: il numero da solo
   non basta, serve la direzione (2554-out). Dal 01/10/2026 una
   serie sola per esercizio: Prot_26-27_0001.
   Il codice lo calcola il database nella colonna `codice`: qui
   si usa quello, e si ricostruisce a mano solo per l'anteprima
   del form, dove la riga non esiste ancora.
   ────────────────────────────────────────────────────────── */
export function codiceProtocollo(p) {
  if (!p) return '';
  if (p.codice) return p.codice;
  if (p.esercizio) return `Prot_${p.esercizio}_${String(p.numero ?? '').padStart(4, '0')}`;
  const coda = p.direzione === 'IN' ? '-in' : p.direzione === 'OUT' ? '-out' : '';
  return `${p.numero ?? ''}${coda}`;
}

/* Come si scrive su un documento, in un QR o in un nome di file:
   sempre con il prefisso Prot_, come vuole la convenzione del vault. */
export function siglaProtocollo(p) {
  const c = codiceProtocollo(p);
  return c.startsWith('Prot_') ? c : `Prot_${c}`;
}

/* Come si legge dentro una frase, non in una colonna. */
export function protocolloEsteso(p) {
  if (!p) return '';
  if (p.esercizio) return codiceProtocollo(p);
  return `n° ${p.numero} in ${p.direzione === 'IN' ? 'entrata' : 'uscita'}`;
}

/* Esercizio dell'ente (1/10-30/9) in forma AA-AA: la stessa
   regola della funzione s_esercizio nel database. */
export function esercizioDi(iso) {
  const [a, m] = String(iso || oggiIso()).slice(0, 10).split('-').map(Number);
  const primo = m >= 10 ? a : a - 1;
  return `${String(primo % 100).padStart(2, '0')}-${String((primo + 1) % 100).padStart(2, '0')}`;
}
