/* ============================================================
   Richiesta CONFERENZA di CANTIERE — formazione/informazione in
   cantiere per i dipendenti di una singola impresa.

   Quinto servizio sul telaio comune: è nell'elenco esplicito
   della regola 2026-08-07, quindi AUTORIZZAZIONE DEL DIRETTORE
   (PDF + «Autorizza dall'app» #conferenza-<id>, visto depositato
   nel vault), pre-istruttoria CEIV/ATECO, tecnico proposto dalla
   zona del cantiere, conferma via mail.

   A conferenza svolta si registrano data, argomenti, partecipanti
   ed esito: sono i dati che alimentano la nota-evento
   #evento/conferenza-cantiere in 2_AREE/Formazione/conferenze_cantiere
   (regola del vault sulle note di riepilogo con formazione).
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo } from './core.js';
import { APP_URL } from './config.js';
import { risolviCartella, leggiByte, idDaLink } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';

let pratiche = [];
let tecnici = [];
let conf = {};
let protDi = {};
let filtro = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', autorizzata: 'Autorizzata', programmata: 'Programmata',
  svolta: 'Svolta', chiusa: 'Chiusa', scartata: 'Scartata',
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
const FONTI = ['telefono', 'email', 'pec', 'altro'];
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Richiesta CONFERENZA di CANTIERE';
const TIPO_DOC_CONF = 58;   // s_tipo_doc «Conferenza di cantiere»

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;

async function carica() {
  const [{ data: p }, { data: t }, { data: c }] = await Promise.all([
    sb.from('s_conferenze_cantiere').select('*').order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true),
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'direttore_nome', 'direttore_firma_id']),
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

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#conferenze-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  /* sotto «Chiuse» compaiono anche le storiche di Access, marcate 📜 */
  let storicoDati = [];
  let storicoRighe = '';
  if (filtro === 'chiuse') {
    const { caricaStorico, righeStorico } = await import('./servizi-storico.js');
    storicoDati = (await caricaStorico()).filter((r) => /conferenza|formazione\/informazione in cantiere/i.test(r.tipologia || ''));
    storicoRighe = righeStorico(storicoDati, 10);
  }

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const daAutorizzare = aperte.filter((p) => ['da_richiedere', 'richiesta'].includes(p.aut_stato));
  const daSvolgere = aperte.filter((p) => p.aut_stato === 'approvata' && !['svolta'].includes(p.stato));

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
      <td>${esc([p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || '—')}</td>
      <td><span class="dt-cella ${cCeiv}" style="padding:2px 8px">${esc(lCeiv)}</span></td>
      <td><span class="dt-cella ${cAut}" style="padding:2px 8px">${esc(lAut)}</span></td>
      <td>${p.data_conferenza ? dataIt(p.data_conferenza) : '—'}</td>
      <td>${esc(nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || '—')}${!p.tecnico_assegnato && p.tecnico_proposto ? ' <span class="hint">(proposto)</span>' : ''}</td>
      <td class="hint" style="white-space:nowrap">${prot}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${daAutorizzare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⏳ ${daAutorizzare.length} da autorizzare</span>
      <span class="dt-cella ${daSvolgere.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">🎓 ${daSvolgere.length} autorizzate da svolgere</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${aperte.length} aperte in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="cf-f">
        ${[['aperte', 'Da lavorare'], ['autorizzare', '⏳ Da autorizzare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="cf-storico">📜 Storico Access</button>
        <button class="btn btn-ghost btn-sm" id="cf-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="cf-nuova">+ Nuova richiesta</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>Cantiere</th><th>CEIV</th><th>Autorizzazione</th><th>Conferenza</th><th>Tecnico</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${(righe + storicoRighe) || '<tr><td colspan="10" class="empty">Nessuna richiesta con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      La conferenza di cantiere è un servizio su richiesta con spesa: passa dall'autorizzazione del Direttore.
      A conferenza svolta si registrano data, argomenti e partecipanti — sono i dati per la nota-evento in Formazione.
    </p>`;

  $('#cf-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#cf-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.conferenze?.nuove || 0;
    toast(n ? `${n} richieste nuove importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (n) render();
  });
  $('#cf-nuova').addEventListener('click', nuovaRichiesta);
  $('#cf-storico').addEventListener('click', async () => {
    const { apriStoricoServizi } = await import('./servizi-storico.js');
    apriStoricoServizi(host, { titolo: 'Conferenze e informazione in cantiere — storico (Access)',
      filtra: (r) => /conferenza|formazione\/informazione in cantiere/i.test(r.tipologia || ''), indietro: render });
  });
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
  if (storicoDati.length) {
    const { collegaRigheStorico } = await import('./servizi-storico.js');
    collegaRigheStorico(host, storicoDati);
  }
}

/* ══════════ inserimento manuale ══════════ */

function nuovaRichiesta() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="ncf-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Nuova richiesta di conferenza (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per le richieste arrivate fuori dal modulo online (telefono, mail, PEC).</p>
    <div class="field"><label>Arrivata per *</label>
      <select id="ncf-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
    ${campo('ragione', 'Impresa *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('piva', 'Partita IVA', 'text', '11 cifre — aggancia CEIV e anagrafica')}${campo('ceiv', 'Codice CEIV dichiarato')}
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    ${campo('indcant', 'Indirizzo cantiere')}
    ${campo('comcant', 'Comune cantiere', 'text', 'es. PADOVA - Q3 Est, oppure il comune')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('refnome', 'Referente in cantiere')}${campo('reftel', 'Cell. referente')}
    </div>
    <div class="field"><label>Note (argomenti richiesti, esigenze…)</label><textarea id="ncf-note" rows="3"></textarea></div>
    <button class="btn btn-primary" id="ncf-crea" style="margin-top:10px">Crea la pratica</button>`);

  $('#ncf-crea').addEventListener('click', async (ev) => {
    const ragione = $('#ncf-ragione').value.trim();
    if (!ragione) return toast('Serve l\'impresa.', 'err');
    attendi(ev.currentTarget, true);
    const m = $('#ncf-piva').value.match(/\d{10,11}/);
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
    const { data: nuova, error } = await sb.from('s_conferenze_cantiere').insert({
      fonte: $('#ncf-fonte').value,
      timestamp_modulo: new Date().toISOString(),
      ragione_sociale: ragione,
      partita_iva: piva || $('#ncf-piva').value.trim() || null,
      codice_ceiv_dich: $('#ncf-ceiv').value.trim() || null,
      telefono: $('#ncf-tel').value.trim() || null,
      email: $('#ncf-email').value.trim() || null,
      ind_cantiere: $('#ncf-indcant').value.trim() || null,
      comune_cantiere: $('#ncf-comcant').value.trim() || null,
      ref_nome: $('#ncf-refnome').value.trim() || null,
      ref_tel: $('#ncf-reftel').value.trim() || null,
      note_modulo: $('#ncf-note').value.trim() || null,
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
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Conferenza n° ${p.progressivo ?? `m${p.id}`} — ${p.ragione_sociale || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp && p.esito_ceiv === 'iscritta' ? 'dt-ok' : imp ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">CEIV</span>
      <span class="dt-quadro-stato">${imp
        ? `${imp.cod_ceiv ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.stato_cassa || '')}` : 'nessun codice in anagrafica'}${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}`
        : `non in anagrafica (dichiarato: ${esc(p.codice_ceiv_dich || '—')}) — la precedenza CEIV decide l'ordine`}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cAut}"></span>
      <span class="dt-quadro-req">Autorizzazione Direttore</span>
      <span class="dt-quadro-stato">${esc(lAut)}${p.autorizzata_da ? ` — ${esc(p.autorizzata_da)} il ${p.data_autorizzazione ? dataIt(p.data_autorizzazione) : '?'}` : ''}
        ${p.aut_drive_url ? ` · <a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">documento</a>` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.tecnico_assegnato ? 'dt-ok' : p.tecnico_proposto ? 'dt-senzadata' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Tecnico</span>
      <span class="dt-quadro-stato">${p.tecnico_assegnato
        ? `assegnato: ${esc(nomeTecnico(p.tecnico_assegnato))}${p.tecnico_proposto && p.tecnico_proposto !== p.tecnico_assegnato
            ? ` — la zona proponeva ${esc(nomeTecnico(p.tecnico_proposto))} (cambio della segreteria)` : ''}`
        : p.tecnico_proposto ? `proposto dalla zona: ${esc(nomeTecnico(p.tecnico_proposto))} — da confermare o cambiare se non disponibile nei tempi` : 'da assegnare'}</span>
    </div>
    ${p.protocollo_in_id ? `
    <div class="dt-quadro-riga">
      <span class="dt-dot dt-ok"></span>
      <span class="dt-quadro-req">Protocollo IN</span>
      <span class="dt-quadro-stato"><strong>${esc(protDi[p.protocollo_in_id] ? codiceProtocollo(protDi[p.protocollo_in_id]) : 'protocollata')}</strong>${!state.soloDirettore && protDi[p.protocollo_in_id] ? ` · <a href="#" data-apri-prot="${p.protocollo_in_id}">apri nel registro</a>` : ''}</span>
    </div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Arrivata', [p.fonte, p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('P.IVA', p.partita_iva)}
    ${campo('Sede', [p.ind_legale, p.ind_amm].filter(Boolean).join(' / '))}
    ${campo('Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.rl_cf].filter(Boolean).join(' — '))}
    ${campo('Contatti', [p.telefono, p.cellulare, p.email].filter(Boolean).join(' — '))}
    ${campo('RSPP', p.rspp_ruolo)}
    ${campo('Tipo richiesta', p.tipo_richiesta)}
    ${campo('Cantiere', [p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', '))}
    ${campo('Referente in cantiere', [[p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' '), p.ref_tel].filter(Boolean).join(' — '))}
    ${p.note_modulo ? `<div class="dt-doc-riga"><strong>Note del modulo:</strong><br>${esc(p.note_modulo)}</div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="cf-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Tecnico assegnato</label>
        <select id="cf-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${(p.tecnico_assegnato || p.tecnico_proposto) === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
      <div class="field"><label>Data conferenza</label>
        <input type="date" id="cf-data" value="${p.data_conferenza || ''}"></div>
      <div class="field"><label>N° partecipanti</label>
        <input type="number" id="cf-npart" value="${p.n_partecipanti ?? ''}"></div>
      <div class="field"><label>Ore (facoltativo)</label>
        <input type="number" step="0.5" id="cf-ore" value="${p.ore ?? ''}"></div>
      <div class="field"><label>Corrispettivo € (facoltativo)</label>
        <input type="number" step="0.01" id="cf-corr" value="${p.corrispettivo ?? ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Argomenti trattati</label>
      <textarea id="cf-argomenti" rows="2">${esc(p.argomenti || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>Esito (per la nota-evento in Formazione)</label>
      <textarea id="cf-esito" rows="2">${esc(p.esito || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="cf-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="cf-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Autorizzazione del Direttore</h4>
    ${['approvata', 'respinta'].includes(p.aut_stato) ? `
      <p class="hint" style="margin:0 0 10px">Autorizzazione ${p.aut_stato} da <strong>${esc(p.autorizzata_da || '?')}</strong>${p.data_autorizzazione ? ` il ${dataIt(p.data_autorizzazione)}` : ''}
        (${p.aut_modalita === 'app' ? 'dall’app' : 'giro cartaceo'}).
        ${p.aut_drive_url ? `<a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>
      ${p.aut_stato === 'approvata' ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="cf-conferma">📧 Mail di conferma all'impresa</button>
        <button class="btn btn-ghost" id="cf-corso">📖 Apri il corso (giornate, docenti, iscritti)</button>
      </div>` : ''}` : `
      <p class="hint" style="margin:0 0 10px">La conferenza di cantiere comporta una spesa:
        non è lavorabile finché il Direttore non autorizza.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="cf-autpdf">📄 Richiesta di autorizzazione (PDF + mail)</button>
        ${sonoDirettore ? `
          <button class="btn btn-primary" id="cf-approva">✅ Approva (Direttore)</button>
          <button class="btn btn-ghost" id="cf-respingi">⛔ Respingi</button>` : `
          <button class="btn btn-ghost" id="cf-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
      </div>`}

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost btn-sm" id="cf-protin">📥 Protocolla la richiesta (IN)</button>' : ''}
    </div>
    <p class="hint" style="margin-top:6px">A conferenza svolta, data/argomenti/partecipanti qui sopra sono
      i dati per la nota-evento #evento/conferenza-cantiere in 2_AREE/Formazione/conferenze_cantiere.</p>
  `);

  $('#drawer-body').querySelectorAll('[data-apri-prot]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      chiudiDrawer();
      const mod = await import('./protocollo.js');
      mod.apriDettaglio(Number(a.dataset.apriProt));
    }));

  $('#cf-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_conferenze_cantiere').update({
      stato: $('#cf-stato').value,
      tecnico_assegnato: $('#cf-tecnico').value || null,
      data_conferenza: $('#cf-data').value || null,
      n_partecipanti: $('#cf-npart').value ? Number($('#cf-npart').value) : null,
      ore: $('#cf-ore').value ? Number($('#cf-ore').value) : null,
      corrispettivo: $('#cf-corr').value ? Number($('#cf-corr').value) : null,
      argomenti: $('#cf-argomenti').value.trim() || null,
      esito: $('#cf-esito').value.trim() || null,
      note_ufficio: $('#cf-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  $('#cf-autpdf')?.addEventListener('click', (ev) => richiestaAutorizzazione(p, ev.currentTarget));
  $('#cf-approva')?.addEventListener('click', (ev) => decidiDaApp(p, 'approvata', ev.currentTarget));
  $('#cf-respingi')?.addEventListener('click', (ev) => decidiDaApp(p, 'respinta', ev.currentTarget));
  $('#cf-cartacea')?.addEventListener('click', () => registraCartacea(p));
  $('#cf-conferma')?.addEventListener('click', () => mailConferma(p));
  $('#cf-corso')?.addEventListener('click', async () => {
    const mod = await import('./corsi.js');
    mod.nuovoCorsoDaConferenza(p);   // se il corso esiste già, apre quello
  });
  $('#cf-protin')?.addEventListener('click', () => protocollaIn(p));
}

function campiConferenza(p) {
  return [
    ['Pratica', `Conferenza di cantiere n° ${p.progressivo || p.id}${p.fonte && p.fonte !== 'modulo' ? ` (arrivata per ${p.fonte})` : ' (modulo online)'}`],
    ['Data richiesta', p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10).split('-').reverse().join('/') : '—'],
    ['TipologiaRichiesta', 'Richiesta Conferenza di Cantiere'],
    ['Impresa', [p.ragione_sociale, p.partita_iva ? `P.IVA ${p.partita_iva}` : ''].filter(Boolean).join(' — ')],
    ['CEIV', p.esito_ceiv === 'iscritta' ? `iscritta (cod. ${p.codice_ceiv_dich || '—'})` : p.esito_ceiv === 'non_iscritta' ? 'NON iscritta' : 'da verificare'],
    ['Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.telefono, p.cellulare, p.email].filter(Boolean).join(' — ')],
    ['Cantiere', [p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ')],
    ['Referente in cantiere', [[p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' '), p.ref_tel].filter(Boolean).join(' — ')],
    ['Note', p.note_modulo],
  ];
}

async function richiestaAutorizzazione(p, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const tecnico = nomeTecnico($('#cf-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    const { pdfRichiestaAutCampi } = await import('./segnalazioni-doc.js');
    const byte = await pdfRichiestaAutCampi(campiConferenza(p), tecnico,
      'Ai sensi della procedura sui servizi CPT, si chiede al Direttore l’autorizzazione a svolgere la conferenza di cantiere richiesta dall’impresa.');
    const n = p.progressivo ?? `m${p.id}`;
    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      cc: coordinatore() ? [coordinatore().email] : [],
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Richiesta di autorizzazione - conferenza di cantiere n. ${n}`,
      corpo: `Egr. Direttore,

vogliate trovare in allegato la richiesta di autorizzazione per la conferenza di cantiere n. ${n} richiesta da ${p.ragione_sociale || '?'} (${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cantiere da individuare'}).
Tecnico proposto: ${tecnico || 'da assegnare'}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#conferenza-${p.id}

In alternativa resta il giro cartaceo: firmare il foglio allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: `richiesta-autorizzazione_conferenza-${n}_${slug(p.ragione_sociale)}.pdf`, byte }],
      nomeFile: `richiesta-autorizzazione-conferenza-${n}.eml`,
    });
    await sb.from('s_conferenze_cantiere').update({
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
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la conferenza di cantiere n° ${p.progressivo ?? p.id} per ${p.ragione_sociale}? Il visto col tuo nome finisce nel documento.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
    const tecnico = nomeTecnico($('#cf-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
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
    const byte = await pdfAutorizzazioneCampi(campiConferenza(p), tecnico, visto, firmaByte,
      'Autorizzazione conferenza di cantiere');

    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle conferenze non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const n = p.progressivo ?? `m${p.id}`;
    const nomeFile = `${data}_AUT_CPT-Padova_conferenza-cantiere-${n}-${slug(p.ragione_sociale)}${esito === 'respinta' ? '_respinta' : ''}.pdf`;
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const { error } = await sb.from('s_conferenze_cantiere').update({
      aut_stato: esito,
      aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id,
      aut_drive_url: su.drive_url,
      tecnico_assegnato: $('#cf-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto,
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
  apriDrawer(`Esito cartaceo — conferenza n° ${p.progressivo ?? p.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="cfc-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="cfc-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="cfc-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <div class="field"><label>Link Drive della scansione (facoltativo)</label><input id="cfc-link"></div>
    <button class="btn btn-primary" id="cfc-salva" style="margin-top:10px">Registra</button>`);
  $('#cfc-salva').addEventListener('click', async (ev) => {
    const esito = $('#cfc-esito').value;
    attendi(ev.currentTarget, true);
    const fid = idDaLink($('#cfc-link').value);
    const { error } = await sb.from('s_conferenze_cantiere').update({
      aut_stato: esito, aut_modalita: 'cartacea',
      autorizzata_da: $('#cfc-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#cfc-data').value || oggiIso(),
      aut_drive_id: fid, aut_drive_url: fid ? $('#cfc-link').value.trim() : null,
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

function mailConferma(p) {
  const rl = [p.rl_titolo || 'Sig.', p.rl_nome, p.rl_cognome].filter(Boolean).join(' ');
  const tecnico = nomeTecnico(p.tecnico_assegnato);
  scaricaEml({
    to: p.email || '',
    cc: coordinatore() ? [coordinatore().email] : [],
    oggetto: 'Formedil Padova - Area Sicurezza e Salute - Conferma conferenza di cantiere',
    corpo: `Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `alla c.a. ${rl},` : ''}

con riferimento alla Vostra richiesta, Vi confermiamo che la conferenza di cantiere è stata autorizzata.
${tecnico ? `Il tecnico incaricato è ${tecnico}, che contatterà il Vostro referente per concordare data e modalità.` : 'Sarete contattati dal tecnico incaricato per concordare data e modalità.'}
${p.data_conferenza ? `Data prevista: ${dataIt(p.data_conferenza)}.` : ''}

Distinti saluti.

${FIRMA_SEGRETERIA}`,
    nomeFile: `conferma-conferenza-${p.progressivo ?? `m${p.id}`}.eml`,
  });
  toast('Bozza di conferma scaricata: aprila da Outlook e premi Invia.', 'ok');
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
    oggetto: `Richiesta di conferenza di cantiere — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cantiere da individuare'}`,
    note: p.note_modulo || null,
    sintesi: `Conferenza di cantiere n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`} — ` +
      `CEIV: ${p.esito_ceiv} — tecnico: ${nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || 'da assegnare'}.`,
    tipo_doc_id: TIPO_DOC_CONF,
    mezzo: p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  }, true, async (nuovo) => {
    const { error } = await sb.from('s_conferenze_cantiere').update({
      protocollo_in_id: nuovo.id,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla conferenza n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il PDF di riepilogo e salva — il numero si collega da solo.', 'ok');
}
