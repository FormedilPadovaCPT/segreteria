/* ============================================================
   Anagrafe degli RLS aziendali.

   Il CCPL del 3 marzo 2022 impegna le parti a tenere un'anagrafe
   di categoria aggiornata degli RLS eletti in ciascuna impresa,
   alimentata dall'obbligo di invio del verbale di elezione
   all'ente unico territoriale. Questa pagina è quell'anagrafe:
   le comunicazioni arrivano dal modulo online (import delle 6:30,
   stessa funzione delle pratiche RLST), lo storico viene da
   Access (101 comunicazioni dal 2013).

   Il mandato RLS dura 3 anni (CCNL): la scadenza teorica si
   calcola dalla decorrenza e si dichiara come presunta — vale
   la fine nomina registrata, quando c'è.

   Il riscontro all'impresa nasce già protocollato: lettera di
   iscrizione al «Registro Anagrafe degli R.L.S.» su carta
   Formedil, protocollo OUT nel registro unico (la serie NN/rls
   è chiusa), deposito in RLS/comunicazioni_imprese su Drive,
   bozza .eml con cc al Direttore e al coordinatore.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { risolviCartella, caricaByte, leggiByte, idDaLink } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';

let righe = [];
let filtroStato = 'aperte';
let cerca = '';

const STATI = {
  ricevuta: 'Ricevuta', istruita: 'Istruita', risposta_protocollata: 'Riscontro protocollato',
  inviata: 'Inviata', chiusa: 'Chiusa', scartata: 'Scartata',
};

const CC_RISCONTRO = ['direzione@formedilpadova.it', 'nicola.demarco@did.formedilpadova.it'];

function nomeRls(r) {
  return [r.rls_titolo, r.rls_cognome, r.rls_nome].filter(Boolean).join(' ') || r.rls_nominativo || '?';
}

/* Scadenza del mandato: la fine nomina registrata se c'è, altrimenti
   la teorica a 3 anni dalla decorrenza (CCNL), dichiarata presunta. */
function mandato(r) {
  if (r.fine_nomina) return { fine: r.fine_nomina, presunta: false };
  if (!r.decorrenza) return { fine: null, presunta: false };
  const d = new Date(r.decorrenza + 'T00:00:00');
  d.setFullYear(d.getFullYear() + 3);
  return { fine: d.toISOString().slice(0, 10), presunta: true };
}

async function carica() {
  const { data } = await sb.from('s_rls_anagrafe').select('*')
    .order('timestamp_modulo', { ascending: false, nullsFirst: false });
  righe = data || [];
}

export async function render() {
  const host = $('#rls-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const t = cerca.trim().toLowerCase();
  const visibili = righe.filter((r) =>
    (filtroStato === 'tutte' ? true :
     filtroStato === 'aperte' ? !['chiusa', 'scartata'].includes(r.stato) :
     r.stato === filtroStato) &&
    (!t || `${r.ragione_sociale} ${nomeRls(r)} ${r.rls_cf || ''} ${r.partita_iva || ''}`.toLowerCase().includes(t)));

  const corpo = visibili.map((r) => {
    const m = mandato(r);
    const scaduto = m.fine && m.fine < oggiIso();
    return `<tr data-id="${r.id}">
      <td>${r.progressivo ?? (r.access_id ? 'A' + r.access_id : '—')}</td>
      <td>${r.timestamp_modulo ? dataIt(r.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(r.ragione_sociale || '?')}</strong></td>
      <td>${esc(nomeRls(r))}</td>
      <td>${esc(r.tipo_elezione || '—')}</td>
      <td>${m.fine
        ? `<span class="dt-cella ${scaduto ? 'dt-scaduto' : 'dt-ok'}" style="padding:2px 8px">${dataIt(m.fine)}${m.presunta ? ' ?' : ''}</span>`
        : '<span class="hint">senza data</span>'}</td>
      <td>${esc(STATI[r.stato] || r.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="rls-f">
        ${['aperte', 'tutte', 'chiusa'].map((s) =>
          `<button class="seg-btn ${filtroStato === s ? 'is-active' : ''}" data-val="${s}">${s === 'aperte' ? 'Da lavorare' : s === 'tutte' ? 'Anagrafe completa' : 'Chiuse'}</button>`).join('')}
      </div>
      <input id="rls-cerca" class="inp inp-sm" type="search" placeholder="Cerca impresa, RLS, CF…" value="${esc(cerca)}">
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="rls-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="rls-nuova">+ Nuova comunicazione</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>RLS</th><th>Tipo</th><th>Mandato fino al</th><th>Stato</th></tr></thead>
        <tbody>${corpo || '<tr><td colspan="7" class="empty">Niente qui con questi filtri.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Il mandato dura 3 anni (CCNL): la data col «?» è la scadenza teorica calcolata dalla
      decorrenza, non una fine nomina comunicata. L'import dal foglio gira ogni mattina alle 6:30.
    </p>`;

  $('#rls-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroStato = b.dataset.val; render(); }
  });
  $('#rls-cerca').addEventListener('input', (e) => {
    cerca = e.target.value;
    clearTimeout(render._t);
    render._t = setTimeout(render, 350);
  });
  $('#rls-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.rls?.nuove || 0;
    toast(n ? `${n} comunicazioni nuove importate.` : 'Nessuna comunicazione nuova.', 'ok');
    if (n) render();
  });
  $('#rls-nuova').addEventListener('click', nuovaComunicazione);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriComunicazione(Number(tr.dataset.id))));
}

/* Inserimento manuale: la comunicazione puo' arrivare anche per PEC
   o carta, fuori dal modulo. Stessa pre-istruttoria dell'import. */
function nuovaComunicazione() {
  const campo = (id, label, tipo = 'text', ph = '') =>
    `<div class="field"><label>${label}</label><input type="${tipo}" id="nc-${id}" placeholder="${ph}"></div>`;
  apriDrawer('Nuova comunicazione RLS (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per i verbali arrivati fuori dal modulo online (PEC, carta).</p>
    ${campo('ragione', 'Ragione sociale *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('piva', 'Partita IVA', 'text', '11 cifre')}${campo('ceiv', 'Codice CEIV dichiarato')}
      ${campo('email', 'Email impresa')}${campo('tel', 'Telefono')}
    </div>
    ${campo('sede', 'Sede')}
    <div class="field"><label>Tipo</label>
      <select id="nc-tipo"><option>Elezione</option><option>Rielezione</option></select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('verbdata', 'Data del verbale', 'text', 'gg/mm/aaaa')}${campo('verbprot', 'Vs. protocollo sul verbale')}
      ${campo('decorrenza', 'Decorrenza nomina', 'date')}${campo('finenomina', 'Fine nomina (se comunicata)', 'date')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      ${campo('rlstitolo', 'Titolo RLS', 'text', 'Sig./Sig.ra')}${campo('rlscognome', 'Cognome RLS *')}${campo('rlsnome', 'Nome RLS *')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('rlscf', 'CF dell’RLS')}${campo('rlsemail', 'Email RLS')}
      ${campo('mansione', 'Mansione')}${campo('entecorso', 'Ente del corso RLS')}
    </div>
    <div class="field"><label>Note</label><textarea id="nc-note"></textarea></div>
    <button class="btn btn-primary" id="nc-crea" style="margin-top:10px">Registra la comunicazione</button>`);

  $('#nc-crea').addEventListener('click', async (ev) => {
    const ragione = $('#nc-ragione').value.trim();
    const cognome = $('#nc-rlscognome').value.trim();
    if (!ragione || !cognome) return toast('Servono ragione sociale e cognome dell\'RLS.', 'err');
    const m = $('#nc-piva').value.match(/\d{10,11}/);
    const piva = m ? m[0].padStart(11, '0') : null;
    attendi(ev.currentTarget, true);
    let impresaId = null;
    if (piva) {
      const { data: imp } = await sb.from('imprese').select('impresa_id').eq('impresa_id', piva).maybeSingle();
      impresaId = imp?.impresa_id || null;
    }
    const cf = $('#nc-rlscf').value.trim().toUpperCase();
    let personaId = null;
    if (/^[A-Z0-9]{16}$/.test(cf)) {
      const { data: per } = await sb.from('persone').select('persona_id').eq('cf', cf).limit(2);
      if (per?.length === 1) personaId = per[0].persona_id;
    }
    const dec = $('#nc-decorrenza').value || null;
    const { data: nuova, error } = await sb.from('s_rls_anagrafe').insert({
      fonte: 'manuale',
      timestamp_modulo: new Date().toISOString(),
      ragione_sociale: ragione,
      partita_iva: piva || $('#nc-piva').value.trim() || null,
      codice_ceiv_dich: $('#nc-ceiv').value.trim() || null,
      email: $('#nc-email').value.trim() || null,
      telefono: $('#nc-tel').value.trim() || null,
      ind_sede: $('#nc-sede').value.trim() || null,
      tipo_elezione: $('#nc-tipo').value,
      data_verbale: $('#nc-verbdata').value.trim() || null,
      protocollo_verbale: $('#nc-verbprot').value.trim() || null,
      decorrenza: dec,
      fine_nomina: $('#nc-finenomina').value || null,
      rls_titolo: $('#nc-rlstitolo').value.trim() || null,
      rls_cognome: cognome,
      rls_nome: $('#nc-rlsnome').value.trim() || null,
      rls_cf: /^[A-Z0-9]{16}$/.test(cf) ? cf : null,
      rls_email: $('#nc-rlsemail').value.trim() || null,
      mansione: $('#nc-mansione').value.trim() || null,
      ente_corso: $('#nc-entecorso').value.trim() || null,
      note_modulo: $('#nc-note').value.trim() || null,
      impresa_id: impresaId,
      persona_id: personaId,
      aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Registrazione non riuscita: ' + error.message, 'err');
    toast('Comunicazione registrata.', 'ok');
    await render();
    apriComunicazione(nuova.id);
  });
}

/* Apertura di una comunicazione da un'altra maschera (es. dalla
   scheda impresa), senza passare dall'elenco. */
export async function apriComunicazioneId(id) {
  const { data, error } = await sb.from('s_rls_anagrafe').select('*').eq('id', id).maybeSingle();
  if (error || !data) return toast('Comunicazione non trovata: ' + (error?.message || id), 'err');
  righe = [data, ...righe.filter((x) => x.id !== id)];
  apriComunicazione(id);
}

/* ── dettaglio ────────────────────────────────────────────── */
async function apriComunicazione(id) {
  const r = righe.find((x) => x.id === id);
  if (!r) return;

  let imp = null;
  if (r.partita_iva && /^\d{11}$/.test(r.partita_iva)) {
    const { data } = await sb.from('imprese')
      .select('impresa_id, impresa_nome, cod_ceiv, cassa_edile, stato_cassa, data_agg_access')
      .eq('impresa_id', r.partita_iva).maybeSingle();
    imp = data;
  }
  let per = null;
  if (r.rls_cf) {
    const { data } = await sb.from('persone').select('persona_id, cognome, nome').eq('cf', r.rls_cf).limit(1);
    per = data?.[0] || null;
  }
  const m = mandato(r);
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`${r.progressivo ? 'Comunicazione n° ' + r.progressivo : 'Storico A' + r.access_id} — ${r.ragione_sociale || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Anagrafica impresa</span>
      <span class="dt-quadro-stato">${imp ? esc(imp.impresa_nome) : 'non censita'}${imp?.cod_ceiv ? ` · CEIV ${esc(imp.cod_ceiv)}` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${per ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">RLS in anagrafica persone</span>
      <span class="dt-quadro-stato">${per ? esc(`${per.cognome} ${per.nome}`) : esc(nomeRls(r) + ' — non censito')}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${r.verbale_url || r.data_verbale ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Verbale di elezione</span>
      <span class="dt-quadro-stato">${r.data_verbale ? esc(`del ${r.data_verbale}${r.protocollo_verbale ? ' — Vs. Prot. ' + r.protocollo_verbale : ''}`) : 'senza data'}
        ${r.verbale_url ? ` · <a href="${esc(r.verbale_url)}" target="_blank" rel="noopener">apri</a>` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${r.formazione_url || r.data_corso ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Formazione RLS</span>
      <span class="dt-quadro-stato">${[r.ente_corso, r.comune_corso, r.data_corso].filter(Boolean).join(' — ') || 'non documentata'}
        ${r.formazione_url ? ` · <a href="${esc(r.formazione_url)}" target="_blank" rel="noopener">attestato</a>` : ''}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${m.fine ? (m.fine < oggiIso() ? 'dt-scaduto' : 'dt-ok') : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Mandato</span>
      <span class="dt-quadro-stato">${r.decorrenza ? `dal ${dataIt(r.decorrenza)}` : 'decorrenza non registrata'}${m.fine ? ` fino al ${dataIt(m.fine)}${m.presunta ? ' (teorica, 3 anni CCNL)' : ''}` : ''}</span>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Tipo', r.tipo_elezione)}
    ${campo('P.IVA', r.partita_iva)}${campo('Sede', r.ind_sede)}
    ${campo('Email impresa', r.email)}${campo('Telefono', r.telefono)}
    ${campo('Legale rappr.', [r.lr_titolo, r.lr_nome, r.lr_cognome, r.lr_cf].filter(Boolean).join(' '))}
    ${campo('RLS', `${nomeRls(r)}${r.rls_cf ? ' — ' + r.rls_cf : ''}`)}
    ${campo('Nato', [r.nato_a, r.nato_il].filter(Boolean).join(', '))}
    ${campo('Residenza', [r.residenza, r.comune_res].filter(Boolean).join(' — '))}
    ${campo('Contatti RLS', [r.rls_tel, r.rls_email].filter(Boolean).join(' / '))}
    ${campo('Rapporto', [r.mansione, r.livello_ccnl, r.data_assunzione ? 'assunto ' + r.data_assunzione : null, r.indeterminato].filter(Boolean).join(' — '))}
    ${campo('Note del modulo', r.note_modulo)}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato</label>
        <select id="rc-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${r.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Fine nomina (comunicata)</label>
        <input type="date" id="rc-fine" value="${r.fine_nomina || ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="rc-note">${esc(r.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      ${r.partita_iva ? '<button class="btn btn-ghost" data-verifica="https://www.ufficiocamerale.it/trova-azienda">🔎 ufficiocamerale.it</button>' : ''}
      ${imp ? '<button class="btn btn-ghost" id="rc-impresa">🏢 Scheda impresa</button>' : ''}
      ${per ? '<button class="btn btn-ghost" id="rc-persona">👤 Scheda persona</button>'
            : (r.rls_cf ? '<button class="btn btn-ghost" id="rc-crea-persona">+ Crea persona RLS</button>' : '')}
      <button class="btn btn-ghost" id="rc-prot-in">📥 Protocolla la comunicazione (IN)</button>
      <button class="btn btn-primary" id="rc-salva">Salva</button>
    </div>

    ${['ricevuta', 'istruita'].includes(r.stato) ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Riscontro all'impresa</h4>
    <p class="hint" style="margin:0 0 10px">
      Lettera di iscrizione al «Registro Anagrafe degli R.L.S.» protocollata in uscita,
      depositata su Drive, bozza mail con cc a Direttore e coordinatore.
    </p>
    <button class="btn btn-primary" id="rc-riscontro">📄 Protocolla e prepara il riscontro</button>` : ''}

    ${r.protocollo_out_id ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <p class="hint">Riscontro protocollato${r.lettera_drive_url ? ` — <a href="${esc(r.lettera_drive_url)}" target="_blank" rel="noopener">apri la lettera su Drive</a>` : ''}.</p>
    <button class="btn btn-ghost" id="rc-eml">📧 Scarica di nuovo la bozza mail</button>` : ''}
  `);

  $('#drawer-body').querySelectorAll('[data-verifica]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(r.partita_iva); toast(`P.IVA ${r.partita_iva} copiata: incollala nella ricerca.`, 'ok'); }
    catch { toast('Non riesco a copiare la P.IVA — ' + r.partita_iva, 'err'); }
    window.open(b.dataset.verifica, '_blank', 'noopener');
  }));

  $('#rc-impresa')?.addEventListener('click', async () => {
    chiudiDrawer();
    const mod = await import('./imprese.js');
    mod.apriScheda(imp.impresa_id);
  });

  $('#rc-persona')?.addEventListener('click', async () => {
    chiudiDrawer();
    const mod = await import('./persona.js');
    mod.apriPersona(per.persona_id);
  });

  $('#rc-crea-persona')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const { creaPersona, apriPersona } = await import('./persona.js');
      const pid = await creaPersona({
        titolo: r.rls_titolo, nome: r.rls_nome, cognome: r.rls_cognome, cf: r.rls_cf,
        email: r.rls_email, telefono: r.rls_tel,
        comune_nascita: r.nato_a, indirizzo: r.residenza, comune_res: r.comune_res,
        note: `RLS di ${r.ragione_sociale || '?'} — creata dall'anagrafe RLS (${state.email})`,
      });
      await sb.from('s_rls_anagrafe').update({ persona_id: pid, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', r.id);
      toast('Persona creata in anagrafica.', 'ok');
      chiudiDrawer();
      apriPersona(pid);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      attendi(ev.currentTarget, false);
    }
  });

  $('#rc-prot-in')?.addEventListener('click', async () => {
    chiudiDrawer();
    const mod = await import('./protocollo.js');
    mod.apriForm('IN', {
      data_prot: oggiIso(),
      data_doc: (r.timestamp_modulo || '').slice(0, 10) || null,
      impresa_nome: r.ragione_sociale,
      impresa_id: imp?.impresa_id || null,
      persona: [r.lr_cognome, r.lr_nome].filter(Boolean).join(' ') || null,
      oggetto: `Comunicazione nominativo RLS — ${nomeRls(r)}`,
      note: `${r.tipo_elezione || 'Elezione'} RLS${r.data_verbale ? `, verbale del ${r.data_verbale}` : ''}${r.protocollo_verbale ? ` (Vs. Prot. ${r.protocollo_verbale})` : ''}. RLS: ${nomeRls(r)}${r.rls_cf ? ' — ' + r.rls_cf : ''}.${r.note_modulo ? ' Note: ' + r.note_modulo : ''}`,
      mezzo: 'e-mail',
      cartella: '2_AREE/Servizi_CPT/RLS/comunicazioni_imprese',
    }, true);
    toast('Maschera IN precompilata: allega il PDF di riepilogo e salva.', 'ok');
  });

  $('#rc-riscontro')?.addEventListener('click', (ev) => preparaRiscontro(r, imp, ev.currentTarget));
  $('#rc-eml')?.addEventListener('click', (ev) => riscaricaBozza(r, ev.currentTarget));

  $('#rc-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_rls_anagrafe').update({
      stato: $('#rc-stato').value,
      fine_nomina: $('#rc-fine').value || null,
      note_ufficio: $('#rc-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Comunicazione aggiornata.', 'ok');
    render();
  });
}

/* ── riscontro: lettera + protocollo OUT + Drive + mail ───── */

const slugImpresa = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 40);

async function preparaRiscontro(r, imp, btn) {
  if (!confirm(`Preparo il riscontro di iscrizione all'anagrafe RLS per ${r.ragione_sociale} (${nomeRls(r)}), protocollato in uscita. Procedo?`)) return;
  attendi(btn, true, 'Preparo…');
  try {
    const { corpoRiscontroRls, generaLetteraPdf } = await import('./rlst-lettera.js');
    const paragrafi = corpoRiscontroRls(r);
    const oggettoRiga = `Vostra comunicazione${r.data_verbale ? ` del ${r.data_verbale}` : ''} per la trasmissione del nominativo del Rappresentante dei Lavoratori per la Sicurezza.`;

    const cart = await risolviCartella('2_AREE/Servizi_CPT/RLS/comunicazioni_imprese');
    if (!cart.id) throw new Error('Cartella RLS/comunicazioni_imprese non trovata su Drive');

    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggiIso(),
      data_doc: oggiIso(),
      impresa_nome: r.ragione_sociale,
      impresa_id: imp?.impresa_id || null,
      persona: nomeRls(r),
      oggetto: 'Riscontro comunicazione nominativo RLS — iscrizione al Registro Anagrafe',
      note: paragrafi.join('\n\n'),
      sintesi: `Riscontro alla comunicazione ${r.progressivo ? 'n° ' + r.progressivo + ' del modulo online' : 'RLS'} — ${r.tipo_elezione || 'elezione'} di ${nomeRls(r)}${r.decorrenza ? ', decorrenza ' + dataIt(r.decorrenza) : ''}.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_id: 53,
      tipo_doc_txt: 'Comunicazione RLS',
      cartella: '2_AREE/Servizi_CPT/RLS/comunicazioni_imprese',
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    const pLettera = {
      ...r,
      ind_sede_legale: r.ind_sede,
      comune_legale: null,
      cellulare: null,
      alla_ca_riga: `e.p.c. alla c.a. ${nomeRls(r)}`,
    };
    const pdfByte = await generaLetteraPdf(pLettera, nuovo, paragrafi, oggettoRiga);
    const data = oggiIso().replace(/-/g, '_');
    const nomeFile = `${data}_COMU_Formedil-Padova_riscontro-${/riel/i.test(r.tipo_elezione || '') ? 'rielezione' : 'elezione'}-RLS-${slugImpresa(r.ragione_sociale)}.pdf`;
    const su = await caricaByte(nuovo, nomeFile, pdfByte, 'application/pdf', cart.id);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: pdfByte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

    await sb.from('s_rls_anagrafe').update({
      stato: 'risposta_protocollata',
      protocollo_out_id: nuovo.id,
      lettera_drive_id: su.drive_file_id,
      lettera_drive_url: su.drive_url,
      impresa_id: imp?.impresa_id || r.impresa_id,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', r.id);

    await bozzaRiscontro(r, nuovo, [{ nome: su.file_name || nomeFile, byte: pdfByte }]);
    toast(`Riscontro protocollato (${codiceProtocollo(nuovo)}) e depositato. Bozza mail scaricata: aprila da Outlook e premi Invia.`, 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function riscaricaBozza(r, btn) {
  attendi(btn, true, 'Rileggo la lettera…');
  try {
    const { data: prot } = await sb.from('s_protocollo').select('*').eq('id', r.protocollo_out_id).single();
    const byte = await leggiByte(r.lettera_drive_id);
    await bozzaRiscontro(r, prot, [{ nome: `${siglaProtocollo(prot)}_riscontro-RLS.pdf`, byte }]);
    toast('Bozza scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

async function bozzaRiscontro(r, prot, allegati) {
  /* il verbale di elezione viaggia con la lettera, se raggiungibile */
  if (r.verbale_url) {
    try {
      const vid = idDaLink(r.verbale_url);
      if (vid) allegati.push({ nome: `verbale-elezione-RLS-${slugImpresa(r.ragione_sociale)}.pdf`, byte: await leggiByte(vid) });
    } catch { toast('Verbale non scaricabile da Drive: allegalo a mano alla bozza.', 'err'); }
  }

  const corpo = `Prot. n°: ${siglaProtocollo(prot)}

Prevenzione infortuni.

Oggetto: Riscontro comunicazione nominativo RLS — iscrizione al Registro Anagrafe degli R.L.S.

Spett.le ${(r.ragione_sociale || '').toUpperCase()},
${[r.lr_cognome, r.lr_titolo || 'Sig.', r.lr_nome].filter(Boolean).length > 1 ? `Alla c.a. ${[r.lr_cognome, r.lr_titolo || 'Sig.', r.lr_nome].filter(Boolean).join(' ')}` : ''}
e.p.c.
RLS ${nomeRls(r)}

Vogliate trovare in allegato la comunicazione in oggetto.

Distinti saluti.

${FIRMA_SEGRETERIA}`;

  scaricaEml({
    to: r.email || '',
    cc: CC_RISCONTRO,
    oggetto: `Formedil Padova - Area Sicurezza e Salute - Riscontro comunicazione nominativo RLS - ${siglaProtocollo(prot)}`,
    corpo,
    allegati,
    nomeFile: `riscontro-rls-${slugImpresa(r.ragione_sociale)}.eml`,
  });
}
