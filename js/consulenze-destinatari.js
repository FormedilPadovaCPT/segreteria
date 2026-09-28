/* ============================================================
   Risposta a una consulenza: chi ha risposto e chi va in copia
   (28/09/2026, regola dell'utente dopo la consulenza n. 2)

   La risposta all'impresa esce PROTOCOLLATA, e in copia vanno il
   coordinatore e chi ha fornito la risposta, se non è lui. Chi
   risponde è la persona a cui il quesito è stato girato: la
   segreteria la risposta la incolla e la trasmette, non è lei che
   l'ha data.

   Senza documento né rete, così si prova da Node.
   ============================================================ */
const uguale = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* l'indirizzo di chi ha fornito la risposta.
   Vince la persona a cui il quesito è stato girato; `risposta_da` vale
   solo se non è la segreteria stessa (fino al 28/09 il Salva ci
   scriveva chi stava salvando, cioè la segreteria). */
export function chiHaRisposto(pratica, emailSegreteria) {
  const girata = String(pratica?.girata_a || '').trim();
  if (girata) return girata;
  const da = String(pratica?.risposta_da || '').trim();
  if (da && !uguale(da, emailSegreteria)) return da;
  return String(emailSegreteria || '').trim();
}

/* chi va in copia: il coordinatore sempre, poi chi ha risposto se è
   un altro. Mai la segreteria (la mail parte da lei), mai l'impresa,
   mai due volte lo stesso indirizzo. */
export function copiaRisposta({ pratica, coordinatore, emailSegreteria }) {
  const out = [];
  const aggiungi = (e) => {
    const x = String(e || '').trim();
    if (!x || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) return;
    if (uguale(x, emailSegreteria) || uguale(x, pratica?.email)) return;
    if (out.some((y) => uguale(y, x))) return;
    out.push(x);
  };
  aggiungi(coordinatore);
  aggiungi(chiHaRisposto(pratica, emailSegreteria));
  return out;
}
