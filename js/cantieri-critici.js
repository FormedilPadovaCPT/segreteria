/* ============================================================
   CANTIERI CRITICI — il registro unico (17/09/2026, deciso dall'utente)

   Due porte d'ingresso, una gestione sola:
   · ACCESSO NEGATO: il tecnico lo segnala dal gestionale visite
     (bottone in dashboard, gestionale-visite/diniego-accesso.js) con
     data, impresa, cantiere, motivo, persona presente e note;
   · PROPOSTA DI SEGNALAZIONE A SPISAL / ITL: il tecnico la spunta nel
     verbale; il caso nasce da solo (trigger sulle visite). Fin qui la
     spunta restava dentro il verbale e non avvisava nessuno;
   · in più la segreteria può aprire un caso a mano.

   Le strade d'uscita sono le stesse: ulteriore visita, proposta di
   conferenza di cantiere all'impresa (che non è obbligata), Presidenza
   e Commissione Sicurezza — sono loro a decidere se segnalare agli
   organi di vigilanza, il Direttore conferma — e la segnalazione.

   Tabelle s_cantieri_critici e s_cantieri_critici_eventi (SQL in
   supabase/sql/2026_09_17_cantieri_critici.sql). Quello che ha scritto
   il tecnico non si riscrive (lo impedisce il database). La cronologia
   si aggiunge e non si corregge. Un caso non si cancella: si chiude,
   con l'esito e la nota su com'è stato gestito. «Risposta dell'ufficio»
   è il campo che il tecnico legge nel gestionale.

   Sostituisce js/dinieghi.js del 16/09/2026.
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';

export const GIORNI_TERMINE = 15;   /* quanto si aspetta che l'impresa ricontatti (deciso dall'utente) */

export const STATI = {
  nuovo: ['dt-scaduto', 'nuovo'],
  in_gestione: ['dt-senzadata', 'in gestione'],
  attesa_impresa: ['dt-scade', 'in attesa dell\'impresa'],
  attesa_decisione: ['dt-scade', 'in attesa di decisione'],
  chiuso: ['dt-ok', 'chiuso'],
};
export const ORIGINI = {
  accesso_negato: ['🚫', 'Accesso negato'],
  proposta_segnalazione: ['⚠️', 'Proposta di segnalazione SPISAL / ITL'],
  manuale: ['📝', 'Aperto dall\'ufficio'],
};
const MOTIVI = { rifiutato: 'una persona ha negato l\'accesso', nessuno_presente: 'cantiere chiuso o nessuno presente', altro: 'altro' };
export const ESITI = {
  risolta_visita: 'Risolta: la visita è stata fatta',
  risolta_altro: 'Risolta in altro modo',
  segnalata_organi: 'Segnalata agli organi di vigilanza',
  non_risolta: 'Non risolta',
  nessuna_azione: 'Nessuna azione',
};
const EVENTI = {
  apertura: 'Apertura', stato: 'Stato', nota: 'Nota',
  lettera_impresa: 'Comunicazione all\'impresa', sollecito: 'Sollecito', pec_richiesta: 'Invio PEC chiesto all\'Amministrazione',
  contatto_impresa: 'L\'impresa ha ricontattato', visita_riprogrammata: 'Visita riprogrammata', visita_successiva: 'Verbale successivo',
  decisione: 'Decisione', risposta_tecnico: 'Risposta al tecnico', conferenza_proposta: 'Proposta di conferenza di cantiere',
  demandata: 'Demandata a Presidenza / Commissione Sicurezza', decisione_organo: 'Decisione di Presidenza / Commissione',
  autorizzazione_direttore: 'Conferma del Direttore', segnalazione_organi: 'Segnalazione a SPISAL / ITL', riscontro_organo: 'Riscontro dell\'organo di vigilanza',
};
/* quelli che si aggiungono a mano; true = di norma li vede anche il tecnico */
const EVENTI_A_MANO = {
  nota: false, contatto_impresa: true, visita_riprogrammata: true, decisione: true, risposta_tecnico: true,
  conferenza_proposta: true, demandata: false, decisione_organo: false, riscontro_organo: false,
};

const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const fra = (giorni) => { const d = new Date(oggi() + 'T12:00:00'); d.setDate(d.getDate() + giorni); return d.toISOString().slice(0, 10); };
const oraIt = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const pill = (stato) => {
  const [c, l] = STATI[stato] || ['', stato];
  return `<span class="dt-cella ${c}" style="padding:1px 7px">${esc(l)}</span>`;
};
export const scaduto = (r) => r.stato === 'attesa_impresa' && r.termine_il && r.termine_il < oggi();
const presente = (d) => [d.presente_titolo, d.presente_nome, d.presente_cognome].filter(Boolean).join(' ');

/* i casi ancora aperti, per il cruscotto: prima i nuovi e i termini scaduti */
export async function aperti() {
  const { data, error } = await sb.from('s_cantieri_critici')
    .select('id, created_at, origine, data_evento, tecnico_nome, impresa_nome, cantiere_desc, note, stato, termine_il')
    .neq('stato', 'chiuso').order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const peso = (r) => (r.stato === 'nuovo' ? 0 : scaduto(r) ? 1 : 2);
  return (data || []).sort((a, b) => peso(a) - peso(b));
}

export async function dettaglio(id, dopo = null) {
  const [{ data: d, error }, { data: eventi }] = await Promise.all([
    sb.from('s_cantieri_critici').select('*').eq('id', id).maybeSingle(),
    sb.from('s_cantieri_critici_eventi').select('*').eq('critico_id', id).order('created_at'),
  ]);
  if (error || !d) return toast('Caso non trovato' + (error ? ': ' + error.message : '.'), 'err');
  const [ico, orig] = ORIGINI[d.origine] || ['', d.origine];
  const successiva = [...(eventi || [])].reverse().find((e) => e.tipo === 'visita_successiva');
  const riapri = () => dettaglio(id, dopo);

  apriDrawer(`${ico} Cantiere critico n° ${d.id} — ${orig}`, '', `
    <div class="dt-doc-riga"><strong>Stato:</strong> ${pill(d.stato)}
      ${d.stato === 'attesa_impresa' && d.termine_il ? `<span class="hint" ${scaduto(d) ? 'style="color:#a01f00;font-weight:600"' : ''}>termine ${dataIt(d.termine_il)}${scaduto(d) ? ' — scaduto: nessun contatto registrato' : ''}</span>` : ''}
      ${d.esito ? `<span class="hint">${esc(ESITI[d.esito] || d.esito)}</span>` : ''}
      ${d.gestito_il ? `<span class="hint">ultima gestione ${oraIt(d.gestito_il)} (${esc(d.gestito_da || '')})</span>` : ''}</div>
    <div class="dt-doc-riga"><strong>${d.origine === 'proposta_segnalazione' ? 'Data della visita' : 'Data'}:</strong> ${dataIt(d.data_evento)}
      · <strong>tecnico:</strong> ${esc(d.tecnico_nome || d.segnalato_da || '—')} <span class="hint">registrato il ${oraIt(d.created_at)}</span></div>
    <div class="dt-doc-riga"><strong>Impresa:</strong> ${esc(d.impresa_nome)}
      ${d.impresa_id ? `<a href="#" id="cc-impresa" class="hint">apri la scheda</a>` : '<span class="hint">(scritta a mano)</span>'}</div>
    <div class="dt-doc-riga"><strong>Cantiere:</strong> ${esc(d.cantiere_desc)}
      ${d.cantiere_id ? `<span class="hint">(dall'anagrafica cantieri: ${esc(d.cantiere_id)})</span>` : '<span class="hint">(scritto a mano)</span>'}</div>
    ${d.motivo ? `<div class="dt-doc-riga"><strong>Che cosa è successo:</strong> ${esc(MOTIVI[d.motivo] || d.motivo)}</div>` : ''}
    ${presente(d) || d.presente_qualifica || d.presente_tel ? `<div class="dt-doc-riga"><strong>Persona presente:</strong> ${esc(presente(d) || '(nome non indicato)')}
      ${d.presente_qualifica ? ` — ${esc(d.presente_qualifica)}` : ''}${d.presente_tel ? ` · tel. ${esc(d.presente_tel)}` : ''}</div>` : ''}
    <div class="dt-doc-riga" style="white-space:pre-wrap"><strong>Note del tecnico:</strong>\n${esc(d.note)}</div>

    ${successiva && d.stato !== 'chiuso' ? `<div class="dt-doc-riga" style="background:#eef8f0;border-radius:6px;padding:6px 8px">
      ✅ ${esc(successiva.testo || 'Sul cantiere è entrato un verbale successivo.')}
      <button class="btn btn-ghost btn-sm" id="cc-risolta">Chiudi come risolta con questo verbale</button></div>` : ''}

    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 170px"><label>Stato</label>
        <select id="cc-stato">${Object.entries(STATI).map(([v, [, l]]) => `<option value="${v}" ${d.stato === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field" id="cc-termine-box" style="flex:0 0 160px"><label>Termine per l'impresa</label>
        <input type="date" id="cc-termine" value="${esc(d.termine_il || '')}"></div>
      <div class="field" id="cc-esito-box" style="flex:1 1 220px"><label>Esito *</label>
        <select id="cc-esito"><option value="">– com'è finita –</option>${Object.entries(ESITI).map(([v, l]) => `<option value="${v}" ${d.esito === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Risposta dell'ufficio <span class="hint">(la legge anche il tecnico nel gestionale)</span></label>
      <textarea id="cc-gest" rows="3" style="width:100%" placeholder="Che cosa si è deciso e fatto: impresa contattata, ulteriore visita, proposta di conferenza di cantiere, demandato alla Presidenza…">${esc(d.gestione_note || '')}</textarea></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
      ${d.stato === 'nuovo' ? '<button class="btn btn-ghost btn-sm" id="cc-incarico">📨 Prendi in gestione</button>' : ''}
      <button class="btn btn-primary btn-sm" id="cc-salva">💾 Salva</button>
    </div>

    <hr style="margin:12px 0 8px;border:0;border-top:1px solid var(--bordo)">
    <div style="font-weight:600;margin-bottom:4px">Cronologia</div>
    <div id="cc-crono">${(eventi || []).map((e) => `
      <div class="dt-doc-riga" style="white-space:pre-wrap;font-size:12.5px"><span class="hint">${oraIt(e.created_at)}</span>
        <strong>${esc(EVENTI[e.tipo] || e.tipo)}</strong>${e.visibile_tecnico ? '' : ' <span class="hint" title="Non lo vede il tecnico">🔒</span>'}
        ${e.testo ? `— ${esc(e.testo)}` : ''} <span class="hint">${esc(e.autore || '')}</span></div>`).join('') || '<p class="hint">Ancora niente.</p>'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px">
      <div class="field" style="flex:0 0 230px"><label>Aggiungi alla cronologia</label>
        <select id="cc-ev-tipo">${Object.keys(EVENTI_A_MANO).map((t) => `<option value="${t}">${esc(EVENTI[t])}</option>`).join('')}</select></div>
      <div class="field" style="flex:1 1 240px"><label>Che cosa</label><input type="text" id="cc-ev-testo" maxlength="1000" placeholder="chi ha chiamato, che cosa si è detto, che cosa si è deciso…"></div>
      <label class="hint" style="display:flex;align-items:center;gap:4px;margin-bottom:8px"><input type="checkbox" id="cc-ev-vis"> lo vede il tecnico</label>
      <button class="btn btn-ghost btn-sm" id="cc-ev-add" style="margin-bottom:6px">➕ Aggiungi</button>
    </div>
    <p class="hint" style="margin-top:8px">Quello che ha scritto il tecnico non si modifica, la cronologia non si corregge: si aggiunge. Per chiudere servono l'esito e la risposta dell'ufficio.
      Se l'impresa non si fa sentire si scrive «nessun contatto registrato», non «non ha risposto»: il silenzio dice della nostra attesa, non dell'impresa.</p>`);

  const campi = () => {
    const st = $('#cc-stato').value;
    $('#cc-termine-box').style.display = st === 'attesa_impresa' ? '' : 'none';
    $('#cc-esito-box').style.display = st === 'chiuso' ? '' : 'none';
    if (st === 'attesa_impresa' && !$('#cc-termine').value) $('#cc-termine').value = fra(GIORNI_TERMINE);
  };
  $('#cc-stato').addEventListener('change', campi);
  campi();
  const visDefault = () => { $('#cc-ev-vis').checked = !!EVENTI_A_MANO[$('#cc-ev-tipo').value]; };
  $('#cc-ev-tipo').addEventListener('change', visDefault);
  visDefault();

  const salva = async (btn, forza = {}) => {
    const stato = forza.stato || $('#cc-stato').value;
    const gestione = (forza.gestione_note ?? $('#cc-gest').value).trim();
    const esito = forza.esito || $('#cc-esito').value || null;
    if (stato === 'chiuso' && !gestione) return toast('Per chiudere scrivi com\'è stato gestito.', 'err');
    if (stato === 'chiuso' && !esito) return toast('Per chiudere indica l\'esito.', 'err');
    attendi(btn, true, 'Salvo…');
    const { error: e } = await sb.from('s_cantieri_critici').update({
      stato, gestione_note: gestione || null,
      termine_il: stato === 'attesa_impresa' ? ($('#cc-termine').value || fra(GIORNI_TERMINE)) : null,
      esito: stato === 'chiuso' ? esito : null,
      esito_visita_id: stato === 'chiuso' ? (forza.esito_visita_id || d.esito_visita_id || null) : null,
    }).eq('id', d.id);
    attendi(btn, false);
    if (e) return toast('Salvataggio non riuscito: ' + e.message, 'err');
    toast('Caso aggiornato.', 'ok');
    if (dopo) dopo();
    if (stato === 'chiuso') chiudiDrawer(); else riapri();
  };
  $('#cc-salva').addEventListener('click', (ev) => salva(ev.currentTarget));
  $('#cc-incarico')?.addEventListener('click', (ev) => salva(ev.currentTarget, { stato: 'in_gestione' }));
  $('#cc-risolta')?.addEventListener('click', (ev) => {
    const v = successiva.dati || {};
    salva(ev.currentTarget, {
      stato: 'chiuso', esito: 'risolta_visita', esito_visita_id: v.visita_id || null,
      gestione_note: $('#cc-gest').value.trim() || `Visita effettuata: verbale ${v.nr_verbale || ''} del ${dataIt(v.data_visita)}.`,
    });
  });
  $('#cc-ev-add').addEventListener('click', async (ev) => {
    const testo = $('#cc-ev-testo').value.trim();
    if (!testo) return toast('Scrivi che cosa è successo.', 'err');
    attendi(ev.currentTarget, true, '…');
    const { error: e } = await sb.from('s_cantieri_critici_eventi')
      .insert({ critico_id: d.id, tipo: $('#cc-ev-tipo').value, testo, visibile_tecnico: $('#cc-ev-vis').checked });
    attendi(ev.currentTarget, false);
    if (e) return toast('Non aggiunto: ' + e.message, 'err');
    riapri();
  });
  $('#cc-impresa')?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    chiudiDrawer();
    const mod = await import('./imprese.js');
    mod.apriScheda(d.impresa_id);   /* cambia vista da sé, come da persona.js e rls.js */
  });
}

/* tutti, anche i chiusi: per ritrovare quello che è già stato gestito */
export async function elenco(dopo = null) {
  const { data, error } = await sb.from('s_cantieri_critici')
    .select('id, created_at, origine, data_evento, tecnico_nome, impresa_nome, cantiere_desc, stato, esito, termine_il')
    .order('created_at', { ascending: false }).limit(300);
  if (error) return toast(error.message, 'err');
  apriDrawer('Cantieri critici — tutti i casi', '', `
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-primary btn-sm" id="cc-nuovo">➕ Nuovo caso</button></div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>N°</th><th></th><th>Data</th><th>Tecnico</th><th>Impresa</th><th>Cantiere</th><th>Stato</th></tr></thead>
      <tbody>${(data || []).map((r) => `<tr data-cc="${r.id}" style="cursor:pointer"><td>${r.id}</td>
        <td title="${esc((ORIGINI[r.origine] || [])[1] || '')}">${(ORIGINI[r.origine] || [''])[0]}</td><td>${dataIt(r.data_evento)}</td>
        <td>${esc((r.tecnico_nome || '').split(' ')[0])}</td><td>${esc(r.impresa_nome)}</td><td>${esc(r.cantiere_desc)}</td>
        <td>${pill(r.stato)}${scaduto(r) ? ' <span class="hint" style="color:#a01f00">termine scaduto</span>' : ''}${r.esito ? ` <span class="hint">${esc(ESITI[r.esito] || r.esito)}</span>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nessun caso.</td></tr>'}</tbody></table></div>`);
  $('#drawer-body').querySelectorAll('tr[data-cc]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglio(Number(tr.dataset.cc), dopo)));
  $('#cc-nuovo').addEventListener('click', () => nuovo(dopo));
}

/* il caso aperto a mano dalla segreteria: una telefonata del tecnico, una
   segnalazione arrivata per altra via. Il tecnico indicato lo ritrova nel
   proprio elenco del gestionale. */
export async function nuovo(dopo = null) {
  const { data: tecnici } = await sb.from('tecnici').select('tecnico_id, tecnico_nome, tecnico_cognome, attivo')
    .eq('attivo', true).order('tecnico_cognome');
  apriDrawer('Cantiere critico — nuovo caso', '', `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 220px"><label>Che cos'è *</label>
        <select id="cn-origine"><option value="accesso_negato">🚫 Accesso negato (riferito dal tecnico)</option><option value="manuale">📝 Altra criticità</option></select></div>
      <div class="field" style="flex:0 0 160px"><label>Data *</label><input type="date" id="cn-data" value="${oggi()}" max="${oggi()}"></div>
      <div class="field" style="flex:1 1 200px"><label>Tecnico *</label>
        <select id="cn-tecnico"><option value="">– scegli –</option>${(tecnici || []).map((t) => `<option value="${esc(t.tecnico_id)}">${esc(t.tecnico_cognome + ' ' + t.tecnico_nome)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Impresa *</label><input type="text" id="cn-impresa" maxlength="200" placeholder="Ragione sociale"></div>
    <div class="field"><label>Cantiere *</label><input type="text" id="cn-cantiere" maxlength="300" placeholder="Indirizzo, comune"></div>
    <div class="field" id="cn-motivo-box"><label>Che cosa è successo</label>
      <select id="cn-motivo"><option value="">–</option>${Object.entries(MOTIVI).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 200px"><label>Persona presente</label><input type="text" id="cn-pp" maxlength="120" placeholder="Cognome e nome, se si sa"></div>
      <div class="field" style="flex:1 1 160px"><label>In qualità di</label><input type="text" id="cn-pp-qual" maxlength="80"></div>
      <div class="field" style="flex:0 0 150px"><label>Telefono</label><input type="tel" id="cn-pp-tel" maxlength="40"></div>
    </div>
    <div class="field"><label>Note *</label><textarea id="cn-note" rows="4" style="width:100%" placeholder="Che cosa è stato riferito, da chi e come"></textarea></div>
    <div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="cn-annulla">Annulla</button>
      <button class="btn btn-primary btn-sm" id="cn-salva">💾 Apri il caso</button></div>`);
  $('#cn-origine').addEventListener('change', () => { $('#cn-motivo-box').style.display = $('#cn-origine').value === 'accesso_negato' ? '' : 'none'; });
  $('#cn-annulla').addEventListener('click', () => elenco(dopo));
  $('#cn-salva').addEventListener('click', async (ev) => {
    const v = (id) => $(id).value.trim();
    if (!v('#cn-data') || !v('#cn-tecnico') || !v('#cn-impresa') || !v('#cn-cantiere') || !v('#cn-note')) return toast('Servono data, tecnico, impresa, cantiere e note.', 'err');
    attendi(ev.currentTarget, true, 'Apro…');
    const accesso = v('#cn-origine') === 'accesso_negato';
    const { data: r, error } = await sb.from('s_cantieri_critici').insert({
      origine: v('#cn-origine'), data_evento: v('#cn-data'), tecnico_id: v('#cn-tecnico'),
      impresa_nome: v('#cn-impresa'), cantiere_desc: v('#cn-cantiere'), note: v('#cn-note'),
      motivo: accesso ? (v('#cn-motivo') || null) : null,
      presente_cognome: v('#cn-pp') || null, presente_qualifica: v('#cn-pp-qual') || null, presente_tel: v('#cn-pp-tel') || null,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Caso non aperto: ' + error.message, 'err');
    toast(`Caso n° ${r.id} aperto.`, 'ok');
    if (dopo) dopo();
    dettaglio(r.id, dopo);
  });
}
