/* ============================================================
   Attestazione DM 132/2024 — «attività di consulenza tecnica e
   monitoraggio con esito positivo» (circ. FORMEDIL 69/2025,
   accordo PP.SS. 19/09/2025): vale i CREDITI AGGIUNTIVI sulla
   patente a crediti (art. 5, co. 4, lett. b, n. 4).

   La procedura operativa nazionale, resa flusso:
   1. requisiti d'accesso VINCOLANTI: iscrizione Cassa Edile della
      provincia + regolarità dei versamenti (qui il CEIV non è
      precedenza: è la porta d'ingresso);
   2. autorizzazione del Direttore (le attestazioni sono
      nell'elenco della regola sui servizi CPT);
   3. cantieri concordati con l'impresa (priorità al ruolo più
      rappresentativo), PRIMA VISITA con la check-list nazionale
      (si compila nel gestionale come sempre);
   4. rilievi → VERIFICA ENTRO 2 SETTIMANE (la scadenza la calcola
      l'app), ripetibile; mai pericolo grave e imminente;
   5. esito positivo → ATTESTAZIONE ENTRO 7 GIORNI sul modello
      nazionale: numerazione propria N/anno, protocollo OUT nel
      registro unico (niente timbro: l'attestazione esce completa),
      validità 6 MESI, firma del PRESIDENTE (s_config
      presidente_nome / presidente_firma_id).
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { APP_URL } from './config.js';
import { risolviCartella, caricaByte, leggiByte, idDaLink } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';

let pratiche = [];
let tecnici = [];
let conf = {};
let protDi = {};
let filtro = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', autorizzata: 'Autorizzata', in_visita: 'In visita',
  attestata: 'Attestata', chiusa: 'Chiusa', scartata: 'Scartata',
};
const ESITI = {
  iscritta: ['dt-ok', 'iscritta CEIV'],
  non_iscritta: ['dt-scaduto', 'NON iscritta'],
  da_verificare: ['dt-senzadata', 'da verificare'],
};
const AUT = {
  da_richiedere: ['dt-senzadata', 'da richiedere'],
  richiesta: ['dt-senzadata', 'dal Direttore'],
  approvata: ['dt-ok', 'APPROVATA'],
  respinta: ['dt-scaduto', 'respinta'],
};
const REGOLARITA = {
  da_verificare: ['dt-senzadata', 'da verificare'],
  verificata: ['dt-ok', 'verificata'],
  non_regolare: ['dt-scaduto', 'NON regolare'],
};
const FONTI = ['telefono', 'email', 'pec', 'altro'];
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Richiesta ATTESTAZIONE';
const TIPO_DOC_ATT = 59;   // s_tipo_doc «Attestazione DM 132/2024»

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;

async function carica() {
  const [{ data: p }, { data: t }, { data: c }] = await Promise.all([
    sb.from('s_attestazioni_dm132').select('*').order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true),
    sb.from('s_config').select('chiave, valore').in('chiave',
      ['direttore_email', 'direttore_nome', 'direttore_firma_id', 'presidente_nome', 'presidente_firma_id']),
  ]);
  pratiche = p || [];
  tecnici = t || [];
  conf = Object.fromEntries((c || []).map((r) => [r.chiave, r.valore]));
  const ids = [...new Set(pratiche.flatMap((x) => [x.protocollo_in_id, x.protocollo_out_id]).filter(Boolean))];
  protDi = {};
  if (ids.length) {
    const { data: pr } = await sb.from('s_protocollo').select('*').in('id', ids);
    for (const r of pr || []) protDi[r.id] = r;
  }
}

const nomeTecnico = (email) => {
  const t = tecnici.find((x) => x.email === email);
  return t ? [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' ') : (email || '');
};

const cantieriDi = (p) => Array.isArray(p.cantieri) ? p.cantieri : [];
const numeroAtt = (p) => p.attestazione_num ? `${p.attestazione_num}/${p.attestazione_anno}` : null;

/* la scadenza della verifica (prima visita + 14 giorni), colorata */
function chipVerifica(p) {
  if (p.esito_prima_visita !== 'con_rilievi' || p.esito_verifica === 'risolti' || !p.scadenza_verifica) return '';
  const oggi = oggiIso();
  const scaduta = p.scadenza_verifica < oggi;
  return ` <span class="dt-cella ${scaduta ? 'dt-scaduto' : 'dt-senzadata'}" style="padding:1px 6px">verifica entro ${dataIt(p.scadenza_verifica)}</span>`;
}

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#attestazioni-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const daAutorizzare = aperte.filter((p) => ['da_richiedere', 'richiesta'].includes(p.aut_stato));
  const verificheInScadenza = aperte.filter((p) => p.esito_prima_visita === 'con_rilievi' && p.esito_verifica !== 'risolti' && p.scadenza_verifica);
  const attive = pratiche.filter((p) => p.scadenza_attestazione && p.scadenza_attestazione >= oggiIso());

  const visibili = pratiche.filter((p) =>
    filtro === 'tutte' ? true :
    filtro === 'aperte' ? !['chiusa', 'scartata'].includes(p.stato) :
    filtro === 'autorizzare' ? (!['chiusa', 'scartata'].includes(p.stato) && ['da_richiedere', 'richiesta'].includes(p.aut_stato)) :
    ['chiusa', 'scartata'].includes(p.stato));

  const righe = visibili.map((p) => {
    const [cCeiv, lCeiv] = ESITI[p.esito_ceiv] || ['', p.esito_ceiv || '—'];
    const [cAut, lAut] = AUT[p.aut_stato] || ['', p.aut_stato];
    const prot = [
      p.protocollo_in_id ? (protDi[p.protocollo_in_id] ? `IN ${codiceProtocollo(protDi[p.protocollo_in_id])}` : 'IN ✓') : null,
      p.protocollo_out_id ? (protDi[p.protocollo_out_id] ? `OUT ${codiceProtocollo(protDi[p.protocollo_out_id])}` : 'OUT ✓') : null,
    ].filter(Boolean).join('<br>') || '—';
    return `<tr data-id="${p.id}">
      <td>${p.progressivo ?? `m${p.id}`}</td>
      <td>${p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.ragione_sociale || '?')}</strong></td>
      <td>${cantieriDi(p).length || '—'}</td>
      <td><span class="dt-cella ${cCeiv}" style="padding:2px 8px">${esc(lCeiv)}</span></td>
      <td><span class="dt-cella ${cAut}" style="padding:2px 8px">${esc(lAut)}</span>${chipVerifica(p)}</td>
      <td>${numeroAtt(p) ? `<strong>${esc(numeroAtt(p))}</strong>${p.scadenza_attestazione ? `<br><span class="hint">valida fino al ${dataIt(p.scadenza_attestazione)}</span>` : ''}` : '—'}</td>
      <td class="hint" style="white-space:nowrap">${prot}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${daAutorizzare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⏳ ${daAutorizzare.length} da autorizzare</span>
      <span class="dt-cella ${verificheInScadenza.length ? 'dt-scaduto' : 'dt-ok'}" style="padding:4px 10px">⏱ ${verificheInScadenza.length} verifiche entro 2 settimane</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🪪 ${attive.length} attestazioni in corso di validità</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="at-f">
        ${[['aperte', 'Da lavorare'], ['autorizzare', '⏳ Da autorizzare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="at-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="at-nuova">+ Nuova richiesta</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>Cantieri</th><th>CEIV</th><th>Autorizzazione / verifica</th><th>Attestazione</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="9" class="empty">Nessuna richiesta con questo filtro — servizio nuovo, mai usato dalle imprese: la prima arriverà dal modulo.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Crediti aggiuntivi patente (DM 132/2024, circ. FORMEDIL 69/2025): requisiti CEIV vincolanti,
      prima visita con check-list nazionale (nel gestionale), rilievi → verifica entro 2 settimane,
      attestazione entro 7 giorni con validità 6 mesi, firmata dal Presidente.
    </p>`;

  $('#at-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#at-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.attestazioni?.nuove || 0;
    toast(n ? `${n} richieste nuove importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (n) render();
  });
  $('#at-nuova').addEventListener('click', nuovaRichiesta);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ══════════ inserimento manuale ══════════ */

function nuovaRichiesta() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="na-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Nuova richiesta di attestazione (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per le richieste arrivate fuori dal modulo online (mail, PEC).
      Il modulo nazionale firmato dal legale rappresentante resta il documento da protocollare.</p>
    <div class="field"><label>Arrivata per *</label>
      <select id="na-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
    ${campo('ragione', 'Impresa *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('piva', 'Partita IVA', 'text', '11 cifre')}${campo('ceiv', 'Codice CEIV')}
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    ${campo('cant1', 'Cantiere 1 (indirizzo, comune, ruolo)')}
    ${campo('cant2', 'Cantiere 2 (facoltativo)')}
    <div class="field"><label>Note</label><textarea id="na-note" rows="2"></textarea></div>
    <button class="btn btn-primary" id="na-crea" style="margin-top:10px">Crea la pratica</button>`);

  $('#na-crea').addEventListener('click', async (ev) => {
    const ragione = $('#na-ragione').value.trim();
    if (!ragione) return toast('Serve l\'impresa.', 'err');
    attendi(ev.currentTarget, true);
    const m = $('#na-piva').value.match(/\d{10,11}/);
    const piva = m ? m[0].padStart(11, '0') : null;
    let impresaId = null;
    let esito = 'da_verificare';
    if (piva) {
      const { data: imp } = await sb.from('imprese')
        .select('impresa_id, cod_ceiv, stato_cassa').eq('impresa_id', piva).maybeSingle();
      if (imp) {
        impresaId = imp.impresa_id;
        esito = imp.cod_ceiv && /attiv/i.test(imp.stato_cassa || '') ? 'iscritta' : 'non_iscritta';
      }
    }
    const cantieri = [$('#na-cant1').value.trim(), $('#na-cant2').value.trim()]
      .filter(Boolean).map((s) => ({ indirizzo: s, comune: null }));
    const { data: nuova, error } = await sb.from('s_attestazioni_dm132').insert({
      fonte: $('#na-fonte').value,
      timestamp_modulo: new Date().toISOString(),
      ragione_sociale: ragione,
      partita_iva: piva || $('#na-piva').value.trim() || null,
      codice_ceiv_dich: $('#na-ceiv').value.trim() || null,
      telefono: $('#na-tel').value.trim() || null,
      email: $('#na-email').value.trim() || null,
      cantieri: cantieri.length ? cantieri : null,
      note_ufficio: $('#na-note').value.trim() || null,
      impresa_id: impresaId,
      esito_ceiv: esito,
      ceiv_verificato_il: new Date().toISOString(),
      aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Pratica creata.', 'ok');
    await render();
    apriPratica(nuova.id);
  });
}

/* ══════════ dettaglio e flusso ══════════ */

export async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  let imp = null;
  if (p.partita_iva && /^\d{11}$/.test(p.partita_iva)) {
    const { data } = await sb.from('imprese')
      .select('impresa_id, impresa_nome, cod_ceiv, cassa_edile, stato_cassa, data_agg_access')
      .eq('impresa_id', p.partita_iva).maybeSingle();
    imp = data;
  }
  const sonoDirettore = state.email && conf.direttore_email &&
    state.email.toLowerCase() === conf.direttore_email.toLowerCase();
  const [cAut, lAut] = AUT[p.aut_stato] || ['', p.aut_stato];
  const [cReg, lReg] = REGOLARITA[p.regolarita_versamenti] || ['', p.regolarita_versamenti];
  const cc = cantieriDi(p);
  const requisitiOk = p.esito_ceiv === 'iscritta' && p.regolarita_versamenti === 'verificata';
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Attestazione DM 132 — richiesta n° ${p.progressivo ?? `m${p.id}`} — ${p.ragione_sociale || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp && p.esito_ceiv === 'iscritta' ? 'dt-ok' : 'dt-scaduto'}"></span>
      <span class="dt-quadro-req">CEIV (requisito vincolante)</span>
      <span class="dt-quadro-stato">${imp
        ? `${imp.cod_ceiv ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.stato_cassa || '')}` : 'nessun codice in anagrafica'}${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}`
        : `non in anagrafica (dichiarato: ${esc(p.codice_ceiv_dich || '—')})`} — senza iscrizione la procedura non parte</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cReg}"></span>
      <span class="dt-quadro-req">Regolarità versamenti (vincolante)</span>
      <span class="dt-quadro-stato">${esc(lReg)}${p.regolarita_note ? ` — ${esc(p.regolarita_note)}` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cAut}"></span>
      <span class="dt-quadro-req">Autorizzazione Direttore</span>
      <span class="dt-quadro-stato">${esc(lAut)}${p.autorizzata_da ? ` — ${esc(p.autorizzata_da)} il ${p.data_autorizzazione ? dataIt(p.data_autorizzazione) : '?'}` : ''}
        ${p.aut_drive_url ? ` · <a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">documento</a>` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.attestazione_num ? 'dt-ok' : p.data_prima_visita ? 'dt-senzadata' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Procedura</span>
      <span class="dt-quadro-stato">${p.attestazione_num
        ? `attestazione <strong>${esc(numeroAtt(p))}</strong> del ${dataIt(p.data_rilascio)} — valida fino al ${dataIt(p.scadenza_attestazione)} (${p.esito_attestazione === 'positivo_senza_rilievi' ? 'senza rilievi' : 'dopo verifica adempimenti'})${p.attestazione_drive_url ? ` · <a href="${esc(p.attestazione_drive_url)}" target="_blank" rel="noopener">apri</a>` : ''}`
        : p.esito_prima_visita === 'con_rilievi' && p.esito_verifica !== 'risolti'
          ? `prima visita del ${dataIt(p.data_prima_visita)} CON RILIEVI — verifica entro <strong>${p.scadenza_verifica ? dataIt(p.scadenza_verifica) : '2 settimane'}</strong>`
          : p.data_prima_visita ? `prima visita del ${dataIt(p.data_prima_visita)} (${p.esito_prima_visita === 'senza_rilievi' ? 'senza rilievi' : p.esito_prima_visita || 'esito da registrare'})`
          : 'prima visita da programmare (check-list nazionale, nel gestionale)'}</span>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Arrivata', [p.fonte, p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('P.IVA / CF', [p.partita_iva, p.cf_impresa].filter(Boolean).join(' / '))}
    ${campo('Sede', [p.indirizzo, p.comune].filter(Boolean).join(', '))}
    ${campo('Cassa Edile prov.', p.cassa_edile_prov)}
    ${campo('Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.rl_cf].filter(Boolean).join(' — '))}
    ${campo('Contatti', [p.telefono, p.email].filter(Boolean).join(' — '))}
    ${cc.map((c, i) => `<div class="dt-doc-riga"><strong>Cantiere ${cc.length > 1 ? i + 1 : ''}:</strong> ${esc([c.indirizzo, c.comune].filter(Boolean).join(', ') || '—')}${c.qualita ? ` — <strong>${esc(c.qualita)}</strong>` : ''}${c.importo ? ` — € ${esc(c.importo)}` : ''}${c.committente ? ` — comm. ${esc(c.committente)}` : ''}</div>`).join('')}
    ${campo('Dichiarazioni DPR 445', [p.decl_contributi ? 'contributi ✓' : null, p.decl_sicurezza ? 'sicurezza ✓' : null, p.decl_obblighi ? 'obblighi ✓' : null].filter(Boolean).join(' · '))}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="at-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Regolarità versamenti</label>
        <select id="at-reg">${Object.keys(REGOLARITA).map((k) =>
          `<option value="${k}" ${p.regolarita_versamenti === k ? 'selected' : ''}>${REGOLARITA[k][1]}</option>`).join('')}</select></div>
      <div class="field"><label>Tecnico assegnato</label>
        <select id="at-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${(p.tecnico_assegnato || p.tecnico_proposto) === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
      <div class="field"><label>Cantieri concordati</label>
        <input id="at-concordati" value="${esc(p.cantieri_concordati || '')}" placeholder="quali si visitano (concordati con l'impresa)"></div>
      <div class="field"><label>Prima visita: data</label>
        <input type="date" id="at-visita1" value="${p.data_prima_visita || ''}"></div>
      <div class="field"><label>Prima visita: esito</label>
        <select id="at-esito1"><option value="">—</option>
          <option value="senza_rilievi" ${p.esito_prima_visita === 'senza_rilievi' ? 'selected' : ''}>Senza rilievi</option>
          <option value="con_rilievi" ${p.esito_prima_visita === 'con_rilievi' ? 'selected' : ''}>Con rilievi (verifica entro 2 settimane)</option></select></div>
      <div class="field"><label>Verifica: data</label>
        <input type="date" id="at-visita2" value="${p.data_verifica || ''}"></div>
      <div class="field"><label>Verifica: esito</label>
        <select id="at-esito2"><option value="">—</option>
          <option value="risolti" ${p.esito_verifica === 'risolti' ? 'selected' : ''}>Rilievi risolti</option>
          <option value="non_risolti" ${p.esito_verifica === 'non_risolti' ? 'selected' : ''}>Non risolti (nuova verifica entro 2 settimane)</option></select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="at-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="at-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Autorizzazione del Direttore</h4>
    ${['approvata', 'respinta'].includes(p.aut_stato) ? `
      <p class="hint" style="margin:0 0 10px">Autorizzazione ${p.aut_stato} da <strong>${esc(p.autorizzata_da || '?')}</strong>${p.data_autorizzazione ? ` il ${dataIt(p.data_autorizzazione)}` : ''}
        (${p.aut_modalita === 'app' ? 'dall’app' : 'giro cartaceo'}).
        ${p.aut_drive_url ? `<a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>` : `
      <p class="hint" style="margin:0 0 10px">${requisitiOk
        ? 'Requisiti verificati: si può chiedere l’autorizzazione.'
        : '⚠️ Prima di chiedere l’autorizzazione vanno verificati i <strong>requisiti vincolanti</strong>: iscrizione CEIV e regolarità dei versamenti.'}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="at-autpdf" ${requisitiOk ? '' : 'disabled'}>📄 Richiesta di autorizzazione (PDF + mail)</button>
        ${sonoDirettore ? `
          <button class="btn btn-primary" id="at-approva">✅ Approva (Direttore)</button>
          <button class="btn btn-ghost" id="at-respingi">⛔ Respingi</button>` : `
          <button class="btn btn-ghost" id="at-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
      </div>`}

    ${p.aut_stato === 'approvata' && !p.attestazione_num ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Rilascio dell'attestazione</h4>
    <p class="hint" style="margin:0 0 10px">Si rilascia <strong>entro 7 giorni</strong> dall'esito positivo:
      tutti i rilievi risolti in modo documentato, nessun pericolo grave e imminente.
      Numerazione propria N/anno, protocollo OUT nel registro unico (niente timbro),
      validità 6 mesi, firma del Presidente${conf.presidente_firma_id ? ' (firma caricata)' : ' (da firmare a mano)'}.</p>
    <button class="btn btn-primary" id="at-rilascia"
      ${(p.esito_prima_visita === 'senza_rilievi' || p.esito_verifica === 'risolti') ? '' : 'disabled'}>
      🪪 Rilascia l'attestazione (protocolla + PDF + mail)</button>
    ${!(p.esito_prima_visita === 'senza_rilievi' || p.esito_verifica === 'risolti') ? `
    <p class="hint" style="margin-top:6px">Si abilita quando l'esito è positivo: prima visita senza rilievi, oppure rilievi risolti in verifica.</p>` : ''}` : ''}

    ${p.attestazione_num ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <p class="hint">Attestazione <strong>${esc(numeroAtt(p))}</strong> rilasciata il ${dataIt(p.data_rilascio)} —
      valida fino al <strong>${dataIt(p.scadenza_attestazione)}</strong>.
      ${p.attestazione_drive_url ? `<a href="${esc(p.attestazione_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>
    <button class="btn btn-ghost btn-sm" id="at-eml">📧 Scarica di nuovo la bozza mail</button>` : ''}

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost btn-sm" id="at-protin">📥 Protocolla la richiesta (IN)</button>' : ''}
    </div>
    <p class="hint" style="margin-top:6px">Tutto il fascicolo (modulo, check-list, report, attestazione) resta
      archiviato presso l'OPT: la check-list nazionale si compila nel gestionale, i documenti nella cartella del vault.</p>
  `);

  $('#at-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const esito1 = $('#at-esito1').value || null;
    const visita1 = $('#at-visita1').value || null;
    /* la scadenza delle 2 settimane la calcola l'app, come da procedura */
    let scadVerifica = p.scadenza_verifica;
    if (esito1 === 'con_rilievi' && visita1) {
      const d = new Date(visita1 + 'T12:00:00');
      d.setDate(d.getDate() + 14);
      scadVerifica = d.toISOString().slice(0, 10);
    } else if (esito1 !== 'con_rilievi') {
      scadVerifica = null;
    }
    const { error } = await sb.from('s_attestazioni_dm132').update({
      stato: $('#at-stato').value,
      regolarita_versamenti: $('#at-reg').value,
      tecnico_assegnato: $('#at-tecnico').value || null,
      cantieri_concordati: $('#at-concordati').value.trim() || null,
      data_prima_visita: visita1,
      esito_prima_visita: esito1,
      scadenza_verifica: scadVerifica,
      data_verifica: $('#at-visita2').value || null,
      esito_verifica: $('#at-esito2').value || null,
      note_ufficio: $('#at-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  $('#at-autpdf')?.addEventListener('click', (ev) => richiestaAutorizzazione(p, ev.currentTarget));
  $('#at-approva')?.addEventListener('click', (ev) => decidiDaApp(p, 'approvata', ev.currentTarget));
  $('#at-respingi')?.addEventListener('click', (ev) => decidiDaApp(p, 'respinta', ev.currentTarget));
  $('#at-cartacea')?.addEventListener('click', () => registraCartacea(p));
  $('#at-rilascia')?.addEventListener('click', (ev) => rilasciaAttestazione(p, ev.currentTarget));
  $('#at-eml')?.addEventListener('click', (ev) => riscaricaEml(p, ev.currentTarget));
  $('#at-protin')?.addEventListener('click', () => protocollaIn(p));
}

function campiAttestazione(p) {
  const cc = cantieriDi(p);
  return [
    ['Pratica', `Attestazione DM 132/2024 — richiesta n° ${p.progressivo || p.id}${p.fonte && p.fonte !== 'modulo' ? ` (arrivata per ${p.fonte})` : ' (modulo online)'}`],
    ['Data richiesta', p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10).split('-').reverse().join('/') : '—'],
    ['TipologiaRichiesta', 'Attestazione attività di consulenza e monitoraggio (crediti aggiuntivi patente)'],
    ['Impresa', [p.ragione_sociale, p.partita_iva ? `P.IVA ${p.partita_iva}` : ''].filter(Boolean).join(' — ')],
    ['CEIV (vincolante)', p.esito_ceiv === 'iscritta' ? `iscritta (cod. ${p.codice_ceiv_dich || '—'})` : p.esito_ceiv],
    ['Regolarità versamenti', p.regolarita_versamenti === 'verificata' ? 'verificata' : p.regolarita_versamenti],
    ['Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.telefono, p.email].filter(Boolean).join(' — ')],
    ...cc.map((c, i) => [`Cantiere ${cc.length > 1 ? i + 1 : ''}`.trim(),
      [[c.indirizzo, c.comune].filter(Boolean).join(', '), c.qualita, c.importo ? `€ ${c.importo}` : null].filter(Boolean).join(' — ') || '—']),
    ['Cantieri concordati', p.cantieri_concordati],
    ['Procedura', 'Prima visita con check-list nazionale; rilievi → verifica entro 2 settimane; attestazione entro 7 giorni, validità 6 mesi.'],
  ];
}

async function richiestaAutorizzazione(p, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const tecnico = nomeTecnico($('#at-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    const { pdfRichiestaAutCampi } = await import('./segnalazioni-doc.js');
    const byte = await pdfRichiestaAutCampi(campiAttestazione(p), tecnico,
      'Ai sensi della procedura sui servizi CPT, si chiede al Direttore l’autorizzazione ad avviare la procedura di consulenza tecnica e monitoraggio per l’attestazione DM 132/2024.');
    const n = p.progressivo ?? `m${p.id}`;
    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      cc: coordinatore() ? [coordinatore().email] : [],
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Richiesta di autorizzazione - attestazione DM 132 n. ${n}`,
      corpo: `Egr. Direttore,

vogliate trovare in allegato la richiesta di autorizzazione per la procedura di attestazione DM 132/2024 (crediti aggiuntivi patente) richiesta da ${p.ragione_sociale || '?'}.
Requisiti verificati: iscrizione CEIV e regolarità versamenti. Tecnico proposto: ${tecnico || 'da assegnare'}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#attestazione-${p.id}

In alternativa resta il giro cartaceo: firmare il foglio allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: `richiesta-autorizzazione_attestazione-${n}_${slug(p.ragione_sociale)}.pdf`, byte }],
      nomeFile: `richiesta-autorizzazione-attestazione-${n}.eml`,
    });
    await sb.from('s_attestazioni_dm132').update({
      aut_stato: p.aut_stato === 'da_richiedere' ? 'richiesta' : p.aut_stato,
      aut_richiesta_il: new Date().toISOString(),
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Bozza mail al Direttore scaricata: aprila da Outlook e premi Invia.', 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function decidiDaApp(p, esito, btn) {
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la procedura di attestazione DM 132 per ${p.ragione_sociale}? Il visto col tuo nome finisce nel documento.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
    const tecnico = nomeTecnico($('#at-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    let firmaByte = null;
    if (conf.direttore_firma_id) {
      try { firmaByte = await leggiByte(conf.direttore_firma_id); } catch { /* senza firma il visto vale lo stesso */ }
    }
    const adesso = new Date();
    const visto = {
      esito,
      nome: conf.direttore_nome || 'Il Direttore',
      data_ora: `${dataIt(adesso.toISOString().slice(0, 10))} ore ${String(adesso.getHours()).padStart(2, '0')}:${String(adesso.getMinutes()).padStart(2, '0')}`,
      utente: state.email,
      note,
    };
    const { pdfAutorizzazioneCampi } = await import('./segnalazioni-doc.js');
    const byte = await pdfAutorizzazioneCampi(campiAttestazione(p), tecnico, visto, firmaByte,
      'Autorizzazione procedura attestazione DM 132/2024');
    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle attestazioni non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const n = p.progressivo ?? `m${p.id}`;
    const nomeFile = `${data}_AUT_CPT-Padova_attestazione-DM132-${n}-${slug(p.ragione_sociale)}${esito === 'respinta' ? '_respinta' : ''}.pdf`;
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));
    const { error } = await sb.from('s_attestazioni_dm132').update({
      aut_stato: esito,
      aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id,
      aut_drive_url: su.drive_url,
      tecnico_assegnato: $('#at-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Autorizzazione ${esito} registrata: il documento col visto è su Drive.`, 'ok');
    await render();
    apriPratica(p.id);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

function registraCartacea(p) {
  apriDrawer(`Esito cartaceo — attestazione n° ${p.progressivo ?? p.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="ac-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="ac-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="ac-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <div class="field"><label>Link Drive della scansione (facoltativo)</label><input id="ac-link"></div>
    <button class="btn btn-primary" id="ac-salva" style="margin-top:10px">Registra</button>`);
  $('#ac-salva').addEventListener('click', async (ev) => {
    const esito = $('#ac-esito').value;
    attendi(ev.currentTarget, true);
    const fid = idDaLink($('#ac-link').value);
    const { error } = await sb.from('s_attestazioni_dm132').update({
      aut_stato: esito, aut_modalita: 'cartacea',
      autorizzata_da: $('#ac-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#ac-data').value || oggiIso(),
      aut_drive_id: fid, aut_drive_url: fid ? $('#ac-link').value.trim() : null,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Registrazione non riuscita: ' + error.message, 'err');
    toast('Esito registrato.', 'ok');
    await render();
    apriPratica(p.id);
  });
}

/* ── il rilascio: numero N/anno + protocollo OUT + PDF + Drive + mail ── */
async function rilasciaAttestazione(p, btn) {
  const esitoAtt = p.esito_prima_visita === 'senza_rilievi' ? 'positivo_senza_rilievi' : 'positivo_dopo_verifica';
  if (!confirm(`Rilascio l'attestazione DM 132/2024 per ${p.ragione_sociale} (${esitoAtt === 'positivo_senza_rilievi' ? 'positivo senza rilievi' : 'positivo dopo verifica adempimenti'}), firmata dal Presidente, protocollata in uscita. Procedo?`)) return;
  attendi(btn, true, 'Rilascio…');
  try {
    const anno = new Date().getFullYear();
    /* il numero proprio della serie: il massimo dell'anno + 1 */
    const { data: ultime } = await sb.from('s_attestazioni_dm132')
      .select('attestazione_num').eq('attestazione_anno', anno)
      .order('attestazione_num', { ascending: false }).limit(1);
    const num = ((ultime?.[0]?.attestazione_num) || 0) + 1;
    const numero = `${num}/${anno}`;
    const oggi = oggiIso();
    const scad = new Date(oggi + 'T12:00:00');
    scad.setMonth(scad.getMonth() + 6);
    const scadenza = scad.toISOString().slice(0, 10);

    /* protocollo OUT nel registro unico (l'attestazione si protocolla,
       ma il timbro sul foglio non ci va: esce già completa) */
    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggi,
      data_doc: oggi,
      impresa_nome: p.ragione_sociale,
      impresa_id: p.impresa_id || null,
      persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
      oggetto: `Attestazione attività di consulenza e monitoraggio n. ${numero} — DM 132/2024`,
      note: `Attestazione n. ${numero}, esito ${esitoAtt === 'positivo_senza_rilievi' ? 'positivo senza rilievi' : 'positivo dopo verifica adempimenti'}, validità 6 mesi (fino al ${dataIt(scadenza)}).`,
      sintesi: `Attestazione DM 132/2024 per crediti aggiuntivi patente — richiesta n° ${p.progressivo ?? `m${p.id}`}. Prima visita ${p.data_prima_visita ? dataIt(p.data_prima_visita) : '—'}${p.data_verifica ? `, verifica ${dataIt(p.data_verifica)}` : ''}. Firma del Presidente.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_id: TIPO_DOC_ATT,
      tipo_doc_txt: 'Attestazione DM 132/2024',
      cartella: PERCORSO_VAULT,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    let firmaByte = null;
    if (conf.presidente_firma_id) {
      try { firmaByte = await leggiByte(conf.presidente_firma_id); } catch { /* firma a mano */ }
    }
    const { pdfAttestazioneDM132 } = await import('./segnalazioni-doc.js');
    const byte = await pdfAttestazioneDM132(p, {
      numero, protocollo: nuovo, esito: esitoAtt, data_rilascio: oggi,
      firma_nome: conf.presidente_nome || 'Il Presidente',
    }, firmaByte);

    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle attestazioni non trovata su Drive');
    const data = oggi.replace(/-/g, '_');
    const nomeFile = `${data}_ATT_Formedil-Padova_attestazione-DM132-consulenza-monitoraggio-n${num}-${anno}_${slug(p.ragione_sociale)}.pdf`;
    const su = await caricaByte(nuovo, nomeFile, byte, 'application/pdf', cart.id);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: byte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

    const { error } = await sb.from('s_attestazioni_dm132').update({
      attestazione_num: num,
      attestazione_anno: anno,
      esito_attestazione: esitoAtt,
      data_rilascio: oggi,
      scadenza_attestazione: scadenza,
      attestazione_drive_id: su.drive_file_id,
      attestazione_drive_url: su.drive_url,
      protocollo_out_id: nuovo.id,
      stato: 'attestata',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);

    emlAttestazione(p, nuovo, numero, [{ nome: su.file_name || nomeFile, byte }]);
    toast(`Attestazione ${numero} rilasciata (${codiceProtocollo(nuovo)}), valida fino al ${dataIt(scadenza)}. Bozza mail scaricata.`, 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function riscaricaEml(p, btn) {
  attendi(btn, true, 'Rileggo…');
  try {
    const { data: prot } = await sb.from('s_protocollo').select('*').eq('id', p.protocollo_out_id).single();
    const byte = await leggiByte(p.attestazione_drive_id);
    emlAttestazione(p, prot, numeroAtt(p), [{ nome: `attestazione-DM132-${slug(p.ragione_sociale)}.pdf`, byte }]);
    toast('Bozza scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

function emlAttestazione(p, prot, numero, allegati) {
  const rl = [p.rl_titolo || 'Sig.', p.rl_nome, p.rl_cognome].filter(Boolean).join(' ');
  scaricaEml({
    to: p.email || '',
    cc: ['direzione@formedilpadova.it', ...(coordinatore() ? [coordinatore().email] : [])],
    oggetto: `Formedil Padova - Area Sicurezza e Salute - Attestazione DM 132/2024 n. ${numero} - ${siglaProtocollo(prot)}`,
    corpo: `Prot. n°: ${siglaProtocollo(prot)}

Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `alla c.a. ${rl},` : ''}

vogliate trovare in allegato l'Attestazione di attività di consulenza e monitoraggio con esito positivo n. ${numero}, ai sensi dell'art. 5, co. 4, lett. b, n. 4 del DM 132/2024, valida 6 mesi dalla data di rilascio e utile ai fini dei crediti aggiuntivi della patente a crediti.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
    allegati,
    nomeFile: `attestazione-DM132-${slug(p.ragione_sociale)}.eml`,
  });
}

async function protocollaIn(p) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  mod.apriForm('IN', {
    data_prot: oggiIso(),
    data_doc: (p.timestamp_modulo || '').slice(0, 10) || null,
    impresa_nome: p.ragione_sociale || null,
    impresa_id: p.impresa_id || null,
    persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
    oggetto: 'Richiesta attestazione attività di consulenza e monitoraggio — DM 132/2024',
    note: null,
    sintesi: `Richiesta attestazione DM 132 n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`} — ` +
      `${cantieriDi(p).length} cantieri dichiarati — CEIV: ${p.esito_ceiv}. Crediti aggiuntivi patente.`,
    tipo_doc_id: TIPO_DOC_ATT,
    mezzo: p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  }, true, async (nuovo) => {
    const { error } = await sb.from('s_attestazioni_dm132').update({
      protocollo_in_id: nuovo.id,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla richiesta n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il modulo firmato e salva — il numero si collega da solo.', 'ok');
}
