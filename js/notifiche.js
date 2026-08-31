/* ============================================================
   «Segnala un cantiere al CPT» — le notifiche di apertura
   cantiere (scheda «Notifica Cantiere» del foglio, erede del
   modulo 2011 e delle lettere 2013 a committenti e imprese).

   È il servizio più leggero: chi apre un cantiere lo comunica
   (dati cantiere, committente, responsabile dei lavori) e la
   notifica ALIMENTA LA PROGRAMMAZIONE DELLE VISITE ORDINARIE —
   che per regola (2026-08-07) non passano dall'autorizzazione
   caso per caso del Direttore. Quindi: registro, tecnico di zona
   proposto, protocollo IN, ringraziamento. Niente visto.

   Il cantiere vero nasce poi nel gestionale (campo cantiere_id
   quando viene creato); il verbale vive di là.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo } from './core.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';

let pratiche = [];
let tecnici = [];
let zone = [];
let protDi = {};
let filtro = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', programmata: 'Programmata', visitata: 'Visitata',
  chiusa: 'Chiusa', scartata: 'Scartata',
};
const FONTI = ['telefono', 'email', 'pec', 'altro'];
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Segnalazione Cantieri al CPT';
const TIPO_DOC_NOTIF = 57;   // s_tipo_doc «Notifica cantiere»

async function carica() {
  const [{ data: p }, { data: t }, { data: z }] = await Promise.all([
    sb.from('s_notifiche_cantiere').select('*').order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true),
    zone.length ? Promise.resolve({ data: zone }) : sb.from('tecnici_zone').select('email, comune_nome'),
  ]);
  pratiche = p || [];
  tecnici = t || [];
  zone = z || [];
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

/* vince la zona più specifica (stessa regola dell'import) */
const normComune = (s) => String(s || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim();
function tecnicoDiZona(comune) {
  const c = normComune(comune);
  if (!c) return null;
  const match = zone.filter((z) => {
    const zc = normComune(z.comune_nome);
    return zc === c || c.startsWith(zc + ' ') || zc.startsWith(c + ' ');
  });
  if (!match.length) return null;
  const maxLen = Math.max(...match.map((z) => normComune(z.comune_nome).length));
  const email = [...new Set(match.filter((z) => normComune(z.comune_nome).length === maxLen).map((z) => z.email))];
  return email.length === 1 ? email[0] : null;
}

const committenteDi = (p) => p.comm_ragione_sociale
  || [p.comm_titolo, p.comm_nome, p.comm_cognome].filter(Boolean).join(' ') || null;

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#notifiche-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const daProgrammare = aperte.filter((p) => p.stato === 'ricevuta');

  const visibili = pratiche.filter((p) =>
    filtro === 'tutte' ? true :
    filtro === 'aperte' ? !['chiusa', 'scartata'].includes(p.stato) :
    ['chiusa', 'scartata'].includes(p.stato));

  const righe = visibili.map((p) => {
    const prot = [
      p.protocollo_in_id ? (protDi[p.protocollo_in_id] ? `IN ${codiceProtocollo(protDi[p.protocollo_in_id])}` : 'IN ✓') : null,
      p.protocollo_out_id ? (protDi[p.protocollo_out_id] ? `OUT ${codiceProtocollo(protDi[p.protocollo_out_id])}` : 'OUT ✓') : null,
    ].filter(Boolean).join('<br>') || '—';
    return `<tr data-id="${p.id}">
      <td>${p.progressivo ?? `m${p.id}`}</td>
      <td>${p.data_com ? dataIt(p.data_com) : p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td>${esc([p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || '—')}</td>
      <td>${esc(committenteDi(p) || '—')}</td>
      <td>${p.data_inizio ? dataIt(p.data_inizio) : '—'}</td>
      <td>${esc(nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || '—')}${!p.tecnico_assegnato && p.tecnico_proposto ? ' <span class="hint">(proposto)</span>' : ''}</td>
      <td class="hint" style="white-space:nowrap">${prot}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${daProgrammare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">📍 ${daProgrammare.length} da mettere in programmazione</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${aperte.length} aperte in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="nt-f">
        ${[['aperte', 'Da lavorare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="nt-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="nt-nuova">+ Nuova notifica</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Cantiere</th><th>Committente</th><th>Inizio lavori</th><th>Tecnico</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="8" class="empty">Nessuna notifica con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Le notifiche di apertura cantiere alimentano la programmazione delle visite ordinarie:
      niente autorizzazione caso per caso. Il cantiere vero nasce poi nel gestionale.
    </p>`;

  $('#nt-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#nt-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.notifiche?.nuove || 0;
    toast(n ? `${n} notifiche nuove importate.` : 'Nessuna notifica nuova.', 'ok');
    if (n) render();
  });
  $('#nt-nuova').addEventListener('click', nuovaNotifica);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ══════════ inserimento manuale ══════════ */

function nuovaNotifica() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="nn-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Nuova notifica di cantiere (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per le comunicazioni arrivate fuori dal modulo (telefono, mail, PEC).</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Arrivata per *</label>
        <select id="nn-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
      ${campo('datacom', 'Data comunicazione', 'date')}
    </div>
    ${campo('chi', 'Chi comunica (impresa / professionista) *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    ${campo('indcant', 'Indirizzo cantiere *')}
    ${campo('comcant', 'Comune cantiere *', 'text', 'es. PADOVA - Q3 Est, oppure il comune')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('inizio', 'Inizio lavori', 'date')}${campo('fine', 'Fine prevista', 'date')}
      ${campo('committente', 'Committente')}${campo('commpiva', 'P.IVA committente')}
    </div>
    <div class="field"><label>Note</label><textarea id="nn-note" rows="2"></textarea></div>
    <button class="btn btn-primary" id="nn-crea" style="margin-top:10px">Crea la notifica</button>`);

  $('#nn-crea').addEventListener('click', async (ev) => {
    const chi = $('#nn-chi').value.trim();
    const comune = $('#nn-comcant').value.trim();
    if (!chi || !comune) return toast('Servono chi comunica e il comune del cantiere.', 'err');
    attendi(ev.currentTarget, true);
    const m = $('#nn-commpiva').value.match(/\d{10,11}/);
    const piva = m ? m[0].padStart(11, '0') : null;
    let impresaId = null;
    if (piva) {
      const { data: imp } = await sb.from('imprese').select('impresa_id').eq('impresa_id', piva).maybeSingle();
      impresaId = imp?.impresa_id || null;
    }
    const { data: nuova, error } = await sb.from('s_notifiche_cantiere').insert({
      fonte: $('#nn-fonte').value,
      timestamp_modulo: new Date().toISOString(),
      data_com: $('#nn-datacom').value || oggiIso(),
      ragione_sociale: chi,
      telefono: $('#nn-tel').value.trim() || null,
      email: $('#nn-email').value.trim() || null,
      ind_cantiere: $('#nn-indcant').value.trim() || null,
      comune_cantiere: comune,
      data_inizio: $('#nn-inizio').value || null,
      data_fine: $('#nn-fine').value || null,
      comm_ragione_sociale: $('#nn-committente').value.trim() || null,
      comm_piva: piva || $('#nn-commpiva').value.trim() || null,
      note_cantiere: $('#nn-note').value.trim() || null,
      impresa_id: impresaId,
      tecnico_proposto: tecnicoDiZona(comune),
      aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Notifica registrata.', 'ok');
    await render();
    apriPratica(nuova.id);
  });
}

/* ══════════ dettaglio ══════════ */

export async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Notifica n° ${p.progressivo ?? `m${p.id}`} — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ')}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.tecnico_assegnato ? 'dt-ok' : p.tecnico_proposto ? 'dt-senzadata' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Tecnico</span>
      <span class="dt-quadro-stato">${p.tecnico_assegnato
        ? `assegnato: ${esc(nomeTecnico(p.tecnico_assegnato))}${p.tecnico_proposto && p.tecnico_proposto !== p.tecnico_assegnato
            ? ` — la zona proponeva ${esc(nomeTecnico(p.tecnico_proposto))} (cambio della segreteria)` : ''}`
        : p.tecnico_proposto ? `proposto dalla zona: ${esc(nomeTecnico(p.tecnico_proposto))} — da confermare o cambiare se non disponibile nei tempi` : 'da assegnare'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.protocollo_in_id ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Protocollo IN</span>
      <span class="dt-quadro-stato">${p.protocollo_in_id
        ? `<strong>${esc(protDi[p.protocollo_in_id] ? codiceProtocollo(protDi[p.protocollo_in_id]) : 'protocollata')}</strong>${protDi[p.protocollo_in_id] ? ` · <a href="#" data-apri-prot="${p.protocollo_in_id}">apri nel registro</a>` : ''}`
        : 'da protocollare (il PDF di riepilogo del modulo è il documento)'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.cantiere_id ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Cantiere nel gestionale</span>
      <span class="dt-quadro-stato">${p.cantiere_id ? `creato (${esc(p.cantiere_id)})` : 'non ancora creato: si crea dal gestionale quando entra in programmazione'}</span>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Arrivata', [p.fonte, p.data_com ? dataIt(p.data_com) : p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('Chi comunica', [[p.ragione_sociale, [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ')].filter(Boolean).join(' — '), p.telefono, p.email].filter(Boolean).join(' · '))}
    ${campo('Cantiere', [p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', '))}
    ${campo('Lavori', [p.data_inizio ? `dal ${dataIt(p.data_inizio)}` : null, p.data_fine ? `al ${dataIt(p.data_fine)}` : null, p.durata_gg ? `${p.durata_gg} gg` : null].filter(Boolean).join(' '))}
    ${campo('Importo', p.importo)}
    ${campo('Presenze', [p.max_lavoratori ? `max ${p.max_lavoratori} lavoratori` : null, p.n_imprese ? `${p.n_imprese} imprese` : null, p.n_autonomi ? `${p.n_autonomi} autonomi` : null].filter(Boolean).join(' — '))}
    ${campo('Committente', [committenteDi(p), p.comm_piva ? `P.IVA ${p.comm_piva}` : p.comm_cf2 || p.comm_cf, p.comm_indirizzo || p.comm_ind2, p.comm_tel || p.comm_tel2, p.comm_email].filter(Boolean).join(' — '))}
    ${campo('Responsabile dei lavori', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.rl_cf, [p.rl_indirizzo, p.rl_comune].filter(Boolean).join(', '), p.rl_note].filter(Boolean).join(' — '))}
    ${campo('Note', p.note_cantiere)}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="nt-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Tecnico assegnato</label>
        <select id="nt-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${(p.tecnico_assegnato || p.tecnico_proposto) === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="nt-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="nt-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost" id="nt-protin">📥 Protocolla la notifica (IN)</button>' : ''}
      <button class="btn btn-primary" id="nt-grazie">📧 Ringraziamento a chi ha segnalato</button>
    </div>
    <p class="hint" style="margin-top:6px">${p.riscontro_inviato_il
      ? `Ringraziamento già preparato il ${dataIt(p.riscontro_inviato_il.slice(0, 10))}.`
      : 'Il ringraziamento è la presa d\'atto: due righe, senza impegni sul merito.'}</p>
  `);

  $('#drawer-body').querySelectorAll('[data-apri-prot]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      chiudiDrawer();
      const mod = await import('./protocollo.js');
      mod.apriDettaglio(Number(a.dataset.apriProt));
    }));

  $('#nt-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_notifiche_cantiere').update({
      stato: $('#nt-stato').value,
      tecnico_assegnato: $('#nt-tecnico').value || null,
      note_ufficio: $('#nt-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  $('#nt-protin')?.addEventListener('click', () => protocollaIn(p));
  $('#nt-grazie')?.addEventListener('click', () => mailGrazie(p));
}

async function protocollaIn(p) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  mod.apriForm('IN', {
    data_prot: oggiIso(),
    data_doc: p.data_com || (p.timestamp_modulo || '').slice(0, 10) || null,
    impresa_nome: p.ragione_sociale || committenteDi(p) || null,
    impresa_id: p.impresa_id || null,
    persona: [p.seg_cognome, p.seg_nome].filter(Boolean).join(' ') || null,
    oggetto: `Notifica di apertura cantiere — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cantiere da individuare'}`,
    note: p.note_cantiere || null,
    sintesi: `Notifica n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`}. ` +
      `Committente: ${committenteDi(p) || '?'} — inizio lavori: ${p.data_inizio ? dataIt(p.data_inizio) : '?'} — ` +
      `tecnico di zona: ${nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || 'da assegnare'}. Alimenta le visite ordinarie.`,
    tipo_doc_id: TIPO_DOC_NOTIF,
    mezzo: p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  }, true, async (nuovo) => {
    const { error } = await sb.from('s_notifiche_cantiere').update({
      protocollo_in_id: nuovo.id,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla notifica n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il PDF di riepilogo e salva — il numero si collega da solo.', 'ok');
}

async function mailGrazie(p) {
  const chi = p.ragione_sociale || [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ') || 'Gentile Segnalante';
  scaricaEml({
    to: p.email || '',
    oggetto: 'Formedil Padova - Area Sicurezza e Salute - Ricevuta la Vostra comunicazione di apertura cantiere',
    corpo: `Spett.le ${chi},

Vi ringraziamo per la comunicazione di apertura del cantiere di ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cui alla Vostra segnalazione'}: la collaborazione di imprese, committenti e professionisti è preziosa per l'attività di prevenzione del nostro Ente.

La comunicazione è stata registrata e il cantiere entrerà nella normale programmazione delle visite dei nostri tecnici.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
    nomeFile: `ringraziamento-notifica-${p.progressivo ?? `m${p.id}`}.eml`,
  });
  await sb.from('s_notifiche_cantiere').update({
    riscontro_inviato_il: new Date().toISOString(),
    aggiornato_da: state.email, updated_at: new Date().toISOString(),
  }).eq('id', p.id);
  toast('Bozza di ringraziamento scaricata: aprila da Outlook e premi Invia.', 'ok');
  await render();
}
