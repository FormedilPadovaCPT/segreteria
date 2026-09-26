/* ============================================================
   INCARICHI MENSILI E FATTURE DEI TECNICI — scheda FATTURE (26/09/2026)

   Staccata da fatture-tecnici.js così com'era: registrazione della
   fattura ricevuta (protocollo IN tipo 61), aggancio delle prestazioni,
   il giro verifica → approvazione/stand-by → mandato.

   Lo stato comune (tecnici, filtri, costanti, dettaglio del mese) lo
   tiene fatture-tecnici.js; i filtri si cambiano coi setter
   impostaFiltroTec/impostaAnnoPrest, perché una variabile importata non
   si riassegna. ⚠️ I due file si importano a vicenda: va bene finché qui,
   al caricamento, non si CHIAMA niente dell'altro — solo nelle funzioni.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer,
  codiceProtocollo, esercizioDi } from './core.js';
import { MESI, TIPI_PRESTAZIONE, euro, lordoDi } from './fatture-tecnici-doc.js';
import { inviaAvvisoPagamento, dettaglioMandato } from './amministrazione.js';
/* la ricerca in anagrafica sta in un posto solo: serve per i docenti esterni */
import { collegaRicercaPersone } from './ricerca-anagrafica.js';
import { CARTELLA_FATTURE, TIPO_DOC_FATTURA, STATI_FATT, tecnici, filtroTec, annoPrest, impostaFiltroTec,
  nomeTec, pill, fiscDi, dettaglioIncarico, tabellaPrestazioni, avvisaCoordinatore } from './fatture-tecnici.js';

let filtroFatt = 'aperte';
let fattureCache = [];

/* ══════════ scheda FATTURE ══════════ */

async function renderFatture(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let q = sb.from('s_fatture_tecnici').select('*').order('id', { ascending: false });
  if (filtroFatt === 'aperte') q = q.in('stato', ['attesa', 'ricevuta', 'verificata', 'approvata', 'standby']);
  if (filtroFatt === 'mandato') q = q.eq('stato', 'mandato');
  if (filtroFatt === 'anno') q = q.gte('data_ricevimento', `${annoPrest}-01-01`).lte('data_ricevimento', `${annoPrest}-12-31`);
  if (filtroFatt === 'tutte') q = q.limit(400);
  if (filtroTec === '__esterno') q = q.eq('esterno', true);
  else if (filtroTec) q = q.eq('tecnico_id', filtroTec);
  const { data } = await q;
  fattureCache = data || [];
  const incIds = [...new Set(fattureCache.map((f) => f.incarico_mensile_id).filter(Boolean))];
  const { data: inc } = incIds.length ? await sb.from('s_incarichi_mensili').select('id, anno, mese').in('id', incIds) : { data: [] };
  const incDi = Object.fromEntries((inc || []).map((i) => [i.id, i]));

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="ff-f">
        ${[['aperte', 'In lavorazione'], ['mandato', 'In mandato'], ['anno', `Anno ${annoPrest}`], ['tutte', 'Ultime 400']].map(([v, l]) =>
          `<button class="seg-btn ${filtroFatt === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <select id="ff-tec" class="inp inp-sm"><option value="">Tutti</option><option value="__esterno" ${filtroTec === '__esterno' ? 'selected' : ''}>Soggetti esterni</option>${tecnici.map((t) => `<option value="${t.tecnico_id}" ${filtroTec === t.tecnico_id ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</select>
        <button class="btn btn-primary btn-sm" id="ff-nuova">+ Registra fattura</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Tecnico</th><th>Fattura</th><th>Mese</th><th>Ricevuta</th><th>Importo</th><th>Stato</th><th>Approvata</th></tr></thead>
        <tbody>${fattureCache.map((f) => {
          const i = incDi[f.incarico_mensile_id];
          return `<tr data-id="${f.id}">
            <td>${f.id}</td><td>${esc(f.tecnico_nome || '')}</td>
            <td><strong>${esc(f.numero || '—')}</strong>${f.data_fattura ? ` <span class="hint">${dataIt(f.data_fattura)}</span>` : ''}</td>
            <td>${i ? `${MESI[i.mese - 1].slice(0, 3)} ${i.anno}` : '<span class="hint">—</span>'}</td>
            <td>${f.data_ricevimento ? dataIt(f.data_ricevimento) : '—'}${f.protocollo_in_id ? ' 📥' : ''}</td>
            <td><strong>${euro(f.importo)}</strong></td>
            <td>${pill(STATI_FATT, f.stato)}${f.stato === 'standby' && f.standby_motivo ? ` <span class="hint" title="${esc(f.standby_motivo)}">ⓘ</span>` : ''}</td>
            <td class="hint">${f.approvata_il ? dataIt(f.approvata_il) : ''}${f.mandato_data ? ` · mandato ${dataIt(f.mandato_data)}` : ''}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">Nessuna fattura con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">Giro della fattura: <strong>ricevuta</strong> (segreteria la registra e la protocolla IN) →
      <strong>verificata</strong> (controllo segreteria sui verbali del mese) → <strong>approvata</strong> dal coordinatore, o <strong>stand-by</strong> con motivo
      → <strong>mandato</strong> all'Amministrazione → <strong>pagata</strong>. Il coordinatore approva anche dal gestionale visite.</p>`;

  $('#ff-f').addEventListener('click', (e) => { const b = e.target.closest('[data-val]'); if (b) { filtroFatt = b.dataset.val; renderFatture(); } });
  $('#ff-tec').addEventListener('change', (e) => { impostaFiltroTec(e.target.value); renderFatture(); });
  $('#ff-nuova').addEventListener('click', () => formFattura(null, {}));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => dettaglioFattura(Number(tr.dataset.id))));
}

/* ⚠️ Chi emette la fattura non è sempre un tecnico dell'ente: un docente
   o un relatore ESTERNO manda la sua fattura come tutti, e quella fattura
   deve poter entrare nel mandato all'Amministrazione (chiesto dall'utente
   il 19/09/2026). Per lui non c'è il riepilogo attività da fatturare —
   quello è il documento che l'ente manda al PROPRIO tecnico — e non c'è
   nessun mese di incarico: c'è la riga dell'incarico di docenza che paga. */
async function formFattura(f, prefill = {}) {
  const esterno = f ? (f.esterno || (!f.tecnico_id && !!f.corso_incarico_id)) : !!prefill.esterno;
  const tecId = esterno ? null : (f?.tecnico_id || prefill.tecnico_id || tecnici[0]?.tecnico_id);
  const { data: mesi } = tecId
    ? await sb.from('s_incarichi_mensili').select('id, anno, mese, stato, totale_lordo')
      .eq('tecnico_id', tecId).order('anno', { ascending: false }).order('mese', { ascending: false }).limit(18)
    : { data: [] };
  const incSel = f?.incarico_mensile_id || prefill.incarico_mensile_id || (mesi || []).find((m) => m.stato === 'chiuso')?.id || '';
  const corsoIncId = f?.corso_incarico_id || prefill.corso_incarico_id || null;
  apriDrawer(f ? `Fattura n° ${f.id} — ${esc(f.tecnico_nome)}` : 'Registra fattura ricevuta', 'IN', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Chi emette la fattura *</label>
        <select id="ff-t">
          <optgroup label="Tecnici dell'ente">${tecnici.map((t) => `<option value="${t.tecnico_id}" ${t.tecnico_id === tecId ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</optgroup>
          <option value="__esterno" ${esterno ? 'selected' : ''}>— soggetto esterno (docente, relatore, ospite) —</option>
        </select></div>
      ${esterno ? `<div class="field"><label>Nominativo *</label><input id="ff-nom" value="${esc(f?.tecnico_nome || prefill.nominativo || '')}"></div>
      <div class="field"><label>Cerca in anagrafica</label><input id="ff-cerca" placeholder="cognome, nome o CF…"><div id="ff-risultati"></div></div>
      <div class="field"><label>E-mail (per l'avviso di pagamento)</label><input id="ff-mail" value="${esc(f?.soggetto_email || prefill.soggetto_email || '')}"></div>`
      : `<div class="field"><label>Mese di riferimento (incarico)</label>
        <select id="ff-inc"><option value="">— nessuno / non mensile —</option>${(mesi || []).map((m) => `<option value="${m.id}" ${String(m.id) === String(incSel) ? 'selected' : ''}>${MESI[m.mese - 1]} ${m.anno} — n° ${m.id} (${m.stato}${m.totale_lordo ? `, ${euro(m.totale_lordo)}` : ''})</option>`).join('')}</select></div>`}
      <div class="field"><label>Numero fattura *</label><input id="ff-num" value="${esc(f?.numero || '')}"></div>
      <div class="field"><label>Data fattura</label><input type="date" id="ff-df" value="${f?.data_fattura || ''}"></div>
      <div class="field"><label>Data ricevimento *</label><input type="date" id="ff-dr" value="${f?.data_ricevimento || oggiIso()}"></div>
      <div class="field"><label>Importo totale (oneri e IVA inclusi) *</label><input type="number" step="0.01" id="ff-imp" value="${f?.importo ?? prefill.importo ?? ''}"></div>
      <div class="field"><label>Imponibile (netto)</label><input type="number" step="0.01" id="ff-impon" value="${f?.imponibile ?? ''}"></div>
      ${esterno ? '' : `<div class="field"><label>Cantieri fatturati</label><input type="number" id="ff-cant" value="${f?.cantieri_fatturati ?? ''}"></div>`}
    </div>
    <div class="field" style="margin-top:8px"><label>Note (descrizione in fattura, anomalie)</label><textarea id="ff-note" rows="2">${esc(f?.note || '')}</textarea></div>
    ${f || esterno ? '' : `<label class="field" style="display:flex;gap:8px;align-items:flex-start;margin-top:8px">
      <input type="checkbox" id="ff-auto" checked style="margin-top:3px">
      <span>Aggancia subito <strong>tutte</strong> le prestazioni aperte del mese scelto.<br>
        <span class="hint">Toglila se la fattura ne copre solo una parte, o se copre anche altri mesi:
        le prestazioni si scelgono poi una per una dal dettaglio, con «🔗 Aggancia prestazioni aperte».</span></span></label>`}
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${f ? '<button class="btn btn-ghost" id="ff-annulla">🗑 Annulla la fattura</button>' : ''}</div>
      <button class="btn btn-primary" id="ff-salva">💾 ${f ? 'Salva' : 'Registra la fattura'}</button>
    </div>
    <p class="hint" style="margin-top:8px">La prestazione è il posto unico in cui si segna «con quale fattura è stata pagata»:
      una fattura può pagare prestazioni di più mesi, e un mese può essere pagato da più fatture.
      Poi dal dettaglio: protocollo IN, verifica, approvazione.</p>`);

  $('#ff-t').addEventListener('change', () => formFattura(f, {
    ...prefill,
    esterno: $('#ff-t').value === '__esterno',
    tecnico_id: $('#ff-t').value === '__esterno' ? null : $('#ff-t').value,
    nominativo: $('#ff-nom')?.value || prefill.nominativo,
    soggetto_email: $('#ff-mail')?.value || prefill.soggetto_email,
  }));
  let personaId = f?.persona_id || prefill.persona_id || null;
  if (esterno) {
    collegaRicercaPersone('#ff-cerca', '#ff-risultati', (p) => {
      personaId = p.persona_id;
      $('#ff-nom').value = [p.cognome, p.titolo, p.nome].filter(Boolean).join(' ');
      if (p.email && !$('#ff-mail').value) $('#ff-mail').value = p.email;
      $('#ff-risultati').innerHTML = '<p class="hint">agganciato all&rsquo;anagrafica &#10003;</p>';
    });
  }
  $('#ff-salva').addEventListener('click', async (ev) => {
    const t = esterno ? null : tecnici.find((x) => x.tecnico_id === $('#ff-t').value);
    const d = {
      tecnico_id: t ? t.tecnico_id : null,
      tecnico_nome: t ? nomeTec(t) : $('#ff-nom').value.trim(),
      esterno, persona_id: esterno ? personaId : null,
      soggetto_email: esterno ? ($('#ff-mail').value.trim() || null) : null,
      corso_incarico_id: corsoIncId,
      incarico_mensile_id: $('#ff-inc')?.value ? Number($('#ff-inc').value) : null,
      numero: $('#ff-num').value.trim(), data_fattura: $('#ff-df').value || null, data_ricevimento: $('#ff-dr').value || null,
      importo: Number($('#ff-imp').value || 0), imponibile: $('#ff-impon').value ? Number($('#ff-impon').value) : null,
      cantieri_fatturati: $('#ff-cant')?.value ? Number($('#ff-cant').value) : null,
      note: $('#ff-note').value.trim() || null, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    };
    if (!d.tecnico_nome) return toast('Serve il nominativo di chi emette la fattura.', 'err');
    if (!d.numero || !d.data_ricevimento || !d.importo) return toast('Servono numero, data di ricevimento e importo.', 'err');
    attendi(ev.currentTarget, true);
    try {
      let riga = f;
      if (f) {
        const { data, error } = await sb.from('s_fatture_tecnici').update(d).eq('id', f.id).select('*').single();
        if (error) throw new Error(error.message);
        riga = data;
      } else {
        const { data, error } = await sb.from('s_fatture_tecnici').insert({ ...d, stato: 'ricevuta', creato_da: state.email }).select('*').single();
        if (error) throw new Error(error.message);
        riga = data;
        if (riga.incarico_mensile_id && $('#ff-auto')?.checked) {
          const { data: agg } = await sb.from('s_prestazioni').update({ fattura_id: riga.id })
            .eq('incarico_mensile_id', riga.incarico_mensile_id).is('fattura_id', null).select('id');
          await chiudiSeTuttoFatturato(riga.incarico_mensile_id);
          toast(`Fattura n° ${riga.id} registrata: ${(agg || []).length} prestazioni agganciate.`, 'ok');
        } else toast(`Fattura n° ${riga.id} registrata. Ora aggancia le prestazioni che paga, dal dettaglio.`, 'ok');
      }
      await renderFatture();
      dettaglioFattura(riga.id);
    } catch (e) { toast('Salvataggio non riuscito: ' + e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });
  $('#ff-annulla')?.addEventListener('click', async () => {
    if (!confirm('Annullo la fattura? Le prestazioni collegate tornano aperte.')) return;
    await sb.from('s_prestazioni').update({ fattura_id: null }).eq('fattura_id', f.id);
    await sb.from('s_fatture_tecnici').update({ stato: 'annullata', aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
    toast('Fattura annullata.', 'ok'); chiudiDrawer(); renderFatture();
  });
}

export async function dettaglioFattura(id) {
  const { data: f } = await sb.from('s_fatture_tecnici').select('*').eq('id', id).single();
  if (!f) return toast('Fattura non trovata.', 'err');
  const [{ data: pp }, { data: inc }, { data: prot }] = await Promise.all([
    sb.from('s_prestazioni').select('*').eq('fattura_id', f.id).order('data'),
    f.incarico_mensile_id ? sb.from('s_incarichi_mensili').select('*').eq('id', f.incarico_mensile_id).maybeSingle() : { data: null },
    f.protocollo_in_id ? sb.from('s_protocollo').select('*').eq('id', f.protocollo_in_id).maybeSingle() : { data: null },
  ]);
  const prest = pp || [];
  const netto = prest.reduce((s, p) => s + Number(p.importo || 0), 0);
  const fisc = fiscDi(f.tecnico_id, f.data_fattura || f.data_ricevimento);
  const atteso = lordoDi(netto, fisc);
  const scarto = Math.round((Number(f.importo || 0) - atteso) * 100) / 100;
  const t = tecnici.find((x) => x.tecnico_id === f.tecnico_id);
  /* che cosa paga, quando la fattura viene da un incarico di docenza */
  let incDoc = null;
  if (f.corso_incarico_id) {
    const { data } = await sb.from('s_corsi_incarichi')
      .select('id, corso_id, nominativo, ore, tariffa_oraria, corrispettivo').eq('id', f.corso_incarico_id).maybeSingle();
    incDoc = data || null;
  }

  apriDrawer(`Fattura n° ${f.id} — ${esc(f.numero || '')} — ${esc(f.tecnico_nome || '')}`, 'IN', `
    <div class="dt-quadro-riga"><span class="dt-dot ${(STATI_FATT[f.stato] || [''])[0]}"></span><span class="dt-quadro-req">Stato</span>
      <span class="dt-quadro-stato">${pill(STATI_FATT, f.stato)}${f.verificata_il ? ` · verificata ${dataIt(f.verificata_il)}` : ''}${f.approvata_il ? ` · approvata ${dataIt(f.approvata_il)} (${esc(f.approvata_da || '')})` : ''}${f.mandato_data ? ` · mandato ${dataIt(f.mandato_data)}` : ''}</span></div>
    ${f.stato === 'standby' ? `<div class="dt-doc-riga" style="color:#a01f00"><strong>Stand-by:</strong> ${esc(f.standby_motivo || '')} — ${esc(f.standby_da || '')}${f.standby_il ? ` il ${dataIt(String(f.standby_il).slice(0, 10))}` : ''}. Il mandato non parte finché non si risolve (regola del controllo verbali).</div>` : ''}
    ${['ricevuta', 'verificata', 'standby'].includes(f.stato) || f.avviso_appr_il ? `<div class="dt-doc-riga"><strong>Avviso al coordinatore:</strong> ${f.avviso_appr_il
      ? `<span class="dt-cella dt-ok" style="padding:0 6px">inviato ${dataIt(String(f.avviso_appr_il).slice(0, 10))}</span> <span class="hint">a ${esc(f.avviso_appr_a || '')}</span>`
      : f.avviso_appr_esito
        ? `<span class="dt-cella dt-scaduto" style="padding:0 6px">non partito</span> <span class="hint">${esc(f.avviso_appr_esito)}</span>`
        : '<span class="dt-cella dt-senzadata" style="padding:0 6px">non ancora</span> <span class="hint">parte da solo quando la segreteria la verifica</span>'}</div>` : ''}
    <div class="dt-doc-riga"><strong>Fattura:</strong> n° ${esc(f.numero || '—')}${f.data_fattura ? ` del ${dataIt(f.data_fattura)}` : ''} · ricevuta ${f.data_ricevimento ? dataIt(f.data_ricevimento) : '—'} · <strong>${euro(f.importo)}</strong>${f.imponibile != null ? ` (imponibile ${euro(f.imponibile)})` : ''}${f.cantieri_fatturati != null ? ` · ${f.cantieri_fatturati} cantieri` : ''}</div>
    <div class="dt-doc-riga"><strong>Mese:</strong> ${inc ? `<span data-inc="${inc.id}" style="cursor:pointer;text-decoration:underline">${MESI[inc.mese - 1]} ${inc.anno} — incarico n° ${inc.id}</span>` : '—'}
      · <strong>Protocollo IN:</strong> ${prot ? esc(codiceProtocollo(prot)) : '<span class="hint">non protocollata</span>'}</div>
    ${f.esterno || (!f.tecnico_id && f.corso_incarico_id) ? `<div class="dt-doc-riga"><strong>Soggetto esterno</strong> (non è un tecnico dell'ente): niente riepilogo attività da fatturare, ma la fattura entra nel mandato come le altre.${f.soggetto_email ? ` Avviso di pagamento a ${esc(f.soggetto_email)}.` : ' <span class="hint">Senza indirizzo e-mail l&rsquo;avviso di pagamento non parte.</span>'}</div>` : ''}
    ${f.corso_incarico_id ? `<div class="dt-doc-riga"><strong>Paga l'incarico di docenza</strong> n° ${f.corso_incarico_id}${incDoc ? ` — ${esc(incDoc.nominativo)}, corso n° ${incDoc.corso_id}${incDoc.corrispettivo != null ? `, corrispettivo ${euro(incDoc.corrispettivo)}` : ''}` : ''}</div>` : ''}
    ${f.note ? `<div class="dt-doc-riga"><strong>Note:</strong> ${esc(f.note)}</div>` : ''}
    <div class="dt-doc-riga"><strong>Controllo:</strong> ${prest.length} prestazioni collegate, netto ${euro(netto)} → atteso ${euro(atteso)}
      ${fisc ? `<span class="hint">(cassa ${fisc.cassa_pct}%${fisc.iva_pct ? ` + IVA ${fisc.iva_pct}%` : ', senza IVA'})</span>` : '<span class="hint">(regime non impostato: 4% + 22%)</span>'}
      ${prest.length ? (Math.abs(scarto) < 0.02 ? '<span class="dt-cella dt-ok" style="padding:0 6px">torna</span>' : `<span class="dt-cella dt-senzadata" style="padding:0 6px">scarto ${euro(scarto)}</span>`) : ''}</div>
    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    ${tabellaPrestazioni(prest, [f])}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
      ${!f.protocollo_in_id && f.stato !== 'annullata' ? '<button class="btn btn-primary btn-sm" id="df-prot">📥 Protocolla IN (maschera precompilata)</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="df-aggancia">🔗 Aggancia prestazioni aperte</button>
      ${['ricevuta', 'attesa'].includes(f.stato) ? '<button class="btn btn-ghost btn-sm" id="df-verif">✔ Verificata (segreteria)</button>' : ''}
      ${['ricevuta', 'verificata', 'standby'].includes(f.stato) ? '<button class="btn btn-primary btn-sm" id="df-appr">✅ Approva (coordinatore)</button>' : ''}
      ${['ricevuta', 'verificata', 'approvata'].includes(f.stato) ? '<button class="btn btn-ghost btn-sm" id="df-standby">⏸ Stand-by</button>' : ''}
      ${['ricevuta', 'verificata', 'standby'].includes(f.stato) ? `<button class="btn btn-ghost btn-sm" id="df-avvisa">✉️ ${f.avviso_appr_il ? 'Avvisa di nuovo il coordinatore' : 'Avvisa il coordinatore'}</button>` : ''}
      ${f.stato === 'mandato' ? '<button class="btn btn-ghost btn-sm" id="df-pagata">💰 Segna pagata</button>' : ''}
      ${f.mandato_id ? `<button class="btn btn-ghost btn-sm" id="df-mandato">🏦 Mandato n° ${f.mandato_id}</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="df-mod">✏️ Modifica</button>
    </div>
    ${f.pagata_il ? `<div class="dt-doc-riga"><strong>Pagata il</strong> ${dataIt(f.pagata_il)}${f.pagamento_estremi ? ` · ${esc(f.pagamento_estremi)}` : ''} · <strong>avviso al tecnico:</strong> ${f.avviso_pagamento_il ? `inviato il ${dataIt(String(f.avviso_pagamento_il).slice(0, 10))}` : esc(f.avviso_pagamento_esito || 'non ancora')}</div>` : ''}
    <p class="hint" style="margin-top:8px">Il mandato si prepara dalla scheda «Mandati» con le fatture approvate. Lo firma l'Amministrazione con la presa visione nell'app; il pagamento lo segna lei, o la segreteria da qui, e il tecnico riceve l'avviso da solo.</p>`);

  $('#drawer-body').querySelector('[data-inc]')?.addEventListener('click', () => dettaglioIncarico(inc, t));
  $('#df-prot')?.addEventListener('click', () => protocollaFattura(f, inc, t));
  /* il netto gia' collegato entra nel conto della maschera: cosi' lo
     scarto che si vede mentre si spunta e' quello vero della fattura */
  $('#df-aggancia')?.addEventListener('click', () => agganciaPrestazioni({ ...f, __nettoGia: netto }));
  $('#df-verif')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Verifico…');
    try {
      await sb.from('s_fatture_tecnici').update({ stato: 'verificata', verificata_da: state.email, verificata_il: oggiIso(), aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
      /* e il coordinatore lo viene a sapere subito: la mail parte da sola
         (21/09/2026). Se non parte non si annulla la verifica — la fattura
         È verificata: resta scritto il motivo e si ritenta da qui o dal
         cruscotto. */
      const esito = await avvisaCoordinatore([f.id]);
      toast(esito.inviata ? `Fattura verificata: avviso al coordinatore inviato a ${esito.a}.`
        : `Fattura verificata. ⚠️ Avviso al coordinatore NON partito: ${esito.errore || 'motivo non riportato'}`,
      esito.inviata ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
    await renderFatture(); dettaglioFattura(f.id);
  });
  $('#df-avvisa')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Avviso…');
    try {
      const esito = await avvisaCoordinatore([f.id], { rimanda: true });
      toast(esito.inviata ? `Avviso inviato a ${esito.a}.` : `Non inviato: ${esito.errore || 'nessuna fattura da avvisare'}`,
        esito.inviata ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
    dettaglioFattura(f.id);
  });
  $('#df-appr')?.addEventListener('click', async () => {
    if (!confirm('Approvi la fattura per il pagamento (tutte le attività del mese sono a posto)?')) return;
    const { error } = await sb.rpc('s_fattura_decisione', { p_id: f.id, p_esito: 'approvata', p_motivo: null });
    if (error) return toast(error.message, 'err');
    if (inc) await sb.from('s_incarichi_mensili').update({ stato: 'fatturato' }).eq('id', inc.id);
    toast('Fattura approvata.', 'ok'); await renderFatture(); dettaglioFattura(f.id);
  });
  $('#df-standby')?.addEventListener('click', async () => {
    const motivo = prompt('Motivo dello stand-by (anomalia da risolvere col tecnico):');
    if (motivo == null) return;
    const { error } = await sb.rpc('s_fattura_decisione', { p_id: f.id, p_esito: 'standby', p_motivo: motivo || null });
    if (error) return toast(error.message, 'err');
    toast('Fattura in stand-by: il mandato non parte.', 'ok'); await renderFatture(); dettaglioFattura(f.id);
  });
  $('#df-pagata')?.addEventListener('click', async (ev) => {
    const risposta = prompt("Data del pagamento (gg/mm/aaaa). Il tecnico riceve subito l'avviso via mail.", dataIt(oggiIso()));
    if (risposta == null) return;
    const m = risposta.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    const data = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
    if (!data || data > oggiIso()) return toast('Data non valida (e non può essere nel futuro).', 'err');
    const btn = ev.currentTarget;
    attendi(btn, true, 'Registro…');
    try {
      if (f.mandato_id) {
        const { data: pagate, error } = await sb.rpc('s_fatture_segna_pagate', { p_mandato_id: f.mandato_id, p_fatture: [f.id], p_data: data, p_estremi: null });
        if (error) throw new Error(error.message);
        if ((pagate || []).length) await inviaAvvisoPagamento((pagate || []).map(Number));
      } else {
        /* fatture dello storico Access in mandato senza numero di mandato
           dell'app: si chiudono come prima, con la data, senza avviso */
        const { error } = await sb.from('s_fatture_tecnici').update({ stato: 'pagata', pagata_il: data, pagata_da: state.email,
          avviso_pagamento_esito: "non inviato: mandato fuori dall'app (storico Access)", aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
        if (error) throw new Error(error.message);
      }
      if (inc) await sb.from('s_incarichi_mensili').update({ stato: 'pagato' }).eq('id', inc.id);
      toast('Fattura segnata pagata.', 'ok');
    } catch (e) { toast(e.message, 'err'); } finally {
      attendi(btn, false);
      await renderFatture(); dettaglioFattura(f.id);
    }
  });
  $('#df-mandato')?.addEventListener('click', () => dettaglioMandato(f.mandato_id));
  $('#df-mod')?.addEventListener('click', () => formFattura(f));
}

async function protocollaFattura(f, inc, t) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  const esercizio = esercizioDi(f.data_ricevimento || oggiIso());
  mod.apriForm('IN', {
    data_prot: oggiIso(), data_doc: f.data_fattura || f.data_ricevimento || null,
    persona: f.tecnico_nome || nomeTec(t), impresa_nome: f.tecnico_nome || nomeTec(t),
    oggetto: `Fattura n° ${f.numero || '?'}${f.data_fattura ? ` del ${dataIt(f.data_fattura)}` : ''} — ${f.tecnico_nome || ''}${inc ? ` — attività ${MESI[inc.mese - 1]} ${inc.anno}` : ''}`,
    note: f.note || null,
    sintesi: `Fattura del tecnico n° ${f.id} in app segreteria: ${euro(f.importo)}${inc ? `, incarico mensile n° ${inc.id}` : ''}. Da verificare e approvare prima del mandato.`,
    tipo_doc_id: TIPO_DOC_FATTURA, mezzo: 'e-mail',
    cartella: `${CARTELLA_FATTURE}/ES_20${esercizio.replace('-', '-20')}`,
  }, true, async (nuovo) => {
    const { error } = await sb.from('s_fatture_tecnici').update({ protocollo_in_id: nuovo.id, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla fattura n° ${f.id}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il PDF della fattura e salva — il numero si collega da solo.', 'ok');
}

/* Un mese si dichiara «fatturato» solo quando NON resta piu' niente
   di aperto: una fattura puo' pagarne solo una parte (e' successo
   davvero, nello storico Access — la 799 di De Marco copriva anche
   agosto), e marcarlo fatturato a meta' farebbe sparire dal quadro
   le prestazioni ancora da pagare. */
async function chiudiSeTuttoFatturato(incaricoId) {
  if (!incaricoId) return false;
  const { count, error } = await sb.from('s_prestazioni')
    .select('id', { count: 'exact', head: true })
    .eq('incarico_mensile_id', incaricoId).is('fattura_id', null);
  /* conteggio non letto: non si sa se resta qualcosa di aperto, quindi
     il mese NON si segna fatturato (count sarebbe null = «niente») */
  if (error) {
    toast('Non sono riuscito a controllare se il mese è tutto fatturato: lasciato aperto.', 'err');
    return false;
  }
  if (count) return false;
  await sb.from('s_incarichi_mensili')
    .update({ stato: 'fatturato', aggiornato_da: state.email, updated_at: new Date().toISOString() })
    .eq('id', incaricoId);
  return true;
}

async function agganciaPrestazioni(f) {
  const { data: aperte, error: errAp } = await sb.from('s_prestazioni').select('*').eq('tecnico_id', f.tecnico_id)
    .is('fattura_id', null).is('chiusa_il', null).order('data', { ascending: false }).limit(300);
  /* lettura fallita ≠ «nessuna prestazione aperta» (26/09/2026) */
  if (errAp) return toast('Non sono riuscito a leggere le prestazioni aperte del tecnico. Riprova.', 'err');
  const righe = aperte || [];
  apriDrawer(`Aggancia prestazioni — fattura n° ${f.id} (${esc(f.numero || '')})`, 'IN', `
    <p class="hint" style="margin:0 0 8px">Prestazioni di ${esc(f.tecnico_nome || '')} ancora senza fattura, <strong>di qualunque mese</strong>.
      Spunta quelle pagate da questa fattura: una fattura puo' coprire piu' mesi, o solo una parte di un mese.</p>
    <div class="dt-doc-riga" id="ap-conto" style="margin-bottom:8px"></div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th></th><th>Data</th><th>Tipo</th><th>Descrizione</th><th>Netto</th><th>Mese</th></tr></thead>
      <tbody>${righe.map((p) => `<tr><td><input type="checkbox" data-p="${p.id}" ${p.incarico_mensile_id && p.incarico_mensile_id === f.incarico_mensile_id ? 'checked' : ''}></td>
        <td>${dataIt(p.data)}</td><td>${esc(TIPI_PRESTAZIONE[p.tipo] || p.tipo)}</td><td>${esc((p.descrizione || '').slice(0, 60))}</td>
        <td><strong>${euro(p.importo)}</strong></td><td class="hint">${p.incarico_mensile_id ? `n° ${p.incarico_mensile_id}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessuna prestazione aperta per questo tecnico.</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary" id="ap-ok" style="margin-top:10px">🔗 Aggancia le selezionate</button>`);
  /* mentre si spunta, il conto: netto selezionato -> lordo atteso,
     confrontato con l'importo della fattura. E' il modo di accorgersi
     che ne manca qualcuna, o che se ne sono spuntate troppe. */
  const fiscF = fiscDi(f.tecnico_id, f.data_fattura || f.data_ricevimento);
  const gia = Number(f.__nettoGia || 0);
  const conta = () => {
    const scelti = [...$('#drawer-body').querySelectorAll('input[data-p]:checked')]
      .map((i) => righe.find((p) => p.id === Number(i.dataset.p))).filter(Boolean);
    const netto = gia + scelti.reduce((s, p) => s + Number(p.importo || 0), 0);
    const atteso = lordoDi(netto, fiscF);
    const scarto = Math.round((Number(f.importo || 0) - atteso) * 100) / 100;
    const box = $('#ap-conto');
    if (box) {
      box.innerHTML = `<strong>${scelti.length} selezionate</strong> — con le gia' collegate: netto ${euro(netto)}
        → atteso ${euro(atteso)} · fattura ${euro(f.importo)}
        ${Math.abs(scarto) < 0.02
          ? '<span class="dt-cella dt-ok" style="padding:0 6px">torna</span>'
          : `<span class="dt-cella dt-senzadata" style="padding:0 6px">${scarto > 0 ? 'mancano' : 'in più'} ${euro(Math.abs(scarto))}</span>`}`;
    }
  };
  $('#drawer-body').addEventListener('change', (e) => { if (e.target.matches('input[data-p]')) conta(); });
  conta();

  $('#ap-ok').addEventListener('click', async (ev) => {
    const ids = [...$('#drawer-body').querySelectorAll('input[data-p]:checked')].map((i) => Number(i.dataset.p));
    if (!ids.length) return toast('Niente selezionato.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_prestazioni').update({ fattura_id: f.id }).in('id', ids);
    if (!error) {
      /* i mesi toccati si chiudono solo se non resta niente di aperto */
      const mesi = [...new Set(righe.filter((p) => ids.includes(p.id))
        .map((p) => p.incarico_mensile_id).filter(Boolean))];
      for (const m of mesi) await chiudiSeTuttoFatturato(m);
    }
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast(`${ids.length} prestazioni agganciate alla fattura n° ${f.id}.`, 'ok');
    dettaglioFattura(f.id);
  });
}

export { renderFatture, formFattura };
