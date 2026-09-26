/* ============================================================
   INCARICHI MENSILI E FATTURE DEI TECNICI — scheda MANDATI (26/09/2026)

   Staccata da fatture-tecnici.js così com'era: il mandato di pagamento
   all'Amministrazione (documento interno senza protocollo, PDF + bozza
   .eml col link all'app). La presa visione e i pagamenti stanno in
   amministrazione.js.
   ⚠️ Importa fatture-tecnici.js, che importa questo file: al caricamento
   qui non si chiama niente dell'altro, solo dentro le funzioni.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, esercizioDi } from './core.js';
import { risolviCartella, creaCartella } from './drive.js';
import { scaricaEml } from './eml.js';
import { MESI, euro } from './fatture-tecnici-doc.js';
import { APP_URL } from './config.js';
import { datiMandato, dettaglioMandato } from './amministrazione.js';
import { CARTELLA_FATTURE, conf, b64 } from './fatture-tecnici.js';

/* ══════════ scheda MANDATI ══════════ */

async function renderMandati(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const [{ data: mm }, { data: appr }] = await Promise.all([
    sb.from('s_mandati_pagamento').select('*').order('id', { ascending: false }).limit(60),
    sb.from('s_fatture_tecnici').select('id, tecnico_nome, numero, importo, data_ricevimento, approvata_il').eq('stato', 'approvata').order('tecnico_nome').order('id'),
  ]);
  const approvate = appr || [];
  host.innerHTML = `
    <div class="dt-barra">
      <div><strong>${approvate.length}</strong> fatture approvate in attesa di mandato — totale ${euro(approvate.reduce((s, f) => s + Number(f.importo || 0), 0))}</div>
      <button class="btn btn-primary btn-sm" id="md-nuovo" ${approvate.length ? '' : 'disabled'}>+ Nuovo mandato di pagamento</button>
    </div>
    ${approvate.length ? `<div class="table-wrap" style="margin-bottom:12px"><table class="tbl" style="min-width:0">
      <thead><tr><th></th><th>Tecnico</th><th>Fattura</th><th>Ricevuta</th><th>Approvata</th><th>Importo</th></tr></thead>
      <tbody>${approvate.map((f) => `<tr><td><input type="checkbox" data-f="${f.id}" checked></td><td>${esc(f.tecnico_nome || '')}</td><td><strong>${esc(f.numero || '')}</strong> <span class="hint">n° ${f.id}</span></td>
        <td>${f.data_ricevimento ? dataIt(f.data_ricevimento) : '—'}</td><td>${f.approvata_il ? dataIt(f.approvata_il) : '—'}</td><td><strong>${euro(f.importo)}</strong></td></tr>`).join('')}</tbody></table></div>` : ''}
    <h4 style="margin:6px 0">Mandati emessi</h4>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>N°</th><th>Data</th><th>Totale</th><th>Note</th><th>Documento</th><th>Visto Amministrazione</th><th>Pagato</th></tr></thead>
      <tbody>${(mm || []).map((m) => `<tr data-m="${m.id}" style="cursor:pointer"><td>${m.id}</td><td>${dataIt(m.data)}</td><td><strong>${euro(m.totale)}</strong></td><td class="hint">${esc(m.note || '')}</td>
        <td>${m.drive_url ? `<a href="${esc(m.drive_url)}" target="_blank" rel="noopener">PDF</a>` : '—'}${m.visto_drive_url ? ` · <a href="${esc(m.visto_drive_url)}" target="_blank" rel="noopener">firmato</a>` : ''}${m.mail_at ? ' · 📧' : ''}</td>
        <td>${m.visto_il ? `<span class="dt-cella dt-ok" style="padding:1px 6px">${dataIt(String(m.visto_il).slice(0, 10))}${m.visto_fonte === 'carta' ? ' su carta' : ''}</span>` : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">da vedere</span>'}</td>
        <td>${m.pagato_il ? `<span class="dt-cella dt-ok" style="padding:1px 6px">${dataIt(m.pagato_il)}</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nessun mandato ancora emesso dall\'app.</td></tr>'}</tbody></table></div>
    <p class="hint" style="margin-top:8px">Il mandato è un documento interno: non prende protocollo. Va all'Amministrazione (Patrizia) con la bozza mail e il link all'app,
      dove lei mette la presa visione con la firma e segna i pagamenti; le fatture passano a «in mandato» e il mese a «pagato». Clic su un mandato per il dettaglio.</p>`;
  $('#md-nuovo')?.addEventListener('click', (ev) => {
    const ids = [...host.querySelectorAll('input[data-f]:checked')].map((i) => Number(i.dataset.f));
    if (!ids.length) return toast('Seleziona almeno una fattura.', 'err');
    emettiMandato(approvate.filter((f) => ids.includes(f.id)), ev.currentTarget);
  });
  host.querySelectorAll('tr[data-m]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    dettaglioMandato(Number(tr.dataset.m));
  }));
}

async function emettiMandato(sel, btn) {
  const totale = sel.reduce((s, f) => s + Number(f.importo || 0), 0);
  if (!confirm(`Emetto il mandato per ${sel.length} fatture, totale ${euro(totale)}?`)) return;
  attendi(btn, true, 'Preparo il mandato…');
  try {
    const ids = sel.map((f) => f.id);
    /* gli stessi dati servono alla presa visione, che rigenera il PDF
       col visto: si leggono in un posto solo (amministrazione.js) */
    const { fatture, incIds } = await datiMandato(ids);

    const { data: m, error } = await sb.from('s_mandati_pagamento').insert({ data: oggiIso(), totale, note: `${sel.length} fatture: ${[...new Set(fatture.map((f) => f.tecnico_nome))].join(', ')}`, creato_da: state.email }).select('*').single();
    if (error) throw new Error(error.message);
    /* Il numero del mandato finisce stampato sul PDF e nell'oggetto della
       mail, quindi si prende PRIMA di preparare il documento. Se poi il
       deposito non riesce, la riga si toglie subito: un mandato senza
       documento non e' un mandato, e il numero non va bruciato. */
    let byte, su, nomeFile;
    try {
      const { pdfMandato } = await import('./fatture-tecnici-doc.js');
      byte = await pdfMandato(m, fatture);
      const esercizio = esercizioDi(oggiIso());
      nomeFile = `${oggiIso().replace(/-/g, '_')}_PAG_Formedil-Padova_mandato-pagamento-tecnici-n${m.id}.pdf`;
      const base = await risolviCartella(CARTELLA_FATTURE);
      if (!base.id) throw new Error('Cartella fatture/tecnici non trovata su Drive');
      const sub = await creaCartella(base.id, `ES_20${esercizio.replace('-', '-20')}`);
      const { data: caricato, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
        body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf', base64: b64(byte), parent_id: sub.id || base.id },
      });
      if (errUp || caricato?.error) throw new Error('Deposito su Drive non riuscito: ' + (caricato?.error || errUp.message));
      su = caricato;
      await sb.from('s_mandati_pagamento').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url, mail_at: new Date().toISOString() }).eq('id', m.id);
    } catch (e) {
      await sb.from('s_mandati_pagamento').delete().eq('id', m.id);
      throw e;
    }
    await sb.from('s_fatture_tecnici').update({ stato: 'mandato', mandato_id: m.id, mandato_data: oggiIso(), aggiornato_da: state.email, updated_at: new Date().toISOString() }).in('id', ids);
    if (incIds.length) await sb.from('s_incarichi_mensili').update({ stato: 'pagato', aggiornato_da: state.email, updated_at: new Date().toISOString() }).in('id', incIds);

    /* La mail porta il LINK AL MANDATO nell'app (16/09/2026): è lì che
       l'Amministrazione mette la presa visione con la firma e segna i
       pagamenti, senza stampare e riportare il foglio. Il PDF resta
       allegato per chi lo vuole leggere subito. */
    const link = `${APP_URL}#mandato-${m.id}`;
    const prima = `Buongiorno Patrizia,

in allegato il mandato di pagamento n° ${m.id} per le fatture dei tecnici approvate dal coordinatore:
${fatture.map((f) => `- ${f.tecnico_nome}: fattura n° ${f.numero || '?'}${f.incarico ? ` (${MESI[f.incarico.mese - 1]} ${f.incarico.anno})` : ''} — ${euro(f.importo)}`).join('\n')}

Importo totale: ${euro(totale)}.

Per la presa visione con la firma, e poi per segnare i pagamenti:

>>> Apri il mandato n° ${m.id} (si apre nell'app Segreteria):
${link}`;
    const dopo = `A pagamento registrato, ogni tecnico riceve da solo l'avviso via mail.

Cordiali saluti.`;
    scaricaEml({
      to: conf.amministrazione_email || 'amministrazione@formedilpadova.it',
      cc: [conf.direttore_email].filter(Boolean),
      oggetto: `Mandato di pagamento n° ${m.id} del ${dataIt(m.data)} - fatture tecnici - alla c.a. Bertin Patrizia`,
      corpo: `${prima}\n\n${dopo}`,
      allegati: [{ nome: su.file_name || nomeFile, byte }],
      nomeFile: `mandato-${m.id}.eml`,
    });
    toast(`Mandato n° ${m.id} emesso e depositato: bozza per l'Amministrazione scaricata.`, 'ok');
    await renderMandati();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

export { renderMandati };
