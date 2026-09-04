/* ============================================================
   Richiesta VISITA o SERIE di VISITE.

   Il servizio per cui esisteva la stampa Access «Richiesta di
   autorizzazione» (serie richieste 95/2014 → 1082/2026): ogni
   visita chiesta da un'impresa comporta una spesa e passa dal
   Direttore — stesso telaio delle segnalazioni e delle consulenze
   con uscita (PDF + «Autorizza dall'app», visto depositato nel
   vault, deep link #visita-<id>).

   Le richieste arrivano dalla scheda «Visita in Cantiere» del
   foglio (la serie di visite arriva dalla stessa scheda: la
   distingue il tipo o la nota dell'impresa) oppure a mano
   (telefono, mail, PEC). Pre-istruttoria come RLST: P.IVA →
   CEIV → ATECO, precedenza alle iscritte CEIV; tecnico proposto
   dalla zona del cantiere.

   Dopo l'autorizzazione: conferma via mail all'impresa, incarico
   al tecnico; il verbale poi vive nel gestionale visite.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo } from './core.js';
import { APP_URL } from './config.js';
import { risolviCartella, leggiByte, idDaLink } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';
import { collegaRicercaImprese, collegaRicercaPersone, nomePersona } from './ricerca-anagrafica.js';

let pratiche = [];
let tecnici = [];
let zone = [];
let conf = {};
let protDi = {};
/* le tendine del gestionale Access: tipo di richiesta, tipologia (col
   codice CNCPT) e oggetti — i servizi, che si spuntano in piu' d'uno */
let tipiRichiesta = [];
let tipologie = [];
let oggetti = [];
let filtro = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', autorizzata: 'Autorizzata', assegnata: 'Assegnata',
  in_corso: 'In corso', eseguita: 'Eseguita', chiusa: 'Chiusa', scartata: 'Scartata',
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
const PERCORSO_VAULT = '2_AREE/Servizi_CPT/richieste/Richiesta VISITA o SERIE di VISITE';
const TIPO_DOC_VIS = 56;   // s_tipo_doc «Richiesta visita cantiere»

const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;

async function carica() {
  const [{ data: p }, { data: t }, { data: z }, { data: c }] = await Promise.all([
    sb.from('s_visite_richieste').select('*').order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true),
    zone.length ? Promise.resolve({ data: zone }) : sb.from('tecnici_zone').select('email, comune_nome'),
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'direttore_nome', 'direttore_firma_id']),
  ]);
  pratiche = p || [];
  tecnici = t || [];
  zone = z || [];
  conf = Object.fromEntries((c || []).map((r) => [r.chiave, r.valore]));
  if (!tipiRichiesta.length) {
    const [{ data: tr }, { data: tp }, { data: og }] = await Promise.all([
      sb.from('s_tipo_richiesta').select('*').eq('attivo', true).order('ordine'),
      sb.from('s_tipologia_richiesta').select('*').eq('attivo', true).order('id'),
      sb.from('s_oggetto').select('*').eq('attivo', true).order('descrizione'),
    ]);
    tipiRichiesta = tr || []; tipologie = tp || []; oggetti = og || [];
  }
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

/* i campi dell'incarico al tecnico (gestionale visite) per questa pratica */
function campiIncarico(p, email) {
  const cc = cantieriDi(p);
  return {
    tipologia: p.tipo_richiesta === 'serie' ? 'Serie di visite' : 'Sopralluogo in Cantiere - Visita singola',
    tecnicoEmail: email, tecnicoNome: nomeTecnico(email),
    richiedente: [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.ragione_sociale].filter(Boolean).join(' — '),
    testo: p.note_modulo,
    impresa: p.ragione_sociale, impresaId: p.impresa_id,
    indirizzo: cc[0]?.indirizzo || null, comune: cc[0]?.comune || null,
    oggetto: p.tipo_richiesta === 'serie' ? `Serie di visite (${cc.length || '?'} cantieri)` : `Visita richiesta dall'impresa`,
    referente: [p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' ') || null,
    cellReferente: p.ref_tel || null,
    mezzo: p.fonte, visitePreviste: cc.length > 1 ? cc.length : null,
  };
}

/* vince la zona più specifica (stessa regola dell'import v10) */
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

const cantieriDi = (p) => Array.isArray(p.cantieri) ? p.cantieri : [];
const luogoBreve = (p) => {
  const cc = cantieriDi(p);
  if (!cc.length) return '—';
  const primo = [cc[0].indirizzo, cc[0].comune].filter(Boolean).join(', ');
  return cc.length > 1 ? `${primo} (+${cc.length - 1})` : primo;
};

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#visite-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  /* sotto «Chiuse» compaiono anche le storiche di Access, marcate 📜 */
  let storicoDati = [];
  let storicoRighe = '';
  if (filtro === 'chiuse') {
    const { caricaStorico, righeStorico } = await import('./servizi-storico.js');
    storicoDati = (await caricaStorico()).filter((r) => /visit/i.test(r.tipologia || ''));
    storicoRighe = righeStorico(storicoDati, 9);
  }

  const aperte = pratiche.filter((p) => !['chiusa', 'scartata'].includes(p.stato));
  const daAutorizzare = aperte.filter((p) => ['da_richiedere', 'richiesta'].includes(p.aut_stato));
  const daEseguire = aperte.filter((p) => p.aut_stato === 'approvata' && !['eseguita'].includes(p.stato));

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
      <td>${p.progressivo ?? `m${p.id}`}${p.tipo_richiesta === 'serie' ? ' <span class="hint">serie</span>' : ''}</td>
      <td>${p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.ragione_sociale || '?')}</strong></td>
      <td>${esc(luogoBreve(p))}</td>
      <td><span class="dt-cella ${cCeiv}" style="padding:2px 8px">${esc(lCeiv)}</span></td>
      <td><span class="dt-cella ${cAut}" style="padding:2px 8px">${esc(lAut)}</span></td>
      <td>${esc(nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || '—')}${!p.tecnico_assegnato && p.tecnico_proposto ? ' <span class="hint">(proposto)</span>' : ''}</td>
      <td class="hint" style="white-space:nowrap">${prot}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${daAutorizzare.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">⏳ ${daAutorizzare.length} da autorizzare</span>
      <span class="dt-cella ${daEseguire.length ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">🏗️ ${daEseguire.length} autorizzate da eseguire</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">🗂 ${aperte.length} aperte in tutto</span>
    </div>
    <div class="dt-barra">
      <div class="seg" id="vs-f">
        ${[['aperte', 'Da lavorare'], ['autorizzare', '⏳ Da autorizzare'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="vs-storico">📜 Storico Access</button>
        <button class="btn btn-ghost btn-sm" id="vs-importa">⟳ Importa adesso dal foglio</button>
        <button class="btn btn-primary btn-sm" id="vs-nuova">+ Nuova richiesta</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>Cantiere</th><th>CEIV</th><th>Autorizzazione</th><th>Tecnico</th><th>Protocollo</th><th>Stato</th></tr></thead>
        <tbody>${(righe + storicoRighe) || '<tr><td colspan="9" class="empty">Nessuna richiesta con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Ogni visita richiesta da un'impresa passa dall'autorizzazione del Direttore (regola dei servizi CPT).
      Precedenza alle iscritte CEIV; il verbale della visita vive poi nel gestionale.
      Lo storico Access si consulta dalla pagina Segnalazioni, scheda «Storico Access».
    </p>`;

  $('#vs-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#vs-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    const n = data?.visite?.nuove || 0;
    toast(n ? `${n} richieste di visita importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (n) render();
  });
  $('#vs-nuova').addEventListener('click', nuovaRichiesta);
  $('#vs-storico').addEventListener('click', async () => {
    const { apriStoricoServizi } = await import('./servizi-storico.js');
    apriStoricoServizi(host, { titolo: 'Richieste visita storiche (Access, 2011-2026)',
      filtra: (r) => /visit/i.test(r.tipologia || ''), indietro: render });
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
    `<div class="field"><label>${label}</label><input type="${tipo}" id="nv-${id}" placeholder="${ph}"></div>`;
  /* l'impresa scelta dall'anagrafica: se c'e', la pratica nasce gia'
     agganciata e non si ricopia niente a mano */
  let impresaScelta = null;
  let personaScelta = null;

  apriDrawer('Nuova richiesta di visita (manuale)', '', `
    <p class="hint" style="margin:0 0 10px">Per le richieste arrivate fuori dal modulo online (telefono, mail, PEC).
      Cerca prima in anagrafica: quello che c'è già non si riscrive.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Arrivata per *</label>
        <select id="nv-fonte">${FONTI.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo di richiesta *</label>
        <select id="nv-tipo">${tipiRichiesta.map((t) =>
          `<option value="${t.id}"${t.id === 1 ? ' selected' : ''}>${esc(t.descrizione)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Tipologia <span class="hint">(come si classifica la visita — porta il codice CNCPT)</span></label>
      <select id="nv-tipologia"><option value="">— non indicata —</option>${tipologie.map((t) =>
        `<option value="${t.id}"${t.id === 4 ? ' selected' : ''}>${esc(t.descrizione)}${t.codice_cncpt ? ` [CNCPT ${t.codice_cncpt}]` : ''}</option>`).join('')}</select></div>

    <div class="field" style="margin-top:10px"><label>Impresa * <span class="hint">(cerca in anagrafica: ragione sociale, P.IVA o CEIV)</span></label>
      <input type="text" id="nv-cerca-imp" placeholder="almeno 3 caratteri"></div>
    <div id="nv-imp-risultati"></div>
    ${campo('ragione', 'Ragione sociale *')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('piva', 'Partita IVA', 'text', '11 cifre — aggancia CEIV e anagrafica')}${campo('ceiv', 'Codice CEIV dichiarato')}
      ${campo('tel', 'Telefono')}${campo('email', 'Email')}
    </div>
    ${campo('indcant', 'Indirizzo cantiere')}
    ${campo('comcant', 'Comune cantiere', 'text', 'es. PADOVA - Q3 Est, oppure il comune')}

    <div class="field" style="margin-top:10px"><label>Referente <span class="hint">(cerca in anagrafica persone)</span></label>
      <input type="text" id="nv-cerca-per" placeholder="cognome, nome o codice fiscale"></div>
    <div id="nv-per-risultati"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${campo('refnome', 'Referente sopralluogo')}${campo('reftel', 'Cell. referente')}
    </div>

    <div class="field" style="margin-top:10px"><label>Oggetto — i servizi chiesti
      <span class="hint">(se ne spunta più d'uno)</span></label>
      <input type="text" id="nv-ogg-filtro" placeholder="filtra l'elenco…" style="margin-bottom:6px">
      <div id="nv-oggetti" style="max-height:190px;overflow:auto;border:1px solid var(--bordo);border-radius:6px;padding:6px">
        ${oggetti.map((o) => `<label data-ogg="${esc(o.descrizione.toLowerCase())}" style="display:flex;gap:7px;align-items:flex-start;padding:2px 0;font-size:13px">
          <input type="checkbox" value="${o.id}" style="margin-top:3px"><span>${esc(o.descrizione)}</span></label>`).join('')}
      </div>
      <div class="hint" id="nv-ogg-conto" style="margin-top:4px">nessuno spuntato</div></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Ore previste</label><input type="number" step="0.5" min="0" id="nv-ore"></div>
      <div class="field"><label>Corrispettivo €</label><input type="number" step="0.01" min="0" id="nv-corr"></div>
    </div>
    <p class="hint" style="margin:-4px 0 8px">La spesa va messa qui: è il dato su cui il Direttore autorizza,
      e finisce nel foglio della richiesta di autorizzazione.</p>

    <div class="field"><label>Note (preferenze sul tecnico, dettagli della telefonata…)</label><textarea id="nv-note" rows="3"></textarea></div>
    <button class="btn btn-primary" id="nv-crea" style="margin-top:10px">Crea la pratica</button>`);

  /* ── anagrafica: si cerca, e alla scelta i campi si riempiono ── */
  collegaRicercaImprese('#nv-cerca-imp', '#nv-imp-risultati', (i) => {
    impresaScelta = i;
    $('#nv-ragione').value = i.impresa_nome || '';
    $('#nv-piva').value = i.piva || i.impresa_id || '';
    $('#nv-ceiv').value = i.cod_ceiv || '';
    $('#nv-tel').value = i.impresa_telefono || i.cellulare || i.impresa_telefono2 || '';
    $('#nv-email').value = i.impresa_email_ref || i.pec || i.impresa_email2 || '';
    if (!$('#nv-comcant').value) $('#nv-comcant').value = i.comune || '';
    $('#nv-imp-risultati').innerHTML = `<p class="hint">agganciata all'anagrafica ✓ ${esc(i.impresa_nome || '')}`
      + `${i.cod_ceiv ? ` — CEIV ${esc(i.cod_ceiv)}` : ''}${i.stato_cassa ? ` (${esc(i.stato_cassa)})` : ''}</p>`;
  });
  collegaRicercaPersone('#nv-cerca-per', '#nv-per-risultati', (p) => {
    personaScelta = p;
    $('#nv-refnome').value = nomePersona(p);
    if (!$('#nv-reftel').value) $('#nv-reftel').value = p.telefono || p.telefono2 || '';
    $('#nv-per-risultati').innerHTML = `<p class="hint">agganciato all'anagrafica ✓ ${esc(nomePersona(p))}</p>`;
  });

  /* ── oggetti: filtro e contatore ── */
  const contaOggetti = () => {
    const n = $('#nv-oggetti').querySelectorAll('input:checked').length;
    $('#nv-ogg-conto').textContent = n ? `${n} spuntat${n === 1 ? 'o' : 'i'}` : 'nessuno spuntato';
  };
  $('#nv-oggetti').addEventListener('change', contaOggetti);
  $('#nv-ogg-filtro').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $('#nv-oggetti').querySelectorAll('[data-ogg]').forEach((l) => {
      l.style.display = !q || l.dataset.ogg.includes(q) || l.querySelector('input').checked ? '' : 'none';
    });
  });

  $('#nv-crea').addEventListener('click', async (ev) => {
    const ragione = $('#nv-ragione').value.trim();
    if (!ragione) return toast('Serve l\'impresa.', 'err');
    attendi(ev.currentTarget, true);
    const m = $('#nv-piva').value.match(/\d{10,11}/);
    const piva = m ? m[0].padStart(11, '0') : null;
    /* se l'impresa e' stata scelta dall'anagrafica l'aggancio c'e' gia';
       altrimenti si tenta con la partita IVA, come prima */
    let impresaId = impresaScelta?.impresa_id || null;
    let ceivDati = impresaScelta;
    if (!impresaId && piva) {
      const { data: imp } = await sb.from('imprese')
        .select('impresa_id, cod_ceiv, stato_cassa').eq('impresa_id', piva).maybeSingle();
      if (imp) { impresaId = imp.impresa_id; ceivDati = imp; }
    }
    const esito = ceivDati
      ? (ceivDati.cod_ceiv && /attiv/i.test(ceivDati.stato_cassa || '') ? 'iscritta' : 'non_iscritta')
      : 'da_verificare';

    const comune = $('#nv-comcant').value.trim() || null;
    const indirizzo = $('#nv-indcant').value.trim() || null;
    const tipoId = Number($('#nv-tipo').value) || null;
    const tipo = tipiRichiesta.find((t) => t.id === tipoId);
    const oggSel = [...$('#nv-oggetti').querySelectorAll('input:checked')].map((i) => Number(i.value));

    const { data: nuova, error } = await sb.from('s_visite_richieste').insert({
      fonte: $('#nv-fonte').value,
      /* ⚠️ tipo_richiesta resta il vecchio 'visita'/'serie': tutta la
         vista lo confronta cosi' (elenco, dettaglio, PDF di
         autorizzazione, oggetto della mail). La voce vera dell'Access
         sta in tipo_richiesta_id, che e' il dato ricco. */
      tab_origine: 'visita',
      tipo_richiesta: /serie/i.test(tipo?.descrizione || '') ? 'serie' : 'visita',
      tipo_richiesta_id: tipoId,
      tipologia_id: Number($('#nv-tipologia').value) || null,
      oggetti: oggSel.length ? oggSel : null,
      timestamp_modulo: new Date().toISOString(),
      ragione_sociale: ragione,
      partita_iva: piva || $('#nv-piva').value.trim() || null,
      codice_ceiv_dich: $('#nv-ceiv').value.trim() || null,
      telefono: $('#nv-tel').value.trim() || null,
      email: $('#nv-email').value.trim() || null,
      cantieri: (indirizzo || comune) ? [{ indirizzo, comune }] : null,
      ref_nome: $('#nv-refnome').value.trim() || null,
      ref_tel: $('#nv-reftel').value.trim() || null,
      note_modulo: $('#nv-note').value.trim() || null,
      ore: $('#nv-ore').value ? Number($('#nv-ore').value) : null,
      corrispettivo: $('#nv-corr').value ? Number($('#nv-corr').value) : null,
      impresa_id: impresaId,
      persona_id: personaScelta?.persona_id || null,
      esito_ceiv: esito,
      ceiv_verificato_il: new Date().toISOString(),
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
  let ateco = [];
  if (imp) {
    const { data } = await sb.from('imprese_ateco').select('codice').eq('impresa_id', imp.impresa_id);
    ateco = data || [];
  }
  const edile = ateco.length ? ateco.some((a) => /^4[123]/.test(a.codice)) : null;

  const sonoDirettore = state.email && conf.direttore_email &&
    state.email.toLowerCase() === conf.direttore_email.toLowerCase();
  const [cAut, lAut] = AUT[p.aut_stato] || ['', p.aut_stato];
  const cc = cantieriDi(p);
  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Richiesta n° ${p.progressivo ?? `m${p.id}`} — ${p.ragione_sociale || ''}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp && p.esito_ceiv === 'iscritta' ? 'dt-ok' : imp ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">CEIV</span>
      <span class="dt-quadro-stato">${imp
        ? `${imp.cod_ceiv ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.stato_cassa || '')}` : 'nessun codice in anagrafica'}${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}`
        : `non in anagrafica (dichiarato: ${esc(p.codice_ceiv_dich || '—')}) — la precedenza CEIV decide l'ordine`}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${edile === true ? 'dt-ok' : edile === false ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Settore edile (ATECO)</span>
      <span class="dt-quadro-stato">${edile === true ? 'sì' : edile === false ? 'fuori dalle costruzioni' : 'da verificare'}</span>
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
    ${campo('Tipo', tipiRichiesta.find((t) => t.id === p.tipo_richiesta_id)?.descrizione
      || (p.tipo_richiesta === 'serie' ? `Serie di visite (${cc.length} cantieri)` : `Visita singola${p.tipo_visita ? ` — ${p.tipo_visita}` : ''}`))}
    ${(() => { const t = tipologie.find((x) => x.id === p.tipologia_id);
      return t ? campo('Tipologia', t.descrizione + (t.codice_cncpt ? ` — codice CNCPT ${t.codice_cncpt}` : '')) : ''; })()}
    ${p.oggetti?.length ? campo('Oggetto',
      p.oggetti.map((id) => oggetti.find((o) => o.id === id)?.descrizione || `#${id}`).join('; ')) : ''}
    ${campo('P.IVA', p.partita_iva)}
    ${campo('Sede', [p.ind_legale, p.ind_amm].filter(Boolean).join(' / '))}
    ${campo('Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.rl_cf].filter(Boolean).join(' — '))}
    ${campo('Contatti', [p.telefono, p.cellulare, p.email].filter(Boolean).join(' — '))}
    ${campo('Referente sopralluogo', [[p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' '), p.ref_tel].filter(Boolean).join(' — '))}
    ${cc.map((c, i) => `<div class="dt-doc-riga"><strong>Cantiere ${cc.length > 1 ? i + 1 : ''}:</strong> ${esc([c.indirizzo, c.comune].filter(Boolean).join(', ') || '—')}${c.committente ? ` — comm. ${esc(c.committente)}` : ''}${c.importo ? ` — € ${esc(c.importo)}` : ''}${c.durata ? ` — ${esc(c.durata)}` : ''}</div>`).join('')}
    ${p.note_modulo ? `<div class="dt-doc-riga"><strong>Note del modulo:</strong><br>${esc(p.note_modulo)}</div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="vs-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Tecnico assegnato</label>
        <select id="vs-tecnico"><option value="">—</option>${tecnici.map((t) =>
          `<option value="${t.email}" ${(p.tecnico_assegnato || p.tecnico_proposto) === t.email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}</select></div>
      <div class="field"><label>Ore (facoltativo)</label>
        <input type="number" step="0.5" id="vs-ore" value="${p.ore ?? ''}"></div>
      <div class="field"><label>Corrispettivo € (facoltativo)</label>
        <input type="number" step="0.01" id="vs-corr" value="${p.corrispettivo ?? ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="vs-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-primary" id="vs-salva">Salva</button>
    </div>

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Autorizzazione del Direttore</h4>
    ${['approvata', 'respinta'].includes(p.aut_stato) ? `
      <p class="hint" style="margin:0 0 10px">Autorizzazione ${p.aut_stato} da <strong>${esc(p.autorizzata_da || '?')}</strong>${p.data_autorizzazione ? ` il ${dataIt(p.data_autorizzazione)}` : ''}
        (${p.aut_modalita === 'app' ? 'dall’app' : 'giro cartaceo'}).
        ${p.aut_drive_url ? `<a href="${esc(p.aut_drive_url)}" target="_blank" rel="noopener">Apri il documento</a>.` : ''}</p>
      ${p.aut_stato === 'approvata' ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="vs-conferma">📧 Mail di conferma all'impresa</button>
        ${!p.incarico_id ? `<button class="btn btn-ghost" id="vs-incarico">📌 Crea l'incarico al tecnico (gestionale)</button>` : `<span class="dt-cella dt-ok" style="padding:4px 10px">incarico n° ${p.incarico_id} nel gestionale</span>`}
      </div>` : ''}` : `
      <p class="hint" style="margin:0 0 10px">La visita richiesta da un'impresa comporta una spesa:
        non è lavorabile finché il Direttore non autorizza.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="vs-autpdf">📄 Richiesta di autorizzazione (PDF + mail)</button>
        ${sonoDirettore ? `
          <button class="btn btn-primary" id="vs-approva">✅ Approva (Direttore)</button>
          <button class="btn btn-ghost" id="vs-respingi">⛔ Respingi</button>` : `
          <button class="btn btn-ghost" id="vs-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
      </div>`}

    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${!p.protocollo_in_id ? '<button class="btn btn-ghost btn-sm" id="vs-protin">📥 Protocolla la richiesta (IN)</button>' : ''}
    </div>
    <p class="hint" style="margin-top:6px">Il PDF di riepilogo del modulo è il documento da protocollare;
      il verbale della visita vive poi nel gestionale.</p>
  `);

  $('#drawer-body').querySelectorAll('[data-apri-prot]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      chiudiDrawer();
      const mod = await import('./protocollo.js');
      mod.apriDettaglio(Number(a.dataset.apriProt));
    }));

  $('#vs-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_visite_richieste').update({
      stato: $('#vs-stato').value,
      tecnico_assegnato: $('#vs-tecnico').value || null,
      ore: $('#vs-ore').value ? Number($('#vs-ore').value) : null,
      corrispettivo: $('#vs-corr').value ? Number($('#vs-corr').value) : null,
      note_ufficio: $('#vs-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    await render();
  });

  $('#vs-autpdf')?.addEventListener('click', (ev) => richiestaAutorizzazione(p, ev.currentTarget));
  $('#vs-approva')?.addEventListener('click', (ev) => decidiDaApp(p, 'approvata', ev.currentTarget));
  $('#vs-respingi')?.addEventListener('click', (ev) => decidiDaApp(p, 'respinta', ev.currentTarget));
  $('#vs-cartacea')?.addEventListener('click', () => registraCartacea(p));
  $('#vs-conferma')?.addEventListener('click', () => mailConferma(p));
  $('#vs-incarico')?.addEventListener('click', async (ev) => {
    /* per le autorizzazioni registrate a posteriori, che non passano dal gancio automatico */
    const email = $('#vs-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto;
    attendi(ev.currentTarget, true);
    const { creaIncaricoDaPratica } = await import('./incarico-tecnico.js');
    await creaIncaricoDaPratica({ tabella: 's_visite_richieste', pratica: p, ...campiIncarico(p, email) });
    attendi(ev.currentTarget, false);
    await render();
    apriPratica(p.id);
  });
  $('#vs-protin')?.addEventListener('click', () => protocollaIn(p));
}

function campiVisita(p) {
  const cc = cantieriDi(p);
  const righeCantieri = cc.map((c, i) => [
    cc.length > 1 ? `Cantiere ${i + 1}` : 'Cantiere',
    [[c.indirizzo, c.comune].filter(Boolean).join(', '), c.committente ? `comm. ${c.committente}` : null,
      c.importo ? `€ ${c.importo}` : null, c.durata].filter(Boolean).join(' — ') || '—',
  ]);
  return [
    ['Pratica', `Richiesta visita n° ${p.progressivo || p.id}${p.fonte && p.fonte !== 'modulo' ? ` (arrivata per ${p.fonte})` : ' (modulo online)'}`],
    ['Data richiesta', p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10).split('-').reverse().join('/') : '—'],
    /* la tipologia scelta in maschera, se c'e': prima era dedotta dal solo
       «serie/visita», e sul foglio di autorizzazione usciva sempre una
       delle due voci anche quando la richiesta era un'altra cosa */
    ['TipologiaRichiesta', tipologie.find((t) => t.id === p.tipologia_id)?.descrizione
      || (p.tipo_richiesta === 'serie' ? 'Richiesta Serie di Visite' : 'Richiesta Visita da Impresa')],
    ['Tipo di richiesta', tipiRichiesta.find((t) => t.id === p.tipo_richiesta_id)?.descrizione],
    ['Oggetto', (p.oggetti || []).map((id) => oggetti.find((o) => o.id === id)?.descrizione).filter(Boolean).join('; ')],
    ['Impresa', [p.ragione_sociale, p.partita_iva ? `P.IVA ${p.partita_iva}` : ''].filter(Boolean).join(' — ')],
    ['CEIV', p.esito_ceiv === 'iscritta' ? `iscritta (cod. ${p.codice_ceiv_dich || '—'})` : p.esito_ceiv === 'non_iscritta' ? 'NON iscritta' : 'da verificare'],
    ['Legale rappr.', [[p.rl_titolo, p.rl_nome, p.rl_cognome].filter(Boolean).join(' '), p.telefono, p.cellulare, p.email].filter(Boolean).join(' — ')],
    ...righeCantieri,
    ['Referente sopralluogo', [[p.ref_titolo, p.ref_nome, p.ref_cognome].filter(Boolean).join(' '), p.ref_tel].filter(Boolean).join(' — ')],
    /* Il Direttore autorizza una SPESA: se non vede l'importo non ha
       l'elemento su cui decidere. Quando non è stato indicato lo si
       dichiara, invece di lasciare la riga muta. */
    ['Spesa prevista', [
      p.ore != null ? `${p.ore} ore` : null,
      p.corrispettivo != null
        ? `€ ${Number(p.corrispettivo).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null,
    ].filter(Boolean).join(' — ') || 'non indicata'],
    ['Note', p.note_modulo],
  ];
}

async function richiestaAutorizzazione(p, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const tecnico = nomeTecnico($('#vs-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
    const { pdfRichiestaAutCampi } = await import('./segnalazioni-doc.js');
    const byte = await pdfRichiestaAutCampi(campiVisita(p), tecnico,
      'Ai sensi della procedura sui servizi CPT, si chiede al Direttore l’autorizzazione a effettuare la visita richiesta dall’impresa.');
    const n = p.progressivo ?? `m${p.id}`;
    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      cc: coordinatore() ? [coordinatore().email] : [],
      oggetto: `Formedil Padova - Area Sicurezza e Salute - Richiesta di autorizzazione - ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita'} n. ${n}`,
      corpo: `Egr. Direttore,

vogliate trovare in allegato la richiesta di autorizzazione per la ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita'} n. ${n} richiesta da ${p.ragione_sociale || '?'} (${esitoBreve(p)}).
Tecnico proposto: ${tecnico || 'da assegnare'}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#visita-${p.id}

In alternativa resta il giro cartaceo: firmare il foglio allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: `richiesta-autorizzazione_visita-${n}_${slug(p.ragione_sociale)}.pdf`, byte }],
      nomeFile: `richiesta-autorizzazione-visita-${n}.eml`,
    });
    await sb.from('s_visite_richieste').update({
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

const esitoBreve = (p) => p.esito_ceiv === 'iscritta' ? 'iscritta CEIV'
  : p.esito_ceiv === 'non_iscritta' ? 'NON iscritta CEIV' : 'CEIV da verificare';

async function decidiDaApp(p, esito, btn) {
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita'} n° ${p.progressivo ?? p.id} per ${p.ragione_sociale}? Il visto col tuo nome finisce nel documento.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
    const tecnico = nomeTecnico($('#vs-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto);
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
    const byte = await pdfAutorizzazioneCampi(campiVisita(p), tecnico, visto, firmaByte,
      p.tipo_richiesta === 'serie' ? 'Autorizzazione serie di visite' : 'Autorizzazione visita richiesta dall’impresa');

    const cart = await risolviCartella(PERCORSO_VAULT);
    if (!cart.id) throw new Error('Cartella delle richieste visita non trovata su Drive');
    const data = oggiIso().replace(/-/g, '_');
    const n = p.progressivo ?? `m${p.id}`;
    const nomeFile = `${data}_AUT_CPT-Padova_visita-richiesta-${n}-${slug(p.ragione_sociale)}${esito === 'respinta' ? '_respinta' : ''}.pdf`;
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const { error } = await sb.from('s_visite_richieste').update({
      aut_stato: esito,
      aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id,
      aut_drive_url: su.drive_url,
      tecnico_assegnato: $('#vs-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    if (esito === 'approvata') {
      const { creaIncaricoDaPratica } = await import('./incarico-tecnico.js');
      await creaIncaricoDaPratica({ tabella: 's_visite_richieste', pratica: p,
        ...campiIncarico(p, $('#vs-tecnico')?.value || p.tecnico_assegnato || p.tecnico_proposto) });
    }
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
  apriDrawer(`Esito cartaceo — richiesta n° ${p.progressivo ?? p.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="vc-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="vc-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="vc-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <div class="field"><label>Link Drive della scansione (facoltativo)</label><input id="vc-link"></div>
    <button class="btn btn-primary" id="vc-salva" style="margin-top:10px">Registra</button>`);
  $('#vc-salva').addEventListener('click', async (ev) => {
    const esito = $('#vc-esito').value;
    attendi(ev.currentTarget, true);
    const fid = idDaLink($('#vc-link').value);
    const { error } = await sb.from('s_visite_richieste').update({
      aut_stato: esito, aut_modalita: 'cartacea',
      autorizzata_da: $('#vc-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#vc-data').value || oggiIso(),
      aut_drive_id: fid, aut_drive_url: fid ? $('#vc-link').value.trim() : null,
      stato: esito === 'approvata' ? 'autorizzata' : 'scartata',
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Registrazione non riuscita: ' + error.message, 'err');
    if (esito === 'approvata') {
      const { creaIncaricoDaPratica } = await import('./incarico-tecnico.js');
      await creaIncaricoDaPratica({ tabella: 's_visite_richieste', pratica: p,
        ...campiIncarico(p, p.tecnico_assegnato || p.tecnico_proposto) });
    }
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
    oggetto: `Formedil Padova - Area Sicurezza e Salute - Conferma ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita in cantiere'}`,
    corpo: `Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `alla c.a. ${rl},` : ''}

con riferimento alla Vostra richiesta, Vi confermiamo che la ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita in cantiere'} è stata autorizzata.
${tecnico ? `Il tecnico incaricato è ${tecnico}, che contatterà il Vostro referente per concordare l'accesso al cantiere.` : 'Sarete contattati dal tecnico incaricato per concordare l\'accesso al cantiere.'}

Distinti saluti.

${FIRMA_SEGRETERIA}`,
    nomeFile: `conferma-visita-${p.progressivo ?? `m${p.id}`}.eml`,
  });
  toast('Bozza di conferma scaricata: aprila da Outlook e premi Invia.', 'ok');
}

async function protocollaIn(p) {
  chiudiDrawer();
  const mod = await import('./protocollo.js');
  const cc = cantieriDi(p);
  mod.apriForm('IN', {
    data_prot: oggiIso(),
    data_doc: (p.timestamp_modulo || '').slice(0, 10) || null,
    impresa_nome: p.ragione_sociale || null,
    impresa_id: p.impresa_id || null,
    persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
    oggetto: `Richiesta di ${p.tipo_richiesta === 'serie' ? 'serie di visite' : 'visita in cantiere'} — ${cc.map((c) => [c.indirizzo, c.comune].filter(Boolean).join(', ')).join('; ') || 'cantiere da individuare'}`,
    note: p.note_modulo || null,
    sintesi: `Richiesta visita n° ${p.progressivo ?? `m${p.id}`}${p.fonte === 'modulo' ? ' dal modulo online' : ` arrivata per ${p.fonte}`} — ${esitoBreve(p)}. ` +
      `Tecnico: ${nomeTecnico(p.tecnico_assegnato || p.tecnico_proposto) || 'da assegnare'}.`,
    tipo_doc_id: TIPO_DOC_VIS,
    mezzo: p.fonte === 'pec' ? 'PEC' : 'e-mail',
    cartella: PERCORSO_VAULT,
  }, true, async (nuovo) => {
    const { error } = await sb.from('s_visite_richieste').update({
      protocollo_in_id: nuovo.id,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    if (error) throw new Error(error.message);
    toast(`Protocollo ${codiceProtocollo(nuovo)} collegato alla richiesta n° ${p.progressivo ?? `m${p.id}`}.`, 'ok');
  });
  toast('Maschera IN precompilata: allega il PDF di riepilogo del modulo e salva — il numero si collega da solo.', 'ok');
}
