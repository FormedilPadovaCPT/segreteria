/* ============================================================
   INCARICHI MENSILI E FATTURE DEI TECNICI — scheda PRESTAZIONI E
   STORICO (26/09/2026)

   Staccata da fatture-tecnici.js così com'era: per tecnico e anno, che
   cosa è stato pagato con quale fattura e che cosa è ancora aperto,
   più l'inserimento manuale (regola delle maschere).
   Il filtro per tecnico e l'anno sono condivisi con la scheda Fatture:
   stanno in fatture-tecnici.js e si cambiano coi setter.
   ⚠️ Importa fatture-tecnici.js, che importa questo file: al caricamento
   qui non si chiama niente dell'altro, solo dentro le funzioni.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { MESI, TIPI_PRESTAZIONE, euro } from './fatture-tecnici-doc.js';
import { tecnici, filtroTec, annoPrest, impostaFiltroTec, impostaAnnoPrest, nomeTec } from './fatture-tecnici.js';

let filtroPrest = 'aperte';

/* ══════════ scheda PRESTAZIONI E STORICO ══════════ */

async function renderPrestazioni(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let q = sb.from('s_prestazioni').select('*').order('data', { ascending: false }).order('id', { ascending: false }).limit(600);
  /* un soggetto esterno non ha prestazioni nostre: il riepilogo e' del tecnico */
  if (filtroTec === '__esterno') q = q.eq('tecnico_id', '__nessuno__');
  else if (filtroTec) q = q.eq('tecnico_id', filtroTec);
  if (filtroPrest === 'aperte') q = q.is('fattura_id', null).is('chiusa_il', null);
  else if (filtroPrest === 'chiuse') q = q.not('chiusa_il', 'is', null);
  else q = q.eq('anno', annoPrest);
  const { data } = await q;
  const righe = data || [];
  const fIds = [...new Set(righe.map((p) => p.fattura_id).filter(Boolean))];
  const { data: ff } = fIds.length ? await sb.from('s_fatture_tecnici').select('id, numero, data_fattura, data_ricevimento, stato').in('id', fIds) : { data: [] };
  const fDi = Object.fromEntries((ff || []).map((f) => [f.id, f]));
  const tot = righe.reduce((s, p) => s + Number(p.importo || 0), 0);

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="pr-f">
        ${[['aperte', 'Da fatturare'], ['chiuse', 'Chiuse'], ['anno', `Anno ${annoPrest}`]].map(([v, l]) => `<button class="seg-btn ${filtroPrest === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="number" id="pr-anno" class="inp inp-sm" value="${annoPrest}" style="width:80px">
        <select id="pr-tec" class="inp inp-sm"><option value="">Tutti i tecnici</option>${tecnici.map((t) => `<option value="${t.tecnico_id}" ${filtroTec === t.tecnico_id ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="pr-nuova">+ Prestazione manuale</button>
      </div>
    </div>
    <div style="margin:0 0 8px"><span class="dt-cella dt-ok" style="padding:4px 10px">${righe.length} prestazioni · netto ${euro(tot)}</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Data</th><th>Tecnico</th><th>Tipo</th><th>Descrizione</th><th>Q.tà</th><th>Netto</th><th>Mese inc.</th><th>Fattura</th></tr></thead>
      <tbody>${righe.map((p) => { const f = fDi[p.fattura_id]; return `<tr data-id="${p.id}">
        <td>${dataIt(p.data)}</td><td>${esc((p.tecnico_nome || '').split(' ')[0])}</td><td>${esc(TIPI_PRESTAZIONE[p.tipo] || p.tipo)}</td>
        <td>${esc((p.descrizione || '').slice(0, 64))}${p.note ? ` <span class="hint" title="${esc(p.note)}">ⓘ</span>` : ''}</td>
        <td>${p.quantita ?? 1}</td><td><strong>${euro(p.importo)}</strong></td><td class="hint">${p.incarico_mensile_id ? `n° ${p.incarico_mensile_id}` : ''}</td>
        <td>${f ? `<span class="dt-cella dt-ok" style="padding:1px 6px">n° ${esc(f.numero || f.id)}</span> <span class="hint">${dataIt(f.data_fattura || f.data_ricevimento)}</span>`
          : p.chiusa_il ? `<span class="dt-cella dt-scaduto" style="padding:1px 6px">chiusa ${dataIt(String(p.chiusa_il).slice(0, 10))}</span> <span class="hint" title="${esc(p.chiusa_motivo || '')}">ⓘ</span>`
          : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">aperta</span>'}</td>
      </tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nessuna prestazione con questo filtro.</td></tr>'}</tbody></table></div>
    <p class="hint" style="margin-top:8px">È la situazione storica: per ogni visita, docenza, servizio o asseverazione, con quale fattura è stata pagata.
      Le righe con «ⓘ» portano una nota dall'import Access (es. «DA VERIFICARE: possibile doppione»). Clic su una riga per agganciarla a una fattura o correggerla.</p>`;

  $('#pr-f').addEventListener('click', (e) => { const b = e.target.closest('[data-val]'); if (b) { filtroPrest = b.dataset.val; renderPrestazioni(); } });
  $('#pr-anno').addEventListener('change', (e) => { impostaAnnoPrest(Number(e.target.value) || annoPrest); filtroPrest = 'anno'; renderPrestazioni(); });
  $('#pr-tec').addEventListener('change', (e) => { impostaFiltroTec(e.target.value); renderPrestazioni(); });
  $('#pr-nuova').addEventListener('click', () => formPrestazione(null));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => formPrestazione(righe.find((p) => p.id === Number(tr.dataset.id)))));
}

async function formPrestazione(p) {
  const tecId = p?.tecnico_id || filtroTec || tecnici[0]?.tecnico_id;
  const [{ data: ff }, { data: mm }] = await Promise.all([
    sb.from('s_fatture_tecnici').select('id, numero, data_fattura, data_ricevimento, stato').eq('tecnico_id', tecId).order('id', { ascending: false }).limit(40),
    sb.from('s_incarichi_mensili').select('id, anno, mese').eq('tecnico_id', tecId).order('anno', { ascending: false }).order('mese', { ascending: false }).limit(18),
  ]);
  apriDrawer(p ? `Prestazione n° ${p.id}` : 'Nuova prestazione (manuale)', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Tecnico *</label><select id="pp-t" ${p ? 'disabled' : ''}>${tecnici.map((t) => `<option value="${t.tecnico_id}" ${t.tecnico_id === tecId ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</select></div>
      <div class="field"><label>Data *</label><input type="date" id="pp-data" value="${p?.data || oggiIso()}"></div>
      <div class="field"><label>Tipo *</label><select id="pp-tipo">${Object.entries(TIPI_PRESTAZIONE).map(([v, l]) => `<option value="${v}" ${(p?.tipo || 'altro') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Quantità / tariffa</label><div style="display:flex;gap:6px"><input type="number" step="0.5" id="pp-q" value="${p?.quantita ?? 1}" style="width:70px"><input type="number" step="0.01" id="pp-tar" value="${p?.tariffa_unitaria ?? ''}" placeholder="tariffa"></div></div>
      <div class="field full"><label>Descrizione *</label><input id="pp-desc" value="${esc(p?.descrizione || '')}"></div>
      <div class="field"><label>Importo netto *</label><input type="number" step="0.01" id="pp-imp" value="${p?.importo ?? ''}"></div>
      <div class="field"><label>Mese di incarico</label><select id="pp-inc"><option value="">—</option>${(mm || []).map((m) => `<option value="${m.id}" ${String(m.id) === String(p?.incarico_mensile_id || '') ? 'selected' : ''}>${MESI[m.mese - 1]} ${m.anno} — n° ${m.id}</option>`).join('')}</select></div>
      <div class="field full"><label>Pagata con la fattura</label><select id="pp-f"><option value="">— aperta, ancora da fatturare —</option>${(ff || []).map((f) => `<option value="${f.id}" ${String(f.id) === String(p?.fattura_id || '') ? 'selected' : ''}>n° ${esc(f.numero || '?')} del ${dataIt(f.data_fattura || f.data_ricevimento)} (${f.stato}) — id ${f.id}</option>`).join('')}</select></div>
      <div class="field full"><label>Note</label><input id="pp-note" value="${esc(p?.note || '')}"></div>
    </div>
    ${p?.chiusa_il ? `<div class="dt-doc-riga" style="color:#a01f00;margin-top:10px"><strong>Chiusa il ${dataIt(String(p.chiusa_il).slice(0, 10))}</strong>
      da ${esc(p.chiusa_da || '')}: ${esc(p.chiusa_motivo || '')}. Non entra più nei riepiloghi da fatturare.</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${p && !p.visita_id && !p.corso_incarico_id ? '<button class="btn btn-ghost" id="pp-del">🗑 Elimina</button>' : ''}
        ${p?.chiusa_il ? '<button class="btn btn-ghost" id="pp-riapri">↩️ Riapri (torna da fatturare)</button>' : ''}
        ${p && !p.chiusa_il && !p.fattura_id ? '<button class="btn btn-ghost" id="pp-chiudi">🗄 Non si fattura più</button>' : ''}
      </div>
      <button class="btn btn-primary" id="pp-salva">💾 Salva</button>
    </div>
    ${p ? `<p class="hint" style="margin-top:8px">Origine: ${esc(p.origine || '')}${p.visita_id ? ` · visita ${esc(p.visita_id)}` : ''}${p.visita_stage_id ? ` · visita stage senza verbale n° ${p.visita_stage_id}` : ''}${p.corso_incarico_id ? ` · incarico corso ${p.corso_incarico_id}` : ''}${p.incarico_id ? ` · incarico gestionale ${p.incarico_id}` : ''}${p.a_pratica_id ? ' · pratica di asseverazione' : ''}</p>` : ''}`);
  $('#pp-t')?.addEventListener('change', () => { impostaFiltroTec($('#pp-t').value); formPrestazione(p); });
  $('#pp-q').addEventListener('input', () => { const q = Number($('#pp-q').value || 0); const t = Number($('#pp-tar').value || 0); if (t) $('#pp-imp').value = (q * t).toFixed(2); });
  $('#pp-tar').addEventListener('input', () => { const q = Number($('#pp-q').value || 0); const t = Number($('#pp-tar').value || 0); if (t) $('#pp-imp').value = (q * t).toFixed(2); });
  $('#pp-salva').addEventListener('click', async (ev) => {
    const t = tecnici.find((x) => x.tecnico_id === $('#pp-t').value);
    const data = $('#pp-data').value;
    const d = {
      tecnico_id: t.tecnico_id, tecnico_nome: nomeTec(t), data, anno: Number(data.slice(0, 4)), mese: Number(data.slice(5, 7)),
      tipo: $('#pp-tipo').value, descrizione: $('#pp-desc').value.trim(), quantita: Number($('#pp-q').value || 1),
      unita: /visita/.test($('#pp-tipo').value) ? 'visita' : $('#pp-tipo').value === 'asseverazione' ? 'giorno' : 'ora',
      tariffa_unitaria: $('#pp-tar').value ? Number($('#pp-tar').value) : null, importo: Number($('#pp-imp').value || 0),
      incarico_mensile_id: $('#pp-inc').value ? Number($('#pp-inc').value) : null,
      fattura_id: $('#pp-f').value ? Number($('#pp-f').value) : null, note: $('#pp-note').value.trim() || null,
    };
    if (!d.data || !d.descrizione) return toast('Servono data e descrizione.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = p ? await sb.from('s_prestazioni').update(d).eq('id', p.id)
      : await sb.from('s_prestazioni').insert({ ...d, origine: 'manuale', creato_da: state.email });
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Prestazione salvata.', 'ok'); chiudiDrawer(); renderPrestazioni();
  });
  $('#pp-riapri')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('s_prestazione_riapri', { p_id: p.id });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Riaperta: torna fra quelle da fatturare.', 'ok'); chiudiDrawer(); renderPrestazioni();
  });
  $('#pp-chiudi')?.addEventListener('click', async (ev) => {
    const motivo = prompt('Perché questa attività non si fattura più?\nÈ la riga che rileggerà chi la ritroverà fra due anni.');
    if (motivo == null) return;
    if (!motivo.trim()) return toast('Serve il motivo.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('s_prestazioni_chiudi', { p_ids: [p.id], p_motivo: motivo.trim() });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Chiusa: resta in archivio, ma non si fattura più.', 'ok'); chiudiDrawer(); renderPrestazioni();
  });
  $('#pp-del')?.addEventListener('click', async () => {
    if (!confirm('Elimino la prestazione?')) return;
    const { error } = await sb.from('s_prestazioni').delete().eq('id', p.id);
    if (error) return toast(error.message, 'err');
    toast('Eliminata.', 'ok'); chiudiDrawer(); renderPrestazioni();
  });
}

export { renderPrestazioni };
