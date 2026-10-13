/* ============================================================
   TIPOLOGIE DI CORSO E SCHEDE FORMATIVE — lato segreteria
   (13/10/2026, lotto 2 del fascicolo corso digitale)

   Il catalogo dei corsi (`s_corsi_tipologie`: riferimento normativo, ore,
   validità, soglie, se ricade nell'Accordo CSR 59/2025) e, per ciascuna
   tipologia, la scheda formativa versionata (`s_corsi_schede_formative`).
   La scheda la SCRIVE il responsabile del progetto formativo nel
   gestionale (pagina Formazione), o il docente a cui la delega; qui la
   segreteria:
     · tiene il catalogo (anche l'RPF può: RPC tipologia_salva);
     · vede lo stato delle schede e, quando una è «pronta», la MANDA IN
       FIRMA: il PDF lo disegna la funzione documenti-corso (la stessa
       del gestionale), i firmatari li dice lei (delegato, poi RPF), e
       il registro delle firme (lotto 1) fa il resto; a catena completa
       il database segna la scheda firmata e vigente;
     · sceglie la tipologia aprendo un corso (corsi.js): l'edizione
       congela la versione vigente della scheda.
   Si salvano solo i campi cambiati (regola del 04/10/2026).
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, apriDrawer } from './core.js';
import { chiediFirma } from './firme.js';

export const STATI_SCHEDA = { bozza: 'bozza', pronta: 'pronta per la firma', in_firma: 'in firma', firmata: 'firmata (vigente)', superata: 'superata' };
const TIPI_ATT = { partecipazione: 'Partecipazione', frequenza: 'Regolare frequenza', frequenza_verifica: 'Frequenza + verifica finale' };
const MODALITA = { presenza: 'In presenza', videoconferenza: 'Videoconferenza sincrona', pratica: 'Spazi dedicati alla pratica', mista: 'Mista', elearning: 'E-learning (dove l\'Accordo lo ammette)' };

let tipologie = [];
let schede = [];

export async function caricaTipologie() {
  const [{ data: t, error: e1 }, { data: s, error: e2 }] = await Promise.all([
    sb.from('s_corsi_tipologie').select('*').order('titolo'),
    sb.from('s_corsi_schede_formative').select('id, tipologia_id, versione, stato, delegata_a, compilata_da, updated_at, firmata_il').order('tipologia_id').order('versione', { ascending: false }),
  ]);
  if (e1) throw new Error('Non riesco a leggere le tipologie: ' + e1.message);
  if (e2) throw new Error('Non riesco a leggere le schede formative: ' + e2.message);
  tipologie = t || []; schede = s || [];
  return { tipologie, schede };
}
export const tipologieAttive = () => tipologie.filter((t) => t.stato === 'attiva');
export const tipologiaDi = (id) => tipologie.find((t) => t.id === id) || null;
export const schedaVigenteDi = (tipId) => { const t = tipologiaDi(tipId); return t?.scheda_vigente_id ? schede.find((s) => s.id === t.scheda_vigente_id) || null : null; };

/* i campi del corso che la tipologia propone (solo sul NUOVO: i predefiniti valgono sul nuovo) */
export function propostaDaTipologia(t) {
  if (!t) return {};
  return {
    durata_ore: t.ore_minime ?? null, perc_freq_min: t.perc_freq_min ?? 90, test_previsto: !!t.test_previsto,
    questionario_previsto: !!t.questionario_previsto, tipo_attestato: t.tipo_attestato, normativa: t.riferimento_normativo || null,
    validita_txt: t.validita_anni ? `Validità ${t.validita_anni} anni${t.aggiornamento_ore ? `; aggiornamento ${t.aggiornamento_ore} ore${t.aggiornamento_anni ? ` ogni ${t.aggiornamento_anni} anni` : ''}` : ''}` : null,
    firme_qr: !!t.firme_qr, scheda_formativa_id: t.scheda_vigente_id || null,
  };
}

const pill = (s) => `<span class="dt-cella ${s.stato === 'firmata' ? 'dt-ok' : s.stato === 'pronta' || s.stato === 'in_firma' ? 'dt-scaduto' : ''}" style="padding:1px 6px">${esc(STATI_SCHEDA[s.stato] || s.stato)}</span>`;

/* ── la vista: catalogo + schede ── */
export async function vistaTipologie() {
  try { await caricaTipologie(); } catch (e) { return toast(e.message, 'err'); }
  const righe = tipologie.map((t) => {
    const vers = schede.filter((s) => s.tipologia_id === t.id);
    const vig = vers.find((s) => s.id === t.scheda_vigente_id) || null;
    const lavoro = vers.find((s) => ['bozza', 'pronta', 'in_firma'].includes(s.stato)) || null;
    return `<tr data-tip="${t.id}" style="${t.stato === 'superata' ? 'opacity:.55' : ''}">
      <td><strong>${esc(t.titolo)}</strong><br><span class="hint">${esc(t.codice)}${t.riferimento_normativo ? ' · ' + esc(t.riferimento_normativo) : ''}${t.ore_minime ? ` · ${t.ore_minime} ore` : ''}${t.accordo_2025 ? '' : ' · fuori Accordo'}${t.firme_qr ? ' · firme QR' : ''}</span></td>
      <td>${vig ? `v${vig.versione} ${pill(vig)}<br><span class="hint">firmata il ${dataIt(vig.firmata_il)}</span>` : '<span class="hint" style="color:#a01f00">nessuna firmata</span>'}</td>
      <td>${lavoro ? `v${lavoro.versione} ${pill(lavoro)}${lavoro.delegata_a ? `<br><span class="hint">delegata a ${esc(lavoro.delegata_a)}</span>` : ''}` : '—'}</td>
      <td style="white-space:nowrap;text-align:right">
        <a href="#" data-tip-mod="${t.id}" title="Modifica la tipologia">⚙️</a>
        ${vig || lavoro ? ` · <a href="#" data-sch-pdf="${(lavoro || vig).id}" title="PDF della scheda ${lavoro ? 'in lavorazione' : 'vigente'}">📄</a>` : ''}
        ${lavoro?.stato === 'pronta' ? ` · <a href="#" data-sch-firma="${lavoro.id}" title="Manda in firma la scheda pronta">✍️ in firma</a>` : ''}
      </td></tr>`;
  }).join('');
  apriDrawer('📋 Tipologie di corso e schede formative', '', `
    <p class="hint" style="margin:0 0 8px">Il catalogo dei corsi. La <strong>scheda formativa</strong> di ogni tipologia la scrive il responsabile del progetto formativo nel gestionale (pagina 📚 Formazione), o il docente a cui la delega; quando è <strong>pronta</strong> la mandi in firma da qui (prima il docente delegato, poi il responsabile). La versione firmata è quella <strong>vigente</strong>: un corso nuovo la congela all'apertura.</p>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Tipologia</th><th>Scheda vigente</th><th>In lavorazione</th><th></th></tr></thead>
      <tbody>${righe || '<tr><td colspan="4" class="empty">Nessuna tipologia: comincia da «+ Nuova tipologia».</td></tr>'}</tbody>
    </table></div>
    <div style="margin-top:10px"><button class="btn btn-primary btn-sm" id="tp-nuova">+ Nuova tipologia</button></div>`);
  $('#drawer').classList.add('drawer-xl');
  const host = $('#drawer-body');
  host.querySelectorAll('[data-tip-mod]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); formTipologia(tipologiaDi(Number(a.dataset.tipMod))); }));
  host.querySelector('#tp-nuova')?.addEventListener('click', () => formTipologia(null));
  host.querySelectorAll('[data-sch-pdf]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await apriPdfScheda(Number(a.dataset.schPdf)); }));
  host.querySelectorAll('[data-sch-firma]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await mandaInFirma(Number(a.dataset.schFirma)); }));
}

/* ── la tipologia (stessa maschera del gestionale, per la segreteria) ── */
function formTipologia(t) {
  const v = t || { perc_freq_min: 90, max_discenti: 30, modalita_ammesse: ['presenza'], test_previsto: true, questionario_previsto: true, tipo_attestato: 'frequenza_verifica', accordo_2025: true, firme_qr: true, vale_anche_come: [], stato: 'attiva' };
  const chk = (id, on, testo) => `<label><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${testo}</label>`;
  const num = (id, val, step) => `<input type="number" id="${id}" value="${val ?? ''}" ${step ? `step="${step}"` : ''}>`;
  apriDrawer(t ? `⚙️ Tipologia «${t.titolo}»` : '+ Nuova tipologia di corso', '', `
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
      <div class="field"><label>Codice breve *</label><input id="tp-codice" value="${esc(v.codice || '')}" placeholder="es. ANTINC-L2"></div>
      <div class="field"><label>Titolo *</label><input id="tp-titolo" value="${esc(v.titolo || '')}"></div>
    </div>
    <div class="field"><label>Riferimento normativo</label><input id="tp-rif" value="${esc(v.riferimento_normativo || '')}" placeholder="es. D.Lgs. 81/2008 art. 46; D.M. 2 settembre 2021; Accordo CSR 17/04/2025"></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
      <div class="field"><label>Ore minime</label>${num('tp-ore', v.ore_minime, '0.5')}</div>
      <div class="field"><label>Validità (anni)</label>${num('tp-val', v.validita_anni)}</div>
      <div class="field"><label>Aggiornamento (ore)</label>${num('tp-aggore', v.aggiornamento_ore, '0.5')}</div>
      <div class="field"><label>Aggiornamento ogni (anni)</label>${num('tp-agganni', v.aggiornamento_anni)}</div>
    </div>
    <div class="field"><label>Modalità ammesse</label><div style="display:flex;gap:14px;flex-wrap:wrap">${Object.entries(MODALITA).map(([k, l]) => chk('tp-mod-' + k, (v.modalita_ammesse || []).includes(k), l)).join('')}</div></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="field"><label>Frequenza minima %</label>${num('tp-freq', v.perc_freq_min)}</div>
      <div class="field"><label>Massimo discenti</label>${num('tp-max', v.max_discenti)}</div>
      <div class="field"><label>Rapporto docente/discenti (pratica)</label><input id="tp-rapp" value="${esc(v.rapporto_pratica || '')}" placeholder="es. 1 a 6"></div>
    </div>
    <div class="field"><label>Attestato</label><select id="tp-att">${Object.entries(TIPI_ATT).map(([k, l]) => `<option value="${k}" ${v.tipo_attestato === k ? 'selected' : ''}>${l}</option>`).join('')}${TIPI_ATT[v.tipo_attestato] ? '' : `<option value="${esc(v.tipo_attestato)}" selected>${esc(v.tipo_attestato)} (com'è scritto)</option>`}</select></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 8px">
      ${chk('tp-test', v.test_previsto, 'Verifica finale')} ${chk('tp-quest', v.questionario_previsto, 'Questionario di gradimento')}
      ${chk('tp-accordo', v.accordo_2025, 'Corso dell\'Accordo CSR 59/2025 (fascicolo pieno)')} ${chk('tp-qr', v.firme_qr, 'Firme di presenza dal QR')}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
      <div class="field"><label>Vale anche come (equivalenze, separate da virgola)</label><input id="tp-vale" value="${esc((v.vale_anche_come || []).join(', '))}" placeholder="es. aggiornamento preposto"></div>
      <div class="field"><label>Crediti</label>${num('tp-crediti', v.crediti, '0.5')}</div>
    </div>
    <div class="field"><label>Note</label><textarea id="tp-note" rows="2">${esc(v.note || '')}</textarea></div>
    ${t ? `<div class="field"><label>Stato</label><select id="tp-stato"><option value="attiva" ${v.stato === 'attiva' ? 'selected' : ''}>attiva</option><option value="superata" ${v.stato === 'superata' ? 'selected' : ''}>superata (non si usa più)</option></select></div>` : ''}
    <button class="btn btn-primary" id="tp-salva" style="margin-top:8px">${t ? 'Salva' : 'Crea la tipologia'}</button>
    <button class="btn btn-ghost" id="tp-indietro" style="margin-top:8px">← Elenco</button>`);
  const letto = {
    codice: v.codice || '', titolo: v.titolo || '', riferimento_normativo: v.riferimento_normativo || '', ore_minime: v.ore_minime ?? '', validita_anni: v.validita_anni ?? '',
    aggiornamento_ore: v.aggiornamento_ore ?? '', aggiornamento_anni: v.aggiornamento_anni ?? '', modalita_ammesse: JSON.stringify(v.modalita_ammesse || []),
    perc_freq_min: v.perc_freq_min ?? '', max_discenti: v.max_discenti ?? '', rapporto_pratica: v.rapporto_pratica || '', tipo_attestato: v.tipo_attestato,
    test_previsto: !!v.test_previsto, questionario_previsto: !!v.questionario_previsto, accordo_2025: !!v.accordo_2025, firme_qr: !!v.firme_qr,
    vale_anche_come: JSON.stringify(v.vale_anche_come || []), crediti: v.crediti ?? '', note: v.note || '', stato: v.stato,
  };
  $('#tp-indietro').addEventListener('click', vistaTipologie);
  $('#tp-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const n = (id) => { const x = $('#' + id).value.trim(); return x === '' ? '' : Number(x); };
    const ora = {
      codice: $('#tp-codice').value.trim(), titolo: $('#tp-titolo').value.trim(), riferimento_normativo: $('#tp-rif').value.trim(),
      ore_minime: n('tp-ore'), validita_anni: n('tp-val'), aggiornamento_ore: n('tp-aggore'), aggiornamento_anni: n('tp-agganni'),
      modalita_ammesse: JSON.stringify(Object.keys(MODALITA).filter((k) => $('#tp-mod-' + k).checked)),
      perc_freq_min: n('tp-freq'), max_discenti: n('tp-max'), rapporto_pratica: $('#tp-rapp').value.trim(), tipo_attestato: $('#tp-att').value,
      test_previsto: $('#tp-test').checked, questionario_previsto: $('#tp-quest').checked, accordo_2025: $('#tp-accordo').checked, firme_qr: $('#tp-qr').checked,
      vale_anche_come: JSON.stringify($('#tp-vale').value.split(',').map((x) => x.trim()).filter(Boolean)), crediti: n('tp-crediti'), note: $('#tp-note').value.trim(),
      stato: t ? $('#tp-stato').value : 'attiva',
    };
    if (!ora.codice || !ora.titolo) return toast('Servono codice e titolo.', 'err');
    const p = t ? { id: t.id } : {};
    for (const k of Object.keys(ora)) if (!t || String(ora[k]) !== String(letto[k])) p[k] = (k === 'modalita_ammesse' || k === 'vale_anche_come') ? JSON.parse(ora[k]) : ora[k];
    if (t && Object.keys(p).length === 1) { toast('Niente da salvare: non hai cambiato nulla.', 'ok'); return vistaTipologie(); }
    attendi(btn, true);
    const { error } = await sb.rpc('tipologia_salva', { p });
    attendi(btn, false);
    if (error) return toast('Non salvata: ' + error.message, 'err');
    toast(t ? 'Tipologia aggiornata.' : 'Tipologia creata.', 'ok');
    vistaTipologie();
  });
}

/* ── i PDF del fascicolo: li disegna la funzione, uguale per le due app ── */
export async function pdfDocumento(azione, id) {
  const { data, error } = await sb.functions.invoke('documenti-corso', { body: { azione, id } });
  if (error || data?.error) {
    let msg = data?.error; try { msg = msg || (await error.context.json()).error; } catch { /* niente */ }
    throw new Error(msg || error?.message || 'PDF non generato');
  }
  return { ...data, byte: Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0)) };
}
export async function apriPdfDocumento(azione, id) {
  const w = window.open('', '_blank');
  try {
    const r = await pdfDocumento(azione, id);
    const url = URL.createObjectURL(new Blob([r.byte], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch (e) { if (w) w.close(); toast(e.message, 'err'); }
}
/* (lotto 3) il progetto formativo dell'edizione in firma all'RPF, il verbale agli esaminatori e poi all'RPF */
export async function mandaInFirmaProgetto(c) {
  if (c.progetto_stato !== 'pronto') return toast('Il progetto formativo non è pronto: lo dichiara pronto il responsabile del progetto formativo dalla pagina Formazione.', 'err');
  if (!confirm(`Mando in firma il progetto formativo del corso n° ${c.id} al responsabile del progetto formativo? Il PDF si genera adesso e gli arriva la mail. Procedo?`)) return;
  try {
    const r = await pdfDocumento('progetto_formativo', c.id);
    const out = await chiediFirma([{ tipo: 'progetto_formativo', rif: `progetto:${c.id}`, corso_id: c.id, titolo: r.titolo, nome_file: r.nome_file, byte: r.byte, firmatari: r.firmatari }]);
    const { error } = await sb.rpc('corso_progetto_stato', { p_corso: c.id, p_stato: 'in_firma' });
    if (error) throw new Error('Firma chiesta, ma il progetto non è segnato «in firma»: ' + error.message);
    const inviate = (out?.avvisi || []).filter((x) => x.inviata).map((x) => x.a);
    toast(inviate.length ? `Progetto in firma: mail mandata a ${inviate.join(', ')}.` : `Progetto in firma, ma la mail non è partita: ${out?.avviso?.errore || 'motivo sconosciuto'}.`, inviate.length ? 'ok' : 'err');
    return true;
  } catch (e) { toast(e.message, 'err'); }
}
export async function mandaInFirmaVerbale(c, v) {
  if (!v || v.stato !== 'pronto') return toast('Il verbale non è pronto: lo prepara e lo dichiara pronto il responsabile del progetto formativo dalla pagina Formazione.', 'err');
  const esam = (Array.isArray(v.esaminatori) ? v.esaminatori : []).map((e) => e.nominativo).join(', ');
  if (!confirm(`Mando in firma il verbale di verifica finale (v${v.versione}) del corso n° ${c.id}: prima agli esaminatori (${esam || 'nessuno'}), poi al responsabile del progetto formativo? Il PDF si genera adesso e a ciascuno arriva la mail. Procedo?`)) return;
  try {
    const r = await pdfDocumento('verbale_verifica', v.id);
    const out = await chiediFirma([{ tipo: 'verbale_verifica', rif: `verbale:${v.id}`, corso_id: c.id, titolo: r.titolo, nome_file: r.nome_file, byte: r.byte, firmatari: r.firmatari }]);
    const { error } = await sb.rpc('corso_verbale_stato', { p_id: v.id, p_stato: 'in_firma' });
    if (error) throw new Error('Firma chiesta, ma il verbale non è segnato «in firma»: ' + error.message);
    const inviate = (out?.avvisi || []).filter((x) => x.inviata).map((x) => x.a);
    toast(inviate.length ? `Verbale in firma: mail mandata a ${inviate.join(', ')}.` : `Verbale in firma, ma la mail non è partita: ${out?.avviso?.errore || 'motivo sconosciuto'}.`, inviate.length ? 'ok' : 'err');
    return true;
  } catch (e) { toast(e.message, 'err'); }
}
async function pdfScheda(id) {
  const { data, error } = await sb.functions.invoke('documenti-corso', { body: { azione: 'scheda_formativa', id } });
  if (error || data?.error) {
    let msg = data?.error; try { msg = msg || (await error.context.json()).error; } catch { /* niente */ }
    throw new Error(msg || error?.message || 'PDF non generato');
  }
  return { ...data, byte: Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0)) };
}
async function apriPdfScheda(id) {
  const w = window.open('', '_blank');
  try {
    const r = await pdfScheda(id);
    const url = URL.createObjectURL(new Blob([r.byte], { type: 'application/pdf' }));
    if (w) w.location.href = url; else window.open(url, '_blank');
  } catch (e) { if (w) w.close(); toast(e.message, 'err'); }
}

/* ── in firma: delegato (se c'è), poi RPF ── */
export async function mandaInFirma(id) {
  const s = schede.find((x) => x.id === id);
  if (!s) return toast('Scheda non trovata: ricarica.', 'err');
  const t = tipologiaDi(s.tipologia_id) || {};
  const chi = s.delegata_a ? `prima al docente ${s.delegata_a}, poi al responsabile del progetto formativo` : 'al responsabile del progetto formativo';
  if (!confirm(`Mando in firma la scheda formativa «${t.titolo}» v${s.versione} ${chi}? Il PDF si genera adesso e a ciascuno arriva la mail. Procedo?`)) return;
  try {
    const r = await pdfScheda(id);
    const out = await chiediFirma([{
      tipo: 'scheda_formativa', rif: `scheda:${s.id}`, titolo: r.titolo, nome_file: r.nome_file, byte: r.byte, firmatari: r.firmatari,
    }]);
    const { error } = await sb.rpc('scheda_stato', { p_id: s.id, p_stato: 'in_firma' });
    if (error) throw new Error('Firma chiesta, ma la scheda non è segnata «in firma»: ' + error.message);
    const inviate = (out?.avvisi || []).filter((x) => x.inviata).map((x) => x.a);
    toast(inviate.length ? `Scheda in firma: mail mandata a ${inviate.join(', ')}.` : `Scheda in firma, ma la mail non è partita: ${out?.avviso?.errore || 'motivo sconosciuto'}. Riprova da «Ricorda a chi deve firmare» nel cruscotto.`, inviate.length ? 'ok' : 'err');
    vistaTipologie();
  } catch (e) { toast(e.message, 'err'); }
}

/* usata da corsi.js per il nome nella scheda del corso */
export function etichettaTipologia(c) {
  const t = c?.tipologia_id ? tipologiaDi(c.tipologia_id) : null;
  if (!t) return '';
  const s = c.scheda_formativa_id ? schede.find((x) => x.id === c.scheda_formativa_id) : null;
  return `${esc(t.titolo)}${s ? ` · scheda v${s.versione}${s.stato === 'firmata' ? '' : ` (${esc(STATI_SCHEDA[s.stato] || s.stato)})`}` : ' · <span style="color:#a01f00">senza scheda firmata</span>'}`;
}

