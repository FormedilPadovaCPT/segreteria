/* ============================================================
   INCARICHI MENSILI E FATTURE DEI TECNICI.
   Sostituisce le tabelle Access «Comunicazione Visite in cantiere»
   e «T_ComunicVisiteFatt» e i quattro «pezzettini» da ricordare a
   mano quando arriva una fattura (Ks_Fatt copiato su visite,
   richieste, lettere di incarico e t_ASS).

   Il perno è la tabella s_prestazioni: OGNI cosa che il tecnico fa e
   che l'ente gli paga (visita, docenza, servizio, asseverazione) è
   una riga, con il mese di incarico e — quando arriva — la fattura
   che l'ha pagata. La domanda «con quale fattura è stata pagata
   questa visita?» ha una sola risposta, in un posto solo.

   Quattro schede:
   - MESE: per ogni tecnico il mese in corso — lettera di incarico
     (protocollo OUT tipo 62, deposito in Sopralluoghi/incarichi_visite,
     bozza .eml) e CHIUSURA del mese: la funzione s_prestazioni_calcola
     propone le prestazioni dal gestionale (visite), dai corsi
     (docenze), dai servizi (incarichi con corrispettivo) e dalle
     pratiche di asseverazione; la segreteria controlla, congela, e
     parte il RIEPILOGO ATTIVITÀ DA FATTURARE (protocollo OUT tipo 63,
     deposito in Amministrazione/fatture/tecnici/ES_aaaa-aaaa, .eml al
     tecnico con cc Amministrazione). L'invio resta a una persona.
   - FATTURE: registrazione della fattura ricevuta (protocollo IN
     tipo 61 dalla maschera precompilata), aggancio automatico delle
     prestazioni del mese, poi il giro: verifica segreteria →
     approvazione del coordinatore (o stand-by, con motivo) → mandato.
   - MANDATI: il mandato di pagamento all'Amministrazione (Patrizia):
     documento interno senza protocollo, PDF + bozza .eml.
   - PRESTAZIONI: la situazione storica, per tecnico e anno: cosa è
     stato pagato con quale fattura e cosa è ancora aperto. Anche
     inserimento manuale (regola delle maschere).

   Storico Access importato il 04/09/2026: 904 incarichi mensili
   (2011-2026, numerazione che prosegue da 929), 860 fatture, 1.349
   visite dal 01/04/2025 con la loro fattura.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer,
  codiceProtocollo, esercizioDi } from './core.js';
import { risolviCartella, creaCartella, caricaByte } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { MESI, TIPI_PRESTAZIONE, euro, lordoDi } from './fatture-tecnici-doc.js';

const CARTELLA_INCARICHI = '2_AREE/Sopralluoghi/incarichi_visite';
const CARTELLA_FATTURE = '2_AREE/Amministrazione/fatture/tecnici';
const TIPO_DOC_FATTURA = 61;
const TIPO_DOC_LETTERA = 62;
const TIPO_DOC_RIEPILOGO = 63;

const STATI_FATT = {
  attesa: ['dt-senzadata', 'in attesa'],
  ricevuta: ['dt-senzadata', 'RICEVUTA'],
  verificata: ['dt-senzadata', 'verificata'],
  approvata: ['dt-ok', 'APPROVATA'],
  standby: ['dt-scaduto', 'STAND-BY'],
  mandato: ['dt-ok', 'in mandato'],
  pagata: ['dt-ok', 'pagata'],
  annullata: ['dt-scaduto', 'annullata'],
  non_registrata: ['', 'non registrata'],
};
const STATI_INC = {
  aperto: ['dt-senzadata', 'aperto'],
  chiuso: ['dt-ok', 'chiuso'],
  fatturato: ['dt-ok', 'fatturato'],
  pagato: ['dt-ok', 'pagato'],
  annullato: ['dt-scaduto', 'annullato'],
};

let tab = 'mese';
let cursore = oggiIso().slice(0, 7);
let tecnici = [];
let conf = {};
let fiscale = [];
let filtroFatt = 'aperte';
let filtroTec = '';
let annoPrest = new Date().getFullYear();
let filtroPrest = 'aperte';
let incarichiMese = [];
let fattureCache = [];

const nomeTec = (t) => t ? [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' ') : '';
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileTec = (t) => slug(`${t.tecnico_cognome}-${t.tecnico_nome}`);
const pill = (mappa, stato) => { const [c, l] = mappa[stato] || ['', stato || '—']; return `<span class="dt-cella ${c}" style="padding:1px 7px">${esc(l)}</span>`; };
const b64 = (byte) => { let s = ''; for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode(...byte.subarray(i, i + 0x8000)); return btoa(s); };
const scaricaPdf = (byte, nome) => {
  const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};
const fiscDi = (tecId, data) => {
  const d = data || oggiIso();
  return fiscale.filter((f) => f.tecnico_id === tecId && (!f.valido_dal || f.valido_dal <= d) && (!f.valido_al || f.valido_al >= d))
    .sort((a, b) => String(b.valido_dal || '').localeCompare(String(a.valido_dal || '')))[0] || null;
};
const meseRange = (anno, mese) => ({
  da: `${anno}-${String(mese).padStart(2, '0')}-01`,
  a: `${anno}-${String(mese).padStart(2, '0')}-${String(new Date(anno, mese, 0).getDate()).padStart(2, '0')}`,
});

async function caricaBase() {
  const [{ data: tt }, { data: cfg }, { data: ff }] = await Promise.all([
    sb.from('tecnici').select('tecnico_id, tecnico_cognome, tecnico_nome, titolo, email, attivo, tariffa_docenza')
      .eq('attivo', true).or('elimina.is.null,elimina.neq.1').order('tecnico_cognome'),
    sb.from('s_config').select('chiave, valore').in('chiave', ['coordinatore_email', 'coordinatore_nome', 'amministrazione_email',
      'direttore_email', 'incarico_visite_testo', 'rlst_minimo_pct']),
    sb.from('s_tecnici_fiscale').select('*'),
  ]);
  /* i tecnici veri: fuori le caselle di servizio e l'account di prova */
  tecnici = (tt || []).filter((t) => !/^(cpt|prova)/i.test(t.email || ''));
  conf = Object.fromEntries((cfg || []).map((r) => [r.chiave, r.valore]));
  fiscale = ff || [];
}

/* ══════════ ingresso ══════════ */

export async function render() {
  const host = $('#fatture-tecnici-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await caricaBase();
  host.innerHTML = `
    <div class="dt-barra" style="margin-bottom:10px">
      <div class="seg" id="ft-tab">
        ${[['mese', '📅 Mese e incarichi'], ['fatture', '🧾 Fatture'], ['mandati', '🏦 Mandati'], ['prestazioni', '📒 Prestazioni e storico']].map(([v, l]) =>
          `<button class="seg-btn ${tab === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div id="ft-corpo"></div>`;
  $('#ft-tab').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { tab = b.dataset.val; render(); }
  });
  const corpo = $('#ft-corpo');
  if (tab === 'mese') return renderMese(corpo);
  if (tab === 'fatture') return renderFatture(corpo);
  if (tab === 'mandati') return renderMandati(corpo);
  return renderPrestazioni(corpo);
}

/* ══════════ scheda MESE ══════════ */

async function renderMese(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const [anno, mese] = cursore.split('-').map(Number);
  const { da, a } = meseRange(anno, mese);
  const [{ data: inc }, { data: vs }, { data: ff }] = await Promise.all([
    sb.from('s_incarichi_mensili').select('*').eq('anno', anno).eq('mese', mese).order('tecnico_nome'),
    sb.from('visite').select('tecnico_id, rlst_sn').gte('data_visita', da).lte('data_visita', a).or('elimina.is.null,elimina.neq.1'),
    sb.from('s_fatture_tecnici').select('id, incarico_mensile_id, numero, stato, importo').not('incarico_mensile_id', 'is', null),
  ]);
  incarichiMese = inc || [];
  const visite = {};
  for (const v of vs || []) {
    const r = (visite[v.tecnico_id] = visite[v.tecnico_id] || { n: 0, rlst: 0 });
    r.n += 1; if (v.rlst_sn) r.rlst += 1;
  }
  const fattDi = {};
  for (const f of ff || []) (fattDi[f.incarico_mensile_id] = fattDi[f.incarico_mensile_id] || []).push(f);

  const prec = new Date(anno, mese - 2, 1); const succ = new Date(anno, mese, 1);
  const isoM = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const righe = tecnici.map((t) => {
    const i = incarichiMese.find((x) => x.tecnico_id === t.tecnico_id);
    const v = visite[t.tecnico_id] || { n: 0, rlst: 0 };
    const fatt = i ? (fattDi[i.id] || []) : [];
    const pct = v.n ? Math.round((v.rlst / v.n) * 100) : 0;
    return `<tr data-tec="${t.tecnico_id}">
      <td><strong>${esc(nomeTec(t))}</strong>${i?.area_zona ? ` <span class="hint">area ${esc(String(i.area_zona))}</span>` : ''}</td>
      <td>${i ? `n° ${i.id} · ${dataIt(i.data_lettera)}${i.lettera_protocollo_id ? ' · 📤' : ''}` : '<span class="hint">—</span>'}</td>
      <td>${i ? `${i.cantieri_assegnati ?? 0}${i.seconde_visite ? ` +${i.seconde_visite} 2ª` : ''}${i.altro ? ` +${i.altro} altro` : ''}` : '—'}</td>
      <td><strong>${v.n}</strong> <span class="hint">RLST ${pct}%</span></td>
      <td>${i ? pill(STATI_INC, i.stato) : '<span class="hint">senza incarico</span>'}${i?.totale_lordo ? ` <span class="hint">${euro(i.totale_lordo)}</span>` : ''}</td>
      <td>${fatt.length ? fatt.map((f) => `${esc(f.numero || '?')} ${pill(STATI_FATT, f.stato)}`).join('<br>') : '<span class="hint">—</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-az="lettera" title="Lettera di incarico del mese">✉️</button>
        <button class="btn btn-primary btn-sm" data-az="chiudi" title="Chiudi il mese: calcolo prestazioni e riepilogo da fatturare">📋 Chiudi</button>
      </td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="ft-prec">‹</button>
        <strong style="min-width:150px;text-align:center">${MESI[mese - 1]} ${anno}</strong>
        <button class="btn btn-ghost btn-sm" id="ft-succ">›</button>
      </div>
      <div class="hint">Lettera = protocollo OUT + deposito in Sopralluoghi/incarichi_visite + bozza mail · Chiudi = prestazioni congelate + riepilogo da fatturare (OUT) al tecnico, cc Amministrazione</div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Tecnico</th><th>Incarico del mese</th><th>Assegnati</th><th>Visite fatte</th><th>Stato mese</th><th>Fattura</th><th></th></tr></thead>
        <tbody>${righe || '<tr><td colspan="7" class="empty">Nessun tecnico attivo.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">Il numero dell'incarico prosegue la serie Access (929 in poi). Il massimo visite del mese
      nel gestionale (card «obiettivo del mese» del tecnico) si aggiorna da solo dai cantieri assegnati.</p>`;

  $('#ft-prec').addEventListener('click', () => { cursore = isoM(prec); renderMese(); });
  $('#ft-succ').addEventListener('click', () => { cursore = isoM(succ); renderMese(); });
  host.querySelectorAll('tbody tr[data-tec]').forEach((tr) => {
    const t = tecnici.find((x) => x.tecnico_id === tr.dataset.tec);
    const i = incarichiMese.find((x) => x.tecnico_id === t.tecnico_id) || null;
    tr.querySelector('[data-az="lettera"]').addEventListener('click', (e) => { e.stopPropagation(); formIncarico(t, i); });
    tr.querySelector('[data-az="chiudi"]').addEventListener('click', (e) => { e.stopPropagation(); chiudiMese(t, i); });
    tr.addEventListener('click', () => i ? dettaglioIncarico(i, t) : formIncarico(t, null));
  });
}

async function comuniDi(t) {
  const { data } = await sb.from('tecnici_zone').select('comune_nome').ilike('email', t.email || '—').order('comune_nome');
  return (data || []).map((r) => r.comune_nome);
}

function formIncarico(t, i) {
  const [anno, mese] = cursore.split('-').map(Number);
  apriDrawer(i ? `Incarico n° ${i.id} — ${nomeTec(t)} — ${MESI[mese - 1]} ${anno}` : `Nuovo incarico — ${nomeTec(t)} — ${MESI[mese - 1]} ${anno}`, 'OUT', `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="field"><label>Data lettera *</label><input type="date" id="fi-data" value="${i?.data_lettera || oggiIso()}"></div>
      <div class="field"><label>Area / zona</label><input id="fi-area" value="${esc(i?.area_zona ?? '')}" placeholder="es. 53"></div>
      <div class="field"><label>Cantieri assegnati *</label><input type="number" id="fi-cant" min="0" value="${i?.cantieri_assegnati ?? 30}"></div>
      <div class="field"><label>Seconde visite</label><input type="number" id="fi-sec" min="0" value="${i?.seconde_visite ?? 0}"></div>
      <div class="field"><label>Altro (stage, segnalazioni…)</label><input type="number" id="fi-altro" min="0" value="${i?.altro ?? 0}"></div>
      <div class="field"><label>Stato</label>
        <select id="fi-stato">${Object.entries(STATI_INC).map(([v, [, l]]) => `<option value="${v}" ${(i?.stato || 'aperto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Comuni di competenza (uno per riga o separati da virgola — proposti dalle zone del gestionale)</label>
      <textarea id="fi-comuni" rows="3">${esc(Array.isArray(i?.comuni) ? i.comuni.join(', ') : (i?.comuni || ''))}</textarea></div>
    <div class="field" style="margin-top:6px"><label>Note per il tecnico (vanno in lettera)</label><textarea id="fi-note" rows="2">${esc(i?.note || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary" id="fi-salva">💾 Salva</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="fi-pdf" ${i ? '' : 'disabled'}>📄 Anteprima PDF</button>
        <button class="btn btn-primary" id="fi-invia" ${i ? '' : 'disabled'}>📤 Protocolla, deposita e prepara la mail</button>
      </div>
    </div>
    <p class="hint" style="margin-top:8px">La lettera porta comuni, cantieri con ritorno previsto (dallo scadenzario del gestionale),
      richieste in attesa (incarichi aperti del tecnico) e il testo standard di s_config. Salva prima, poi protocolla.
      ${i?.lettera_protocollo_id ? `<br><strong>Già protocollata</strong>${i.lettera_drive_url ? ` · <a href="${esc(i.lettera_drive_url)}" target="_blank" rel="noopener">documento su Drive</a>` : ''}${i.lettera_mail_at ? ` · bozza mail del ${dataIt(i.lettera_mail_at.slice(0, 10))}` : ''}` : ''}</p>`);

  if (!i) comuniDi(t).then((cc) => { const el = $('#fi-comuni'); if (el && !el.value) el.value = cc.join(', '); });

  const leggi = () => ({
    tecnico_id: t.tecnico_id, tecnico_nome: nomeTec(t), tecnico_email: t.email, anno, mese,
    data_lettera: $('#fi-data').value, area_zona: $('#fi-area').value.trim() || null,
    cantieri_assegnati: Number($('#fi-cant').value || 0), seconde_visite: Number($('#fi-sec').value || 0),
    altro: Number($('#fi-altro').value || 0), stato: $('#fi-stato').value,
    comuni: $('#fi-comuni').value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
    note: $('#fi-note').value.trim() || null,
    aggiornato_da: state.email, updated_at: new Date().toISOString(),
  });
  $('#fi-salva').addEventListener('click', async (ev) => {
    const d = leggi();
    if (!d.data_lettera) return toast('Serve la data della lettera.', 'err');
    attendi(ev.currentTarget, true);
    const q = i ? sb.from('s_incarichi_mensili').update(d).eq('id', i.id).select('*').single()
      : sb.from('s_incarichi_mensili').insert({ ...d, creato_da: state.email }).select('*').single();
    const { data: salvato, error } = await q;
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast(`Incarico n° ${salvato.id} salvato.`, 'ok');
    await renderMese();
    formIncarico(t, salvato);
  });
  $('#fi-pdf')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const d = await datiLettera(t, { ...i, ...leggi() });
      const { pdfLetteraIncarico } = await import('./fatture-tecnici-doc.js');
      const byte = await pdfLetteraIncarico({ ...i, ...leggi() }, { anteprima: true, data_prot: oggiIso() }, d);
      scaricaPdf(byte, `anteprima-incarico-${fileTec(t)}-${cursore}.pdf`);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });
  $('#fi-invia')?.addEventListener('click', (ev) => inviaLettera(t, { ...i, ...leggi() }, ev.currentTarget));
}

/* cantieri con ritorno previsto e richieste in attesa, dal gestionale */
async function datiLettera(t, inc) {
  const da = new Date(); da.setMonth(da.getMonth() - 24);
  const [{ data: vs }, { data: rq }] = await Promise.all([
    sb.from('visite').select('visita_id, nr_verbale, data_visita, data_ritorno, ipc, acc_cant, cantiere_id, impresa_id, impresa_rl_nome')
      .eq('tecnico_id', t.tecnico_id).gte('data_visita', da.toISOString().slice(0, 10)).or('elimina.is.null,elimina.neq.1')
      .order('data_visita', { ascending: false }).limit(1500),
    sb.from('incarichi').select('id, data_richiesta, tipologia_richiesta, tipo_richiesta, impresa, comune')
      .ilike('tecnico_email', t.email || '—').eq('stato', 'aperto').order('data_richiesta'),
  ]);
  const ultima = {};
  for (const v of vs || []) if (v.cantiere_id && !ultima[v.cantiere_id]) ultima[v.cantiere_id] = v;
  const candidate = Object.values(ultima).filter((v) => v.data_ritorno);
  const ids = [...new Set(candidate.map((v) => v.cantiere_id))];
  const impIds = [...new Set(candidate.map((v) => v.impresa_id).filter(Boolean))];
  const [{ data: cc }, { data: ii }] = await Promise.all([
    ids.length ? sb.from('cantieri').select('cantiere_id, cantiere_etichetta, comune_nome, cantiere_chiuso').in('cantiere_id', ids) : { data: [] },
    impIds.length ? sb.from('imprese').select('impresa_id, impresa_nome').in('impresa_id', impIds) : { data: [] },
  ]);
  const cant = Object.fromEntries((cc || []).map((c) => [c.cantiere_id, c]));
  const imp = Object.fromEntries((ii || []).map((c) => [c.impresa_id, c.impresa_nome]));
  const ncAperte = candidate
    .filter((v) => !cant[v.cantiere_id]?.cantiere_chiuso)
    .map((v) => ({ nr_verbale: (v.nr_verbale || '').replace(/^CPT\//, ''), data_visita: v.data_visita, ritorno: v.data_ritorno, ipc: v.ipc,
      impresa: imp[v.impresa_id] || v.impresa_rl_nome || cant[v.cantiere_id]?.cantiere_etichetta || '', comune: cant[v.cantiere_id]?.comune_nome || '' }))
    .sort((a, b) => String(a.ritorno).localeCompare(String(b.ritorno)));
  return {
    tecnico: nomeTec(t), comuni: inc.comuni?.length ? inc.comuni : await comuniDi(t),
    ncAperte, richieste: rq || [], testo: conf.incarico_visite_testo || '', coordinatore: conf.coordinatore_nome || '',
  };
}

async function inviaLettera(t, inc, btn) {
  if (!inc.id) return toast('Salva prima l\'incarico.', 'err');
  if (inc.lettera_protocollo_id && !confirm('La lettera è già protocollata. Ne preparo un\'altra con un nuovo numero?')) return;
  attendi(btn, true, 'Protocollo e preparo…');
  try {
    const d = await datiLettera(t, inc);
    const oggetto = `Comunicazione visite in cantiere — mese di ${MESI[inc.mese - 1]} ${inc.anno}`;
    const percorso = `${CARTELLA_INCARICHI}/${inc.anno}-${String(inc.mese).padStart(2, '0')}`;
    const { data: prot, error: errP } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT', data_prot: oggiIso(), data_doc: inc.data_lettera || oggiIso(),
      persona: nomeTec(t), oggetto,
      note: `Cantieri assegnati: ${inc.cantieri_assegnati ?? 0}${inc.seconde_visite ? `, seconde visite: ${inc.seconde_visite}` : ''}${inc.altro ? `, altro: ${inc.altro}` : ''}. Comuni: ${(d.comuni || []).join(', ')}.${inc.note ? `\n${inc.note}` : ''}`,
      sintesi: `Incarico mensile n° ${inc.id} a ${nomeTec(t)}: ${d.ncAperte.length} cantieri con ritorno previsto, ${d.richieste.length} richieste in attesa.`,
      ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail',
      tipo_doc_id: TIPO_DOC_LETTERA, tipo_doc_txt: 'Comunicazione visite mensili al tecnico', cartella: percorso,
    } });
    if (errP) throw new Error('Protocollazione non riuscita: ' + errP.message);

    const { pdfLetteraIncarico } = await import('./fatture-tecnici-doc.js');
    const byte = await pdfLetteraIncarico(inc, prot, d);
    const nomeFile = `${(inc.data_lettera || oggiIso()).replace(/-/g, '_')}_COMU_${fileTec(t)}_visite-cantiere-${MESI[inc.mese - 1]}-${inc.anno}.pdf`;
    const base = await risolviCartella(CARTELLA_INCARICHI);
    if (!base.id) throw new Error('Cartella incarichi_visite non trovata su Drive');
    const sub = await creaCartella(base.id, `${inc.anno}-${String(inc.mese).padStart(2, '0')}`);
    const su = await caricaByte(prot, nomeFile, byte, 'application/pdf', sub.id || base.id);
    await sb.from('s_prot_allegati').insert({ protocollo_id: prot.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: byte.length, principale: true, created_by: state.email, drive_file_id: su.drive_file_id, drive_url: su.drive_url });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', prot.id);
    await sb.from('s_incarichi_mensili').update({
      lettera_protocollo_id: prot.id, lettera_drive_id: su.drive_file_id, lettera_drive_url: su.drive_url,
      lettera_mail_at: new Date().toISOString(), aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', inc.id);

    scaricaEml({
      to: t.email, cc: [conf.coordinatore_email].filter(Boolean),
      oggetto: `FORMEDIL PADOVA - Area Sicurezza e Salute - ${oggetto} - ${codiceProtocollo(prot)} - alla c.a. ${nomeTec(t)}`,
      corpo: `Gent.mo ${nomeTec(t)},

in allegato la comunicazione delle visite in cantiere per il mese di ${MESI[inc.mese - 1]} ${inc.anno} (${codiceProtocollo(prot)}):
cantieri assegnati ${inc.cantieri_assegnati ?? 0}${inc.seconde_visite ? `, seconde visite ${inc.seconde_visite}` : ''}${inc.altro ? `, altro ${inc.altro}` : ''}.
Comuni di competenza: ${(d.comuni || []).join(', ') || '—'}.
${d.ncAperte.length ? `\nCantieri con ritorno previsto da richiudere: ${d.ncAperte.length} (elenco in lettera).` : ''}${d.richieste.length ? `\nRichieste in attesa: ${d.richieste.length} (elenco in lettera).` : ''}
${inc.note ? `\n${inc.note}\n` : ''}
${conf.incarico_visite_testo ? `${conf.incarico_visite_testo}\n` : ''}
Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: su.file_name || nomeFile, byte }],
      nomeFile: `incarico-visite-${fileTec(t)}-${inc.anno}-${String(inc.mese).padStart(2, '0')}.eml`,
    });
    toast(`Lettera protocollata (${codiceProtocollo(prot)}) e depositata: bozza scaricata, aprila da Outlook e premi Invia.`, 'ok');
    chiudiDrawer();
    await renderMese();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

async function dettaglioIncarico(i, t) {
  const [{ data: pp }, { data: ff }] = await Promise.all([
    sb.from('s_prestazioni').select('*').eq('incarico_mensile_id', i.id).order('data'),
    sb.from('s_fatture_tecnici').select('*').eq('incarico_mensile_id', i.id).order('id'),
  ]);
  const prest = pp || []; const fatt = ff || [];
  apriDrawer(`Incarico n° ${i.id} — ${esc(i.tecnico_nome)} — ${MESI[i.mese - 1]} ${i.anno}`, 'OUT', `
    <div class="dt-doc-riga"><strong>Lettera:</strong> ${dataIt(i.data_lettera)} · cantieri ${i.cantieri_assegnati ?? 0}${i.seconde_visite ? ` + ${i.seconde_visite} seconde` : ''}${i.altro ? ` + ${i.altro} altro` : ''}${i.area_zona ? ` · area ${esc(String(i.area_zona))}` : ''}
      ${i.lettera_protocollo_id ? ` · protocollata${i.lettera_drive_url ? ` · <a href="${esc(i.lettera_drive_url)}" target="_blank" rel="noopener">PDF</a>` : ''}` : ''}</div>
    <div class="dt-doc-riga"><strong>Stato:</strong> ${pill(STATI_INC, i.stato)}${i.chiuso_il ? ` chiuso il ${dataIt(i.chiuso_il.slice(0, 10))}` : ''}
      ${i.totale_netto != null ? ` · netto ${euro(i.totale_netto)} · lordo ${euro(i.totale_lordo)}` : ''}
      ${i.riepilogo_drive_url ? ` · <a href="${esc(i.riepilogo_drive_url)}" target="_blank" rel="noopener">riepilogo PDF</a>` : ''}</div>
    ${Array.isArray(i.comuni) && i.comuni.length ? `<div class="dt-doc-riga"><strong>Comuni:</strong> ${esc(i.comuni.join(', '))}</div>` : ''}
    ${i.note ? `<div class="dt-doc-riga"><strong>Note:</strong> ${esc(i.note)}</div>` : ''}
    ${i.cantieri_visitati != null ? `<div class="dt-doc-riga"><strong>Cantieri visitati (Access):</strong> ${i.cantieri_visitati}</div>` : ''}
    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 4px">Prestazioni del mese (${prest.length})</h4>
    ${tabellaPrestazioni(prest, fatt)}
    <h4 style="margin:10px 0 4px">Fatture collegate (${fatt.length})</h4>
    ${fatt.length ? fatt.map((f) => `<div class="dt-doc-riga" data-fatt="${f.id}" style="cursor:pointer">🧾 n° ${esc(f.numero || '?')} del ${dataIt(f.data_fattura || f.data_ricevimento)} — ${euro(f.importo)} ${pill(STATI_FATT, f.stato)}</div>`).join('') : '<p class="hint">Nessuna fattura registrata per questo mese.</p>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ghost" id="di-mod">✏️ Modifica / lettera</button>
      <button class="btn btn-primary" id="di-chiudi">📋 ${i.stato === 'aperto' ? 'Chiudi il mese' : 'Ricalcola / riapri la chiusura'}</button>
      <button class="btn btn-ghost" id="di-fatt">🧾 Registra la fattura di questo mese</button>
    </div>`);
  $('#di-mod').addEventListener('click', () => formIncarico(t || tecnici.find((x) => x.tecnico_id === i.tecnico_id), i));
  $('#di-chiudi').addEventListener('click', () => chiudiMese(t || tecnici.find((x) => x.tecnico_id === i.tecnico_id), i));
  $('#di-fatt').addEventListener('click', () => formFattura(null, { tecnico_id: i.tecnico_id, incarico_mensile_id: i.id }));
  $('#drawer-body').querySelectorAll('[data-fatt]').forEach((el) => el.addEventListener('click', () => dettaglioFattura(Number(el.dataset.fatt))));
}

function tabellaPrestazioni(prest, fatt) {
  const fDi = Object.fromEntries((fatt || []).map((f) => [f.id, f]));
  if (!prest.length) return '<p class="hint">Nessuna prestazione congelata.</p>';
  return `<div class="table-wrap"><table class="tbl" style="min-width:0">
    <thead><tr><th>Data</th><th>Tipo</th><th>Descrizione</th><th>Q.tà</th><th>Netto</th><th>Fattura</th></tr></thead>
    <tbody>${prest.map((p) => `<tr data-prest="${p.id}">
      <td>${dataIt(p.data)}</td><td>${esc(TIPI_PRESTAZIONE[p.tipo] || p.tipo)}</td>
      <td>${esc((p.descrizione || '').slice(0, 70))}${p.note ? ` <span class="hint" title="${esc(p.note)}">ⓘ</span>` : ''}</td>
      <td>${p.quantita ?? 1} ${esc(p.unita || '')}</td><td><strong>${euro(p.importo)}</strong></td>
      <td>${p.fattura_id ? `<span class="dt-cella dt-ok" style="padding:1px 6px">n° ${esc(fDi[p.fattura_id]?.numero || p.fattura_id)}</span>` : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">aperta</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ── chiusura del mese ── */
async function chiudiMese(t, inc) {
  const [anno, mese] = inc ? [inc.anno, inc.mese] : cursore.split('-').map(Number);
  chiudiDrawer();
  apriDrawer(`Chiusura mese — ${nomeTec(t)} — ${MESI[mese - 1]} ${anno}`, 'OUT', '<p class="empty">Calcolo le prestazioni dal gestionale, dai corsi, dai servizi e dalle asseverazioni…</p>');
  $('#drawer').classList.add('drawer-xl');
  const { data: calc, error } = await sb.rpc('s_prestazioni_calcola', { p_tecnico: t.tecnico_id, p_anno: anno, p_mese: mese });
  if (error) return toast('Calcolo non riuscito: ' + error.message, 'err');
  const righe = (calc || []).map((r, k) => ({ ...r, k, sel: !r.fattura_id, gia: !!r.prestazione_id }));
  const fisc = fiscDi(t.tecnico_id, meseRange(anno, mese).a);

  const disegna = () => {
    const tot = righe.filter((r) => r.sel).reduce((s, r) => s + Number(r.importo || 0), 0);
    const nVis = righe.filter((r) => r.sel && String(r.tipo).startsWith('visita_')).length;
    const nRlst = righe.filter((r) => r.sel && String(r.tipo).startsWith('visita_') && r.rlst).length;
    const pct = nVis ? Math.round((nRlst / nVis) * 100) : 0;
    $('#drawer-body').innerHTML = `
      <p class="hint" style="margin:0 0 8px">Spunta le prestazioni da mettere nel riepilogo. Le righe già fatturate restano fuori; quelle già congelate
        (da una chiusura precedente o dall'import Access) si aggiornano al mese. Quantità e tariffa si possono correggere qui.</p>
      <div class="table-wrap"><table class="tbl" style="min-width:0">
        <thead><tr><th></th><th>Fonte</th><th>Data</th><th>Tipo</th><th>Descrizione</th><th>Q.tà</th><th>Tariffa</th><th>Netto</th><th>Stato</th></tr></thead>
        <tbody>${righe.map((r) => `<tr data-k="${r.k}" ${r.fattura_id ? 'style="opacity:.55"' : ''}>
          <td><input type="checkbox" data-sel="${r.k}" ${r.sel ? 'checked' : ''} ${r.fattura_id ? 'disabled' : ''}></td>
          <td class="hint">${esc(r.sorgente)}</td>
          <td>${dataIt(String(r.data || '').slice(0, 10))}</td>
          <td><select data-tipo="${r.k}" class="inp inp-sm">${Object.entries(TIPI_PRESTAZIONE).map(([v, l]) => `<option value="${v}" ${r.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${esc((r.descrizione || '').slice(0, 60))}${r.nr_verbale ? ` <span class="hint">${esc(r.nr_verbale)}</span>` : ''}${r.avviso ? `<br><span class="dt-cella dt-senzadata" style="padding:0 5px">${esc(r.avviso)}</span>` : ''}</td>
          <td><input type="number" step="0.5" min="0" data-q="${r.k}" value="${r.quantita ?? 1}" style="width:58px"></td>
          <td><input type="number" step="0.01" min="0" data-t="${r.k}" value="${r.tariffa_unitaria ?? ''}" style="width:72px"></td>
          <td><strong data-imp="${r.k}">${euro(r.importo)}</strong></td>
          <td>${r.fattura_id ? '<span class="dt-cella dt-ok" style="padding:0 5px">fatturata</span>' : r.gia ? '<span class="dt-cella dt-senzadata" style="padding:0 5px">congelata</span>' : '<span class="hint">nuova</span>'}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty">Nessuna prestazione trovata nel mese.</td></tr>'}</tbody></table></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
        <span class="dt-cella dt-ok" style="padding:4px 10px">Selezionate: <strong id="cm-n">${righe.filter((r) => r.sel).length}</strong> · netto <strong id="cm-tot">${euro(tot)}</strong> · lordo <strong id="cm-lordo">${euro(lordoDi(tot, fisc))}</strong>
          <span class="hint">(${fisc ? `${fisc.regime || 'ordinario'}: cassa ${fisc.cassa_pct}% + IVA ${fisc.iva_pct}%` : 'regime non impostato: cassa 4% + IVA 22%'})</span></span>
        <span class="dt-cella ${pct >= Number(conf.rlst_minimo_pct || 20) ? 'dt-ok' : 'dt-scaduto'}" style="padding:4px 10px">RLST ${pct}% su ${nVis} visite (minimo ${conf.rlst_minimo_pct || 20}%)</span>
      </div>
      <div class="field"><label>Note per il tecnico (vanno nel riepilogo)</label><input id="cm-note" value="${esc(inc?.note_riepilogo || '')}"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-ghost" id="cm-anteprima">📄 Anteprima riepilogo (senza protocollo)</button>
        <button class="btn btn-primary" id="cm-congela">🧊 Congela le prestazioni, protocolla il riepilogo e prepara la mail</button>
      </div>
      <p class="hint" style="margin-top:8px">Il riepilogo va al tecnico con cc Amministrazione (${esc(conf.amministrazione_email || 'amministrazione@formedilpadova.it')}); l'invio resta a te da Outlook.
        Le prestazioni congelate restano «aperte» finché non arriva la fattura che le paga.</p>`;

    const ricalcola = () => {
      let tt = 0; let n = 0;
      for (const r of righe) {
        const q = Number($(`[data-q="${r.k}"]`)?.value ?? r.quantita ?? 1);
        const ta = $(`[data-t="${r.k}"]`)?.value;
        r.quantita = q; r.tariffa_unitaria = ta === '' || ta == null ? null : Number(ta);
        r.tipo = $(`[data-tipo="${r.k}"]`)?.value || r.tipo;
        if (r.tariffa_unitaria != null) r.importo = Math.round(q * r.tariffa_unitaria * 100) / 100;
        const cb = $(`[data-sel="${r.k}"]`); r.sel = cb ? cb.checked && !cb.disabled : false;
        const imp = $(`[data-imp="${r.k}"]`); if (imp) imp.textContent = euro(r.importo);
        if (r.sel) { tt += Number(r.importo || 0); n += 1; }
      }
      $('#cm-n').textContent = n; $('#cm-tot').textContent = euro(tt); $('#cm-lordo').textContent = euro(lordoDi(tt, fisc));
    };
    $('#drawer-body').addEventListener('input', ricalcola);
    $('#drawer-body').addEventListener('change', ricalcola);
    $('#cm-anteprima').addEventListener('click', async (ev) => {
      attendi(ev.currentTarget, true);
      try {
        ricalcola();
        const incX = inc || { anno, mese, cantieri_assegnati: 0, altro: 0 };
        const { pdfRiepilogo } = await import('./fatture-tecnici-doc.js');
        const byte = await pdfRiepilogo(incX, { anteprima: true, data_prot: oggiIso() }, datiRiepilogo(t, righe.filter((r) => r.sel), fisc, $('#cm-note').value));
        scaricaPdf(byte, `anteprima-riepilogo-${fileTec(t)}-${anno}-${String(mese).padStart(2, '0')}.pdf`);
      } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
    });
    $('#cm-congela').addEventListener('click', async (ev) => { ricalcola(); await congelaEInvia(t, inc, anno, mese, righe.filter((r) => r.sel), fisc, $('#cm-note').value, ev.currentTarget); });
  };
  disegna();
}

function datiRiepilogo(t, sel, fisc, note) {
  const visite = sel.filter((r) => String(r.tipo).startsWith('visita_'));
  const nRlst = visite.filter((r) => r.rlst).length;
  const tot = sel.reduce((s, r) => s + Number(r.importo || 0), 0);
  const cantieri = new Set(visite.map((r) => r.cantiere_id).filter(Boolean));
  return {
    tecnico: nomeTec(t),
    prestazioni: sel.map((r) => ({ ...r, impresa: r.impresa || (r.descrizione || '').split(' — ')[0] })),
    fisc, rlstPct: visite.length ? Math.round((nRlst / visite.length) * 100) : 0, rlstMinimo: Number(conf.rlst_minimo_pct || 20),
    totNetto: tot, totLordo: lordoDi(tot, fisc), cantieriVisitati: cantieri.size || visite.length, note,
  };
}

async function congelaEInvia(t, inc, anno, mese, sel, fisc, note, btn) {
  if (!sel.length) return toast('Nessuna prestazione selezionata.', 'err');
  if (!confirm(`Congelo ${sel.length} prestazioni di ${nomeTec(t)} per ${MESI[mese - 1]} ${anno}, protocollo il riepilogo e preparo la mail?`)) return;
  attendi(btn, true, 'Congelo e protocollo…');
  try {
    /* l'incarico mensile deve esistere: se manca nasce ora, senza lettera */
    let incarico = inc;
    if (!incarico) {
      const { data: nuovo, error } = await sb.from('s_incarichi_mensili').insert({
        tecnico_id: t.tecnico_id, tecnico_nome: nomeTec(t), tecnico_email: t.email, anno, mese, data_lettera: meseRange(anno, mese).da,
        cantieri_assegnati: 0, stato: 'aperto', note: 'Creato alla chiusura del mese, senza lettera di incarico.', creato_da: state.email,
      }).select('*').single();
      if (error) throw new Error(error.message);
      incarico = nuovo;
    }
    const tot = sel.reduce((s, r) => s + Number(r.importo || 0), 0);
    const lordo = lordoDi(tot, fisc);

    /* prestazioni: nuove in insert, esistenti aggiornate al mese */
    const nuove = sel.filter((r) => !r.prestazione_id).map((r) => ({
      tecnico_id: t.tecnico_id, tecnico_nome: nomeTec(t), data: String(r.data || '').slice(0, 10) || meseRange(anno, mese).da,
      anno, mese, tipo: r.tipo, descrizione: r.descrizione, quantita: r.quantita ?? 1, unita: r.unita || 'visita',
      tariffa_codice: r.tariffa_codice || null, tariffa_unitaria: r.tariffa_unitaria, importo: r.importo,
      visita_id: r.visita_id || null, visita_stage_id: r.visita_stage_id || null, incarico_id: r.incarico_id || null, corso_incarico_id: r.corso_incarico_id || null,
      a_pratica_id: r.a_pratica_id || null, progetto_id: r.progetto_id || null, incarico_mensile_id: incarico.id,
      origine: 'chiusura', creato_da: state.email,
    }));
    if (nuove.length) {
      const { error } = await sb.from('s_prestazioni').insert(nuove);
      if (error) throw new Error('Prestazioni non salvate: ' + error.message);
    }
    for (const r of sel.filter((x) => x.prestazione_id)) {
      await sb.from('s_prestazioni').update({ incarico_mensile_id: incarico.id, tipo: r.tipo, quantita: r.quantita ?? 1,
        tariffa_unitaria: r.tariffa_unitaria, importo: r.importo }).eq('id', r.prestazione_id);
    }

    /* protocollo OUT del riepilogo */
    const esercizio = esercizioDi(meseRange(anno, mese).a);
    const percorso = `${CARTELLA_FATTURE}/ES_20${esercizio.replace('-', '-20')}`;
    const oggetto = `Comunicazione riepilogo attività da fatturare — ${MESI[mese - 1]} ${anno}`;
    const { data: prot, error: errP } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT', data_prot: oggiIso(), data_doc: oggiIso(), persona: nomeTec(t), oggetto,
      note: `${sel.length} prestazioni: netto ${euro(tot)}, totale oneri e IVA inclusi ${euro(lordo)}.${note ? `\n${note}` : ''}`,
      sintesi: `Riepilogo del mese per la fattura del tecnico (incarico mensile n° ${incarico.id}). ${sel.filter((r) => String(r.tipo).startsWith('visita_')).length} visite, ${sel.filter((r) => !String(r.tipo).startsWith('visita_')).length} altre attività.`,
      ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail',
      tipo_doc_id: TIPO_DOC_RIEPILOGO, tipo_doc_txt: 'Riepilogo attività da fatturare', cartella: percorso,
    } });
    if (errP) throw new Error('Protocollazione non riuscita: ' + errP.message);

    const { pdfRiepilogo } = await import('./fatture-tecnici-doc.js');
    const byte = await pdfRiepilogo(incarico, prot, datiRiepilogo(t, sel, fisc, note));
    const nomeFile = `${oggiIso().replace(/-/g, '_')}_COMU_${fileTec(t)}_riepilogo-attivita-da-fatturare-${MESI[mese - 1]}-${anno}.pdf`;
    const base = await risolviCartella(CARTELLA_FATTURE);
    if (!base.id) throw new Error('Cartella fatture/tecnici non trovata su Drive');
    const sub = await creaCartella(base.id, `ES_20${esercizio.replace('-', '-20')}`);
    const su = await caricaByte(prot, nomeFile, byte, 'application/pdf', sub.id || base.id);
    await sb.from('s_prot_allegati').insert({ protocollo_id: prot.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: byte.length, principale: true, created_by: state.email, drive_file_id: su.drive_file_id, drive_url: su.drive_url });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', prot.id);
    await sb.from('s_incarichi_mensili').update({
      stato: 'chiuso', chiuso_il: new Date().toISOString(), chiuso_da: state.email,
      totale_netto: tot, totale_lordo: lordo, cantieri_visitati: datiRiepilogo(t, sel, fisc, note).cantieriVisitati,
      riepilogo_protocollo_id: prot.id, riepilogo_drive_id: su.drive_file_id, riepilogo_drive_url: su.drive_url,
      riepilogo_mail_at: new Date().toISOString(), aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', incarico.id);

    const visite = sel.filter((r) => String(r.tipo).startsWith('visita_'));
    const perTipo = {};
    for (const r of sel) perTipo[r.tipo] = (perTipo[r.tipo] || 0) + 1;
    scaricaEml({
      to: t.email, cc: [conf.amministrazione_email || 'amministrazione@formedilpadova.it'],
      oggetto: `FORMEDIL PADOVA - Area Sicurezza e Salute - ${oggetto} - ${codiceProtocollo(prot)} - alla c.a. ${nomeTec(t)}`,
      corpo: `Gent.mo ${nomeTec(t)},

in allegato il riepilogo delle attività da fatturare per il mese di ${MESI[mese - 1]} ${anno} (${codiceProtocollo(prot)}):
${Object.entries(perTipo).map(([k, n]) => `- ${TIPI_PRESTAZIONE[k] || k}: ${n}`).join('\n')}

Totale netto ${euro(tot)} — totale oneri e IVA inclusi ${euro(lordo)}${fisc ? ` (${fisc.regime || 'ordinario'}: cassa ${fisc.cassa_pct}%${fisc.iva_pct ? `, IVA ${fisc.iva_pct}%` : ', IVA non dovuta'})` : ''}.
${visite.length ? `Visite con RLST: ${Math.round((visite.filter((r) => r.rlst).length / visite.length) * 100)}% (minimo ${conf.rlst_minimo_pct || 20}%).` : ''}
${note ? `\n${note}\n` : ''}
Le diciture da riportare in fattura sono nel riepilogo. Una volta emessa la fattura si prega di inviarne copia anche a cpt@formedilpadova.it.

Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: su.file_name || nomeFile, byte }],
      nomeFile: `riepilogo-${fileTec(t)}-${anno}-${String(mese).padStart(2, '0')}.eml`,
    });
    toast(`Mese chiuso: ${sel.length} prestazioni congelate, riepilogo ${codiceProtocollo(prot)} depositato, bozza scaricata.`, 'ok');
    chiudiDrawer();
    await renderMese();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

/* ══════════ scheda FATTURE ══════════ */

async function renderFatture(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let q = sb.from('s_fatture_tecnici').select('*').order('id', { ascending: false });
  if (filtroFatt === 'aperte') q = q.in('stato', ['attesa', 'ricevuta', 'verificata', 'approvata', 'standby']);
  if (filtroFatt === 'mandato') q = q.eq('stato', 'mandato');
  if (filtroFatt === 'anno') q = q.gte('data_ricevimento', `${annoPrest}-01-01`).lte('data_ricevimento', `${annoPrest}-12-31`);
  if (filtroFatt === 'tutte') q = q.limit(400);
  if (filtroTec) q = q.eq('tecnico_id', filtroTec);
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
        <select id="ff-tec" class="inp inp-sm"><option value="">Tutti i tecnici</option>${tecnici.map((t) => `<option value="${t.tecnico_id}" ${filtroTec === t.tecnico_id ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</select>
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
  $('#ff-tec').addEventListener('change', (e) => { filtroTec = e.target.value; renderFatture(); });
  $('#ff-nuova').addEventListener('click', () => formFattura(null, {}));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => dettaglioFattura(Number(tr.dataset.id))));
}

async function formFattura(f, prefill = {}) {
  const tecId = f?.tecnico_id || prefill.tecnico_id || tecnici[0]?.tecnico_id;
  const { data: mesi } = await sb.from('s_incarichi_mensili').select('id, anno, mese, stato, totale_lordo')
    .eq('tecnico_id', tecId).order('anno', { ascending: false }).order('mese', { ascending: false }).limit(18);
  const incSel = f?.incarico_mensile_id || prefill.incarico_mensile_id || (mesi || []).find((m) => m.stato === 'chiuso')?.id || '';
  apriDrawer(f ? `Fattura n° ${f.id} — ${esc(f.tecnico_nome)}` : 'Registra fattura ricevuta', 'IN', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Tecnico *</label>
        <select id="ff-t">${tecnici.map((t) => `<option value="${t.tecnico_id}" ${t.tecnico_id === tecId ? 'selected' : ''}>${esc(nomeTec(t))}</option>`).join('')}</select></div>
      <div class="field"><label>Mese di riferimento (incarico)</label>
        <select id="ff-inc"><option value="">— nessuno / non mensile —</option>${(mesi || []).map((m) => `<option value="${m.id}" ${String(m.id) === String(incSel) ? 'selected' : ''}>${MESI[m.mese - 1]} ${m.anno} — n° ${m.id} (${m.stato}${m.totale_lordo ? `, ${euro(m.totale_lordo)}` : ''})</option>`).join('')}</select></div>
      <div class="field"><label>Numero fattura *</label><input id="ff-num" value="${esc(f?.numero || '')}"></div>
      <div class="field"><label>Data fattura</label><input type="date" id="ff-df" value="${f?.data_fattura || ''}"></div>
      <div class="field"><label>Data ricevimento *</label><input type="date" id="ff-dr" value="${f?.data_ricevimento || oggiIso()}"></div>
      <div class="field"><label>Importo totale (oneri e IVA inclusi) *</label><input type="number" step="0.01" id="ff-imp" value="${f?.importo ?? ''}"></div>
      <div class="field"><label>Imponibile (netto)</label><input type="number" step="0.01" id="ff-impon" value="${f?.imponibile ?? ''}"></div>
      <div class="field"><label>Cantieri fatturati</label><input type="number" id="ff-cant" value="${f?.cantieri_fatturati ?? ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note (descrizione in fattura, anomalie)</label><textarea id="ff-note" rows="2">${esc(f?.note || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${f ? '<button class="btn btn-ghost" id="ff-annulla">🗑 Annulla la fattura</button>' : ''}</div>
      <button class="btn btn-primary" id="ff-salva">💾 ${f ? 'Salva' : 'Registra e aggancia le prestazioni del mese'}</button>
    </div>
    <p class="hint" style="margin-top:8px">Alla registrazione le prestazioni congelate del mese scelto (ancora senza fattura) si agganciano da sole
      a questa fattura: è il posto unico in cui si segna «con quale fattura è stata pagata». Poi dal dettaglio: protocollo IN, verifica, approvazione.</p>`);

  $('#ff-t').addEventListener('change', () => formFattura(f, { ...prefill, tecnico_id: $('#ff-t').value }));
  $('#ff-salva').addEventListener('click', async (ev) => {
    const t = tecnici.find((x) => x.tecnico_id === $('#ff-t').value);
    const d = {
      tecnico_id: t.tecnico_id, tecnico_nome: nomeTec(t),
      incarico_mensile_id: $('#ff-inc').value ? Number($('#ff-inc').value) : null,
      numero: $('#ff-num').value.trim(), data_fattura: $('#ff-df').value || null, data_ricevimento: $('#ff-dr').value || null,
      importo: Number($('#ff-imp').value || 0), imponibile: $('#ff-impon').value ? Number($('#ff-impon').value) : null,
      cantieri_fatturati: $('#ff-cant').value ? Number($('#ff-cant').value) : null,
      note: $('#ff-note').value.trim() || null, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    };
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
        if (riga.incarico_mensile_id) {
          const { data: agg } = await sb.from('s_prestazioni').update({ fattura_id: riga.id })
            .eq('incarico_mensile_id', riga.incarico_mensile_id).is('fattura_id', null).select('id');
          await sb.from('s_incarichi_mensili').update({ stato: 'fatturato', aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', riga.incarico_mensile_id);
          toast(`Fattura n° ${riga.id} registrata: ${(agg || []).length} prestazioni agganciate.`, 'ok');
        } else toast(`Fattura n° ${riga.id} registrata (senza mese: aggancia le prestazioni dal dettaglio).`, 'ok');
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

  apriDrawer(`Fattura n° ${f.id} — ${esc(f.numero || '')} — ${esc(f.tecnico_nome || '')}`, 'IN', `
    <div class="dt-quadro-riga"><span class="dt-dot ${(STATI_FATT[f.stato] || [''])[0]}"></span><span class="dt-quadro-req">Stato</span>
      <span class="dt-quadro-stato">${pill(STATI_FATT, f.stato)}${f.verificata_il ? ` · verificata ${dataIt(f.verificata_il)}` : ''}${f.approvata_il ? ` · approvata ${dataIt(f.approvata_il)} (${esc(f.approvata_da || '')})` : ''}${f.mandato_data ? ` · mandato ${dataIt(f.mandato_data)}` : ''}</span></div>
    ${f.stato === 'standby' ? `<div class="dt-doc-riga" style="color:#a01f00"><strong>Stand-by:</strong> ${esc(f.standby_motivo || '')} — ${esc(f.standby_da || '')}${f.standby_il ? ` il ${dataIt(String(f.standby_il).slice(0, 10))}` : ''}. Il mandato non parte finché non si risolve (regola del controllo verbali).</div>` : ''}
    <div class="dt-doc-riga"><strong>Fattura:</strong> n° ${esc(f.numero || '—')}${f.data_fattura ? ` del ${dataIt(f.data_fattura)}` : ''} · ricevuta ${f.data_ricevimento ? dataIt(f.data_ricevimento) : '—'} · <strong>${euro(f.importo)}</strong>${f.imponibile != null ? ` (imponibile ${euro(f.imponibile)})` : ''}${f.cantieri_fatturati != null ? ` · ${f.cantieri_fatturati} cantieri` : ''}</div>
    <div class="dt-doc-riga"><strong>Mese:</strong> ${inc ? `<span data-inc="${inc.id}" style="cursor:pointer;text-decoration:underline">${MESI[inc.mese - 1]} ${inc.anno} — incarico n° ${inc.id}</span>` : '—'}
      · <strong>Protocollo IN:</strong> ${prot ? esc(codiceProtocollo(prot)) : '<span class="hint">non protocollata</span>'}</div>
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
      ${f.stato === 'mandato' ? '<button class="btn btn-ghost btn-sm" id="df-pagata">💰 Segna pagata</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="df-mod">✏️ Modifica</button>
    </div>
    <p class="hint" style="margin-top:8px">Il mandato si prepara dalla scheda «Mandati» con le fatture approvate. Tutti i pagamenti li firma il Direttore, fuori dall'app.</p>`);

  $('#drawer-body').querySelector('[data-inc]')?.addEventListener('click', () => dettaglioIncarico(inc, t));
  $('#df-prot')?.addEventListener('click', () => protocollaFattura(f, inc, t));
  $('#df-aggancia')?.addEventListener('click', () => agganciaPrestazioni(f));
  $('#df-verif')?.addEventListener('click', async () => {
    await sb.from('s_fatture_tecnici').update({ stato: 'verificata', verificata_da: state.email, verificata_il: oggiIso(), aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
    toast('Fattura verificata.', 'ok'); await renderFatture(); dettaglioFattura(f.id);
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
  $('#df-pagata')?.addEventListener('click', async () => {
    await sb.from('s_fatture_tecnici').update({ stato: 'pagata', aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', f.id);
    if (inc) await sb.from('s_incarichi_mensili').update({ stato: 'pagato' }).eq('id', inc.id);
    toast('Fattura segnata pagata.', 'ok'); await renderFatture(); dettaglioFattura(f.id);
  });
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

async function agganciaPrestazioni(f) {
  const { data: aperte } = await sb.from('s_prestazioni').select('*').eq('tecnico_id', f.tecnico_id).is('fattura_id', null).order('data', { ascending: false }).limit(300);
  const righe = aperte || [];
  apriDrawer(`Aggancia prestazioni — fattura n° ${f.id} (${esc(f.numero || '')})`, 'IN', `
    <p class="hint" style="margin:0 0 8px">Prestazioni di ${esc(f.tecnico_nome || '')} ancora senza fattura. Spunta quelle pagate da questa fattura.</p>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th></th><th>Data</th><th>Tipo</th><th>Descrizione</th><th>Netto</th><th>Mese</th></tr></thead>
      <tbody>${righe.map((p) => `<tr><td><input type="checkbox" data-p="${p.id}" ${p.incarico_mensile_id && p.incarico_mensile_id === f.incarico_mensile_id ? 'checked' : ''}></td>
        <td>${dataIt(p.data)}</td><td>${esc(TIPI_PRESTAZIONE[p.tipo] || p.tipo)}</td><td>${esc((p.descrizione || '').slice(0, 60))}</td>
        <td><strong>${euro(p.importo)}</strong></td><td class="hint">${p.incarico_mensile_id ? `n° ${p.incarico_mensile_id}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nessuna prestazione aperta per questo tecnico.</td></tr>'}</tbody></table></div>
    <button class="btn btn-primary" id="ap-ok" style="margin-top:10px">🔗 Aggancia le selezionate</button>`);
  $('#ap-ok').addEventListener('click', async (ev) => {
    const ids = [...$('#drawer-body').querySelectorAll('input[data-p]:checked')].map((i) => Number(i.dataset.p));
    if (!ids.length) return toast('Niente selezionato.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_prestazioni').update({ fattura_id: f.id }).in('id', ids);
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast(`${ids.length} prestazioni agganciate alla fattura n° ${f.id}.`, 'ok');
    dettaglioFattura(f.id);
  });
}

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
      <thead><tr><th>N°</th><th>Data</th><th>Totale</th><th>Note</th><th>Documento</th></tr></thead>
      <tbody>${(mm || []).map((m) => `<tr><td>${m.id}</td><td>${dataIt(m.data)}</td><td><strong>${euro(m.totale)}</strong></td><td class="hint">${esc(m.note || '')}</td>
        <td>${m.drive_url ? `<a href="${esc(m.drive_url)}" target="_blank" rel="noopener">PDF</a>` : '—'}${m.mail_at ? ' · 📧' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nessun mandato ancora emesso dall\'app.</td></tr>'}</tbody></table></div>
    <p class="hint" style="margin-top:8px">Il mandato è un documento interno: non prende protocollo. Va all'Amministrazione (Patrizia) come PDF con la bozza mail;
      le fatture passano a «in mandato» e il mese a «pagato». I pagamenti li firma il Direttore.</p>`;
  $('#md-nuovo')?.addEventListener('click', (ev) => {
    const ids = [...host.querySelectorAll('input[data-f]:checked')].map((i) => Number(i.dataset.f));
    if (!ids.length) return toast('Seleziona almeno una fattura.', 'err');
    emettiMandato(approvate.filter((f) => ids.includes(f.id)), ev.currentTarget);
  });
}

async function emettiMandato(sel, btn) {
  const totale = sel.reduce((s, f) => s + Number(f.importo || 0), 0);
  if (!confirm(`Emetto il mandato per ${sel.length} fatture, totale ${euro(totale)}?`)) return;
  attendi(btn, true, 'Preparo il mandato…');
  try {
    const ids = sel.map((f) => f.id);
    const { data: ff } = await sb.from('s_fatture_tecnici').select('*').in('id', ids);
    const incIds = [...new Set((ff || []).map((f) => f.incarico_mensile_id).filter(Boolean))];
    const { data: inc } = incIds.length ? await sb.from('s_incarichi_mensili').select('*').in('id', incIds) : { data: [] };
    const incDi = Object.fromEntries((inc || []).map((i) => [i.id, i]));
    const { data: pp } = await sb.from('s_prestazioni').select('fattura_id, visita_id').in('fattura_id', ids);
    const visitati = {};
    for (const p of pp || []) if (p.visita_id) visitati[p.fattura_id] = (visitati[p.fattura_id] || 0) + 1;
    const fatture = (ff || []).map((f) => ({ ...f, incarico: incDi[f.incarico_mensile_id] || null, cantieri_visitati: visitati[f.id] || f.cantieri_fatturati }));

    const { data: m, error } = await sb.from('s_mandati_pagamento').insert({ data: oggiIso(), totale, note: `${sel.length} fatture: ${[...new Set(fatture.map((f) => f.tecnico_nome))].join(', ')}`, creato_da: state.email }).select('*').single();
    if (error) throw new Error(error.message);
    const { pdfMandato } = await import('./fatture-tecnici-doc.js');
    const byte = await pdfMandato(m, fatture);
    const esercizio = esercizioDi(oggiIso());
    const nomeFile = `${oggiIso().replace(/-/g, '_')}_PAG_Formedil-Padova_mandato-pagamento-tecnici-n${m.id}.pdf`;
    const base = await risolviCartella(CARTELLA_FATTURE);
    if (!base.id) throw new Error('Cartella fatture/tecnici non trovata su Drive');
    const sub = await creaCartella(base.id, `ES_20${esercizio.replace('-', '-20')}`);
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf', base64: b64(byte), parent_id: sub.id || base.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));
    await sb.from('s_mandati_pagamento').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url, mail_at: new Date().toISOString() }).eq('id', m.id);
    await sb.from('s_fatture_tecnici').update({ stato: 'mandato', mandato_id: m.id, mandato_data: oggiIso(), aggiornato_da: state.email, updated_at: new Date().toISOString() }).in('id', ids);
    if (incIds.length) await sb.from('s_incarichi_mensili').update({ stato: 'pagato', aggiornato_da: state.email, updated_at: new Date().toISOString() }).in('id', incIds);

    scaricaEml({
      to: conf.amministrazione_email || 'amministrazione@formedilpadova.it',
      cc: [conf.direttore_email].filter(Boolean),
      oggetto: `FORMEDIL PADOVA - Area Sicurezza e Salute - Mandato di pagamento n° ${m.id} del ${dataIt(m.data)} - fatture tecnici`,
      corpo: `Buongiorno,

in allegato il mandato di pagamento n° ${m.id} per le fatture dei tecnici approvate dal coordinatore:
${fatture.map((f) => `- ${f.tecnico_nome}: fattura n° ${f.numero || '?'}${f.incarico ? ` (${MESI[f.incarico.mese - 1]} ${f.incarico.anno})` : ''} — ${euro(f.importo)}`).join('\n')}

Importo totale: ${euro(totale)}.
Il PDF è anche depositato in archivio (Amministrazione/fatture/tecnici).

Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: su.file_name || nomeFile, byte }],
      nomeFile: `mandato-${m.id}.eml`,
    });
    toast(`Mandato n° ${m.id} emesso e depositato: bozza per l'Amministrazione scaricata.`, 'ok');
    await renderMandati();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

/* ══════════ scheda PRESTAZIONI E STORICO ══════════ */

async function renderPrestazioni(hostArg) {
  const host = hostArg || $('#ft-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let q = sb.from('s_prestazioni').select('*').order('data', { ascending: false }).order('id', { ascending: false }).limit(600);
  if (filtroTec) q = q.eq('tecnico_id', filtroTec);
  if (filtroPrest === 'aperte') q = q.is('fattura_id', null);
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
        ${[['aperte', 'Da fatturare'], ['anno', `Anno ${annoPrest}`]].map(([v, l]) => `<button class="seg-btn ${filtroPrest === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
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
        <td>${f ? `<span class="dt-cella dt-ok" style="padding:1px 6px">n° ${esc(f.numero || f.id)}</span> <span class="hint">${dataIt(f.data_fattura || f.data_ricevimento)}</span>` : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">aperta</span>'}</td>
      </tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nessuna prestazione con questo filtro.</td></tr>'}</tbody></table></div>
    <p class="hint" style="margin-top:8px">È la situazione storica: per ogni visita, docenza, servizio o asseverazione, con quale fattura è stata pagata.
      Le righe con «ⓘ» portano una nota dall'import Access (es. «DA VERIFICARE: possibile doppione»). Clic su una riga per agganciarla a una fattura o correggerla.</p>`;

  $('#pr-f').addEventListener('click', (e) => { const b = e.target.closest('[data-val]'); if (b) { filtroPrest = b.dataset.val; renderPrestazioni(); } });
  $('#pr-anno').addEventListener('change', (e) => { annoPrest = Number(e.target.value) || annoPrest; filtroPrest = 'anno'; renderPrestazioni(); });
  $('#pr-tec').addEventListener('change', (e) => { filtroTec = e.target.value; renderPrestazioni(); });
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
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${p && !p.visita_id && !p.corso_incarico_id ? '<button class="btn btn-ghost" id="pp-del">🗑 Elimina</button>' : ''}</div>
      <button class="btn btn-primary" id="pp-salva">💾 Salva</button>
    </div>
    ${p ? `<p class="hint" style="margin-top:8px">Origine: ${esc(p.origine || '')}${p.visita_id ? ` · visita ${esc(p.visita_id)}` : ''}${p.visita_stage_id ? ` · visita stage senza verbale n° ${p.visita_stage_id}` : ''}${p.corso_incarico_id ? ` · incarico corso ${p.corso_incarico_id}` : ''}${p.incarico_id ? ` · incarico gestionale ${p.incarico_id}` : ''}${p.a_pratica_id ? ' · pratica di asseverazione' : ''}</p>` : ''}`);
  $('#pp-t')?.addEventListener('change', () => { filtroTec = $('#pp-t').value; formPrestazione(p); });
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
  $('#pp-del')?.addEventListener('click', async () => {
    if (!confirm('Elimino la prestazione?')) return;
    const { error } = await sb.from('s_prestazioni').delete().eq('id', p.id);
    if (error) return toast(error.message, 'err');
    toast('Eliminata.', 'ok'); chiudiDrawer(); renderPrestazioni();
  });
}

/* dal cruscotto / dal link profondo #fattura-<id> */
export async function apriPratica(id) {
  if (!tecnici.length) await caricaBase();
  return dettaglioFattura(Number(id));
}
