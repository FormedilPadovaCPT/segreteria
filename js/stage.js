/* ============================================================
   STAGE ALLIEVI — dagli abbinamenti della Scuola agli incarichi

   Due volte l'anno la didattica manda il Word degli abbinamenti
   allievi-aziende (3ª OE in autunno, 2ª OE in primavera; Barbara
   Bertan per Padova, Alessia Ranci per Stanghella). Ogni riga e'
   una visita da fare allo stagista.

   Il flusso, deciso dall'utente il 10/09/2026:
   1. si carica il Word (solo .docx: il PDF non si legge in modo
      affidabile — se arriva un PDF si chiede il Word o si compila
      l'elenco a mano);
   2. l'app propone impresa (P.IVA, poi nome in anagrafica), comune
      del cantiere e tecnico (colonna TECNICO del file, altrimenti
      la zona) — TUTTO modificabile prima di confermare;
   3. confermando, ogni riga diventa un incarico nel gestionale
      visite per il tecnico: NESSUNA autorizzazione del Direttore,
      e' un costo figurativo della Scuola;
   4. il Word va nel vault, in stage_scolastici, a nome convenzione.

   Un elenco per classe, sede e anno: ricaricando la versione
   aggiornata si aggiungono solo gli allievi nuovi.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { risolviCartella, creaCartella, LIMITE_MB } from './drive.js';
import { caricaModulo } from './cdn.js';
import { riassegnaTecnico } from './incarico-tecnico.js';
import {
  leggiAbbinamenti, candidatiComune, scegliComune, comuneDaElenco, pulisciIndirizzo, tecnicoDalFile,
  testoNotaIncarico, oggettoIncarico, nomeFileElenco, cartellaElenco, richiedenteDaRighe,
  chiaveNome, normNome, pulisci, annoScolasticoDi, leggiModelloRighe, unisciRichiesteStage,
} from './stage-abbinamenti.js';
import { caricaStorico, apriDettaglioStorico } from './servizi-storico.js';

const CARTELLA_VAULT = '2_AREE/Formazione/Scuola_Edile_offerta_formativa/stage_scolastici';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let elenchi = [];
let conteggi = {};
let tecnici = [];
let zone = [];
let referenti = [];
let bozza = null;
/* lo storico delle richieste di visita stage (Access + incarichi), chiesto il 10/09/2026 */
let richieste = [];
const filtroR = { anno: null, sede: '', stato: 'tutte', q: '' };

const nomeTecnico = (email) => {
  const t = tecnici.find((x) => x.email === email);
  return t ? [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' ') : (email || '');
};

/* vince la zona più specifica (stessa regola di visite.js e dell'import) */
const normZona = (s) => String(s || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim();
function tecnicoDiZona(comune) {
  const c = normZona(comune);
  if (!c) return null;
  const match = zone.filter((z) => {
    const zc = normZona(z.comune_nome);
    return zc === c || c.startsWith(`${zc} `) || zc.startsWith(`${c} `);
  });
  if (!match.length) return null;
  const maxLen = Math.max(...match.map((z) => normZona(z.comune_nome).length));
  const email = [...new Set(match.filter((z) => normZona(z.comune_nome).length === maxLen).map((z) => z.email))];
  return email.length === 1 ? email[0] : null;
}

async function carica() {
  const [{ data: e }, { data: t }, { data: z }, { data: c }] = await Promise.all([
    sb.from('s_stage_elenchi').select('*').order('data_richiesta', { ascending: false }).order('id', { ascending: false }),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo, attivo').eq('attivo', true).order('tecnico_cognome'),
    zone.length ? Promise.resolve({ data: zone }) : sb.from('tecnici_zone').select('email, comune_nome'),
    sb.from('s_config').select('chiave, valore').eq('chiave', 'didattica_referenti'),
  ]);
  elenchi = e || [];
  /* fuori le utenze di prova e quelle della segreteria */
  tecnici = (t || []).filter((x) => !/^prova/i.test(x.tecnico_cognome || '') && !/^cpt/i.test(x.email || ''));
  zone = z || [];
  try {
    const v = c?.[0]?.valore;
    referenti = Array.isArray(v) ? v : JSON.parse(v || '[]');
  } catch { referenti = []; }

  conteggi = {};
  if (elenchi.length) {
    const { data: inc } = await sb.from('incarichi')
      .select('stage_elenco_id, stato, accettato_il, rifiutato_il, visita_id')
      .in('stage_elenco_id', elenchi.map((x) => x.id));
    for (const r of inc || []) {
      const k = r.stage_elenco_id;
      if (!conteggi[k]) conteggi[k] = { tot: 0, aperti: 0, chiusi: 0, rifiutati: 0, visite: 0 };
      const c0 = conteggi[k];
      c0.tot++;
      if (r.stato === 'aperto') c0.aperti++; else c0.chiusi++;
      if (r.rifiutato_il && r.stato === 'aperto') c0.rifiutati++;
      if (r.visita_id) c0.visite++;
    }
  }
}

/* ══════════ elenco degli elenchi ══════════ */

export async function render() {
  const host = $('#stage-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();
  try { await caricaRichieste(); }
  catch (e) { richieste = []; toast(`Storico delle richieste stage non caricato: ${e.message}`, 'err'); }

  const righe = elenchi.map((e) => {
    const c = conteggi[e.id] || { tot: 0, aperti: 0, chiusi: 0, rifiutati: 0, visite: 0 };
    return `<tr data-id="${e.id}">
      <td>${esc(e.anno_scolastico)}</td>
      <td><strong>${e.classe}ª OE ${esc(e.sede)}</strong></td>
      <td>${e.dal ? dataIt(e.dal) : '—'} → ${e.al ? dataIt(e.al) : '—'}</td>
      <td>${esc(e.richiedente_nome || '—')}</td>
      <td>${dataIt(e.data_richiesta)}</td>
      <td>${c.tot}</td>
      <td>${c.aperti} aperti · ${c.chiusi} chiusi${c.rifiutati ? ` · <span style="color:#c0392b">${c.rifiutati} rifiutati</span>` : ''}</td>
      <td>${e.file_drive_url ? `<a href="${esc(e.file_drive_url)}" target="_blank" rel="noopener" data-link="1">Word</a>` : '—'}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <p class="hint" style="margin:0">Due elenchi l'anno per sede: 3ª OE in autunno, 2ª OE in primavera. Si carica il <strong>modello Excel</strong> compilato dalla didattica (in alternativa il Word).</p>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" id="st-manuale">+ Elenco a mano</button>
        <label class="btn btn-primary btn-sm" style="cursor:pointer">📄 Carica abbinamenti (Excel o Word)
          <input type="file" id="st-file" accept=".xlsx,.docx,${MIME_XLSX},${MIME_DOCX}" style="display:none">
        </label>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>A.s.</th><th>Classe</th><th>Periodo</th><th>Richiedente</th><th>Arrivato il</th><th>Allievi</th><th>Incarichi</th><th>File</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="8" class="empty">Nessun elenco caricato. Carica il Word degli abbinamenti che manda la scuola.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Le visite agli stagisti <strong>non passano dal Direttore</strong>: sono un costo figurativo della Scuola (regola del 10/09/2026).
      Confermato l'elenco, ogni allievo diventa un incarico nel gestionale visite per il tecnico scelto,
      che dalla pagina Incarichi apre la visita con allievo, ditta e cantiere già compilati.
    </p>

    <h3 style="margin:22px 0 8px">📋 Richieste di visita stage</h3>
    <div class="dt-barra">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <select class="inp inp-sm" id="st-r-anno"></select>
        <select class="inp inp-sm" id="st-r-sede">
          <option value="">Padova e Stanghella</option><option value="Padova">Padova</option><option value="Stanghella">Stanghella</option>
        </select>
        <div class="seg" id="st-r-stato">
          ${[['aperte', 'Aperte'], ['tutte', 'Tutte'], ['chiuse', 'Chiuse']].map(([v, l]) =>
            `<button class="seg-btn ${filtroR.stato === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
        </div>
      </div>
      <input id="st-r-cerca" class="inp" type="search" style="max-width:320px" value="${esc(filtroR.q)}"
        placeholder="Cerca allievo, impresa, comune, tecnico, n°…">
    </div>
    <div id="st-richieste"></div>`;

  $('#st-file').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (f) await apriFile(f);
  });
  $('#st-manuale').addEventListener('click', () => apriBozza({
    file: null, byte: null, avvisi: [], righe: [],
    intestazione: { classe: null, sede: null, anno_scolastico: annoScolasticoDi(oggiIso()), dal: null, al: null, ore_giorno: null, ore_totali: null, testo: '' },
  }));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-link]')) return;
    apriElenco(Number(tr.dataset.id));
  }));

  /* storico delle richieste: filtri e tabella */
  const anni = [...new Set(richieste.map((x) => x.anno_scolastico).filter(Boolean))].sort().reverse();
  if (filtroR.anno === null) filtroR.anno = anni[0] || '';   /* si apre sull'anno più recente */
  $('#st-r-anno').innerHTML = `<option value="">Tutti gli anni</option>${anni.map((a) =>
    `<option value="${a}" ${a === filtroR.anno ? 'selected' : ''}>a.s. ${a}</option>`).join('')}`;
  $('#st-r-sede').value = filtroR.sede;
  $('#st-r-anno').addEventListener('change', (e) => { filtroR.anno = e.target.value; disegnaRichieste(); });
  $('#st-r-sede').addEventListener('change', (e) => { filtroR.sede = e.target.value; disegnaRichieste(); });
  $('#st-r-cerca').addEventListener('input', (e) => { filtroR.q = e.target.value; disegnaRichieste(); });
  $('#st-r-stato').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (!b) return;
    filtroR.stato = b.dataset.val;
    $('#st-r-stato').querySelectorAll('[data-val]').forEach((x) => x.classList.toggle('is-active', x === b));
    disegnaRichieste();
  });
  disegnaRichieste();
}

/* ══════════ storico delle richieste di visita stage ══════════ */

const COLONNE_INC = 'id, data_richiesta, richiedente, testo_richiesta, tipo_richiesta, tipologia_richiesta, impresa, comune, indirizzo, '
  + 'tecnico_nome, stato, presa_visione_il, accettato_il, rifiutato_il, rifiuto_motivo, visita_id, note_comunicazione, '
  + 'stage_elenco_id, referente, cell_referente, oggetto';

async function caricaRichieste() {
  const storico = await caricaStorico();
  const idStage = storico.filter((s) => /stage/i.test(s.tipologia || '')).map((s) => s.id);
  const lotti = [];
  for (let i = 0; i < idStage.length; i += 150) {
    lotti.push(sb.from('incarichi').select(COLONNE_INC).in('id', idStage.slice(i, i + 150)));
  }
  /* le richieste nuove (dagli elenchi) e gli incarichi stage che nello storico non ci sono */
  lotti.push(sb.from('incarichi').select(COLONNE_INC)
    .or('stage_elenco_id.not.is.null,tipo_richiesta.ilike.*stage*,tipologia_richiesta.ilike.*stage*'));
  const risposte = await Promise.all(lotti);
  const err = risposte.find((r) => r.error);
  if (err) throw new Error(err.error.message);
  const perId = new Map();
  for (const r of risposte) for (const i of r.data || []) perId.set(i.id, i);
  richieste = unisciRichiesteStage({ storico, incarichi: [...perId.values()], elenchi });
}

const COLORE_STATO = { chiusa: 'dt-ok', eseguita: 'dt-ok', accettata: 'dt-senzadata', vista: 'dt-senzadata', nuova: 'dt-senzadata', rifiutata: 'dt-scaduto' };

function disegnaRichieste() {
  const box = $('#st-richieste');
  if (!box) return;
  const q = pulisci(filtroR.q).toLowerCase();
  const filtrate = richieste.filter((x) =>
    (!filtroR.anno || x.anno_scolastico === filtroR.anno)
    && (!filtroR.sede || x.sede === filtroR.sede)
    && (filtroR.stato === 'tutte' || (filtroR.stato === 'aperte' ? x.aperta : !x.aperta))
    && (!q || [String(x.id), x.allievo, x.impresa, x.comune, x.tecnico, x.sede].some((v) => (v || '').toLowerCase().includes(q))));
  const aperte = filtrate.filter((x) => x.aperta).length;
  const MOSTRA = 300;
  const righe = filtrate.slice(0, MOSTRA).map((x) => `<tr data-rid="${x.id}">
      <td>${x.storico ? '📜 ' : ''}${x.id}</td>
      <td>${x.data ? dataIt(x.data) : '—'}</td>
      <td>${esc(x.sede || '—')}${x.progetto ? ` <span class="hint">${esc(x.progetto)}</span>` : ''}</td>
      <td>${esc(x.allievo || '—')}</td>
      <td>${esc(x.impresa || '—')}</td>
      <td>${esc(x.comune || '—')}</td>
      <td>${esc(x.tecnico || '—')}</td>
      <td><span class="dt-cella ${COLORE_STATO[x.stato.codice] || ''}" style="padding:2px 8px">${esc(x.stato.testo)}</span></td>
      <td class="hint">${esc(x.esito || '')}</td>
    </tr>`).join('');
  box.innerHTML = `
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Sede</th><th>Allievo</th><th>Impresa</th><th>Comune</th><th>Tecnico</th><th>Stato</th><th>Esito</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="9" class="empty">Nessuna richiesta con questi filtri.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">${filtrate.length} richieste${filtroR.anno ? ` nell'a.s. ${esc(filtroR.anno)}` : ''}, ${aperte} aperte
      ${filtrate.length > MOSTRA ? ` — mostrate le prime ${MOSTRA}` : ''}.
      📜 = presente anche nel registro storico Access (richieste 2021-2026). Lo stato è quello dell'incarico nel gestionale visite.
      L'allievo si legge dall'incarico: nelle richieste del 2021 non era registrato a parte.</p>`;
  box.querySelectorAll('tbody tr[data-rid]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglioRichiesta(richieste.find((x) => x.id === Number(tr.dataset.rid)))));
}

function dettaglioRichiesta(x) {
  if (!x) return;
  const i = x.incarico || {};
  const campo = (l, v) => (v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(String(v))}</div>` : '');
  apriDrawer(`Richiesta di visita stage n° ${x.id}`, '', `<div id="st-dett">
    ${campo('Data richiesta', x.data ? dataIt(x.data) : null)}
    ${campo('Anno scolastico', x.anno_scolastico)}
    ${campo('Sede', x.sede)}
    ${campo('Progetto', x.progetto)}
    ${campo('Richiedente', x.storico?.richiedente || i.richiedente)}
    ${campo('Allievo', x.allievo)}
    ${campo('Impresa', x.impresa)}
    ${campo('Cantiere', [i.indirizzo, x.comune].filter(Boolean).join(', '))}
    ${campo('Tutor aziendale', [i.referente, i.cell_referente].filter(Boolean).join(' — '))}
    ${campo('Tecnico', x.tecnico)}
    ${campo('Stato', x.stato.testo + (i.rifiuto_motivo ? ` — ${i.rifiuto_motivo}` : ''))}
    ${campo('Visita registrata', i.visita_id)}
    ${campo('Esito', x.esito)}
    ${i.note_comunicazione ? `<div class="dt-doc-riga"><strong>Note dell'incarico:</strong><br><span style="white-space:pre-wrap">${esc(i.note_comunicazione)}</span></div>` : ''}
    ${!x.allievo && i.testo_richiesta ? `<div class="dt-doc-riga"><strong>Testo della richiesta:</strong><br><span style="white-space:pre-wrap">${esc(i.testo_richiesta)}</span></div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      ${x.storico ? '<button class="btn btn-ghost btn-sm" data-az="storico">📜 Scheda storica Access</button>' : ''}
      ${x.elenco ? `<button class="btn btn-ghost btn-sm" data-az="elenco">🎒 Elenco ${x.elenco.classe}ª OE ${esc(x.elenco.sede)} ${esc(x.elenco.anno_scolastico)}</button>` : ''}
    </div>
    ${!x.incarico ? '<p class="hint" style="margin-top:10px">Nessun incarico collegato nel gestionale visite: vale solo il registro storico.</p>' : ''}
  </div>`);
  $('#st-dett').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-az]');
    if (!b) return;
    if (b.dataset.az === 'storico') apriDettaglioStorico(x.storico);
    if (b.dataset.az === 'elenco') apriElenco(x.elenco.id);
  });
}

/* ══════════ caricamento del Word ══════════ */

/* SheetJS per il modello Excel: stessa via di caricamento delle altre librerie */
const sheetJs = () => caricaModulo('xlsx', [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm',
  'https://esm.sh/xlsx@0.18.5',
], (m) => typeof (m.read || m.default?.read) === 'function');

async function leggiExcel(byte) {
  const m = await sheetJs();
  const X = m.read ? m : m.default;
  const wb = X.read(byte, { type: 'array' });
  const trova = (re) => wb.SheetNames.find((n) => re.test(n));
  const foglio = (nome) => (nome ? X.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' }) : []);
  const nAllievi = trova(/allievi/i) || wb.SheetNames.find((n) => !/istruz|dati/i.test(n));
  if (!nAllievi) throw new Error('Nel file non c\'è il foglio «Allievi» del modello.');
  return leggiModelloRighe(foglio(trova(/dati/i)), foglio(nAllievi));
}

async function apriFile(f) {
  const excel = /\.xlsx$/i.test(f.name);
  if (!excel && !/\.docx$/i.test(f.name)) {
    toast('Si carica il modello Excel (.xlsx) compilato dalla scuola, o in alternativa il Word (.docx). Un PDF non si legge: chiedi il modello Excel oppure usa «+ Elenco a mano».', 'err');
    return;
  }
  if (f.size > LIMITE_MB * 1024 * 1024) { toast(`Il file supera i ${LIMITE_MB} MB.`, 'err'); return; }
  const byte = new Uint8Array(await f.arrayBuffer());
  let letto;
  try { letto = excel ? await leggiExcel(byte) : await leggiAbbinamenti(byte); }
  catch (e) { toast(`Non riesco a leggere il file: ${e.message}`, 'err'); return; }
  await apriBozza({ file: f, byte, excel, ...letto });
}

const rigaVuota = () => ({
  incluso: true, allievo: '', ragione: '', piva: '', cf: '', impresa_id: '', candidati: [],
  cantieri: [], indirizzo: '', comune: '', tecnico_file: null, tecnico_email: '',
  tutor: '', tutor_tel: '', tutor_formativo: '', tutor_scuola: '', orario: '', avvisi: [], gia: null,
});

async function apriBozza(b) {
  bozza = {
    file: b.file, byte: b.byte,
    int: { ...b.intestazione },
    avvisi: [...(b.avvisi || [])],
    data_richiesta: oggiIso(),
    richiedente_nome: richiedenteDaRighe(b.righe) || '',
    richiedente_email: '',
    esistente: null,
    excel: !!b.excel,
    righe: (b.righe || []).map((r) => ({
      ...rigaVuota(),
      /* dal modello Excel via, civico e comune arrivano già separati: non si indovinano */
      indirizzo: r.cantiere ? [r.cantiere.via, r.cantiere.civico].filter(Boolean).join(' ') : '',
      comune: r.cantiere?.comune ? pulisci(r.cantiere.comune).toUpperCase() : '',
      comune_dato: !!r.cantiere?.comune,
      allievo: r.allievo || '',
      ragione: r.azienda.ragione_sociale || '',
      piva: r.azienda.partita_iva || '',
      cf: r.azienda.codice_fiscale || '',
      cantieri: r.azienda.cantieri || [],
      tecnico_file: r.tecnico_file,
      tutor: r.azienda.tutor_aziendale?.nome || '',
      tutor_tel: r.azienda.tutor_aziendale?.telefono || r.azienda.cellulare || '',
      tutor_formativo: r.azienda.tutor_formativo || '',
      tutor_scuola: r.azienda.tutor_scuola || '',
      orario: r.orario || '',
      avvisi: [...r.avvisi],
    })),
  };
  if (!bozza.righe.length) bozza.righe.push(rigaVuota());
  mostra('<p class="empty">Cerco imprese, comuni e tecnici…</p>');
  try { await proponi(); }
  catch (e) { toast(`Proposte incomplete: ${e.message}`, 'err'); }
  disegnaBozza();
}

function mostra(html) {
  apriDrawer('Abbinamenti stage — controlla e conferma', '', html);
  $('#drawer').classList.add('drawer-xl');
}

/* ══════════ le proposte: impresa, comune, tecnico ══════════ */

async function proponi() {
  const R = bozza.righe;

  /* 1. imprese per P.IVA o codice fiscale */
  const chiavi = [...new Set(R.flatMap((r) => [r.piva, r.cf]).filter(Boolean))];
  if (chiavi.length) {
    const lista = chiavi.map((k) => `"${k}"`).join(',');
    const { data } = await sb.from('imprese').select('impresa_id, impresa_nome, piva, impresa_cf, comune')
      .or(`piva.in.(${lista}),impresa_id.in.(${lista}),impresa_cf.in.(${lista})`).limit(300);
    for (const r of R) {
      const hit = (data || []).filter((i) => [i.piva, i.impresa_id, i.impresa_cf].some((v) => v && (v === r.piva || v === r.cf)));
      if (hit.length) {
        r.candidati = hit;
        r.impresa_id = (hit.find((i) => i.impresa_id === r.piva || i.piva === r.piva) || hit[0]).impresa_id;
      }
    }
  }

  /* 2. per nome, dove la P.IVA non c'è (Padova) o non ha trovato niente */
  await Promise.all(R.filter((r) => !r.impresa_id && r.ragione).map(async (r) => {
    const { data } = await sb.rpc('s_cerca_imprese', { p_testo: chiaveNome(r.ragione), p_limite: 8 });
    r.candidati = data || [];
    const uguali = r.candidati.filter((i) => normNome(i.impresa_nome) === normNome(r.ragione));
    if (uguali.length === 1) r.impresa_id = uguali[0].impresa_id;
    else if (r.candidati.length) r.avvisi.push('Impresa da scegliere fra quelle trovate in anagrafica.');
    else r.avvisi.push('Impresa non trovata in anagrafica: resta il nome scritto.');
  }));

  /* 3. comune del cantiere: i candidati di tutte le righe in poche letture */
  const cand = R.map((r) => (r.comune_dato ? [] : candidatiComune(r.cantieri[0] || '')));
  const nomi = [...new Set(cand.flat().map((c) => c.nome.replace(/"/g, '')))];
  const trovati = [];
  for (let i = 0; i < nomi.length; i += 40) {
    /* ilike senza % = uguale senza badare alle maiuscole; virgolette per apostrofi e spazi */
    const filtro = nomi.slice(i, i + 40).map((n) => `nome.ilike."${n}"`).join(',');
    const { data } = await sb.from('comuni_catastali').select('nome, prov').or(filtro);
    trovati.push(...(data || []));
  }
  const nomiZone = [...new Set(zone.map((z) => z.comune_nome))];
  R.forEach((r, i) => {
    if (r.comune_dato) return;   /* dal modello Excel: il comune l'ha scritto la scuola */
    const primo = r.cantieri[0] || '';
    const scelto = scegliComune(cand[i], trovati);
    r.comune = (scelto?.nome || comuneDaElenco(primo, nomiZone) || '').toUpperCase();
    r.indirizzo = pulisciIndirizzo(primo, r.comune);
    if (primo && !r.comune) r.avvisi.push('Comune del cantiere da indicare.');
  });

  /* 4. tecnico: la colonna TECNICO del file, altrimenti la zona */
  for (const r of R) {
    const dalFile = tecnicoDalFile(r.tecnico_file, tecnici);
    if (r.tecnico_file && !dalFile) r.avvisi.push(`Tecnico «${r.tecnico_file}» del file non riconosciuto.`);
    r.tecnico_email = dalFile || tecnicoDiZona(r.comune) || '';
    if (!r.tecnico_email) r.avvisi.push('Tecnico da scegliere.');
  }

  aggiornaRichiedente();
  await segnaGiaCaricati();
}

function aggiornaRichiedente() {
  const ref = referenti.find((x) => (x.sede || '').toLowerCase() === (bozza.int.sede || '').toLowerCase());
  if (ref) {
    bozza.richiedente_email = ref.email || '';
    if (!bozza.richiedente_nome) bozza.richiedente_nome = ref.nome || '';
  }
}

/* stesso anno, classe e sede già caricati: gli allievi che ci sono già si tolgono dalla spunta */
async function segnaGiaCaricati() {
  const h = bozza.int;
  bozza.esistente = elenchi.find((e) => e.anno_scolastico === h.anno_scolastico && e.classe === Number(h.classe) && e.sede === h.sede) || null;
  for (const r of bozza.righe) r.gia = null;
  if (!bozza.esistente) return;
  const { data } = await sb.from('incarichi').select('id, testo_richiesta').eq('stage_elenco_id', bozza.esistente.id);
  for (const r of bozza.righe) {
    const g = (data || []).find((x) => normNome(x.testo_richiesta) === normNome(r.allievo));
    if (g) { r.gia = g.id; r.incluso = false; }
  }
}

/* ══════════ la maschera di conferma ══════════ */

function disegnaBozza() {
  const h = bozza.int;
  const sel = (v, opzioni) => opzioni.map(([val, lab]) => `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('');
  const optTecnici = (email) => `<option value="">— scegli —</option>${tecnici.map((t) =>
    `<option value="${esc(t.email)}" ${t.email === email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('')}`;
  const n = bozza.righe.filter((r) => r.incluso).length;

  const righe = bozza.righe.map((r, i) => {
    const optImp = `<option value="">— non in anagrafica —</option>${r.candidati.map((c) =>
      `<option value="${esc(c.impresa_id)}" ${c.impresa_id === r.impresa_id ? 'selected' : ''}>${esc(c.impresa_nome || c.impresa_id)}${c.comune ? ` · ${esc(c.comune)}` : ''}</option>`).join('')}`;
    const altri = r.cantieri.length > 1 ? `<div class="hint" title="${esc(r.cantieri.join('\n'))}">+${r.cantieri.length - 1} altri cantieri (nella nota)</div>` : '';
    return `<tr data-i="${i}" style="${r.incluso ? '' : 'opacity:.55'}">
      <td><input type="checkbox" data-k="incluso" ${r.incluso ? 'checked' : ''}></td>
      <td><input class="inp inp-sm" data-k="allievo" value="${esc(r.allievo)}" style="min-width:11em">
        ${r.gia ? `<div class="hint">già caricato: incarico n° ${r.gia}</div>` : ''}
        ${r.avvisi.length ? `<div class="hint" style="color:#b9770e">⚠ ${esc(r.avvisi.join(' · '))}</div>` : ''}</td>
      <td><input class="inp inp-sm" data-k="ragione" value="${esc(r.ragione)}" style="min-width:13em">
        <div style="display:flex;gap:4px;margin-top:3px">
          <select class="inp inp-sm" data-k="impresa_id" style="max-width:15em">${optImp}</select>
          <button class="btn btn-ghost btn-sm" data-az="cerca" title="Cerca in anagrafica">🔍</button>
        </div>
        ${r.piva || r.cf ? `<div class="hint">P.IVA ${esc(r.piva || '—')}${r.cf && r.cf !== r.piva ? ` · CF ${esc(r.cf)}` : ''}</div>` : ''}</td>
      <td><input class="inp inp-sm" data-k="indirizzo" value="${esc(r.indirizzo)}" style="min-width:12em">${altri}</td>
      <td><input class="inp inp-sm" data-k="comune" value="${esc(r.comune)}" style="width:10em"></td>
      <td><select class="inp inp-sm" data-k="tecnico_email">${optTecnici(r.tecnico_email)}</select>
        ${r.tecnico_file ? `<div class="hint">nel file: ${esc(r.tecnico_file)}</div>` : ''}</td>
      <td><input class="inp inp-sm" data-k="tutor" value="${esc(r.tutor)}" style="min-width:9em">
        <input class="inp inp-sm" data-k="tutor_tel" value="${esc(r.tutor_tel)}" placeholder="telefono" style="margin-top:3px"></td>
      <td><input class="inp inp-sm" data-k="orario" value="${esc(r.orario)}" style="min-width:10em"></td>
    </tr>`;
  }).join('');

  mostra(`<div id="st-bozza">
    ${bozza.file ? `<p class="hint" style="margin:0 0 6px">File: <strong>${esc(bozza.file.name)}</strong></p>` : ''}
    ${bozza.avvisi.length ? `<p class="hint" style="color:#b9770e;margin:0 0 6px">⚠ ${esc(bozza.avvisi.join(' · '))}</p>` : ''}
    ${bozza.esistente ? `<p class="hint" style="margin:0 0 6px">Questo elenco è già stato caricato il ${dataIt(bozza.esistente.data_richiesta)}: gli allievi che ci sono già restano senza spunta, si aggiungono solo i nuovi.</p>` : ''}
    <div style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-bottom:10px">
      <div class="field"><label>Sede</label><select class="inp inp-sm" id="st-sede">${sel(h.sede, [['', '—'], ['Padova', 'Padova'], ['Stanghella', 'Stanghella']])}</select></div>
      <div class="field"><label>Classe</label><select class="inp inp-sm" id="st-classe">${sel(h.classe, [['', '—'], [1, '1ª OE'], [2, '2ª OE'], [3, '3ª OE'], [4, '4ª']])}</select></div>
      <div class="field"><label>Anno scolastico</label><input class="inp inp-sm" id="st-anno" value="${esc(h.anno_scolastico || '')}" placeholder="2026-2027"></div>
      <div class="field"><label>Dal</label><input type="date" class="inp inp-sm" id="st-dal" value="${esc(h.dal || '')}"></div>
      <div class="field"><label>Al</label><input type="date" class="inp inp-sm" id="st-al" value="${esc(h.al || '')}"></div>
      <div class="field"><label>Ore al giorno</label><input type="number" class="inp inp-sm" id="st-ore" value="${esc(h.ore_giorno ?? '')}"></div>
      <div class="field"><label>Arrivato il</label><input type="date" class="inp inp-sm" id="st-data" value="${esc(bozza.data_richiesta)}"></div>
      <div class="field"><label>Richiedente</label><input class="inp inp-sm" id="st-rich" value="${esc(bozza.richiedente_nome)}" title="${esc(bozza.richiedente_email)}"></div>
    </div>
    <div class="table-wrap">
      <table class="tbl" data-no-ordina="1">
        <thead><tr><th></th><th>Allievo</th><th>Impresa</th><th>Cantiere (via e civico)</th><th>Comune</th><th>Tecnico</th><th>Tutor aziendale</th><th>Orario</th></tr></thead>
        <tbody>${righe}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" data-az="riga">+ Riga a mano</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" data-az="annulla">Annulla</button>
        <button class="btn btn-primary btn-sm" data-az="conferma">✅ Crea ${n} incarich${n === 1 ? 'o' : 'i'}</button>
      </div>
    </div>
    <p class="hint" style="margin-top:8px">Ogni riga spuntata diventa un incarico nel gestionale visite per il tecnico scelto: servono almeno allievo e tecnico.
      Nessuna autorizzazione del Direttore. Il Word va nel vault in <code>stage_scolastici</code>.</p>
  </div>`);

  const root = $('#st-bozza');
  root.addEventListener('input', aggiornaDaCampo);
  root.addEventListener('change', aggiornaDaCampo);
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-az]');
    if (!b) return;
    const az = b.dataset.az;
    if (az === 'annulla') { bozza = null; chiudiDrawer(); return; }
    if (az === 'riga') { leggiTestata(); bozza.righe.push(rigaVuota()); disegnaBozza(); return; }
    if (az === 'conferma') { await conferma(b); return; }
    if (az === 'cerca') {
      const r = bozza.righe[Number(b.closest('tr[data-i]').dataset.i)];
      const q = (prompt('Cerca l\'impresa in anagrafica (nome o P.IVA):', chiaveNome(r.ragione)) || '').trim();
      if (!q) return;
      const { data } = await sb.rpc('s_cerca_imprese', { p_testo: q, p_limite: 12 });
      r.candidati = data || [];
      r.impresa_id = r.candidati.length === 1 ? r.candidati[0].impresa_id : '';
      if (!r.candidati.length) toast('Nessuna impresa trovata con questo testo.', 'err');
      leggiTestata();
      disegnaBozza();
    }
  });
  ['st-sede', 'st-classe', 'st-anno'].forEach((id) => $(`#${id}`).addEventListener('change', async () => {
    leggiTestata();
    if (id === 'st-sede') { bozza.richiedente_nome = ''; aggiornaRichiedente(); }
    await segnaGiaCaricati();
    disegnaBozza();
  }));
}

function leggiTestata() {
  if (!$('#st-sede')) return;
  bozza.int.sede = $('#st-sede').value || null;
  bozza.int.classe = $('#st-classe').value ? Number($('#st-classe').value) : null;
  bozza.int.anno_scolastico = pulisci($('#st-anno').value) || null;
  bozza.int.dal = $('#st-dal').value || null;
  bozza.int.al = $('#st-al').value || null;
  bozza.int.ore_giorno = $('#st-ore').value ? Number($('#st-ore').value) : null;
  bozza.data_richiesta = $('#st-data').value || oggiIso();
  bozza.richiedente_nome = pulisci($('#st-rich').value);
}

function aggiornaDaCampo(ev) {
  const tr = ev.target.closest('tr[data-i]');
  const k = ev.target.dataset.k;
  if (!tr || !k) return;
  const r = bozza.righe[Number(tr.dataset.i)];
  r[k] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  if (k === 'incluso') {
    tr.style.opacity = r.incluso ? '' : '.55';
    const n = bozza.righe.filter((x) => x.incluso).length;
    const bt = $('#st-bozza [data-az="conferma"]');
    if (bt) bt.textContent = `✅ Crea ${n} incarich${n === 1 ? 'o' : 'i'}`;
  }
  /* cambiando il comune, se il tecnico non è ancora scelto si propone quello di zona */
  if (k === 'comune' && ev.type === 'change' && !r.tecnico_email) {
    const z = tecnicoDiZona(r.comune);
    if (z) { r.tecnico_email = z; const s = tr.querySelector('[data-k="tecnico_email"]'); if (s) s.value = z; }
  }
}

/* ══════════ conferma: Word nel vault, incarichi nel gestionale ══════════ */

async function deposita() {
  const h = bozza.int;
  const base = await risolviCartella(CARTELLA_VAULT);
  if (!base.id) throw new Error('cartella stage_scolastici non trovata su Drive');
  const sub = await creaCartella(base.id, cartellaElenco(bozza.data_richiesta));
  const nome = nomeFileElenco(h, bozza.data_richiesta).replace(/\.docx$/, bozza.excel ? '.xlsx' : '.docx');
  let s = '';
  for (let i = 0; i < bozza.byte.length; i += 0x8000) s += String.fromCharCode(...bozza.byte.subarray(i, i + 0x8000));
  const { data: su, error } = await sb.functions.invoke('allegati-protocollo', {
    body: { action: 'upload', filename: nome, mime_type: bozza.excel ? MIME_XLSX : MIME_DOCX, base64: btoa(s), parent_id: sub.id || base.id },
  });
  if (error || su?.error) throw new Error(su?.error || error.message);
  return { file_nome: su.file_name || nome, file_drive_id: su.drive_file_id, file_drive_url: su.drive_url };
}

async function conferma(btn) {
  leggiTestata();
  const h = bozza.int;
  if (!h.sede || !h.classe || !h.anno_scolastico) { toast('Indica sede, classe e anno scolastico.', 'err'); return; }
  if (!/^\d{4}-\d{4}$/.test(h.anno_scolastico)) { toast('Anno scolastico nella forma 2026-2027.', 'err'); return; }
  const scelte = bozza.righe.filter((r) => r.incluso);
  if (!scelte.length) { toast('Nessuna riga spuntata.', 'err'); return; }
  const incomplete = scelte.filter((r) => !pulisci(r.allievo) || !r.tecnico_email);
  if (incomplete.length) {
    toast(`${incomplete.length} righe spuntate senza allievo o senza tecnico: completale o togli la spunta.`, 'err');
    return;
  }
  if (!confirm(`Creo ${scelte.length} incarichi di visita stage (${h.classe}ª OE ${h.sede}, a.s. ${h.anno_scolastico})?\n`
    + 'Compariranno ai tecnici nella pagina Incarichi del gestionale visite.')) return;

  attendi(btn, true, 'Creo gli incarichi…');
  try {
    let fileInfo = {};
    if (bozza.byte) {
      try { fileInfo = await deposita(); }
      catch (e) {
        if (!confirm(`Il Word non si è depositato su Drive (${e.message}). Creo comunque gli incarichi?`)) return;
      }
    }
    const pElenco = {
      anno_scolastico: h.anno_scolastico, classe: h.classe, sede: h.sede,
      dal: h.dal, al: h.al, ore_giorno: h.ore_giorno, ore_totali: h.ore_totali,
      richiedente_nome: bozza.richiedente_nome || null, richiedente_email: bozza.richiedente_email || null,
      data_richiesta: bozza.data_richiesta, intestazione: h.testo || null,
      oggetto: oggettoIncarico(h), ...fileInfo,
    };
    const pRighe = scelte.map((r) => {
      const imp = r.candidati.find((c) => c.impresa_id === r.impresa_id);
      return {
        allievo: pulisci(r.allievo),
        impresa: imp?.impresa_nome || pulisci(r.ragione) || null,
        impresa_id: r.impresa_id || null,
        indirizzo: pulisci(r.indirizzo) || null,
        cantiere: r.cantieri.length ? r.cantieri.map((c, k) => (r.cantieri.length > 1 ? `${k + 1}) ${c}` : c)).join('\n') : null,
        comune: pulisci(r.comune).toUpperCase() || null,
        tecnico_email: r.tecnico_email,
        referente: pulisci(r.tutor) || null,
        cell_referente: pulisci(r.tutor_tel) || null,
        note: testoNotaIncarico(h, r, bozza.data_richiesta),
      };
    });
    const { data, error } = await sb.rpc('s_stage_conferma', { p_elenco: pElenco, p_righe: pRighe });
    if (error) throw new Error(error.message);
    const creati = data?.creati || [];
    const saltati = data?.saltati || [];
    toast(`${creati.length} incarichi creati${creati.length ? ` (n° ${creati[0].id}${creati.length > 1 ? `–${creati[creati.length - 1].id}` : ''})` : ''}`
      + `${saltati.length ? `; ${saltati.length} saltati: ${saltati.map((x) => `${x.allievo} (${x.motivo})`).join(', ')}` : ''}.`,
      creati.length ? 'ok' : 'err');
    bozza = null;
    chiudiDrawer();
    await render();
    if (data?.elenco_id) await apriElenco(data.elenco_id);
  } catch (e) {
    toast(`Incarichi non creati: ${e.message}`, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ══════════ un elenco già caricato ══════════ */

async function apriElenco(id) {
  const e = elenchi.find((x) => x.id === id);
  if (!e) return;
  const { data: inc } = await sb.from('incarichi')
    .select('id, testo_richiesta, impresa, comune, tecnico_email, tecnico_nome, stato, presa_visione_il, accettato_il, rifiutato_il, rifiuto_motivo, visita_id')
    .eq('stage_elenco_id', id).order('id');
  const statoDi = (r) => r.stato !== 'aperto' ? '✓ chiuso'
    : r.rifiutato_il ? `<span style="color:#c0392b">✋ rifiutato${r.rifiuto_motivo ? `: ${esc(r.rifiuto_motivo)}` : ''}</span>`
    : r.visita_id ? 'visita registrata'
    : r.accettato_il ? 'accettato'
    : r.presa_visione_il ? 'visto dal tecnico' : 'non ancora visto';
  const optTecnici = (email) => tecnici.map((t) => `<option value="${esc(t.email)}" ${t.email === email ? 'selected' : ''}>${esc(nomeTecnico(t.email))}</option>`).join('');
  const righe = (inc || []).map((r) => `<tr data-inc="${r.id}">
      <td>${r.id}</td><td>${esc(r.testo_richiesta || '—')}</td><td>${esc(r.impresa || '—')}</td><td>${esc(r.comune || '—')}</td>
      <td>${r.stato === 'aperto' ? `<select class="inp inp-sm" data-riassegna="${r.id}">${optTecnici(r.tecnico_email)}</select>` : esc(r.tecnico_nome || '—')}</td>
      <td>${statoDi(r)}</td>
    </tr>`).join('');

  apriDrawer(`Stage ${e.classe}ª OE ${e.sede} — a.s. ${e.anno_scolastico}`, '', `<div id="st-elenco">
    <p style="margin:0 0 8px">Periodo ${e.dal ? dataIt(e.dal) : '—'} → ${e.al ? dataIt(e.al) : '—'}${e.ore_giorno ? ` · ${e.ore_giorno} ore al giorno` : ''}
      · richiedente ${esc(e.richiedente_nome || '—')} · arrivato il ${dataIt(e.data_richiesta)}
      ${e.file_drive_url ? ` · <a href="${esc(e.file_drive_url)}" target="_blank" rel="noopener">apri il Word</a>` : ''}</p>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>N°</th><th>Allievo</th><th>Impresa</th><th>Comune</th><th>Tecnico</th><th>Stato</th></tr></thead>
      <tbody>${righe || '<tr><td colspan="6" class="empty">Nessun incarico.</td></tr>'}</tbody>
    </table></div>
    <p class="hint" style="margin-top:8px">Cambiando il tecnico di un incarico aperto parte la riassegnazione (con le due bozze mail).
      Per aggiungere allievi arrivati dopo, ricarica il Word aggiornato dalla pagina: quelli già presenti si saltano.</p>
  </div>`);
  $('#drawer').classList.add('drawer-xl');
  $('#st-elenco').addEventListener('change', async (ev) => {
    const s = ev.target.closest('[data-riassegna]');
    if (!s) return;
    const ok = await riassegnaTecnico({ incaricoId: Number(s.dataset.riassegna), nuovoEmail: s.value });
    if (!ok) { await apriElenco(id); return; }
    await carica();
    await apriElenco(id);
  });
}

/* per il cruscotto o altre viste che vogliano sapere chi carica cosa */
export const _stato = () => ({ utente: state.email, elenchi: elenchi.length });
