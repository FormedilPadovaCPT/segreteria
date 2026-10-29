/* ============================================================
   IL CANTIERE DELL'INCARICO — le regole pure (29/10/2026).
   Funzioni senza Supabase e senza DOM, per provarle con Node;
   la maschera sta in cantiere-incarico.js.
   ============================================================ */

/* Il comune scritto nel modulo («PADOVA - Q3 EST (Brenta - Venezia…)») come lo vuole
   l'anagrafica dei cantieri: il nome del comune, senza quartiere, in maiuscolo (il
   quartiere a Padova lo ricava il gestionale dall'indirizzo). Il codice ISTAT lo mette
   il database dal nome (trg_cantiere_autofill). */
export function comuneAnagrafica(testo) {
  return String(testo || '')
    .replace(/\(.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/* Il testo cercato dentro un filtro .or() di PostgREST: virgole, parentesi, asterischi
   e punti spezzerebbero il filtro, quindi diventano spazi; restano almeno 2 caratteri. */
export function testoRicerca(q) {
  const t = String(q || '').replace(/[,()*%\\.:"']/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t : '';
}

/* Indirizzo e civico scritti nel modulo in un campo solo («via Marghera 4/6»,
   «VIA GIOVANNI BOCCACCIO SNC»): il civico è l'ultima parola se comincia con una cifra
   o è SNC; altrimenti civico SNC, che è come l'anagrafica scrive «senza numero». */
export function separaCivico(testo) {
  const t = String(testo || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*\S)\s+(\d[\w/-]*|snc|s\.n\.c\.?)$/i);
  if (m) return { indirizzo: m[1].toUpperCase(), civico: /^s/i.test(m[2]) ? 'SNC' : m[2].toUpperCase() };
  return { indirizzo: t.toUpperCase(), civico: 'SNC' };
}

/* Come si legge un cantiere in un elenco: etichetta se c'è, altrimenti indirizzo e
   civico, poi lotto e comune. */
export function etichettaCantiere(c) {
  if (!c) return '';
  const base = String(c.cantiere_etichetta || c.etichetta || '').trim()
    || [c.cantiere_indirizzo || c.indirizzo, c.cantiere_civico || c.civico].filter(Boolean).join(' ');
  const lotto = c.lotto && !new RegExp('lotto\\s+' + String(c.lotto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(base)
    ? ` – lotto ${c.lotto}` : '';
  const comune = c.comune_nome || c.comune;
  return `${base}${lotto}${comune ? ` · ${comune}` : ''}`;
}

/* Che cosa scrivere sulla pratica (e sull'incarico) dalla scelta fatta nella maschera.
   lotti = righe di lotti_del_cantiere; scelta = cantiere_id di un lotto oppure 'tutti'.
   Con «tutti» l'incarico prende la scheda di partenza del complesso (la radice, quella
   senza lotto_di) o, se non si conosce, quella cercata: il complesso lo ricalcola sempre
   il database con lotti_del_cantiere, quindi valgono anche i lotti creati dopo. */
export function sceltaDaSalvare({ cercato, lotti = [], scelta }) {
  if (!cercato) return null;
  if (scelta === 'tutti') {
    if (lotti.length < 2) return { cantiere_id: cercato, tutti_i_lotti: false };
    return { cantiere_id: cercato, tutti_i_lotti: true };
  }
  const id = scelta || cercato;
  if (lotti.length && !lotti.some((l) => l.cantiere_id === id)) return null;
  return { cantiere_id: id, tutti_i_lotti: false };
}
