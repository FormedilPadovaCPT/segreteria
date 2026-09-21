/* ============================================================
   I CAMPI STRUTTURATI NELLA MAIL ALLA SEGRETERIA

   Alcuni moduli del portale mandano campi che non sono testo ma
   elenchi di oggetti: le domande di un test, le persone di
   un'iscrizione, le risposte di un questionario. Nella mail
   finivano **serializzati in JSON**, cioè illeggibili — e nel caso
   del test dal docente ci finivano dentro anche le RISPOSTE
   CORRETTE (segnalato dall'utente il 21/09/2026 sulla proposta
   «dtst #2»: `…"corrette":["Sopra i 2 metri"]}]`).

   ⚠️ Le due ragioni per cui questo file esiste, in ordine:
   1. **Le soluzioni di un test non escono in una mail.** Il
      principio è già scritto per il portale («le risposte giuste
      non escono mai»); una mail si inoltra, si stampa e resta nelle
      caselle, quindi vale lo stesso. Il test si legge nell'app.
   2. **Una mail deve essere leggibile.** Il JSON grezzo non dice
      alla segreteria né quante domande sono arrivate né di che
      cosa parlano.

   Regola generale: se una voce non si riconosce **non si stampa il
   JSON**, si dice quante voci sono e dove si leggono. Meglio una
   riga onesta che un muro di virgolette.

   Le funzioni sono pure e senza tipi apposta: le importa `mail.ts`
   (Deno) e le provano i test in Node.
   ============================================================ */

const s = (v) => (v === null || v === undefined ? '' : String(v));
const pulito = (v) => s(v).replace(/\s+/g, ' ').trim();

/** L'elenco di oggetti dentro un campo, che può arrivare come array
 *  o come stringa JSON. Mai più di `max` voci: una mail non è un
 *  archivio. */
export function vociJson(v, max = 30) {
  try {
    const a = typeof v === 'string' ? JSON.parse(v || '[]') : v;
    return Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').slice(0, max) : [];
  } catch { return []; }
}

/** Il valore è un elenco o un oggetto travestito da stringa? */
export function sembraStrutturato(v) {
  if (Array.isArray(v) || (v && typeof v === 'object')) return true;
  const t = s(v).trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'));
}

/** La rete: quante voci sono, senza mostrarle. */
export function riassuntoStrutturato(v, cosa = 'voci') {
  const n = vociJson(v, 500).length;
  return n ? `${n} ${cosa} — si leggono nell'app` : 'si legge nell\'app';
}

/** Le domande di un test proposto dal docente.
 *  ⚠️ NON si stampano né le opzioni né le risposte corrette: di
 *  ogni domanda si dice il testo, il tipo, i punti e quante
 *  opzioni ha. Chi deve valutarle apre la scheda corso. */
export function domandeLeggibili(v) {
  const dd = vociJson(v);
  if (!dd.length) return riassuntoStrutturato(v, 'domande');
  const righe = dd.map((d, i) => {
    const testo = pulito(d.testo || d.domanda || d.d) || '(senza testo)';
    const dettagli = [
      pulito(d.tipo),
      d.punti != null && s(d.punti) !== '' ? `${s(d.punti)} punt${s(d.punti) === '1' ? 'o' : 'i'}` : '',
      Array.isArray(d.opzioni) && d.opzioni.length ? `${d.opzioni.length} opzioni` : '',
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${testo}${dettagli ? ` (${dettagli})` : ''}`;
  });
  righe.push('Opzioni e soluzioni si leggono nell\'app.');
  return righe.join('\n');
}

/** Le persone di un'iscrizione: chi sono e per quale impresa.
 *  ⚠️ Niente codice fiscale, né data e comune di nascita: nella mail
 *  non servono a decidere nulla e sono dati personali che si
 *  moltiplicano a ogni inoltro. Stanno nella pratica. */
export function personeLeggibili(v) {
  const pp = vociJson(v);
  if (!pp.length) return riassuntoStrutturato(v, 'persone');
  const righe = pp.map((p, i) => {
    const nome = [p.cognome, p.nome].map(pulito).filter(Boolean).join(' ')
      || pulito(p.nominativo) || '(senza nominativo)';
    const impresa = pulito(p.impresa || p.ragione_sociale || p.ditta);
    const ruolo = pulito(p.ruolo || p.mansione);
    return `${i + 1}. ${[nome, impresa, ruolo].filter(Boolean).join(' — ')}`;
  });
  righe.push('Codice fiscale e dati di nascita si leggono nell\'app.');
  return righe.join('\n');
}

/** Le risposte di un questionario: domanda e risposta, quando la
 *  forma si riconosce. Qui il contenuto È il dato utile, e il
 *  questionario è anonimo: non c'è niente da coprire. */
export function risposteLeggibili(v) {
  const rr = vociJson(v);
  if (!rr.length) return riassuntoStrutturato(v, 'risposte');
  const righe = rr.map((r, i) => {
    const dom = pulito(r.domanda || r.testo || r.d);
    const val = Array.isArray(r.risposta) ? r.risposta.map(pulito).filter(Boolean).join(', ')
      : pulito(r.risposta ?? r.valore ?? r.r ?? r.voto);
    if (!dom && !val) return '';
    return `${i + 1}. ${[dom, val].filter(Boolean).join(': ')}`;
  }).filter(Boolean);
  return righe.length ? righe.join('\n') : riassuntoStrutturato(v, 'risposte');
}

/** Come si rende il campo `k`, se è uno di quelli strutturati. */
export const RESA_STRUTTURATA = {
  domande: domandeLeggibili,
  persone: personeLeggibili,
  risposte: risposteLeggibili,
};
