/* ============================================================
   Documenti dei tecnici: catalogo dei requisiti e semaforo.

   Sostituisce la tabella "Polizze" di Access. Il catalogo di cosa
   serve per fare il tecnico sta in s_doc_requisito (viene dal
   contratto, art. 5 e 8, e dal parere FORMEDIL 2022); i documenti
   consegnati stanno in s_doc_tecnico. Lo stato di ogni tecnico non
   si dichiara: si CALCOLA incrociando requisiti e documenti, ed e'
   per questo che la griglia non puo' restare indietro come
   l'evidenza a colori di Access.

   L'avviso al tecnico non parte da qui: si prepara la bozza .eml
   (stesso confine del protocollo: la mail la manda una persona da
   Outlook) e si protocolla con un OUT precompilato. La serie
   interna RS per queste lettere e' chiusa dal 1/10/2026.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, mostraVista, apriDrawer, chiudiDrawer } from './core.js';
import { statoConOre, dettaglioOre, requisitoAOre, statoScadenza, testoScadenza } from './doc-tecnici-ore.js';

let requisiti = [];   // catalogo
let documenti = [];   // tutte le righe s_doc_tecnico
let tecnici = [];     // anagrafica tecnici
let mostraStorici = false;

/* ── date ─────────────────────────────────────────────────── */
function giorniA(iso) {
  return Math.round((new Date(iso) - new Date(oggiIso())) / 86400000);
}

/* ── stato di un tecnico su un requisito ──────────────────────
   Ritorna { classe, testo, doc, scadenza } dove classe e' una di:
   ok | scade | scaduto | senzadata | mancante | na
   Esportata (26/09/2026) perché il cruscotto conti con la stessa
   regola di questa pagina, invece di una sua.                    */
export function statoRequisito(tec, req, docs) {
  if (req.per_chi === 'asseveratori' && !tec.asseveratore) {
    return { classe: 'na', testo: '—' };
  }
  const suoi = docs.filter((d) => d.requisito_id === req.id &&
    (tec.tecnico_id ? d.tecnico_id === tec.tecnico_id : d.cf === tec.cf));
  if (!suoi.length) return { classe: 'mancante', testo: 'mancante' };

  /* requisiti con attestato di base + aggiornamenti a ore (17/11/2026):
     si sommano le ore del periodo, non conta l'ultima riga. Le righe senza
     «tipo» restano valutate come prima, dalla loro data di fine. */
  const origine = req.origine_requisito_id
    ? docs.filter((d) => d.requisito_id === req.origine_requisito_id &&
        (tec.tecnico_id ? d.tecnico_id === tec.tecnico_id : d.cf === tec.cf))
    : [];
  const conOre = statoConOre(req, suoi, oggiIso(), origine);
  if (conOre) {
    return { ...conOre, testo: conOre.testo || dataIt(conOre.scadenza), dettaglio: dettaglioOre(conOre, dataIt) };
  }

  /* la regola di sempre (ultima riga, data di fine, rinnovo tacito) sta in
     doc-tecnici-ore.js dal 18/11/2026: il gestionale la usa uguale per
     mostrare al tecnico contratto e polizze */
  const s = statoScadenza(req, suoi, oggiIso());
  return { ...s, testo: testoScadenza(s, dataIt) };
}
const statoCella = (tec, req) => statoRequisito(tec, req, documenti);

/* fuori dalla griglia: account di prova/servizio e i dipendenti interni
   (i requisiti vengono dal contratto di collaborazione, che loro non hanno) */
export const fuoriGriglia = (t) => t.dipendente || t.tecnico_id === 'TEC-PROVA-2026' || (t.email || '').includes('@did.scuolaedilepadova');

/* ── caricamento ──────────────────────────────────────────── */
async function carica() {
  const [rq, dc, tc, iv] = await Promise.all([
    sb.from('s_doc_requisito').select('*').eq('attivo', true).order('ordine'),
    sb.from('s_doc_tecnico').select('*'),
    sb.from('tecnici').select('tecnico_id, tecnico_cognome, tecnico_nome, email, attivo, asseveratore, dipendente'),
    sb.from('s_doc_tecnico_invii').select('*').eq('stato', 'da_verificare').order('inviato_il'),
  ]);
  requisiti = rq.data || [];
  documenti = dc.data || [];
  tecnici = tc.data || [];
  invii = iv.error ? null : (iv.data || []);
  erroreInvii = iv.error ? iv.error.message : '';
}

/* ── attestati caricati dai tecnici (17/11/2026) ──────────────
   Ogni tecnico carica i suoi dal gestionale (pagina «📄 Documenti»):
   il file è già nel suo fascicolo su Drive, la riga aspetta qui. Non
   conta nelle ore finché la segreteria non la conferma: alla conferma
   nasce la riga di s_doc_tecnico coi valori controllati sul documento
   (crediti_conferma_invio). Il rifiuto chiede il motivo, che il tecnico
   legge nella sua pagina. Niente protocollo: resta nel fascicolo del
   tecnico, come le polizze (deciso dall'utente). */
let invii = [];
let erroreInvii = '';
function pannelloInvii() {
  if (invii === null) return `<p class="hint" style="color:#c0392b;margin:0 0 12px">Non sono riuscito a leggere gli attestati caricati dai tecnici: ${esc(erroreInvii)}</p>`;
  if (!invii.length) return '';
  const nomeTec = (id) => { const t = tecnici.find((x) => x.tecnico_id === id); return t ? `${t.tecnico_cognome} ${t.tecnico_nome}` : id; };
  const nomeReq = (id) => (requisiti.find((r) => r.id === id) || {}).descrizione || id;
  const corpo = invii.map((i) => `<tr>
      <td>${esc(dataIt(String(i.inviato_il).slice(0, 10)))}</td>
      <td>${esc(nomeTec(i.tecnico_id))}</td>
      <td>${esc(nomeReq(i.requisito_id))}</td>
      <td>${esc(i.descrizione)}${i.ente ? ` <span class="hint">(${esc(i.ente)})</span>` : ''}</td>
      <td>${esc(dataIt(i.data_inizio))}</td>
      <td>${i.ore != null ? oreTesto(i.ore) : '—'}</td>
      <td><button class="btn btn-primary btn-sm" data-invio="${i.id}" title="Apre l’attestato e i dati scritti dal tecnico: li controlli sul documento, poi confermi o rifiuti col motivo.">Controlla…</button></td>
    </tr>`).join('');
  return `<div class="dt-invii" style="margin:0 0 16px;padding:10px 12px;border:1px solid var(--bordo);border-left:4px solid #e7500f;border-radius:6px">
      <strong>📤 Attestati caricati dai tecnici: ${invii.length} da controllare</strong>
      <p class="hint" style="margin:6px 0">Il file è già nel fascicolo del tecnico. Non conta nelle ore finché non lo confermi: controlla sul documento requisito, data e ore (i crediti scritti sull’attestato, se ci sono).</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Caricato il</th><th>Tecnico</th><th>Requisito</th><th>Corso</th><th>Data</th><th>Ore</th><th></th></tr></thead>
        <tbody>${corpo}</tbody></table></div></div>`;
}

function apriInvio(id) {
  const i = (invii || []).find((x) => x.id === id);
  if (!i) return;
  const t = tecnici.find((x) => x.tecnico_id === i.tecnico_id) || {};
  const opzReq = requisiti.filter((r) => requisitoAOre(r) || requisiti.some((x) => x.origine_requisito_id === r.id))
    .map((r) => `<option value="${r.id}"${r.id === i.requisito_id ? ' selected' : ''}>${esc(r.descrizione)}</option>`).join('');
  apriDrawer(`Attestato di ${t.tecnico_cognome || ''} ${t.tecnico_nome || ''}`.trim(), '', `
    <p class="hint" style="margin:0 0 10px">Caricato il ${esc(dataIt(String(i.inviato_il).slice(0, 10)))} da ${esc(i.inviato_da)}. File: ${i.drive_url ? `<a href="${esc(i.drive_url)}" target="_blank" rel="noopener">${esc(i.nome_file)}</a>` : esc(i.nome_file)}</p>
    ${i.note_tecnico ? `<p style="margin:0 0 10px"><strong>Nota del tecnico:</strong> ${esc(i.note_tecnico)}</p>` : ''}
    <div class="field"><label>Requisito</label><select id="dti-req">${opzReq}</select></div>
    <div class="field"><label>Tipo</label><select id="dti-tipo">
      <option value="attestato">Attestato di base</option>
      <option value="aggiornamento">Aggiornamento (ore di corso, seminario, convegno)</option>
      <option value="docenza">Docenza (ore tenute)</option>
    </select></div>
    <div class="field"><label>Titolo del corso</label><input id="dti-desc" value="${esc(i.descrizione)}"></div>
    <div class="field"><label>Data del documento</label><input type="date" id="dti-data" value="${esc(i.data_inizio)}"></div>
    <div class="field"><label>Ore che valgono</label><input type="number" id="dti-ore" min="0" step="0.5" value="${i.ore ?? ''}"></div>
    <div class="field"><label>di cui in corsi di aggiornamento (formatori)</label><input type="number" id="dti-corso" min="0" step="0.5" value="${i.ore_di_corso ?? ''}"></div>
    <div class="field"><label>Nota (facoltativa, finisce nella riga del registro)</label><input id="dti-nota" maxlength="500"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
      <button class="btn btn-primary" id="dti-conferma" title="Nasce la riga del registro coi valori di questa scheda: da adesso le ore contano.">✓ Conferma</button>
    </div>
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <div class="field"><label>Motivo del rifiuto (lo legge il tecnico)</label><input id="dti-motivo" maxlength="500" placeholder="Es. è un attestato di frequenza senza ore: serve quello con le ore"></div>
    <button class="btn btn-ghost" id="dti-rifiuta" title="Il tecnico vede «Non accettato» col motivo. Il file resta nel suo fascicolo: se è sbagliato, spostalo o cestinalo da Drive.">Rifiuta</button>`);
  $('#dti-tipo').value = i.tipo;
  $('#dti-conferma').addEventListener('click', async () => {
    const num = (id) => ($(id).value === '' ? null : Number($(id).value));
    const tipo = $('#dti-tipo').value;
    const btn = $('#dti-conferma');
    attendi(btn, true, 'Confermo…');
    const { error } = await sb.rpc('crediti_conferma_invio', {
      p_id: i.id, p_requisito_id: Number($('#dti-req').value), p_tipo: tipo, p_data: $('#dti-data').value || null,
      p_ore: num('#dti-ore'), p_ore_di_corso: tipo === 'aggiornamento' ? num('#dti-corso') : null,
      p_descrizione: $('#dti-desc').value, p_nota: $('#dti-nota').value,
    });
    attendi(btn, false);
    if (error) return toast('Non confermato: ' + error.message, 'err');
    toast('Confermato: le ore contano da adesso.', 'ok');
    chiudiDrawer();
    await render();
  });
  $('#dti-rifiuta').addEventListener('click', async () => {
    const motivo = $('#dti-motivo').value.trim();
    if (!motivo) return toast('Scrivi il motivo: lo legge il tecnico.', 'err');
    const btn = $('#dti-rifiuta');
    attendi(btn, true, 'Registro il rifiuto…');
    const { error } = await sb.rpc('crediti_rifiuta_invio', { p_id: i.id, p_motivo: motivo });
    attendi(btn, false);
    if (error) return toast('Non registrato: ' + error.message, 'err');
    toast('Rifiutato: il tecnico vede il motivo nella sua pagina.', 'ok');
    chiudiDrawer();
    await render();
  });
}

/* Le righe della griglia: i tecnici attivi veri, piu' (a richiesta)
   gli storici — tecnici disattivati e persone rimaste solo come
   testo nell'import Access. */
function righeGriglia() {
  const esclusi = fuoriGriglia;
  const visti = new Set();
  const righe = [];
  for (const t of tecnici.filter((t) => t.attivo && !esclusi(t))) {
    const chiave = `${t.tecnico_cognome} ${t.tecnico_nome}`.toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    righe.push({ ...t, nome: `${t.tecnico_cognome} ${t.tecnico_nome}`, storico: false });
  }
  if (mostraStorici) {
    for (const t of tecnici.filter((t) => !t.attivo && !esclusi(t))) {
      righe.push({ ...t, nome: `${t.tecnico_cognome} ${t.tecnico_nome}`, storico: true });
    }
    const conId = new Set(tecnici.map((t) => t.tecnico_id));
    const soloTesto = new Map();
    for (const d of documenti) {
      if (!d.tecnico_id && d.cf && !soloTesto.has(d.cf)) {
        soloTesto.set(d.cf, { tecnico_id: null, cf: d.cf, nome: d.persona_txt, asseveratore: false, storico: true });
      }
    }
    righe.push(...soloTesto.values());
  }
  return righe;
}

/* ── vista principale ─────────────────────────────────────── */
export async function render() {
  const host = $('#doc-tecnici-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const righe = righeGriglia();
  const testata = requisiti.map((r) =>
    `<th class="dt-th" title="${esc(r.descrizione)}${r.fonte ? ' — ' + esc(r.fonte) : ''}${r.note ? ' — ' + esc(r.note) : ''}">${esc(r.breve || r.descrizione)}</th>`).join('');

  const corpo = righe.map((t) => {
    const celle = requisiti.map((r) => {
      const s = statoCella(t, r);
      return `<td class="dt-cella dt-${s.classe}" data-tec="${esc(t.tecnico_id || t.cf || '')}" data-req="${r.id}">${esc(s.testo)}</td>`;
    }).join('');
    return `<tr class="${t.storico ? 'dt-riga-storico' : ''}">
      <td class="dt-nome" data-tecnico="${esc(t.tecnico_id || t.cf || '')}">
        ${esc(t.nome)}${t.asseveratore ? ' <span class="dt-ass" title="asseveratore">A</span>' : ''}
      </td>${celle}</tr>`;
  }).join('');

  host.innerHTML = `
    <div id="la-host"></div>
    ${pannelloInvii()}
    ${pannelloCrediti(righe)}
    <div class="dt-barra">
      <div class="dt-legenda">
        <span class="dt-dot dt-ok"></span> valido
        <span class="dt-dot dt-scade"></span> in scadenza
        <span class="dt-dot dt-scaduto"></span> scaduto
        <span class="dt-dot dt-senzadata"></span> senza data
        <span class="dt-dot dt-mancante"></span> mancante
        <span class="dt-tacito-hint">⟳ = rinnovo tacito, corre da solo</span>
      </div>
      <label class="dt-storici"><input type="checkbox" id="dt-storici" ${mostraStorici ? 'checked' : ''}> mostra storici</label>
    </div>
    <div class="table-wrap">
      <table class="tbl dt-tbl">
        <thead><tr><th>Tecnico</th>${testata}</tr></thead>
        <tbody>${corpo}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Clic su una casella per vedere e registrare i documenti; clic sul nome per il quadro
      del tecnico e la bozza di avviso. Le tre polizze vanno consegnate entro 10 giorni
      dalla firma del contratto (art. 5).
    </p>`;

  $('#dt-storici').addEventListener('change', (e) => { mostraStorici = e.target.checked; render(); });
  host.querySelectorAll('[data-invio]').forEach((b) => b.addEventListener('click', () => apriInvio(Number(b.dataset.invio))));
  host.querySelectorAll('[data-crediti-tec]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); apriTecnico(b.dataset.creditiTec); }));
  host.querySelectorAll('[data-crediti-cella]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const [tec, req] = b.dataset.creditiCella.split('|');
    apriCella(tec, Number(req));
  }));
  host.querySelectorAll('.dt-cella').forEach((c) => c.addEventListener('click', () =>
    apriCella(c.dataset.tec, Number(c.dataset.req))));
  host.querySelectorAll('.dt-nome').forEach((c) => c.addEventListener('click', () =>
    apriTecnico(c.dataset.tecnico)));
  /* (21/10/2026) le lettere di affiancamento dei tecnici nuovi: firma del Direttore, poi del tecnico */
  import('./lettera-affiancamento.js')
    .then((m) => m.boxLettere($('#la-host'), render))
    .catch((e) => { $('#la-host').innerHTML = `<p class="hint" style="color:#c0392b">Le lettere di affiancamento non si sono caricate: ${esc(e.message)}</p>`; });
}

/* ── crediti formativi (17/11/2026) ───────────────────────────
   Per i requisiti a ore (aggiornamento del coordinatore, formatori):
   chi è in difetto, chi va avvisato (dentro il preavviso del catalogo,
   180 giorni: un corso va trovato e programmato) e chi è in regola,
   con le ore e la data «in regola fino al». L'avviso al tecnico è quello
   di sempre (bozza .eml + protocollo OUT dal quadro del tecnico): la
   mail la manda una persona (decisione dell'utente del 17/11/2026). */
const ORDINE_CREDITI = { scaduto: 0, scade: 1, senzadata: 2, mancante: 3, ok: 4 };
function pannelloCrediti(righe) {
  const reqOre = requisiti.filter(requisitoAOre);
  if (!reqOre.length) return '';
  const voci = [];
  for (const t of righe.filter((x) => !x.storico)) {
    for (const r of reqOre) {
      const s = statoCella(t, r);
      if (s.classe === 'na') continue;
      voci.push({ t, r, s });
    }
  }
  voci.sort((a, b) => (ORDINE_CREDITI[a.s.classe] ?? 9) - (ORDINE_CREDITI[b.s.classe] ?? 9) ||
    String(a.s.scadenza || '').localeCompare(String(b.s.scadenza || '')));
  const daFare = voci.filter((v) => v.s.classe !== 'ok').length;
  const giorni = (iso) => (iso ? giorniA(iso) : null);
  const corpo = voci.map(({ t, r, s }) => {
    const g = giorni(s.scadenza);
    const urgente = s.classe === 'scade' && g != null && g <= 60 ? ' <strong>(entro 2 mesi)</strong>' : '';
    const ore = s.soglia ? `${oreTesto(s.ore ?? 0)} / ${oreTesto(s.soglia)}` : '—';
    const fino = s.classe === 'scaduto' ? `scaduto il ${dataIt(s.scadenza)}` : s.scadenza ? `${dataIt(s.scadenza)}${urgente}` : '—';
    return `<tr>
      <td><span class="dt-dot dt-${s.classe}"></span> <a href="#" data-crediti-tec="${esc(t.tecnico_id || t.cf || '')}">${esc(t.nome)}</a></td>
      <td><a href="#" data-crediti-cella="${esc(t.tecnico_id || t.cf || '')}|${r.id}">${esc(r.breve || r.descrizione)}</a></td>
      <td>${ore}</td>
      <td>${fino}</td>
      <td class="hint">${esc(s.dettaglio || (s.classe === 'mancante' ? 'nessun documento registrato' : s.testo || ''))}</td>
    </tr>`;
  }).join('');
  return `
    <details class="dt-crediti" ${daFare ? 'open' : ''} style="margin:0 0 16px">
      <summary><strong>🎓 Crediti formativi</strong> — ${daFare ? `${daFare} ${daFare === 1 ? 'voce da seguire' : 'voci da seguire'}` : 'tutti in regola'}</summary>
      <p class="hint" style="margin:8px 0">Aggiornamento del coordinatore (40 ore negli ultimi cinque anni) e dei formatori (24 ore per triennio). «In regola fino al» è il giorno in cui, senza altri corsi, le ore non bastano più. Clic sul nome per preparare l'avviso, sul requisito per registrare un corso.</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Tecnico</th><th>Requisito</th><th>Ore</th><th>In regola fino al</th><th>Situazione</th></tr></thead>
        <tbody>${corpo}</tbody>
      </table></div>
    </details>`;
}

function trovaRiga(chiave) {
  return righeGriglia().find((t) => (t.tecnico_id || t.cf) === chiave);
}

const TIPI = { attestato: 'Attestato di base', aggiornamento: 'Aggiornamento (ore di corso, seminario, convegno)', docenza: 'Docenza (ore tenute)' };
const oreTesto = (x) => (x == null || x === '' ? '?' : String(Number(x)).replace('.', ','));

/* ── drawer di cella: i documenti di un requisito ─────────── */
function apriCella(chiaveTec, reqId) {
  const t = trovaRiga(chiaveTec);
  const req = requisiti.find((r) => r.id === reqId);
  if (!t || !req) return;

  const suoi = documenti
    .filter((d) => d.requisito_id === reqId && (t.tecnico_id ? d.tecnico_id === t.tecnico_id : d.cf === t.cf))
    .sort((a, b) => (b.data_inizio || '').localeCompare(a.data_inizio || ''));

  const righe = suoi.map((d) => `
    <div class="dt-doc" data-id="${d.id}">
      <div class="dt-doc-testa">
        <strong>${esc(d.descrizione || req.descrizione)}</strong>
        <span>${d.tipo === 'aggiornamento' || d.tipo === 'docenza'
          ? `${d.data_inizio ? dataIt(d.data_inizio) : '?'} · ${oreTesto(d.ore)} ore`
          : `${d.data_inizio ? dataIt(d.data_inizio) : '?'} → ${d.senza_scadenza ? 'senza scadenza' : d.data_fine ? dataIt(d.data_fine) : 'senza data'}`}</span>
      </div>
      ${d.tipo ? `<div class="dt-doc-riga">${esc(TIPI[d.tipo] || d.tipo)}${d.tipo === 'aggiornamento' && d.ore_di_corso != null ? ` · di cui in corsi di aggiornamento ${oreTesto(d.ore_di_corso)} ore` : ''}</div>` : ''}
      ${d.protocollo_txt ? `<div class="dt-doc-riga">Prot. ${esc(d.protocollo_txt)}</div>` : ''}
      ${d.disdetto_il ? `<div class="dt-doc-riga">Disdetto il ${dataIt(d.disdetto_il)}</div>` : ''}
      ${d.drive_url ? `<div class="dt-doc-riga"><a href="${esc(d.drive_url)}" target="_blank" rel="noopener">Apri su Drive</a></div>` : ''}
      ${d.note ? `<div class="dt-doc-note">${esc(d.note)}</div>` : ''}
      <div class="dt-doc-azioni">
        <button class="btn btn-ghost btn-sm" data-mod="${d.id}">Modifica</button>
        <button class="btn btn-ghost btn-sm" data-del="${d.id}">Elimina</button>
      </div>
    </div>`).join('') || '<p class="empty">Nessun documento registrato.</p>';

  const sit = requisitoAOre(req) ? statoCella(t, req) : null;
  const situazione = sit && sit.dettaglio
    ? `<div class="dt-situazione dt-${sit.classe}" style="margin:0 0 12px;padding:8px 10px;border-radius:6px">
         <strong>${esc(etichetta(sit))}</strong>
         ${sit.manca > 0 ? `<div>Mancano ${oreTesto(sit.manca)} ore nel periodo.</div>` : ''}
       </div>` : '';

  apriDrawer(`${t.nome} — ${req.descrizione}`, '', `
    ${req.note ? `<p class="hint" style="margin:0 0 12px">${esc(req.note)}</p>` : ''}
    ${situazione}
    ${righe}
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 10px">Registra un documento</h4>
    <div id="dt-form"></div>`);

  disegnaForm(t, req, null);
  $('#drawer-body').querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', () => {
    disegnaForm(t, req, documenti.find((d) => d.id === Number(b.dataset.mod)));
    $('#dt-form').scrollIntoView({ behavior: 'smooth' });
  }));
  $('#drawer-body').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Eliminare questa riga dal registro? Il documento su Drive non viene toccato.')) return;
    const { error } = await sb.from('s_doc_tecnico').delete().eq('id', Number(b.dataset.del));
    if (error) return toast('Non riesco a eliminare: ' + error.message, 'err');
    toast('Riga eliminata.', 'ok');
    await render();
    apriCella(chiaveTec, reqId);
  }));
}

/* form di registrazione/modifica dentro il drawer */
function disegnaForm(t, req, doc) {
  const d = doc || {};
  /* una riga vecchia (senza tipo) si modifica com'era: aprirla e salvarla non
     deve trasformarla; il conteggio a ore vale per le righe nuove */
  const aOre = requisitoAOre(req) && !(doc && !doc.tipo);
  const haBase = documenti.some((x) => x.requisito_id === req.id && x.tipo === 'attestato' &&
    (t.tecnico_id ? x.tecnico_id === t.tecnico_id : x.cf === t.cf));
  const tipoIniziale = d.tipo || (aOre ? (haBase ? 'aggiornamento' : 'attestato') : '');
  const tipiAmmessi = ['attestato', 'aggiornamento', ...(req.docenza_alternativa ? ['docenza'] : [])];
  const bloccoOre = aOre ? `
    <div class="field"><label>Che cosa registri</label>
      <select id="dtf-tipo">
        <option value="attestato">Attestato di base</option>
        <option value="aggiornamento">Aggiornamento (ore di corso, seminario, convegno)</option>
        <option value="docenza">Docenza (ore tenute)</option>
      </select></div>
    <p class="hint" id="dtf-tipo-hint" style="margin:6px 0 0"></p>
    <div id="dtf-ore-box" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="field"><label>Ore</label><input type="number" id="dtf-ore" min="0" step="0.5" value="${d.ore ?? ''}"></div>
      ${req.ore_soglia_corsi ? `<div class="field"><label>di cui in corsi di aggiornamento</label><input type="number" id="dtf-ore-corso" min="0" step="0.5" value="${d.ore_di_corso ?? ''}"></div>` : '<div></div>'}
    </div>` : '';
  $('#dt-form').innerHTML = `
    ${bloccoOre}
    <div class="field" style="margin-top:8px"><label>Descrizione</label>
      <input type="text" id="dtf-desc" value="${esc(d.descrizione || '')}" placeholder="es. polizza n° … / contratto prot …"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="field"><label id="dtf-inizio-et">Inizio validità</label><input type="date" id="dtf-inizio" value="${d.data_inizio || ''}"></div>
      <div class="field" id="dtf-fine-box"><label>Fine validità</label><input type="date" id="dtf-fine" value="${d.data_fine || ''}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="field"><label>Protocollo</label><input type="text" id="dtf-prot" value="${esc(d.protocollo_txt || '')}" placeholder="es. 2405/2025"></div>
      ${req.rinnovo === 'tacito' ? `<div class="field"><label>Disdetto il</label><input type="date" id="dtf-disdetta" value="${d.disdetto_il || ''}"></div>` : '<div></div>'}
    </div>
    <div class="field" style="margin-top:8px"><label>Link Drive (facoltativo)</label>
      <input type="text" id="dtf-drive" value="${esc(d.drive_url || '')}" placeholder="https://drive.google.com/…"></div>
    <label class="dt-storici" style="margin-top:8px"><input type="checkbox" id="dtf-senza" ${d.senza_scadenza ? 'checked' : ''}> senza scadenza (es. tempo indeterminato)</label>
    <div class="field" style="margin-top:8px"><label>Note</label><textarea id="dtf-note">${esc(d.note || '')}</textarea></div>
    <button class="btn btn-primary" id="dtf-salva" style="margin-top:12px">${doc ? 'Salva le modifiche' : 'Registra'}</button>`;

  /* con il conteggio a ore, l'aggiornamento e la docenza hanno una data sola
     (quella del corso) e delle ore; la scadenza la calcola l'app */
  const adattaTipo = () => {
    if (!aOre) return;
    const tipo = $('#dtf-tipo').value;
    const aggiorn = tipo === 'aggiornamento' || tipo === 'docenza';
    $('#dtf-fine-box').style.display = aggiorn || tipo === 'attestato' ? 'none' : '';
    $('#dtf-ore-box').style.display = aggiorn ? '' : 'none';
    $('#dtf-inizio-et').textContent = aggiorn ? 'Data del corso (fine corso)' : 'Data dell\'attestato';
    $('#dtf-tipo-hint').textContent = tipo === 'attestato'
      ? (req.periodo_mobile
        ? `Data di fine del corso abilitante. Per ${Math.round(req.durata_mesi / 12)} anni non servono ore; poi a ogni data servono ${req.ore_soglia} ore negli ultimi ${Math.round(req.durata_mesi / 12)} anni. La scadenza la calcola l'app.`
        : `Da qui partono i periodi di ${Math.round(req.durata_mesi / 12)} anni. La scadenza la calcola l'app dalle ore degli aggiornamenti: non serve la fine validità.`)
      : tipo === 'docenza'
        ? `Ore di docenza tenute: valgono in alternativa agli aggiornamenti (${req.ore_soglia} ore nel periodo).`
        : `Un corso, un seminario o un convegno. Servono ${req.ore_soglia} ore nel periodo${req.ore_soglia_corsi ? `, di cui almeno ${req.ore_soglia_corsi} in corsi di aggiornamento` : ''}: si sommano più registrazioni.`;
  };
  if (aOre) {
    /* la docenza solo dove la norma la ammette; il valore di partenza lo dà la riga */
    const optDoc = $('#dtf-tipo').querySelector('option[value="docenza"]');
    if (!tipiAmmessi.includes('docenza')) optDoc.remove();
    $('#dtf-tipo').value = tipoIniziale;
  }
  $('#dtf-tipo')?.addEventListener('change', adattaTipo);
  adattaTipo();

  $('#dtf-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const tipo = aOre ? $('#dtf-tipo').value : null;
    const conOre = tipo === 'aggiornamento' || tipo === 'docenza';
    if (conOre && !($('#dtf-ore').value !== '' && Number($('#dtf-ore').value) > 0)) {
      return toast('Scrivi le ore dell\'aggiornamento: senza ore non si può sommare.', 'err');
    }
    if (aOre && !$('#dtf-inizio').value) {
      return toast('Serve la data: da lì partono i periodi.', 'err');
    }
    const riga = {
      descrizione: $('#dtf-desc').value.trim() || null,
      data_inizio: $('#dtf-inizio').value || null,
      data_fine: aOre ? null : ($('#dtf-fine').value || null),
      ...(aOre ? {
        tipo,
        ore: conOre ? Number($('#dtf-ore').value) : null,
        ore_di_corso: tipo === 'aggiornamento' && $('#dtf-ore-corso') && $('#dtf-ore-corso').value !== ''
          ? Number($('#dtf-ore-corso').value) : null,
      } : {}),
      protocollo_txt: $('#dtf-prot').value.trim() || null,
      disdetto_il: $('#dtf-disdetta')?.value || null,
      drive_url: $('#dtf-drive').value.trim() || null,
      senza_scadenza: $('#dtf-senza').checked,
      note: $('#dtf-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    };
    attendi(btn, true);
    let error;
    if (doc) {
      ({ error } = await sb.from('s_doc_tecnico').update(riga).eq('id', doc.id));
    } else {
      Object.assign(riga, {
        tecnico_id: t.tecnico_id || null,
        persona_txt: t.nome,
        cf: t.cf || null,
        requisito_id: req.id,
        creato_da: state.email,
      });
      ({ error } = await sb.from('s_doc_tecnico').insert(riga));
    }
    attendi(btn, false);
    if (error) return toast('Non riesco a salvare: ' + error.message, 'err');
    toast(doc ? 'Documento aggiornato.' : 'Documento registrato.', 'ok');
    await render();
    apriCella(t.tecnico_id || t.cf, req.id);
  });
}

/* ── drawer di tecnico: quadro completo e avviso ──────────── */
function apriTecnico(chiave) {
  const t = trovaRiga(chiave);
  if (!t) return;

  const stati = requisiti
    .map((r) => ({ req: r, s: statoCella(t, r) }))
    .filter((x) => x.s.classe !== 'na');
  const daAvvisare = stati.filter((x) => ['scade', 'scaduto', 'mancante', 'senzadata'].includes(x.s.classe));

  const righe = stati.map((x) => `
    <div class="dt-quadro-riga">
      <span class="dt-dot dt-${x.s.classe}"></span>
      <span class="dt-quadro-req">${esc(x.req.descrizione)}</span>
      <span class="dt-quadro-stato">${esc(etichetta(x.s))}</span>
    </div>`).join('');

  apriDrawer(t.nome, '', `
    ${righe}
    ${t.email ? '' : '<p class="hint" style="margin-top:10px">Nessuna email in anagrafica: la bozza va completata a mano.</p>'}
    ${daAvvisare.length ? `
      <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
      <h4 style="margin:0 0 6px">Avviso al tecnico</h4>
      <p class="hint" style="margin:0 0 10px">
        ${daAvvisare.length} ${daAvvisare.length === 1 ? 'voce da sistemare' : 'voci da sistemare'}.
        La bozza si apre in Outlook e la invii tu; l'avviso va protocollato in uscita
        (il numero interno RS non si usa più).
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="dt-avviso">📧 Prepara la bozza (.eml)</button>
        <button class="btn btn-ghost" id="dt-protocolla">📤 Apri protocollo OUT precompilato</button>
      </div>` : '<p class="hint" style="margin-top:12px">Tutto in ordine: niente da avvisare.</p>'}
  `);

  $('#dt-avviso')?.addEventListener('click', () => scaricaAvviso(t, daAvvisare));
  $('#dt-protocolla')?.addEventListener('click', async () => {
    chiudiDrawer();
    const mod = await import('./protocollo.js');
    mod.apriForm('OUT', {
      persona: t.nome,
      oggetto: 'Avviso scadenza documenti — comunicazione stato validità',
      note: testoAvviso(t, daAvvisare),
      data_prot: oggiIso(),
    }, true);
  });
}

function etichetta(s) {
  const base = {
    ok: 'valido' + (s.testo.includes('⟳') ? ' (tacito), fino al ' + s.testo.replace(' ⟳', '') : s.scadenza ? ' fino al ' + s.testo : (s.testo !== 'presente' ? ' — ' + s.testo : '')),
    scade: 'in scadenza il ' + s.testo,
    scaduto: 'SCADUTO il ' + s.testo,
    senzadata: s.dettaglio || s.soglia ? s.testo : 'presente ma senza data di scadenza',
    mancante: 'MANCANTE',
  }[s.classe] || s.testo;
  return s.dettaglio ? `${base} (${s.dettaglio})` : base;
}

/* ── testo e bozza .eml dell'avviso ───────────────────────── */
function testoAvviso(t, voci) {
  const elenco = voci.map((x) => {
    if (x.s.classe === 'mancante') return `- ${x.req.descrizione}: non risulta consegnata copia`;
    if (x.s.classe === 'senzadata') return `- ${x.req.descrizione}: agli atti senza data di scadenza, da confermare`;
    const ore = x.s.dettaglio ? ` (${x.s.dettaglio})` : '';
    if (x.s.classe === 'scaduto') return `- ${x.req.descrizione}: scaduta il ${dataIt(x.s.scadenza)}${ore}`;
    return `- ${x.req.descrizione}: in scadenza il ${dataIt(x.s.scadenza)}${ore}`;
  }).join('\n');
  return `Gentile ${t.nome},

dal controllo periodico della documentazione prevista dal contratto di collaborazione risulta quanto segue:

${elenco}

La preghiamo di trasmettere alla Segreteria copia dei documenti rinnovati (o le date corrette) entro 15 giorni dal ricevimento della presente. Ricordiamo che l'art. 5 del contratto prevede la consegna delle polizze entro dieci giorni dalla sottoscrizione e subordina l'affidamento degli incarichi alla loro regolarità.

Restiamo a disposizione per ogni chiarimento.`;
}

/* Bozza .eml come tutto il resto dell'app: il mailto: dipendeva dal
   gestore di posta di Chrome e poteva non fare nulla, in silenzio. */
async function scaricaAvviso(t, voci) {
  const { scaricaEml } = await import('./eml.js');
  scaricaEml({
    to: t.email || '',
    oggetto: 'Avviso scadenza documenti — ' + t.nome,
    corpo: `${testoAvviso(t, voci)}

Distinti saluti.`,
    nomeFile: `avviso-scadenze-${(t.nome || 'tecnico').replace(/[^\w]+/g, '-')}.eml`,
  });
  toast('Bozza dell\'avviso scaricata: aprila (Outlook parte in composizione) e premi Invia. Poi protocollala in uscita.', 'ok');
}
