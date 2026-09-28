/* ============================================================
   Secondi indirizzi (28/09/2026)

   C'è chi la casella d'ufficio non la guarda mai. Per loro ogni
   bozza di mail va ANCHE a un secondo indirizzo: quello d'ufficio
   resta, perché è l'account con cui si entra nelle app, l'altro si
   aggiunge. Gli indirizzi stanno nel database (s_secondi_indirizzi),
   non qui: il repository è pubblico.

   La regola vive in un punto solo: scaricaEml (js/eml.js) allarga
   «A» e «Cc» di ogni bozza. Chi scrive un modulo nuovo non deve
   ricordarsi niente.

   `allarga` è pura, così si prova da Node; `carica` legge la
   tabella una volta, all'avvio.
   ============================================================ */
const pulito = (e) => String(e || '').trim();
const chiave = (e) => pulito(e).toLowerCase();

/* Dati gli indirizzi di una riga (A oppure Cc) e la mappa
   indirizzo → secondo indirizzo, restituisce la riga allargata:
   dopo ogni indirizzo che ne ha uno, il suo secondo. Niente doppioni,
   a maiuscole ignorate; `giaPresenti` sono gli indirizzi dell'altra
   riga, che non vanno ripetuti. */
export function allarga(indirizzi, mappa, giaPresenti = []) {
  const visti = new Set((giaPresenti || []).map(chiave).filter(Boolean));
  const out = [];
  const metti = (e) => { const k = chiave(e); if (!k || visti.has(k)) return; visti.add(k); out.push(pulito(e)); };
  for (const e of indirizzi || []) {
    metti(e);
    const altro = mappa && (mappa.get ? mappa.get(chiave(e)) : mappa[chiave(e)]);
    if (altro) metti(altro);
  }
  return out;
}

/* «A» arriva come testo («a@x, b@y» oppure con il punto e virgola) */
export const inLista = (testo) => String(testo || '').split(/[,;]/).map(pulito).filter(Boolean);

let mappa = new Map();
let stato = 'mai';        // mai | letti | errore
let errore = '';

export async function carica(sb) {
  const { data, error } = await sb.from('s_secondi_indirizzi').select('email, anche_a');
  if (error) { stato = 'errore'; errore = error.message; mappa = new Map(); return false; }
  mappa = new Map((data || []).map((r) => [chiave(r.email), pulito(r.anche_a)]));
  stato = 'letti'; errore = '';
  return true;
}

/* per scaricaEml: la mappa e, se la lettura non è riuscita, il perché */
export const secondiIndirizzi = () => ({ mappa, stato, errore });
