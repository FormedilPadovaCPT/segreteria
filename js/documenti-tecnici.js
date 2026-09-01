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
import { ENTE } from './config.js';

let requisiti = [];   // catalogo
let documenti = [];   // tutte le righe s_doc_tecnico
let tecnici = [];     // anagrafica tecnici
let mostraStorici = false;

/* ── date ─────────────────────────────────────────────────── */
function aggiungiMesi(iso, mesi) {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + mesi);
  return d.toISOString().slice(0, 10);
}
function giorniA(iso) {
  return Math.round((new Date(iso) - new Date(oggiIso())) / 86400000);
}

/* ── stato di un tecnico su un requisito ──────────────────────
   Ritorna { classe, testo, doc, scadenza } dove classe e' una di:
   ok | scade | scaduto | senzadata | mancante | na               */
function statoCella(tec, req) {
  if (req.per_chi === 'asseveratori' && !tec.asseveratore) {
    return { classe: 'na', testo: '—' };
  }
  const suoi = documenti.filter((d) => d.requisito_id === req.id &&
    (tec.tecnico_id ? d.tecnico_id === tec.tecnico_id : d.cf === tec.cf));
  if (!suoi.length) return { classe: 'mancante', testo: 'mancante' };

  /* il documento corrente e' l'ultimo per inizio (poi per fine) */
  const doc = [...suoi].sort((a, b) =>
    (b.data_inizio || b.data_fine || '').localeCompare(a.data_inizio || a.data_fine || ''))[0];

  if (doc.senza_scadenza) return { classe: 'ok', testo: 'senza scadenza', doc };
  if (req.rinnovo === 'una_tantum') {
    return { classe: 'ok', testo: doc.data_inizio ? dataIt(doc.data_inizio) : 'presente', doc };
  }

  /* scadenza effettiva */
  let fine = doc.data_fine;
  if (!fine && req.rinnovo === 'tacito' && doc.data_inizio && req.durata_mesi) {
    fine = aggiungiMesi(doc.data_inizio, req.durata_mesi);
  }
  if (!fine) return { classe: 'senzadata', testo: 'senza data', doc };

  /* il tacito corre da solo finche' nessuno disdice */
  let tacito = false;
  if (req.rinnovo === 'tacito' && !doc.disdetto_il && req.durata_mesi) {
    while (giorniA(fine) < 0) fine = aggiungiMesi(fine, req.durata_mesi);
    tacito = true;
  }

  const g = giorniA(fine);
  if (g < 0) return { classe: 'scaduto', testo: dataIt(fine), doc, scadenza: fine };
  if (!tacito && g <= (req.preavviso_giorni || 60)) {
    return { classe: 'scade', testo: dataIt(fine), doc, scadenza: fine };
  }
  return { classe: 'ok', testo: dataIt(fine) + (tacito ? ' ⟳' : ''), doc, scadenza: fine };
}

/* ── caricamento ──────────────────────────────────────────── */
async function carica() {
  const [rq, dc, tc] = await Promise.all([
    sb.from('s_doc_requisito').select('*').eq('attivo', true).order('ordine'),
    sb.from('s_doc_tecnico').select('*'),
    sb.from('tecnici').select('tecnico_id, tecnico_cognome, tecnico_nome, email, attivo, asseveratore, dipendente'),
  ]);
  requisiti = rq.data || [];
  documenti = dc.data || [];
  tecnici = tc.data || [];
}

/* Le righe della griglia: i tecnici attivi veri, piu' (a richiesta)
   gli storici — tecnici disattivati e persone rimaste solo come
   testo nell'import Access. */
function righeGriglia() {
  /* fuori dalla griglia: account di prova/servizio e i dipendenti interni
     (i requisiti vengono dal contratto di collaborazione, che loro non hanno) */
  const esclusi = (t) => t.dipendente || t.tecnico_id === 'TEC-PROVA-2026' || (t.email || '').includes('@did.scuolaedilepadova');
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
  host.querySelectorAll('.dt-cella').forEach((c) => c.addEventListener('click', () =>
    apriCella(c.dataset.tec, Number(c.dataset.req))));
  host.querySelectorAll('.dt-nome').forEach((c) => c.addEventListener('click', () =>
    apriTecnico(c.dataset.tecnico)));
}

function trovaRiga(chiave) {
  return righeGriglia().find((t) => (t.tecnico_id || t.cf) === chiave);
}

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
        <span>${d.data_inizio ? dataIt(d.data_inizio) : '?'} → ${d.senza_scadenza ? 'senza scadenza' : d.data_fine ? dataIt(d.data_fine) : 'senza data'}</span>
      </div>
      ${d.protocollo_txt ? `<div class="dt-doc-riga">Prot. ${esc(d.protocollo_txt)}</div>` : ''}
      ${d.disdetto_il ? `<div class="dt-doc-riga">Disdetto il ${dataIt(d.disdetto_il)}</div>` : ''}
      ${d.drive_url ? `<div class="dt-doc-riga"><a href="${esc(d.drive_url)}" target="_blank" rel="noopener">Apri su Drive</a></div>` : ''}
      ${d.note ? `<div class="dt-doc-note">${esc(d.note)}</div>` : ''}
      <div class="dt-doc-azioni">
        <button class="btn btn-ghost btn-sm" data-mod="${d.id}">Modifica</button>
        <button class="btn btn-ghost btn-sm" data-del="${d.id}">Elimina</button>
      </div>
    </div>`).join('') || '<p class="empty">Nessun documento registrato.</p>';

  apriDrawer(`${t.nome} — ${req.descrizione}`, '', `
    ${req.note ? `<p class="hint" style="margin:0 0 12px">${esc(req.note)}</p>` : ''}
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
  $('#dt-form').innerHTML = `
    <div class="field"><label>Descrizione</label>
      <input type="text" id="dtf-desc" value="${esc(d.descrizione || '')}" placeholder="es. polizza n° … / contratto prot …"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
      <div class="field"><label>Inizio validità</label><input type="date" id="dtf-inizio" value="${d.data_inizio || ''}"></div>
      <div class="field"><label>Fine validità</label><input type="date" id="dtf-fine" value="${d.data_fine || ''}"></div>
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

  $('#dtf-salva').addEventListener('click', async (ev) => {
    const riga = {
      descrizione: $('#dtf-desc').value.trim() || null,
      data_inizio: $('#dtf-inizio').value || null,
      data_fine: $('#dtf-fine').value || null,
      protocollo_txt: $('#dtf-prot').value.trim() || null,
      disdetto_il: $('#dtf-disdetta')?.value || null,
      drive_url: $('#dtf-drive').value.trim() || null,
      senza_scadenza: $('#dtf-senza').checked,
      note: $('#dtf-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    };
    attendi(ev.currentTarget, true);
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
    attendi(ev.currentTarget, false);
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
  return {
    ok: 'valido' + (s.testo.includes('⟳') ? ' (tacito), fino al ' + s.testo.replace(' ⟳', '') : s.scadenza ? ' fino al ' + s.testo : (s.testo !== 'presente' ? ' — ' + s.testo : '')),
    scade: 'in scadenza il ' + s.testo,
    scaduto: 'SCADUTO il ' + s.testo,
    senzadata: 'presente ma senza data di scadenza',
    mancante: 'MANCANTE',
  }[s.classe] || s.testo;
}

/* ── testo e bozza .eml dell'avviso ───────────────────────── */
function testoAvviso(t, voci) {
  const elenco = voci.map((x) => {
    if (x.s.classe === 'mancante') return `- ${x.req.descrizione}: non risulta consegnata copia`;
    if (x.s.classe === 'senzadata') return `- ${x.req.descrizione}: agli atti senza data di scadenza, da confermare`;
    if (x.s.classe === 'scaduto') return `- ${x.req.descrizione}: scaduta il ${dataIt(x.s.scadenza)}`;
    return `- ${x.req.descrizione}: in scadenza il ${dataIt(x.s.scadenza)}`;
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

La Segreteria — ${ENTE.area}
${ENTE.nome} — ${ENTE.sotto}
${ENTE.indirizzo} — tel. ${ENTE.tel}
${ENTE.email} — ${ENTE.web}`,
    nomeFile: `avviso-scadenze-${(t.nome || 'tecnico').replace(/[^\w]+/g, '-')}.eml`,
  });
  toast('Bozza dell\'avviso scaricata: aprila (Outlook parte in composizione) e premi Invia. Poi protocollala in uscita.', 'ok');
}
