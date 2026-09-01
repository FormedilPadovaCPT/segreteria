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

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { risolviCartella, caricaByte } from './drive.js';

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
    ${campo('Arrivata', [p.fonte === 'dnl_access' ? 'DNL storica (Access)' : p.fonte, p.data_com ? dataIt(p.data_com) : p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null].filter(Boolean).join(' — '))}
    ${campo('Prot. DNL storica', p.prot_dnl)}
    ${campo('Inviata/ricevuta al CPT', p.data_invio_cpt ? dataIt(p.data_invio_cpt) : null)}
    ${campo("Natura dell'opera", p.natura_opera)}
    ${campo('Chi comunica', [[p.ragione_sociale, [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ')].filter(Boolean).join(' — '), p.telefono, p.email].filter(Boolean).join(' · '))}
    ${campo('Cantiere', [p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', '))}
    ${campo('Lavori', [p.data_inizio ? `dal ${dataIt(p.data_inizio)}` : null, p.data_fine ? `al ${dataIt(p.data_fine)}` : null, p.durata_gg ? `${p.durata_gg} gg` : null].filter(Boolean).join(' '))}
    ${campo('Importo', p.importo)}
    ${campo('Presenze', [p.max_lavoratori ? `max ${p.max_lavoratori} lavoratori` : null, p.n_imprese ? `${p.n_imprese} imprese` : null, p.n_autonomi ? `${p.n_autonomi} autonomi` : null].filter(Boolean).join(' — '))}
    ${campo('Committente', [committenteDi(p), p.comm_piva ? `P.IVA ${p.comm_piva}` : p.comm_cf2 || p.comm_cf, p.comm_indirizzo || p.comm_ind2, p.comm_tel || p.comm_tel2, p.comm_email].filter(Boolean).join(' — '))}
    ${campo('Responsabile dei lavori', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.rl_cf, [p.rl_indirizzo, p.rl_comune].filter(Boolean).join(', '), p.rl_note].filter(Boolean).join(' — '))}
    ${(Array.isArray(p.figure) && p.figure.length) ? `<div class="dt-doc-riga"><strong>Figure professionali:</strong><br>${p.figure.map((f) =>
      esc(['· ' + (f.ruolo || 'ruolo n.d.'), f.nominativo || [f.titolo, f.nome, f.cognome].filter(Boolean).join(' '), f.cf, f.email, f.telefono].filter(Boolean).join(' — '))).join('<br>')}</div>` : ''}
    ${(Array.isArray(p.imprese) && p.imprese.length) ? `<div class="dt-doc-riga"><strong>Imprese previste in cantiere:</strong><br>${p.imprese.map((i) =>
      esc(['· ' + (i.ruolo || 'ruolo n.d.'), i.ragione_sociale, i.piva ? `P.IVA ${i.piva}` : null, i.cod_cassa ? `Cassa Edile ${i.cod_cassa}` : null, [i.indirizzo, i.comune].filter(Boolean).join(', '), i.email].filter(Boolean).join(' — '))).join('<br>')}</div>` : ''}
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
      ${!p.protocollo_out_id ? '<button class="btn btn-ghost" id="nt-riscontro">📄 Riscontro completo (lettera OUT)</button>' : ''}
      <button class="btn btn-ghost" id="nt-anteprima">👁 Lettera in anteprima (senza protocollare)</button>
    </div>
    <p class="hint" style="margin-top:6px">${p.riscontro_inviato_il
      ? `Riscontro già preparato il ${dataIt(p.riscontro_inviato_il.slice(0, 10))}.`
      : 'Il ringraziamento è la presa d\'atto (due righe). Il riscontro completo è la lettera protocollata col riepilogo di cantiere, figure e imprese — l\'erede della vecchia lettera DNL.'}</p>
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
  $('#nt-riscontro')?.addEventListener('click', (e) => riscontroCompleto(p, e.currentTarget));
  $('#nt-anteprima')?.addEventListener('click', (e) => anteprimaLettera(p, e.currentTarget));
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

/* ══════════ riscontro completo — l'erede della lettera DNL ══════════
   Modellato sul riscontro storico alle Denunce di Nuovo Lavoro
   (Com_DNL_CPT_PD_rev.02): conferma di corretta trasmissione, dati
   del cantiere, riepilogo delle persone fisiche e delle persone
   giuridiche. Protocollato OUT nel registro unico (la serie .dnl
   resta solo da leggere sullo storico), depositato nella cartella
   del vault, bozza .eml con la lettera allegata — la manda l'umano
   da Outlook. */

function corpoRiscontroNotifica(p, ISTITUZIONALE) {
  const par = [ISTITUZIONALE];
  par.push(
    'Essa ha constatato che è stata correttamente trasmessa la comunicazione di apertura ' +
    `cantiere${p.note_cantiere ? ` per lavori di: ${p.note_cantiere}` : ''}, presso il cantiere ` +
    `sito in ${p.ind_cantiere || 'indirizzo da precisare'}${p.comune_cantiere ? ` nel Comune di ${p.comune_cantiere}` : ''}.`);

  const datiCantiere = [
    p.data_inizio ? `- Data presunta di inizio lavori: ${dataIt(p.data_inizio)}` : null,
    p.data_fine ? `- Data presunta di fine lavori: ${dataIt(p.data_fine)}` : null,
    p.importo ? `- Ammontare complessivo presunto dei lavori (IVA esclusa): € ${p.importo}` : null,
    p.durata_gg ? `- Durata presunta dei lavori: ${p.durata_gg} giorni` : null,
    p.max_lavoratori ? `- Numero massimo presunto di lavoratori in cantiere: ${p.max_lavoratori}` : null,
    p.n_imprese ? `- Numero previsto di imprese: ${p.n_imprese}` : null,
    p.n_autonomi ? `- Numero previsto di lavoratori autonomi: ${p.n_autonomi}` : null,
  ].filter(Boolean);
  if (datiCantiere.length) { par.push('Dati del cantiere comunicati:'); par.push(...datiCantiere); }

  /* persone fisiche: notificatore, committente persona fisica, RL, poi le figure aggiunte */
  const persone = [];
  const notif = [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ');
  if (notif) persone.push(`- Soggetto notificatore: ${notif}${p.seg_cf ? ` — CF ${p.seg_cf}` : ''}`);
  const commP = [p.comm_titolo, p.comm_nome, p.comm_cognome].filter(Boolean).join(' ');
  if (commP) persone.push(`- Committente: ${commP}${p.comm_cf2 ? ` — CF ${p.comm_cf2}` : ''}`);
  const rl = [p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' ');
  if (rl) persone.push(`- Responsabile dei lavori: ${rl}${p.rl_cf ? ` — CF ${p.rl_cf}` : ''}`);
  for (const f of (Array.isArray(p.figure) ? p.figure : [])) {
    persone.push(`- ${f.ruolo || 'Figura professionale'}: ${f.nominativo || [f.titolo, f.nome, f.cognome].filter(Boolean).join(' ')}${f.cf ? ` — CF ${f.cf}` : ''}`);
  }
  if (persone.length) { par.push('Riepilogo soggetti — persone fisiche:'); par.push(...persone); }

  /* persone giuridiche: notificatore azienda, committente giuridico, poi le imprese elencate */
  const giuridiche = [];
  if (p.ragione_sociale) giuridiche.push(`- Soggetto notificatore: ${p.ragione_sociale}`);
  if (p.comm_ragione_sociale) giuridiche.push(`- Committente: ${p.comm_ragione_sociale}${p.comm_piva ? ` — P.IVA ${p.comm_piva}` : ''}`);
  for (const i of (Array.isArray(p.imprese) ? p.imprese : [])) {
    giuridiche.push(`- ${i.ruolo || 'Impresa'}: ${i.ragione_sociale || '?'}${i.piva ? ` — P.IVA ${i.piva}` : ''}${i.cod_cassa ? ` — Cassa Edile ${i.cod_cassa}` : ''}`);
  }
  if (giuridiche.length) { par.push('Riepilogo soggetti — persone giuridiche:'); par.push(...giuridiche); }

  par.push(
    'La comunicazione è stata registrata e il cantiere entrerà nella normale programmazione ' +
    'delle visite dei nostri tecnici. Vi ringraziamo per la collaborazione, preziosa per ' +
    "l'attività di prevenzione del nostro Ente.");
  par.push('Distinti saluti.');
  return par;
}

/* ── ANTEPRIMA della lettera SENZA protocollare (chiesto dall'utente
      01/09/2026, per rivedere le DNL storiche già chiuse): stessa
      lettera del riscontro, ma solo scaricata in locale — niente
      registro, niente Drive, niente mail. Per le storiche stampa il
      numero della SERIE STORICA (es. 40/2018.dnl); se la pratica ha
      già un protocollo OUT usa quello; altrimenti esce come bozza. ── */
async function anteprimaLettera(p, btn) {
  attendi(btn, true, 'Genero…');
  try {
    const { ISTITUZIONALE, generaLetteraPdf } = await import('./rlst-lettera.js');
    const paragrafi = corpoRiscontroNotifica(p, ISTITUZIONALE);
    const dataCom = p.data_com || (p.timestamp_modulo || '').slice(0, 10) || null;
    const oggettoRiga = `Vostra ${p.fonte === 'dnl_access' ? 'denuncia di nuovo lavoro' : 'comunicazione di apertura cantiere'}${dataCom ? ` del ${dataIt(dataCom)}` : ''}.`;

    const protVero = p.protocollo_out_id ? protDi[p.protocollo_out_id] : null;
    const protocollo = protVero || { codice: p.prot_dnl || 'BOZZA-SENZA-PROTOCOLLO' };

    const byte = await generaLetteraPdf({
      ragione_sociale: p.ragione_sociale || committenteDi(p) || [p.seg_nome, p.seg_cognome].filter(Boolean).join(' '),
      email: p.email,
      telefono: p.telefono,
      alla_ca_riga: [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).length
        ? `Alla c.a. ${[p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ')}` : '',
    }, protocollo, paragrafi, oggettoRiga);

    const { scaricaPdf } = await import('./corsi-doc.js');
    const nome = p.prot_dnl
      ? `Riscontro_DNL_${p.prot_dnl.replace(/[/.]/g, '-')}.pdf`
      : `anteprima-riscontro-notifica-${p.progressivo ?? `m${p.id}`}.pdf`;
    scaricaPdf(byte, nome);
    toast(protVero ? 'Lettera rigenerata col protocollo già assegnato.'
      : p.prot_dnl ? `Lettera ricostruita con la serie storica ${p.prot_dnl} — solo anteprima, niente registro.`
      : 'Anteprima scaricata: per la lettera vera usa «Riscontro completo», che protocolla.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function riscontroCompleto(p, btn) {
  if (!confirm(`Preparo la lettera di riscontro completa per la notifica n° ${p.progressivo ?? `m${p.id}`}, protocollata in uscita. Procedo?`)) return;
  attendi(btn, true, 'Preparo…');
  try {
    const { ISTITUZIONALE, generaLetteraPdf } = await import('./rlst-lettera.js');
    const paragrafi = corpoRiscontroNotifica(p, ISTITUZIONALE);
    const dataCom = p.data_com || (p.timestamp_modulo || '').slice(0, 10) || null;
    const oggettoRiga = `Vostra comunicazione di apertura cantiere${dataCom ? ` del ${dataIt(dataCom)}` : ''}.`;

    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggiIso(),
      data_doc: oggiIso(),
      impresa_nome: p.ragione_sociale || committenteDi(p) || null,
      impresa_id: p.impresa_id || null,
      persona: [p.seg_cognome, p.seg_nome].filter(Boolean).join(' ') || null,
      oggetto: `Riscontro alla comunicazione di apertura cantiere — ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cantiere da individuare'}`,
      note: paragrafi.join('\n\n'),
      sintesi: `Riscontro completo alla notifica n° ${p.progressivo ?? `m${p.id}`} (erede della lettera DNL): conferma di trasmissione con riepilogo cantiere, figure professionali e imprese.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_id: TIPO_DOC_NOTIF,
      cartella: PERCORSO_VAULT,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    /* la lettera, col numero già dentro; il destinatario è chi ha notificato */
    const pdfByte = await generaLetteraPdf({
      ragione_sociale: p.ragione_sociale || committenteDi(p) || [p.seg_nome, p.seg_cognome].filter(Boolean).join(' '),
      email: p.email,
      telefono: p.telefono,
      alla_ca_riga: [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).length
        ? `Alla c.a. ${[p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ')}` : '',
    }, nuovo, paragrafi, oggettoRiga);

    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error(`Cartella «${PERCORSO_VAULT}» non trovata su Drive`);
    const nomeFile = `${oggiIso().replace(/-/g, '_')}_COMU_Formedil-Padova_riscontro-notifica-cantiere-${p.progressivo ?? `m${p.id}`}.pdf`;
    const su = await caricaByte(nuovo, nomeFile, pdfByte, 'application/pdf', cart.id);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: pdfByte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

    /* niente lettera_drive_*: la tabella notifiche non ha quelle colonne
       (il link al PDF vive sul protocollo) — con una colonna inesistente
       Supabase rifiuterebbe TUTTO l'update, protocollo compreso */
    const { error: errAgg } = await sb.from('s_notifiche_cantiere').update({
      protocollo_out_id: nuovo.id,
      riscontro_inviato_il: new Date().toISOString(),
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (errAgg) throw new Error('Riscontro protocollato ma pratica non aggiornata: ' + errAgg.message);

    /* al COMUNICANTE e, per conoscenza, all'IMPRESA/committente
       (il giro della vecchia lettera DNL, descritto dall'utente) */
    const chi = p.ragione_sociale || [p.seg_titolo, p.seg_nome, p.seg_cognome].filter(Boolean).join(' ') || 'Gentile Segnalante';
    scaricaEml({
      to: p.email || '',
      cc: [p.comm_email].filter((m) => m && m !== p.email),
      oggetto: 'Formedil Padova - Area Sicurezza e Salute - Riscontro alla Vostra comunicazione di apertura cantiere',
      corpo: `Prot. n°: ${siglaProtocollo(nuovo)}

Prevenzione infortuni.

Spett.le ${chi},

Vogliate trovare in allegato il riscontro alla Vostra comunicazione di apertura del cantiere di ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || 'cui alla Vostra segnalazione'}.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: su.file_name || nomeFile, byte: pdfByte }],
      nomeFile: `riscontro-notifica-${p.progressivo ?? `m${p.id}`}.eml`,
    });

    /* e il cantiere viene NOTIFICATO AL TECNICO di zona, per le
       eventuali visite (la seconda metà del giro DNL storico) */
    const tecnico = p.tecnico_assegnato || p.tecnico_proposto;
    if (tecnico) {
      scaricaEml({
        to: tecnico,
        oggetto: `Formedil Padova - Cantiere notificato per eventuali visite - ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || '—'}`,
        corpo: `Ciao ${nomeTecnico(tecnico)},

è stato notificato un nuovo cantiere nella tua zona, da tenere presente per le eventuali visite:

Cantiere: ${[p.ind_cantiere, p.comune_cantiere].filter(Boolean).join(', ') || '—'}
Comunicante: ${p.ragione_sociale || [p.seg_nome, p.seg_cognome].filter(Boolean).join(' ') || '—'}
Committente: ${committenteDi(p) || '—'}
Periodo presunto: ${[dataIt(p.data_inizio), dataIt(p.data_fine)].filter(Boolean).join(' → ') || '—'}
Max lavoratori: ${p.max_lavoratori ?? '—'} · imprese previste: ${p.n_imprese ?? '—'}${p.note_cantiere ? `
Note: ${p.note_cantiere}` : ''}

Riscontro protocollato ${codiceProtocollo(nuovo)} (lettera allegata, agli atti su Drive).

${FIRMA_SEGRETERIA}`,
        allegati: [{ nome: su.file_name || nomeFile, byte: pdfByte }],
        nomeFile: `cantiere-notificato-tecnico-${p.progressivo ?? `m${p.id}`}.eml`,
      });
    }

    toast(`Lettera protocollata (${codiceProtocollo(nuovo)}) e depositata nel vault. Bozze mail scaricate: comunicante${p.comm_email ? ' + committente in cc' : ''}${tecnico ? ' e avviso al tecnico' : ''}.`, 'ok');
    chiudiDrawer();
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}
