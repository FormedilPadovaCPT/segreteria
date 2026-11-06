/* ============================================================
   IMPRESE PREVISTE NEL CANTIERE DELL'INCARICO (06/11/2026, chiesto
   dall'utente sulla richiesta di visita Galiazzo).
   Sui cantieri codificati CNCE la Cassa Edile dice quali imprese vi
   lavorano, e il tecnico se le trova nel passo Imprese del verbale.
   Un cantiere che la Cassa non conosce non le aveva: ora la segreteria
   le indica dalla pratica — l'impresa della richiesta con un clic, le
   altre cercandole in anagrafica. Stessa tabella della Cassa
   (cantiere_imprese_previste), riga legata al cantiere con fonte
   'segreteria'. Le righe della Cassa si vedono e non si toccano.
   ============================================================ */

import { sb, $, esc, toast, attendi } from './core.js';

import { filtroPreviste, previsteUniche } from './imprese-previste-regole.js';
export { filtroPreviste, previsteUniche };

export function sezioneHtml() {
  return `<div id="ip-box" style="margin-top:10px;display:none">
    <h5 style="margin:0 0 4px">Imprese previste in questo cantiere</h5>
    <div class="hint" style="margin-bottom:6px">Il tecnico le trova nel passo «Imprese» del verbale e aggiunge quelle che sono davvero in cantiere.</div>
    <div id="ip-elenco"></div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:end;margin-top:6px">
      <div class="field" style="margin:0"><label>Aggiungi un'altra impresa (nome o P.IVA)</label><input id="ip-q"></div>
      <button class="btn btn-ghost btn-sm" id="ip-cerca" data-aiuto="Cerca l'impresa nell'anagrafica. Se non c'è, va prima creata fra le imprese.">🔎 Cerca</button>
    </div>
    <div id="ip-esiti" style="margin-top:6px"></div>
  </div>`;
}

/* p = la pratica (cantiere_id, impresa_id, ragione_sociale, id) */
export async function collega(p) {
  const box = $('#ip-box');
  if (!box) return;
  if (!p.cantiere_id) { box.style.display = 'none'; return; }
  box.style.display = '';

  const { data: c, error: eC } = await sb.from('cantieri').select('cantiere_id, cantiere_cnce').eq('cantiere_id', p.cantiere_id).maybeSingle();
  if (eC || !c) { $('#ip-elenco').innerHTML = `<p style="color:#c0392b">Non sono riuscito a leggere il cantiere${eC ? ': ' + esc(eC.message) : ''}.</p>`; return; }
  const cnce = String(c.cantiere_cnce || '').trim();

  let righe = [];
  const leggi = async () => {
    const { data, error } = await sb.from('cantiere_imprese_previste')
      .select('id, cnce, cantiere_id, impresa_cf, impresa_nome, note, fonte').or(filtroPreviste(cnce, c.cantiere_id));
    if (error) { $('#ip-elenco').innerHTML = `<p style="color:#c0392b">Non sono riuscito a leggere le imprese previste: ${esc(error.message)}</p>`; return false; }
    righe = data || [];
    disegna();
    return true;
  };

  const presente = (id) => righe.some((r) => String(r.impresa_cf || '').trim().toUpperCase() === String(id || '').trim().toUpperCase());

  const disegna = () => {
    const uniche = previsteUniche(righe);
    const richiesta = p.impresa_id && !presente(p.impresa_id)
      ? `<button class="btn btn-primary btn-sm" id="ip-richiesta" style="margin-top:4px" data-aiuto="Mette l'impresa che ha fatto la richiesta fra le imprese previste di questo cantiere.">➕ ${esc(p.ragione_sociale || p.impresa_id)} (impresa della richiesta)</button>`
      : '';
    $('#ip-elenco').innerHTML = (uniche.length
      ? uniche.map((r) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-top:1px solid var(--bordo)">
          <span><strong>${esc(r.impresa_nome || r.impresa_cf)}</strong> <span class="hint">${esc(r.impresa_cf || '')} · ${r.fonte === 'segreteria' ? 'indicata dalla segreteria' : 'dalla Cassa Edile'}</span></span>
          ${r.fonte === 'segreteria' ? `<button class="btn btn-ghost btn-sm" data-ip-togli="${r.id}" data-aiuto="Toglie l'impresa dalle previste di questo cantiere. Non tocca l'anagrafica né i verbali.">✕</button>` : ''}</div>`).join('')
      : '<p class="hint">Nessuna impresa prevista per ora.</p>') + richiesta;
    $('#ip-richiesta')?.addEventListener('click', (ev) => aggiungi(ev.currentTarget, { impresa_id: p.impresa_id, impresa_nome: p.ragione_sociale }));
    $('#ip-elenco').querySelectorAll('[data-ip-togli]').forEach((b) => b.addEventListener('click', () => togli(b, Number(b.dataset.ipTogli))));
  };

  const aggiungi = async (btn, imp) => {
    if (presente(imp.impresa_id)) { toast('Questa impresa è già fra le previste.', 'ok'); return; }
    /* il nome si legge dall'anagrafica: quello del modulo può essere scritto in un altro modo */
    const { data: a, error: eA } = await sb.from('imprese').select('impresa_id, impresa_nome').eq('impresa_id', imp.impresa_id).maybeSingle();
    if (eA) { toast('Non sono riuscito a leggere l\'anagrafica: ' + eA.message, 'err'); return; }
    if (!a) { toast('L\'impresa non è in anagrafica: va creata prima fra le imprese.', 'err', 8000); return; }
    attendi(btn, true);
    const { error } = await sb.from('cantiere_imprese_previste').insert({
      cantiere_id: c.cantiere_id, impresa_cf: a.impresa_id, impresa_nome: a.impresa_nome, fonte: 'segreteria',
      note: p.id ? `dalla richiesta n° ${p.id}` : null,
    });
    attendi(btn, false);
    if (error) { toast('Impresa non aggiunta: ' + error.message, 'err'); return; }
    toast(`${a.impresa_nome || a.impresa_id} fra le imprese previste del cantiere.`, 'ok');
    $('#ip-esiti').innerHTML = '';
    await leggi();
  };

  const togli = async (btn, id) => {
    if (!confirm('Tolgo questa impresa dalle previste del cantiere? Anagrafica e verbali non cambiano.')) return;
    attendi(btn, true);
    const { error } = await sb.from('cantiere_imprese_previste').delete().eq('id', id).eq('fonte', 'segreteria');
    attendi(btn, false);
    if (error) { toast('Non tolta: ' + error.message, 'err'); return; }
    await leggi();
  };

  const cerca = async () => {
    const t = $('#ip-q').value.trim();
    if (t.length < 2) { toast('Scrivi almeno due lettere del nome o la P.IVA.', 'err'); return; }
    $('#ip-esiti').innerHTML = '<p class="hint">Un istante…</p>';
    const pat = '*' + t.replace(/[(),*"]/g, ' ').trim().split(/\s+/).join('*') + '*';
    const { data, error } = await sb.from('imprese').select('impresa_id, impresa_nome, piva, comune')
      .or(`impresa_nome.ilike.${pat},piva.ilike.${pat},impresa_id.ilike.${pat}`).eq('elimina', 0).order('impresa_nome').limit(15);
    if (error) { $('#ip-esiti').innerHTML = `<p style="color:#c0392b">Non sono riuscito a leggere l'anagrafica: ${esc(error.message)}</p>`; return; }
    const r = data || [];
    $('#ip-esiti').innerHTML = r.length
      ? r.map((x, i) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0">
          <span>${esc(x.impresa_nome || x.impresa_id)} <span class="hint">${esc(x.piva || x.impresa_id)}${x.comune ? ' · ' + esc(x.comune) : ''}</span></span>
          ${presente(x.impresa_id) ? '<span class="hint">già prevista</span>' : `<button class="btn btn-ghost btn-sm" data-ip-agg="${i}">➕ Aggiungi</button>`}</div>`).join('')
      : '<p class="hint">Nessuna impresa trovata in anagrafica.</p>';
    $('#ip-esiti').querySelectorAll('[data-ip-agg]').forEach((b) => b.addEventListener('click', () => aggiungi(b, r[Number(b.dataset.ipAgg)])));
  };

  $('#ip-cerca').onclick = cerca;
  $('#ip-q').onkeydown = (e) => { if (e.key === 'Enter') cerca(); };
  await leggi();
}
