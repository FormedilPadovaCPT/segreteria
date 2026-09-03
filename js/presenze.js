/* ============================================================
   PRESENZE del personale, banca ore e richieste ferie/permessi.
   Sostituisce le tabelle Access «Presenze» e «Straordinari_Recuperi»
   (storico 2009-2026 importato il 03/09/2026) e il modulo Word di
   richiesta ferie.

   Tre schede:
   - MESE: la griglia del mese per dipendente (entrate/uscite/totale/
     note), con la chiusura di fine mese: foglio REGP in PDF,
     deposito in fogli_presenze/ e bozza .eml all'Amministrazione
     (Patrizia) — l'invio resta a una persona da Outlook.
   - BANCA ORE: un conto solo (regola dell'utente 03/09/2026):
     le supplementari NON pagate sono il versamento, i recuperi il
     prelievo, saldo = differenza; le altre causali sono conteggi
     propri. Movimenti con pagato/recuperato/chiuso.
   - FERIE E PERMESSI: le richieste col nulla osta del Direttore.
     Due strade PER PRATICA (scelta utente 03/09/2026): telaio
     «Autorizza dall'app» (PDF + mail col link #ferie-<id>, visto
     registrato, deposito in richieste_ferie_permessi/) oppure
     giro cartaceo con sola registrazione dell'esito.
     Il registro presenze lo tiene la segreteria per tutti.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { APP_URL } from './config.js';
import { risolviCartella, leggiByte } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';
import { MESI, mm2hm } from './presenze-doc.js';

const CARTELLA_FOGLI = '2_AREE/Amministrazione/personale/fogli_presenze';
const CARTELLA_RICHIESTE = '2_AREE/Amministrazione/personale/richieste_ferie_permessi';
const CAUSALI_BASE = ['Ore supplementari', 'Recupero', 'Ferie', 'Permesso', 'Malattia', 'Riunione', 'Formazione', 'Permesso sindacale RSU', 'Festività'];
const AUT = {
  da_richiedere: ['dt-senzadata', 'da richiedere'],
  richiesta: ['dt-senzadata', 'dal Direttore'],
  approvata: ['dt-ok', 'APPROVATA'],
  respinta: ['dt-scaduto', 'respinta'],
};
/* nome file a convenzione: Cognome-Nome dei dipendenti noti */
const DIP_FILE = {
  'Renato Squizzato': 'Squizzato-Renato',
  'Ing. Paolo Balladore': 'Balladore-Paolo',
  'Nicola Arch. De Marco': 'De-Marco-Nicola',
  'Ing. Donato Chiffi': 'Chiffi-Donato',
  'Stefano Dr. Bortolami': 'Bortolami-Stefano',
  'Giampaolo Dr. Lupato': 'Lupato-Giampaolo',
  'Anna Ing. Migliolaro': 'Migliolaro-Anna',
};
const dipFile = (d) => DIP_FILE[d] || String(d || 'dipendente').replace(/[^A-Za-z0-9]+/g, '-');

let tab = 'mese';
let dipendente = 'Renato Squizzato';
let cursore = oggiIso().slice(0, 7);         /* 'aaaa-mm' */
let dipendenti = [];
let conf = {};
let filtroBanca = 'aperte';
let filtroFerie = 'aperte';

const hm = (t) => (t ? String(t).slice(0, 5) : '');
const hm2min = (t) => {
  const m = String(t || '').match(/^(\d{1,2})[:.](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/* Saldo della banca ore dalle partite aperte: supplementari non pagate
   (da recuperare) meno recuperi; le pagate a parte; le altre causali
   (ferie, permessi, malattia…) sono conteggi propri, non banca ore. */
function calcolaBanca(aperte) {
  const r = { supplementari: 0, recuperi: 0, pagate: 0, saldo: 0, altre: {} };
  for (const e of aperte) {
    const c = String(e.causale || '').toLowerCase();
    if (/suppl|straord/.test(c)) {
      if (e.pagato) r.pagate += e.ore_min || 0;
      else r.supplementari += e.ore_min || 0;
    } else if (/recupero/.test(c)) {
      r.recuperi += e.ore_min || 0;
    } else {
      r.altre[e.causale] = (r.altre[e.causale] || 0) + (e.ore_min || 0);
    }
  }
  r.saldo = r.supplementari - r.recuperi;
  return r;
}

const totDaOrari = (e1, u1, e2, u2) => {
  let tot = 0;
  const a = hm2min(e1); const b = hm2min(u1);
  const c = hm2min(e2); const d = hm2min(u2);
  if (a != null && b != null && b > a) tot += b - a;
  if (c != null && d != null && d > c) tot += d - c;
  return tot;
};

async function caricaBase() {
  const [{ data: cfg }, { data: dd }] = await Promise.all([
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'direttore_nome', 'direttore_firma_id']),
    sb.from('s_ferie_richieste').select('dipendente'),
  ]);
  conf = Object.fromEntries((cfg || []).map((r) => [r.chiave, r.valore]));
  const insieme = new Set(Object.keys(DIP_FILE));
  for (const r of dd || []) if (r.dipendente) insieme.add(r.dipendente);
  dipendenti = [...insieme].sort((a, b) => (a === 'Renato Squizzato' ? -1 : b === 'Renato Squizzato' ? 1 : a.localeCompare(b)));
}

/* ══════════ ingresso ══════════ */

export async function render() {
  const host = $('#presenze-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await caricaBase();

  /* il Direttore vede solo le richieste da autorizzare (le altre
     tabelle sono comunque chiuse dalle policy del database) */
  if (state.soloDirettore) { tab = 'ferie'; return renderFerie(host); }

  host.innerHTML = `
    <div class="dt-barra" style="margin-bottom:10px">
      <div class="seg" id="pz-tab">
        ${[['mese', '📅 Mese'], ['banca', '⏱ Banca ore'], ['ferie', '🏖 Ferie e permessi']].map(([v, l]) =>
          `<button class="seg-btn ${tab === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <label class="hint">Dipendente</label>
        <select id="pz-dip" class="inp inp-sm">${dipendenti.map((d) =>
          `<option ${d === dipendente ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
      </div>
    </div>
    <div id="pz-corpo"></div>`;

  $('#pz-tab').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { tab = b.dataset.val; render(); }
  });
  $('#pz-dip').addEventListener('change', (e) => { dipendente = e.target.value; render(); });

  const corpo = $('#pz-corpo');
  if (tab === 'mese') return renderMese(corpo);
  if (tab === 'banca') return renderBanca(corpo);
  return renderFerie(corpo);
}

/* ══════════ scheda MESE ══════════ */

async function datiMese() {
  const [anno, mese] = cursore.split('-').map(Number);
  const da = `${cursore}-01`;
  const a = `${cursore}-${String(new Date(anno, mese, 0).getDate()).padStart(2, '0')}`;
  const [{ data: pres }, { data: extra }] = await Promise.all([
    sb.from('s_presenze').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data').order('id'),
    sb.from('s_presenze_extra').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data'),
  ]);
  return { anno, mese, presenze: pres || [], extra: extra || [] };
}

async function renderMese(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const { anno, mese, presenze, extra } = await datiMese();

  const perGiorno = {};
  for (const p of presenze) (perGiorno[p.data] = perGiorno[p.data] || []).push(p);
  const nGiorni = new Date(anno, mese, 0).getDate();
  const totMese = presenze.reduce((s, p) => s + (p.tot_min || 0), 0);
  const oggi = oggiIso();

  let righe = '';
  for (let g = 1; g <= nGiorni; g++) {
    const iso = `${cursore}-${String(g).padStart(2, '0')}`;
    const dow = new Date(anno, mese - 1, g).getDay();
    const festivo = dow === 0 || dow === 6;
    const rr = perGiorno[iso] || [null];
    rr.forEach((p, i) => {
      righe += `<tr data-id="${p ? p.id : ''}" data-data="${iso}" class="${festivo ? 'hint' : ''}" ${iso === oggi ? 'style="background:#fff6ef"' : ''}>
        <td>${i === 0 ? `<strong>${g}</strong> ${['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][dow]}` : ''}</td>
        <td>${p ? hm(p.entra1) : ''}</td><td>${p ? hm(p.esce1) : ''}</td>
        <td>${p ? hm(p.entra2) : ''}</td><td>${p ? hm(p.esce2) : ''}</td>
        <td><strong>${p && p.tot_min ? mm2hm(p.tot_min) : ''}</strong></td>
        <td class="hint">${p ? esc(p.note || '') : ''}</td>
      </tr>`;
    });
  }

  const [aP, mP] = cursore.split('-').map(Number);
  const prec = new Date(aP, mP - 2, 1); const succ = new Date(aP, mP, 1);
  const isoM = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  host.innerHTML = `
    <div class="dt-barra">
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="pz-prec">‹</button>
        <strong style="min-width:150px;text-align:center">${MESI[mese - 1]} ${anno}</strong>
        <button class="btn btn-ghost btn-sm" id="pz-succ">›</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="pz-pdf">📄 Foglio PDF</button>
        <button class="btn btn-primary btn-sm" id="pz-chiudi">📧 Chiudi il mese: foglio + mail ad Amministrazione</button>
        <button class="btn btn-primary btn-sm" id="pz-nuovo">+ Registra giornata</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <span class="dt-cella dt-ok" style="padding:4px 10px">⏱ ${mm2hm(totMese)} ore nel mese</span>
      ${extra.length ? `<span class="dt-cella dt-senzadata" style="padding:4px 10px">📌 ${extra.length} movimenti banca ore nel mese</span>` : ''}
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Giorno</th><th>Entrata</th><th>Uscita</th><th>Entrata</th><th>Uscita</th><th>Tot.</th><th>Note / assenza</th></tr></thead>
        <tbody>${righe}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">Clic su una riga per registrare o correggere la giornata.
      A fine mese «Chiudi il mese» genera il foglio REGP, lo deposita in fogli_presenze/ su Drive
      e prepara la bozza per l'Amministrazione: l'invio resta a te da Outlook.</p>`;

  $('#pz-prec').addEventListener('click', () => { cursore = isoM(prec); renderMese(); });
  $('#pz-succ').addEventListener('click', () => { cursore = isoM(succ); renderMese(); });
  $('#pz-nuovo').addEventListener('click', () => formPresenza(null, oggiIso()));
  $('#pz-pdf').addEventListener('click', (ev) => chiudiMese(ev.currentTarget, false));
  $('#pz-chiudi').addEventListener('click', (ev) => chiudiMese(ev.currentTarget, true));
  host.querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    const id = tr.dataset.id ? Number(tr.dataset.id) : null;
    formPresenza(id ? presenze.find((p) => p.id === id) : null, tr.dataset.data);
  }));
}

function formPresenza(p, dataIso) {
  const ora = (id, label, v) => `<div class="field"><label>${label}</label>
    <input type="time" id="pz-${id}" value="${v ? hm(v) : ''}"></div>`;
  apriDrawer(p ? `Giornata del ${dataIt(p.data)}` : 'Registra giornata', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Data *</label><input type="date" id="pz-data" value="${p ? p.data : dataIso}"></div>
      <div class="field"><label>Datore</label><input id="pz-datore" value="${esc(p ? p.datore : 'CPT')}"></div>
      ${ora('e1', 'Entrata mattina', p?.entra1)}${ora('u1', 'Uscita mattina', p?.esce1)}
      ${ora('e2', 'Entrata pomeriggio', p?.entra2)}${ora('u2', 'Uscita pomeriggio', p?.esce2)}
    </div>
    <div class="field" style="margin-top:8px"><label>Note / motivazione assenza</label>
      <input id="pz-note" value="${esc(p?.note || '')}" list="pz-assenze">
      <datalist id="pz-assenze"><option>FERIE</option><option>MALATTIA</option><option>PERMESSO</option><option>RECUPERO</option><option>FESTIVITÀ</option></datalist></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${p ? '<button class="btn btn-ghost" id="pz-elimina">🗑 Elimina la riga</button>' : ''}</div>
      <button class="btn btn-primary" id="pz-salva">Salva</button>
    </div>
    <p class="hint" style="margin-top:8px">Il totale si calcola da solo dagli orari. Le ore oltre l'orario
      si registrano anche in Banca ore come «Ore supplementari», come si faceva in Access.</p>`);

  $('#pz-salva').addEventListener('click', async (ev) => {
    const dati = {
      dipendente,
      data: $('#pz-data').value,
      datore: $('#pz-datore').value.trim() || 'CPT',
      entra1: $('#pz-e1').value || null, esce1: $('#pz-u1').value || null,
      entra2: $('#pz-e2').value || null, esce2: $('#pz-u2').value || null,
      note: $('#pz-note').value.trim() || null,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    };
    if (!dati.data) return toast('Serve la data.', 'err');
    dati.tot_min = totDaOrari(dati.entra1, dati.esce1, dati.entra2, dati.esce2);
    attendi(ev.currentTarget, true);
    const { error } = p
      ? await sb.from('s_presenze').update(dati).eq('id', p.id)
      : await sb.from('s_presenze').insert(dati);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Giornata registrata.', 'ok');
    chiudiDrawer();
    renderMese();
  });
  $('#pz-elimina')?.addEventListener('click', async () => {
    if (!confirm('Elimino questa riga di presenza?')) return;
    const { error } = await sb.from('s_presenze').delete().eq('id', p.id);
    if (error) return toast(error.message, 'err');
    toast('Riga eliminata.', 'ok');
    chiudiDrawer();
    renderMese();
  });
}

/* fine mese: foglio REGP (+ deposito Drive e bozza mail se conMail) */
async function chiudiMese(btn, conMail) {
  attendi(btn, true, 'Preparo il foglio…');
  try {
    const { anno, mese, presenze, extra } = await datiMese();
    if (!presenze.length && !confirm('Il mese non ha righe di presenza: genero comunque il foglio vuoto?')) return;
    const { pdfFoglioPresenze } = await import('./presenze-doc.js');
    const byte = await pdfFoglioPresenze({ dipendente, anno, mese, presenze, extra });
    const nomeFile = `${anno}_${String(mese).padStart(2, '0')}_01_REGP_${dipFile(dipendente)}_foglio-presenze-${MESI[mese - 1]}.pdf`;

    if (!conMail) {
      const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = nomeFile; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Foglio scaricato.', 'ok');
      return;
    }

    /* deposito nel vault a nome convenzione REGP */
    const cart = await risolviCartella(CARTELLA_FOGLI);
    if (!cart.id) throw new Error('Cartella fogli_presenze non trovata su Drive');
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const amm = RUBRICA_INTERNA.find((x) => /amministrazione/i.test(x.nome));
    const totMese = presenze.reduce((s, p) => s + (p.tot_min || 0), 0);
    const perCausale = {};
    for (const e of extra) perCausale[e.causale] = (perCausale[e.causale] || 0) + (e.ore_min || 0);
    const riepilogo = Object.entries(perCausale).map(([c, m]) => `- ${c}: ${mm2hm(m)}`).join('\n');
    const { data: aperte } = await sb.from('s_presenze_extra').select('causale, ore_min, pagato')
      .eq('dipendente', dipendente).eq('chiuso', false);
    const banca = calcolaBanca(aperte || []);
    const bancaTxt = [
      `- Saldo banca ore da recuperare: ${mm2hm(banca.saldo)} (${mm2hm(banca.supplementari)} supplementari - ${mm2hm(banca.recuperi)} recuperi)`,
      banca.pagate ? `- Ore supplementari segnate pagate, in attesa di chiusura: ${mm2hm(banca.pagate)}` : null,
      ...Object.entries(banca.altre).map(([c, m]) => `- ${c}: ${mm2hm(m)} aperte`),
    ].filter(Boolean).join('\n');

    scaricaEml({
      to: amm?.email || 'amministrazione@formedilpadova.it',
      oggetto: `Formedil Padova - Foglio presenze ${MESI[mese - 1]} ${anno} - ${dipendente}`,
      corpo: `Buongiorno,

in allegato il foglio di rilevazione presenze di ${dipendente} per il mese di ${MESI[mese - 1]} ${anno}.

Ore lavorate nel mese: ${mm2hm(totMese)}.
${riepilogo ? `\nMovimenti del mese (straordinari, permessi, recuperi):\n${riepilogo}\n` : ''}${bancaTxt ? `\nBanca ore e conteggi aperti:\n${bancaTxt}\n` : ''}
Il foglio è anche depositato in archivio (personale/fogli_presenze).

Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: nomeFile, byte }],
      nomeFile: `foglio-presenze-${anno}-${String(mese).padStart(2, '0')}.eml`,
    });
    toast('Foglio depositato su Drive e bozza per l\'Amministrazione scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ══════════ scheda BANCA ORE ══════════ */

async function renderBanca(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const anno = Number(cursore.slice(0, 4));
  let q = sb.from('s_presenze_extra').select('*').eq('dipendente', dipendente).order('data', { ascending: false }).order('id', { ascending: false });
  if (filtroBanca === 'aperte') q = q.eq('chiuso', false);
  if (filtroBanca === 'anno') q = q.gte('data', `${anno}-01-01`).lte('data', `${anno}-12-31`);
  if (filtroBanca === 'tutte') q = q.limit(400);
  const { data: righe } = await q;
  const movimenti = righe || [];

  const { data: aperteTutte } = await sb.from('s_presenze_extra').select('causale, ore_min, pagato')
    .eq('dipendente', dipendente).eq('chiuso', false);
  /* LA BANCA ORE È UN CONTO SOLO (regola dell'utente, 03/09/2026):
     le ore supplementari NON pagate sono il versamento, i recuperi il
     prelievo, il saldo è la differenza. Le supplementari segnate pagate
     non vanno recuperate: restano solo in attesa di chiusura. */
  const saldoDi = calcolaBanca(aperteTutte || []);

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${saldoDi.saldo > 0 ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">
        ⏱ Banca ore: <strong>${mm2hm(saldoDi.saldo)}</strong> da recuperare
        <span class="hint">(${mm2hm(saldoDi.supplementari)} supplementari − ${mm2hm(saldoDi.recuperi)} recuperi)</span></span>
      ${saldoDi.pagate ? `<span class="dt-cella dt-ok" style="padding:4px 10px">💶 ${mm2hm(saldoDi.pagate)} supplementari segnate pagate, da chiudere</span>` : ''}
      ${Object.entries(saldoDi.altre).map(([c, m]) =>
        `<span class="dt-cella dt-senzadata" style="padding:4px 10px">${esc(c)}: <strong>${mm2hm(m)}</strong> aperte</span>`).join('')}
    </div>
    <div class="dt-barra">
      <div class="seg" id="pz-fb">
        ${[['aperte', 'Aperte'], ['anno', `Anno ${anno}`], ['tutte', 'Ultime 400']].map(([v, l]) =>
          `<button class="seg-btn ${filtroBanca === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-sm" id="pz-mov">+ Registra movimento</button>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Data</th><th>Causale</th><th>Ore</th><th>Stato</th><th>Note</th></tr></thead>
        <tbody>${movimenti.map((e) => `<tr data-id="${e.id}">
          <td>${dataIt(e.data)}</td>
          <td>${esc(e.causale)}</td>
          <td><strong>${mm2hm(e.ore_min)}</strong></td>
          <td>${e.chiuso ? '<span class="dt-cella dt-ok" style="padding:1px 6px">chiusa</span>' : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">APERTA</span>'}
            ${e.pagato ? ' 💶' : ''}${e.recuperato ? ` ↩${e.recuperato_il ? ' ' + dataIt(e.recuperato_il) : ''}` : ''}</td>
          <td class="hint">${esc(e.note || '')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">Nessun movimento con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">La banca ore è un conto solo: le ore supplementari NON pagate sono il versamento,
      i recuperi il prelievo, il saldo è la differenza. Le supplementari segnate pagate non vanno
      recuperate e aspettano solo la chiusura. Le altre causali (ferie, permessi, malattia…) sono
      conteggi propri. Storico Access dal 2009 importato; una partita si CHIUDE quando è saldata.</p>`;

  $('#pz-fb').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroBanca = b.dataset.val; renderBanca(); }
  });
  $('#pz-mov').addEventListener('click', () => formMovimento(null));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => formMovimento(movimenti.find((e) => e.id === Number(tr.dataset.id)))));
}

function formMovimento(e) {
  apriDrawer(e ? `Movimento del ${dataIt(e.data)}` : 'Registra movimento banca ore', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Data *</label><input type="date" id="mv-data" value="${e ? e.data : oggiIso()}"></div>
      <div class="field"><label>Ore (hh:mm) *</label><input id="mv-ore" placeholder="01:30" value="${e ? mm2hm(e.ore_min).padStart(5, '0') : ''}"></div>
    </div>
    <div class="field"><label>Causale *</label>
      <input id="mv-causale" list="mv-causali" value="${esc(e?.causale || 'Ore supplementari')}">
      <datalist id="mv-causali">${CAUSALI_BASE.map((c) => `<option>${c}</option>`).join('')}</datalist></div>
    <div class="field"><label>Note</label><input id="mv-note" value="${esc(e?.note || '')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:6px">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mv-pagato" ${e?.pagato ? 'checked' : ''}> Pagata</label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mv-recu" ${e?.recuperato ? 'checked' : ''}> Recuperata</label>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mv-chiuso" ${e?.chiuso ? 'checked' : ''}> Chiusa</label>
    </div>
    <div class="field" style="margin-top:6px"><label>Recuperata in data</label>
      <input type="date" id="mv-recdata" value="${e?.recuperato_il || ''}"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${e ? '<button class="btn btn-ghost" id="mv-elimina">🗑 Elimina</button>' : ''}</div>
      <button class="btn btn-primary" id="mv-salva">Salva</button>
    </div>`);

  $('#mv-salva').addEventListener('click', async (ev) => {
    const oreMin = hm2min($('#mv-ore').value.trim());
    const causale = $('#mv-causale').value.trim();
    if (!$('#mv-data').value || oreMin == null || !causale) return toast('Servono data, ore (hh:mm) e causale.', 'err');
    attendi(ev.currentTarget, true);
    const dati = {
      dipendente, data: $('#mv-data').value, causale, ore_min: oreMin,
      note: $('#mv-note').value.trim() || null,
      pagato: $('#mv-pagato').checked, recuperato: $('#mv-recu').checked, chiuso: $('#mv-chiuso').checked,
      recuperato_il: $('#mv-recdata').value || null,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    };
    const { error } = e
      ? await sb.from('s_presenze_extra').update(dati).eq('id', e.id)
      : await sb.from('s_presenze_extra').insert(dati);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Movimento registrato.', 'ok');
    chiudiDrawer();
    renderBanca();
  });
  $('#mv-elimina')?.addEventListener('click', async () => {
    if (!confirm('Elimino questo movimento?')) return;
    const { error } = await sb.from('s_presenze_extra').delete().eq('id', e.id);
    if (error) return toast(error.message, 'err');
    toast('Movimento eliminato.', 'ok');
    chiudiDrawer();
    renderBanca();
  });
}

/* ══════════ scheda FERIE E PERMESSI ══════════ */

let richieste = [];

async function renderFerie(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const { data } = await sb.from('s_ferie_richieste').select('*').order('id', { ascending: false });
  richieste = data || [];
  const lista = (filtroFerie === 'aperte')
    ? richieste.filter((r) => ['da_richiedere', 'richiesta'].includes(r.aut_stato))
    : richieste;

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="fe-f">
        ${[['aperte', 'In attesa'], ['tutte', 'Tutte']].map(([v, l]) =>
          `<button class="seg-btn ${filtroFerie === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      ${state.soloDirettore ? '' : '<button class="btn btn-primary btn-sm" id="fe-nuova">+ Nuova richiesta</button>'}
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Dipendente</th><th>Tipo</th><th>Periodo</th><th>Ore</th><th>Nulla osta</th></tr></thead>
        <tbody>${lista.map((r) => {
          const [cA, lA] = AUT[r.aut_stato] || ['', r.aut_stato];
          return `<tr data-id="${r.id}">
            <td>${r.id}</td>
            <td>${esc(r.dipendente)}</td>
            <td>${esc(r.tipo)}</td>
            <td>${dataIt(r.data_inizio)}${r.data_fine && r.data_fine !== r.data_inizio ? ' → ' + dataIt(r.data_fine) : ''}</td>
            <td>${r.ore ?? '—'}</td>
            <td><span class="dt-cella ${cA}" style="padding:2px 8px">${esc(lA)}</span>${r.aut_modalita === 'cartacea' ? ' ✍️' : ''}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="6" class="empty">Nessuna richiesta.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">Per ogni richiesta si sceglie la strada: nulla osta
      <strong>dall'app</strong> (mail al Direttore con «Autorizza dall'app», visto registrato e modulo
      depositato in richieste_ferie_permessi/) oppure <strong>giro cartaceo</strong> con la sola
      registrazione dell'esito. A richiesta approvata si possono generare in automatico le righe
      di presenza e banca ore dei giorni.</p>`;

  $('#fe-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroFerie = b.dataset.val; renderFerie(); }
  });
  $('#fe-nuova')?.addEventListener('click', formRichiesta);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriRichiesta(Number(tr.dataset.id))));
}

function formRichiesta() {
  apriDrawer('Nuova richiesta ferie / permesso / recupero', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Dipendente</label>
        <select id="fr-dip">${dipendenti.map((d) => `<option ${d === dipendente ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo *</label>
        <select id="fr-tipo"><option value="ferie">Ferie</option><option value="permesso">Permesso</option><option value="recupero">Recupero</option></select></div>
      <div class="field"><label>Data inizio *</label><input type="date" id="fr-da" value="${oggiIso()}"></div>
      <div class="field"><label>Data fine</label><input type="date" id="fr-a"></div>
      <div class="field"><label>Dalle ore</label><input type="time" id="fr-dalle"></div>
      <div class="field"><label>Alle ore</label><input type="time" id="fr-alle"></div>
      <div class="field"><label>Totale ore</label><input type="number" step="0.5" id="fr-ore" placeholder="es. 8"></div>
      <div class="field"><label>Monte ore</label>
        <select id="fr-monte"><option value="ferie">Ferie</option><option value="permessi">Permessi retribuiti</option></select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note (facoltative)</label><input id="fr-motivo"></div>
    <button class="btn btn-primary" id="fr-crea" style="margin-top:10px">Crea la richiesta</button>`);

  $('#fr-tipo').addEventListener('change', () => {
    $('#fr-monte').value = $('#fr-tipo').value === 'permesso' ? 'permessi' : 'ferie';
  });
  $('#fr-crea').addEventListener('click', async (ev) => {
    if (!$('#fr-da').value) return toast('Serve la data di inizio.', 'err');
    attendi(ev.currentTarget, true);
    const { data: nuova, error } = await sb.from('s_ferie_richieste').insert({
      dipendente: $('#fr-dip').value,
      tipo: $('#fr-tipo').value,
      data_inizio: $('#fr-da').value,
      data_fine: $('#fr-a').value || null,
      ora_dalle: $('#fr-dalle').value || null,
      ora_alle: $('#fr-alle').value || null,
      ore: $('#fr-ore').value ? Number($('#fr-ore').value) : null,
      monte: $('#fr-monte').value,
      motivo: $('#fr-motivo').value.trim() || null,
      aggiornato_da: state.email,
    }).select('*').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Richiesta creata.', 'ok');
    await renderFerie();
    apriRichiesta(nuova.id);
  });
}

export async function apriRichiesta(id) {
  if (!richieste.length) {
    const { data } = await sb.from('s_ferie_richieste').select('*').order('id', { ascending: false });
    richieste = data || [];
  }
  const r = richieste.find((x) => x.id === id);
  if (!r) return toast('Richiesta non trovata.', 'err');
  const [cA, lA] = AUT[r.aut_stato] || ['', r.aut_stato];
  const sonoDirettore = state.email && conf.direttore_email &&
    state.email.toLowerCase() === conf.direttore_email.toLowerCase();
  const decisa = ['approvata', 'respinta'].includes(r.aut_stato);

  apriDrawer(`Richiesta n° ${r.id} — ${r.tipo} — ${r.dipendente}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cA}"></span>
      <span class="dt-quadro-req">Nulla osta Direttore</span>
      <span class="dt-quadro-stato">${esc(lA)}${r.autorizzata_da ? ` — ${esc(r.autorizzata_da)}${r.data_autorizzazione ? ` il ${dataIt(r.data_autorizzazione)}` : ''}` : ''}
        ${r.aut_drive_url ? ` · <a href="${esc(r.aut_drive_url)}" target="_blank" rel="noopener">modulo</a>` : ''}</span>
    </div>
    <div class="dt-doc-riga"><strong>Periodo:</strong> ${dataIt(r.data_inizio)}${r.data_fine && r.data_fine !== r.data_inizio ? ' → ' + dataIt(r.data_fine) : ''}
      ${r.ora_dalle ? ` — dalle ${hm(r.ora_dalle)} alle ${hm(r.ora_alle)}` : ''}</div>
    <div class="dt-doc-riga"><strong>Ore richieste:</strong> ${r.ore ?? '—'} — monte ${esc(r.monte || 'ferie')}</div>
    ${r.motivo ? `<div class="dt-doc-riga"><strong>Note:</strong> ${esc(r.motivo)}</div>` : ''}
    ${r.aut_note ? `<div class="dt-doc-riga"><strong>Note del Direttore:</strong> ${esc(r.aut_note)}</div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${decisa ? `
      ${r.aut_stato === 'approvata' && !r.righe_generate && !state.soloDirettore ? `
      <p class="hint" style="margin:0 0 8px">Richiesta approvata: posso creare le righe dei giorni
        (presenze con la nota e movimenti in banca ore), da correggere poi se serve.</p>
      <button class="btn btn-primary" id="fe-genera">📅 Genera le righe dei giorni</button>` :
      r.righe_generate ? '<p class="hint">Righe di presenza e banca ore già generate.</p>' : ''}` : `
      <h4 style="margin:0 0 6px">Nulla osta</h4>
      <p class="hint" style="margin:0 0 10px">Scegli la strada: dall'app (mail al Direttore col link) o giro cartaceo.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${state.soloDirettore ? '' : `
        <button class="btn btn-ghost" id="fe-pdf">📄 Scarica il modulo (PDF)</button>
        <button class="btn btn-primary" id="fe-manda">📧 Modulo + mail al Direttore (app)</button>
        <button class="btn btn-ghost" id="fe-cartacea">✍️ Registra l'esito del giro cartaceo</button>`}
        ${sonoDirettore ? `
        <button class="btn btn-primary" id="fe-approva">✅ Approva (Direttore)</button>
        <button class="btn btn-ghost" id="fe-respingi">⛔ Respingi</button>` : ''}
      </div>`}
    ${!decisa && !state.soloDirettore ? `<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="fe-elimina">🗑 Elimina la richiesta</button></div>` : ''}`);

  $('#fe-pdf')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const { pdfRichiestaFerie } = await import('./presenze-doc.js');
      const byte = await pdfRichiestaFerie(r, null, null);
      const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = nomeRichiesta(r, false); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });
  $('#fe-manda')?.addEventListener('click', (ev) => mandaAlDirettore(r, ev.currentTarget));
  $('#fe-cartacea')?.addEventListener('click', () => esitoCartaceo(r));
  $('#fe-approva')?.addEventListener('click', (ev) => decidiRichiesta(r, 'approvata', ev.currentTarget));
  $('#fe-respingi')?.addEventListener('click', (ev) => decidiRichiesta(r, 'respinta', ev.currentTarget));
  $('#fe-genera')?.addEventListener('click', (ev) => generaRighe(r, ev.currentTarget));
  $('#fe-elimina')?.addEventListener('click', async () => {
    if (!confirm('Elimino la richiesta?')) return;
    await sb.from('s_ferie_richieste').delete().eq('id', r.id);
    chiudiDrawer();
    renderFerie();
  });
}

const nomeRichiesta = (r, conVisto) =>
  `${(r.created_at || oggiIso()).slice(0, 10).replace(/-/g, '_')}_RICH_${dipFile(r.dipendente)}_richiesta-${r.tipo}${conVisto ? '_visto' : ''}.pdf`;

async function mandaAlDirettore(r, btn) {
  attendi(btn, true, 'Preparo…');
  try {
    const { pdfRichiestaFerie } = await import('./presenze-doc.js');
    const byte = await pdfRichiestaFerie(r, null, null);
    scaricaEml({
      to: conf.direttore_email || 'direzione@formedilpadova.it',
      oggetto: `Formedil Padova - Richiesta ${r.tipo} - ${r.dipendente} - n. ${r.id}`,
      corpo: `Egr. Direttore,

in allegato la richiesta di ${r.tipo} n. ${r.id} di ${r.dipendente}:
periodo ${dataIt(r.data_inizio)}${r.data_fine ? ` → ${dataIt(r.data_fine)}` : ''}${r.ore != null ? `, ${r.ore} ore` : ''}.

>>> AUTORIZZA DALL'APP (si apre direttamente la pratica):
${APP_URL}#ferie-${r.id}

In alternativa resta il giro cartaceo: firmare il modulo allegato e restituirlo alla Segreteria.

Distinti saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: nomeRichiesta(r, false), byte }],
      nomeFile: `richiesta-${r.tipo}-${r.id}.eml`,
    });
    await sb.from('s_ferie_richieste').update({
      aut_stato: 'richiesta', aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    toast('Bozza per il Direttore scaricata: aprila da Outlook e premi Invia.', 'ok');
    await renderFerie();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

async function decidiRichiesta(r, esito, btn) {
  if (!confirm(`${esito === 'approvata' ? 'APPROVI' : 'RESPINGI'} la richiesta di ${r.tipo} n° ${r.id} di ${r.dipendente}? Il visto col tuo nome finisce nel modulo.`)) return;
  const note = esito === 'respinta' ? (prompt('Motivo (facoltativo):') || null) : null;
  attendi(btn, true, 'Registro il visto…');
  try {
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
    const { pdfRichiestaFerie } = await import('./presenze-doc.js');
    const byte = await pdfRichiestaFerie(r, visto, firmaByte);

    const cart = await risolviCartella(CARTELLA_RICHIESTE);
    if (!cart.id) throw new Error('Cartella richieste_ferie_permessi non trovata su Drive');
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeRichiesta(r, true), mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const { error } = await sb.from('s_ferie_richieste').update({
      aut_stato: esito, aut_modalita: 'app',
      autorizzata_da: `${visto.nome} (${state.email})`,
      data_autorizzazione: oggiIso(),
      aut_note: note,
      aut_drive_id: su.drive_file_id, aut_drive_url: su.drive_url,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    if (error) throw new Error(error.message);
    toast(`Richiesta ${esito}: il modulo col visto è su Drive.`, 'ok');
    await renderFerie();
    apriRichiesta(r.id);
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

function esitoCartaceo(r) {
  apriDrawer(`Esito cartaceo — richiesta n° ${r.id}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Esito *</label>
        <select id="ec-esito"><option value="approvata">Approvata</option><option value="respinta">Respinta</option></select></div>
      <div class="field"><label>Data della firma *</label><input type="date" id="ec-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Firmata da</label><input id="ec-chi" value="${esc(conf.direttore_nome || '')}"></div>
    <button class="btn btn-primary" id="ec-salva" style="margin-top:10px">Registra</button>`);
  $('#ec-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_ferie_richieste').update({
      aut_stato: $('#ec-esito').value, aut_modalita: 'cartacea',
      autorizzata_da: $('#ec-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#ec-data').value || oggiIso(),
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Esito registrato.', 'ok');
    await renderFerie();
    apriRichiesta(r.id);
  });
}

/* a richiesta approvata: righe di presenza (nota) + banca ore per i giorni feriali */
async function generaRighe(r, btn) {
  const giorni = [];
  const fine = r.data_fine || r.data_inizio;
  for (let d = new Date(r.data_inizio + 'T12:00'); d.toISOString().slice(0, 10) <= fine; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) giorni.push(d.toISOString().slice(0, 10));
  }
  if (!giorni.length) return toast('Nessun giorno feriale nel periodo.', 'err');
  const causale = r.tipo === 'ferie' ? 'Ferie' : r.tipo === 'permesso' ? 'Permesso' : 'Recupero';
  const orePerGiorno = r.ore && giorni.length ? Math.round((Number(r.ore) * 60) / giorni.length) : 480;
  if (!confirm(`Creo ${giorni.length} giorni di ${causale} (${mm2hm(orePerGiorno)} ciascuno) in presenze e banca ore?`)) return;
  attendi(btn, true, 'Creo le righe…');
  try {
    const nota = causale.toUpperCase();
    const { error: e1 } = await sb.from('s_presenze').insert(giorni.map((g) => ({
      dipendente: r.dipendente, data: g, datore: 'CPT', tot_min: 0, note: nota, aggiornato_da: state.email,
    })));
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await sb.from('s_presenze_extra').insert(giorni.map((g) => ({
      dipendente: r.dipendente, data: g, causale, ore_min: orePerGiorno,
      note: `Richiesta n° ${r.id}`, aggiornato_da: state.email,
    })));
    if (e2) throw new Error(e2.message);
    await sb.from('s_ferie_richieste').update({
      righe_generate: true, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    toast(`${giorni.length} giorni creati in presenze e banca ore.`, 'ok');
    chiudiDrawer();
    await renderFerie();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

/* dal cruscotto / dal link profondo #ferie-<id> */
export const apriPratica = apriRichiesta;
