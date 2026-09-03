/* ============================================================
   Maschera Nomine.

   È il meccanismo che aggancia le persone a imprese ed enti nel
   tempo (s_nomine: persona + ruolo + impresa + dal/al): da qui
   si vede chi è attivo in un ruolo ADESSO, si registrano nomine
   nuove e si chiudono le vecchie — mai sovrascrivere: degli
   avvicendamenti resta traccia.

   Come in Access, dal ruolo filtrato si stampano:
   - il FOGLIO PRESENZE con gli attivi in questo momento;
   - l'ELENCO NOMINE come filtrato a video.
   Sono fogli interni: non si protocollano.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { collegaDoppioClickMail } from './eml.js';

let nomine = [];
let ruoli = [];
let tutte = null;   // archivio completo in memoria (si ricarica dopo ogni salvataggio)
let filtroRuolo = '';
let filtroStato = 'attive';
let cerca = '';

const attiva = (n) => !n.data_fine || n.data_fine >= oggiIso();
const nominativo = (n) => n.persona_txt || '?';

/* Niente limiti: l'archivio (~7.500 nomine) si carica UNA volta,
   a blocchi da 1000 (il tetto per richiesta di Supabase), e i
   filtri lavorano in locale — il limite delle 300 faceva sparire
   lo storico di una persona (caso Tosato: 1 nomina visibile su 5). */
async function caricaTutte() {
  if (tutte) return;
  const acc = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await sb.from('s_nomine').select('*')
      .order('data_reg', { ascending: false, nullsFirst: false })
      .order('access_id', { ascending: false })
      .range(da, da + 999);
    if (error) throw error;
    acc.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  tutte = acc;
}

async function carica() {
  const [r] = await Promise.all([
    sb.from('s_ruoli').select('id_ruolo, ruolo').order('ruolo'),
    caricaTutte(),
  ]);
  ruoli = r.data || [];
  const t = cerca.trim().toLowerCase();
  nomine = tutte.filter((n) =>
    (!filtroRuolo || n.ruolo_txt === filtroRuolo) &&
    (t.length < 2 || `${n.persona_txt || ''} ${n.impresa_txt || ''} ${n.mansione || ''}`.toLowerCase().includes(t)));
}

export async function render() {
  const host = $('#nomine-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  /* il testo ha già filtrato sul server: qui resta solo lo stato */
  const visibili = nomine.filter((n) =>
    filtroStato === 'tutte' ? true : filtroStato === 'attive' ? attiva(n) : !attiva(n));

  host.innerHTML = `
    <div class="dt-barra">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select id="nm-ruolo" class="inp inp-sm" style="max-width:300px">
          <option value="">Tutti i ruoli</option>
          ${ruoli.map((r) => `<option ${filtroRuolo === r.ruolo ? 'selected' : ''}>${esc(r.ruolo)}</option>`).join('')}
        </select>
        <div class="seg" id="nm-f">
          ${['attive', 'tutte', 'chiuse'].map((s) =>
            `<button class="seg-btn ${filtroStato === s ? 'is-active' : ''}" data-val="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </div>
        <input id="nm-cerca" class="inp inp-sm" type="search" placeholder="Cerca persona, impresa…" value="${esc(cerca)}">
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="nm-presenze" ${filtroRuolo ? '' : 'disabled title="Scegli prima un ruolo"'}>🖨 Foglio presenze</button>
        <button class="btn btn-ghost btn-sm" id="nm-elenco">🖨 Elenco nomine</button>
        <button class="btn btn-primary btn-sm" id="nm-nuova">+ Nuova nomina</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th style="width:95px">Registrata</th><th>Nominativo</th><th style="width:200px">Ruolo</th>
          <th>Impresa / ente</th><th style="width:140px">Mansione</th>
          <th style="width:95px">Dal</th><th style="width:95px">Al</th>
        </tr></thead>
        <tbody>${visibili.map((n) => `
          <tr data-id="${n.access_id}" class="${attiva(n) ? '' : 'dt-riga-storico'}">
            <td>${dataIt(n.data_reg)}</td>
            <td><strong>${esc(nominativo(n))}</strong></td>
            <td style="font-size:12px">${esc(n.ruolo_txt || '')}</td>
            <td>${esc(n.impresa_txt || '')}</td>
            <td>${esc(n.mansione || '')}</td>
            <td>${dataIt(n.data_inizio)}</td>
            <td>${n.data_fine ? dataIt(n.data_fine) : '<span class="pill pill-prima">attiva</span>'}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="empty">Nessuna nomina con questi filtri.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">
      ${visibili.length} nomine su ${tutte.length} in archivio${filtroRuolo ? ` per «${esc(filtroRuolo)}»` : ''}${cerca.trim().length >= 2 ? ` con «${esc(cerca.trim())}»` : ''}.
      Il foglio presenze stampa gli attivi in questo momento del ruolo scelto; l'elenco stampa ciò che vedi.
    </p>`;

  $('#nm-ruolo').addEventListener('change', (e) => { filtroRuolo = e.target.value; render(); });
  $('#nm-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroStato = b.dataset.val; render(); }
  });
  $('#nm-cerca').addEventListener('input', (e) => {
    cerca = e.target.value;
    clearTimeout(render._t);
    render._t = setTimeout(render, 350);
  });
  $('#nm-nuova').addEventListener('click', () => formNomina(null));
  $('#nm-presenze').addEventListener('click', (ev) => stampa('presenze', ev.currentTarget));
  $('#nm-elenco').addEventListener('click', (ev) => stampa('elenco', ev.currentTarget, visibili));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const n = nomine.find((x) => String(x.access_id) === tr.dataset.id);
      if (n) formNomina(n);
    }));
}

/* Apertura di una singola nomina da un'altra maschera (es. dalla
   scheda impresa): carica i ruoli se servono e apre il drawer. */
export async function apriNomina(accessId) {
  if (!ruoli.length) {
    const { data } = await sb.from('s_ruoli').select('id_ruolo, ruolo').order('ruolo');
    ruoli = data || [];
  }
  const { data: n, error } = await sb.from('s_nomine').select('*').eq('access_id', accessId).maybeSingle();
  if (error || !n) return toast('Nomina non trovata: ' + (error?.message || accessId), 'err');
  formNomina(n);
}

/* ── stampe ───────────────────────────────────────────────── */
async function stampa(tipo, btn, visibili = []) {
  attendi(btn, true, 'Preparo il PDF…');
  try {
    const base = tipo === 'presenze' ? nomine.filter(attiva) : visibili;
    /* CF e contatti arrivano dall'anagrafica persone, per chi è agganciato */
    const ids = [...new Set(base.map((n) => n.persona_id).filter(Boolean))];
    let per = {};
    if (ids.length) {
      const { data } = await sb.from('persone')
        .select('persona_id, cf, email, telefono, telefono2').in('persona_id', ids);
      per = Object.fromEntries((data || []).map((p) => [p.persona_id, p]));
    }
    const righe = base
      .map((n) => ({
        nominativo: nominativo(n),
        cf: per[n.persona_id]?.cf || null,
        mansione: n.mansione || n.ruolo_txt || '',
        ente: n.impresa_txt || '',
        data_reg: n.data_reg,
        data_inizio: n.data_inizio,
        data_fine: n.data_fine,
        email: per[n.persona_id]?.email || n.email_ruolo || null,
        cellulare: per[n.persona_id]?.telefono2 || null,
        telefono: per[n.persona_id]?.telefono || null,
        note: n.note || null,
      }))
      .sort((a, b) => a.nominativo.localeCompare(b.nominativo, 'it'));
    const mod = await import('./nomine-pdf.js');
    if (tipo === 'presenze') await mod.foglioPresenze(filtroRuolo, righe);
    else await mod.elencoNomine(filtroRuolo, righe);
    toast('PDF scaricato.', 'ok');
  } catch (e) {
    toast('Stampa non riuscita: ' + e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ── inserimento e modifica ───────────────────────────────── */
function formNomina(n) {
  const nuova = !n;
  const d = n || {};
  apriDrawer(nuova ? 'Nuova nomina' : `Nomina — ${nominativo(d)}`, '', `
    <div class="field ac-wrap"><label>Persona *</label>
      <input type="text" id="fn-persona" value="${esc(d.persona_txt || '')}" placeholder="Cognome (almeno 3 lettere per cercare in anagrafica)…">
      <input type="hidden" id="fn-persona-id" value="${esc(d.persona_id || '')}">
      <span class="hint" id="fn-persona-hint">${d.persona_id ? 'Agganciata all\'anagrafica persone.' : 'Se non è in anagrafica, scrivi comunque il nominativo.'}</span>
      <div id="fn-persona-esiti"></div></div>
    <div class="field"><label>Ruolo *</label>
      <select id="fn-ruolo"><option value="">—</option></select></div>
    <div class="field"><label>Impresa / ente</label>
      <input type="text" id="fn-impresa" value="${esc(d.impresa_txt || '')}" placeholder="Ragione sociale (3 lettere per cercare)…">
      <input type="hidden" id="fn-impresa-id" value="${esc(d.impresa_id || '')}">
      <div id="fn-impresa-esiti"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Mansione</label><input type="text" id="fn-mansione" value="${esc(d.mansione || '')}"></div>
      <div class="field"><label>Email del ruolo</label><input type="text" id="fn-email" data-mail="1" data-mail-chi="${esc(d.persona_txt || '')}" value="${esc(d.email_ruolo || '')}"></div>
      <div class="field"><label>Inizio incarico</label><input type="date" id="fn-inizio" value="${d.data_inizio || ''}"></div>
      <div class="field"><label>Fine nomina</label><input type="date" id="fn-fine" value="${d.data_fine || ''}"></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note</label><textarea id="fn-note">${esc(d.note || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      ${!nuova && !d.data_fine ? '<button class="btn btn-ghost" id="fn-chiudi">Chiudi la nomina a oggi</button>' : ''}
      <button class="btn btn-primary" id="fn-salva">${nuova ? 'Registra la nomina' : 'Salva le modifiche'}</button>
    </div>
    ${nuova ? '' : `<p class="hint" style="margin-top:10px">Registrata il ${dataIt(d.data_reg) || '—'}. Per un avvicendamento non modificare: chiudi questa e registrane una nuova.</p>`}
  `);

  collegaDoppioClickMail($('#drawer-body'));

  /* il select dei ruoli si riempie dal vivo (la lista è già caricata) */
  $('#fn-ruolo').innerHTML = '<option value="">—</option>' +
    ruoli.map((r) => `<option ${d.ruolo_txt === r.ruolo ? 'selected' : ''} data-id="${r.id_ruolo}">${esc(r.ruolo)}</option>`).join('');

  /* ricerca persone in anagrafica */
  $('#fn-persona').addEventListener('input', (e) => {
    $('#fn-persona-id').value = '';
    clearTimeout(formNomina._tp);
    formNomina._tp = setTimeout(async () => {
      const t = e.target.value.trim();
      if (t.length < 3) return ($('#fn-persona-esiti').innerHTML = '');
      const { data } = await sb.from('persone')
        .select('persona_id, titolo, cognome, nome, cf')
        .or(`cognome.ilike.%${t}%,nome.ilike.%${t}%`).order('cognome').limit(8);
      $('#fn-persona-esiti').innerHTML = (data || []).map((p) =>
        `<button type="button" class="chip" data-pid="${p.persona_id}" data-nome="${esc([p.cognome, p.titolo, p.nome].filter(Boolean).join(' '))}">${esc([p.cognome, p.nome].filter(Boolean).join(' '))}${p.cf ? ' · ' + esc(p.cf) : ''}</button>`).join(' ');
      $('#fn-persona-esiti').querySelectorAll('[data-pid]').forEach((b) => b.addEventListener('click', () => {
        $('#fn-persona').value = b.dataset.nome;
        $('#fn-persona-id').value = b.dataset.pid;
        $('#fn-persona-esiti').innerHTML = '';
        $('#fn-persona-hint').textContent = 'Agganciata all\'anagrafica persone.';
      }));
    }, 350);
  });

  /* ricerca imprese */
  $('#fn-impresa').addEventListener('input', (e) => {
    $('#fn-impresa-id').value = '';
    clearTimeout(formNomina._ti);
    formNomina._ti = setTimeout(async () => {
      const t = e.target.value.trim();
      if (t.length < 3) return ($('#fn-impresa-esiti').innerHTML = '');
      const { data } = await sb.rpc('s_cerca_imprese', { p_testo: t, p_limite: 8 });
      $('#fn-impresa-esiti').innerHTML = (data || []).map((i) =>
        `<button type="button" class="chip" data-iid="${esc(i.impresa_id)}" data-nome="${esc(i.impresa_nome)}">${esc(i.impresa_nome)}</button>`).join(' ');
      $('#fn-impresa-esiti').querySelectorAll('[data-iid]').forEach((b) => b.addEventListener('click', () => {
        $('#fn-impresa').value = b.dataset.nome;
        $('#fn-impresa-id').value = b.dataset.iid;
        $('#fn-impresa-esiti').innerHTML = '';
      }));
    }, 350);
  });

  $('#fn-chiudi')?.addEventListener('click', async (ev) => {
    if (!confirm('Chiudo la nomina con data di fine oggi?')) return;
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_nomine').update({ data_fine: oggiIso(), updated_at: new Date().toISOString() })
      .eq('access_id', d.access_id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Chiusura non riuscita: ' + error.message, 'err');
    toast('Nomina chiusa a oggi.', 'ok');
    chiudiDrawer();
    tutte = null;
    render();
  });

  $('#fn-salva').addEventListener('click', async (ev) => {
    const personaTxt = $('#fn-persona').value.trim();
    const sel = $('#fn-ruolo');
    const ruoloTxt = sel.value;
    if (!personaTxt || !ruoloTxt) return toast('Servono persona e ruolo.', 'err');
    const riga = {
      persona_txt: personaTxt,
      persona_id: $('#fn-persona-id').value || null,
      ruolo_txt: ruoloTxt,
      ruolo_id: Number(sel.options[sel.selectedIndex]?.dataset.id) || null,
      impresa_txt: $('#fn-impresa').value.trim() || null,
      impresa_id: $('#fn-impresa-id').value || null,
      mansione: $('#fn-mansione').value.trim() || null,
      email_ruolo: $('#fn-email').value.trim() || null,
      data_inizio: $('#fn-inizio').value || null,
      data_fine: $('#fn-fine').value || null,
      note: $('#fn-note').value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    attendi(ev.currentTarget, true);
    let error;
    if (nuova) {
      /* access_id: la tabella è uno specchio di Access senza serial —
         si continua la numerazione manuale sopra i 90000, la fascia
         già usata per gli import fuori-Access */
      const { data: mx } = await sb.from('s_nomine').select('access_id').gte('access_id', 90000)
        .order('access_id', { ascending: false }).limit(1);
      riga.access_id = Math.max(90000, (mx?.[0]?.access_id || 90000)) + 1;
      riga.data_reg = oggiIso();
      ({ error } = await sb.from('s_nomine').insert(riga));
    } else {
      ({ error } = await sb.from('s_nomine').update(riga).eq('access_id', d.access_id));
    }
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast(nuova ? 'Nomina registrata.' : 'Modifiche salvate.', 'ok');
    chiudiDrawer();
    tutte = null;
    render();
  });
}
