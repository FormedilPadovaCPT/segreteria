/* ============================================================
   L'ORARIO DI UNA GIORNATA DI CORSO — scritto in un posto solo.

   Una giornata può avere DUE turni (mattina e pomeriggio):
   `dalle/alle` e `dalle2/alle2`. Il testo si compone unendo con
   «e» le fasce che ci sono davvero.

   ⚠️ Il difetto che ha fatto nascere questo modulo (21/09/2026,
   notato dall'utente sulla scheda corso e poi sul registro): la
   «e» era scritta prima del secondo turno — `fascia(dalle, alle)
   + (dalle2 ? ' e …' : '')` — quindi una lezione del SOLO
   pomeriggio usciva «e 14:30–18:00», con un congiuntore che non
   congiungeva niente. Succedeva davvero: la giornata del
   23/09/2026 ha il primo turno vuoto, ed è un dato corretto —
   una lezione pomeridiana.

   La «e» non si scrive accanto a una fascia: si mette FRA le
   fasce che esistono. Il formattatore arriva da fuori perché i
   due chiamanti usano separatori diversi (l'app la lineetta, il
   PDF il suo `fascia`), e il modulo non deve saperlo.
   ============================================================ */

/** Il testo dell'orario di una giornata.
 *  g      — la riga della giornata (dalle, alle, dalle2, alle2)
 *  fascia — (dalle, alle) => testo della singola fascia, '' se non c'è
 *  Restituisce '' quando non c'è nessun orario. */
export function orarioGiornata(g, fascia) {
  if (!g) return '';
  return [fascia(g.dalle, g.alle), fascia(g.dalle2, g.alle2)]
    .filter(Boolean)
    .join(' e ');
}
