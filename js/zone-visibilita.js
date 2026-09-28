/* ============================================================
   «Vede solo le sue visite»: chi ne è esente (28/09/2026)

   Nel database la restrizione non vale per chi ha ruolo
   segreteria o admin (solo_proprie() finisce con
   «and not is_segreteria()»): deve vedere tutti i verbali per
   controllarli e liquidare. La casella sul loro nome quindi
   non fa niente, e una casella che non fa niente non va
   offerta. Qui la stessa regola, senza documento né rete,
   così si prova da Node.
   ============================================================ */
const RUOLI_ESENTI = ['segreteria', 'admin'];   // gli stessi di is_segreteria()

/* indirizzi (minuscoli) che la restrizione non tocca */
export function indirizziEsenti(ruoli) {
  return new Set((ruoli || [])
    .filter((r) => RUOLI_ESENTI.includes(r.ruolo) && r.stato === 'attivo' && r.email)
    .map((r) => String(r.email).trim().toLowerCase()));
}

/* come si disegna la casella di un tecnico.
   esenti === null vuol dire «ruoli non letti»: non si spegne niente.
   Esente con la spunta rimasta: la casella resta viva, per poterla togliere. */
export function statoCasella(tecnico, esenti) {
  const esente = !!esenti && !!tecnico.email && esenti.has(String(tecnico.email).trim().toLowerCase());
  const spuntata = !!tecnico.vede_solo_proprie;
  if (!esente) return { esente, spuntata, spenta: false, nota: '' };
  return spuntata
    ? { esente, spuntata, spenta: false, nota: 'è segreteria: vede sempre tutto, la spunta non ha effetto e si può togliere' }
    : { esente, spuntata, spenta: true, nota: 'vede sempre tutto: è segreteria' };
}
