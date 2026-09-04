/* ============================================================
   L'INCARICO AL TECNICO nel gestionale visite (tabella `incarichi`,
   quella della scheda «Incarichi assegnati» coi messaggi).

   Flusso deciso dall'utente il 01/09/2026: quando una pratica dei
   servizi viene AUTORIZZATA e ha il tecnico, l'app segreteria crea
   da sola l'incarico — è così che il tecnico se la trova fra le
   pratiche aperte, «e stop» (niente riquadri in dashboard per lui).

   Il numero prosegue il contatore interno degli incarichi (l'erede
   della serie richieste 95/2014→1082/2026): è un NUMERO DI PRATICA
   interna, non un protocollo — regola del confine. L'id creato si
   scrive sulla pratica (incarico_id): mai due incarichi per la
   stessa pratica.
   ============================================================ */

import { sb, state, toast } from './core.js';

export async function creaIncaricoDaPratica({ tabella, pratica, tipologia, tecnicoEmail, tecnicoNome,
  richiedente, testo, impresa, impresaId, indirizzo, comune, oggetto, referente, cellReferente,
  mezzo, visitePreviste, cantiereId }) {
  if (!tecnicoEmail) { toast('Incarico non creato: manca il tecnico assegnato.', 'err'); return null; }
  if (pratica.incarico_id) return pratica.incarico_id;   /* già creato */

  /* prosegue il contatore interno (max + 1) guardando ANCHE il
     registro storico: la serie vecchia arriva a numeri che in
     `incarichi` non ci sono (il 1082 di ARIANNA sta solo in
     s_servizi_storico — collisione trovata il 01/09/2026) */
  const [{ data: u1 }, { data: u2 }] = await Promise.all([
    sb.from('incarichi').select('id').order('id', { ascending: false }).limit(1),
    sb.from('s_servizi_storico').select('id').order('id', { ascending: false }).limit(1),
  ]);
  const nuovoId = Math.max((u1?.[0]?.id) || 0, (u2?.[0]?.id) || 0) + 1;

  const { error } = await sb.from('incarichi').insert({
    id: nuovoId,
    data_richiesta: (pratica.timestamp_modulo || new Date().toISOString()).slice(0, 10),
    richiedente: richiedente || null,
    mezzo: mezzo || null,
    testo_richiesta: testo || null,
    tipologia_richiesta: tipologia,
    approvato: true,
    tecnico_nome: tecnicoNome || null,
    tecnico_email: tecnicoEmail,
    impresa: impresa || null,
    impresa_id: impresaId || null,
    indirizzo: indirizzo || null,
    comune: comune || null,
    /* se la pratica sa gia' quale cantiere e' (segnalazioni e notifiche
       hanno cantiere_id), il tecnico non deve ricercarlo: accettando
       l'incarico se lo ritrova nella visita — chiesto il 04/09/2026 */
    cantiere_id: cantiereId || pratica.cantiere_id || null,
    oggetto: oggetto || null,
    referente: referente || null,
    cell_referente: cellReferente || null,
    visite_previste: visitePreviste || null,
    stato: 'aperto',
    note_comunicazione: `Creato dall'app segreteria all'autorizzazione della pratica (${state.email}).`,
  });
  if (error) { toast('Incarico al tecnico NON creato: ' + error.message, 'err'); return null; }

  const { error: errAgg } = await sb.from(tabella).update({ incarico_id: nuovoId }).eq('id', pratica.id);
  if (errAgg) toast(`Incarico n° ${nuovoId} creato ma non agganciato alla pratica: ${errAgg.message}`, 'err');
  else toast(`Incarico n° ${nuovoId} assegnato a ${tecnicoNome || tecnicoEmail} nel gestionale visite.`, 'ok');
  pratica.incarico_id = nuovoId;
  return nuovoId;
}
