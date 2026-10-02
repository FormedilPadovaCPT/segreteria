/* ============================================================
   MAIL TORNATE INDIETRO — a chi si mostrano (02/10/2026)

   Il giro `mail-respinte` registra OGNI rapporto di mancata consegna
   che arriva alla casella dell'ufficio, anche quelli di mail che con
   i verbali non c'entrano: la prima riga vera (29/09/2026) era una
   ricevuta inoltrata a mano a un indirizzo scritto male, e il
   riquadro la chiamava «verbale non consegnato».

   La regola sta qui, in un punto solo:
     · con un numero di verbale riconosciuto → «Verbali non
       consegnati»: la vede anche il tecnico in Dashboard;
     · senza → «Altre mail tornate indietro»: la guarda solo la
       segreteria.
   Il gestionale applica lo stesso criterio nella sua lettura
   (`mail-respinte-tec.js`: nr_verbale non nullo).

   Modulo puro, senza DOM: si prova con node (test/mail-respinte-viste).
   ============================================================ */

export const eDiUnVerbale = (r) => !!(r && String(r.nr_verbale || '').trim());

export function dividiRespinte(righe) {
  const verbali = [], altre = [];
  for (const r of righe || []) (eDiUnVerbale(r) ? verbali : altre).push(r);
  return { verbali, altre };
}
