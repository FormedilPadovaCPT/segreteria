/* ============================================================
   AMMINISTRAZIONE — i mandati di pagamento dei tecnici.
   (16/09/2026, chiesto dall'utente: niente giri di carta)

   È la pagina con cui Patrizia Bertin (amministrazione@formedilpadova.it,
   ruolo «amministrazione» in app_ruoli) lavora dentro l'app segreteria.
   La vede anche la segreteria, dal menu.

   Il giro:
   1. la segreteria emette il mandato (scheda «Mandati» di fatture-tecnici)
      e la bozza mail per l'Amministrazione porta il link #mandato-<id>;
   2. l'Amministrazione apre il mandato e preme «Presa visione»: il visto
      si registra nel database (s_mandato_presa_visione, solo lei può) e
      l'app rigenera il PDF del mandato col visto e la firma, depositandolo
      accanto all'originale — è la copia firmata che torna all'ufficio;
   3. segna «Pagato il…» sul mandato intero o su alcune fatture
      (s_fatture_segna_pagate);
   4. al tecnico parte DA SOLO l'avviso di avvenuto pagamento (edge
      function avviso-pagamento). Se non parte, lo dice il cruscotto e si
      ritenta da qui.

   L'Amministrazione vede solo le fatture che stanno in un mandato: le
   fatture in stand-by, e il loro motivo, restano fuori (le policy lo
   impongono, non questa pagina).
   ============================================================ */

import { sb, state, $, esc, dataIt, toast, attendi, apriDrawer, esercizioDi } from './core.js';
import { risolviCartella, creaCartella, leggiByte } from './drive.js';
import { MESI, euro } from './fatture-tecnici-doc.js';

const CARTELLA_FATTURE = '2_AREE/Amministrazione/fatture/tecnici';

const b64 = (byte) => { let s = ''; for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000)); return btoa(s); };
const oraIt = (ts) => ts ? new Date(ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const pill = (classe, testo) => `<span class="dt-cella ${classe}" style="padding:1px 7px">${esc(testo)}</span>`;

let ruoloAmm = null;
async function eAmministrazione() {
  if (ruoloAmm === null) {
    const { data } = await sb.rpc('is_amministrazione');
    ruoloAmm = data === true;
  }
  return ruoloAmm;
}

/* ── i dati del mandato, come li stampa il PDF ────────────────
   Usato all'emissione (fatture-tecnici.js) e alla presa visione: il
   documento col visto è lo stesso mandato, rigenerato. */
export async function datiMandato(ids) {
  const { data: ff, error } = await sb.from('s_fatture_tecnici').select('*').in('id', ids);
  if (error) throw new Error(error.message);
  const incIds = [...new Set((ff || []).map((f) => f.incarico_mensile_id).filter(Boolean))];
  const { data: inc } = incIds.length ? await sb.from('s_incarichi_mensili').select('*').in('id', incIds) : { data: [] };
  const incDi = Object.fromEntries((inc || []).map((i) => [i.id, i]));
  const { data: pp } = await sb.from('s_prestazioni').select('fattura_id, visita_id').in('fattura_id', ids);
  const visitati = {};
  for (const p of pp || []) if (p.visita_id) visitati[p.fattura_id] = (visitati[p.fattura_id] || 0) + 1;
  return {
    fatture: (ff || []).map((f) => ({ ...f, incarico: incDi[f.incarico_mensile_id] || null, cantieri_visitati: visitati[f.id] || f.cantieri_fatturati })),
    incIds,
  };
}

/* ── l'avviso di pagamento al tecnico ─────────────────────────
   Parte da solo dopo il pagamento. Non lancia: dice com'è andata. */
export async function inviaAvvisoPagamento(ids) {
  if (!ids?.length) return null;
  const { data, error } = await sb.functions.invoke('avviso-pagamento', { body: { fatture: ids } });
  if (error || data?.error) {
    toast(`Pagamento registrato, ma l'avviso al tecnico non è partito: ${data?.error || error.message}. Si ritenta dal mandato.`, 'err');
    return null;
  }
  const n = (data.inviati || []).length;
  if (data.errori?.length) {
    toast(`Avviso inviato a ${n} tecnic${n === 1 ? 'o' : 'i'}; non partito per: ${data.errori.map((e) => `${e.tecnico} (${e.errore})`).join('; ')}`, 'err');
  } else if (n) {
    toast(`Avviso di pagamento inviato a ${data.inviati.map((i) => i.tecnico).join(', ')}.`, 'ok');
  }
  return data;
}

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#amministrazione-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const amm = await eAmministrazione();
  const [{ data: mm, error }, { data: ff }] = await Promise.all([
    sb.from('s_mandati_pagamento').select('*').order('id', { ascending: false }).limit(120),
    sb.from('s_fatture_tecnici').select('id, mandato_id, tecnico_nome, stato, importo, avviso_pagamento_il, pagata_il')
      .not('mandato_id', 'is', null).order('id'),
  ]);
  if (error) { host.innerHTML = `<p class="empty">Non riesco a leggere i mandati: ${esc(error.message)}</p>`; return; }
  const perMandato = {};
  for (const f of ff || []) (perMandato[f.mandato_id] = perMandato[f.mandato_id] || []).push(f);

  const daVedere = []; const daPagare = []; const pagati = [];
  for (const m of mm || []) {
    const fatt = perMandato[m.id] || [];
    if (!m.visto_il) daVedere.push(m);
    else if (fatt.some((f) => f.stato === 'mandato')) daPagare.push(m);
    else pagati.push(m);
  }
  const avvisiMancanti = (ff || []).filter((f) => f.stato === 'pagata' && f.pagata_il && !f.avviso_pagamento_il).length;

  const tabella = (righe, vuoto) => `<div class="table-wrap"><table class="tbl" style="min-width:0">
    <thead><tr><th>N°</th><th>Data</th><th>Tecnici</th><th>Fatture</th><th>Totale</th><th>Visto</th><th>Pagato</th></tr></thead>
    <tbody>${righe.map((m) => {
      const fatt = perMandato[m.id] || [];
      const pagate = fatt.filter((f) => f.stato === 'pagata').length;
      return `<tr data-m="${m.id}" style="cursor:pointer">
        <td><strong>${m.id}</strong></td><td>${dataIt(m.data)}</td>
        <td>${esc([...new Set(fatt.map((f) => (f.tecnico_nome || '').split(' ')[0]))].join(', '))}</td>
        <td>${fatt.length}</td><td><strong>${euro(m.totale)}</strong></td>
        <td>${m.visto_il ? pill('dt-ok', dataIt(String(m.visto_il).slice(0, 10))) : pill('dt-senzadata', 'da vedere')}</td>
        <td>${m.pagato_il ? pill('dt-ok', dataIt(m.pagato_il)) : pagate ? pill('dt-senzadata', `${pagate} di ${fatt.length}`) : '—'}</td></tr>`;
    }).join('') || `<tr><td colspan="7" class="empty">${vuoto}</td></tr>`}</tbody></table></div>`;

  host.innerHTML = `
    <p class="hint" style="margin:0 0 10px">${amm
      ? 'I mandati di pagamento delle fatture dei tecnici. Aprite un mandato per la <strong>presa visione</strong> (firma) e, a pagamento fatto, per segnarlo: il tecnico riceve l\'avviso da solo.'
      : 'La pagina dell\'Amministrazione: qui si vede a che punto sono presa visione e pagamenti dei mandati emessi.'}</p>
    ${avvisiMancanti ? `<div class="dt-doc-riga" style="color:#a01f00;margin-bottom:10px"><strong>${avvisiMancanti}</strong> fatture pagate senza avviso al tecnico: aprite il mandato per ritentare.</div>` : ''}
    <h4 style="margin:6px 0">✍️ Da vedere (${daVedere.length})</h4>
    ${tabella(daVedere, 'Nessun mandato in attesa di presa visione.')}
    <h4 style="margin:14px 0 6px">💰 Da pagare (${daPagare.length})</h4>
    ${tabella(daPagare, 'Nessun mandato da pagare.')}
    <h4 style="margin:14px 0 6px">✅ Pagati (${pagati.length})</h4>
    ${tabella(pagati.slice(0, 40), 'Nessun mandato pagato.')}`;
  host.querySelectorAll('tr[data-m]').forEach((tr) => tr.addEventListener('click', () => dettaglioMandato(Number(tr.dataset.m))));
}

/* ══════════ dettaglio ══════════ */

async function apriPdf(driveFileId, btn) {
  attendi(btn, true, 'Apro…');
  try {
    const byte = await leggiByte(driveFileId);
    const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast('PDF non leggibile: ' + e.message, 'err'); } finally { attendi(btn, false); }
}

export async function dettaglioMandato(id) {
  const amm = await eAmministrazione();
  const [{ data: m }, { data: ff }] = await Promise.all([
    sb.from('s_mandati_pagamento').select('*').eq('id', id).maybeSingle(),
    sb.from('s_fatture_tecnici').select('*').eq('mandato_id', id).order('tecnico_nome').order('id'),
  ]);
  if (!m) return toast('Mandato non trovato.', 'err');
  const fatture = ff || [];
  const incIds = [...new Set(fatture.map((f) => f.incarico_mensile_id).filter(Boolean))];
  const { data: ii } = incIds.length ? await sb.from('s_incarichi_mensili').select('id, anno, mese').in('id', incIds) : { data: [] };
  const incDi = Object.fromEntries((ii || []).map((i) => [i.id, i]));
  const daPagare = fatture.filter((f) => f.stato === 'mandato');
  const senzaAvviso = fatture.filter((f) => f.stato === 'pagata' && f.pagata_il && !f.avviso_pagamento_il);
  const possoPagare = m.visto_il || !amm;

  apriDrawer(`Mandato di pagamento n° ${m.id} del ${dataIt(m.data)}`, '', `
    <div class="dt-doc-riga"><strong>Totale:</strong> ${euro(m.totale)} · ${fatture.length} fatture
      ${m.pagato_il ? ` · ${pill('dt-ok', `pagato il ${dataIt(m.pagato_il)}`)}` : ''}</div>
    <div class="dt-doc-riga"><strong>Presa visione:</strong> ${m.visto_il
      ? `${pill('dt-ok', 'vista')} ${esc(m.visto_nome || '')}, ${oraIt(m.visto_il)} <span class="hint">(${esc(m.visto_da || '')})</span>`
      : pill('dt-senzadata', 'da fare')}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">
      ${m.drive_file_id ? '<button class="btn btn-ghost btn-sm" id="mp-pdf">📄 Mandato (PDF)</button>' : ''}
      ${m.visto_drive_file_id ? '<button class="btn btn-ghost btn-sm" id="mp-pdf-visto">📄 Mandato con il visto (PDF)</button>' : ''}
      ${!m.visto_il && amm ? '<button class="btn btn-primary btn-sm" id="mp-visto">✍️ Presa visione e firma</button>' : ''}
      ${m.visto_il && !m.visto_drive_file_id ? '<button class="btn btn-ghost btn-sm" id="mp-rigenera">🔁 Genera il PDF col visto</button>' : ''}
    </div>
    ${!m.visto_il && !amm ? '<p class="hint">La presa visione la registra l\'Amministrazione dal suo accesso: la segreteria non la mette al suo posto.</p>' : ''}

    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th></th><th>Tecnico</th><th>Fattura</th><th>Mese</th><th>Importo</th><th>Stato</th><th>Avviso al tecnico</th></tr></thead>
      <tbody>${fatture.map((f) => {
        const inc = incDi[f.incarico_mensile_id];
        return `<tr>
          <td>${f.stato === 'mandato' ? `<input type="checkbox" data-f="${f.id}" ${possoPagare ? '' : 'disabled'}>` : ''}</td>
          <td>${esc(f.tecnico_nome || '')}</td>
          <td><strong>${esc(f.numero || '?')}</strong>${f.data_fattura ? ` <span class="hint">del ${dataIt(f.data_fattura)}</span>` : ''}</td>
          <td>${inc ? `${MESI[inc.mese - 1]} ${inc.anno}` : '—'}</td>
          <td><strong>${euro(f.importo)}</strong></td>
          <td>${f.stato === 'pagata'
            ? `${pill('dt-ok', f.pagata_il ? `pagata ${dataIt(f.pagata_il)}` : 'pagata')}${f.pagamento_estremi ? `<div class="hint">${esc(f.pagamento_estremi)}</div>` : ''}`
            : f.stato === 'mandato' ? pill('dt-senzadata', 'da pagare') : pill('', f.stato)}</td>
          <td>${f.avviso_pagamento_il
            ? pill('dt-ok', `✓ ${dataIt(String(f.avviso_pagamento_il).slice(0, 10))}`)
            : f.avviso_pagamento_esito ? `<span class="hint" title="${esc(f.avviso_pagamento_esito)}">${esc(f.avviso_pagamento_esito.slice(0, 60))}</span>` : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>

    ${daPagare.length ? `
      <h4 style="margin:14px 0 6px">💰 Registra il pagamento</h4>
      ${possoPagare ? '' : '<p class="hint" style="color:#a01f00">Prima la presa visione del mandato, poi il pagamento.</p>'}
      <div style="display:grid;grid-template-columns:160px 1fr;gap:8px;align-items:end">
        <div class="field"><label>Pagato il</label><input type="date" id="mp-data" value="${oggi()}" max="${oggi()}" ${possoPagare ? '' : 'disabled'}></div>
        <div class="field"><label>Estremi del bonifico (facoltativo, restano in ufficio)</label><input id="mp-estremi" placeholder="es. CRO / data valuta" ${possoPagare ? '' : 'disabled'}></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-primary btn-sm" id="mp-paga-tutto" ${possoPagare ? '' : 'disabled'}>💰 Pagato tutto il mandato (${daPagare.length})</button>
        <button class="btn btn-ghost btn-sm" id="mp-paga-sel" ${possoPagare ? '' : 'disabled'}>💰 Pagate le fatture spuntate</button>
      </div>
      <p class="hint" style="margin-top:6px">A pagamento registrato, ogni tecnico riceve da solo la mail di avvenuto pagamento, con numero, importo e data della sua fattura.</p>` : ''}
    ${senzaAvviso.length ? `<div style="margin-top:10px"><button class="btn btn-ghost btn-sm" id="mp-riavvisa">📧 Invia l'avviso ai tecnici non ancora avvisati (${senzaAvviso.length})</button></div>` : ''}`);

  $('#mp-pdf')?.addEventListener('click', (ev) => apriPdf(m.drive_file_id, ev.currentTarget));
  $('#mp-pdf-visto')?.addEventListener('click', (ev) => apriPdf(m.visto_drive_file_id, ev.currentTarget));

  $('#mp-visto')?.addEventListener('click', async (ev) => {
    if (!confirm(`Confermate la presa visione del mandato n° ${m.id} (${euro(m.totale)})?\nIl visto con la vostra firma resta registrato e torna alla segreteria.`)) return;
    attendi(ev.currentTarget, true, 'Registro il visto…');
    try {
      const { data: v, error } = await sb.rpc('s_mandato_presa_visione', { p_id: m.id });
      if (error) throw new Error(error.message);
      await documentoVisto(v, fatture.map((f) => f.id));
      toast('Presa visione registrata: il mandato firmato è in archivio.', 'ok');
    } catch (e) {
      toast('Presa visione: ' + e.message, 'err');
    } finally {
      attendi(ev.currentTarget, false);
      dettaglioMandato(m.id);
      if (state.vistaCorrente === 'amministrazione') render();
    }
  });

  $('#mp-rigenera')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Genero il PDF…');
    try {
      await documentoVisto(m, fatture.map((f) => f.id));
      toast('PDF col visto depositato.', 'ok');
      dettaglioMandato(m.id);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });

  const paga = async (btn, soloSpuntate) => {
    const ids = soloSpuntate ? [...$('#drawer-body').querySelectorAll('input[data-f]:checked')].map((i) => Number(i.dataset.f)) : null;
    if (soloSpuntate && !ids.length) return toast('Spuntate le fatture pagate.', 'err');
    const data = $('#mp-data').value;
    if (!data) return toast('Serve la data del pagamento.', 'err');
    const quante = soloSpuntate ? ids.length : daPagare.length;
    if (!confirm(`Registro il pagamento di ${quante} fattur${quante === 1 ? 'a' : 'e'} in data ${dataIt(data)}?\nI tecnici ricevono subito l'avviso via mail.`)) return;
    attendi(btn, true, 'Registro…');
    try {
      const { data: pagate, error } = await sb.rpc('s_fatture_segna_pagate', {
        p_mandato_id: m.id, p_fatture: ids, p_data: data, p_estremi: $('#mp-estremi').value.trim() || null,
      });
      if (error) throw new Error(error.message);
      const nuove = (pagate || []).map(Number);
      toast(`${nuove.length} fatture segnate pagate.`, 'ok');
      await inviaAvvisoPagamento(nuove);
    } catch (e) { toast('Pagamento: ' + e.message, 'err'); } finally {
      attendi(btn, false);
      dettaglioMandato(m.id);
      if (state.vistaCorrente === 'amministrazione') render();
    }
  };
  $('#mp-paga-tutto')?.addEventListener('click', (ev) => paga(ev.currentTarget, false));
  $('#mp-paga-sel')?.addEventListener('click', (ev) => paga(ev.currentTarget, true));

  $('#mp-riavvisa')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Invio…');
    try { await inviaAvvisoPagamento(senzaAvviso.map((f) => f.id)); } finally { attendi(ev.currentTarget, false); dettaglioMandato(m.id); }
  });
}

/* Il PDF del mandato col visto: stesso documento, rigenerato con nome,
   data-ora, utente e firma nel riquadro «Per ricevuta Amministrazione»,
   depositato ACCANTO all'originale (che non si tocca). */
async function documentoVisto(m, idsFatture) {
  const [{ fatture }, { data: cfg }] = await Promise.all([
    datiMandato(idsFatture),
    sb.from('s_config').select('chiave, valore').in('chiave', ['amministrazione_firma_id']),
  ]);
  const firmaId = (cfg || []).find((r) => r.chiave === 'amministrazione_firma_id')?.valore;
  let firmaByte = null;
  if (firmaId) { try { firmaByte = await leggiByte(firmaId); } catch { /* senza firma il visto vale lo stesso */ } }
  const { pdfMandato } = await import('./fatture-tecnici-doc.js');
  const byte = await pdfMandato(m, fatture, { nome: m.visto_nome || m.visto_da, data_ora: oraIt(m.visto_il), utente: m.visto_da }, firmaByte);

  const esercizio = esercizioDi(m.data);
  const nome = `${String(m.data).replace(/-/g, '_')}_PAG_Formedil-Padova_mandato-pagamento-tecnici-n${m.id}_visto-amministrazione.pdf`;
  const base = await risolviCartella(CARTELLA_FATTURE);
  if (!base.id) throw new Error('Cartella fatture/tecnici non trovata su Drive');
  const sub = await creaCartella(base.id, `ES_20${esercizio.replace('-', '-20')}`);
  const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
    body: { action: 'upload', filename: nome, mime_type: 'application/pdf', base64: b64(byte), parent_id: sub.id || base.id },
  });
  if (errUp || su?.error) throw new Error('Visto registrato, ma il PDF non è stato depositato: ' + (su?.error || errUp.message) + ' — riprovate con «Genera il PDF col visto».');
  const { error } = await sb.rpc('s_mandato_visto_documento', { p_id: m.id, p_drive_file_id: su.drive_file_id, p_drive_url: su.drive_url });
  if (error) throw new Error(error.message);
}

/* link profondo #mandato-<id> e cruscotto */
export async function apriPratica(id) {
  return dettaglioMandato(Number(id));
}
