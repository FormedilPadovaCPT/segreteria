/* ============================================================
   Tecnici e zone (27/09/2026, chiesto dall'utente)

   Le zone sono quelle di Access, con le date: aree (zone_aree),
   comuni e quartieri di Padova di ogni area (zone_aree_comuni, dal/al)
   e chi ha l'area (zone_aree_tecnici, dal/al). tecnici_zone, che
   leggono le altre app, e' una vista calcolata su oggi.

   Da qui la segreteria:
   - sposta un comune (o un quartiere di Padova) in un'altra area:
     l'anteprima dice quali pratiche aperte passano e quanti incarichi
     aperti ci sono; le pratiche APERTE passano al tecnico dell'area
     nuova (il verbale resta di chi l'ha fatto), gli incarichi NO —
     si riassegnano uno per uno da «Incarichi», come sempre;
   - passa un'area intera a un altro tecnico (come da Canova a Bordina);
   - crea un'area NUOVA per un tecnico (05/10/2026): prende il numero
     dopo l'ultimo e nasce vuota, i comuni si aggiungono con «+ Comune»;
   - accende o spegne «vede solo le sue visite» per ogni tecnico;
   - assegna le pratiche aperte rimaste senza un tecnico in zona.
   Tutte le scritture passano da funzioni del database che controllano
   il ruolo segreteria (zone_sposta, zone_passa_area, zone_crea_area, pendenza_assegna,
   tecnico_imposta_visibilita).
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { indirizziEsenti, statoCasella } from './zone-visibilita.js';

const QNOME = { 1: 'Q1 Centro', 2: 'Q2 Nord', 3: 'Q3 Est', 4: 'Q4 Sud-Est', 5: 'Q5 Sud-Ovest', 6: 'Q6 Ovest' };
const etichettaComune = (c, q) => (q ? `PADOVA — ${QNOME[q] || 'Q' + q}` : c);

let aree = [];        // zone_aree
let comuni = [];      // righe aperte di zone_aree_comuni
let titolari = [];    // righe di oggi di zone_aree_tecnici
let tecnici = [];     // tecnici in anagrafica
let scoperte = [];    // pendenze_da_assegnare()
let mostraFuoriZona = false;

const oggi = () => new Date().toISOString().slice(0, 10);
const nomeTec = (id) => {
  const t = tecnici.find((x) => x.tecnico_id === id);
  return t ? `${t.tecnico_cognome || ''} ${t.tecnico_nome || ''}`.trim() : '—';
};

async function carica() {
  const d = oggi();
  const [ra, rc, rt, rtec, rs] = await Promise.all([
    sb.from('zone_aree').select('area_id, etichetta, note').order('area_id'),
    sb.from('zone_aree_comuni').select('id, area_id, comune_nome, quartiere, dal').is('al', null).order('comune_nome'),
    sb.from('zone_aree_tecnici').select('area_id, tecnico_id, nome, dal, al').lte('dal', d).or(`al.is.null,al.gte.${d}`),
    sb.from('tecnici').select('tecnico_id, tecnico_cognome, tecnico_nome, email, attivo, elimina, vede_solo_proprie').order('tecnico_cognome'),
    sb.rpc('pendenze_da_assegnare'),
  ]);
  /* chi è segreteria vede sempre tutto: la casella sul suo nome non ha effetto.
     Se i ruoli non si leggono la schermata resta quella di prima, e lo dice. */
  const rr = await sb.from('app_ruoli').select('email, ruolo, stato');
  esenti = rr.error ? null : indirizziEsenti(rr.data);
  erroreRuoli = rr.error ? rr.error.message : '';
  const err = [ra, rc, rt, rtec, rs].find((r) => r.error);
  if (err) throw new Error(err.error.message);
  aree = ra.data || [];
  comuni = rc.data || [];
  titolari = rt.data || [];
  tecnici = rtec.data || [];
  scoperte = rs.data || [];
}

let esenti = null, erroreRuoli = '';
const tecniciAttivi = () => tecnici.filter((t) => t.attivo !== false && !(t.elimina > 0) && !/^prova\b/i.test(t.tecnico_cognome || ''));
const conArea = (id) => titolari.some((x) => x.tecnico_id === id);
/* elenco per le tendine: prima i tecnici che oggi hanno un'area, poi gli altri in servizio */
function opzioniTecnici(sel) {
  const opt = (t) => `<option value="${esc(t.tecnico_id)}" ${t.tecnico_id === sel ? 'selected' : ''}>${esc(`${t.tecnico_cognome || ''} ${t.tecnico_nome || ''}`.trim())}</option>`;
  const tutti = tecniciAttivi();
  const a = tutti.filter((t) => conArea(t.tecnico_id)), b = tutti.filter((t) => !conArea(t.tecnico_id));
  return `<optgroup label="Con un'area oggi">${a.map(opt).join('')}</optgroup>` + (b.length ? `<optgroup label="Altri in servizio">${b.map(opt).join('')}</optgroup>` : '');
}
const titolariArea = (a) => titolari.filter((t) => t.area_id === a && t.tecnico_id);
const areeInUso = () => aree.filter((a) => comuni.some((c) => c.area_id === a.area_id) || titolariArea(a.area_id).length);
const nomeArea = (a) => {
  const t = titolariArea(a).map((x) => nomeTec(x.tecnico_id));
  return `Area ${a}${t.length ? ' — ' + t.join(' + ') : ' — nessun tecnico'}`;
};

export async function render() {
  const host = $('#zone-tecnici-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  try { await carica(); } catch (e) {
    host.innerHTML = `<p class="empty">Non sono riuscito a leggere le zone: ${esc(e.message)}</p>`;
    return;
  }

  const schede = areeInUso().map((a) => {
    const tit = titolariArea(a.area_id);
    const suoi = comuni.filter((c) => c.area_id === a.area_id)
      .sort((x, y) => (x.comune_nome + (x.quartiere || 0)).localeCompare(y.comune_nome + (y.quartiere || 0)));
    const chips = suoi.map((c) => `<button type="button" class="zt-comune" data-id="${c.id}"
        title="In quest'area dal ${dataIt(c.dal)}">${esc(etichettaComune(c.comune_nome, c.quartiere))}</button>`).join(' ');
    return `<div class="zt-area">
      <div class="zt-area-testa">
        <strong>Area ${a.area_id}</strong>
        <span>${tit.length ? tit.map((t) => esc(nomeTec(t.tecnico_id)) + ` <span class="muted">dal ${dataIt(t.dal)}</span>`).join(' + ') : '<em class="muted">nessun tecnico</em>'}</span>
        <span class="muted">${suoi.length} comuni/quartieri</span>
        <button type="button" class="btn btn-ghost btn-sm zt-passa" data-area="${a.area_id}">Passa l'area a…</button>
        <button type="button" class="btn btn-ghost btn-sm zt-aggiungi" data-area="${a.area_id}">+ Comune</button>
      </div>
      <div class="zt-chips">${chips || '<span class="muted">nessun comune</span>'}</div>
    </div>`;
  }).join('');

  const vis = tecniciAttivi().map((t) => {
    const c = statoCasella(t, esenti);
    return `<tr>
      <td>${esc(`${t.tecnico_cognome || ''} ${t.tecnico_nome || ''}`.trim())}</td>
      <td><label class="zt-vis${c.spenta ? ' zt-vis-spenta' : ''}"><input type="checkbox" class="zt-solo" data-tec="${esc(t.tecnico_id)}" ${c.spuntata ? 'checked' : ''} ${c.spenta ? 'disabled' : ''}>
        vede solo le sue visite</label>${c.nota ? ` <span class="muted">— ${esc(c.nota)}</span>` : ''}</td>
    </tr>`;
  }).join('');

  const nonAttivi = scoperte.filter((s) => s.motivo === 'tecnico non più attivo');
  const fuori = scoperte.filter((s) => s.motivo !== 'tecnico non più attivo');
  const opzTec = (sel) => opzioniTecnici(sel);
  const rigaScoperta = (s) => `<tr>
      <td>${esc(s.cantiere_label || '—')}<br><span class="muted">${esc(s.nr_verbale || '')} · visita ${dataIt(s.data_visita)}${s.quartiere ? ' · ' + esc(QNOME[s.quartiere] || '') : ''}</span></td>
      <td>${dataIt(s.data_rientro)} <span class="muted">${esc(s.categoria || '')}</span></td>
      <td>${esc(s.titolare_nome || '—')}</td>
      <td><select class="zt-assegna-a" data-cantiere="${esc(s.cantiere_id)}"><option value="">— scegli —</option>${opzTec(s.proposto)}</select></td>
      <td><button type="button" class="btn btn-primary btn-sm zt-assegna" data-cantiere="${esc(s.cantiere_id)}">Assegna</button></td>
    </tr>`;
  const tabScoperte = (righe) => `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Cantiere</th><th>Rientro</th><th>Ora è di</th><th>Passa a</th><th></th></tr></thead>
      <tbody>${righe.map(rigaScoperta).join('')}</tbody></table></div>`;

  host.innerHTML = `
    <p class="hint">Le zone di oggi, con le date come in Access. Clic su un comune per spostarlo in un'altra area:
      passano al tecnico nuovo le sole <strong>visite aperte</strong> (il verbale resta di chi l'ha fatto);
      gli <strong>incarichi</strong> si riassegnano da «Incarichi», uno per uno.</p>
    <h3>Aree <button type="button" class="btn btn-ghost btn-sm" id="zt-nuova-area">+ Nuova area</button></h3>
    <div class="zt-aree">${schede || '<p class="empty">Nessuna area in uso.</p>'}</div>

    <h3>Pratiche aperte di tecnici non più attivi <span class="muted">(${nonAttivi.length})</span></h3>
    ${nonAttivi.length
      ? `<p class="hint">Proposto il tecnico che oggi ha il comune o il quartiere del cantiere.
           <button type="button" class="btn btn-ghost btn-sm" id="zt-assegna-tutte">Assegna tutte le proposte</button></p>${tabScoperte(nonAttivi)}`
      : '<p class="empty">Nessuna.</p>'}

    <details id="zt-fuori" ${mostraFuoriZona ? 'open' : ''}>
      <summary>Pratiche aperte fuori dalla zona del loro tecnico <span class="muted">(${fuori.length})</span></summary>
      <p class="hint">Visite fatte fuori zona (richieste, stage, segnalazioni) o comuni spostati quando l'area nuova aveva più tecnici.
        Di solito restano a chi ha fatto la visita: si passano solo se serve.</p>
      ${fuori.length ? tabScoperte(fuori) : '<p class="empty">Nessuna.</p>'}
    </details>

    <h3>Chi vede che cosa</h3>
    <p class="hint">Con «vede solo le sue visite» il tecnico vede nel gestionale le visite in cui è principale o in affiancamento,
      più quelle dei cantieri della sua zona con una pratica aperta e dei suoi incarichi. Statistiche e mappa si calcolano su quelle.
      Vale nel database, non solo nelle schermate. <strong>Chi è segreteria vede sempre tutto</strong>: la sua casella è spenta.</p>
    ${erroreRuoli ? `<p class="hint">Non sono riuscito a leggere i ruoli (${esc(erroreRuoli)}): non so dire chi è segreteria, le caselle sono tutte attive.</p>` : ''}
    <div class="table-wrap"><table class="tbl"><tbody>${vis}</tbody></table></div>`;

  host.querySelectorAll('.zt-comune').forEach((b) => b.addEventListener('click', () => apriSposta(Number(b.dataset.id))));
  $('#zt-nuova-area')?.addEventListener('click', apriNuovaArea);
  host.querySelectorAll('.zt-passa').forEach((b) => b.addEventListener('click', () => apriPassa(Number(b.dataset.area))));
  host.querySelectorAll('.zt-aggiungi').forEach((b) => b.addEventListener('click', () => apriAggiungi(Number(b.dataset.area))));
  host.querySelectorAll('.zt-solo').forEach((c) => c.addEventListener('change', () => impostaVisibilita(c)));
  host.querySelectorAll('.zt-assegna').forEach((b) => b.addEventListener('click', () => assegna(b)));
  $('#zt-fuori')?.addEventListener('toggle', (e) => { mostraFuoriZona = e.target.open; });
  $('#zt-assegna-tutte')?.addEventListener('click', (e) => assegnaTutte(e.target, nonAttivi));
}

/* ── spostare un comune o quartiere ── */
function opzioniAree(esclusa) {
  return areeInUso().filter((a) => a.area_id !== esclusa)
    .map((a) => `<option value="${a.area_id}">${esc(nomeArea(a.area_id))}</option>`).join('');
}

function apriSposta(idRiga) {
  const r = comuni.find((c) => c.id === idRiga);
  if (!r) return;
  const nome = etichettaComune(r.comune_nome, r.quartiere);
  apriDrawer(`Sposta ${nome}`, '', `
    <p>Ora è nell'<strong>${esc(nomeArea(r.area_id))}</strong>, dal ${dataIt(r.dal)}.</p>
    <div class="field"><label>Nuova area</label>
      <select id="zt-dest"><option value="">— scegli —</option>${opzioniAree(r.area_id)}</select></div>
    <div id="zt-anteprima" class="hint">Scegli l'area per vedere che cosa si sposta.</div>
    <div class="drawer-azioni"><button type="button" class="btn btn-primary" id="zt-conferma" disabled>Sposta da oggi</button></div>`);
  const dest = $('#zt-dest'), conf = $('#zt-conferma'), box = $('#zt-anteprima');
  dest.addEventListener('change', async () => {
    conf.disabled = true;
    if (!dest.value) { box.textContent = 'Scegli l\'area per vedere che cosa si sposta.'; return; }
    box.textContent = 'Controllo…';
    const { data, error } = await sb.rpc('zone_anteprima_sposta', { p_comune: r.comune_nome, p_quartiere: r.quartiere, p_area_nuova: Number(dest.value) });
    if (error) { box.textContent = 'Non sono riuscito a fare l\'anteprima: ' + error.message; return; }
    const pend = data.pendenze || [];
    const nuovi = (data.tecnici_nuovi || []).map(nomeTec).join(' + ') || 'nessun tecnico';
    box.innerHTML = `
      <p><strong>${pend.length}</strong> visite aperte ${data.si_spostano
        ? `passano a <strong>${esc(nuovi)}</strong>` : `<strong>non</strong> passano da sole (l'area nuova ha ${esc(nuovi)}): le trovi poi fra le pratiche da assegnare`}.</p>
      ${pend.length ? `<ul class="zt-lista">${pend.map((p) => `<li>${esc(p.cantiere || '—')} — ${esc(p.verbale || '')}, rientro ${dataIt(p.rientro)}</li>`).join('')}</ul>` : ''}
      <p>Incarichi aperti su ${esc(nome)} del tecnico che lo lascia: <strong>${data.incarichi_aperti || 0}</strong>
        ${data.incarichi_aperti ? '— non si spostano: riassegnali da «Incarichi», uno per uno.' : ''}</p>`;
    conf.disabled = false;
  });
  conf.addEventListener('click', async () => {
    attendi(conf, true, 'Sposto…');
    const { data, error } = await sb.rpc('zone_sposta', { p_comune: r.comune_nome, p_quartiere: r.quartiere, p_area_nuova: Number(dest.value) });
    attendi(conf, false);
    if (error) { toast('Spostamento non riuscito: ' + error.message, 'err'); return; }
    toast(`${nome} spostato nell'area ${data.area_nuova}: ${data.pendenze_spostate} visite aperte passate` +
      (data.pendenze_da_assegnare_a_mano ? `, ${data.pendenze_da_assegnare_a_mano} da assegnare a mano` : ''), 'ok');
    chiudiDrawer();
    render();
  });
}

/* ── aggiungere un comune (o quartiere) che non è in nessuna area, o spostarlo qui ── */
function apriAggiungi(area) {
  apriDrawer(`Comune nell'area ${area}`, '', `
    <div class="field"><label>Comune</label><input id="zt-nuovo-comune" placeholder="es. PADOVA, ESTE…"></div>
    <div class="field" id="zt-q-box" hidden><label>Quartiere di Padova</label>
      <select id="zt-nuovo-q">${Object.entries(QNOME).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
    <p class="hint">Se il comune è già in un'altra area, viene spostato qui con le sue visite aperte (come dal clic sul comune).</p>
    <div class="drawer-azioni"><button type="button" class="btn btn-primary" id="zt-aggiungi-ok">Aggiungi da oggi</button></div>`);
  const inp = $('#zt-nuovo-comune');
  inp.addEventListener('input', () => { $('#zt-q-box').hidden = inp.value.trim().toUpperCase() !== 'PADOVA'; });
  $('#zt-aggiungi-ok').addEventListener('click', async (e) => {
    const c = inp.value.trim();
    if (!c) { toast('Scrivi il comune', 'err'); return; }
    const q = c.toUpperCase() === 'PADOVA' ? Number($('#zt-nuovo-q').value) : null;
    attendi(e.target, true, 'Salvo…');
    const { data, error } = await sb.rpc('zone_sposta', { p_comune: c, p_quartiere: q, p_area_nuova: area });
    attendi(e.target, false);
    if (error) { toast('Non riuscito: ' + error.message, 'err'); return; }
    toast(`${etichettaComune(data.comune, data.quartiere)} nell'area ${area}` + (data.pendenze_spostate ? `: ${data.pendenze_spostate} visite aperte passate` : ''), 'ok');
    chiudiDrawer();
    render();
  });
}

/* ── passare un'area intera ── */
function apriPassa(area) {
  const tit = titolariArea(area).map((t) => nomeTec(t.tecnico_id)).join(' + ') || 'nessuno';
  apriDrawer(`Passa l'area ${area}`, '', `
    <p>Oggi l'area è di <strong>${esc(tit)}</strong>. Da oggi passa a:</p>
    <div class="field"><select id="zt-nuovo-tec"><option value="">— scegli —</option>${opzioniTecnici(null)}</select></div>
    <p class="hint">Le visite aperte di ${esc(tit)} nei comuni dell'area passano al nuovo tecnico. Gli incarichi no:
      si riassegnano da «Incarichi». Chi aveva l'area resta nello storico con la data di fine.</p>
    <div class="drawer-azioni"><button type="button" class="btn btn-primary" id="zt-passa-ok">Passa l'area</button></div>`);
  $('#zt-passa-ok').addEventListener('click', async (e) => {
    const tec = $('#zt-nuovo-tec').value;
    if (!tec) { toast('Scegli il tecnico', 'err'); return; }
    attendi(e.target, true, 'Passo…');
    const { data, error } = await sb.rpc('zone_passa_area', { p_area: area, p_tecnico: tec });
    attendi(e.target, false);
    if (error) { toast('Non riuscito: ' + error.message, 'err'); return; }
    toast(`Area ${area} a ${data.tecnico}: ${data.pendenze_spostate} visite aperte passate`, 'ok');
    chiudiDrawer();
    render();
  });
}

/* ── creare un'area nuova (05/10/2026) ── */
function apriNuovaArea() {
  const prossima = aree.reduce((m, a) => Math.max(m, a.area_id), 0) + 1;
  apriDrawer('Nuova area', '', `
    <p>Diventa l'<strong>area ${prossima}</strong> (il numero dopo l'ultimo, come in Access) e da oggi è del tecnico scelto.
      Nasce vuota: dopo si aggiungono i comuni.</p>
    <div class="field"><label>Tecnico</label>
      <select id="zt-na-tec"><option value="">— scegli —</option>${opzioniTecnici(null)}</select></div>
    <div class="field"><label>Etichetta <span class="muted">(facoltativa)</span></label>
      <input id="zt-na-et" placeholder="se vuota: anno, mese e cognome, come in Access"></div>
    <div class="field"><label>Note <span class="muted">(facoltative)</span></label><input id="zt-na-note"></div>
    <div class="drawer-azioni"><button type="button" class="btn btn-primary" id="zt-nuova-ok">Crea l'area</button></div>`);
  $('#zt-nuova-ok').addEventListener('click', async (e) => {
    const tec = $('#zt-na-tec').value;
    if (!tec) { toast('Scegli il tecnico', 'err'); return; }
    attendi(e.target, true, 'Creo…');
    const { data, error } = await sb.rpc('zone_crea_area', { p_tecnico: tec, p_etichetta: $('#zt-na-et').value, p_note: $('#zt-na-note').value });
    attendi(e.target, false);
    if (error) { toast('Area non creata: ' + error.message, 'err'); return; }
    toast(`Area ${data.area} creata per ${data.tecnico}: ora aggiungi i comuni`, 'ok');
    chiudiDrawer();
    await render();
    apriAggiungi(data.area);
  });
}

/* ── visibilità ── */
async function impostaVisibilita(c) {
  c.disabled = true;
  const { error } = await sb.rpc('tecnico_imposta_visibilita', { p_tecnico: c.dataset.tec, p_solo_proprie: c.checked });
  c.disabled = false;
  if (error) { c.checked = !c.checked; toast('Non salvato: ' + error.message, 'err'); return; }
  const t = tecnici.find((x) => x.tecnico_id === c.dataset.tec);
  if (t) t.vede_solo_proprie = c.checked;
  if (t && statoCasella(t, esenti).esente) { toast(`${nomeTec(c.dataset.tec)}: spunta ${c.checked ? 'messa' : 'tolta'}. È segreteria, vede comunque tutto`, 'ok'); return render(); }
  toast(c.checked ? `${nomeTec(c.dataset.tec)} ora vede solo le sue visite` : `${nomeTec(c.dataset.tec)} vede di nuovo tutte le visite`, 'ok');
}

/* ── pratiche scoperte ── */
async function assegna(b) {
  const sel = b.closest('tr').querySelector('.zt-assegna-a');
  if (!sel.value) { toast('Scegli a chi passa', 'err'); return; }
  attendi(b, true, '…');
  const { error } = await sb.rpc('pendenza_assegna', { p_cantiere: b.dataset.cantiere, p_tecnico: sel.value, p_motivo: null });
  attendi(b, false);
  if (error) { toast('Non riuscito: ' + error.message, 'err'); return; }
  toast(`Pratica passata a ${nomeTec(sel.value)}`, 'ok');
  render();
}

async function assegnaTutte(btn, righe) {
  const conProposta = righe.filter((s) => s.proposto);
  if (!conProposta.length) { toast('Nessuna pratica ha un tecnico proposto', 'err'); return; }
  if (!confirm(`Passare ${conProposta.length} pratiche al tecnico proposto per ciascuna?` +
    (righe.length > conProposta.length ? `\n${righe.length - conProposta.length} senza proposta restano da assegnare a mano.` : ''))) return;
  attendi(btn, true, 'Assegno…');
  let ok = 0; const errori = [];
  for (const s of conProposta) {
    const { error } = await sb.rpc('pendenza_assegna', { p_cantiere: s.cantiere_id, p_tecnico: s.proposto, p_motivo: 'assegnata al tecnico di zona (tecnico precedente non più attivo)' });
    if (error) errori.push(`${s.cantiere_label}: ${error.message}`); else ok++;
  }
  attendi(btn, false);
  toast(`${ok} pratiche assegnate` + (errori.length ? `, ${errori.length} non riuscite` : ''), errori.length ? 'err' : 'ok');
  if (errori.length) console.warn('pendenze non assegnate', errori);
  render();
}
