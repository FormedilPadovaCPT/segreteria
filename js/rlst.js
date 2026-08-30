/* ============================================================
   Pratiche di affidamento al servizio RLST.

   Le richieste arrivano dal modulo online e finiscono nel foglio
   Google; la funzione import-rlst (schedulata ogni mattina alle
   6:30, o il bottone «Importa adesso») le porta in s_rlst_pratiche
   con la pre-istruttoria già fatta: controllo CEIV sull'anagrafica,
   aggancio impresa per P.IVA, aggancio del legale rappresentante
   per codice fiscale.

   Qui si completa l'istruttoria: si verifica l'esito CEIV (la
   lista si aggiorna mensilmente — la data d'aggiornamento è
   scritta accanto all'esito), si crea l'impresa o la persona se
   mancano, si annota il verbale di non elezione. La risposta
   all'impresa (lettera + protocollo OUT + bozza mail) è il
   prossimo passo del flusso, in costruzione.
   ============================================================ */

import { sb, state, $, esc, dataIt, toast, attendi, apriDrawer } from './core.js';

let pratiche = [];
let filtroStato = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', istruita: 'Istruita', risposta_protocollata: 'Risposta protocollata',
  inviata: 'Inviata', chiusa: 'Chiusa', scartata: 'Scartata',
};
const ESITI = {
  iscritta: ['dt-ok', 'iscritta CEIV'],
  non_iscritta: ['dt-scaduto', 'NON iscritta'],
  da_verificare: ['dt-senzadata', 'da verificare'],
};

async function carica() {
  const { data } = await sb.from('s_rlst_pratiche').select('*').order('progressivo', { ascending: false });
  pratiche = data || [];
}

export async function render() {
  const host = $('#rlst-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const visibili = pratiche.filter((p) =>
    filtroStato === 'tutte' ? true :
    filtroStato === 'aperte' ? !['chiusa', 'scartata'].includes(p.stato) :
    p.stato === filtroStato);

  const righe = visibili.map((p) => {
    const [cls, lbl] = ESITI[p.esito_ceiv] || ['', p.esito_ceiv || '—'];
    return `<tr data-id="${p.id}">
      <td>${p.progressivo}</td>
      <td>${p.data_comp ? dataIt(p.data_comp) : p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.ragione_sociale || '?')}</strong></td>
      <td>${esc(p.partita_iva || '—')}</td>
      <td><span class="dt-cella ${cls}" style="padding:2px 8px">${esc(lbl)}</span></td>
      <td>${p.verbale_url || p.data_verbale ? '✓' : '—'}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="rlst-f">
        ${['aperte', 'tutte', 'chiusa'].map((s) =>
          `<button class="seg-btn ${filtroStato === s ? 'is-active' : ''}" data-val="${s}">${s === 'aperte' ? 'Da lavorare' : s === 'tutte' ? 'Tutte' : 'Chiuse'}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="rlst-importa">⟳ Importa adesso dal foglio</button>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>P.IVA</th><th>CEIV</th><th>Verbale</th><th>Stato</th></tr></thead>
        <tbody>${righe || `<tr><td colspan="7" class="empty">Nessuna pratica ${filtroStato === 'aperte' ? 'da lavorare — quando arriva una richiesta nuova la trovi qui, già istruita' : ''}.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      L'import dal foglio gira da solo ogni mattina alle 6:30. Il PDF di riepilogo che arriva
      per mail resta il documento da protocollare: qui ci sono i dati, già controllati.
    </p>`;

  $('#rlst-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroStato = b.dataset.val; render(); }
  });
  $('#rlst-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    toast(data.nuove ? `${data.nuove} richieste nuove importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (data.nuove) render();
  });
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ── dettaglio e istruttoria ──────────────────────────────── */
async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  /* controllo CEIV dal vivo, con la data di aggiornamento della lista */
  let imp = null;
  if (p.partita_iva && /^\d{11}$/.test(p.partita_iva)) {
    const { data } = await sb.from('imprese')
      .select('impresa_id, impresa_nome, cod_ceiv, ce, cassa_edile, stato_cassa, data_agg_access, impresa_email_ref')
      .eq('impresa_id', p.partita_iva).maybeSingle();
    imp = data;
  }
  let per = null;
  if (p.rl_cf) {
    const { data } = await sb.from('persone').select('persona_id, cognome, nome, cf').eq('cf', p.rl_cf).limit(1);
    per = data?.[0] || null;
  }

  const ceivRiga = imp
    ? `<div class="dt-quadro-riga">
         <span class="dt-dot ${imp.cod_ceiv && /attiv/i.test(imp.stato_cassa || '') ? 'dt-ok' : 'dt-scaduto'}"></span>
         <span class="dt-quadro-req">CEIV</span>
         <span class="dt-quadro-stato">${imp.cod_ceiv
             ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.cassa_edile || '')} ${esc(imp.stato_cassa || '')}`
             : 'nessun codice CEIV in anagrafica'}
           ${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}</span>
       </div>`
    : `<div class="dt-quadro-riga"><span class="dt-dot dt-senzadata"></span>
         <span class="dt-quadro-req">CEIV</span>
         <span class="dt-quadro-stato">impresa non in anagrafica: da verificare sul portale CEIV
           (dichiarato nel modulo: ${esc(p.codice_ceiv_dich || '—')})</span></div>`;

  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Richiesta n° ${p.progressivo} — ${p.ragione_sociale || ''}`, '', `
    ${ceivRiga}
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Anagrafica impresa</span>
      <span class="dt-quadro-stato">${imp ? esc(imp.impresa_nome) : 'non censita'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${per ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Legale rappresentante</span>
      <span class="dt-quadro-stato">${per ? esc(`${per.cognome} ${per.nome}`) : esc(`${p.rl_cognome || ''} ${p.rl_nome || ''} — non in anagrafica`)}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.verbale_url || p.data_verbale ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Verbale non elezione RLS</span>
      <span class="dt-quadro-stato">${p.data_verbale ? esc(`del ${p.data_verbale}${p.luogo_riunione ? ' — ' + p.luogo_riunione : ''}`) : 'non pervenuto: lo controllerà l’RLST alla presa in carico'}
        ${p.verbale_url ? ` · <a href="${esc(p.verbale_url)}" target="_blank" rel="noopener">apri</a>` : ''}</span>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Compilato il', p.data_comp ? dataIt(p.data_comp) : p.timestamp_modulo)}
    ${campo('P.IVA', p.partita_iva)}${campo('CF impresa', p.cf_impresa)}
    ${campo('Lavoratori', p.n_lavoratori)}${campo('CCNL', p.ccnl)}
    ${campo('Sede legale', [p.ind_sede_legale, p.comune_legale].filter(Boolean).join(' — '))}
    ${campo('Sede amm.', [p.ind_sede_amm, p.comune_amm].filter(Boolean).join(' — '))}
    ${campo('Telefono', [p.telefono, p.cellulare].filter(Boolean).join(' / '))}
    ${campo('Email', p.email)}
    ${campo('Legale rappr.', [p.rl_titolo, p.rl_nome, p.rl_cognome, p.rl_cf].filter(Boolean).join(' '))}
    ${campo('RSPP', [p.rspp_nome, p.rspp_ruolo].filter(Boolean).join(' — '))}
    ${campo('Note del modulo', p.note_modulo)}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="rl-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Esito CEIV</label>
        <select id="rl-esito">${Object.keys(ESITI).map((k) =>
          `<option value="${k}" ${p.esito_ceiv === k ? 'selected' : ''}>${ESITI[k][1]}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="rl-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      ${!imp && p.partita_iva ? '<button class="btn btn-ghost" id="rl-crea-imp">+ Crea impresa in anagrafica</button>' : ''}
      <button class="btn btn-primary" id="rl-salva">Salva</button>
    </div>
    <p class="hint" style="margin-top:12px">Lettera di risposta e protocollo: in costruzione — per ora si preparano dal registro (Nuovo OUT).</p>
  `);

  $('#rl-crea-imp')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('imprese').insert({
      impresa_id: p.partita_iva,
      impresa_nome: p.ragione_sociale,
      indirizzo: p.ind_sede_legale,
      comune: p.comune_legale,
      impresa_email_ref: p.email,
      impresa_telefono: p.telefono,
      cod_ceiv: p.codice_ceiv_dich,
      note_access: `Creata dalla richiesta RLST n° ${p.progressivo} (${state.email})`,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    await sb.from('s_rlst_pratiche').update({ impresa_id: p.partita_iva, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', p.id);
    toast('Impresa creata in anagrafica (codice CEIV come dichiarato nel modulo: verificalo).', 'ok');
    await render();
    apriPratica(id);
  });

  $('#rl-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_rlst_pratiche').update({
      stato: $('#rl-stato').value,
      esito_ceiv: $('#rl-esito').value,
      note_ufficio: $('#rl-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    render();
  });
}
