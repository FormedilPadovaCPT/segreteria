/* ============================================================
   IL PASSO DEL TECNICO negli elenchi dei servizi CPT (30/09/2026).

   Chiesto dall'utente guardando l'elenco delle consulenze: la pratica
   di Noventa restava «Autorizzata» anche dopo che il tecnico aveva
   accettato l'incarico nel gestionale. Lo stato della pratica è della
   segreteria e dopo l'autorizzazione non cambia finché il servizio non
   è reso: quello che si muove nel frattempo è l'INCARICO (visto,
   accettato, rifiutato, eseguito), e sta nel gestionale.

   Il cruscotto e la scheda della pratica lo dicevano già; gli elenchi
   (segnalazioni, richieste di visita, consulenze, conferenze) no. Qui
   c'è un punto solo che lo legge e lo scrive sotto lo stato.

   - passoTecnico(id, incarico, errore): funzione pura, provata in Node;
   - caricaPassi(sb, pratiche): una lettura sola per tutte le pratiche
     ancora aperte che hanno un incarico;
   - passoHtml(pratica, passi): la pastiglia da mettere nella cella.

   Lettura fallita ≠ «non l'ha aperto»: se gli incarichi non si leggono
   la pastiglia lo dice.
   ============================================================ */

import { esc, dataIt } from './comune.js';

/* stati della pratica in cui il passo del tecnico non interessa più */
const FINITI = new Set(['eseguita', 'svolta', 'riscontrata', 'chiusa', 'scartata']);

export function passoTecnico(incaricoId, inc, errore = false) {
  if (!incaricoId) return null;
  if (errore) return { tipo: 'err', testo: `incarico n° ${incaricoId}: non sono riuscito a leggere se il tecnico l'ha accettato` };
  if (!inc) return { tipo: 'err', testo: `incarico n° ${incaricoId} non trovato nel gestionale` };
  const chi = inc.tecnico_nome || 'il tecnico';
  const il = (t) => (t ? ` il ${dataIt(String(t).slice(0, 10))}` : '');
  if (inc.eseguito_il || inc.stato === 'eseguito') return { tipo: 'ok', testo: `🔧 eseguito da ${chi}${il(inc.eseguito_il)}` };
  if (inc.rifiutato_il) return { tipo: 'err', testo: `❌ rifiutato da ${chi}${il(inc.rifiutato_il)}${inc.rifiuto_motivo ? ` — ${inc.rifiuto_motivo}` : ''}` };
  if (inc.accettato_il) return { tipo: 'ok', testo: `✅ accettato da ${chi}${il(inc.accettato_il)}` };
  if (inc.presa_visione_il) return { tipo: 'attesa', testo: `👁 visto da ${chi}, non ancora accettato` };
  return { tipo: 'fermo', testo: `⏳ ${chi} non l'ha ancora aperto` };
}

export async function caricaPassi(sb, pratiche) {
  const ids = [...new Set((pratiche || []).filter((p) => p.incarico_id && !FINITI.has(p.stato)).map((p) => p.incarico_id))];
  if (!ids.length) return { di: {}, errore: false };
  const { data, error } = await sb.from('incarichi')
    .select('id, stato, tecnico_nome, presa_visione_il, accettato_il, rifiutato_il, rifiuto_motivo, eseguito_il')
    .in('id', ids);
  if (error) { console.warn('passo del tecnico non letto:', error.message); return { di: {}, errore: true }; }
  return { di: Object.fromEntries((data || []).map((i) => [i.id, i])), errore: false };
}

export function passoHtml(p, passi) {
  if (!p?.incarico_id || FINITI.has(p.stato) || !passi) return '';
  const x = passoTecnico(p.incarico_id, passi.di[p.incarico_id], passi.errore);
  return x ? `<br><span class="hm-passo hm-passo-${x.tipo}">${esc(x.testo)}</span>` : '';
}
