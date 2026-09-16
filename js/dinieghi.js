/* ============================================================
   ACCESSI NEGATI AL CANTIERE — la gestione della segreteria.
   (16/09/2026, chiesto dall'utente)

   Il tecnico a cui è stato negato l'accesso a un cantiere lo
   segnala dal gestionale visite (bottone in dashboard,
   gestionale-visite/diniego-accesso.js): data, impresa, cantiere
   e note. La segnalazione arriva qui, nel cruscotto, e la
   segreteria la gestisce: la prende in carico, scrive che cosa ha
   fatto e la chiude. Il tecnico vede lo stato e la nota della
   segreteria nel suo elenco.

   Tabella s_dinieghi_accesso. Quello che ha scritto il tecnico
   non si riscrive (lo impedisce il database): accanto si aggiunge
   la gestione. Una segnalazione non si cancella, si chiude.
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';

export const STATI_DINIEGO = {
  nuovo: ['dt-scaduto', 'nuova'],
  in_gestione: ['dt-senzadata', 'in gestione'],
  chiuso: ['dt-ok', 'chiusa'],
};
const pill = (stato) => {
  const [c, l] = STATI_DINIEGO[stato] || ['', stato];
  return `<span class="dt-cella ${c}" style="padding:1px 7px">${esc(l)}</span>`;
};
const oraIt = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/* le segnalazioni ancora da gestire, per il cruscotto */
export async function aperti() {
  const { data, error } = await sb.from('s_dinieghi_accesso')
    .select('id, created_at, data_diniego, tecnico_nome, impresa_nome, cantiere_desc, note, stato')
    .in('stato', ['nuovo', 'in_gestione']).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data || [];
}

export async function dettaglio(id, dopo = null) {
  const { data: d, error } = await sb.from('s_dinieghi_accesso').select('*').eq('id', id).maybeSingle();
  if (error || !d) return toast('Segnalazione non trovata' + (error ? ': ' + error.message : '.'), 'err');

  apriDrawer(`Accesso negato al cantiere — n° ${d.id}`, '', `
    <div class="dt-doc-riga"><strong>Stato:</strong> ${pill(d.stato)}
      ${d.gestito_il ? `<span class="hint">ultima gestione ${oraIt(d.gestito_il)} (${esc(d.gestito_da || '')})</span>` : ''}</div>
    <div class="dt-doc-riga"><strong>Data del diniego:</strong> ${dataIt(d.data_diniego)}
      · <strong>tecnico:</strong> ${esc(d.tecnico_nome || d.segnalato_da)} <span class="hint">segnalato il ${oraIt(d.created_at)}</span></div>
    <div class="dt-doc-riga"><strong>Impresa:</strong> ${esc(d.impresa_nome)}
      ${d.impresa_id ? `<a href="#" id="dn-impresa" class="hint">apri la scheda</a>` : '<span class="hint">(scritta a mano dal tecnico)</span>'}</div>
    <div class="dt-doc-riga"><strong>Cantiere:</strong> ${esc(d.cantiere_desc)}
      ${d.cantiere_id ? `<span class="hint">(dall'anagrafica cantieri: ${esc(d.cantiere_id)})</span>` : '<span class="hint">(scritto a mano dal tecnico)</span>'}</div>
    <div class="dt-doc-riga" style="white-space:pre-wrap"><strong>Note del tecnico:</strong>\n${esc(d.note)}</div>
    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    <div class="field"><label>Stato</label>
      <select id="dn-stato">${Object.entries(STATI_DINIEGO).map(([v, [, l]]) => `<option value="${v}" ${d.stato === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Gestione della segreteria <span class="hint">(la vede anche il tecnico)</span></label>
      <textarea id="dn-gest" rows="4" style="width:100%" placeholder="Che cosa si è fatto: impresa contattata, visita riprogrammata, segnalazione a…">${esc(d.gestione_note || '')}</textarea></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="dn-incarico">📨 Prendi in gestione</button>
      <button class="btn btn-primary btn-sm" id="dn-salva">💾 Salva</button>
    </div>
    <p class="hint" style="margin-top:8px">Quello che ha scritto il tecnico non si modifica. Per chiudere la segnalazione serve scrivere com'è stata gestita.</p>`);

  const salva = async (btn, statoForzato) => {
    const stato = statoForzato || $('#dn-stato').value;
    const gestione = $('#dn-gest').value.trim();
    if (stato === 'chiuso' && !gestione) return toast('Per chiudere scrivi com\'è stata gestita.', 'err');
    attendi(btn, true, 'Salvo…');
    const { error: e } = await sb.from('s_dinieghi_accesso')
      .update({ stato, gestione_note: gestione || null }).eq('id', d.id);
    attendi(btn, false);
    if (e) return toast('Salvataggio non riuscito: ' + e.message, 'err');
    toast('Segnalazione aggiornata.', 'ok');
    chiudiDrawer();
    if (dopo) dopo();
  };
  $('#dn-salva').addEventListener('click', (ev) => salva(ev.currentTarget));
  $('#dn-incarico').addEventListener('click', (ev) => salva(ev.currentTarget, 'in_gestione'));
  $('#dn-impresa')?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    chiudiDrawer();
    const mod = await import('./imprese.js');
    mod.apriScheda(d.impresa_id);   /* cambia vista da sé, come da persona.js e rls.js */
  });
}

/* tutte, anche le chiuse: per ritrovare quello che è già stato gestito */
export async function elenco(dopo = null) {
  const { data, error } = await sb.from('s_dinieghi_accesso')
    .select('id, created_at, data_diniego, tecnico_nome, impresa_nome, cantiere_desc, stato')
    .order('created_at', { ascending: false }).limit(200);
  if (error) return toast(error.message, 'err');
  apriDrawer('Accessi negati al cantiere — tutte le segnalazioni', '', `
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>N°</th><th>Data</th><th>Tecnico</th><th>Impresa</th><th>Cantiere</th><th>Stato</th></tr></thead>
      <tbody>${(data || []).map((r) => `<tr data-dn="${r.id}" style="cursor:pointer"><td>${r.id}</td><td>${dataIt(r.data_diniego)}</td>
        <td>${esc((r.tecnico_nome || '').split(' ')[0])}</td><td>${esc(r.impresa_nome)}</td><td>${esc(r.cantiere_desc)}</td><td>${pill(r.stato)}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">Nessuna segnalazione.</td></tr>'}</tbody></table></div>`);
  $('#drawer-body').querySelectorAll('tr[data-dn]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglio(Number(tr.dataset.dn), dopo)));
}
