/* ============================================================
   QUANTE VISITE HA UNA SERIE (06/11/2026, deciso dall'utente)

   Di norma una serie è di 10 visite, ma la segreteria può proporne un
   numero diverso (per esempio 30) e il Direttore lo autorizza sul foglio
   di autorizzazione. Il numero sta sulla pratica (s_visite_richieste.
   visite_previste) e passa all'incarico (incarichi.visite_previste), che è
   quello che il gestionale legge per fermare la serie all'ultima visita.

   Vuoto = il numero di base: lo mette il database (incarichi_previste),
   che resta l'unico posto dove «10» è scritto come regola. Qui il 10 serve
   solo a mostrarlo nel campo.
   Funzioni pure: le provano i test senza browser.
   ============================================================ */

export const VISITE_SERIE_BASE = 10;
export const VISITE_SERIE_MAX = 100;

/* il valore scritto nel campo → il numero da salvare, null (= base), o un errore da dire */
export function leggiVisitePreviste(testo) {
  const s = String(testo ?? '').trim();
  if (!s) return { valore: null };
  if (!/^\d+$/.test(s)) return { errore: 'Le visite previste devono essere un numero intero.' };
  const n = Number(s);
  if (n < 1 || n > VISITE_SERIE_MAX) return { errore: `Le visite previste vanno da 1 a ${VISITE_SERIE_MAX}.` };
  /* 10 è la base: si lascia vuoto, così se un giorno la base cambia non resta un 10 scritto a mano */
  return { valore: n === VISITE_SERIE_BASE ? null : n };
}

/* quante visite valgono per la pratica, per il foglio al Direttore e per i testi */
export function visitePrevisteDi(pratica) {
  return Number(pratica?.visite_previste) || VISITE_SERIE_BASE;
}

/* il numero da dare all'incarico: solo per le serie, e solo se diverso dalla base */
export function visitePrevisteIncarico(pratica) {
  if (pratica?.tipo_richiesta !== 'serie') return null;
  return Number(pratica?.visite_previste) || null;
}
