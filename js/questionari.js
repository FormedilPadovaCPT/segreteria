/* ============================================================
   QUESTIONARI SUL SOPRALLUOGO — il gradimento dal portale servizi.

   Fino al 12/09/2026 il questionario esisteva solo come riga sulla
   scheda «Questionario Sopralluogo» del foglio Google: nessun import
   lo leggeva. Con la strada diretta del portale (funzione
   portale-richieste, 13/09/2026) arriva in s_questionari_sopralluogo,
   e qui si legge.

   ⚠️ DAL 18/09/2026 IL QUESTIONARIO È LEGATO AL VERBALE. Il vecchio
   modulo — 23 domande, 8 scale da 1 a 5 — non lo compilava nessuno, e
   soprattutto nessuno lo invitava a compilarlo: nel gestionale la
   parola «questionario» non compariva da nessuna parte. Ora la mail che
   trasmette il verbale porta il pulsante «Valuta la visita», con un
   link firmato che dice A QUALE VISITA si riferisce il giudizio; il
   questionario è una domanda sola (quanto è stata utile) più il ramo
   che si apre di conseguenza.

   Le risposte vecchie restano e si vedono ancora nel dettaglio: dicono
   quel che dicevano (regola d'oro 7). Nella tabella invece comanda il
   voto nuovo, perché è quello confrontabile nel tempo.

   È un dato di soddisfazione, non una pratica da istruire: niente
   protocollo, niente autorizzazione. Si segna che è stato letto, e
   chi ha chiesto di essere contattato resta in evidenza finché non
   lo si è fatto. Il merito delle valutazioni sui singoli tecnici è
   materiale valutativo sul personale (cautela della sigla VAL): resta
   qui, non va nelle note-entità.
   ============================================================ */

import { sb, state, $, esc, dataIt, toast, attendi, apriDrawer } from './core.js';

let righe = [];
let filtro = 'da-leggere';

const STATI = {
  ricevuto: 'Da leggere', letto: 'Letto', contattato: 'Contattato', archiviato: 'Archiviato', scartato: 'Scartato',
};
const vuoleContatto = (q) => /^s/i.test(q.contatto_richiesto || '');
const daContattare = (q) => vuoleContatto(q) && !['contattato', 'archiviato', 'scartato'].includes(q.stato);
const giorno = (v) => (v ? dataIt(String(v).slice(0, 10)) : '—');

/* il voto: quello nuovo se c'è, altrimenti la media delle tre scale del
   questionario vecchio — così una riga del 2026 e una di prima stanno nella
   stessa colonna senza far finta che siano la stessa domanda (il dettaglio
   dice sempre da dove viene) */
const mediaVecchia = (q) => {
  const v = [q.scala_aspettative, q.scala_professionale, q.scala_facilita].filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const voto = (q) => (Number.isFinite(q.utilita) ? q.utilita : mediaVecchia(q));
/* niente faccine qui: in colonna serve un numero confrontabile, e una parola
   che dica subito com'è andata senza dover ricordare la scala */
const PAROLA = { 1: 'per niente', 2: 'poco', 3: 'così così', 4: 'utile', 5: 'molto utile' };
const votoCella = (q) => {
  const v = voto(q);
  if (v === null) return '—';
  const arrotondato = Math.round(v);
  const testo = Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
  const colore = arrotondato <= 2 ? '#c0392b' : arrotondato === 3 ? '#b8860b' : '#4f6b12';
  const nota = Number.isFinite(q.utilita) ? 'quanto è stata utile' : 'media delle scale del questionario precedente';
  return `<span title="${nota}" style="color:${colore};font-weight:600;white-space:nowrap">${testo} · ${PAROLA[arrotondato] || ''}</span>`;
};
const AGITO = /^(sì|si), subito|programma/i;

/* Per il cruscotto: le righe che qualcuno deve guardare, in ordine di urgenza
   — prima i voti bassi non ancora presi in mano (sono quelli per cui si può
   ancora fare qualcosa), poi chi ha chiesto di essere richiamato, poi i nuovi.
   Il cruscotto non tiene una lista sua: conta queste righe e ci porta sopra. */
export async function daLavorare() {
  const { data, error } = await sb.from('s_questionari_sopralluogo')
    .select('id, progressivo, timestamp_modulo, tecnico, data_visita, nr_verbale, utilita, motivi, commento, azione_dopo, contatto_richiesto, recapito_contatto, stato, scala_aspettative, scala_professionale, scala_facilita, proposte_miglioramento')
    .not('stato', 'in', '(archiviato,scartato)')
    .order('id', { ascending: false }).limit(60);
  if (error) throw error;
  const aperte = (data || []).filter((q) => q.stato === 'ricevuto' || daContattare(q));
  const peso = (q) => {
    const v = voto(q);
    if (v !== null && v <= 2 && q.stato === 'ricevuto') return 0;   // scontento e non ancora letto
    if (daContattare(q)) return 1;                                  // ha chiesto di essere richiamato
    return 2;
  };
  return aperte.sort((a, b) => peso(a) - peso(b) || b.id - a.id);
}
export { voto, votoCella, daContattare, vuoleContatto };

export async function render() {
  const host = $('#questionari-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const { data, error } = await sb.from('s_questionari_sopralluogo').select('*').order('id', { ascending: false });
  if (error) {
    host.innerHTML = `<p class="empty">Questionari non leggibili: ${esc(error.message)}</p>`;
    return;
  }
  righe = data || [];
  const nuovi = righe.filter((q) => q.stato === 'ricevuto');
  const contatti = righe.filter(daContattare);

  /* le due misure che contano: quanto sono giudicate utili le visite, e
     quante imprese hanno poi fatto qualcosa — la seconda dice se il servizio
     serve, non se è piaciuto */
  const voti = righe.map(voto).filter((v) => v !== null);
  const mediaVoti = voti.length ? (voti.reduce((a, b) => a + b, 0) / voti.length).toFixed(1).replace('.', ',') : '—';
  const conAzione = righe.filter((q) => q.azione_dopo);
  const agito = conAzione.filter((q) => AGITO.test(q.azione_dopo));

  const visibili = righe.filter((q) =>
    filtro === 'tutti' ? true :
    filtro === 'contatto' ? daContattare(q) :
    filtro === 'bassi' ? (voto(q) !== null && voto(q) <= 2) :
    q.stato === 'ricevuto' || daContattare(q));

  const dice = (q) => {
    const parti = [q.motivi, q.commento || q.proposte_miglioramento].filter(Boolean).join(' — ');
    return parti ? esc(parti.length > 90 ? parti.slice(0, 88) + '…' : parti) : '';
  };

  const tr = visibili.map((q) => `<tr data-id="${q.id}">
      <td>${q.progressivo ?? `m${q.id}`}</td>
      <td>${giorno(q.timestamp_modulo)}</td>
      <td>${q.nr_verbale ? `<span style="white-space:nowrap">${esc(q.nr_verbale)}</span>` : '<span class="dt-tenue">—</span>'}</td>
      <td>${esc(q.tecnico || '—')}</td>
      <td>${giorno(q.data_visita)}</td>
      <td style="text-align:center">${votoCella(q)}</td>
      <td>${dice(q)}</td>
      <td>${vuoleContatto(q) ? `📞 ${esc(q.recapito_contatto || 'sì, senza recapito')}` : '—'}</td>
      <td>${esc(STATI[q.stato] || q.stato)}</td>
    </tr>`).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${nuovi.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⭐ ${nuovi.length} da leggere</span>
      <span class="dt-cella ${contatti.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">📞 ${contatti.length} chiedono di essere contattati</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">📊 utilità media ${mediaVoti}${voti.length ? ` su ${voti.length}` : ''}</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🔧 ${agito.length}${conAzione.length ? ' su ' + conAzione.length : ''} hanno fatto qualcosa dopo</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${righe.length} in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="qs-f">
        ${[['da-leggere', 'Da lavorare'], ['contatto', 'Da contattare'], ['bassi', 'Voti bassi'], ['tutti', 'Tutti']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Ricevuto</th><th>Verbale</th><th>Tecnico</th><th>Visita del</th><th>Voto</th><th>Che cosa dice</th><th>Contatto</th><th>Stato</th></tr></thead>
        <tbody>${tr || '<tr><td colspan="9" class="empty">Nessun questionario con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Arrivano dal portale servizi, quasi sempre dal pulsante «Valuta la visita» della mail che trasmette il verbale:
      per questo la riga sa a quale sopralluogo si riferisce. Dove il verbale manca, il questionario è stato aperto
      dal menu del portale. Il voto è «quanto vi è stata utile» (1-5); per le risposte raccolte prima del
      18/09/2026 è la media delle tre scale di allora.
    </p>`;

  $('#qs-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  host.querySelectorAll('tbody tr[data-id]').forEach((riga) =>
    riga.addEventListener('click', () => apriPratica(Number(riga.dataset.id))));
}

export async function apriPratica(id) {
  const q = righe.find((x) => x.id === id);
  if (!q) return;
  const campo = (l, v) => (v !== null && v !== undefined && String(v).trim() !== ''
    ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(String(v))}</div>` : '');
  const riga = () => '<hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">';

  /* il questionario vecchio si mostra solo se quella riga lo contiene davvero:
     sulle risposte nuove quelle domande non sono mai state fatte */
  const haVecchio = [q.scala_aspettative, q.scala_professionale, q.scala_facilita, q.ruolo_chiaro,
    q.suggerimenti_pratici, q.nuovi_rischi, q.misure_sicurezza, q.aree_monitorate, q.scopi,
    q.scala_serv_area, q.aggiornamenti, q.proposte_miglioramento].some((v) => v !== null && v !== undefined && String(v).trim() !== '');

  const vecchio = !haVecchio ? '' : `
    ${riga()}
    <p class="hint" style="margin:0 0 8px">Risposte al questionario in uso fino al 18/09/2026.</p>
    ${campo('Scopo', q.scopi)}
    ${campo('Aspettative soddisfatte (1-5)', q.scala_aspettative)}
    ${campo('Ruolo e obiettivi spiegati', q.ruolo_chiaro)}
    ${campo('Professionalità del tecnico (1-5)', q.scala_professionale)}
    ${campo('Suggerimenti pratici', q.suggerimenti_pratici)}
    ${campo('Suggerimenti facili da applicare (1-5)', q.scala_facilita)}
    ${campo('Nuovi rischi individuati', q.nuovi_rischi)}
    ${campo('Misure adottate', q.misure_sicurezza)}
    ${campo('Aree monitorate', q.aree_monitorate)}
    ${campo('Conosce l\'Area Sicurezza e Salute (1-5)', q.scala_serv_area)}
    ${campo('Conosce le visite in cantiere (1-5)', q.scala_serv_visite)}
    ${campo('Conosce la consulenza (1-5)', q.scala_serv_consulenza)}
    ${campo('Conosce la formazione (1-5)', q.scala_serv_formazione)}
    ${campo('Conosce corsi e seminari (1-5)', q.scala_serv_corsi)}
    ${campo('Proposte di miglioramento', q.proposte_miglioramento)}
    ${campo('Vuole ricevere aggiornamenti', q.aggiornamenti)}`;

  const v = voto(q);
  const senzaVerbale = !q.visita_id
    ? `<p class="hint" style="margin:6px 0 0">Non è legato a una visita: ${
        q.riferimento_esito === 'senza invito' || !q.riferimento_esito
          ? 'il questionario è stato aperto dal menu del portale, non dal pulsante della mail del verbale'
          : esc(q.riferimento_esito)}.</p>`
    : '';

  apriDrawer(`Questionario n° ${q.progressivo ?? `m${q.id}`} — ${q.tecnico || 'tecnico non indicato'}`, '', `
    ${campo('Ricevuto', giorno(q.timestamp_modulo))}
    ${campo('Verbale', q.nr_verbale)}
    ${campo('Visita del', q.data_visita ? giorno(q.data_visita) : null)}
    ${campo('Tecnico', q.tecnico)}
    ${senzaVerbale}
    ${riga()}
    ${v === null ? '' : `<div class="dt-doc-riga"><strong>Utilità della visita:</strong> ${votoCella(q)}${
        Number.isFinite(q.utilita) ? '' : ' <span class="dt-tenue">(media delle scale del questionario precedente)</span>'}</div>`}
    ${campo(v !== null && v <= 2 ? 'Che cosa non ha funzionato' : 'Che cosa è servito di più', q.motivi)}
    ${campo('Dopo la visita', q.azione_dopo)}
    ${campo('Ha scritto', q.commento)}
    ${riga()}
    ${campo('Vuole essere contattato', q.contatto_richiesto)}
    ${campo('Recapito', q.recapito_contatto)}
    ${vecchio}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div class="field"><label>Stato</label>
      <select id="qs-stato">${Object.entries(STATI).map(([k, l]) =>
        `<option value="${k}" ${q.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="qs-note">${esc(q.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ghost" id="qs-pdf">📋 Riepilogo (PDF)</button>
      <button class="btn btn-primary" id="qs-salva">Salva</button>
    </div>
  `);

  $('#qs-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_questionari_sopralluogo').update({
      stato: $('#qs-stato').value,
      note_ufficio: $('#qs-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', q.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Questionario aggiornato.', 'ok');
    await render();
  });
  $('#qs-pdf').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Preparo…');
    try {
      const { scaricaRiepilogo } = await import('./riepilogo-modulo.js');
      await scaricaRiepilogo('qst', q);
    } catch (e) {
      toast('Riepilogo non riuscito: ' + e.message, 'err');
    }
    attendi(btn, false);
  });
}
