/* ============================================================
   FORMAZIONE — corsi, seminari, convegni, conferenze di cantiere.
   Sostituisce l'Access «CORSI - SEMINARI - AGGIORNAMENTI»
   (T_Docenti1/2, T_LettereInc, Iscrizione corsi, T_Corsi_Progetti).

   Il flusso (descritto dall'utente il 01/09/2026):
   1. il corso nasce da una pratica (conferenza autorizzata) o a mano;
   2. anagrafiche: imprese per P.IVA e persone per CF si verificano
      PRIMA di iscrivere (import guidato dal template xlsx — fase 2);
   3. giornate (anche non consecutive) + programma docenti
      → lettere di incarico + registro del corso;
   4. iscritti: persona dall'anagrafica, IMPRESA PROPOSTA dal
      rapporto attivo in persone_imprese alla data del corso e
      salvata come SNAPSHOT sulla riga (l'attestato di un corso
      2024 mostra l'impresa del 2024);
   5. dopo il corso: presenze per giornata con orari, calcolo ore
      contro la % minima → ammesso all'attestato;
   6. attestati con serie propria N/aaaa; il logo blu della Regione
      va SOLO sui corsi riconosciuti (riconosciuto_regione).
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo } from './core.js';
import { risolviCartella, caricaByte, leggiByte } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA, collegaDoppioClickMail } from './eml.js';
/* la ricerca in anagrafica sta in un posto solo: la usa anche la
   maschera manuale delle richieste di visita */
import { collegaRicercaPersone } from './ricerca-anagrafica.js';

let corsi = [];
let progetti = [];
let conteggi = {};       // corso_id -> { iscritti, attestati }
let conf = {};
let filtro = 'aperti';

const TIPI = {
  corso: 'Corso', aggiornamento: 'Aggiornamento', seminario: 'Seminario',
  convegno: 'Convegno', tavola_rotonda: 'Tavola rotonda',
  conferenza_cantiere: 'Conferenza di cantiere', altro: 'Altro',
};
const MODALITA = { aula: 'In aula', cantiere: 'In cantiere', impresa: 'In impresa', videoconferenza: 'Videoconferenza', mista: 'Mista' };
const STATI = { bozza: 'Bozza', aperto: 'Aperto', svolto: 'Svolto', chiuso: 'Chiuso', annullato: 'Annullato' };
const TIPI_ATT = { partecipazione: 'Partecipazione', frequenza: 'Regolare frequenza', frequenza_verifica: 'Frequenza + verifica finale' };
const ESITI_ISCR = {
  in_attesa: 'In attesa', presente: 'Presente', presente_online: 'Presente on-line',
  assente: 'Assente', non_presentato: 'Non presentato', annullato: 'Annullato',
  freq_insufficiente: 'Freq. insufficiente', sostituito: 'Sostituito',
};
const QUALITA = { docente: 'Docente', codocente: 'Codocente', relatore: 'Relatore', ospite: 'Ospite', moderatore: 'Moderatore', uditore: 'Uditore' };
const RUOLI_AZ = ['DIPENDENTE', 'TITOLARE', 'SOCIO', 'PREPOSTO', 'RLS', 'RSPP', 'DATORE DI LAVORO', 'COLLABORATORE', 'ALTRO'];

async function carica() {
  const [{ data: c }, { data: pr }, { data: cf }, { data: it }] = await Promise.all([
    sb.from('s_corsi').select('*').order('id', { ascending: false }),
    sb.from('s_progetti_formativi').select('*').order('id', { ascending: false }),
    sb.from('s_config').select('chiave, valore').in('chiave',
      ['responsabile_formativo_nome', 'responsabile_formativo_firma_id', 'presidente_nome', 'presidente_firma_id', 'docenza_tariffa_default']),
    sb.from('s_corsi_iscritti').select('corso_id, attestato_numero'),
  ]);
  corsi = c || [];
  progetti = pr || [];
  conf = Object.fromEntries((cf || []).map((r) => [r.chiave, r.valore]));
  conteggi = {};
  for (const r of it || []) {
    conteggi[r.corso_id] = conteggi[r.corso_id] || { iscritti: 0, attestati: 0 };
    conteggi[r.corso_id].iscritti += 1;
    if (r.attestato_numero) conteggi[r.corso_id].attestati += 1;
  }
}

const oreDa = (dalle, alle) => {
  if (!dalle || !alle) return 0;
  const [h1, m1] = String(dalle).split(':').map(Number);
  const [h2, m2] = String(alle).split(':').map(Number);
  return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60);
};
const oreGiornata = (g) => oreDa(g.dalle, g.alle) + oreDa(g.dalle2, g.alle2);
const orario = (t) => t ? String(t).slice(0, 5) : '';

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#corsi-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const aperti = corsi.filter((c) => !['chiuso', 'annullato'].includes(c.stato));
  const visibili = corsi.filter((c) =>
    filtro === 'tutti' ? true :
    filtro === 'aperti' ? !['chiuso', 'annullato'].includes(c.stato) :
    ['chiuso', 'annullato'].includes(c.stato));

  const righe = visibili.map((c) => {
    const n = conteggi[c.id] || { iscritti: 0, attestati: 0 };
    return `<tr data-id="${c.id}">
      <td>${c.id}</td>
      <td>${esc(TIPI[c.tipo] || c.tipo)}${c.riconosciuto_regione ? ' <span title="Riconosciuto dalla Regione — logo blu sugli attestati">🔵</span>' : ''}</td>
      <td><strong>${esc(c.titolo)}</strong>${c.progetto_id ? ` <span class="hint">· progetto</span>` : ''}</td>
      <td>${c.data_inizio ? dataIt(c.data_inizio) : '—'}${c.data_fine && c.data_fine !== c.data_inizio ? ` → ${dataIt(c.data_fine)}` : ''}</td>
      <td>${c.durata_ore ?? '—'}</td>
      <td>${n.iscritti}</td>
      <td>${c.rilascio_attestato ? `${n.attestati}/${n.iscritti}` : '—'}</td>
      <td>${esc(STATI[c.stato] || c.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella dt-ok" style="padding:4px 10px">📚 ${aperti.length} aperti</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${corsi.length} in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="co-f">
        ${[['aperti', 'Aperti'], ['tutti', 'Tutti'], ['chiusi', 'Chiusi']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="co-progetti">🎯 Progetti finanziati</button>
        <button class="btn btn-primary btn-sm" id="co-nuovo">+ Nuovo corso</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Tipo</th><th>Titolo</th><th>Date</th><th>Ore</th><th>Iscritti</th><th>Attestati</th><th>Stato</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="8" class="empty">Nessun corso con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Il corso raccoglie giornate, programma docenti, iscritti e presenze; da qui nascono
      lettere di incarico, registro e attestati. Il logo blu della Regione va <strong>solo</strong>
      sui corsi riconosciuti (🔵). Le conferenze di cantiere aprono il corso dalla loro pratica.
    </p>`;

  $('#co-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#co-nuovo').addEventListener('click', () => formCorso(null));
  $('#co-progetti').addEventListener('click', vistaProgetti);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriCorso(Number(tr.dataset.id))));
}

/* ══════════ nuovo / modifica corso ══════════ */

function formCorso(c, prefill = {}) {
  const v = { ...(c || {}), ...prefill };
  const sel = (id, val, opzioni) =>
    `<select id="fc-${id}">${Object.entries(opzioni).map(([k, l]) =>
      `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  apriDrawer(c ? `Corso n° ${c.id} — dati` : 'Nuovo corso', '', `
    <div class="field"><label>Titolo *</label><input id="fc-titolo" value="${esc(v.titolo || '')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Tipo</label>${sel('tipo', v.tipo || 'corso', TIPI)}</div>
      <div class="field"><label>Modalità</label>${sel('modalita', v.modalita || 'aula', MODALITA)}</div>
      <div class="field"><label>Data inizio</label><input type="date" id="fc-inizio" value="${v.data_inizio || ''}"></div>
      <div class="field"><label>Data fine</label><input type="date" id="fc-fine" value="${v.data_fine || ''}"></div>
      <div class="field"><label>Durata ore</label><input type="number" step="0.5" id="fc-ore" value="${v.durata_ore ?? ''}"></div>
      <div class="field"><label>% frequenza minima</label><input type="number" id="fc-freqmin" value="${v.perc_freq_min ?? 90}"></div>
    </div>
    <div class="field"><label>Sede</label><input id="fc-sede" value="${esc(v.sede || '')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Attestato</label>${sel('tipoatt', v.tipo_attestato || 'frequenza', TIPI_ATT)}</div>
      <div class="field"><label>Progetto finanziato</label>
        <select id="fc-progetto"><option value="">— nessuno —</option>${progetti.map((p) =>
          `<option value="${p.id}" ${v.progetto_id === p.id ? 'selected' : ''}>${esc(p.titolo.slice(0, 60))}</option>`).join('')}</select></div>
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 8px">
      <label><input type="checkbox" id="fc-rilascio" ${v.rilascio_attestato !== false ? 'checked' : ''}> Rilascia attestati</label>
      <label><input type="checkbox" id="fc-regione" ${v.riconosciuto_regione ? 'checked' : ''}> 🔵 Riconosciuto Regione (logo blu)</label>
      <label><input type="checkbox" id="fc-test" ${v.test_previsto ? 'checked' : ''}> Test finale</label>
      <label><input type="checkbox" id="fc-quest" ${v.questionario_previsto ? 'checked' : ''}> Questionario gradimento</label>
    </div>
    <div class="field"><label>Valido per (testo sull'attestato)</label>
      <textarea id="fc-validita" rows="2">${esc(v.validita_txt || (v.tipo === 'conferenza_cantiere' ? 'Informazione' : ''))}</textarea></div>
    <div class="field"><label>Normativa di riferimento</label>
      <input id="fc-normativa" value="${esc(v.normativa || 'D.Lgs. 09 aprile 2008 n. 81 (Testo Unico Sicurezza)')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="field"><label>Referente</label><input id="fc-refnome" value="${esc(v.referente_nome || '')}"></div>
      <div class="field"><label>Email referente</label><input id="fc-refemail" data-mail="1" data-mail-chi="${esc(v.referente_nome || '')}" value="${esc(v.referente_email || '')}"></div>
      <div class="field"><label>Tel. referente</label><input id="fc-reftel" value="${esc(v.referente_tel || '')}"></div>
    </div>
    <div class="field"><label>Note</label><textarea id="fc-note" rows="2">${esc(v.note || '')}</textarea></div>
    <p class="hint" style="margin:6px 0">Responsabile del progetto formativo: <strong>${esc(conf.responsabile_formativo_nome || '—')}</strong>
      · rappresentante legale: <strong>${esc(conf.presidente_nome || '—')}</strong> (si congelano sul corso alla creazione).</p>
    <button class="btn btn-primary" id="fc-salva" style="margin-top:8px">${c ? 'Salva' : 'Crea il corso'}</button>`);

  collegaDoppioClickMail($('#drawer-body'));

  $('#fc-salva').addEventListener('click', async (ev) => {
    const titolo = $('#fc-titolo').value.trim();
    if (!titolo) return toast('Serve il titolo.', 'err');
    if (!c && !$('#fc-inizio').value) return toast('Serve la data di inizio: un corso ha sempre almeno una giornata.', 'err');
    attendi(ev.currentTarget, true);
    const dati = {
      titolo,
      tipo: $('#fc-tipo').value,
      modalita: $('#fc-modalita').value,
      data_inizio: $('#fc-inizio').value || null,
      data_fine: $('#fc-fine').value || $('#fc-inizio').value || null,
      anno_formativo: $('#fc-inizio').value ? Number($('#fc-inizio').value.slice(0, 4)) : null,
      durata_ore: $('#fc-ore').value ? Number($('#fc-ore').value) : null,
      perc_freq_min: $('#fc-freqmin').value ? Number($('#fc-freqmin').value) : 90,
      sede: $('#fc-sede').value.trim() || null,
      tipo_attestato: $('#fc-tipoatt').value,
      progetto_id: $('#fc-progetto').value ? Number($('#fc-progetto').value) : null,
      rilascio_attestato: $('#fc-rilascio').checked,
      riconosciuto_regione: $('#fc-regione').checked,
      test_previsto: $('#fc-test').checked,
      questionario_previsto: $('#fc-quest').checked,
      validita_txt: $('#fc-validita').value.trim() || null,
      normativa: $('#fc-normativa').value.trim() || null,
      referente_nome: $('#fc-refnome').value.trim() || null,
      referente_email: $('#fc-refemail').value.trim() || null,
      referente_tel: $('#fc-reftel').value.trim() || null,
      note: $('#fc-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    };
    let id = c?.id;
    if (c) {
      const { error } = await sb.from('s_corsi').update(dati).eq('id', c.id);
      if (error) { attendi(ev.currentTarget, false); return toast(error.message, 'err'); }
    } else {
      Object.assign(dati, {
        responsabile_formativo: conf.responsabile_formativo_nome || null,
        rappresentante_legale: conf.presidente_nome || null,
        impresa_id: prefill.impresa_id || null,
        impresa_txt: prefill.impresa_txt || null,
        conferenza_id: prefill.conferenza_id || null,
        stato: 'aperto',
      });
      const { data: nuovo, error } = await sb.from('s_corsi').insert(dati).select('id').single();
      if (error) { attendi(ev.currentTarget, false); return toast(error.message, 'err'); }
      id = nuovo.id;
      // prima giornata dal calendario, se le date ci sono
      if (dati.data_inizio) {
        await sb.from('s_corsi_giornate').insert({ corso_id: id, data: dati.data_inizio, sede: dati.sede });
      }
    }
    attendi(ev.currentTarget, false);
    toast(c ? 'Corso aggiornato.' : 'Corso creato.', 'ok');
    await render();
    apriCorso(id);
  });
}

/* Chiamata dalla pratica di conferenza (conferenze.js). */
export async function nuovoCorsoDaConferenza(p) {
  await carica();
  const esiste = corsi.find((c) => c.conferenza_id === p.id);
  if (esiste) return apriCorso(esiste.id);
  formCorso(null, {
    titolo: `Conferenza di Cantiere "${p.ragione_sociale || ''}"`,
    tipo: 'conferenza_cantiere',
    modalita: 'cantiere',
    data_inizio: p.data_conferenza || '',
    data_fine: p.data_conferenza || '',
    durata_ore: p.ore || 2,
    sede: ['c/o cantiere di', p.ind_cantiere, p.comune_cantiere ? `a ${p.comune_cantiere}` : null].filter(Boolean).join(' ') || null,
    validita_txt: 'Informazione',
    referente_nome: [p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' ') || null,
    referente_tel: p.ref_tel || null,
    referente_email: p.email || null,
    impresa_id: p.impresa_id || null,
    impresa_txt: p.ragione_sociale || null,
    conferenza_id: p.id,
  });
}

/* ══════════ dettaglio corso ══════════ */

export async function apriCorso(id) {
  const c = corsi.find((x) => x.id === id);
  if (!c) return;
  const [{ data: giornate }, { data: interventi }, { data: iscritti }, { data: incarichi }] = await Promise.all([
    sb.from('s_corsi_giornate').select('*').eq('corso_id', id).order('data'),
    sb.from('s_corsi_interventi').select('*').eq('corso_id', id).order('ordine', { ascending: true, nullsFirst: false }).order('id'),
    sb.from('s_corsi_iscritti').select('*').eq('corso_id', id).order('nominativo'),
    sb.from('s_corsi_incarichi').select('*').eq('corso_id', id).order('id'),
  ]);
  const gIds = (giornate || []).map((g) => g.id);
  let pres = [];
  if (gIds.length) {
    const { data } = await sb.from('s_corsi_presenze').select('*').in('giornata_id', gIds);
    pres = data || [];
  }

  const oreTot = c.durata_ore || (giornate || []).reduce((s, g) => s + oreGiornata(g), 0);
  const conAttestato = (iscritti || []).filter((i) => i.attestato_numero).length;

  const rigaG = (g) => `<tr data-g="${g.id}">
    <td>${dataIt(g.data)}</td>
    <td>${[orario(g.dalle), orario(g.alle)].filter(Boolean).join('–')}${g.dalle2 ? ` e ${orario(g.dalle2)}–${orario(g.alle2)}` : ''}</td>
    <td>${esc([g.sede, g.aula].filter(Boolean).join(' · ') || '—')}</td>
    <td style="white-space:nowrap"><a href="#" data-mod-g="${g.id}">modifica</a> · <a href="#" data-del-g="${g.id}">elimina</a></td>
  </tr>`;

  const rigaI = (i) => `<tr data-int="${i.id}">
    <td>${esc(QUALITA[i.qualita] || i.qualita)}</td>
    <td><strong>${esc(i.nominativo)}</strong></td>
    <td>${esc(i.argomenti || i.materia || '—')}</td>
    <td>${[orario(i.dalle), orario(i.alle)].filter(Boolean).join('–') || '—'}</td>
    <td style="white-space:nowrap"><a href="#" data-mod-int="${i.id}">modifica</a> · <a href="#" data-del-int="${i.id}">elimina</a></td>
  </tr>`;

  const rigaIscr = (i) => {
    const okFreq = i.perc_frequenza != null ? i.perc_frequenza >= (c.perc_freq_min || 90) : null;
    return `<tr data-iscr="${i.id}">
      <td><strong>${esc(i.nominativo)}</strong>${i.cf ? `<br><span class="hint">${esc(i.cf)}</span>` : ''}</td>
      <td>${esc(i.impresa_txt || '—')}${i.ruolo ? `<br><span class="hint">${esc([i.ruolo, i.mansione].filter(Boolean).join(' · '))}</span>` : ''}</td>
      <td>${esc(ESITI_ISCR[i.esito] || i.esito)}</td>
      <td>${i.ore_frequentate != null ? `${i.ore_frequentate}h` : '—'}${i.perc_frequenza != null
        ? ` <span class="dt-cella ${okFreq ? 'dt-ok' : 'dt-scaduto'}" style="padding:1px 6px">${Math.round(i.perc_frequenza)}%</span>` : ''}</td>
      <td>${esc(i.valutazione || '—')}</td>
      <td>${i.attestato_numero ? esc(i.attestato_numero) : '—'}</td>
      <td style="white-space:nowrap"><a href="#" data-pres="${i.id}">presenze</a> · <a href="#" data-mod-iscr="${i.id}">modifica</a>${i.attestato_numero ? ` · <a href="#" data-rist="${i.id}" title="Ristampa l'attestato col suo numero (storico compreso), sul modello standard">🖨 attestato</a>` : ''} · <a href="#" data-del-iscr="${i.id}">togli</a></td>
    </tr>`;
  };

  const rigaInc = (k) => `<tr>
    <td><strong>${esc(k.nominativo)}</strong></td>
    <td>${k.ore ?? '—'}</td>
    <td>${k.tariffa_oraria != null ? `€ ${k.tariffa_oraria}` : '—'}</td>
    <td>${k.corrispettivo != null ? `€ ${k.corrispettivo}` : '—'}</td>
    <td>${k.protocollo_out_id ? '✓ prot.' : (k.data_incarico ? dataIt(k.data_incarico) : '—')}</td>
    <td style="white-space:nowrap"><a href="#" data-lett-inc="${k.id}">📄 lettera</a> · <a href="#" data-del-inc="${k.id}">elimina</a></td>
  </tr>`;

  apriDrawer(`${TIPI[c.tipo] || 'Corso'} n° ${c.id} — ${c.titolo}`, '', `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella dt-ok" style="padding:2px 8px">${esc(STATI[c.stato] || c.stato)}</span>
      ${c.riconosciuto_regione ? '<span class="dt-cella dt-ok" style="padding:2px 8px">🔵 riconosciuto Regione</span>' : ''}
      <span class="dt-cella" style="padding:2px 8px">${oreTot || '?'} ore · freq. min ${c.perc_freq_min}%</span>
      <span class="dt-cella" style="padding:2px 8px">${(iscritti || []).length} iscritti${c.rilascio_attestato ? ` · ${conAttestato} attestati` : ''}</span>
      ${c.conferenza_id ? `<span class="dt-cella" style="padding:2px 8px">da conferenza #${c.conferenza_id}</span>` : ''}
      ${c.progetto_id ? `<span class="dt-cella" style="padding:2px 8px">🎯 ${esc((progetti.find((p) => p.id === c.progetto_id) || {}).titolo || 'progetto').slice(0, 40)}</span>` : ''}
    </div>
    <div class="dt-doc-riga">
      <strong>${dataIt(c.data_inizio) || 'date da fissare'}${c.data_fine && c.data_fine !== c.data_inizio ? ` → ${dataIt(c.data_fine)}` : ''}</strong>
      ${c.sede ? ` — ${esc(c.sede)}` : ''}
      · attestato: ${esc(TIPI_ATT[c.tipo_attestato])}
      · resp. formativo: ${esc(c.responsabile_formativo || conf.responsabile_formativo_nome || '—')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px">
      <button class="btn btn-ghost btn-sm" id="co-dati">✏️ Dati del corso</button>
      <div class="field" style="margin:0"><select id="co-stato">${Object.entries(STATI).map(([k, l]) =>
        `<option value="${k}" ${c.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>

    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📅 Giornate <span class="hint">(anche non consecutive)</span></h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Data</th><th>Orario</th><th>Sede · aula</th><th></th></tr></thead>
      <tbody>${(giornate || []).map(rigaG).join('') || '<tr><td colspan="4" class="empty">Nessuna giornata.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" id="co-addg" style="margin-top:6px">+ Giornata</button>

    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">🎙 Programma e docenti</h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Qualità</th><th>Nominativo</th><th>Argomenti</th><th>Orario</th><th></th></tr></thead>
      <tbody>${(interventi || []).map(rigaI).join('') || '<tr><td colspan="5" class="empty">Programma da definire.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" id="co-addint" style="margin-top:6px">+ Intervento / docente</button>

    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">💼 Incarichi di docenza</h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Docente</th><th>Ore</th><th>Tariffa</th><th>Corrispettivo</th><th>Data</th><th></th></tr></thead>
      <tbody>${(incarichi || []).map(rigaInc).join('') || '<tr><td colspan="6" class="empty">Nessun incarico.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" id="co-geninc" style="margin-top:6px">⚙ Proponi incarichi dai docenti del programma</button>

    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">👥 Iscritti</h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Partecipante</th><th>Impresa (al corso)</th><th>Esito</th><th>Frequenza</th><th>Test</th><th>Attestato</th><th></th></tr></thead>
      <tbody>${(iscritti || []).map(rigaIscr).join('') || '<tr><td colspan="7" class="empty">Nessun iscritto.</td></tr>'}</tbody>
    </table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <button class="btn btn-ghost btn-sm" id="co-addiscr">+ Iscrivi dall'anagrafica</button>
      <button class="btn btn-ghost btn-sm" id="co-calcola">🧮 Calcola frequenze dalle presenze</button>
    </div>

    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📄 Documenti del corso</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" id="co-registro">📋 Registro presenze (PDF)</button>
      ${c.rilascio_attestato ? `<button class="btn btn-primary btn-sm" id="co-attestati">🎓 Genera attestati (serie N/${(c.data_fine || c.data_inizio || oggiIso()).slice(0, 4)})</button>` : ''}
    </div>
    <p class="hint" style="margin-top:8px">L'impresa dell'iscritto è uno <strong>snapshot al momento del corso</strong>,
      proposta dal rapporto attivo in anagrafica: se la persona cambia datore dopo, l'attestato resta giusto.
      Gli attestati prendono la <strong>serie dedicata N/anno</strong>, finiscono in
      <code>2_AREE/Formazione/attestati_emessi/&lt;anno&gt;/</code> su Drive e il numero resta sulla riga dell'iscritto.
      ${c.riconosciuto_regione ? 'Corso riconosciuto: il logo Regione va sull\'attestato (img/logo-regione.png).' : 'Il logo Regione NON va su questo attestato (corso non riconosciuto).'}
      La lettera di incarico si genera dalla riga dell'incarico (protocollo OUT nel registro unico).</p>
  `);
  $('#drawer').classList.add('drawer-xl');   /* scheda larga: qui vivono tabelle vere */

  /* ── eventi ── */
  $('#co-dati').addEventListener('click', () => formCorso(c));
  $('#co-stato').addEventListener('change', async (e) => {
    const { error } = await sb.from('s_corsi').update({ stato: e.target.value, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) return toast(error.message, 'err');
    toast('Stato aggiornato.', 'ok');
    await render();
  });

  $('#co-addg').addEventListener('click', () => formGiornata(c, null));
  $('#drawer-body').querySelectorAll('[data-mod-g]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formGiornata(c, (giornate || []).find((g) => g.id === Number(a.dataset.modG)));
  }));
  $('#drawer-body').querySelectorAll('[data-del-g]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Elimino la giornata (con le sue presenze)?')) return;
    await sb.from('s_corsi_giornate').delete().eq('id', Number(a.dataset.delG));
    apriCorso(c.id);
  }));

  $('#co-addint').addEventListener('click', () => formIntervento(c, giornate || [], null));
  $('#drawer-body').querySelectorAll('[data-mod-int]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formIntervento(c, giornate || [], (interventi || []).find((x) => x.id === Number(a.dataset.modInt)));
  }));
  $('#drawer-body').querySelectorAll('[data-del-int]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.from('s_corsi_interventi').delete().eq('id', Number(a.dataset.delInt));
    apriCorso(c.id);
  }));

  $('#co-geninc').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    await proponiIncarichi(c, interventi || [], incarichi || []);
    attendi(ev.currentTarget, false);
    apriCorso(c.id);
  });
  $('#drawer-body').querySelectorAll('[data-del-inc]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    await sb.from('s_corsi_incarichi').delete().eq('id', Number(a.dataset.delInc));
    apriCorso(c.id);
  }));

  $('#co-addiscr').addEventListener('click', () => formIscritto(c, null));
  $('#drawer-body').querySelectorAll('[data-mod-iscr]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formIscritto(c, (iscritti || []).find((x) => x.id === Number(a.dataset.modIscr)));
  }));
  $('#drawer-body').querySelectorAll('[data-del-iscr]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Tolgo l\'iscritto dal corso?')) return;
    await sb.from('s_corsi_iscritti').delete().eq('id', Number(a.dataset.delIscr));
    apriCorso(c.id);
  }));
  $('#drawer-body').querySelectorAll('[data-pres]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const i = (iscritti || []).find((x) => x.id === Number(a.dataset.pres));
    formPresenze(c, i, giornate || [], pres.filter((r) => r.iscritto_id === i.id));
  }));
  $('#drawer-body').querySelectorAll('[data-rist]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const i = (iscritti || []).find((x) => x.id === Number(a.dataset.rist));
    if (i) await ristampaAttestato(c, i, giornate || [], interventi || []);
  }));

  $('#co-calcola').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Calcolo…');
    await calcolaFrequenze(c, giornate || [], iscritti || [], pres);
    attendi(ev.currentTarget, false);
    toast('Frequenze ricalcolate.', 'ok');
    apriCorso(c.id);
  });

  $('#co-registro').addEventListener('click', async (ev) => {
    if (!(giornate || []).length) return toast('Un corso ha sempre almeno una giornata: aggiungila prima del registro.', 'err');
    attendi(ev.currentTarget, true, 'Genero…');
    try {
      const { pdfRegistro, scaricaPdf } = await import('./corsi-doc.js');
      const byte = await pdfRegistro(c, giornate || [], interventi || [], iscritti || [], conf);
      scaricaPdf(byte, `${(c.data_inizio || oggiIso()).replace(/-/g, '')}_Registro_corso-${c.id}.pdf`);
      toast('Registro scaricato: stamparlo per le firme in aula/cantiere.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    attendi(ev.currentTarget, false);
  });
  $('#co-attestati')?.addEventListener('click', (ev) =>
    generaAttestati(c, giornate || [], interventi || [], iscritti || [], ev.currentTarget));
  $('#drawer-body').querySelectorAll('[data-lett-inc]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const k = (incarichi || []).find((x) => x.id === Number(a.dataset.lettInc));
    if (k) letteraIncarico(c, k, interventi || [], giornate || []);
  }));
}

/* ── ATTESTATI: serie N/aaaa + PDF + deposito su Drive ──
   Prende gli iscritti PRESENTI dei corsi con rilascio: chi non ha
   ancora un numero lo riceve (progressivo dell'anno), chi ha già
   un numero della serie nuova ma non il PDF viene rigenerato.
   Gli attestati storici (numero senza /) non si toccano. */
async function generaAttestati(c, giornate, interventi, iscritti, btn) {
  if (!giornate.length) return toast('Un corso ha sempre almeno una giornata: aggiungila prima degli attestati.', 'err');
  const anno = (c.data_fine || c.data_inizio || oggiIso()).slice(0, 4);
  const candidati = iscritti.filter((i) =>
    ['presente', 'presente_online'].includes(i.esito) && i.ammesso !== false &&
    (!i.attestato_numero || (i.attestato_numero.includes('/') && !i.attestato_drive_id)));
  if (!candidati.length) return toast('Nessun iscritto da attestare (servono presenti senza attestato).', 'err');
  if (!confirm(`Genero ${candidati.length} attestati (serie N/${anno}, tipo «${TIPI_ATT[c.tipo_attestato]}»), li deposito su Drive in attestati_emessi/${anno} e scrivo i numeri sulle righe. Procedo?`)) return;
  attendi(btn, true, 'Genero…');
  try {
    const { pdfAttestato, scaricaPdf } = await import('./corsi-doc.js');

    /* firma del responsabile + logo Regione (solo riconosciuti) */
    let firmaByte = null;
    if (conf.responsabile_formativo_firma_id) {
      try { firmaByte = await leggiByte(conf.responsabile_formativo_firma_id); } catch { /* senza firma */ }
    }
    let logoRegioneByte = null;
    if (c.riconosciuto_regione) {
      try { logoRegioneByte = new Uint8Array(await (await fetch('img/logo-regione.png')).arrayBuffer()); }
      catch { toast('img/logo-regione.png non trovato: attestati senza logo Regione.', 'err'); }
    }

    /* progressivo dell'anno sulla serie nuova */
    const { data: numeri } = await sb.from('s_corsi_iscritti')
      .select('attestato_numero').like('attestato_numero', `%/${anno}`);
    let prossimo = Math.max(0, ...(numeri || [])
      .map((r) => Number((r.attestato_numero || '').split('/')[0]))
      .filter((n) => Number.isFinite(n))) + 1;

    /* anagrafiche per luogo/data di nascita */
    const ids = [...new Set(candidati.map((i) => i.persona_id).filter(Boolean))];
    const anag = {};
    if (ids.length) {
      const { data } = await sb.from('persone')
        .select('persona_id, comune_nascita, data_nascita').in('persona_id', ids);
      for (const p of data || []) anag[p.persona_id] = { nato_luogo: p.comune_nascita, nato_il: p.data_nascita };
    }

    const cart = await risolviCartella(`2_AREE/Formazione/attestati_emessi/${anno}`);
    const oggi = oggiIso();
    let fatti = 0;
    for (const i of candidati) {
      const numero = i.attestato_numero?.includes('/') ? i.attestato_numero : `${prossimo++}/${anno}`;
      const byte = await pdfAttestato(c, i, anag[i.persona_id], giornate, interventi, {
        numero, firmaByte, firmaNome: c.responsabile_formativo || conf.responsabile_formativo_nome,
        logoRegioneByte, loghiExtra: [], dataRilascio: oggi,
      });
      const nome = `${(c.data_fine || c.data_inizio || oggi)}_Attestato_${i.nominativo}${i.cf ? `_${i.cf}` : ''}_Prot_${numero.replace('/', '-')}.pdf`;
      const agg = { attestato_numero: numero, attestato_data: oggi, updated_at: new Date().toISOString() };
      if (cart.id) {
        const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
          body: { action: 'upload', filename: nome, mime_type: 'application/pdf',
            base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
        });
        if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));
        agg.attestato_drive_id = su.drive_file_id;
        agg.attestato_drive_url = su.drive_url;
      } else {
        scaricaPdf(byte, nome);   /* cartella dell'anno non ancora su Drive: almeno in locale */
      }
      const { error } = await sb.from('s_corsi_iscritti').update(agg).eq('id', i.id);
      if (error) throw new Error(error.message);
      fatti += 1;
    }
    toast(`${fatti} attestati generati${cart.id ? ` e depositati in attestati_emessi/${anno}` : ' (scaricati in locale: crea la cartella dell\'anno su Drive)'}.`, 'ok');
    await render();
    apriCorso(c.id);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ── RISTAMPA di un attestato già numerato (storico compreso):
      stesso modello standard, il numero resta quello suo — per lo
      storico è il «Prot.» dell'Access. Solo scarico locale, non
      tocca Drive né la riga. ── */
async function ristampaAttestato(c, i, giornate, interventi) {
  try {
    const { pdfAttestato, scaricaPdf } = await import('./corsi-doc.js');
    let firmaByte = null;
    if (conf.responsabile_formativo_firma_id) {
      try { firmaByte = await leggiByte(conf.responsabile_formativo_firma_id); } catch { /* senza firma */ }
    }
    let logoRegioneByte = null;
    if (c.riconosciuto_regione) {
      try { logoRegioneByte = new Uint8Array(await (await fetch('img/logo-regione.png')).arrayBuffer()); } catch { /* senza logo */ }
    }
    let anagrafica = null;
    if (i.persona_id) {
      const { data: p } = await sb.from('persone')
        .select('comune_nascita, data_nascita').eq('persona_id', i.persona_id).maybeSingle();
      if (p) anagrafica = { nato_luogo: p.comune_nascita, nato_il: p.data_nascita };
    }
    const byte = await pdfAttestato(c, i, anagrafica, giornate, interventi, {
      numero: i.attestato_numero,
      firmaByte, firmaNome: c.responsabile_formativo || conf.responsabile_formativo_nome,
      logoRegioneByte, loghiExtra: [],
      dataRilascio: i.attestato_data || c.data_fine || c.data_inizio,
    });
    const numeroFile = String(i.attestato_numero).replace('/', '-');
    scaricaPdf(byte, `${(c.data_fine || c.data_inizio || oggiIso())}_Attestato_${i.nominativo}${i.cf ? `_${i.cf}` : ''}_Prot_${numeroFile}.pdf`);
    toast(`Attestato ${i.attestato_numero} ristampato (modello standard).`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ── LETTERA DI INCARICO: protocollo OUT + PDF + bozza .eml ── */
async function letteraIncarico(c, k, interventi, giornate) {
  if (!confirm(`Genero la lettera di incarico per ${k.nominativo} (${k.ore ?? '?'} ore a € ${k.tariffa_oraria ?? '?'}/h), protocollata in uscita nel registro unico. Procedo?`)) return;
  try {
    const giornataDi = Object.fromEntries(giornate.map((g) => [g.id, g.data]));
    const miei = interventi
      .filter((x) => (k.persona_id && x.persona_id === k.persona_id) || x.nominativo === k.nominativo)
      .map((x) => ({ ...x, giornata_data: giornataDi[x.giornata_id] || null }));

    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggiIso(),
      data_doc: k.data_incarico || oggiIso(),
      persona: k.nominativo,
      oggetto: `Lettera di incarico per attività di docenza — ${c.titolo}`,
      sintesi: `Incarico docenza corso n° ${c.id} (${TIPI[c.tipo] || c.tipo}): ${k.ore ?? '?'} ore a € ${k.tariffa_oraria ?? '?'}/h${k.corrispettivo ? `, corrispettivo € ${k.corrispettivo}` : ''}.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_txt: 'Lettera di incarico docenza',
      cartella: `2_AREE/Formazione`,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    let firmaByte = null;
    if (conf.presidente_firma_id) {
      try { firmaByte = await leggiByte(conf.presidente_firma_id); } catch { /* firma a mano */ }
    }
    let anagDoc = null;
    let emailDoc = '';
    if (k.persona_id) {
      const { data: p } = await sb.from('persone')
        .select('comune_nascita, data_nascita, cf, email').eq('persona_id', k.persona_id).maybeSingle();
      if (p) { anagDoc = { nato_luogo: p.comune_nascita, nato_il: p.data_nascita, cf: p.cf }; emailDoc = p.email || ''; }
    }

    const { pdfLetteraIncarico, scaricaPdf } = await import('./corsi-doc.js');
    const byte = await pdfLetteraIncarico(c, k, miei, conf, codiceProtocollo(nuovo), firmaByte, anagDoc);
    const nome = `${oggiIso().replace(/-/g, '_')}_INC_${k.nominativo}_docenza-corso-${c.id}.pdf`;
    scaricaPdf(byte, nome);

    /* deposito su Drive nella cartella del protocollo + aggancio */
    try {
      const cart = await risolviCartella('2_AREE/Formazione');
      if (cart.id) {
        const su = await caricaByte(nuovo, nome, byte, 'application/pdf', cart.id);
        await sb.from('s_prot_allegati').insert({
          protocollo_id: nuovo.id, nome: su.file_name || nome, mime: 'application/pdf',
          dimensione: byte.length, principale: true, created_by: state.email,
          drive_file_id: su.drive_file_id, drive_url: su.drive_url,
        });
      }
    } catch { /* il PDF locale c'è comunque */ }

    await sb.from('s_corsi_incarichi').update({
      protocollo_out_id: nuovo.id, data_incarico: k.data_incarico || oggiIso(),
    }).eq('id', k.id);

    scaricaEml({
      to: emailDoc,
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Lettera di incarico docenza ${codiceProtocollo(nuovo)} - ${c.titolo}`,
      corpo: `Egr. ${k.nominativo},

in allegato la lettera di incarico per l'attività di docenza in oggetto (${k.ore ?? '?'} ore). La preghiamo di restituirla firmata per accettazione.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome, byte }],
      nomeFile: `incarico-docenza-corso-${c.id}-${k.id}.eml`,
    });
    toast(`Lettera protocollata ${codiceProtocollo(nuovo)}: PDF e bozza mail scaricati.`, 'ok');
    apriCorso(c.id);
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── giornata ── */
function formGiornata(c, g) {
  apriDrawer(g ? `Giornata del ${dataIt(g.data)}` : `Nuova giornata — corso n° ${c.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Data *</label><input type="date" id="fg-data" value="${g?.data || c.data_inizio || ''}"></div>
      <div class="field"><label>Aula</label><input id="fg-aula" value="${esc(g?.aula || (c.modalita === 'cantiere' ? 'c/o cantiere' : ''))}"></div>
      <div class="field"><label>Mattino dalle</label><input type="time" id="fg-dalle" value="${orario(g?.dalle)}"></div>
      <div class="field"><label>alle</label><input type="time" id="fg-alle" value="${orario(g?.alle)}"></div>
      <div class="field"><label>Pomeriggio dalle</label><input type="time" id="fg-dalle2" value="${orario(g?.dalle2)}"></div>
      <div class="field"><label>alle</label><input type="time" id="fg-alle2" value="${orario(g?.alle2)}"></div>
    </div>
    <div class="field"><label>Sede (se diversa dal corso)</label><input id="fg-sede" value="${esc(g?.sede || c.sede || '')}"></div>
    <button class="btn btn-primary" id="fg-salva" style="margin-top:10px">${g ? 'Salva' : 'Aggiungi'}</button>`);
  $('#fg-salva').addEventListener('click', async (ev) => {
    if (!$('#fg-data').value) return toast('Serve la data.', 'err');
    attendi(ev.currentTarget, true);
    const dati = {
      data: $('#fg-data').value,
      dalle: $('#fg-dalle').value || null, alle: $('#fg-alle').value || null,
      dalle2: $('#fg-dalle2').value || null, alle2: $('#fg-alle2').value || null,
      sede: $('#fg-sede').value.trim() || null, aula: $('#fg-aula').value.trim() || null,
    };
    const { error } = g
      ? await sb.from('s_corsi_giornate').update(dati).eq('id', g.id)
      : await sb.from('s_corsi_giornate').insert({ ...dati, corso_id: c.id });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    apriCorso(c.id);
  });
}

/* ── intervento docente, con ricerca in anagrafica ── */
function formIntervento(c, giornate, i) {
  apriDrawer(i ? 'Modifica intervento' : `Nuovo intervento — corso n° ${c.id}`, '', `
    <div class="field"><label>Docente / relatore — cerca in anagrafica</label>
      <input id="fi-cerca" placeholder="cognome, nome o CF…" value="">
      <div id="fi-risultati"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Nominativo *</label><input id="fi-nome" value="${esc(i?.nominativo || '')}"></div>
      <div class="field"><label>Qualità</label>
        <select id="fi-qualita">${Object.entries(QUALITA).map(([k, l]) =>
          `<option value="${k}" ${(i?.qualita || 'docente') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Giornata</label>
        <select id="fi-giornata"><option value="">—</option>${giornate.map((g) =>
          `<option value="${g.id}" ${i?.giornata_id === g.id ? 'selected' : ''}>${dataIt(g.data)}</option>`).join('')}</select></div>
      <div class="field"><label>Materia</label><input id="fi-materia" value="${esc(i?.materia || 'Salute e sicurezza sul lavoro')}"></div>
      <div class="field"><label>Dalle</label><input type="time" id="fi-dalle" value="${orario(i?.dalle)}"></div>
      <div class="field"><label>Alle</label><input type="time" id="fi-alle" value="${orario(i?.alle)}"></div>
    </div>
    <div class="field"><label>Argomenti trattati</label><textarea id="fi-argomenti" rows="2">${esc(i?.argomenti || '')}</textarea></div>
    <button class="btn btn-primary" id="fi-salva" style="margin-top:10px">${i ? 'Salva' : 'Aggiungi'}</button>`);

  let personaId = i?.persona_id || null;
  collegaRicercaPersone('#fi-cerca', '#fi-risultati', (p) => {
    personaId = p.persona_id;
    $('#fi-nome').value = [p.cognome, p.titolo, p.nome].filter(Boolean).join(' ');
    $('#fi-risultati').innerHTML = `<p class="hint">agganciato all'anagrafica ✓</p>`;
  });

  $('#fi-salva').addEventListener('click', async (ev) => {
    const nome = $('#fi-nome').value.trim();
    if (!nome) return toast('Serve il nominativo.', 'err');
    attendi(ev.currentTarget, true);
    const dati = {
      qualita: $('#fi-qualita').value,
      persona_id: personaId,
      nominativo: nome,
      giornata_id: $('#fi-giornata').value ? Number($('#fi-giornata').value) : null,
      materia: $('#fi-materia').value.trim() || null,
      argomenti: $('#fi-argomenti').value.trim() || null,
      dalle: $('#fi-dalle').value || null,
      alle: $('#fi-alle').value || null,
    };
    const { error } = i
      ? await sb.from('s_corsi_interventi').update(dati).eq('id', i.id)
      : await sb.from('s_corsi_interventi').insert({ ...dati, corso_id: c.id });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    apriCorso(c.id);
  });
}

/* ── incarichi proposti dal programma: ore sommate, tariffa dal
      contratto del tecnico se c'è, altrimenti quella di default ── */
async function proponiIncarichi(c, interventi, esistenti) {
  const docenti = new Map();
  for (const i of interventi) {
    if (!['docente', 'codocente'].includes(i.qualita)) continue;
    const k = i.persona_id || i.nominativo;
    const d = docenti.get(k) || { persona_id: i.persona_id, nominativo: i.nominativo, ore: 0 };
    d.ore += oreDa(i.dalle, i.alle);
    docenti.set(k, d);
  }
  const giaFatti = new Set(esistenti.map((k) => k.persona_id || k.nominativo));
  const def = Number(conf.docenza_tariffa_default || 65);
  let creati = 0;
  for (const d of docenti.values()) {
    if (giaFatti.has(d.persona_id || d.nominativo)) continue;
    let tariffa = def;
    if (d.persona_id) {
      const { data: p } = await sb.from('persone').select('email').eq('persona_id', d.persona_id).maybeSingle();
      if (p?.email) {
        const { data: t } = await sb.from('tecnici').select('tariffa_docenza').eq('email', p.email).maybeSingle();
        if (t?.tariffa_docenza) tariffa = Number(t.tariffa_docenza);
      }
    }
    const ore = d.ore || null;
    await sb.from('s_corsi_incarichi').insert({
      corso_id: c.id, persona_id: d.persona_id, nominativo: d.nominativo,
      ore, tariffa_oraria: tariffa,
      corrispettivo: ore ? Math.round(ore * tariffa * 100) / 100 : null,
      data_incarico: oggiIso(),
    });
    creati += 1;
  }
  toast(creati ? `${creati} incarichi proposti (tariffa dal contratto o € ${def}/h): controlla e correggi se serve.` : 'Nessun docente nuovo nel programma.', 'ok');
}

/* ── iscritto: persona dall'anagrafica, impresa proposta dal
      rapporto attivo alla data del corso (snapshot sulla riga) ── */
function formIscritto(c, i) {
  apriDrawer(i ? `Iscritto — ${i.nominativo}` : `Iscrivi al corso n° ${c.id}`, '', `
    ${i ? '' : `<div class="field"><label>Cerca in anagrafica *</label>
      <input id="fp-cerca" placeholder="cognome, nome o CF…">
      <div id="fp-risultati"></div></div>`}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Nominativo *</label><input id="fp-nome" value="${esc(i?.nominativo || '')}" ${i ? '' : 'readonly'}></div>
      <div class="field"><label>Codice fiscale</label><input id="fp-cf" value="${esc(i?.cf || '')}" readonly></div>
    </div>
    <div class="field"><label>Impresa (snapshot al corso)</label>
      <input id="fp-impresa" value="${esc(i?.impresa_txt || '')}">
      <div id="fp-impresa-hint" class="hint"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>In qualità di</label>
        <select id="fp-ruolo">${RUOLI_AZ.map((r) => `<option ${((i?.ruolo || 'DIPENDENTE') === r) ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>Mansione</label><input id="fp-mansione" value="${esc(i?.mansione || '')}"></div>
      <div class="field"><label>Esito</label>
        <select id="fp-esito">${Object.entries(ESITI_ISCR).map(([k, l]) =>
          `<option value="${k}" ${(i?.esito || 'in_attesa') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Valutazione test</label><input id="fp-val" value="${esc(i?.valutazione || '')}" placeholder="es. 28/30"></div>
    </div>
    <div class="field"><label>Email (per l'invio dell'attestato)</label><input id="fp-email" data-mail="1" data-mail-chi="${esc(i?.nominativo || '')}" value="${esc(i?.email_iscrizione || '')}"></div>
    <button class="btn btn-primary" id="fp-salva" style="margin-top:10px" ${i ? '' : 'disabled'}>${i ? 'Salva' : 'Iscrivi'}</button>`);

  collegaDoppioClickMail($('#drawer-body'));

  let personaId = i?.persona_id || null;
  let impresaId = i?.impresa_id || null;

  if (!i) {
    collegaRicercaPersone('#fp-cerca', '#fp-risultati', async (p) => {
      personaId = p.persona_id;
      $('#fp-nome').value = [p.cognome, p.titolo, p.nome].filter(Boolean).join(' ');
      $('#fp-cf').value = p.cf || '';
      $('#fp-email').value = $('#fp-email').value || p.email || '';
      $('#fp-email').dataset.mailChi = $('#fp-nome').value;
      $('#fp-salva').disabled = false;
      $('#fp-risultati').innerHTML = '<p class="hint">agganciato all\'anagrafica ✓</p>';
      // impresa dal rapporto attivo alla data del corso
      const rif = c.data_inizio || oggiIso();
      const { data: rapporti } = await sb.from('persone_imprese')
        .select('impresa_id, mansione, qualifica, data_assunzione, data_cessazione')
        .eq('persona_id', p.persona_id);
      const attivi = (rapporti || [])
        .filter((r) => !r.data_cessazione || r.data_cessazione >= rif)
        .sort((a, b) => String(b.data_assunzione || '').localeCompare(String(a.data_assunzione || '')));
      if (attivi.length) {
        const r = attivi[0];
        impresaId = r.impresa_id;
        const { data: imp } = await sb.from('imprese').select('impresa_nome').eq('impresa_id', r.impresa_id).maybeSingle();
        $('#fp-impresa').value = imp?.impresa_nome || r.impresa_id;
        if (r.mansione || r.qualifica) $('#fp-mansione').value = r.mansione || r.qualifica;
        $('#fp-impresa-hint').textContent = `proposta dal rapporto attivo al ${dataIt(rif)}${attivi.length > 1 ? ` (${attivi.length} rapporti attivi: controlla)` : ''} — correggibile`;
      } else {
        $('#fp-impresa-hint').textContent = 'nessun rapporto attivo in anagrafica alla data del corso: scrivi l\'impresa a mano (e valuta di registrare il rapporto).';
      }
    });
  }

  $('#fp-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const dati = {
      nominativo: $('#fp-nome').value.trim(),
      cf: $('#fp-cf').value.trim() || null,
      impresa_id: impresaId,
      impresa_txt: $('#fp-impresa').value.trim() || null,
      ruolo: $('#fp-ruolo').value,
      mansione: $('#fp-mansione').value.trim() || null,
      esito: $('#fp-esito').value,
      valutazione: $('#fp-val').value.trim() || null,
      email_iscrizione: $('#fp-email').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = i
      ? await sb.from('s_corsi_iscritti').update(dati).eq('id', i.id)
      : await sb.from('s_corsi_iscritti').insert({ ...dati, corso_id: c.id, persona_id: personaId, data_iscrizione: oggiIso() });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    apriCorso(c.id);
  });
}

/* ── presenze per giornata di un iscritto ── */
function formPresenze(c, iscritto, giornate, righe) {
  const perG = Object.fromEntries(righe.map((r) => [r.giornata_id, r]));
  apriDrawer(`Presenze — ${iscritto.nominativo}`, '', `
    ${giornate.map((g) => {
      const r = perG[g.id] || {};
      return `<div style="border:1px solid var(--bordo);border-radius:8px;padding:8px;margin-bottom:8px" data-g="${g.id}">
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <input type="checkbox" class="pr-pres" ${r.presente !== false ? 'checked' : ''}>
          <strong>${dataIt(g.data)}</strong>
          <span class="hint">${[orario(g.dalle), orario(g.alle)].filter(Boolean).join('–')}${g.dalle2 ? ` e ${orario(g.dalle2)}–${orario(g.alle2)}` : ''}</span>
        </label>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
          <div class="field"><label>Ingresso</label><input type="time" class="pr-i1" value="${orario(r.ingresso1) || orario(g.dalle)}"></div>
          <div class="field"><label>Uscita</label><input type="time" class="pr-u1" value="${orario(r.uscita1) || orario(g.alle)}"></div>
          <div class="field"><label>Ingr. pom.</label><input type="time" class="pr-i2" value="${orario(r.ingresso2) || orario(g.dalle2)}"></div>
          <div class="field"><label>Usc. pom.</label><input type="time" class="pr-u2" value="${orario(r.uscita2) || orario(g.alle2)}"></div>
        </div>
      </div>`;
    }).join('') || '<p class="empty">Prima aggiungi le giornate del corso.</p>'}
    <button class="btn btn-primary" id="pr-salva">Salva le presenze</button>`);

  $('#pr-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    for (const blocco of $('#drawer-body').querySelectorAll('[data-g]')) {
      const gid = Number(blocco.dataset.g);
      const dati = {
        iscritto_id: iscritto.id, giornata_id: gid,
        presente: blocco.querySelector('.pr-pres').checked,
        ingresso1: blocco.querySelector('.pr-i1').value || null,
        uscita1: blocco.querySelector('.pr-u1').value || null,
        ingresso2: blocco.querySelector('.pr-i2').value || null,
        uscita2: blocco.querySelector('.pr-u2').value || null,
      };
      dati.ore = dati.presente ? oreDa(dati.ingresso1, dati.uscita1) + oreDa(dati.ingresso2, dati.uscita2) : 0;
      await sb.from('s_corsi_presenze').upsert(dati, { onConflict: 'iscritto_id,giornata_id' });
    }
    attendi(ev.currentTarget, false);
    toast('Presenze salvate.', 'ok');
    apriCorso(c.id);
  });
}

/* ── ore frequentate vs durata → % e ammissione ── */
async function calcolaFrequenze(c, giornate, iscritti, pres) {
  const oreTot = c.durata_ore || giornate.reduce((s, g) => s + oreGiornata(g), 0);
  for (const i of iscritti) {
    const mie = pres.filter((r) => r.iscritto_id === i.id);
    if (!mie.length && i.esito === 'in_attesa') continue;   // niente da calcolare
    const ore = mie.reduce((s, r) => s + Number(r.ore || 0), 0);
    const perc = oreTot ? Math.min(100, (ore / oreTot) * 100) : null;
    const dati = { ore_frequentate: Math.round(ore * 100) / 100, perc_frequenza: perc != null ? Math.round(perc * 10) / 10 : null, updated_at: new Date().toISOString() };
    if (perc != null && ['in_attesa', 'presente', 'freq_insufficiente'].includes(i.esito)) {
      dati.esito = perc >= (c.perc_freq_min || 90) ? 'presente' : 'freq_insufficiente';
    }
    await sb.from('s_corsi_iscritti').update(dati).eq('id', i.id);
  }
}

/* ── ricerca condivisa in anagrafica persone ── */

/* ══════════ progetti finanziati ══════════ */

function vistaProgetti() {
  apriDrawer('Progetti finanziati (rendicontazione)', '', `
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Titolo</th><th>Anno sanzioni</th><th>Ente</th><th>Finanziamento</th><th>Stato</th><th></th></tr></thead>
      <tbody>${progetti.map((p) => `<tr>
        <td><strong>${esc(p.titolo.slice(0, 50))}</strong></td>
        <td>${esc(p.anno_sanzioni || '—')}</td>
        <td>${esc(p.ente_finanziatore || '—')}</td>
        <td>${p.finanziamento != null ? `€ ${p.finanziamento}` : '—'}</td>
        <td>${esc(p.stato)}</td>
        <td><a href="#" data-mod-p="${p.id}">modifica</a> ·
            <a href="#" data-rend-p="${p.id}">📊 rendicontazione</a></td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">Nessun progetto.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-primary btn-sm" id="pg-nuovo" style="margin-top:8px">+ Nuovo progetto</button>
    <p class="hint" style="margin-top:8px">I corsi si collegano al progetto dalla loro scheda; le prestazioni dei
      tecnici dal campo progetto della prestazione. La rendicontazione somma le due cose — attivita dei tecnici e
      docenze — come il report del vecchio gestionale (per i progetti SPISAL vale il periodo delle sanzioni).</p>`);
  $('#pg-nuovo').addEventListener('click', () => formProgetto(null));
  $('#drawer-body').querySelectorAll('[data-mod-p]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formProgetto(progetti.find((p) => p.id === Number(a.dataset.modP)));
  }));
  $('#drawer-body').querySelectorAll('[data-rend-p]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    rendicontazione(progetti.find((p) => p.id === Number(a.dataset.rendP)));
  }));
}

/* ── rendicontazione di un progetto ──
   Due popolazioni distinte, come nel report Access: le prestazioni
   dei tecnici (s_prestazioni.progetto_id) e le docenze dei corsi
   collegati (s_corsi_incarichi). Non si sommano a occhio: il
   quadro le tiene separate e somma in fondo. */
async function rendicontazione(p) {
  if (!p) return;
  apriDrawer(`Rendicontazione — ${p.desc_breve || p.titolo.slice(0, 40)}`, '',
    '<p class="hint">Raccolgo prestazioni e docenze…</p>');

  const corsiDelProgetto = corsi.filter((c) => c.progetto_id === p.id);
  const ids = corsiDelProgetto.map((c) => c.id);
  const [{ data: prest }, { data: inc }, { data: fisc }, { data: tec }] = await Promise.all([
    sb.from('s_prestazioni')
      .select('*, s_fatture_tecnici(numero)')
      .eq('progetto_id', p.id).order('data'),
    ids.length
      ? sb.from('s_corsi_incarichi').select('*').in('corso_id', ids).order('corso_id')
      : Promise.resolve({ data: [] }),
    sb.from('s_tecnici_fiscale').select('*'),
    sb.from('tecnici').select('tecnico_id, tecnico_cognome'),
  ]);

  const prestazioni = (prest || []).map((r) => ({
    ...r,
    fattura_numero: r.s_fatture_tecnici?.numero || null,
    /* la nota porta davanti la provenienza Access («Access T_Soft id»,
       «Access 0T id»): in stampa serve quello che ha scritto il
       tecnico, non l'id della riga da cui e' stata importata */
    nota_breve: String(r.note || '').split('; ').filter((s) => s
      && !/^Access /.test(s) && !/^fattura Access/.test(s) && !/^doc: /.test(s)).join('; ') || null,
  }));
  /* il numero di protocollo della lettera non e' sulla riga: protocollo_out_id
     punta a s_protocollo (nessuna FK dichiarata, quindi niente embed) e sul
     report va il NUMERO del registro, non l'id della riga. */
  const incarichi = inc || [];
  const protIds = [...new Set(incarichi.map((i) => i.protocollo_out_id).filter(Boolean))];
  if (protIds.length) {
    const { data: prot } = await sb.from('s_protocollo')
      .select('id, numero, direzione, esercizio, codice').in('id', protIds);
    const di = Object.fromEntries((prot || []).map((x) => [x.id, x]));
    for (const i of incarichi) {
      i.protocollo_numero = i.protocollo_out_id ? codiceProtocollo(di[i.protocollo_out_id]) || null : null;
    }
  }

  const somma = (arr, campo) => arr.reduce((t, x) => t + Number(x[campo] || 0), 0);
  const nettoP = somma(prestazioni, 'importo');
  const nettoD = somma(incarichi, 'corrispettivo');
  const perTipo = {};
  for (const r of prestazioni) perTipo[r.tipo] = (perTipo[r.tipo] || 0) + 1;
  const eur = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  apriDrawer(`Rendicontazione — ${p.desc_breve || p.titolo.slice(0, 40)}`, '', `
    <p style="margin:0 0 10px"><strong>${esc(p.titolo)}</strong><br>
      <span class="hint">${[p.delibera_num ? `delibera ${esc(p.delibera_num)}` : null,
        p.anno_sanzioni ? `sanzioni ${esc(p.anno_sanzioni)}` : null,
        p.ente_finanziatore ? esc(p.ente_finanziatore) : null].filter(Boolean).join(' · ')}</span></p>
    <div class="table-wrap"><table class="tbl">
      <tbody>
        <tr><td>Attivita dei tecnici</td><td>${prestazioni.length} prestazioni</td>
            <td style="text-align:right"><strong>€ ${eur(nettoP)}</strong></td></tr>
        <tr><td>Docenze (lettere di incarico)</td><td>${incarichi.length} su ${corsiDelProgetto.length} corsi</td>
            <td style="text-align:right"><strong>€ ${eur(nettoD)}</strong></td></tr>
        <tr><td colspan="2"><strong>Totale imponibile</strong></td>
            <td style="text-align:right"><strong>€ ${eur(nettoP + nettoD)}</strong></td></tr>
        ${p.finanziamento ? `<tr><td colspan="2">Finanziamento ammesso</td>
            <td style="text-align:right">€ ${eur(p.finanziamento)}</td></tr>` : ''}
      </tbody>
    </table></div>
    <p class="hint" style="margin-top:8px">${Object.entries(perTipo)
      .map(([k, n]) => `${esc(k.replace(/_/g, ' '))}: ${n}`).join(' · ') || 'Nessuna prestazione collegata.'}</p>
    <button class="btn btn-primary" id="rd-pdf" style="margin-top:10px">📄 Rendicontazione in PDF</button>
    <p class="hint" style="margin-top:8px">Il PDF ricalca il report del vecchio gestionale: prima le attivita dei
      tecnici riga per riga con la fattura che le ha pagate, poi le docenze raggruppate per corso, e in fondo il
      costo complessivo lordo (cassa e IVA secondo il regime di ciascun tecnico alla data).</p>`);

  $('#rd-pdf').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const { pdfRendicontazione } = await import('./rendicontazione-doc.js');
      const { scaricaPdf } = await import('./corsi-doc.js');
      const byte = await pdfRendicontazione(p, prestazioni, corsiDelProgetto, incarichi, fisc || [], tec || []);
      scaricaPdf(byte, `rendicontazione-progetto-${p.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });
}

function formProgetto(p) {
  const campo = (id, label, val, tipo = 'text') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="pg-${id}" value="${esc(val ?? '')}"></div>`;
  apriDrawer(p ? 'Modifica progetto' : 'Nuovo progetto finanziato', '', `
    <div class="field"><label>Titolo *</label><input id="pg-titolo" value="${esc(p?.titolo || '')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('breve', 'Descrizione breve', p?.desc_breve)}
      ${campo('sanzioni', 'Anno/periodo sanzioni', p?.anno_sanzioni, 'text')}
      ${campo('delibera', 'N° delibera', p?.delibera_num)}
      ${campo('deliberadata', 'Data delibera', p?.delibera_data, 'date')}
      ${campo('ente', 'Ente finanziatore', p?.ente_finanziatore ?? 'AZIENDA ULSS 6 EUGANEA')}
      ${campo('finanz', 'Finanziamento €', p?.finanziamento, 'number')}
      ${campo('inizio', 'Inizio', p?.data_inizio, 'date')}
      ${campo('fine', 'Fine', p?.data_fine, 'date')}
      ${campo('rendi', 'Rendicontazione', p?.data_rendicontazione, 'date')}
      ${campo('accimp', 'Acconto €', p?.acconto_importo, 'number')}
      ${campo('accdata', 'Data acconto', p?.acconto_data, 'date')}
      ${campo('saldoimp', 'Saldo €', p?.saldo_importo, 'number')}
      ${campo('saldodata', 'Data saldo', p?.saldo_data, 'date')}
    </div>
    <div class="field"><label>Stato</label>
      <select id="pg-stato">${['attivo', 'rendicontato', 'chiuso'].map((s) =>
        `<option ${(p?.stato || 'attivo') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Note</label><textarea id="pg-note" rows="2">${esc(p?.note || '')}</textarea></div>
    <button class="btn btn-primary" id="pg-salva" style="margin-top:8px">${p ? 'Salva' : 'Crea'}</button>`);
  $('#pg-salva').addEventListener('click', async (ev) => {
    const titolo = $('#pg-titolo').value.trim();
    if (!titolo) return toast('Serve il titolo.', 'err');
    attendi(ev.currentTarget, true);
    const num = (id) => $(id).value ? Number($(id).value) : null;
    const dati = {
      titolo, desc_breve: $('#pg-breve').value.trim() || null,
      anno_sanzioni: $('#pg-sanzioni').value.trim() || null,
      delibera_num: $('#pg-delibera').value.trim() || null,
      delibera_data: $('#pg-deliberadata').value || null,
      ente_finanziatore: $('#pg-ente').value.trim() || null,
      finanziamento: num('#pg-finanz'),
      data_inizio: $('#pg-inizio').value || null,
      data_fine: $('#pg-fine').value || null,
      data_rendicontazione: $('#pg-rendi').value || null,
      acconto_importo: num('#pg-accimp'), acconto_data: $('#pg-accdata').value || null,
      saldo_importo: num('#pg-saldoimp'), saldo_data: $('#pg-saldodata').value || null,
      stato: $('#pg-stato').value, note: $('#pg-note').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = p
      ? await sb.from('s_progetti_formativi').update(dati).eq('id', p.id)
      : await sb.from('s_progetti_formativi').insert(dati);
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast(p ? 'Progetto aggiornato.' : 'Progetto creato.', 'ok');
    await carica();
    vistaProgetti();
  });
}
