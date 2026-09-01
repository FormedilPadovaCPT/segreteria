/* ============================================================
   Servizio di Consulenza e Informazione.

   Due corsie, decise dai dati storici (331 pratiche 2013-2026,
   tre quarti risolte al telefono o allo sportello):

   CORSIA IMMEDIATA — telefono, mail, sportello. La registra la
   segreteria; se il quesito è tecnico lo GIRA AL COORDINATORE
   (bozza mail), il coordinatore risponde, la segreteria TRASMETTE
   la risposta all'impresa (bozza mail). Nessuna autorizzazione
   del Direttore: non c'è spesa, la prestazione è già erogata.
   Il protocollo è facoltativo: scatta solo se un documento varca
   la porta (una telefonata non si protocolla — regola del confine).

   CORSIA CON USCITA — consulenza in sede impresa o in cantiere:
   comporta spesa → stesso telaio di autorizzazione delle
   segnalazioni (PDF + mail al Direttore con «Autorizza dall'app»,
   visto registrato dall'app, deposito automatico nel vault).
   Riscontro all'impresa: solo mail di conferma (scelta utente).

   Pre-istruttoria identica all'RLST: aggancio impresa per P.IVA,
   esito CEIV (con la precedenza CEIV che decide l'ordine di
   lavorazione), settore edile dall'ATECO.
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
  ricevuta: 'Ricevuta', girata: 'Dal coordinatore', risposta_pronta: 'Risposta pronta',
  autorizzata: 'Autorizzata', eseguita: 'Eseguita', chiusa: 'Chiusa', scartata: 'Scartata',
};
const ESITI = {
  iscritta: ['dt-ok', 'iscritta CEIV'],
  non_iscritta: ['dt-scaduto', 'NON iscritta'],
  da_verificare: ['dt-senzadata', 'da verificare'],
};
const AUT = {
  non_necessaria: ['dt-ok', '—'],
  da_richiedere: ['dt-senzadata', 'da richiedere'],
  richiesta: ['dt-senzadata', 'dal Direttore'],
  approvata: ['dt-ok', 'APPROVATA'],
  respinta: ['dt-scaduto', 'respinta'],
};
const LUOGHI = { telefonica: 'Telefonica', sede_cpt: 'In sede CPT', sede_impresa: 'In sede impresa', cantiere: 'In cantiere' };
const FONTI = ['telefono', 'email', 'pec', 'sportello', 'altro'];
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Richiesta CONSULENZE';
const TIPO_DOC_CONS = 55;   // s_tipo_doc «Consulenza sicurezza»

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;

async function carica() {
  const [{ data: p }, { data: t }, { data: c }] = await Promise.all([
    sb.from('s_consulenze').select('*').order('id', { ascending: false }),
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
  const host = $('#consulenze-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const dalCoord = aperte.filter((p) => p.stato === 'girata');
  const daAutorizzare = aperte.filter((p) => ['da_richiedere', 'richiesta'].includes(p.aut_stato));

  const visibili = pratiche.filter((p) =>
    filtro === 'tutte' ? true :
    filtro === 'aperte' ? !['chiusa', 'scartata'].includes(p.stato) :
    filtro === 'coordinatore' ? p.stato === 'girata' :
    filtro === 'autorizzare' ? (!['chiusa', 'scartata'].includes(p.stato) && ['da_richiedere', 'richiesta'].includes(p.aut_stato)) :
    ['chiusa', 'scartata'].includes(p.stato));

  const righe = visibili.map((p) => {
    const [cCeiv, lCeiv] = ESITI[p.esito_ceiv] || ['', p.esito_ceiv || '—'];
    const [cAut, lAut] = AUT[p.aut_stato] || ['', p.aut_stato];
    const corsia = p.corsia === 'uscita'
      ? `🚧 uscita <span class="dt-cella ${cAut}" style="padding:1px 6px">${esc(lAut)}</span>`
      : `💬 ${esc(LUOGHI[p.luogo] || 'immediata')}`;
    const prot = [
      p.protocollo_in_id ? (protDi[p.protocollo_in_id] ? `IN ${codiceProtocollo(protDi[p.protocollo_in_id])}` : 'IN ✓') : null,
      p.protocollo_out_id ? (protDi[p.protocollo_out_id] ? `OUT ${codiceProtocollo(protDi[p.protocollo_out_id])}` : 'OUT ✓') : null,
    ].filter(Boolean).join('<br>') || '—';
    return `<tr data-id="${p.id}">
      <td>${p.progressivo ?? `m${p.id}`}</td>
      <td>${p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.ragione_sociale || '?')}</strong></td>
      <td><span class="dt-cella ${cCeiv}" style="padding:2px 8px">${esc(lCeiv)}</span></td>
      <td>${corsia}</td>
      <td class="hint" style="white-space:nowrap">${prot}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${dalCoord.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">📨 ${dalCoord.length} dal coordinatore</span>
      <span class="dt-cella ${daAutorizzare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⏳ ${daAutorizzare.length} da autorizzare (uscite)</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${aperte.length} aperte in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="cn-f">
        ${[['aperte', 'Da lavorare'], ['coordinatore', '📨 Dal coordinatore'], ['autorizzare', '⏳ Da autorizzare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="cn-storico">📜 Storico Access</button>
        <button class="btn btn-ghost btn-sm" id="cn-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="cn-nuova">+ Registra consulenza</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>CEIV</th><th>Corsia</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="7" class="empty">Nessuna consulenza con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      La corsia immediata si registra e si chiude qui (quesito tecnico → coordinatore → risposta all'impresa);
      l'uscita in sede o in cantiere passa dall'autorizzazione del Direttore. Precedenza alle imprese iscritte CEIV.
      Lo storico Access delle consulenze si consulta dalla pagina Segnalazioni, scheda «Storico Access».
    </p>`;

  $('#cn-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#cn-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.consulenze?.nuove || 0;
    toast(n ? `${n} richieste di consulenza importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (n) render();
  });
  $('#cn-nuova').addEventListener('click', nuovaConsulenza);
  $('#cn-storico').addEventListener('click', async () => {
    const { apriStoricoServizi } = await import('./servizi-storico.js');
    apriStoricoServizi(host, { titolo: 'Consulenze storiche (Access, 2013-2026)',
      filtra: (r) => /consulenza/i.test(r.tipologia || ''), indietro: render });
  });
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ══════════ registrazione manuale ══════════ */

function nuovaConsulenza() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="nc-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Registra consulenza / informazione', '', `
    <p class="hint" style="margin:0 0 10px">Per le richieste arrivate per telefono, mail o allo sportello.
      Se la risposta l'hai già data, compila anche il campo risposta e chiudi subito.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Arrivata per *</label>
        <select id="nc-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
      <div class="field"><label>Modalità</label>
        <select id="nc-luogo">${Object.entries(LUOGHI).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    </div>
    ${campo('ragione', 'Impresa / richiedente *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('piva', 'Partita IVA', 'text', '11 cifre — aggancia CEIV e anagrafica')}${campo('ceiv', 'Codice CEIV dichiarato')}
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    <div class="field"><label>Quesito *</label><textarea id="nc-quesito" rows="3" placeholder="Che cosa chiede l'impresa"></textarea></div>
    <div class="field"><label>Risposta già data (se chiusa al momento)</label><textarea id="nc-risposta" rows="2"></textarea></div>
    ${campo('tipi', 'Temi (es. ponteggi; DVR; formazione)')}
    <button class="btn btn-primary" id="nc-crea" style="margin-top:10px">Crea la pratica</button>`);

  $('#nc-crea').addEventListener('click', async (ev) => {
    const ragione = $('#nc-ragione').value.trim();
    const quesito = $('#nc-quesito').value.trim();
    if (!ragione || !quesito) return toast('Servono impresa e quesito.', 'err');
    attendi(ev.currentTarget, true);
    const m = $('#nc-piva').value.match(/\d{10,11}/);
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
    const luogo = $('#nc-luogo').value;
    const uscita = ['sede_impresa', 'cantiere'].includes(luogo);
    const risposta = $('#nc-risposta').value.trim() || null;
    const { data: nuova, error } = await sb.from('s_consulenze').insert({
      fonte: $('#nc-fonte').value,
      timestamp_modulo: new Date().toISOString(),
      ragione_sociale: ragione,
      partita_iva: piva || $('#nc-piva').value.trim() || null,
      codice_ceiv_dich: $('#nc-ceiv').value.trim() || null,
      telefono: $('#nc-tel').value.trim() || null,
      email: $('#nc-email').value.trim() || null,
      quesito,
      risposta,
      risposta_da: risposta ? state.email : null,
      trasmessa_il: risposta ? new Date().toISOString() : null,
      tipi_consulenza: $('#nc-tipi').value.trim() || null,
      luogo,
      corsia: uscita ? 'uscita' : 'immediata',
      aut_stato: uscita ? 'da_richiedere' : 'non_necessaria',
      stato: risposta && !uscita ? 'chiusa' : 'ricevuta',
      impresa_id: impresaId,
      esito_ceiv: esito,
      ceiv_verificato_il: new Date().toISOString(),
      aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast(risposta && !uscita ? 'Consulenza registrata e chiusa.' : 'Pratica creata.', 'ok');
    await render();
    if (!(risposta && !uscita)) apriPratica(nuova.id);
  });
}

/* ══════════ dettaglio e flusso ══════════ */

export async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  /* quadro CEIV/anagrafica/ATECO, lo stesso dell'RLST */
  let imp = null;
  if (p.partita_iva && /^\d{11}$/.test(p.partita_iva)) {
    const { data } = await sb.from('imprese')
      .select('impresa_id, impresa_nome, cod_ceiv, cassa_edile, stato_cassa, data_agg_access')
      .eq('impresa_id', p.partita_iva).maybeSingle();
    imp = data;
  }
  let ateco = [];
  if (imp) {
    const { data } = await sb.from('imprese_ateco').select('codice')
      .eq('impresa_id', imp.impresa_id);
    ateco = data || [];
  }
  const edile = ateco.length ? ateco.some((a) => /^4[123]/.test(a.codice)) : null;

  const sonoDirettore = state.email && conf.direttore_email &&
    state.email.toLowerCase() === conf.direttore_email.toLowerCase();
  const uscita = p.corsia === 'uscita';
  const [cAut, lAut] = AUT[p.aut_stato] || ['', p.aut_stato];
  const coord = coordinatore();
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Consulenza n° ${p.progressivo ?? `m${p.id}`} — ${p.ragione_sociale || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp && p.esito_ceiv === 'iscritta' ? 'dt-ok' : imp ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">CEIV</span>
      <span class="dt-quadro-stato">${imp
        ? `${imp.cod_ceiv ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.stato_cassa || '')}` : 'nessun codice in anagrafica'}${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}`
        : `non in anagrafica (dichiarato: ${esc(p.codice_ceiv_dich || '—')}) — la precedenza CEIV decide l'ordine di lavorazione`}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${edile === true ? 'dt-ok' : edile === false ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Settore edile (ATECO)</span>
      <span class="dt-quadro-stato">${edile === true ? 'sì' : edile === false ? 'fuori dalle costruzioni' : 'da verificare'}</span>
    </div>
    ${uscita ? `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cAut}"></span>
      <span class="dt-quadro-req">Autorizzazione Direttore</span>
      <span class="dt-quadro-stato">${esc(lAut)}${p.autorizzata_da ? ` — ${esc(p.autorizzata_da)} il ${p.data_autorizzazione ? dataIt(p.data_autorizzazione) : '?'}` : ''}
        ${p.aut_drive_url ? ` · <a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">documento</a>` : ''}</span>
    </div>` : `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.stato === 'girata' ? 'dt-senzadata' : p.risposta ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Quesito</span>
      <span class="dt-quadro-stato">${p.stato === 'girata'
        ? `girato al coordinatore${p.girata_il ? ` il ${dataIt(p.girata_il.slice(0, 10))}` : ''} — in attesa di risposta`
        : p.trasmessa_il ? `risposta trasmessa il ${dataIt(p.trasmessa_il.slice(0, 10))}`
        : p.risposta ? 'risposta pronta, da trasmettere' : 'in attesa di risposta'}</span>
    </div>`}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Arrivata', [p.fonte, p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('P.IVA', p.partita_iva)}
    ${campo('Referente', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.telefono, p.cellulare, p.email].filter(Boolean).join(' — '))}
    ${campo('RSPP', p.rspp_ruolo)}
    ${campo('Temi', p.tipi_consulenza)}
    ${campo('Note del modulo', p.note_modulo)}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div class="field"><label>Quesito</label>
      <textarea id="cn-quesito" rows="3">${esc(p.quesito || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>Risposta${p.risposta_da ? ` (di ${esc(p.risposta_da)})` : ''}</label>
      <textarea id="cn-risposta" rows="4" placeholder="La risposta da trasmettere all'impresa">${esc(p.risposta || '')}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="field"><label>Stato pratica</label>
        <select id="cn-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Modalità</label>
        <select id="cn-luogo">${Object.entries(LUOGHI).map(([k, l]) =>
          `<option value="${k}" ${p.luogo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${uscita ? `
      <div class="field"><label>Tecnico assegnato</label>
        <select id="cn-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${p.tecnico_assegnato === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
      <div class="field"><label>Data intervento</label>
        <input type="date" id="cn-dataint" value="${p.data_intervento || ''}"></div>
      <div class="field"><label>Ore (facoltativo)</label>
        <input type="number" step="0.5" id="cn-ore" value="${p.ore ?? ''}"></div>
      <div class="field"><label>Corrispettivo € (facoltativo)</label>
        <input type="number" step="0.01" id="cn-corr" value="${p.corrispettivo ?? ''}"></div>` : ''}
    </div>
    ${uscita ? `<div class="field" style="margin-top:8px"><label>Esito intervento</label>
      <textarea id="cn-esitoint" rows="2">${esc(p.esito_intervento || '')}</textarea></div>` : ''}
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="cn-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="cn-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    ${!uscita ? `
    <h4 style="margin:0 0 6px">Il giro del quesito</h4>
    <p class="hint" style="margin:0 0 10px">Quesito tecnico → coordinatore; la risposta la trasmette la segreteria.
      Se invece serve un sopralluogo, si passa alla corsia con autorizzazione.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="cn-gira">📧 Gira il quesito al coordinatore</button>
      <button class="btn btn-primary" id="cn-trasmetti" ${!(p.risposta || '').trim() && true ? '' : ''}>📧 Trasmetti la risposta all'impresa</button>
      <button class="btn btn-ghost" id="cn-uscita">🚧 Serve un'uscita → richiedi autorizzazione</button>
    </div>` : `
    <h4 style="margin:0 0 6px">Autorizzazione del Direttore (uscita)</h4>
    ${['approvata', 'respinta'].includes(p.aut_stato) ? `
      <p class="hint" style="margin:0 0 10px">Autorizzazione ${p.aut_stato} da <strong>${esc(p.autorizzata_da || '?')}</strong>${p.data_autorizzazione ? ` il ${dataIt(p.data_autorizzazione)}` : ''}
        (${p.aut_modalita === 'app' ? 'dall’app' : 'giro cartaceo'}).
        ${p.aut_drive_url ? `<a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>
      ${p.aut_stato === 'approvata' ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="cn-conferma">📧 Mail di conferma all'impresa</button>
      </div>` : ''}` : `
      <p class="hint" style="margin:0 0 10px">La consulenza in sede o in cantiere comporta una spesa:
        non è lavorabile finché il Direttore non autorizza.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="cn-autpdf">📄 Richiesta di autorizzazione (PDF + mail)</button>
        ${sonoDirettore ? `
          <button class="btn btn-primary" id="cn-approva">✅ Approva (Direttore)</button>
          <button class="btn btn-ghost" id="cn-respingi">⛔ Respingi</button>` : `
          <button class="btn btn-ghost" id="cn-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
      </div>`}`}

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost btn-sm" id="cn-protin">📥 Protocolla la richiesta (IN)</button>' : ''}
      ${!p.protocollo_out_id && p.risposta ? '<button class="btn btn-ghost btn-sm" id="cn-protout">📤 Protocolla la risposta (OUT)</button>' : ''}
    </div>
    <p class="hint" style="margin-top:6px">Il protocollo è facoltativo: scatta se un documento varca la porta
      (la mail del modulo, una PEC, la risposta scritta). La telefonata non si protocolla.</p>
  `);

  $('#cn-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const agg = {
      quesito: $('#cn-quesito').value.trim() || null,
      risposta: $('#cn-risposta').value.trim() || null,
      stato: $('#cn-stato').value,
      luogo: $('#cn-luogo').value,
      note_ufficio: $('#cn-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    };
    if (uscita) {
      agg.tecnico_assegnato = $('#cn-tecnico')?.value || null;
      agg.data_intervento = $('#cn-dataint')?.value || null;
      agg.ore = $('#cn-ore')?.value ? Number($('#cn-ore').value) : null;
      agg.corrispettivo = $('#cn-corr')?.value ? Number($('#cn-corr').value) : null;
      agg.esito_intervento = $('#cn-esitoint')?.value.trim() || null;
    }
    if (agg.risposta && !p.risposta_da) agg.risposta_da = state.email;
    const { error } = await sb.from('s_consulenze').update(agg).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  /* ── corsia immediata: il giro del quesito ── */
  $('#cn-gira')?.addEventListener('click', async () => {
    const quesito = $('#cn-quesito').value.trim() || p.quesito;
    if (!quesito) return toast('Scrivi prima il quesito.', 'err');
    if (!coord) return toast('Coordinatore non trovato nella rubrica interna.', 'err');
    scaricaEml({
      to: coord.email,
      oggetto: `Formedil Padova - Quesito tecnico da ${p.ragione_sociale || 'impresa'} - consulenza n. ${p.progressivo ?? `m${p.id}`}`,
      corpo: `Ciao,

quesito tecnico arrivato ${p.fonte === 'modulo' ? 'dal modulo online' : `per ${p.fonte}`} da ${p.ragione_sociale || '?'}${p.partita_iva ? ` (P.IVA ${p.partita_iva})` : ''}:

${quesito}

Quando hai la risposta, riportala nella pratica: ${APP_URL}#consulenza-${p.id}

Grazie.

${FIRMA_SEGRETERIA}`,
      nomeFile: `quesito-consulenza-${p.progressivo ?? `m${p.id}`}.eml`,
    });
    await sb.from('s_consulenze').update({
      stato: 'girata', girata_a: coord.email, girata_il: new Date().toISOString(),
      quesito, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Bozza per il coordinatore scaricata: aprila da Outlook e premi Invia.', 'ok');
    await render();
  });

  $('#cn-trasmetti')?.addEventListener('click', async () => {
    const risposta = $('#cn-risposta').value.trim();
    if (!risposta) return toast('Scrivi (o incolla) prima la risposta.', 'err');
    if (!p.email && !confirm('La pratica non ha un indirizzo email: la bozza nascerà senza destinatario. Procedo?')) return;
    const rl = [p.rl_titolo || 'Sig.', p.rl_nome, p.rl_cognome].filter(Boolean).join(' ');
    scaricaEml({
      to: p.email || '',
      cc: coord ? [coord.email] : [],
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Riscontro alla Vostra richiesta di consulenza`,
      corpo: `Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `alla c.a. ${rl},` : ''}

con riferimento al Vostro quesito${p.timestamp_modulo ? ` del ${dataIt(p.timestamp_modulo.slice(0, 10))}` : ''}:

${$('#cn-quesito').value.trim() || p.quesito || ''}

Vi rispondiamo quanto segue:

${risposta}

Restiamo a disposizione per ulteriori chiarimenti.
Distinti saluti.

${FIRMA_SEGRETERIA}`,
      nomeFile: `risposta-consulenza-${p.progressivo ?? `m${p.id}`}.eml`,
    });
    await sb.from('s_consulenze').update({
      risposta, risposta_da: p.risposta_da || (p.girata_a ? p.girata_a : state.email),
      trasmessa_il: new Date().toISOString(), stato: 'chiusa',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Bozza per l\'impresa scaricata: aprila da Outlook e premi Invia. Pratica chiusa.', 'ok');
    await render();
  });

  $('#cn-uscita')?.addEventListener('click', async () => {
    if (!confirm('Passo la pratica alla corsia con uscita: servirà l\'autorizzazione del Direttore. Procedo?')) return;
    await sb.from('s_consulenze').update({
      corsia: 'uscita', aut_stato: 'da_richiedere',
      luogo: ['sede_impresa', 'cantiere'].includes($('#cn-luogo').value) ? $('#cn-luogo').value : 'sede_impresa',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Pratica passata alla corsia con autorizzazione.', 'ok');
    await render();
    apriPratica(p.id);
  });

  /* ── corsia con uscita: autorizzazione ── */
  $('#cn-autpdf')?.addEventListener('click', (ev) => richiestaAutorizzazione(p, ev.currentTarget));
  $('#cn-approva')?.addEventListener('click', (ev) => decidiDaApp(p, 'approvata', ev.currentTarget));
  $('#cn-respingi')?.addEventListener('click', (ev) => decidiDaApp(p, 'respinta', ev.currentTarget));
  $('#cn-cartacea')?.addEventListener('click', () => registraCartacea(p));
  $('#cn-conferma')?.addEventListener('click', () => mailConferma(p));

  /* ── protocollo facoltativo ── */
  $('#cn-protin')?.addEventListener('click', () => protocolla(p, 'IN'));
  $('#cn-protout')?.addEventListener('click', () => protocolla(p, 'OUT'));
}

function campiConsulenza(p) {
  return [
    ['Pratica', `Consulenza n° ${p.progressivo || p.id}${p.fonte && p.fonte !== 'modulo' ? ` (arrivata per ${p.fonte})` : ' (modulo online)'}`],
    ['Data richiesta', p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10).split('-').reverse().join('/') : '—'],
    ['TipologiaRichiesta', `Richiesta Consulenza ${p.luogo === 'cantiere' ? 'in Cantiere' : 'in sede Impresa'}`],
    ['Impresa', [p.ragione_sociale, p.partita_iva ? `P.IVA ${p.partita_iva}` : ''].filter(Boolean).join(' — ')],
    ['CEIV', p.esito_ceiv === 'iscritta' ? `iscritta (cod. ${p.codice_ceiv_dich || '—'})` : p.esito_ceiv === 'non_iscritta' ? 'NON iscritta' : 'da verificare'],
    ['Referente', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.telefono, p.cellulare, p.email].filter(Boolean).join(' — ')],
    ['Quesito', p.quesito],
    ['Temi', p.tipi_consulenza],
    ['Note', p.note_modulo],
  ];
}

async function richiestaAutorizzazione(p, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const tecnico = nomeTecnico($('#cn-tecnico')?.value || p.tecnico_assegnato);
    const { pdfRichiestaAutCampi } = await import('./segnalazioni-doc.js');
    const byte = await pdfRichiestaAutCampi(campiConsulenza(p), tecnico,
      'Ai sensi della procedura sui servizi CPT, si chiede al Direttore l’autorizzazione a effettuare la consulenza presso l’impresa richiedente.');
    const n = p.progressivo ?? `m${p.id}`;
    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      cc: coordinatore() ? [coordinatore().email] : [],
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Richiesta di autorizzazione - consulenza n. ${n}`,
      corpo: `Egr. Direttore,

vogliate trovare in allegato la richiesta di autorizzazione per la consulenza n. ${n} presso ${p.ragione_sociale || '?'} (${LUOGHI[p.luogo] || 'in sede impresa'}).
Tecnico proposto: ${tecnico || 'da assegnare'}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#consulenza-${p.id}

In alternativa resta il giro cartaceo: firmare il foglio allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: `richiesta-autorizzazione_consulenza-${n}_${slug(p.ragione_sociale)}.pdf`, byte }],
      nomeFile: `richiesta-autorizzazione-consulenza-${n}.eml`,
    });
    await sb.from('s_consulenze').update({
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
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la consulenza n° ${p.progressivo ?? p.id} presso ${p.ragione_sociale}? Il visto col tuo nome finisce nel documento.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
    const tecnico = nomeTecnico($('#cn-tecnico')?.value || p.tecnico_assegnato);
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
    const byte = await pdfAutorizzazioneCampi(campiConsulenza(p), tecnico, visto, firmaByte,
      'Autorizzazione consulenza presso l’impresa');

    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle consulenze non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const n = p.progressivo ?? `m${p.id}`;
    const nomeFile = `${data}_AUT_CPT-Padova_consulenza-${n}-${slug(p.ragione_sociale)}${esito === 'respinta' ? '_respinta' : ''}.pdf`;
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const { error } = await sb.from('s_consulenze').update({
      aut_stato: esito,
      aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id,
      aut_drive_url: su.drive_url,
      tecnico_assegnato: $('#cn-tecnico')?.value || p.tecnico_assegnato,
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
  apriDrawer(`Esito cartaceo — consulenza n° ${p.progressivo ?? p.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="cc-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="cc-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="cc-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <div class="field"><label>Link Drive della scansione (facoltativo)</label><input id="cc-link"></div>
    <button class="btn btn-primary" id="cc-salva" style="margin-top:10px">Registra</button>`);
  $('#cc-salva').addEventListener('click', async (ev) => {
    const esito = $('#cc-esito').value;
    attendi(ev.currentTarget, true);
    const fid = idDaLink($('#cc-link').value);
    const { error } = await sb.from('s_consulenze').update({
      aut_stato: esito, aut_modalita: 'cartacea',
      autorizzata_da: $('#cc-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#cc-data').value || oggiIso(),
      aut_drive_id: fid, aut_drive_url: fid ? $('#cc-link').value.trim() : null,
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

/* riscontro della corsia con uscita: solo mail di conferma (scelta utente) */
function mailConferma(p) {
  const rl = [p.rl_titolo || 'Sig.', p.rl_nome, p.rl_cognome].filter(Boolean).join(' ');
  scaricaEml({
    to: p.email || '',
    cc: coordinatore() ? [coordinatore().email] : [],
    oggetto: 'Formedil Padova - Area Sicurezza e Salute - Conferma consulenza',
    corpo: `Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `alla c.a. ${rl},` : ''}

con riferimento alla Vostra richiesta di consulenza, Vi confermiamo che l'intervento è stato autorizzato.
${p.tecnico_assegnato ? `Il tecnico incaricato è ${nomeTecnico(p.tecnico_assegnato)}, che Vi contatterà per concordare l'appuntamento.` : 'Sarete contattati per concordare l\'appuntamento.'}
${p.data_intervento ? `Data prevista: ${dataIt(p.data_intervento)}.` : ''}

Distinti saluti.

${FIRMA_SEGRETERIA}`,
    nomeFile: `conferma-consulenza-${p.progressivo ?? `m${p.id}`}.eml`,
  });
  toast('Bozza di conferma scaricata: aprila da Outlook e premi Invia.', 'ok');
}

/* protocollo facoltativo, precompilato; il numero si collega da solo */
async function protocolla(p, direzione) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  const base = {
    data_prot: oggiIso(),
    data_doc: direzione === 'IN' ? (p.timestamp_modulo || '').slice(0, 10) || null : oggiIso(),
    impresa_nome: p.ragione_sociale || null,
    impresa_id: p.impresa_id || null,
    persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
    tipo_doc_id: TIPO_DOC_CONS,
    mezzo: p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  };
  const dati = direzione === 'IN'
    ? { ...base,
        oggetto: `Richiesta di consulenza — ${p.tipi_consulenza || 'sicurezza sul lavoro'}`,
        note: p.quesito || p.note_modulo || null,
        sintesi: `Consulenza n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`} — corsia ${p.corsia}.` }
    : { ...base,
        oggetto: 'Riscontro alla richiesta di consulenza',
        note: p.risposta || null,
        sintesi: `Risposta alla consulenza n° ${p.progressivo ?? `m${p.id}`}${p.risposta_da ? ` (risposta di ${p.risposta_da})` : ''}.`,
        ufficio: 'Segreteria Area Sicurezza e Salute' };
  mod.apriForm(direzione, dati, true, async (nuovo) => {
    const campoId = direzione === 'IN' ? 'protocollo_in_id' : 'protocollo_out_id';
    const { error } = await sb.from('s_consulenze').update({
      [campoId]: nuovo.id,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla consulenza n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast(`Maschera ${direzione} precompilata: allega il documento e salva — il numero si collega da solo.`, 'ok');
}
