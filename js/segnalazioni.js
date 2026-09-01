/* ============================================================
   Segnalazioni di cantiere in arrivo dall'esterno.

   Le segnalazioni arrivano dal modulo online (foglio Google dei
   servizi CPT, scheda «Segnalazione Cantiere» — import alle 6:30
   con pre-istruttoria: proposta del tecnico di zona da
   tecnici_zone) oppure per telefono, mail, PEC: per quelle c'è
   l'inserimento manuale.

   Il flusso segue la regola dei servizi CPT (2026-08-07): ogni
   visita su segnalazione va AUTORIZZATA DAL DIRETTORE prima di
   essere avviata.
   - «Richiesta di autorizzazione»: PDF come la stampa Access,
     bozza mail al Direttore. Documento interno, niente protocollo.
   - Il Direttore può approvare DALL'APP (il visto col suo nome,
     data-ora e utente finisce nel PDF di autorizzazione, con la
     firma se configurata) — oppure resta il giro cartaceo, che
     la segreteria registra a mano.
   - Dopo l'autorizzazione: protocollo IN della segnalazione,
     riscontro al segnalante (esito completo per chi è del
     sistema, presa d'atto per gli altri) protocollato OUT.

   ⚠️ Privacy: il nome del segnalante non arriva mai all'impresa.
   Resta nella pratica e nel protocollo.

   Lo «Storico Access» in fondo è la tabella VisiteCassaEdile
   (1.078 richieste 2011-2026, tutte le tipologie): sola
   consultazione, per precedenti e statistiche.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { APP_URL } from './config.js';
import { risolviCartella, caricaByte, leggiByte, idDaLink } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';

let pratiche = [];
let tecnici = [];
let zone = [];
let conf = {};
let protDi = {};             // id protocollo → riga s_protocollo (per mostrare i numeri)
let storico = null;          // caricato solo quando si apre la scheda
let filtro = 'aperte';
let cercaStorico = '';

const STATI = {
  ricevuta: 'Ricevuta', istruita: 'Istruita', autorizzata: 'Autorizzata',
  assegnata: 'Assegnata', riscontrata: 'Riscontrata', chiusa: 'Chiusa', scartata: 'Scartata',
};
const AUT = {
  da_richiedere: ['dt-senzadata', 'da richiedere'],
  richiesta: ['dt-senzadata', 'richiesta al Direttore'],
  approvata: ['dt-ok', 'APPROVATA'],
  respinta: ['dt-scaduto', 'respinta'],
};
const TIPI_SEGNALANTE = ['sindacato', 'ente', 'comune', 'ceiv', 'presidenza', 'impresa', 'privato', 'anonimo', 'altro'];
const FONTI = ['telefono', 'email', 'pec', 'verbale', 'altro'];
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Segnalazione Cantieri al CPT';
const TIPO_DOC_SEGN = 54;   // s_tipo_doc «Segnalazione cantiere»

/* i segnalanti «di sistema» ricevono l'esito completo; gli altri due
   righe di presa d'atto (regola dell'utente, 31/08/2026) */
const DI_SISTEMA = ['sindacato', 'ente', 'comune', 'ceiv', 'presidenza'];

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function carica() {
  const [{ data: p }, { data: t }, { data: z }, { data: c }] = await Promise.all([
    sb.from('s_segnalazioni').select('*').order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true),
    zone.length ? Promise.resolve({ data: zone }) : sb.from('tecnici_zone').select('email, comune_nome'),
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'direttore_nome', 'direttore_firma_id']),
  ]);
  pratiche = p || [];
  tecnici = t || [];
  zone = z || [];
  conf = Object.fromEntries((c || []).map((r) => [r.chiave, r.valore]));

  /* i numeri di protocollo collegati (per il Direttore la query è
     chiusa dalle policy: si mostra solo «protocollata») */
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

const normComune = (s) => String(s || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim();
function tecnicoDiZona(comune) {
  const c = normComune(comune);
  if (!c) return null;
  const match = zone.filter((z) => {
    const zc = normComune(z.comune_nome);
    return zc === c || c.startsWith(zc + ' ') || zc.startsWith(c + ' ');
  });
  const email = [...new Set(match.map((z) => z.email))];
  return email.length === 1 ? email[0] : null;
}

const emailCoordinatore = () =>
  (RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || {}).email || null;

/* ══════════ elenco ══════════ */

/* il contatore sulla voce di menu: quante pratiche aspettano
   un'autorizzazione (da richiedere o già sul tavolo del Direttore) */
function aggiornaBadgeNav() {
  const n = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato)
    && ['da_richiedere', 'richiesta'].includes(p.aut_stato)).length;
  const btn = document.querySelector('.nav-item[data-view="segnalazioni"]');
  if (btn) btn.textContent = `🚨 Segnalazioni cantiere${n ? ` (${n})` : ''}`;
}

export async function render() {
  const host = $('#segnalazioni-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();
  aggiornaBadgeNav();
  if (filtro === 'storico') return renderStorico(host);

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const daRichiedere = aperte.filter((p) => p.aut_stato === 'da_richiedere');
  const dalDirettore = aperte.filter((p) => p.aut_stato === 'richiesta');
  const daLavorare = aperte.filter((p) => p.aut_stato === 'approvata' && p.stato !== 'riscontrata');

  const visibili = pratiche.filter((p) =>
    filtro === 'tutte' ? true :
    filtro === 'aperte' ? !['chiusa', 'scartata', 'riscontrata'].includes(p.stato) :
    filtro === 'autorizzare' ? (!['chiusa', 'scartata'].includes(p.stato) && ['da_richiedere', 'richiesta'].includes(p.aut_stato)) :
    ['chiusa', 'scartata', 'riscontrata'].includes(p.stato));

  const codici = (p) => {
    const pezzi = [];
    if (p.protocollo_in_id) pezzi.push(protDi[p.protocollo_in_id] ? `IN ${codiceProtocollo(protDi[p.protocollo_in_id])}` : 'IN ✓');
    if (p.protocollo_out_id) pezzi.push(protDi[p.protocollo_out_id] ? `OUT ${codiceProtocollo(protDi[p.protocollo_out_id])}` : 'OUT ✓');
    return pezzi.join('<br>') || '—';
  };

  const righe = visibili.map((p) => {
    const [cls, lbl] = AUT[p.aut_stato] || ['', p.aut_stato || '—'];
    return `<tr data-id="${p.id}">
      <td>${p.progressivo ?? `m${p.id}`}</td>
      <td>${p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.notificante || '?')}</strong>${p.segnalante_tipo ? ` <span class="hint">(${esc(p.segnalante_tipo)})</span>` : ''}</td>
      <td>${esc(p.comune_cantiere || '—')}</td>
      <td><span class="dt-cella ${cls}" style="padding:2px 8px">${esc(lbl)}</span></td>
      <td>${esc(nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || '—')}${!p.tecnico_assegnato && p.tecnico_proposto ? ' <span class="hint">(proposto)</span>' : ''}</td>
      <td class="hint" style="white-space:nowrap">${codici(p)}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${daRichiedere.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">✋ ${daRichiedere.length} da mandare al Direttore</span>
      <span class="dt-cella ${dalDirettore.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⏳ ${dalDirettore.length} sul tavolo del Direttore</span>
      <span class="dt-cella ${daLavorare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">✅ ${daLavorare.length} autorizzate da lavorare</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="sg-f">
        ${[['aperte', 'Da lavorare'], ['autorizzare', `⏳ Da autorizzare${daRichiedere.length + dalDirettore.length ? ` (${daRichiedere.length + dalDirettore.length})` : ''}`], ['tutte', 'Tutte'], ['chiuse', 'Chiuse'], ['storico', '📜 Storico Access']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="sg-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="sg-nuova">+ Nuova segnalazione</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Segnalante</th><th>Comune cantiere</th><th>Autorizzazione</th><th>Tecnico</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${righe || `<tr><td colspan="8" class="empty">Nessuna segnalazione ${filtro === 'aperte' ? 'da lavorare' : ''}.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      L'import dal foglio gira da solo ogni mattina alle 6:30. Ogni visita su segnalazione va
      autorizzata dal Direttore prima di essere avviata; il nome del segnalante non arriva mai all'impresa.
    </p>`;

  $('#sg-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#sg-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.segnalazioni?.nuove || 0;
    toast(n ? `${n} segnalazioni nuove importate.` : 'Nessuna segnalazione nuova.', 'ok');
    if (n) render();
  });
  $('#sg-nuova').addEventListener('click', nuovaSegnalazione);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* lo storico Access: sola consultazione, con ricerca */
async function renderStorico(host) {
  if (!storico) {
    /* a blocchi: 1.078 righe contro il tetto di 1.000 per chiamata */
    storico = [];
    for (let da = 0; ; da += 1000) {
      const { data } = await sb.from('s_servizi_storico').select('*')
        .order('id', { ascending: false }).range(da, da + 999);
      storico.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  const q = cercaStorico.toLowerCase();
  const filtrate = q
    ? storico.filter((r) => [r.richiedente, r.impresa, r.comune_cantiere, r.tipologia, r.tecnico, r.comunicazione, String(r.id)]
        .some((v) => (v || '').toLowerCase().includes(q)))
    : storico;
  const MOSTRA = 150;
  const righe = filtrate.slice(0, MOSTRA).map((r) => `<tr data-sid="${r.id}">
    <td>${r.id}</td>
    <td>${r.data_richiesta ? dataIt(r.data_richiesta) : '—'}</td>
    <td>${esc((r.tipologia || '').replace(/^Richiesta /, ''))}</td>
    <td>${esc(r.richiedente || '—')}</td>
    <td>${esc(r.impresa || '—')}</td>
    <td>${esc(r.comune_cantiere || '—')}</td>
    <td>${esc(r.tecnico || '—')}</td>
    <td>${esc(r.valutazione || '—')}</td>
  </tr>`).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="sg-f">
        ${[['aperte', 'Da lavorare'], ['autorizzare', '⏳ Da autorizzare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse'], ['storico', '📜 Storico Access']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <input id="sg-cerca" class="inp" type="search" style="max-width:340px"
        placeholder="Cerca in richiedente, impresa, comune, tecnico…" value="${esc(cercaStorico)}">
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Tipologia</th><th>Richiedente</th><th>Impresa</th><th>Comune</th><th>Tecnico</th><th>Valutazione</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="8" class="empty">Niente con questa ricerca.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Registro richieste/servizi di Access (VisiteCassaEdile), 2011-2026: ${storico.length} pratiche di tutte le
      tipologie, ${filtrate.length} con questa ricerca${filtrate.length > MOSTRA ? ` (mostrate le prime ${MOSTRA})` : ''}.
      L'ID è il numero della vecchia serie «richieste visite», chiusa col registro unico dal 1/10/2026.
    </p>`;

  $('#sg-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#sg-cerca').addEventListener('input', (e) => { cercaStorico = e.target.value; renderStorico(host); });
  host.querySelectorAll('tbody tr[data-sid]').forEach((tr) =>
    tr.addEventListener('click', () => apriStorico(Number(tr.dataset.sid))));
}

function apriStorico(id) {
  const r = (storico || []).find((x) => x.id === id);
  if (!r) return;
  const riga = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';
  apriDrawer(`Storico n° ${r.id} — ${r.tipologia || ''}`, '', `
    ${riga('Data richiesta', r.data_richiesta ? dataIt(r.data_richiesta) : null)}
    ${riga('Mezzo', r.mezzo)}${riga('Tipo', r.tipo_richiesta)}
    ${riga('Richiedente', r.richiedente)}${riga('Referente', [r.referente, r.cell_referente].filter(Boolean).join(' — '))}
    ${riga('Impresa', r.impresa)}${riga('Cantiere', r.cantiere)}
    ${riga('Indirizzo', [r.indirizzo_cantiere, r.comune_cantiere].filter(Boolean).join(' — '))}
    ${riga('Oggetto', r.oggetto)}
    ${r.comunicazione ? `<div class="dt-doc-riga"><strong>Comunicazione:</strong><br>${esc(r.comunicazione)}</div>` : ''}
    ${riga('Tecnico', r.tecnico)}${riga('Verbale', [r.verbale_visita, r.data_verbale].filter(Boolean).join(' del '))}
    ${riga('Valutazione', r.valutazione)}${riga('Note tecnico', r.note_tecnico)}
    ${riga('Note', r.note)}
    ${riga('Approvato', r.approvato === true ? 'sì' : r.approvato === false ? 'no' : null)}
    ${riga('Pratica chiusa', r.pratica_chiusa === true ? 'sì' : r.pratica_chiusa === false ? 'no' : null)}
    <p class="hint" style="margin-top:10px">Archivio Access: sola consultazione.</p>`);
}

/* ══════════ inserimento manuale ══════════ */

function nuovaSegnalazione() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="ns-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Nuova segnalazione (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per le segnalazioni arrivate fuori dal modulo online (telefono, mail, PEC, verbale).</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Arrivata per *</label>
        <select id="ns-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
      <div class="field"><label>Chi segnala (tipo)</label>
        <select id="ns-tipo"><option value="">—</option>${TIPI_SEGNALANTE.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
    </div>
    ${campo('notificante', 'Segnalante (nome / ente) *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    ${campo('ind', 'Indirizzo cantiere')}
    ${campo('comune', 'Comune cantiere', 'text', 'es. PADOVA - Q3 Est, oppure il comune')}
    <div class="field"><label>Motivo della segnalazione *</label><textarea id="ns-motivo" rows="4"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('lavori', 'Stato dei lavori')}${campo('imprese', 'Imprese presenti')}
    </div>
    <div class="field"><label>Note</label><textarea id="ns-note"></textarea></div>
    <button class="btn btn-primary" id="ns-crea" style="margin-top:10px">Crea la pratica</button>`);

  $('#ns-crea').addEventListener('click', async (ev) => {
    const notificante = $('#ns-notificante').value.trim();
    const motivo = $('#ns-motivo').value.trim();
    if (!notificante || !motivo) return toast('Servono segnalante e motivo.', 'err');
    attendi(ev.currentTarget, true);
    const comune = $('#ns-comune').value.trim() || null;
    const { data: nuova, error } = await sb.from('s_segnalazioni').insert({
      fonte: $('#ns-fonte').value,
      timestamp_modulo: new Date().toISOString(),
      notificante,
      segnalante_tipo: $('#ns-tipo').value || null,
      telefono: $('#ns-tel').value.trim() || null,
      email: $('#ns-email').value.trim() || null,
      ind_cantiere: $('#ns-ind').value.trim() || null,
      comune_cantiere: comune,
      motivo,
      stato_lavori: $('#ns-lavori').value.trim() || null,
      imprese_presenti: $('#ns-imprese').value.trim() || null,
      note_modulo: $('#ns-note').value.trim() || null,
      tecnico_proposto: tecnicoDiZona(comune),
      aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Pratica creata.', 'ok');
    await render();
    apriPratica(nuova.id);
  });
}

/* ══════════ dettaglio e istruttoria ══════════ */

export async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  const [clsAut, lblAut] = AUT[p.aut_stato] || ['', p.aut_stato];
  const foto = String(p.foto_urls || '').split(';').map((s) => s.trim()).filter(Boolean);
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';
  const sonoDirettore = state.email && conf.direttore_email &&
    state.email.toLowerCase() === conf.direttore_email.toLowerCase();
  const diSistema = DI_SISTEMA.includes(p.segnalante_tipo);

  apriDrawer(`Segnalazione n° ${p.progressivo ?? `m${p.id}`} — ${p.comune_cantiere || p.notificante || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${clsAut}"></span>
      <span class="dt-quadro-req">Autorizzazione Direttore</span>
      <span class="dt-quadro-stato">${esc(lblAut)}${p.autorizzata_da ? ` — ${esc(p.autorizzata_da)} il ${p.data_autorizzazione ? dataIt(p.data_autorizzazione) : '?'}${p.aut_modalita ? ` (${p.aut_modalita})` : ''}` : ''}
        ${p.aut_drive_url ? ` · <a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">documento</a>` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.tecnico_assegnato ? 'dt-ok' : p.tecnico_proposto ? 'dt-senzadata' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Tecnico</span>
      <span class="dt-quadro-stato">${p.tecnico_assegnato
        ? `assegnato: ${esc(nomeTecnico(p.tecnico_assegnato))}${p.tecnico_proposto && p.tecnico_proposto !== p.tecnico_assegnato
            ? ` — la zona proponeva ${esc(nomeTecnico(p.tecnico_proposto))} (cambio della segreteria)` : ''}`
        : p.tecnico_proposto
          ? `proposto dalla zona: ${esc(nomeTecnico(p.tecnico_proposto))} — da confermare o cambiare se non disponibile nei tempi`
          : 'nessuna proposta dalla zona: da assegnare'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.protocollo_in_id ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Protocollo IN</span>
      <span class="dt-quadro-stato">${p.protocollo_in_id
        ? `<strong>${esc(protDi[p.protocollo_in_id] ? codiceProtocollo(protDi[p.protocollo_in_id]) : 'protocollata')}</strong>${!state.soloDirettore && protDi[p.protocollo_in_id] ? ` · <a href="#" data-apri-prot="${p.protocollo_in_id}">apri nel registro</a>` : ''}`
        : 'da protocollare (il PDF di riepilogo del modulo è il documento)'}</span>
    </div>
    ${p.protocollo_out_id ? `
    <div class="dt-quadro-riga">
      <span class="dt-dot dt-ok"></span>
      <span class="dt-quadro-req">Riscontro OUT</span>
      <span class="dt-quadro-stato"><strong>${esc(protDi[p.protocollo_out_id] ? codiceProtocollo(protDi[p.protocollo_out_id]) : 'protocollato')}</strong>${p.riscontro_tipo ? ` — ${p.riscontro_tipo === 'esito' ? 'esito completo' : 'presa d’atto'}` : ''}${!state.soloDirettore && protDi[p.protocollo_out_id] ? ` · <a href="#" data-apri-prot="${p.protocollo_out_id}">apri nel registro</a>` : ''}${p.riscontro_drive_url ? ` · <a href="${esc(p.riscontro_drive_url)}" target="_blank" rel="noopener">lettera</a>` : ''}</span>
    </div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Arrivata', [p.fonte, p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('Segnalante', p.notificante)}
    ${campo('Contatti', [p.telefono, p.email].filter(Boolean).join(' — '))}
    ${p.motivo ? `<div class="dt-doc-riga"><strong>Motivo:</strong><br>${esc(p.motivo)}</div>` : ''}
    ${campo('Stato lavori', p.stato_lavori)}
    ${campo('Imprese presenti', p.imprese_presenti)}
    ${campo('Cantiere', [p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(' — '))}
    ${campo('Note del modulo', p.note_modulo)}
    ${foto.length ? `<div class="dt-doc-riga"><strong>Foto:</strong> ${foto.map((u, i) =>
      `<a href="${esc(u)}" target="_blank" rel="noopener">foto ${i + 1}</a>`).join(' · ')}</div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="sg-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Chi segnala (tipo)</label>
        <select id="sg-tiposeg"><option value="">—</option>${TIPI_SEGNALANTE.map((t) =>
          `<option value="${t}" ${p.segnalante_tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Tecnico assegnato</label>
        <select id="sg-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${(p.tecnico_assegnato || p.tecnico_proposto) === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
      <div class="field"><label>Data verbale visita</label>
        <input type="date" id="sg-dataverb" value="${p.data_verbale || ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Esito della visita (sintesi)</label>
      <textarea id="sg-esitovisita" rows="2">${esc(p.esito_visita || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>Risposta al segnalante (testo per la lettera di esito)</label>
      <textarea id="sg-risposta" rows="4" placeholder="Il testo che finisce nel campo «Risposta» della lettera — dal rapporto di sopralluogo.">${esc(p.risposta_testo || '')}</textarea></div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="sg-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="sg-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Autorizzazione del Direttore</h4>
    ${p.aut_stato === 'approvata' || p.aut_stato === 'respinta' ? `
      <p class="hint" style="margin:0 0 10px">Autorizzazione ${p.aut_stato === 'approvata' ? 'approvata' : 'respinta'}
        da <strong>${esc(p.autorizzata_da || '?')}</strong>${p.data_autorizzazione ? ` il ${dataIt(p.data_autorizzazione)}` : ''}
        (${p.aut_modalita === 'app' ? 'dall’app' : 'giro cartaceo'}).
        ${p.aut_drive_url ? `<a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>
    ` : `
      <p class="hint" style="margin:0 0 10px">La visita non è lavorabile finché il Direttore non autorizza.
        Prepara la richiesta (PDF + bozza mail), poi: il Direttore approva da qui col suo accesso,
        oppure firma il foglio e la segreteria registra l'esito.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="sg-autpdf">📄 Richiesta di autorizzazione (PDF + mail)</button>
        ${sonoDirettore ? `
          <button class="btn btn-primary" id="sg-approva">✅ Approva (Direttore)</button>
          <button class="btn btn-ghost" id="sg-respingi">⛔ Respingi</button>` : `
          <button class="btn btn-ghost" id="sg-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
      </div>
    `}

    ${p.aut_stato === 'approvata' ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Protocollo e riscontro</h4>
    <p class="hint" style="margin:0 0 10px">
      ${diSistema
        ? 'Segnalante <strong>di sistema</strong>: riscontro con l’<strong>esito completo</strong> (modello «Risposta») — compila prima il campo qui sopra.'
        : p.segnalante_tipo
          ? 'Segnalante fuori dal sistema: <strong>presa d’atto</strong> — ringraziamento e presa in carico, senza merito.'
          : 'Scegli prima il <strong>tipo di segnalante</strong> qui sopra: decide quale riscontro parte.'}
      La lettera nasce protocollata in uscita nel registro unico e depositata nella cartella del vault.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost" id="sg-protin">📥 Protocolla la segnalazione (IN)</button>' : ''}
      ${!p.protocollo_out_id ? `
        <button class="btn btn-primary" id="sg-riscontro" ${!p.segnalante_tipo ? 'disabled' : ''}>
          📄 Protocolla e prepara il riscontro (${diSistema ? 'esito' : 'presa d’atto'})</button>` : `
        <button class="btn btn-ghost" id="sg-eml">📧 Scarica di nuovo la bozza mail</button>`}
    </div>` : ''}
  `);

  $('#sg-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_segnalazioni').update({
      stato: $('#sg-stato').value,
      segnalante_tipo: $('#sg-tiposeg').value || null,
      tecnico_assegnato: $('#sg-tecnico').value || null,
      data_verbale: $('#sg-dataverb').value || null,
      esito_visita: $('#sg-esitovisita').value.trim() || null,
      risposta_testo: $('#sg-risposta').value.trim() || null,
      note_ufficio: $('#sg-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  $('#drawer-body').querySelectorAll('[data-apri-prot]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      chiudiDrawer();
      const mod = await import('./protocollo.js');
      mod.apriDettaglio(Number(a.dataset.apriProt));
    }));

  $('#sg-autpdf')?.addEventListener('click', (ev) => richiestaAutorizzazione(p, ev.currentTarget));
  $('#sg-approva')?.addEventListener('click', (ev) => decidiDaApp(p, 'approvata', ev.currentTarget));
  $('#sg-respingi')?.addEventListener('click', (ev) => decidiDaApp(p, 'respinta', ev.currentTarget));
  $('#sg-cartacea')?.addEventListener('click', () => registraCartacea(p));
  $('#sg-protin')?.addEventListener('click', () => protocollaIn(p));
  $('#sg-riscontro')?.addEventListener('click', (ev) => preparaRiscontro(p, ev.currentTarget));
  $('#sg-eml')?.addEventListener('click', (ev) => riscaricaEml(p, ev.currentTarget));
}

/* ── richiesta di autorizzazione: PDF + bozza mail al Direttore ── */
async function richiestaAutorizzazione(p, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const tecnico = nomeTecnico($('#sg-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    const { pdfRichiestaAut } = await import('./segnalazioni-doc.js');
    const byte = await pdfRichiestaAut(p, tecnico);
    const n = p.progressivo ?? `m${p.id}`;
    const nome = `richiesta-autorizzazione_segnalazione-${n}_${slug(p.comune_cantiere || p.notificante)}.pdf`;

    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      cc: [emailCoordinatore()].filter(Boolean),
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Richiesta di autorizzazione - visita su segnalazione n. ${n}`,
      corpo: `Egr. Direttore,

vogliate trovare in allegato la richiesta di autorizzazione per la visita su segnalazione n. ${n} (${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(' — ') || 'cantiere da individuare'}).
Tecnico proposto: ${tecnico || 'da assegnare'}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#segnalazione-${p.id}

In alternativa resta il giro cartaceo: firmare il foglio allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome, byte }],
      nomeFile: `richiesta-autorizzazione-segnalazione-${n}.eml`,
    });

    await sb.from('s_segnalazioni').update({
      aut_stato: p.aut_stato === 'da_richiedere' ? 'richiesta' : p.aut_stato,
      aut_richiesta_il: new Date().toISOString(),
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Bozza mail al Direttore scaricata: aprila da Outlook e premi Invia.', 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ── approvazione dall'app: solo col login del Direttore ── */
async function decidiDaApp(p, esito, btn) {
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la visita su segnalazione n° ${p.progressivo ?? p.id}? Il visto col tuo nome finisce nel documento di autorizzazione.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
    const tecnico = nomeTecnico($('#sg-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    let firmaByte = null;
    if (conf.direttore_firma_id) {
      try { firmaByte = await leggiByte(conf.direttore_firma_id); }
      catch { /* senza firma il visto vale lo stesso */ }
    }
    const adesso = new Date();
    const visto = {
      esito,
      nome: conf.direttore_nome || 'Il Direttore',
      data_ora: `${dataIt(adesso.toISOString().slice(0, 10))} ore ${String(adesso.getHours()).padStart(2, '0')}:${String(adesso.getMinutes()).padStart(2, '0')}`,
      utente: state.email,
      note,
    };
    const { pdfAutorizzazione } = await import('./segnalazioni-doc.js');
    const byte = await pdfAutorizzazione(p, tecnico, visto, firmaByte);

    /* deposito nella cartella del vault, nome a convenzione AUT */
    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle segnalazioni non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const n = p.progressivo ?? `m${p.id}`;
    const nomeFile = `${data}_AUT_CPT-Padova_visita-su-segnalazione-${n}-${slug(p.comune_cantiere || p.notificante)}${esito === 'respinta' ? '_respinta' : ''}.pdf`;
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const { error } = await sb.from('s_segnalazioni').update({
      aut_stato: esito,
      aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id,
      aut_drive_url: su.drive_url,
      tecnico_assegnato: $('#sg-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
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

/* ── giro cartaceo: la segreteria registra l'esito ── */
function registraCartacea(p) {
  apriDrawer(`Esito cartaceo — segnalazione n° ${p.progressivo ?? p.id}`, '', `
    <p class="hint" style="margin:0 0 10px">Il Direttore ha firmato il foglio: registra qui l'esito e,
      se c'è, il link della scansione su Drive.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="ca-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="ca-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="ca-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <div class="field"><label>Link Drive della scansione (facoltativo)</label><input id="ca-link" placeholder="incolla il link del PDF firmato"></div>
    <div class="field"><label>Note</label><input id="ca-note"></div>
    <button class="btn btn-primary" id="ca-salva" style="margin-top:10px">Registra</button>`);

  $('#ca-salva').addEventListener('click', async (ev) => {
    const esito = $('#ca-esito').value;
    attendi(ev.currentTarget, true);
    const fid = idDaLink($('#ca-link').value);
    const { error } = await sb.from('s_segnalazioni').update({
      aut_stato: esito,
      aut_modalita: 'cartacea',
      autorizzata_da: $('#ca-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#ca-data').value || oggiIso(),
      aut_note: $('#ca-note').value.trim() || null,
      aut_drive_id: fid,
      aut_drive_url: fid ? $('#ca-link').value.trim() : null,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Registrazione non riuscita: ' + error.message, 'err');
    toast('Esito registrato.', 'ok');
    await render();
    apriPratica(p.id);
  });
}

/* ── protocollo IN della segnalazione ── */
async function protocollaIn(p) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  mod.apriForm('IN', {
    data_prot: oggiIso(),
    data_doc: (p.timestamp_modulo || '').slice(0, 10) || null,
    impresa_nome: p.imprese_presenti && !/non conosciut/i.test(p.imprese_presenti) ? p.imprese_presenti : null,
    persona: p.notificante || null,
    oggetto: `Segnalazione di cantiere — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'luogo da individuare'}`,
    note: p.motivo || null,
    sintesi: `Segnalazione n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`}. ` +
      `Segnalante: ${p.notificante || '?'}${p.segnalante_tipo ? ` (${p.segnalante_tipo})` : ''} — il nome non va all'impresa. ` +
      `Tecnico: ${nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || 'da assegnare'}.`,
    tipo_doc_id: TIPO_DOC_SEGN,
    mezzo: p.fonte === 'modulo' ? 'e-mail' : p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  }, true, async (nuovo) => {
    /* il numero appena assegnato si collega da solo alla pratica */
    const { error } = await sb.from('s_segnalazioni').update({
      protocollo_in_id: nuovo.id,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla segnalazione n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il PDF di riepilogo del modulo e salva — il numero si collega da solo alla pratica.', 'ok');
}

/* ── riscontro al segnalante: protocollo OUT + lettera + Drive + mail ── */
async function preparaRiscontro(p, btn) {
  const tipoSeg = $('#sg-tiposeg')?.value || p.segnalante_tipo;
  if (!tipoSeg) return toast('Scegli prima il tipo di segnalante.', 'err');
  const tipo = DI_SISTEMA.includes(tipoSeg) ? 'esito' : 'presa_atto';
  const rispostaTesto = $('#sg-risposta')?.value.trim() || p.risposta_testo;
  if (tipo === 'esito' && !rispostaTesto) {
    return toast('Per il riscontro con esito serve il testo della risposta (campo qui sopra).', 'err');
  }
  if (!p.email && !confirm('La pratica non ha un indirizzo email del segnalante: la bozza mail nascerà senza destinatario. Procedo lo stesso?')) return;
  if (!confirm(`Preparo il riscontro (${tipo === 'esito' ? 'ESITO COMPLETO' : 'presa d’atto'}) per ${p.notificante}, protocollato in uscita. Procedo?`)) return;

  attendi(btn, true, 'Preparo…');
  try {
    const pp = { ...p, segnalante_tipo: tipoSeg, risposta_testo: rispostaTesto, data_verbale: $('#sg-dataverb')?.value || p.data_verbale };

    /* protocollo OUT: il numero lo assegna il database */
    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggiIso(),
      data_doc: oggiIso(),
      impresa_nome: null,
      persona: p.notificante || null,
      oggetto: tipo === 'esito'
        ? `Riscontro alla segnalazione di cantiere — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ')}`
        : 'Presa in carico della segnalazione di cantiere',
      note: tipo === 'esito' ? (rispostaTesto || '') : 'Ringraziamento e presa in carico, senza merito.',
      sintesi: `Riscontro alla segnalazione n° ${p.progressivo ?? `m${p.id}`} (${tipoSeg}) — tipo: ${tipo === 'esito' ? 'esito completo' : 'presa d’atto'}.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_id: TIPO_DOC_SEGN,
      tipo_doc_txt: 'Segnalazione cantiere',
      cartella: PERCORSO_VAULT,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    const { pdfRiscontro } = await import('./segnalazioni-doc.js');
    const byte = await pdfRiscontro(pp, nuovo, tipo);
    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle segnalazioni non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const nomeFile = `${data}_COMU_Formedil-Padova_riscontro-segnalazione-${p.progressivo ?? `m${p.id}`}-${slug(p.notificante)}.pdf`;
    const su = await caricaByte(nuovo, nomeFile, byte, 'application/pdf', cart.id);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: byte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

    await sb.from('s_segnalazioni').update({
      stato: 'riscontrata',
      protocollo_out_id: nuovo.id,
      riscontro_tipo: tipo,
      riscontro_drive_id: su.drive_file_id,
      riscontro_drive_url: su.drive_url,
      risposta_testo: rispostaTesto || null,
      segnalante_tipo: tipoSeg,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    emlRiscontro(pp, nuovo, tipo, [{ nome: su.file_name || nomeFile, byte }]);
    toast(`Riscontro protocollato (${codiceProtocollo(nuovo)}) e depositato nel vault. Bozza mail scaricata: aprila da Outlook e premi Invia.`, 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function riscaricaEml(p, btn) {
  attendi(btn, true, 'Rileggo la lettera…');
  try {
    const { data: prot } = await sb.from('s_protocollo').select('*').eq('id', p.protocollo_out_id).single();
    const byte = await leggiByte(p.riscontro_drive_id);
    emlRiscontro(p, prot, p.riscontro_tipo || 'presa_atto', [{ nome: `${siglaProtocollo(prot)}_riscontro.pdf`, byte }]);
    toast('Bozza scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* La bozza .eml ricalcata sulla mail vera dell'ufficio (esempio del
   05/06/2026, Prot 1069): «vogliate trovare in allegato la risposta»,
   cc Direzione e coordinatore. */
function emlRiscontro(p, prot, tipo, allegati) {
  const cc = ['direzione@formedilpadova.it'];
  if (tipo === 'esito') { const co = emailCoordinatore(); if (co) cc.push(co); }
  scaricaEml({
    to: p.email || '',
    cc,
    oggetto: `Formedil Padova - Area Sicurezza e Salute - Riscontro segnalazione cantiere - ${siglaProtocollo(prot)}`,
    corpo: `Prot. n°: ${siglaProtocollo(prot)}

Prevenzione infortuni.

Egr. ${p.notificante || 'Segnalante'},
${tipo === 'esito'
  ? 'vogliate trovare in allegato la risposta alla Vostra segnalazione.'
  : 'Vi ringraziamo per la collaborazione: la Vostra segnalazione è stata presa in carico, come da comunicazione allegata.'}
Distinti saluti.

${FIRMA_SEGRETERIA}`,
    allegati,
    nomeFile: `riscontro-segnalazione-${p.progressivo ?? `m${p.id}`}.eml`,
  });
}
