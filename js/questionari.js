/* ============================================================
   QUESTIONARI SUL SOPRALLUOGO — il gradimento dal portale servizi.

   Fino al 12/09/2026 il questionario esisteva solo come riga sulla
   scheda «Questionario Sopralluogo» del foglio Google: nessun import
   lo leggeva. Con la strada diretta del portale (funzione
   portale-richieste, 13/09/2026) arriva in s_questionari_sopralluogo,
   e qui si legge.

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
const media = (...v) => {
  const n = v.filter((x) => Number.isFinite(x));
  return n.length ? (n.reduce((a, b) => a + b, 0) / n.length).toFixed(1).replace('.', ',') : '—';
};
const giorno = (v) => (v ? dataIt(String(v).slice(0, 10)) : '—');

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
  const visibili = righe.filter((q) =>
    filtro === 'tutti' ? true :
    filtro === 'contatto' ? daContattare(q) :
    q.stato === 'ricevuto' || daContattare(q));

  const tr = visibili.map((q) => `<tr data-id="${q.id}">
      <td>${q.progressivo ?? `m${q.id}`}</td>
      <td>${giorno(q.timestamp_modulo)}</td>
      <td>${esc(q.tecnico || '—')}</td>
      <td>${giorno(q.data_visita)}</td>
      <td title="aspettative · professionalità · facilità">${media(q.scala_aspettative, q.scala_professionale, q.scala_facilita)}</td>
      <td>${vuoleContatto(q) ? `📞 ${esc(q.recapito_contatto || 'sì, senza recapito')}` : '—'}</td>
      <td>${esc(STATI[q.stato] || q.stato)}</td>
    </tr>`).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${nuovi.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⭐ ${nuovi.length} da leggere</span>
      <span class="dt-cella ${contatti.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">📞 ${contatti.length} chiedono di essere contattati</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${righe.length} in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="qs-f">
        ${[['da-leggere', 'Da lavorare'], ['contatto', 'Da contattare'], ['tutti', 'Tutti']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Ricevuto</th><th>Tecnico</th><th>Visita del</th><th>Media (1-5)</th><th>Contatto</th><th>Stato</th></tr></thead>
        <tbody>${tr || '<tr><td colspan="7" class="empty">Nessun questionario con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Arrivano dal portale servizi. La media è su aspettative, professionalità e facilità dei suggerimenti.
      Una copia resta sulla scheda «Questionario Sopralluogo» del foglio.
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

  apriDrawer(`Questionario n° ${q.progressivo ?? `m${q.id}`} — ${q.tecnico || 'tecnico non indicato'}`, '', `
    ${campo('Ricevuto', giorno(q.timestamp_modulo))}
    ${campo('Tecnico', q.tecnico)}
    ${campo('Data della visita', q.data_visita ? giorno(q.data_visita) : null)}
    ${campo('Scopo', q.scopi)}
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Aspettative soddisfatte (1-5)', q.scala_aspettative)}
    ${campo('Ruolo e obiettivi spiegati', q.ruolo_chiaro)}
    ${campo('Professionalità del tecnico (1-5)', q.scala_professionale)}
    ${campo('Suggerimenti pratici', q.suggerimenti_pratici)}
    ${campo('Suggerimenti facili da applicare (1-5)', q.scala_facilita)}
    ${campo('Nuovi rischi individuati', q.nuovi_rischi)}
    ${campo('Misure adottate', q.misure_sicurezza)}
    ${campo('Aree monitorate', q.aree_monitorate)}
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Conosce l\'Area Sicurezza e Salute (1-5)', q.scala_serv_area)}
    ${campo('Conosce le visite in cantiere (1-5)', q.scala_serv_visite)}
    ${campo('Conosce la consulenza (1-5)', q.scala_serv_consulenza)}
    ${campo('Conosce la formazione (1-5)', q.scala_serv_formazione)}
    ${campo('Conosce corsi e seminari (1-5)', q.scala_serv_corsi)}
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Proposte di miglioramento', q.proposte_miglioramento)}
    ${campo('Vuole ricevere aggiornamenti', q.aggiornamenti)}
    ${campo('Vuole essere contattato', q.contatto_richiesto)}
    ${campo('Recapito', q.recapito_contatto)}

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
