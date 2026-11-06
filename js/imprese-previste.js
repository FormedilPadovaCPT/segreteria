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
  /* (06/11/2026) le altre imprese scritte dall'impresa nel modulo del portale: si propongono, non entrano da sole */
  const dalModulo = ((Array.isArray(p.cantieri) ? p.cantieri[0] : null)?.imprese || []).filter((x) => x && (x.piva || x.ragione_sociale)).slice(0, 15);
  let trovate = [];   // [{ voce, imp }] imp = riga dell'anagrafica o null
  if (dalModulo.length) {
    const pive = [...new Set(dalModulo.map((x) => String(x.piva || '').replace(/\D/g, '')).filter((x) => x.length === 11))];
    let anag = [];
    if (pive.length) {
      const { data, error } = await sb.from('imprese').select('impresa_id, impresa_nome, piva, elimina')
        .or(pive.map((v) => `impresa_id.eq.${v},piva.eq.${v}`).join(','));
      if (error) toast('Non sono riuscito a cercare in anagrafica le imprese del modulo: ' + error.message, 'err');
      anag = (data || []).filter((r) => !r.elimina);
    }
    trovate = dalModulo.map((voce) => {
      const v = String(voce.piva || '').replace(/\D/g, '');
      return { voce, imp: v ? anag.find((r) => r.impresa_id === v) || anag.find((r) => r.piva === v) || null : null };
    });
  }
  /* l'e-mail del modulo nell'anagrafica dell'impresa, solo se lì manca: il verbale parte da quella */
  let emailAnag = null, emailLetta = false;
  const emailModulo = String(p.email || '').trim();
  if (emailModulo && p.impresa_id) {
    const { data, error } = await sb.from('imprese').select('impresa_email_ref, impresa_email2, impresa_email3').eq('impresa_id', p.impresa_id).maybeSingle();
    if (!error && data) { emailLetta = true; emailAnag = [data.impresa_email_ref, data.impresa_email2, data.impresa_email3].filter(Boolean); }
  }
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
    const proposte = trovate.filter((x) => !(x.imp && presente(x.imp.impresa_id)));
    const htmlModulo = proposte.length ? `<div style="margin-top:8px"><div class="hint">Scritte dall'impresa nel modulo:</div>${proposte.map((x, i) => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0">
          <span>${esc(x.voce.ragione_sociale || x.imp?.impresa_nome || '')} <span class="hint">${esc(x.voce.piva || '')}${x.voce.ruolo ? ' · ' + esc(x.voce.ruolo) : ''}</span></span>
          ${x.imp ? `<button class="btn btn-ghost btn-sm" data-ip-mod="${i}">➕ Aggiungi</button>` : '<span class="hint">non in anagrafica: va creata fra le imprese</span>'}</div>`).join('')}</div>` : '';
    const giaMail = (emailAnag || []).some((m) => String(m).toLowerCase() === emailModulo.toLowerCase());
    const htmlMail = emailLetta && !giaMail ? `<div style="margin-top:8px" class="hint">E-mail scritta nel modulo: <strong>${esc(emailModulo)}</strong>${emailAnag.length ? ` (in anagrafica c'è già ${esc(emailAnag[0])})` : ` — in anagrafica l'impresa non ha un'e-mail, e senza il verbale non parte. <button class="btn btn-ghost btn-sm" id="ip-mail" data-aiuto="Scrive l'e-mail del modulo come e-mail di riferimento dell'impresa: solo perché il campo è vuoto, non sostituisce niente.">✉️ Mettila in anagrafica</button>`}</div>` : '';
    $('#ip-elenco').innerHTML = (uniche.length
      ? uniche.map((r) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-top:1px solid var(--bordo)">
          <span><strong>${esc(r.impresa_nome || r.impresa_cf)}</strong> <span class="hint">${esc(r.impresa_cf || '')} · ${r.fonte === 'segreteria' ? 'indicata dalla segreteria' : 'dalla Cassa Edile'}</span></span>
          ${r.fonte === 'segreteria' ? `<button class="btn btn-ghost btn-sm" data-ip-togli="${r.id}" data-aiuto="Toglie l'impresa dalle previste di questo cantiere. Non tocca l'anagrafica né i verbali.">✕</button>` : ''}</div>`).join('')
      : '<p class="hint">Nessuna impresa prevista per ora.</p>') + richiesta + htmlModulo + htmlMail;
    $('#ip-elenco').querySelectorAll('[data-ip-mod]').forEach((b) => b.addEventListener('click', () => {
      const x = proposte[Number(b.dataset.ipMod)];
      aggiungi(b, { impresa_id: x.imp.impresa_id, impresa_nome: x.imp.impresa_nome }, x.voce.ruolo);
    }));
    $('#ip-mail')?.addEventListener('click', (ev) => mettiMail(ev.currentTarget));
    $('#ip-richiesta')?.addEventListener('click', (ev) => aggiungi(ev.currentTarget, { impresa_id: p.impresa_id, impresa_nome: p.ragione_sociale }));
    $('#ip-elenco').querySelectorAll('[data-ip-togli]').forEach((b) => b.addEventListener('click', () => togli(b, Number(b.dataset.ipTogli))));
  };

  const mettiMail = async (btn) => {
    attendi(btn, true);
    /* solo se il campo è ancora vuoto: nessuno scrive sopra un indirizzo messo nel frattempo */
    const { data, error } = await sb.from('imprese').update({ impresa_email_ref: emailModulo })
      .eq('impresa_id', p.impresa_id).or('impresa_email_ref.is.null,impresa_email_ref.eq.').select('impresa_id');
    attendi(btn, false);
    if (error) { toast('E-mail non scritta: ' + error.message, 'err'); return; }
    if (!(data || []).length) { toast('Nel frattempo l\'impresa ha già un\'e-mail in anagrafica: non l\'ho toccata.', 'err'); }
    else toast('E-mail dell\'impresa scritta in anagrafica.', 'ok');
    emailAnag = [emailModulo];
    disegna();
  };

  const aggiungi = async (btn, imp, ruolo) => {
    if (presente(imp.impresa_id)) { toast('Questa impresa è già fra le previste.', 'ok'); return; }
    /* il nome si legge dall'anagrafica: quello del modulo può essere scritto in un altro modo */
    const { data: a, error: eA } = await sb.from('imprese').select('impresa_id, impresa_nome').eq('impresa_id', imp.impresa_id).maybeSingle();
    if (eA) { toast('Non sono riuscito a leggere l\'anagrafica: ' + eA.message, 'err'); return; }
    if (!a) { toast('L\'impresa non è in anagrafica: va creata prima fra le imprese.', 'err', 8000); return; }
    attendi(btn, true);
    const { error } = await sb.from('cantiere_imprese_previste').insert({
      cantiere_id: c.cantiere_id, impresa_cf: a.impresa_id, impresa_nome: a.impresa_nome, fonte: 'segreteria',
      note: [p.id ? `dalla richiesta n° ${p.id}` : '', ruolo || ''].filter(Boolean).join(' · ') || null,
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
