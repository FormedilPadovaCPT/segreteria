/* ============================================================
   Scheda impresa — la maschera "Imprese" di Access.
   Ricerca per nome, codice fiscale, partita IVA o codice CEIV,
   poi testata e sottoschede: Anagrafica, Cantieri, Persone,
   Attività.

   Sui cantieri la distinzione richiesta dall'ufficio:
     · verde    = l'impresa è la prima impresa del cantiere
     · ambra    = compare tra le imprese successive
     · azzurro  = risulta operante secondo CEIV/CNCE
   ============================================================ */

import { sb, state, $, $$, esc, dataIt, toast, attendi, mostraVista, apriDrawer } from './core.js';

let scheda = null;          // ultimo JSON caricato
let schedaTab = 'anagrafica';

/* ══════════════ RICERCA ══════════════ */
export function render() {
  const host = $('#imprese-host');
  host.innerHTML = `
    <div class="view-head"><h2>Imprese</h2></div>
    <div class="ricerca-imp">
      <input type="search" id="imp-cerca" class="inp"
             placeholder="Ragione sociale, codice fiscale, partita IVA o codice CEIV — almeno 3 caratteri">
      <button class="btn btn-primary" id="imp-vai">Cerca</button>
      <button class="btn btn-ghost" id="imp-nuova">+ Nuova impresa</button>
    </div>
    <div id="imp-risultati"></div>`;

  const cerca = () => eseguiRicerca($('#imp-cerca').value.trim());
  $('#imp-vai').addEventListener('click', cerca);
  $('#imp-cerca').addEventListener('keydown', (e) => { if (e.key === 'Enter') cerca(); });
  $('#imp-cerca').focus();
  $('#imp-nuova').addEventListener('click', nuovaImpresa);
}

/* Creazione minima: i campi identificativi, il resto si completa
   dalla scheda. Il codice fiscale/P.IVA e' la chiave (impresa_id):
   prima di creare si controlla che non esista gia'. */
function nuovaImpresa() {
  const box = $('#imp-risultati');
  box.innerHTML = `
    <div class="sez" style="max-width:720px">
      <h3>Nuova impresa</h3>
      <div class="grid-3">
        <div class="field full"><label>Ragione sociale *</label><input type="text" id="ni-nome"></div>
        <div class="field"><label>Codice fiscale / P.IVA *</label><input type="text" id="ni-id" placeholder="11 cifre o CF"></div>
        <div class="field"><label>Codice CEIV</label><input type="text" id="ni-ceiv"></div>
        <div class="field"><label>Telefono</label><input type="text" id="ni-tel"></div>
        <div class="field full"><label>Indirizzo</label><input type="text" id="ni-ind"></div>
        <div class="field"><label>Comune</label><input type="text" id="ni-comune"></div>
        <div class="field"><label>Email</label><input type="text" id="ni-email"></div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button class="btn btn-ghost" id="ni-annulla">Annulla</button>
        <button class="btn btn-primary" id="ni-crea">Crea e apri la scheda</button>
      </div>
    </div>`;
  $('#ni-annulla').addEventListener('click', render);
  $('#ni-crea').addEventListener('click', async (ev) => {
    const nome = $('#ni-nome').value.trim();
    const id = $('#ni-id').value.trim().toUpperCase().replace(/\s/g, '');
    if (!nome || !id) return toast('Servono ragione sociale e codice fiscale/P.IVA.', 'err');
    attendi(ev.currentTarget, true);
    const { data: gia } = await sb.from('imprese').select('impresa_id').eq('impresa_id', id).maybeSingle();
    if (gia) {
      attendi(ev.currentTarget, false);
      toast('Esiste già un\'impresa con questo codice: la apro.', 'err');
      return apriScheda(id);
    }
    const { error } = await sb.from('imprese').insert({
      impresa_id: id,
      impresa_nome: nome,
      cod_ceiv: $('#ni-ceiv').value.trim() || null,
      impresa_telefono: $('#ni-tel').value.trim() || null,
      indirizzo: $('#ni-ind').value.trim() || null,
      comune: $('#ni-comune').value.trim() || null,
      impresa_email_ref: $('#ni-email').value.trim() || null,
      note_access: `Creata a mano dalla maschera Imprese (${state.email}, ${new Date().toISOString().slice(0, 10)})`,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Impresa creata.', 'ok');
    apriScheda(id);
  });
}

async function eseguiRicerca(testo) {
  const box = $('#imp-risultati');
  if (testo.length < 3) { box.innerHTML = '<p class="empty">Scrivi almeno tre caratteri.</p>'; return; }

  box.innerHTML = '<p class="empty">Ricerca in corso…</p>';
  const { data, error } = await sb.rpc('s_cerca_imprese', { p_testo: testo, p_limite: 60 });
  if (error) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; }
  if (!data?.length) { box.innerHTML = '<p class="empty">Nessuna impresa trovata.</p>'; return; }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th>Ragione sociale</th><th style="width:150px">Codice fiscale</th>
          <th style="width:120px">CEIV</th><th style="width:180px">Comune</th>
          <th style="width:90px">Stato</th>
        </tr></thead>
        <tbody>
          ${data.map((i) => `
            <tr data-imp="${esc(i.impresa_id)}">
              <td><strong>${esc(i.impresa_nome)}</strong>${i.pec ? `<span class="cell-sub">${esc(i.pec)}</span>` : ''}</td>
              <td>${esc(i.impresa_id)}</td>
              <td>${esc(i.cod_ceiv || '')}</td>
              <td>${esc([i.comune, i.prov].filter(Boolean).join(' — '))}</td>
              <td>${esc(i.stato || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:12px;color:var(--testo-soft);margin-top:8px">${data.length} risultati (massimo 60).</p>`;

  box.querySelectorAll('tr[data-imp]').forEach((tr) =>
    tr.addEventListener('click', () => apriScheda(tr.dataset.imp)));
}

/* ══════════════ SCHEDA ══════════════ */
export async function apriScheda(impresaId, tab = 'anagrafica') {
  mostraVista('imprese');
  const host = $('#imprese-host');
  host.innerHTML = '<p class="empty">Caricamento della scheda…</p>';

  const { data, error } = await sb.rpc('s_scheda_impresa', { p_id: impresaId });
  if (error || !data?.impresa) {
    host.innerHTML = `<p class="empty">Scheda non disponibile: ${esc(error?.message || 'impresa non trovata')}</p>`;
    return;
  }
  scheda = data;
  schedaTab = tab;

  /* I codici ATECO veri (dalla tabella Access Atecoimprese, con la
     loro storia) e le descrizioni ISTAT: un'impresa può averne più
     d'uno, con date diverse. */
  try {
    const { data: ateco } = await sb.from('imprese_ateco')
      .select('codice, data_ateco').eq('impresa_id', impresaId)
      .order('data_ateco', { ascending: false, nullsFirst: false });
    scheda.ateco = ateco || [];
    if (scheda.ateco.length) {
      const codici = [...new Set(scheda.ateco.map((a) => a.codice))];
      const { data: descr } = await sb.from('ateco_codici')
        .select('versione, codice, descrizione').in('codice', codici);
      const mappa = {};
      for (const d of (descr || [])) {
        /* si preferisce la 2007 (la classificazione dei dati storici);
           dove il codice esiste solo nella 2025, vale quella */
        if (!mappa[d.codice] || d.versione === '2007') mappa[d.codice] = d;
      }
      scheda.ateco.forEach((a) => { a.desc = mappa[a.codice] || null; });
    }
  } catch { scheda.ateco = []; }

  /* gli RLS comunicati dall'impresa (anagrafe CCPL 3/3/2022):
     compaiono fra le persone, accanto a dipendenti e nomine */
  try {
    const { data: rls } = await sb.from('s_rls_anagrafe')
      .select('id, rls_titolo, rls_nome, rls_cognome, rls_nominativo, rls_cf, tipo_elezione, decorrenza, fine_nomina, ente_corso, data_corso')
      .eq('impresa_id', impresaId)
      .order('decorrenza', { ascending: false, nullsFirst: false });
    scheda.rls = rls || [];
  } catch { scheda.rls = []; }

  disegnaScheda();
}

function disegnaScheda() {
  const i = scheda.impresa;
  const n = (k) => (scheda[k] || []).length;
  const cantieri = (scheda.cantieri_visitati || []).length + (scheda.cantieri_ceiv || []).length;

  $('#imprese-host').innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-ghost btn-sm" id="imp-indietro">‹ Torna alla ricerca</button>
    </div>

    <div class="imp-head">
      <h2>${esc(i.impresa_nome || '')}</h2>
      ${i.ragione_sociale2 && i.ragione_sociale2 !== i.impresa_nome
        ? `<p style="color:var(--testo-soft);font-size:13px;margin:0 0 10px">${esc(i.ragione_sociale2)}</p>` : ''}
      <div class="imp-chips">
        ${i.cassa_edile ? `<span class="chip chip-ce"><b>${esc(i.cassa_edile)}</b><span>Cassa Edile</span></span>` : ''}
        ${i.cod_ceiv ? `<span class="chip chip-ceiv"><b>${esc(i.cod_ceiv)}</b><span>Cod. CEIV</span></span>` : ''}
        ${i.cod_socrate ? `<span class="chip chip-socrate"><b>${esc(i.cod_socrate)}</b><span>Cod. Socrate</span></span>` : ''}
        <span class="chip"><b>${esc(i.impresa_id)}</b><span>Codice fiscale</span></span>
        ${i.piva && i.piva !== i.impresa_id ? `<span class="chip"><b>${esc(i.piva)}</b><span>Partita IVA</span></span>` : ''}
        ${i.comune ? `<span class="chip"><b>${esc(i.comune)}${i.prov ? ' (' + esc(i.prov) + ')' : ''}</b><span>Comune</span></span>` : ''}
        ${i.stato ? `<span class="pill ${/attiv/i.test(i.stato) ? 'pill-prima' : 'pill-off'}">${esc(i.stato)}</span>` : ''}
      </div>
    </div>

    <div class="tabs" id="imp-tabs">
      <button class="tab-btn" data-tab="anagrafica">Anagrafica</button>
      <button class="tab-btn" data-tab="cantieri">Cantieri <span class="cnt">${cantieri}</span></button>
      <button class="tab-btn" data-tab="persone">Persone <span class="cnt">${n('persone') + n('nomine') + n('rls')}</span></button>
      <button class="tab-btn" data-tab="attivita">Attività <span class="cnt">${n('visite') + n('richieste') + n('protocolli')}</span></button>
    </div>

    <div id="imp-tab-host"></div>`;

  $('#imp-indietro').addEventListener('click', render);
  $$('#imp-tabs .tab-btn').forEach((b) => b.addEventListener('click', () => {
    schedaTab = b.dataset.tab;
    disegnaTab();
  }));
  disegnaTab();
}

function disegnaTab() {
  $$('#imp-tabs .tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === schedaTab));
  const host = $('#imp-tab-host');
  if (schedaTab === 'cantieri') host.innerHTML = tabCantieri();
  else if (schedaTab === 'persone') host.innerHTML = tabPersone();
  else if (schedaTab === 'attivita') host.innerHTML = tabAttivita();
  else { host.innerHTML = tabAnagrafica(); agganciaAnagrafica(); }

  /* controllo manuale sui siti camerali (ufficiocamerale.it e
     registroimprese.it): entrambe le ricerche sono POST — captcha il
     primo, portlet il secondo — e non accettano la P.IVA
     nell'indirizzo. Quindi si copia negli appunti e si apre la
     pagina: incolli e premi Cerca. */
  host.querySelectorAll('[data-verifica]').forEach((b) => b.addEventListener('click', async () => {
    const piva = scheda.impresa.piva || scheda.impresa.impresa_id || '';
    try { await navigator.clipboard.writeText(piva); toast(`P.IVA ${piva} copiata: incollala nella ricerca.`, 'ok'); }
    catch { toast('Non riesco a copiare la P.IVA: scrivila a mano — ' + piva, 'err'); }
    window.open(b.dataset.verifica, '_blank', 'noopener');
  }));

  /* apertura del protocollo dal riepilogo attività */
  host.querySelectorAll('tr[data-prot]').forEach((tr) =>
    tr.addEventListener('click', async () => {
      const { apriDettaglio } = await import('./protocollo.js');
      apriDettaglio(Number(tr.dataset.prot));
    }));

  /* dalle persone dell'impresa alle loro schede */
  host.querySelectorAll('tr[data-pers]').forEach((tr) =>
    tr.addEventListener('click', async () => {
      const { apriPersona } = await import('./persona.js');
      apriPersona(tr.dataset.pers);
    }));
  host.querySelectorAll('tr[data-nomina]').forEach((tr) =>
    tr.addEventListener('click', async () => {
      const { apriNomina } = await import('./nomine.js');
      apriNomina(Number(tr.dataset.nomina));
    }));
  host.querySelectorAll('tr[data-rlscom]').forEach((tr) =>
    tr.addEventListener('click', async () => {
      const { apriComunicazioneId } = await import('./rls.js');
      apriComunicazioneId(Number(tr.dataset.rlscom));
    }));

  /* visite e richieste si aprono in dettaglio */
  host.querySelectorAll('tr[data-vis]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglioVisita(tr.dataset.vis)));
  host.querySelectorAll('tr[data-ric]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglioRichiesta(Number(tr.dataset.ric))));
}

/* ── dettaglio visita (dal gestionale visite, in sola lettura) ── */
async function dettaglioVisita(visitaId) {
  const [{ data: v, error }, { count: nFoto }] = await Promise.all([
    sb.from('visite').select('*').eq('visita_id', visitaId).maybeSingle(),
    sb.from('visite_foto').select('id', { count: 'exact', head: true }).eq('visita_id', visitaId),
  ]);
  if (error || !v) return toast('Visita non trovata: ' + (error?.message || visitaId), 'err');
  const r = (scheda.visite || []).find((x) => x.visita_id === visitaId) || {};
  const campo = (l, val) => val ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(String(val))}</div>` : '';
  const nome3 = (t, n, c) => [t, n, c].filter(Boolean).join(' ');

  apriDrawer(`Visita ${v.nr_verbale ? 'verbale ' + v.nr_verbale : ''} — ${dataIt(v.data_visita)}`, '', `
    ${campo('Cantiere', [r.cantiere_indirizzo, r.comune_nome].filter(Boolean).join(' — '))}
    ${campo('Tecnico', r.tecnico)}
    ${campo('Orario', [v.ora_visita, v.ora_fine].filter(Boolean).join(' → '))}
    ${campo('Stato', [v.stato, v.chiusa ? `chiusa${v.data_chiusura ? ' il ' + dataIt(v.data_chiusura) : ''}` : null].filter(Boolean).join(' — '))}
    ${campo('Esito / osservazioni', v.esito_osserv)}
    ${campo('IPC', `${v.ipc ?? 0} (NC+ ${v.ipc_nc_plus ?? 0} · NC− ${v.ipc_nc_minus ?? 0} · OSS ${v.ipc_oss ?? 0})`)}
    ${campo('Lavoratori presenti', v.nr_lavoratori != null ? `${v.nr_lavoratori}${v.nr_lavoratori_stranieri ? ` (di cui ${v.nr_lavoratori_stranieri} stranieri)` : ''}` : null)}
    ${campo('Stato lavori', v.stato_lav)}
    ${campo('Accesso', [v.tipo_accesso, v.acc_cant].filter(Boolean).join(' — '))}
    ${campo('Preposto', [nome3(v.ppre_titolo, v.ppre_nome, v.ppre_cog) || v.nom_ppre, v.qual_ppre, v.tel_ppre].filter(Boolean).join(' · '))}
    ${campo('Legale rappr.', [nome3(v.rl_titolo, v.rl_nome, v.rl_cog) || v.impresa_rl_nome, v.rl_tel, v.rl_email].filter(Boolean).join(' · '))}
    ${campo('CSP', nome3(v.csp_titolo, v.csp_nome, v.csp_cog) || v.csp)}
    ${campo('CSE', nome3(v.cse_titolo, v.cse_nome, v.cse_cog) || v.cse)}
    ${campo('RLST presente', v.rlst_sn)}
    ${campo('Ritorno previsto', v.data_ritorno ? dataIt(v.data_ritorno) : null)}
    ${campo('Note visita', v.note_visita)}
    ${campo('Prescrizioni', v.prescrizioni)}
    ${campo('Osservazioni del tecnico', v.oss_tec)}
    ${campo('Note lavoratori', v.note_lav)}
    ${campo('Fotografie', nFoto ? `${nFoto} nel gestionale visite` : null)}
    <p class="hint" style="margin-top:12px">Dettaglio in sola lettura dal Gestionale Visite: per modifiche si lavora di là.</p>
  `);
}

/* ── dettaglio richiesta / incarico ───────────────────────── */
async function dettaglioRichiesta(id) {
  const { data: r, error } = await sb.from('incarichi').select('*').eq('id', id).maybeSingle();
  if (error || !r) return toast('Richiesta non trovata: ' + (error?.message || id), 'err');
  const campo = (l, val) => val ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(String(val))}</div>` : '';

  apriDrawer(`Richiesta del ${dataIt(r.data_richiesta)} — ${r.tipologia_richiesta || r.tipo_richiesta || ''}`, '', `
    ${campo('Richiedente', [r.richiedente, r.mezzo].filter(Boolean).join(' · '))}
    ${campo('Testo', r.testo_richiesta)}
    ${campo('Cantiere', [r.cantiere, r.indirizzo, r.comune].filter(Boolean).join(' · '))}
    ${campo('Referente', [r.referente, r.cell_referente].filter(Boolean).join(' · '))}
    ${campo('Approvata', r.approvato === true ? 'sì' : r.approvato === false ? 'no' : null)}
    ${campo('Tecnico incaricato', r.tecnico_nome)}
    ${campo('Comunicazione segreteria', r.data_com_segreteria ? dataIt(r.data_com_segreteria) : null)}
    ${campo('Risposta', r.data_risposta ? dataIt(r.data_risposta) : null)}
    ${campo('Visite', r.visite_previste != null || r.visite_fatte != null ? `${r.visite_fatte ?? 0} fatte su ${r.visite_previste ?? '?'} previste` : null)}
    ${campo('Verbale', [r.verbale_visita, r.data_verbale].filter(Boolean).join(' del '))}
    ${campo('Corrispettivo', r.corrispettivo != null ? `€ ${r.corrispettivo}${r.ore ? ` · ${r.ore} ore` : ''}` : null)}
    ${campo('Valutazione cantiere', r.valutazione_cantiere)}
    ${campo('Note comunicazione', r.note_comunicazione)}
    ${campo('Note del tecnico', r.note_tecnico)}
    ${campo('Stato', [r.stato, r.eseguito_il ? `eseguita il ${dataIt(r.eseguito_il.slice(0, 10))}` : null, r.chiuso_il ? `chiusa il ${dataIt(r.chiuso_il.slice(0, 10))}` : null].filter(Boolean).join(' — '))}
  `);
}

/* ── ANAGRAFICA (modificabile) ────────────────────────────── */
const CAMPI = [
  ['Identificazione e sede', 'grid-6', [
    ['impresa_nome', 'Ragione sociale', 'span3'],
    ['ragione_sociale2', 'Ragione sociale estesa', 'span3'],
    ['impresa_id', 'Codice fiscale (chiave)', '', true],
    ['piva', 'Partita IVA'],
    ['tipo_impresa', 'Forma giuridica'],
    ['ruolo', 'Ruolo'],
    ['stato', 'Stato'],
    ['tipologia_impresa', 'Tipologia impresa'],
    ['indirizzo', 'Indirizzo', 'span2'],
    ['comune', 'Comune'],
    ['prov', 'Provincia'],
    ['cap', 'CAP'],
    ['sede_amministrativa', 'Sede amministrativa', 'span3'],
  ]],
  ['Contatti', 'grid-5', [
    ['impresa_email_ref', 'Email di riferimento'],
    ['impresa_email2', 'Email 2'],
    ['impresa_email3', 'Email 3'],
    ['pec', 'PEC'],
    ['impresa_telefono', 'Telefono'],
    ['impresa_telefono2', 'Telefono 2'],
    ['tel_3', 'Telefono 3'],
    ['cellulare', 'Cellulare'],
    ['pagina_web', 'Sito web', 'span2'],
  ]],
  ['Inquadramento e codici', 'grid-6', [
    ['ccnl', 'CCNL'],
    ['contratto_ccnl', 'Contratto CCNL'],
    ['contratto_ccnl_altro', 'Altro contratto'],
    ['cassa_edile', 'Codice Cassa Edile'],
    ['ce', 'Cassa Edile'],
    ['ce_altra', 'Altra Cassa Edile'],
    ['stato_cassa', 'Stato in Cassa'],
    ['cod_ceiv', 'Codice CEIV'],
    ['cod_socrate', 'Codice Socrate'],
    ['cod_sdi', 'Codice SDI'],
    ['n_inps', 'Posizione INPS'],
    ['n_inail', 'Posizione INAIL'],
    ['ance', 'ANCE'],
    /* att_codice NON è l'ATECO: è la categoria interna di Access
       (COE, STU, PIR...). L'ATECO vero sta in imprese_ateco e ha la
       sua sezione qui sotto. Etichetta corretta il 30/08/2026. */
    ['att_codice', 'Categoria attività (interna)'],
    ['numero_addetti', 'N° addetti'],
    ['numero_dip_isc_ce_pd', 'Dipendenti iscritti CE PD'],
    ['rspp', 'RSPP', 'span2'],
  ]],
];

function tabAnagrafica() {
  const i = scheda.impresa;
  const campo = ([k, etichetta, cls, bloccato]) => `
    <div class="field ${cls || ''}">
      <label for="ia-${k}">${esc(etichetta)}</label>
      <input type="text" id="ia-${k}" data-campo="${k}" value="${esc(i[k] ?? '')}"
             ${bloccato ? 'readonly class="readonly"' : ''}>
    </div>`;

  return `
    ${CAMPI.map(([titolo, griglia, campi]) => `
      <div class="sez">
        <h3>${esc(titolo)}</h3>
        <div class="${griglia}">${campi.map(campo).join('')}</div>
      </div>`).join('')}

    <div class="sez">
      <h3>Codici ATECO</h3>
      ${(scheda.ateco || []).length
        ? `<div>${scheda.ateco.map((a, idx) => `
            <div class="dt-doc-riga" style="padding:4px 0;${idx === 0 ? 'font-weight:600' : ''}">
              <code>${esc(a.codice)}</code>
              ${a.desc ? `&mdash; ${esc(a.desc.descrizione)} <span style="color:var(--testo-soft);font-size:11px">(ATECO ${esc(a.desc.versione)})</span>` : ''}
              ${a.data_ateco ? `<span style="color:var(--testo-soft)"> &middot; dal ${esc(a.data_ateco.split('-').reverse().join('/'))}</span>` : ''}
            </div>`).join('')}
           <p class="hint" style="margin-top:6px">Dalla tabella Access Atecoimprese; il più recente in grassetto. Descrizioni ISTAT.</p></div>`
        : '<p class="hint">Nessun codice ATECO registrato per questa impresa.</p>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-ghost btn-sm" data-verifica="https://www.ufficiocamerale.it/trova-azienda">🔎 ufficiocamerale.it</button>
        <span class="hint" style="align-self:center">il bottone copia la P.IVA: incollala nella ricerca</span>
      </div>
    </div>

    <div class="sez">
      <h3>Note d'ufficio</h3>
      <textarea id="ia-note_access" data-campo="note_access" style="min-height:110px">${esc(i.note_access ?? '')}</textarea>
    </div>

    <div class="sez">
      <h3>Certificazioni</h3>
      ${(scheda.certificazioni || []).length
        ? `<ul style="margin:0;padding-left:18px;line-height:1.8">
             ${scheda.certificazioni.map((c) => `<li>${esc(c.certificazione)}</li>`).join('')}
           </ul>`
        : '<p class="empty" style="padding:8px">Nessuna certificazione registrata.</p>'}
    </div>

    <div class="form-actions">
      <span style="flex:1;font-size:12px;color:var(--testo-soft)">
        Ogni modifica viene registrata con data e autore. Il codice fiscale è la chiave con cui
        l'impresa è collegata a visite, cantieri e protocolli: non si cambia da qui.
      </span>
      <button class="btn btn-primary" id="ia-salva">Salva le modifiche</button>
    </div>`;
}

function agganciaAnagrafica() {
  $('#ia-salva')?.addEventListener('click', async (e) => {
    const dati = {};
    $$('[data-campo]').forEach((el) => {
      if (el.readOnly) return;
      const k = el.dataset.campo;
      const v = el.value.trim();
      if ((scheda.impresa[k] ?? '') + '' !== v) dati[k] = v === '' ? null : v;
    });

    if (!Object.keys(dati).length) return toast('Nessuna modifica da salvare.');

    attendi(e.currentTarget, true, 'Salvataggio…');
    const { data, error } = await sb.rpc('s_aggiorna_impresa', {
      p_id: scheda.impresa.impresa_id, p_dati: dati,
    });
    attendi(e.currentTarget, false);

    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast(`Salvato: ${data.modificati} ${data.modificati === 1 ? 'campo modificato' : 'campi modificati'}.`, 'ok');
    apriScheda(scheda.impresa.impresa_id, 'anagrafica');
  });
}

/* ── CANTIERI ─────────────────────────────────────────────── */
function tabCantieri() {
  const visitati = scheda.cantieri_visitati || [];
  const ceiv = scheda.cantieri_ceiv || [];
  const prime = visitati.filter((c) => c.prima_impresa).length;

  const indirizzo = (c) => [c.cantiere_indirizzo, c.cantiere_civico].filter(Boolean).join(' ');

  return `
    <div class="legenda">
      <span><i style="background:var(--prima)"></i>prima impresa del cantiere (${prime})</span>
      <span><i style="background:var(--succ)"></i>presente tra le imprese successive (${visitati.length - prime})</span>
      <span><i style="background:var(--ceiv)"></i>operante secondo CEIV (${ceiv.length})</span>
    </div>

    <div class="sez">
      <h3>Cantieri con visita — ${visitati.length}</h3>
      ${visitati.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:120px">Ruolo</th><th>Indirizzo</th><th style="width:150px">Comune</th>
            <th style="width:150px">Ruolo dichiarato</th><th style="width:80px">Visite</th>
            <th style="width:110px">Ultima visita</th><th style="width:90px">Stato</th>
          </tr></thead>
          <tbody>
            ${visitati.map((c) => `
              <tr class="${c.prima_impresa ? 'riga-prima' : 'riga-succ'}">
                <td><span class="pill ${c.prima_impresa ? 'pill-prima' : 'pill-succ'}">
                  ${c.prima_impresa ? 'prima' : 'successiva'}</span></td>
                <td>${esc(indirizzo(c))}${c.cantiere_descrizione ? `<span class="cell-sub">${esc(c.cantiere_descrizione)}</span>` : ''}</td>
                <td>${esc(c.comune_nome || '')}</td>
                <td>${esc(c.ruolo || '')}</td>
                <td class="num">${c.n_visite}</td>
                <td>${dataIt(c.ultima_visita)}</td>
                <td>${c.cantiere_chiuso ? '<span class="pill pill-off">chiuso</span>' : '<span class="pill pill-prima">aperto</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessun cantiere visitato per questa impresa.</p>'}
    </div>

    <div class="sez">
      <h3>Cantieri CEIV — ${ceiv.length}</h3>
      ${ceiv.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:150px">Codice CNCE</th><th style="width:110px">Tipo lavoro</th>
            <th>Indirizzo</th><th style="width:140px">Comune</th>
            <th style="width:200px">Committente</th><th style="width:110px">Inizio lavori</th>
            <th style="width:80px">Visite</th>
          </tr></thead>
          <tbody>
            ${ceiv.map((c) => `
              <tr class="riga-ceiv">
                <td style="font-size:11px">${esc(c.cnce || '')}</td>
                <td><span class="pill pill-ceiv">${esc(c.tipo_lavoro || '—')}</span></td>
                <td>${esc(indirizzo(c)) || '<em style="color:var(--testo-soft)">cantiere non ancora in archivio</em>'}
                    ${c.cantiere_descrizione ? `<span class="cell-sub">${esc(c.cantiere_descrizione)}</span>` : ''}</td>
                <td>${esc(c.comune_nome || '')}</td>
                <td>${esc(c.committente_nome || '')}</td>
                <td>${dataIt(c.data_inizio_lavori)}</td>
                <td class="num">${c.n_visite_cantiere ?? 0}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessun cantiere CEIV per questa impresa.</p>'}
    </div>`;
}

/* ── PERSONE ──────────────────────────────────────────────── */
function tabPersone() {
  const rls = scheda.rls || [];
  const oggi = new Date().toISOString().slice(0, 10);
  const fineMandato = (r) => {
    if (r.fine_nomina) return { fine: r.fine_nomina, presunta: false };
    if (!r.decorrenza) return { fine: null };
    const d = new Date(r.decorrenza + 'T00:00:00');
    d.setFullYear(d.getFullYear() + 3);
    return { fine: d.toISOString().slice(0, 10), presunta: true };
  };

  return `
    <div class="sez">
      <h3>RLS comunicati — ${rls.length}</h3>
      ${rls.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>Rappresentante dei Lavoratori</th><th style="width:150px">Codice fiscale</th>
            <th style="width:110px">Tipo</th><th style="width:105px">Dal</th>
            <th style="width:150px">Mandato fino al</th><th>Formazione</th>
          </tr></thead>
          <tbody>
            ${rls.map((r) => {
              const m = fineMandato(r);
              return `<tr data-rlscom="${r.id}" title="Apri la comunicazione RLS">
                <td><strong>${esc([r.rls_titolo, r.rls_cognome, r.rls_nome].filter(Boolean).join(' ') || r.rls_nominativo || '?')}</strong></td>
                <td style="font-size:12px">${esc(r.rls_cf || '')}</td>
                <td>${esc(r.tipo_elezione || '')}</td>
                <td>${dataIt(r.decorrenza)}</td>
                <td>${m.fine ? `<span class="dt-cella ${m.fine < oggi ? 'dt-scaduto' : 'dt-ok'}" style="padding:1px 7px">${dataIt(m.fine)}${m.presunta ? ' ?' : ''}</span>` : ''}</td>
                <td style="font-size:12px">${esc([r.ente_corso, r.data_corso].filter(Boolean).join(' · '))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:4px">Dall'anagrafe RLS (CCPL 3/3/2022). La data col «?» è la scadenza teorica a 3 anni.</p>`
      : '<p class="empty">Nessun RLS comunicato da questa impresa.</p>'}
    </div>
` + tabPersoneResto();
}

function tabPersoneResto() {
  const persone = scheda.persone || [];
  const nomine = scheda.nomine || [];

  return `
    <div class="sez">
      <h3>Dipendenti e rapporti — ${persone.length}</h3>
      ${persone.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th>Nominativo</th><th style="width:150px">Codice fiscale</th>
            <th style="width:150px">Qualifica</th><th style="width:150px">Mansione</th>
            <th style="width:110px">Assunzione</th><th style="width:110px">Cessazione</th>
            <th style="width:200px">Contatti</th>
          </tr></thead>
          <tbody>
            ${persone.map((p) => `
              <tr data-pers="${esc(p.persona_id)}" title="Apri la scheda persona">
                <td><strong>${esc([p.titolo, p.nominativo].filter(Boolean).join(' '))}</strong></td>
                <td style="font-size:12px">${esc(p.cf || '')}</td>
                <td>${esc(p.qualifica || '')}</td>
                <td>${esc(p.mansione || '')}</td>
                <td>${dataIt(p.data_assunzione)}</td>
                <td>${p.data_cessazione ? dataIt(p.data_cessazione) : '<span class="pill pill-prima">in forza</span>'}</td>
                <td style="font-size:12px">${esc([p.email, p.telefono].filter(Boolean).join(' · '))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessuna persona collegata.</p>'}
    </div>

    <div class="sez">
      <h3>Nomine — ${nomine.length}</h3>
      ${nomine.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:110px">Registrata</th><th>Nominativo</th>
            <th style="width:190px">Ruolo</th><th style="width:170px">Mansione</th>
            <th style="width:105px">Dal</th><th style="width:105px">Al</th>
            <th style="width:190px">Email ruolo</th>
          </tr></thead>
          <tbody>
            ${nomine.map((x) => `
              <tr data-nomina="${x.access_id}" title="Apri la nomina">
                <td>${dataIt(x.data_reg)}</td>
                <td><strong>${esc(x.nominativo || '')}</strong>${x.note ? `<span class="cell-sub">${esc(x.note)}</span>` : ''}</td>
                <td>${esc(x.ruolo_txt || '')}</td>
                <td>${esc(x.mansione || '')}</td>
                <td>${dataIt(x.data_inizio)}</td>
                <td>${dataIt(x.data_fine)}</td>
                <td style="font-size:12px">${esc(x.email_ruolo || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessuna nomina registrata.</p>'}
    </div>`;
}

/* ── ATTIVITÀ ─────────────────────────────────────────────── */
function tabAttivita() {
  const visite = scheda.visite || [];
  const richieste = scheda.richieste || [];
  const protocolli = scheda.protocolli || [];

  const coloreIpc = (v) => {
    const n = Number(v);
    if (!n) return 'pill-prima';
    if (n <= 3) return 'pill-succ';
    return 'pill-succ';
  };

  return `
    <div class="sez">
      <h3>Visite in cantiere — ${visite.length}</h3>
      ${visite.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:105px">Data</th><th style="width:90px">Verbale</th>
            <th>Cantiere</th><th style="width:140px">Comune</th>
            <th style="width:170px">Tecnico</th><th style="width:75px">IPC</th>
            <th style="width:130px">NC+ / NC− / OSS</th><th style="width:110px">Ruolo</th>
          </tr></thead>
          <tbody>
            ${visite.map((v) => `
              <tr class="${v.is_principale ? 'riga-prima' : 'riga-succ'}" data-vis="${esc(v.visita_id)}" title="Apri la visita">
                <td>${dataIt(v.data_visita)}</td>
                <td class="num">${esc(v.nr_verbale || '')}</td>
                <td>${esc(v.cantiere_indirizzo || '')}</td>
                <td>${esc(v.comune_nome || '')}</td>
                <td>${esc(v.tecnico || '')}</td>
                <td><span class="pill ${coloreIpc(v.ipc)}">${v.ipc ?? 0}</span></td>
                <td class="num">${v.ipc_nc_plus ?? 0} / ${v.ipc_nc_minus ?? 0} / ${v.ipc_oss ?? 0}</td>
                <td><span class="pill ${v.is_principale ? 'pill-prima' : 'pill-succ'}">
                  ${v.is_principale ? 'prima' : 'successiva'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessuna visita registrata.</p>'}
    </div>

    <div class="sez">
      <h3>Richieste di visita e consulenza — ${richieste.length}</h3>
      ${richieste.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:105px">Data</th><th style="width:210px">Tipologia</th>
            <th style="width:180px">Richiedente</th><th>Testo</th>
            <th style="width:150px">Referente</th><th style="width:105px">Risposta</th>
            <th style="width:100px">Stato</th>
          </tr></thead>
          <tbody>
            ${richieste.map((r) => `
              <tr data-ric="${r.id}" title="Apri la richiesta">
                <td>${dataIt(r.data_richiesta)}</td>
                <td>${esc(r.tipologia_richiesta || '')}</td>
                <td>${esc(r.richiedente || '')}${r.mezzo ? `<span class="cell-sub">${esc(r.mezzo)}</span>` : ''}</td>
                <td><div class="clamp">${esc(r.testo_richiesta || '')}</div>
                    ${r.cantiere || r.indirizzo ? `<span class="cell-sub">${esc([r.cantiere, r.indirizzo, r.comune].filter(Boolean).join(' · '))}</span>` : ''}</td>
                <td>${esc(r.referente || '')}${r.cell_referente ? `<span class="cell-sub">${esc(r.cell_referente)}</span>` : ''}</td>
                <td>${dataIt(r.data_risposta)}</td>
                <td>${r.stato ? `<span class="pill pill-off">${esc(r.stato)}</span>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="empty">Nessuna richiesta registrata.</p>'}
    </div>

    <div class="sez">
      <h3>Protocolli collegati — ${protocolli.length}</h3>
      ${protocolli.length ? `
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr>
            <th style="width:70px">N°</th><th style="width:90px">Direzione</th>
            <th style="width:105px">Data</th><th>Oggetto</th>
            <th style="width:170px">Tipo doc.</th><th style="width:180px">Persona</th>
          </tr></thead>
          <tbody>
            ${protocolli.map((p) => `
              <tr data-prot="${p.id}" class="${p.direzione === 'IN' ? 'row-in' : 'row-out'}${p.annullato ? ' is-annullato' : ''}">
                <td class="num">${p.numero}</td>
                <td><span class="badge badge-${p.direzione.toLowerCase()}">${p.direzione === 'IN' ? 'Entrata' : 'Uscita'}</span></td>
                <td>${dataIt(p.data_prot)}</td>
                <td><div class="clamp">${esc(p.oggetto || '')}</div></td>
                <td>${esc(p.tipo_doc_txt || '')}</td>
                <td>${esc(p.persona || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p style="font-size:12px;color:var(--testo-soft);margin-top:8px">Clicca una riga per aprire il protocollo.</p>`
      : '<p class="empty">Nessun protocollo collegato a questa impresa.</p>'}
    </div>`;
}
