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
import { MESI, mm2hm, eRipartizione, totaleOre, famigliaCausale, contaAttivita, contaProgetti, TESTO_AVVISO,
  MONTI_SALDO, CAUSALI_SALDO, godutoPerAnno, saldoMonte, oreInMinuti, oreCentesimi,
  GIORNI_ORARIO, orarioValido, misuraOrario, testoGiorni, totaleSaldi, giorniNumero, settimaneGiorni } from './presenze-doc.js';

const CARTELLA_FOGLI = '2_AREE/Amministrazione/personale/fogli_presenze';
const CARTELLA_RICHIESTE = '2_AREE/Amministrazione/personale/richieste_ferie_permessi';
/* Le causali sono quelle che l'ufficio usa DAVVERO: l'elenco ricalca i valori
   già presenti nello storico Access di s_presenze_extra, scritti identici.
   ⚠️ «Riunione» è la riunione di lavoro, «Riunione sindacale» è un'altra cosa e
   scala il monte RSU: non si accorpano (chiesto dall'utente il 22/09/2026). */
const CAUSALI_BASE = ['Ore supplementari', 'Recupero', 'Ferie', 'Permesso', 'Malattia', 'Riunione', 'Formazione',
  'Permesso sindacale RSU', 'Riunione sindacale', 'Permessi legge 104/92', 'Festività', 'Ex festività', 'ROL'];

/* I tipi di richiesta e il monte da cui attingono.
   ⚠️ I DUE MONTI SINDACALI SONO DISTINTI (precisato dall'utente il 22/09/2026):
   il permesso RSU sta sul suo, la riunione sindacale sui permessi sindacali.
   Nessuno dei due tocca i permessi retribuiti del contratto. */
const TIPI_RICHIESTA = [
  { tipo: 'ferie', etichetta: 'Ferie', monte: 'ferie', causale: 'Ferie' },
  { tipo: 'permesso', etichetta: 'Permesso', monte: 'permessi', causale: 'Permesso' },
  { tipo: 'permesso_rsu', etichetta: 'Permesso sindacale RSU', monte: 'permessi_rsu', causale: 'Permesso sindacale RSU' },
  { tipo: 'riunione_sindacale', etichetta: 'Riunione sindacale', monte: 'permessi_sindacali', causale: 'Riunione sindacale' },
  { tipo: 'legge104', etichetta: 'Permesso legge 104/92', monte: 'legge104', causale: 'Permessi legge 104/92' },
  { tipo: 'recupero', etichetta: 'Recupero', monte: 'banca_ore', causale: 'Recupero' },
  /* ORE SUPPLEMENTARI da fare (24/09/2026, chiesto dall'utente): il lavoratore chiede
     di fermarsi e dichiara PRIMA se le recupererà (alimentano la banca ore) o se le
     vuole pagate (busta paga); passa dal nulla osta del Direttore come le altre.
     Non scala nessun monte: il campo che conta è `compenso`. */
  { tipo: 'supplementari', etichetta: 'Ore supplementari', monte: null, causale: 'Ore supplementari' },
];
const COMPENSO = { recupero: 'da recuperare — alimenta la banca ore', paga: 'da pagare — in busta paga' };
const eSuppl = (r) => r?.tipo === 'supplementari';
const etichettaTipo = (t) => TIPI_RICHIESTA.find((x) => x.tipo === t)?.etichetta || t;
const MONTI = [
  { monte: 'ferie', etichetta: 'Ferie' },
  { monte: 'permessi', etichetta: 'Permessi retribuiti (contratto)' },
  { monte: 'permessi_rsu', etichetta: 'Permessi sindacali RSU' },
  { monte: 'permessi_sindacali', etichetta: 'Permessi sindacali' },
  { monte: 'legge104', etichetta: 'Permessi legge 104/92' },
  { monte: 'banca_ore', etichetta: 'Banca ore (recupero)' },
];
const tipoRic = (t) => TIPI_RICHIESTA.find((x) => x.tipo === t) || TIPI_RICHIESTA[0];
const etichettaMonte = (m) => (MONTI.find((x) => x.monte === m)?.etichetta || m || 'ferie');
/* I monti sindacali, contati a parte l'uno dall'altro nella scheda Ferie */
const MONTI_SINDACALI = ['permessi_rsu', 'permessi_sindacali'];
const causaliDelMonte = (m) => TIPI_RICHIESTA.filter((x) => x.monte === m).map((x) => x.causale);
/* mesi già cominciati dell'anno: serve al solo confronto INDICATIVO col
   riferimento di 8 ore al mese. ⚠️ Non è il calcolo di un residuo, e non deve
   diventarlo: il monte RSU non è un tetto individuale — può essere aumentato e
   si attinge anche alle ore non usate dagli altri RSU (regola dell'utente,
   22/09/2026). Un «ore rimaste» qui sarebbe un numero falso. */
const mesiTrascorsi = (anno) => (anno === new Date().getFullYear() ? new Date().getMonth() + 1 : 12);
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
/* I DUE BINARI (regola dell'utente, 03/09/2026):
   - supplementare DA RECUPERARE (pagato=false) -> BANCA ORE (versamento);
   - supplementare DA PAGARE/PAGATA (pagato=true) -> circuito ORDINARIO
     (busta paga), fuori dalla banca ore;
   - RECUPERO = prelievo dalla banca ore: NON scala i permessi del
     contratto (quelli sono la causale «Permesso», conteggio proprio). */
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
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'direttore_nome', 'direttore_firma_id',
      'presenze_rsu_ore_mensili_indicative', 'presenze_rsu_nota_monte']),
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
        ${[['mese', '📅 Mese'], ['banca', '⏱ Banca ore'], ['contatori', '📊 Contatori attività'], ['ferie', '🏖 Ferie e permessi']].map(([v, l]) =>
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
  if (tab === 'contatori') return renderContatori(corpo);
  return renderFerie(corpo);
}

/* ══════════ scheda MESE ══════════ */

async function datiMese() {
  const [anno, mese] = cursore.split('-').map(Number);
  const da = `${cursore}-01`;
  const a = `${cursore}-${String(new Date(anno, mese, 0).getDate()).padStart(2, '0')}`;
  const [{ data: pres, error: e1 }, { data: extra, error: e2 }] = await Promise.all([
    sb.from('s_presenze').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data').order('id'),
    sb.from('s_presenze_extra').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data'),
  ]);
  /* lettura fallita: si dice, non si mostra un mese vuoto (26/09/2026) —
     un mese «senza righe» porterebbe a generare il foglio vuoto */
  if (e1 || e2) throw new Error('Non sono riuscito a leggere le presenze del mese. Riprova.');
  return { anno, mese, presenze: pres || [], extra: extra || [] };
}

async function renderMese(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let dm;
  try { dm = await datiMese(); }
  catch (e) { host.innerHTML = `<p class="empty">⚠ ${esc(e.message)}</p>`; return; }
  const { anno, mese, presenze, extra } = dm;

  const perGiorno = {};
  for (const p of presenze) (perGiorno[p.data] = perGiorno[p.data] || []).push(p);
  const nGiorni = new Date(anno, mese, 0).getDate();
  const totMese = totaleOre(presenze);   /* il permesso sindacale non si somma */
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
        <td>${p && p.tot_min ? (eRipartizione(p) ? `<span class="hint" title="Permesso sindacale: quota della giornata, non si somma al totale">di cui ${mm2hm(p.tot_min)}</span>` : `<strong>${mm2hm(p.tot_min)}</strong>`) : ''}</td>
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
        <button class="btn btn-ghost btn-sm" id="pz-periodo">🗓 Prospetto di un periodo</button>
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
  $('#pz-periodo').addEventListener('click', formPeriodo);
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
      <div class="field"><label>Data *</label><input type="date" id="pz-data" value="${esc(p ? p.data : dataIso)}"></div>
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
    const btn = ev.currentTarget;
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
    attendi(btn, true);
    const { error } = p
      ? await sb.from('s_presenze').update(dati).eq('id', p.id)
      : await sb.from('s_presenze').insert(dati);
    attendi(btn, false);
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

/* righe della mail: i movimenti (banca ore, assenze) e il dettaglio attività
   in due elenchi separati — il dettaglio non è un movimento da gestire (02/10/2026) */
function testiMovimenti(extra) {
  const somma = (righe) => {
    const per = {};
    for (const e of righe) per[e.causale] = (per[e.causale] || 0) + (e.ore_min || 0);
    return Object.entries(per).map(([c, m]) => `- ${c}: ${mm2hm(m)}`).join('\n');
  };
  return {
    movimenti: somma(extra.filter((e) => famigliaCausale(e.causale) !== 'dettaglio')),
    dettaglio: somma(extra.filter((e) => famigliaCausale(e.causale) === 'dettaglio')),
  };
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
    const totMese = totaleOre(presenze);   /* il permesso sindacale non si somma */
    const { movimenti: riepilogo, dettaglio } = testiMovimenti(extra);
    const { data: aperte, error: errAp } = await sb.from('s_presenze_extra').select('causale, ore_min, pagato')
      .eq('dipendente', dipendente).eq('chiuso', false);
    /* senza i movimenti aperti la mail direbbe «saldo 0» all'Amministrazione */
    if (errAp) throw new Error("Foglio depositato su Drive, ma non sono riuscito a leggere la banca ore: bozza per l'Amministrazione non preparata. Riprova.");
    const banca = calcolaBanca(aperte || []);
    const bancaTxt = [
      `- Saldo banca ore da recuperare: ${mm2hm(banca.saldo)} (${mm2hm(banca.supplementari)} supplementari - ${mm2hm(banca.recuperi)} recuperi)`,
      banca.pagate ? `- Ore supplementari da pagare/pagate (circuito ordinario, fuori banca ore): ${mm2hm(banca.pagate)}` : null,
      ...Object.entries(banca.altre).map(([c, m]) => `- ${c}: ${mm2hm(m)} aperte`),
    ].filter(Boolean).join('\n');

    scaricaEml({
      to: amm?.email || 'amministrazione@formedilpadova.it',
      oggetto: `Formedil Padova - Foglio presenze ${MESI[mese - 1]} ${anno} - ${dipendente}`,
      corpo: `Buongiorno Patrizia,

in allegato il foglio di rilevazione presenze di ${dipendente} per il mese di ${MESI[mese - 1]} ${anno}.

Ore lavorate nel mese: ${mm2hm(totMese)}.
${riepilogo ? `\nMovimenti del mese (straordinari, permessi, recuperi):\n${riepilogo}\n` : ''}${dettaglio ? `\nDettaglio attività (ore già comprese in quelle lavorate, non si sommano):\n${dettaglio}\n` : ''}${bancaTxt ? `\nBanca ore e conteggi aperti:\n${bancaTxt}\n` : ''}
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

/* ══════════ prospetto di un PERIODO ══════════
   Chiesto dall'utente il 01/10/2026: Nicola De Marco fattura ogni tre mesi,
   ma il periodo da mandare a Patrizia non è sempre un trimestre — con la
   scuola chiusa ad agosto si manda giugno-settembre. Si sceglie da una data
   a un'altra; di proposta, i tre mesi che finiscono con quello mostrato. */

const isoData = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function formPeriodo() {
  const [anno, mese] = cursore.split('-').map(Number);
  const daProp = isoData(new Date(anno, mese - 3, 1));
  const aProp = isoData(new Date(anno, mese, 0));
  apriDrawer(`Prospetto presenze — ${dipendente}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Dal *</label><input type="date" id="pp-da" value="${daProp}"></div>
      <div class="field"><label>Al *</label><input type="date" id="pp-a" value="${aProp}"></div>
    </div>
    <p class="hint" style="margin-top:6px">Un foglio solo per più mesi: in testa le ore di ogni mese e il totale,
      poi le sole giornate con presenza. I mesi senza presenze compaiono lo stesso, con «nessuna presenza registrata».</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      <button class="btn btn-ghost" id="pp-pdf">📄 Scarica il PDF</button>
      <button class="btn btn-primary" id="pp-mail">📧 PDF + mail ad Amministrazione</button>
    </div>`);
  $('#pp-pdf').addEventListener('click', (ev) => prospettoPeriodo(ev.currentTarget, false));
  $('#pp-mail').addEventListener('click', (ev) => prospettoPeriodo(ev.currentTarget, true));
}

async function prospettoPeriodo(btn, conMail) {
  const da = $('#pp-da').value;
  const a = $('#pp-a').value;
  if (!da || !a) return toast('Servono le due date del periodo.', 'err');
  if (da > a) return toast('La data di inizio viene dopo quella di fine.', 'err');
  attendi(btn, true, 'Preparo il prospetto…');
  try {
    const [{ data: pres, error: e1 }, { data: extra, error: e2 }] = await Promise.all([
      sb.from('s_presenze').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data').order('id'),
      sb.from('s_presenze_extra').select('*').eq('dipendente', dipendente).gte('data', da).lte('data', a).order('data'),
    ]);
    /* lettura fallita: si dice, non si genera un prospetto vuoto */
    if (e1 || e2) throw new Error('Non sono riuscito a leggere le presenze del periodo. Riprova.');
    const presenze = pres || [];
    if (!presenze.length && !confirm('Nel periodo non ci sono righe di presenza: genero comunque il prospetto vuoto?')) return;
    const { pdfPresenzePeriodo, raggruppaPeriodo, etichettaPeriodo } = await import('./presenze-doc.js');
    const byte = await pdfPresenzePeriodo({ dipendente, da, a, presenze, extra: extra || [] });
    const nomeFile = `${da.replace(/-/g, '_')}_REGP_${dipFile(dipendente)}_prospetto-presenze-dal-${da}-al-${a}.pdf`;

    if (!conMail) {
      const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url; link.download = nomeFile; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Prospetto scaricato.', 'ok');
      return;
    }

    const cart = await risolviCartella(CARTELLA_FOGLI);
    if (!cart.id) throw new Error('Cartella fogli_presenze non trovata su Drive');
    const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
      body: { action: 'upload', filename: nomeFile, mime_type: 'application/pdf',
        base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
    });
    if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));

    const mesi = raggruppaPeriodo(presenze, da, a);
    const perMese = mesi.map((x) => `- ${MESI[x.mese - 1]} ${x.anno}: ${x.righe.length
      ? `${mm2hm(x.totMin)} (${x.giorni} ${x.giorni === 1 ? 'giorno' : 'giorni'})` : 'nessuna presenza registrata'}`).join('\n');
    const totPeriodo = mesi.reduce((s, x) => s + x.totMin, 0);
    const { movimenti, dettaglio } = testiMovimenti(extra || []);
    const periodo = etichettaPeriodo(da, a);
    const amm = RUBRICA_INTERNA.find((x) => /amministrazione/i.test(x.nome));

    scaricaEml({
      to: amm?.email || 'amministrazione@formedilpadova.it',
      oggetto: `Prospetto presenze ${periodo} - ${dipendente}`,
      corpo: `Buongiorno Patrizia,

in allegato il prospetto delle presenze di ${dipendente} per il periodo dal ${dataIt(da)} al ${dataIt(a)}.

Ore per mese:
${perMese}

Totale del periodo: ${mm2hm(totPeriodo)}.
${movimenti ? `\nMovimenti del periodo (straordinari, permessi, recuperi):\n${movimenti}\n` : ''}${dettaglio ? `\nDettaglio attività (ore già comprese in quelle lavorate, non si sommano):\n${dettaglio}\n` : ''}
Il prospetto è anche depositato in archivio (personale/fogli_presenze).

Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome: nomeFile, byte }],
      nomeFile: `prospetto-presenze-${da}-${a}.eml`,
    });
    toast('Prospetto depositato su Drive e bozza per l\'Amministrazione scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ══════════ scheda CONTATORI ATTIVITÀ ══════════
   Chiesto dall'utente il 02/10/2026: quante ore per progetto (rendicontazione),
   quante riunioni, quanta formazione frequentata. Legge le righe di DETTAGLIO
   ATTIVITÀ di s_presenze_extra — le stesse che l'ufficio scrive da Access dal
   2016 — e le ore lavorate degli stessi giorni, per i controlli sullo storico:
   le anomalie si mostrano, non si correggono (regola d'oro 9). */

let contDa = `${oggiIso().slice(0, 4)}-01-01`;
let contA = oggiIso();
let contTutti = false;
const contAperte = new Set();

/* Supabase restituisce al massimo 1000 righe per chiamata: si legge a pagine,
   o un periodo lungo verrebbe contato a metà senza dirlo */
async function leggiTutte(costruisci) {
  const out = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await costruisci().range(da, da + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function datiContatori() {
  const filtra = (q) => (contTutti ? q : q.eq('dipendente', dipendente));
  const extra = await leggiTutte(() => filtra(sb.from('s_presenze_extra')
    .select('id, dipendente, data, causale, ore_min, pagato, recuperato, note'))
    .gte('data', contDa).lte('data', contA).order('data').order('id'));
  const giorni = new Set(extra.filter((e) => famigliaCausale(e.causale) === 'dettaglio').map((e) => e.data));
  const presenze = giorni.size ? await leggiTutte(() => filtra(sb.from('s_presenze')
    .select('id, dipendente, data, tot_min, note'))
    .gte('data', contDa).lte('data', contA).order('data').order('id')) : [];
  /* collegamenti ai progetti delle sole righe di dettaglio, a blocchi:
     una lista di id troppo lunga non sta nell'indirizzo della richiesta */
  const idsDett = extra.filter((e) => famigliaCausale(e.causale) === 'dettaglio').map((e) => e.id);
  const collegamenti = [];
  for (let i = 0; i < idsDett.length; i += 200) {
    const { data, error } = await sb.from('s_presenze_extra_progetti').select('extra_id, progetto_id, quota').in('extra_id', idsDett.slice(i, i + 200));
    if (error) throw error;
    collegamenti.push(...(data || []));
  }
  let nomiProgetti = {};
  if (collegamenti.length) {
    const { data: pr, error } = await sb.from('s_progetti_formativi').select('id, titolo, desc_breve').in('id', [...new Set(collegamenti.map((l) => l.progetto_id))]);
    if (error) throw error;
    nomiProgetti = Object.fromEntries((pr || []).map((x) => [x.id, x.desc_breve || x.titolo]));
  }
  return contaAttivita({ extra, presenze: presenze.filter((p) => giorni.has(p.data)), collegamenti, nomiProgetti });
}

async function renderContatori(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  let attivita;
  try { attivita = await datiContatori(); }
  catch {
    host.innerHTML = '<p class="empty">⚠ Non sono riuscito a leggere le ore del periodo: nessun contatore calcolato. Riprova.</p>';
    return;
  }
  const tot = attivita.reduce((s, x) => s + x.totMin, 0);
  const daGuardare = attivita.reduce((s, x) => s + x.avvisi, 0);
  const { progetti: perProgetto, senzaProgettoMin } = contaProgetti(attivita);
  const anno = Number(oggiIso().slice(0, 4));
  const scorciatoie = [
    ['anno', `Anno ${anno}`, `${anno}-01-01`, oggiIso()],
    ['prec', `Anno ${anno - 1}`, `${anno - 1}-01-01`, `${anno - 1}-12-31`],
    ['tutto', 'Tutto lo storico', '2009-01-01', oggiIso()],
  ];

  host.innerHTML = `
    <div class="dt-barra" style="flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <label class="hint">Dal</label><input type="date" id="ct-da" class="inp inp-sm" value="${contDa}">
        <label class="hint">al</label><input type="date" id="ct-a" class="inp inp-sm" value="${contA}">
        <div class="seg" id="ct-scorc">${scorciatoie.map(([v, l, d, a]) =>
          `<button class="seg-btn ${contDa === d && contA === a ? 'is-active' : ''}" data-da="${d}" data-a="${a}">${l}</button>`).join('')}</div>
        <label style="display:flex;gap:5px;align-items:center;cursor:pointer" class="hint">
          <input type="checkbox" id="ct-tutti" ${contTutti ? 'checked' : ''} style="width:auto;margin:0"> tutti i dipendenti</label>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="ct-csv">⬇ Excel (CSV)</button>
        <button class="btn btn-ghost btn-sm" id="ct-pdf">📄 PDF</button>
        <button class="btn btn-primary btn-sm" id="ct-nuovo">+ Registra un'attività</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">
      <span class="dt-cella dt-ok" style="padding:4px 10px">📊 ${mm2hm(tot)} ore di dettaglio · ${attivita.length} attività</span>
      ${daGuardare ? `<span class="dt-cella dt-senzadata" style="padding:4px 10px">⚠ ${daGuardare} righe da guardare</span>` : ''}
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Attività</th><th>Ore</th><th>Giornate</th><th>Da guardare</th></tr></thead>
        <tbody>${attivita.map((x, i) => {
          const aperta = contAperte.has(x.causale);
          const dettaglio = aperta ? x.righe.map((r) => `<tr class="ct-riga" data-id="${r.id}" style="background:var(--bg-soft, #fafafa);cursor:pointer">
              <td style="padding-left:22px">${contTutti ? `<span class="hint">${esc(r.dipendente)}</span> · ` : ''}${dataIt(r.data)}
                <span class="hint">${esc(r.note || '')}</span></td>
              <td><strong>${mm2hm(r.ore_min)}</strong></td>
              <td class="hint">${r.lavorateGiorno == null ? 'giornata non nel foglio' : `lavorate ${mm2hm(r.lavorateGiorno)}`}${r.supplGiorno ? ` · +${mm2hm(r.supplGiorno)} suppl.` : ''}${r.progetti.length ? `<br>→ ${r.progetti.map((x) => esc(x.quota < 1 ? `${x.nome} (${Math.round(x.quota * 100)}%)` : x.nome)).join(' + ')}` : ''}</td>
              <td>${r.avvisi.filter((v) => v !== 'senza-presenze').map((v) => `<span class="dt-cella dt-senzadata" style="padding:1px 6px;margin:1px">${esc(TESTO_AVVISO[v])}</span>`).join('')}</td>
            </tr>`).join('') : '';
          return `<tr class="ct-att" data-i="${i}" style="cursor:pointer">
              <td>${aperta ? '▾' : '▸'} <strong>${esc(x.causale)}</strong>${x.altreGrafie.length ? ` <span class="hint">(scritta anche: ${esc(x.altreGrafie.join(' / '))})</span>` : ''}</td>
              <td><strong>${mm2hm(x.totMin)}</strong></td>
              <td>${x.giorni}</td>
              <td>${x.avvisi ? `<span class="dt-cella dt-senzadata" style="padding:1px 6px">⚠ ${x.avvisi}</span>` : ''}</td>
            </tr>${dettaglio}`;
        }).join('') || '<tr><td colspan="4" class="empty">Nessuna attività nel periodo.</td></tr>'}</tbody>
      </table>
    </div>
    ${perProgetto.length ? `<h4 style="margin:14px 0 6px">Per progetto</h4>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Progetto</th><th>Ore</th><th>Righe</th></tr></thead>
        <tbody>${perProgetto.map((g) => `<tr><td>${esc(g.nome)}</td><td><strong>${mm2hm(g.totMin)}</strong></td><td>${g.righe.length}</td></tr>`).join('')}
          <tr><td class="hint">non collegate a un progetto</td><td class="hint">${mm2hm(senzaProgettoMin)}</td><td></td></tr></tbody>
      </table>
    </div>
    <p class="hint">Una riga divisa fra più progetti conta per la sua quota: la progettazione CAM 2021-22 è metà a ciascun corso CAM.
      Le stesse ore escono nella rendicontazione del progetto (Corsi e formazione → 🎯 Progetti finanziati), nella sezione delle ore dell'ufficio.</p>` : ''}
    <p class="hint" style="margin-top:8px">Il <strong>dettaglio attività</strong> dice come sono state spese ore già comprese in quelle
      lavorate: non si somma al totale e non tocca la banca ore. Comprende tutto lo storico registrato da Access (dal 2016).
      Clic su un'attività per vedere le giornate, su una giornata per correggerla. Le righe «da guardare» sono anomalie
      dello storico — un possibile doppione, più ore di dettaglio che ore lavorate, spunte «pagata/recuperata» che al
      dettaglio non servono: <strong>l'app le segnala e non le corregge</strong>, decidi tu.</p>`;

  const ricarica = () => renderContatori();
  $('#ct-da').addEventListener('change', (e) => { contDa = e.target.value || contDa; ricarica(); });
  $('#ct-a').addEventListener('change', (e) => { contA = e.target.value || contA; ricarica(); });
  $('#ct-scorc').addEventListener('click', (e) => {
    const b = e.target.closest('[data-da]');
    if (b) { contDa = b.dataset.da; contA = b.dataset.a; ricarica(); }
  });
  $('#ct-tutti').addEventListener('change', (e) => { contTutti = e.target.checked; ricarica(); });
  $('#ct-nuovo').addEventListener('click', () => formMovimento(null, 'Riunione'));
  host.querySelectorAll('tr.ct-att').forEach((tr) => tr.addEventListener('click', () => {
    const c = attivita[Number(tr.dataset.i)].causale;
    if (contAperte.has(c)) contAperte.delete(c); else contAperte.add(c);
    ricarica();
  }));
  host.querySelectorAll('tr.ct-riga').forEach((tr) => tr.addEventListener('click', async () => {
    const { data: e, error } = await sb.from('s_presenze_extra').select('*').eq('id', Number(tr.dataset.id)).single();
    if (error || !e) return toast('Non sono riuscito ad aprire la riga.', 'err');
    formMovimento(e);
  }));
  const chi = contTutti ? 'tutti i dipendenti' : dipendente;
  const nomeBase = `contatori-attivita_${contTutti ? 'tutti' : dipFile(dipendente)}_${contDa}_${contA}`;
  $('#ct-csv').addEventListener('click', async () => {
    const { csvContatori } = await import('./presenze-doc.js');
    scaricaFile(new Blob([csvContatori(attivita, { tutti: contTutti })], { type: 'text/csv;charset=utf-8' }), `${nomeBase}.csv`);
  });
  $('#ct-pdf').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Preparo il PDF…');
    try {
      const { pdfContatori } = await import('./presenze-doc.js');
      const byte = await pdfContatori({ chi, da: contDa, a: contA, attivita, tutti: contTutti });
      scaricaFile(new Blob([byte], { type: 'application/pdf' }), `${nomeBase}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    finally { attendi(btn, false); }
  });
}

function scaricaFile(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = nome; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
  const { data: righe, error: errMov } = await q;
  const movimenti = righe || [];

  const { data: aperteTutte, error: errBanca } = await sb.from('s_presenze_extra').select('causale, ore_min, pagato')
    .eq('dipendente', dipendente).eq('chiuso', false);
  /* saldo e movimenti su un elenco non letto sarebbero numeri falsi (26/09/2026) */
  if (errMov || errBanca) {
    host.innerHTML = '<p class="empty">⚠ Non sono riuscito a leggere la banca ore: nessun saldo calcolato. Riprova.</p>';
    return;
  }
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
      ${saldoDi.pagate ? `<span class="dt-cella dt-ok" style="padding:4px 10px">💶 ${mm2hm(saldoDi.pagate)} supplementari da pagare/pagate (ordinario, fuori banca ore)</span>` : ''}
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
          <td>${famigliaCausale(e.causale) === 'dettaglio'
            ? `<span class="hint" title="Dettaglio attività: ore già comprese in quelle lavorate, non si sommano e non toccano la banca ore">📊 dettaglio attività</span>${e.pagato || e.recuperato ? ' <span class="hint">(spunte dallo storico)</span>' : ''}`
            : `${e.chiuso ? '<span class="dt-cella dt-ok" style="padding:1px 6px">chiusa</span>' : '<span class="dt-cella dt-senzadata" style="padding:1px 6px">APERTA</span>'}
            ${/suppl|straord/i.test(e.causale || '')
              ? (e.pagato ? ' <span class="hint">💶 da pagare</span>'
                : e.recuperato ? ` <span class="hint">↩ recuperata${e.recuperato_il ? ' il ' + dataIt(e.recuperato_il) : ''}</span>`
                : ' <span class="hint">⏳ da recuperare</span>')
              : `${e.pagato ? ' 💶' : ''}${e.recuperato ? ` ↩${e.recuperato_il ? ' ' + dataIt(e.recuperato_il) : ''}` : ''}`}`}</td>
          <td class="hint">${esc(e.note || '')}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">Nessun movimento con questo filtro.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">Due binari: la supplementare <strong>da recuperare</strong> va in banca ore, quella
      <strong>da pagare/pagata</strong> sta nel circuito ordinario (busta paga). Il recupero preleva
      dalla banca ore e <strong>non scala i permessi del contratto</strong> (quelli sono la causale
      «Permesso»). Saldo banca ore = supplementari da recuperare − recuperi. Una partita si CHIUDE
      quando è saldata. Storico Access dal 2009 importato.</p>`;

  $('#pz-fb').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroBanca = b.dataset.val; renderBanca(); }
  });
  $('#pz-mov').addEventListener('click', () => formMovimento(null));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => formMovimento(movimenti.find((e) => e.id === Number(tr.dataset.id)))));
}

async function formMovimento(e, causaleProposta) {
  /* tendina VERA delle causali: quelle di base più tutte quelle già usate
     nello storico (i progetti SPISAL/CAM, GSuite, 104/92…), con in fondo
     «Altra causale…» per il testo libero (regola delle maschere: la
     tendina si deve aprire e mostrare le voci, non un datalist muto) */
  const { data: usate } = await sb.from('s_presenze_extra').select('causale').limit(3000);
  const altre = [...new Set((usate || []).map((r) => r.causale).filter(Boolean))]
    .filter((c) => !CAUSALI_BASE.includes(c)).sort((a, b) => a.localeCompare(b));
  const causali = [...CAUSALI_BASE, ...altre];
  const corrente = e?.causale || causaleProposta || 'Ore supplementari';
  const inLista = causali.includes(corrente);
  /* i progetti a cui collegare il dettaglio (02/10/2026): una riga può
     servire a più progetti, e allora le ore si dividono in parti uguali
     (la progettazione CAM 2021-22, metà a ciascun corso CAM) */
  const [{ data: progetti }, { data: collegati }] = await Promise.all([
    sb.from('s_progetti_formativi').select('id, titolo, desc_breve, stato, anno_sanzioni').order('id', { ascending: false }),
    e ? sb.from('s_presenze_extra_progetti').select('progetto_id').eq('extra_id', e.id) : Promise.resolve({ data: [] }),
  ]);
  const scelti = new Set((collegati || []).map((x) => x.progetto_id));
  const nomeProgetto = (x) => `${x.desc_breve || x.titolo}${x.anno_sanzioni ? ` · sanzioni ${x.anno_sanzioni}` : ''}${x.stato === 'chiuso' ? ' · chiuso' : ''}`;

  apriDrawer(e ? `Movimento del ${dataIt(e.data)}` : 'Registra movimento banca ore', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Data *</label><input type="date" id="mv-data" value="${e ? e.data : oggiIso()}"></div>
      <div class="field"><label>Ore (hh:mm) *</label><input id="mv-ore" placeholder="01:30" value="${e ? mm2hm(e.ore_min).padStart(5, '0') : ''}"></div>
    </div>
    <div class="field"><label>Causale *</label>
      <select id="mv-causale-sel">
        ${causali.map((c) => `<option value="${esc(c)}" ${c === corrente ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        <option value="__altra__" ${!inLista ? 'selected' : ''}>Altra causale…</option>
      </select></div>
    <div class="field ${inLista ? 'hidden' : ''}" id="mv-causale-libera-box"><label>Causale (testo libero)</label>
      <input id="mv-causale-libera" value="${inLista ? '' : esc(corrente)}" placeholder="es. Progettazione SPISAL (2027 …)"></div>
    <div class="field"><label>Note</label><input id="mv-note" value="${esc(e?.note || '')}"></div>
    <!-- La SCELTA (concordata col Direttore: si recupera o si paga) e il FATTO (è stata
         recuperata) sono due cose diverse: prima erano tre spunte in fila, e «Recuperata»
         veniva letta come «si recupera» (movimento del 07/09/2026). -->
    <div id="mv-compensa-box" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
      <!-- la SCELTA DEL LAVORATORE, sempre una delle due (utente, 24/09/2026) -->
      <div class="field"><label>Scelta del lavoratore</label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600">
          <input type="radio" name="mv-modo" value="recupero" ${e?.pagato ? '' : 'checked'} style="width:auto;margin:0"> Da recuperare <span class="hint" style="font-weight:400">— alimenta la banca ore</span></label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600;margin-top:3px">
          <input type="radio" name="mv-modo" value="paga" ${e?.pagato ? 'checked' : ''} style="width:auto;margin:0"> Da pagare <span class="hint" style="font-weight:400">— in busta paga</span></label></div>
      <div class="field" id="mv-recu-box"><label style="display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="checkbox" id="mv-recu" ${e?.recuperato ? 'checked' : ''} style="width:auto;margin:0"> Già recuperata il</label>
        <input type="date" id="mv-recdata" value="${e?.recuperato_il || ''}"></div>
    </div>
    <div id="mv-dett-box" class="hint" style="display:none;margin-top:6px;padding:8px 10px;border-left:3px solid var(--arancio, #e7500f);background:rgba(231,80,15,.06)">
      📊 <strong>Dettaglio attività</strong>: dice come sono state spese ore <strong>già comprese</strong> in quelle lavorate
      (riunione, formazione, progetto…). Non si somma, non tocca la banca ore e non va chiusa: serve ai contatori.
      Metti <strong>tutte</strong> le ore spese sull'attività, anche quelle oltre l'orario; quelle in più registrale
      <strong>anche</strong> come «Ore supplementari», che dicono come vengono compensate.
      <div style="margin-top:8px"><strong>Progetto</strong> (facoltativo, per la rendicontazione) — se ne scegli più d'uno le ore si dividono in parti uguali:
        <div id="mv-prog" style="max-height:150px;overflow:auto;margin-top:4px;padding:4px 6px;background:#fff;border:1px solid #e3e3e3;border-radius:4px">
          ${(progetti || []).map((x) => `<label style="display:flex;gap:6px;align-items:flex-start;cursor:pointer;margin:2px 0;color:#333">
            <input type="checkbox" class="mv-prog-c" value="${x.id}" ${scelti.has(x.id) ? 'checked' : ''} style="width:auto;margin:2px 0 0">
            <span>${esc(nomeProgetto(x))}</span></label>`).join('') || '<span class="hint">Nessun progetto in archivio.</span>'}
        </div><span id="mv-prog-quota" class="hint"></span></div></div>
    <label id="mv-chiuso-box" style="display:flex;gap:6px;align-items:center;margin-top:6px;cursor:pointer">
      <input type="checkbox" id="mv-chiuso" ${e?.chiuso ? 'checked' : ''} style="width:auto;margin:0"> Chiusa (partita saldata)</label>
    <p class="hint" style="margin-top:6px"><strong>Da recuperare</strong> = va in banca ore finché non la recuperi;
      <strong>da pagare</strong> = circuito ordinario (busta paga), fuori dalla banca ore. «Già recuperata» si spunta
      solo quando il recupero è avvenuto, con la sua data. Il <strong>Recupero</strong> preleva dalla banca ore e non
      scala i permessi del contratto.</p>
    <div style="display:flex;gap:8px;justify-content:space-between;margin-top:12px">
      <div>${e ? '<button class="btn btn-ghost" id="mv-elimina">🗑 Elimina</button>' : ''}</div>
      <button class="btn btn-primary" id="mv-salva">Salva</button>
    </div>`);

  /* «come si compensa» vale per le ore supplementari; «già recuperata» solo se si recuperano */
  const causaleScelta = () => ($('#mv-causale-sel').value === '__altra__' ? $('#mv-causale-libera').value : $('#mv-causale-sel').value);
  const modoScelto = () => document.querySelector('input[name="mv-modo"]:checked')?.value || 'recupero';
  const aggiornaCompensa = () => {
    const suppl = /suppl|straord/i.test(causaleScelta() || '');
    const dett = !!String(causaleScelta() || '').trim() && famigliaCausale(causaleScelta()) === 'dettaglio';
    $('#mv-dett-box').style.display = dett ? 'block' : 'none';
    $('#mv-chiuso-box').style.display = dett ? 'none' : 'flex';
    $('#mv-compensa-box').style.display = suppl ? 'grid' : 'none';
    $('#mv-recu-box').style.visibility = suppl && modoScelto() === 'recupero' ? 'visible' : 'hidden';
  };
  document.querySelectorAll('input[name="mv-modo"]').forEach((r) => r.addEventListener('change', aggiornaCompensa));
  const progScelti = () => [...document.querySelectorAll('.mv-prog-c:checked')].map((c) => Number(c.value));
  const aggiornaQuota = () => {
    const n = progScelti().length;
    $('#mv-prog-quota').textContent = n > 1 ? `Le ore si dividono in ${n} parti uguali, una per progetto.` : '';
  };
  document.querySelectorAll('.mv-prog-c').forEach((c) => c.addEventListener('change', aggiornaQuota));
  aggiornaQuota();
  /* riga nuova: si propongono i progetti dell'ultima riga con la stessa causale */
  const proponiProgetti = async () => {
    if (e) return;
    const c = String(causaleScelta() || '').trim();
    if (!c || famigliaCausale(c) !== 'dettaglio') return;
    const { data: ultima } = await sb.from('s_presenze_extra').select('id').eq('causale', c).order('data', { ascending: false }).limit(1);
    if (!ultima?.length) return;
    const { data: lk } = await sb.from('s_presenze_extra_progetti').select('progetto_id').eq('extra_id', ultima[0].id);
    const ids = new Set((lk || []).map((x) => x.progetto_id));
    document.querySelectorAll('.mv-prog-c').forEach((cb) => { cb.checked = ids.has(Number(cb.value)); });
    aggiornaQuota();
  };
  proponiProgetti();
  $('#mv-causale-libera').addEventListener('input', aggiornaCompensa);
  $('#mv-recdata').addEventListener('change', () => { if ($('#mv-recdata').value) $('#mv-recu').checked = true; });
  aggiornaCompensa();

  $('#mv-causale-sel').addEventListener('change', () => {
    $('#mv-causale-libera-box').classList.toggle('hidden', $('#mv-causale-sel').value !== '__altra__');
    aggiornaCompensa();
    proponiProgetti();
  });
  $('#mv-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const oreMin = hm2min($('#mv-ore').value.trim());
    const sel = $('#mv-causale-sel').value;
    const causale = (sel === '__altra__' ? $('#mv-causale-libera').value : sel).trim();
    if (!$('#mv-data').value || oreMin == null || !causale) return toast('Servono data, ore (hh:mm) e causale.', 'err');
    const suppl = /suppl|straord/i.test(causale);
    const pagato = suppl ? modoScelto() === 'paga' : !!e?.pagato;
    const recuperato = suppl && !pagato ? $('#mv-recu').checked : !!e?.recuperato && !suppl;
    const recuperatoIl = recuperato ? ($('#mv-recdata').value || null) : (suppl ? null : e?.recuperato_il || null);
    /* «recuperata» è un fatto: senza la data del recupero non si registra */
    if (suppl && recuperato && !recuperatoIl) return toast('Per segnarla «già recuperata» serve la data del recupero. Se è ancora da recuperare, togli la spunta.', 'err');
    attendi(btn, true);
    const dati = {
      /* la riga resta della persona di cui è: dai contatori con «tutti i
         dipendenti» si apre anche quella di un altro (02/10/2026) */
      dipendente: e?.dipendente || dipendente, data: $('#mv-data').value, causale, ore_min: oreMin,
      note: $('#mv-note').value.trim() || null,
      /* il dettaglio non ha partite aperte: si salva sempre chiuso, così non
         compare mai fra i «conteggi aperti» della banca ore */
      pagato, recuperato, chiuso: famigliaCausale(causale) === 'dettaglio' ? true : $('#mv-chiuso').checked,
      recuperato_il: recuperatoIl,
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    };
    const { data: salvata, error } = e
      ? await sb.from('s_presenze_extra').update(dati).eq('id', e.id).select('id').single()
      : await sb.from('s_presenze_extra').insert(dati).select('id').single();
    if (error) { attendi(btn, false); return toast('Salvataggio non riuscito: ' + error.message, 'err'); }
    /* collegamenti ai progetti: si riscrivono interi; fuori dal dettaglio non ce ne sono */
    const ids = famigliaCausale(causale) === 'dettaglio' ? progScelti() : [];
    const { error: errDel } = await sb.from('s_presenze_extra_progetti').delete().eq('extra_id', salvata.id);
    let errLink = errDel;
    if (!errDel && ids.length) {
      const quota = Math.floor(10000 / ids.length) / 10000;
      ({ error: errLink } = await sb.from('s_presenze_extra_progetti')
        .insert(ids.map((progetto_id) => ({ extra_id: salvata.id, progetto_id, quota, creato_da: state.email }))));
    }
    attendi(btn, false);
    if (errLink) return toast('Movimento salvato, ma il collegamento ai progetti non è riuscito: riaprilo e risalva. ' + errLink.message, 'err');
    toast('Movimento registrato.', 'ok');
    chiudiDrawer();
    (tab === 'contatori' ? renderContatori : renderBanca)();
  });
  $('#mv-elimina')?.addEventListener('click', async () => {
    if (!confirm('Elimino questo movimento?')) return;
    const { error } = await sb.from('s_presenze_extra').delete().eq('id', e.id);
    if (error) return toast(error.message, 'err');
    toast('Movimento eliminato.', 'ok');
    chiudiDrawer();
    (tab === 'contatori' ? renderContatori : renderBanca)();
  });
}

/* ══════════ scheda FERIE E PERMESSI ══════════ */

let richieste = [];

async function renderFerie(hostArg) {
  const host = hostArg || $('#pz-corpo');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const { data, error: errFer } = await sb.from('s_ferie_richieste').select('*').order('id', { ascending: false });
  if (errFer) { host.innerHTML = '<p class="empty">⚠ Non sono riuscito a leggere le richieste di ferie e permessi. Riprova.</p>'; return; }
  richieste = data || [];
  const lista = (filtroFerie === 'aperte')
    ? richieste.filter((r) => ['da_richiedere', 'richiesta'].includes(r.aut_stato))
    : richieste;

  /* Ore sindacali consumate nell'anno in corso dal dipendente selezionato, sui
     DUE monti separati: permessi RSU e permessi sindacali. Si contano dalle
     righe VERE di banca ore, non dalle richieste: una richiesta approvata ma
     non ancora generata non ha scalato niente. ⚠️ Non c'è un tetto annuo perché
     i monti contrattuali non sono agli atti: si mostra il consumato, non il
     residuo (vedi scadenze_ufficio). */
  const annoOra = new Date().getFullYear();
  const tutteSindacali = MONTI_SINDACALI.flatMap(causaliDelMonte);
  const { data: righeSind, error: errSind } = await sb.from('s_presenze_extra')
    .select('data, causale, ore_min')
    .eq('dipendente', dipendente)
    .in('causale', tutteSindacali)
    .gte('data', `${annoOra}-01-01`).lte('data', `${annoOra}-12-31`);
  if (errSind) toast("Non sono riuscito a leggere le ore sindacali usate nell'anno: il riepilogo non compare.", 'err');
  const perMonte = MONTI_SINDACALI.map((m) => {
    const cs = causaliDelMonte(m);
    const righe = (righeSind || []).filter((x) => cs.includes(x.causale));
    const dettaglio = {};
    for (const x of righe) dettaglio[x.causale] = (dettaglio[x.causale] || 0) + (x.ore_min || 0);
    return { monte: m, tot: righe.reduce((s, x) => s + (x.ore_min || 0), 0), dettaglio };
  }).filter((x) => x.tot > 0);

  /* i SALDI (02/10/2026): solo per la segreteria — il Direttore qui vede le
     richieste da autorizzare, e le tabelle delle presenze non le legge */
  const saldi = state.soloDirettore ? '' : await riquadroSaldi(annoOra);

  host.innerHTML = `
    ${saldi}
    ${perMonte.length ? `<div class="dt-quadro" style="margin-bottom:10px">
      ${perMonte.map((x) => `<div class="dt-quadro-riga">
        <span class="dt-quadro-req">${esc(etichettaMonte(x.monte))} usati nel ${annoOra}</span>
        <span class="dt-cella"><strong>${mm2hm(x.tot)}</strong></span></div>
        ${Object.keys(x.dettaglio).length > 1 ? `<p class="hint" style="margin:2px 0 6px">${
          Object.entries(x.dettaglio).map(([c, m]) => `${esc(c)}: ${mm2hm(m)}`).join(' · ')}</p>` : ''}`).join('')}
      <p class="hint" style="margin:4px 0 0">Ore di ${esc(dipendente)}, contate dalle righe di banca ore.
        I <strong>permessi RSU</strong> e i <strong>permessi sindacali</strong> sono due monti distinti, e
        nessuno dei due scala i permessi retribuiti del contratto.</p>
      ${conf.presenze_rsu_ore_mensili_indicative ? `<p class="hint" style="margin:4px 0 0">
        <strong>Riferimento indicativo</strong>: circa ${esc(conf.presenze_rsu_ore_mensili_indicative)} ore al mese
        per i permessi RSU — ${mesiTrascorsi(annoOra)} mes${mesiTrascorsi(annoOra) === 1 ? 'e' : 'i'} dell'anno
        farebbero <strong>~${mm2hm(Number(conf.presenze_rsu_ore_mensili_indicative) * 60 * mesiTrascorsi(annoOra))}</strong>.
        ⚠️ <strong>Non è un tetto</strong>: le ore possono essere aumentate e si possono usare quelle non
        utilizzate dagli altri RSU — il monte è del gruppo, non della persona. Per questo qui non compare
        nessun «residuo»: sarebbe un numero falso.</p>` : ''}
    </div>` : ''}
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
            <td>${esc(etichettaTipo(r.tipo))}${eSuppl(r) && r.compenso ? `<span class="cell-sub">${r.compenso === 'paga' ? '💶 da pagare' : '⏳ da recuperare'}</span>` : ''}</td>
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
  $('#fe-spettanze')?.addEventListener('click', () => formSpettanze(annoOra));
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriRichiesta(Number(tr.dataset.id))));
}

/* ══════════ SALDI di banca ore, ferie e permessi ══════════
   Chiesto dall'utente il 02/10/2026: «avere un'idea del saldo banca ore,
   quello di ferie permessi». La banca ore si calcola come nella sua scheda;
   per ferie e permessi le ore spettanti si scrivono dalla busta paga
   (s_presenze_spettanze), il goduto si conta dalle righe vere. */
async function riquadroSaldi(anno) {
  let spettanze; let righe; let aperte; let inArrivo; let orari;
  try {
    const [r1, r3, r4, r5] = await Promise.all([
      sb.from('s_presenze_spettanze').select('*').eq('dipendente', dipendente),
      sb.from('s_presenze_extra').select('causale, ore_min, pagato').eq('dipendente', dipendente).eq('chiuso', false),
      sb.from('s_ferie_richieste').select('tipo, monte, ore, data_inizio, righe_generate, aut_stato')
        .eq('dipendente', dipendente).eq('aut_stato', 'approvata').gte('data_inizio', `${anno}-01-01`).lte('data_inizio', `${anno}-12-31`),
      sb.from('s_presenze_orari').select('*').eq('dipendente', dipendente),
    ]);
    for (const r of [r1, r3, r4, r5]) if (r.error) throw r.error;
    spettanze = r1.data || [];
    aperte = r3.data || [];
    inArrivo = (r4.data || []).filter((r) => !r.righe_generate);
    orari = r5.data || [];
    righe = await leggiTutte(() => sb.from('s_presenze_extra').select('data, causale, ore_min')
      .eq('dipendente', dipendente).in('causale', CAUSALI_SALDO).order('id'));
  } catch {
    return '<p class="empty" style="margin-bottom:10px">⚠ Non sono riuscito a leggere i saldi: nessun numero calcolato. Riprova.</p>';
  }
  /* VARIANTE B «Tessere in giorni», scelta dall'utente il 02/10/2026 fra quattro
     (proposte_grafiche/2026_10_02_saldi-presenze): una tessera per monte, il
     numero grande IN GIORNI a oggi, le ore sotto in centesimi come in busta,
     una barra goduto/disponibile, il dettaglio dei conti e la fine anno in
     fondo. Totale scuro, banca ore a parte. Il «come si calcola» si apre a richiesta. */
  const banca = calcolaBanca(aperte);
  const orario = orarioValido(orari, oggiIso());
  const misura = misuraOrario(orario);
  /* maturato a MESI CONCLUSI, come la busta: a ottobre ne sono maturati nove */
  const oggi = new Date();
  const mesiConclusi = anno < oggi.getFullYear() ? 12 : anno > oggi.getFullYear() ? 0 : oggi.getMonth();
  /* richieste approvate e non ancora registrate: il «permesso» va sulle ex festività, come in busta */
  const monteRichiesta = { ferie: 'ferie', permessi: 'ex_festivita' };
  const cent = (min) => oreCentesimi(min);
  const pct = (x, tot) => (tot > 0 ? Math.max(0, Math.min(100, (x / tot) * 100)) : 0);
  /* numero grande: giorni se c'è l'orario, altrimenti ore in centesimi */
  const grande = (min, classe = '') => {
    const g = giorniNumero(min, orario);
    return g ? `<div class="sal-big ${classe}">${g}<small>${g === '1' ? 'giorno' : 'giorni'}</small></div>`
      : `<div class="sal-big ${classe}">${cent(min)}<small>ore</small></div>`;
  };
  const brevi = (min) => { const g = giorniNumero(min, orario); return g ? `${g} g · ${cent(min)} h` : `${cent(min)} h`; };

  const monti = MONTI_SALDO.map((x) => {
    const sp = spettanze.filter((y) => y.monte === x.monte);
    const s = saldoMonte(anno, sp, godutoPerAnno(righe, x.monte));
    const maturate = s.spettanza == null ? 0 : s.spettanza * mesiConclusi / 12;
    const aOggi = s.spettanza == null ? null : (s.residuoIniziale ?? 0) + maturate - s.goduto;
    const attesa = inArrivo.filter((r) => monteRichiesta[r.monte] === x.monte).reduce((t, r) => t + Math.round(Number(r.ore || 0) * 60), 0);
    return { ...x, s, maturate, aOggi, attesa };
  }).filter((x) => x.s.spettanza != null || x.s.goduto || x.monte !== 'rol');   /* ROL/PAR vuoto: niente tessera */

  const tessera = (x) => {
    const { s } = x;
    if (s.spettanza == null) {
      return `<div class="sal-tes"><h4>${esc(x.nome)}</h4>
        <div class="sal-big sal-vuoto">—</div>
        <div class="sal-ore">saldo non calcolabile: manca la spettanza ${anno}</div>
        <div class="sal-dett"><span>godute nel ${anno}</span><span class="num">${cent(s.goduto)}</span></div>
        <div class="sal-fine">scrivila con «✏ Spettanze»</div></div>`;
    }
    const totBarra = s.goduto + Math.max(0, x.aOggi);
    return `<div class="sal-tes"><h4>${esc(x.nome)} · a oggi</h4>
      ${grande(x.aOggi, x.aOggi < 0 ? 'sal-neg' : '')}
      <div class="sal-ore">${cent(x.aOggi)} h</div>
      <div class="sal-barra" title="godute ${cent(s.goduto)} h, disponibili a oggi ${cent(x.aOggi)} h">
        <i class="sal-god" style="width:${pct(s.goduto, totBarra)}%"></i><i class="sal-disp" style="width:${pct(Math.max(0, x.aOggi), totBarra)}%"></i></div>
      <div class="sal-dett">
        <span>residuo 1° gennaio${s.residuoDa === 'anno-prima' ? ' (dal saldo ' + (anno - 1) + ')' : ''}</span><span class="num">${s.residuoIniziale == null ? '—' : cent(s.residuoIniziale)}</span>
        <span>maturate (${mesiConclusi} mes${mesiConclusi === 1 ? 'e' : 'i'})</span><span class="num">${cent(x.maturate)}</span>
        <span>godute <span class="sal-cau">${x.causali.map((c) => `«${esc(c)}»`).join(' + ')}</span></span><span class="num">−${cent(s.goduto)}</span>
        ${x.attesa ? `<span>approvate, da registrare</span><span class="num">−${cent(x.attesa)}</span>` : ''}
      </div>
      <div class="sal-fine">a fine anno <b>${brevi(s.saldo)}</b></div></div>`;
  };

  const conSaldo = monti.filter((x) => x.s.spettanza != null);
  const totale = totaleSaldi(monti.map((x) => ({ nome: x.nome, saldo: x.s })), mesiConclusi);
  const colori = { ferie: 'sal-c-ferie', ex_festivita: 'sal-c-ex', rol: 'sal-c-rol' };
  const totOggi = totale ? (totale.aOggi ?? totale.saldo) : 0;
  const tessTot = totale && totale.nomi.length >= 2 ? `<div class="sal-tes sal-tot"><h4>Totale · a oggi</h4>
      ${grande(totOggi)}
      <div class="sal-ore">${cent(totOggi)} h${settimaneGiorni(totOggi, orario) ? ` · ${settimaneGiorni(totOggi, orario)}` : ''}</div>
      <div class="sal-barra" title="${esc(conSaldo.map((x) => `${x.nome} ${cent(x.aOggi)} h`).join(', '))}">
        ${conSaldo.map((x) => `<i class="${colori[x.monte]}" style="width:${pct(Math.max(0, x.aOggi), conSaldo.reduce((t, y) => t + Math.max(0, y.aOggi), 0))}%"></i>`).join('')}</div>
      <div class="sal-dett">${conSaldo.map((x) => `<span><i class="sal-pall ${colori[x.monte]}"></i>${esc(x.nome)}</span><span class="num">${giorniNumero(x.aOggi, orario) ? giorniNumero(x.aOggi, orario) + ' g' : cent(x.aOggi) + ' h'}</span>`).join('')}
        ${totale.senza.length ? `<span>esclus${totale.senza.length === 1 ? 'o' : 'i'}: ${esc(totale.senza.join(', '))}</span><span class="num">manca spettanza</span>` : ''}</div>
      <div class="sal-fine">a fine anno <b>${brevi(totale.saldo)}</b></div></div>` : '';

  const tessBanca = `<div class="sal-tes"><h4>Banca ore</h4>
      <div class="sal-big ${banca.saldo > 0 ? 'sal-ambra' : ''}">${mm2hm(banca.saldo)}<small>ore</small></div>
      <div class="sal-ore">${giorniNumero(banca.saldo, orario) && Math.round(banca.saldo) ? `≈ ${giorniNumero(banca.saldo, orario)} giorni` : '&nbsp;'}</div>
      <div class="sal-dett">
        <span>supplementari da recuperare</span><span class="num">${mm2hm(banca.supplementari)}</span>
        <span>recuperi</span><span class="num">−${mm2hm(banca.recuperi)}</span>
        ${banca.pagate ? `<span>supplementari da pagare</span><span class="num">${mm2hm(banca.pagate)}</span>` : ''}
      </div>
      <div class="sal-fine sal-tenue">fuori dal totale: sono ore da recuperare</div></div>`;

  const fonti = [...new Set(conSaldo.map((x) => x.s.fonte).filter(Boolean))];
  return `<div class="sal-tessere">${monti.map(tessera).join('')}${tessTot}${tessBanca}</div>
    <div class="sal-piede">
      <details class="sal-come"><summary>Come si calcola</summary>
        <p>Saldi di ${esc(dipendente)} nel ${anno}, con i monti del riquadro «Riposi» della busta paga.
          <strong>A oggi</strong> = residuo al 1° gennaio + maturato a dodicesimi dei mesi conclusi − godute;
          <strong>a fine anno</strong> = residuo + spettanza intera − godute.
          Le ore sono in <strong>centesimi</strong>, come sul cedolino.
          ${misura ? `I giorni si contano sul suo orario (${GIORNI_ORARIO.filter((g) => Number(orario[`${g}_min`]) > 0).map((g) => `${g} ${mm2hm(Number(orario[`${g}_min`]))}`).join(', ')}): un giorno vale in media ${mm2hm(misura.media)} h.` : ''}
          Le spettanze si scrivono dalla busta paga: l'app non le ricava dal contratto. Il goduto si conta dalle righe registrate qui, che possono
          differire dalla busta di qualche ora (un permesso di fine mese passa sul cedolino dopo). La banca ore resta fuori dal totale.
          ${fonti.length ? `Fonte: ${esc(fonti.join(' · '))}.` : ''}</p>
      </details>
      ${misura ? '' : '<span class="sal-avviso">Per vedere i saldi in giorni scrivi l\'orario della settimana in «✏ Spettanze».</span>'}
      <button class="btn btn-ghost btn-sm" id="fe-spettanze">✏ Spettanze</button>
    </div>`;
}

async function formSpettanze(annoIniz) {
  const [{ data: tutte, error }, { data: orari, error: errO }] = await Promise.all([
    sb.from('s_presenze_spettanze').select('*').eq('dipendente', dipendente).order('anno', { ascending: false }),
    sb.from('s_presenze_orari').select('*').eq('dipendente', dipendente).order('dal', { ascending: false }),
  ]);
  if (error || errO) return toast('Non sono riuscito a leggere spettanze e orario già scritti. Riprova.', 'err');
  const orarioOra = orarioValido(orari, oggiIso());
  const orarioVal = (g) => (orarioOra && Number(orarioOra[`${g}_min`]) ? mm2hm(Number(orarioOra[`${g}_min`])) : '');
  const di = (anno, monte) => (tutte || []).find((x) => x.anno === anno && x.monte === monte);
  const cent = (m) => (m == null ? '' : oreCentesimi(m));
  const nomeMonte = (m) => MONTI_SALDO.find((x) => x.monte === m)?.nome || m;
  const campi = (anno) => MONTI_SALDO.map(({ monte, nome }) => {
    const r = di(anno, monte);
    return `<fieldset style="border:1px solid #e3e3e3;border-radius:6px;padding:8px 10px;margin:8px 0">
      <legend><strong>${nome}</strong></legend>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field"><label>Ore spettanti nell'anno</label><input id="sp-${monte}-sp" placeholder="es. 159,96" value="${cent(r?.spettanza_min)}"></div>
        <div class="field"><label>Residuo al 1° gennaio (RESIDUO A.P.)</label><input id="sp-${monte}-res" placeholder="vuoto = saldo dell'anno prima" value="${cent(r?.residuo_iniziale_min)}"></div>
      </div></fieldset>`;
  }).join('');
  apriDrawer(`Spettanze — ${dipendente}`, '', `
    <div class="field"><label>Anno *</label><input type="number" id="sp-anno" min="2009" max="2100" value="${annoIniz}" style="max-width:120px"></div>
    <div id="sp-campi">${campi(annoIniz)}</div>
    <div class="field"><label>Fonte</label><input id="sp-fonte" placeholder="es. busta paga di agosto ${annoIniz}" value="${esc(MONTI_SALDO.map((m) => di(annoIniz, m.monte)?.fonte).find(Boolean) || '')}"></div>
    <p class="hint">Si copiano dal riquadro <strong>«Riposi»</strong> della busta paga, in <strong>ore e centesimi</strong> come
      sono scritte lì: «152,58» (o «152.58») sono 152 ore e 58 centesimi. Per ore e minuti usa i due punti («8:30»).
      <strong>Residuo al 1° gennaio</strong> = «RESIDUO A.P.». <strong>Ore spettanti nell'anno</strong>: la busta mostra il
      «MATURATO A.C.» fino a quel mese — per l'anno intero si divide per i mesi e si moltiplica per 12 (agosto: × 12 ÷ 8).
      Il residuo lascialo vuoto se vuoi che l'app riporti il saldo dell'anno prima. Si salvano solo i monti compilati.</p>
    <fieldset style="border:1px solid #e3e3e3;border-radius:6px;padding:8px 10px;margin:8px 0">
      <legend><strong>Orario della settimana</strong> — serve a dire le ore anche in giorni</legend>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${GIORNI_ORARIO.map((g) => `<div class="field"><label>${g}</label><input id="sp-or-${g}" placeholder="0" value="${orarioVal(g)}"></div>`).join('')}
      </div>
      <div class="field" style="max-width:200px"><label>Vale dal</label><input type="date" id="sp-or-dal" value="${orarioOra?.dal || oggiIso()}"></div>
      <p class="hint" style="margin:4px 0 0">Ore di ogni giorno, per esempio 8 o 7:30; vuoto = giorno di riposo. Se l'orario cambia,
        cambia la data «vale dal»: l'orario di prima resta per il passato.</p>
    </fieldset>
    <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="sp-salva">Salva</button></div>
    ${(tutte || []).length ? `<h4 style="margin:14px 0 4px">Già scritte</h4><table class="tbl"><tbody>${(tutte || []).map((x) => `<tr>
      <td>${x.anno}</td><td>${esc(nomeMonte(x.monte))}</td><td>${oreCentesimi(x.spettanza_min)}</td>
      <td class="hint">${x.residuo_iniziale_min == null ? 'residuo riportato' : 'residuo ' + oreCentesimi(x.residuo_iniziale_min)}${x.fonte ? ' · ' + esc(x.fonte) : ''}</td></tr>`).join('')}</tbody></table>` : ''}`);
  $('#sp-anno').addEventListener('change', (e) => { const a = Number(e.target.value); if (a) $('#sp-campi').innerHTML = campi(a); });
  $('#sp-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const anno = Number($('#sp-anno').value);
    if (!anno || anno < 2009 || anno > 2100) return toast("Serve l'anno.", 'err');
    const righe = [];
    for (const { monte } of MONTI_SALDO) {
      const sp = oreInMinuti($(`#sp-${monte}-sp`).value, { centesimi: true });
      const res = oreInMinuti($(`#sp-${monte}-res`).value, { centesimi: true });
      if (Number.isNaN(sp) || Number.isNaN(res)) return toast('Ore non valide: scrivile come sulla busta paga, per esempio 152,58.', 'err');
      if (sp == null) { if (res != null) return toast("Il residuo da solo non basta: serve anche la spettanza dell'anno.", 'err'); continue; }
      righe.push({ dipendente, anno, monte, spettanza_min: sp, residuo_iniziale_min: res,
        fonte: $('#sp-fonte').value.trim() || null, aggiornato_da: state.email, updated_at: new Date().toISOString() });
    }
    /* orario: si salva se è stato scritto almeno un giorno */
    const orarioNuovo = { dipendente, dal: $('#sp-or-dal').value || oggiIso(), aggiornato_da: state.email, updated_at: new Date().toISOString() };
    let unGiorno = false;
    for (const g of GIORNI_ORARIO) {
      const v = oreInMinuti($(`#sp-or-${g}`).value);
      if (Number.isNaN(v) || (v != null && (v < 0 || v > 1440))) return toast(`Orario di ${g} non valido: scrivi per esempio 8 o 7:30.`, 'err');
      orarioNuovo[`${g}_min`] = v || 0;
      if (v) unGiorno = true;
    }
    if (!righe.length && !unGiorno) return toast("Non c'è niente da salvare: compila le ore spettanti di un monte o l'orario.", 'err');
    attendi(btn, true);
    const { error: errS } = righe.length
      ? await sb.from('s_presenze_spettanze').upsert(righe, { onConflict: 'dipendente,anno,monte' }) : { error: null };
    const { error: errOr } = !errS && unGiorno
      ? await sb.from('s_presenze_orari').upsert(orarioNuovo, { onConflict: 'dipendente,dal' }) : { error: null };
    attendi(btn, false);
    if (errS || errOr) return toast('Salvataggio non riuscito: ' + (errS || errOr).message, 'err');
    toast('Spettanze salvate.', 'ok');
    chiudiDrawer();
    renderFerie();
  });
}

function formRichiesta() {
  apriDrawer('Nuova richiesta ferie / permesso / recupero / ore supplementari', '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Dipendente</label>
        <select id="fr-dip">${dipendenti.map((d) => `<option ${d === dipendente ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
      <div class="field"><label>Tipo *</label>
        <select id="fr-tipo">${TIPI_RICHIESTA.map((t) => `<option value="${t.tipo}">${esc(t.etichetta)}</option>`).join('')}</select></div>
      <div class="field"><label>Data inizio *</label><input type="date" id="fr-da" value="${oggiIso()}"></div>
      <div class="field"><label>Data fine</label><input type="date" id="fr-a"></div>
      <div class="field"><label>Dalle ore</label><input type="time" id="fr-dalle"></div>
      <div class="field"><label>Alle ore</label><input type="time" id="fr-alle"></div>
      <div class="field"><label>Totale ore</label><input type="number" step="0.5" id="fr-ore" placeholder="es. 8"></div>
      <div class="field" id="fr-monte-box"><label>Monte ore</label>
        <select id="fr-monte">${MONTI.map((m) => `<option value="${m.monte}">${esc(m.etichetta)}</option>`).join('')}</select></div>
    </div>
    <div class="field hidden" id="fr-compenso-box" style="margin-top:8px"><label>Scelta del lavoratore *</label>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600">
        <input type="radio" name="fr-compenso" value="recupero" style="width:auto;margin:0"> Da recuperare <span class="hint" style="font-weight:400">— alimenta la banca ore</span></label>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:600;margin-top:3px">
        <input type="radio" name="fr-compenso" value="paga" style="width:auto;margin:0"> Da pagare <span class="hint" style="font-weight:400">— in busta paga</span></label></div>
    <div class="field" style="margin-top:8px"><label>Note (facoltative)</label><input id="fr-motivo"></div>
    <button class="btn btn-primary" id="fr-crea" style="margin-top:10px">Crea la richiesta</button>`);

  $('#fr-tipo').addEventListener('change', () => {
    /* ogni tipo ha il suo monte: il recupero attinge alla BANCA ORE e le due voci
       sindacali al monte RSU, mai ai permessi retribuiti del contratto. Resta
       modificabile a mano per i casi che non rientrano. */
    const suppl = $('#fr-tipo').value === 'supplementari';
    if (!suppl) $('#fr-monte').value = tipoRic($('#fr-tipo').value).monte;
    $('#fr-monte-box').classList.toggle('hidden', suppl);
    $('#fr-compenso-box').classList.toggle('hidden', !suppl);
  });
  /* dalle/alle → totale ore, se il totale non è stato scritto a mano */
  const calcolaOre = () => {
    const a = hm2min($('#fr-dalle').value); const b = hm2min($('#fr-alle').value);
    if (a != null && b != null && b > a && !$('#fr-ore').dataset.mano) $('#fr-ore').value = String(Math.round((b - a) / 30) / 2);
  };
  $('#fr-dalle').addEventListener('change', calcolaOre);
  $('#fr-alle').addEventListener('change', calcolaOre);
  $('#fr-ore').addEventListener('input', () => { $('#fr-ore').dataset.mano = '1'; });
  $('#fr-crea').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!$('#fr-da').value) return toast('Serve la data di inizio.', 'err');
    const suppl = $('#fr-tipo').value === 'supplementari';
    const compenso = document.querySelector('input[name="fr-compenso"]:checked')?.value || null;
    if (suppl && !compenso) return toast('Scegli se le ore saranno da recuperare o da pagare: è la scelta che va al Direttore.', 'err');
    if (suppl && !$('#fr-ore').value) return toast('Scrivi quante ore (o dalle/alle).', 'err');
    attendi(btn, true);
    const { data: nuova, error } = await sb.from('s_ferie_richieste').insert({
      dipendente: $('#fr-dip').value,
      tipo: $('#fr-tipo').value,
      data_inizio: $('#fr-da').value,
      data_fine: $('#fr-a').value || null,
      ora_dalle: $('#fr-dalle').value || null,
      ora_alle: $('#fr-alle').value || null,
      ore: $('#fr-ore').value ? Number($('#fr-ore').value) : null,
      monte: suppl ? (compenso === 'recupero' ? 'banca_ore' : null) : $('#fr-monte').value,
      compenso: suppl ? compenso : null,
      motivo: $('#fr-motivo').value.trim() || null,
      aggiornato_da: state.email,
    }).select('*').single();
    attendi(btn, false);
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

  apriDrawer(`Richiesta n° ${r.id} — ${etichettaTipo(r.tipo)} — ${r.dipendente}`, '', `
    <div class="dt-quadro-riga">
      <span class="dt-dot ${cA}"></span>
      <span class="dt-quadro-req">Nulla osta Direttore</span>
      <span class="dt-quadro-stato">${esc(lA)}${r.autorizzata_da ? ` — ${esc(r.autorizzata_da)}${r.data_autorizzazione ? ` il ${dataIt(r.data_autorizzazione)}` : ''}` : ''}
        ${r.aut_drive_url ? ` · <a href="${esc(r.aut_drive_url)}" target="_blank" rel="noopener">modulo</a>` : ''}</span>
    </div>
    <div class="dt-doc-riga"><strong>Periodo:</strong> ${dataIt(r.data_inizio)}${r.data_fine && r.data_fine !== r.data_inizio ? ' → ' + dataIt(r.data_fine) : ''}
      ${r.ora_dalle ? ` — dalle ${hm(r.ora_dalle)} alle ${hm(r.ora_alle)}` : ''}</div>
    <div class="dt-doc-riga"><strong>Ore richieste:</strong> ${r.ore ?? '—'} — ${eSuppl(r)
      ? `scelta del lavoratore: <strong>${esc(COMPENSO[r.compenso] || 'non indicata')}</strong>`
      : `scalate da: <strong>${esc(etichettaMonte(r.monte))}</strong>`}</div>
    ${r.motivo ? `<div class="dt-doc-riga"><strong>Note:</strong> ${esc(r.motivo)}</div>` : ''}
    ${r.aut_note ? `<div class="dt-doc-riga"><strong>Note del Direttore:</strong> ${esc(r.aut_note)}</div>` : ''}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${decisa ? `
      ${r.aut_stato === 'approvata' && !r.righe_generate && !state.soloDirettore ? `
      ${eSuppl(r) ? `<p class="hint" style="margin:0 0 8px">Richiesta approvata: registro il movimento di ore
        supplementari in banca ore, ${esc(COMPENSO[r.compenso] || '')}. Le ore fatte davvero si segnano come sempre
        nel foglio del mese, con gli orari.</p>
      <button class="btn btn-primary" id="fe-genera">⏱ Registra in banca ore</button>` : `<p class="hint" style="margin:0 0 8px">Richiesta approvata: posso creare le righe dei giorni
        (presenze con la nota e movimenti in banca ore), da correggere poi se serve.</p>
      <button class="btn btn-primary" id="fe-genera">📅 Genera le righe dei giorni</button>`}` :
      r.righe_generate ? `<p class="hint">${eSuppl(r) ? 'Movimento già registrato in banca ore.' : 'Righe di presenza e banca ore già generate.'}</p>` : ''}` : `
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
    const btn = ev.currentTarget;
    attendi(btn, true);
    try {
      const { pdfRichiestaFerie } = await import('./presenze-doc.js');
      const byte = await pdfRichiestaFerie(r, null, null);
      const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = nomeRichiesta(r, false); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
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
      oggetto: `Formedil Padova - Richiesta ${etichettaTipo(r.tipo).toLowerCase()} - ${r.dipendente} - n. ${r.id}`,
      corpo: `Egr. Direttore,

in allegato la richiesta di ${etichettaTipo(r.tipo).toLowerCase()} n. ${r.id} di ${r.dipendente}:
${eSuppl(r) ? 'il giorno' : 'periodo'} ${dataIt(r.data_inizio)}${r.data_fine ? ` → ${dataIt(r.data_fine)}` : ''}${r.ora_dalle ? ` dalle ${hm(r.ora_dalle)} alle ${hm(r.ora_alle)}` : ''}${r.ore != null ? `, ${r.ore} ore` : ''}.${eSuppl(r) ? `
Scelta del lavoratore: ${COMPENSO[r.compenso] || 'non indicata'}.` : ''}

>>> Autorizza dall'app (si apre direttamente la pratica):
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
    const btn = ev.currentTarget;
    attendi(btn, true);
    const { error } = await sb.from('s_ferie_richieste').update({
      aut_stato: $('#ec-esito').value, aut_modalita: 'cartacea',
      autorizzata_da: $('#ec-chi').value.trim() || conf.direttore_nome || 'Il Direttore',
      data_autorizzazione: $('#ec-data').value || oggiIso(),
      aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    attendi(btn, false);
    if (error) return toast(error.message, 'err');
    toast('Esito registrato.', 'ok');
    await renderFerie();
    apriRichiesta(r.id);
  });
}

/* a richiesta approvata: righe di presenza (nota) + banca ore per i giorni feriali */
async function generaRighe(r, btn) {
  if (eSuppl(r)) return registraSupplementari(r, btn);
  const giorni = [];
  const fine = r.data_fine || r.data_inizio;
  for (let d = new Date(r.data_inizio + 'T12:00'); d.toISOString().slice(0, 10) <= fine; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) giorni.push(d.toISOString().slice(0, 10));
  }
  if (!giorni.length) return toast('Nessun giorno feriale nel periodo.', 'err');
  /* la causale scritta in banca ore è quella del tipo, identica ai valori che
     l'ufficio usa da sempre: è il testo su cui si contano i monti (RSU compreso) */
  const causale = tipoRic(r.tipo).causale;
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

/* ore supplementari approvate: UN movimento in banca ore, con la scelta del lavoratore.
   Nessuna riga nel foglio presenze: le ore fatte si segnano con gli orari veri. */
async function registraSupplementari(r, btn) {
  const oreMin = r.ore != null ? Math.round(Number(r.ore) * 60) : null;
  if (!oreMin) return toast('La richiesta non ha il totale ore: correggila prima di registrare.', 'err');
  if (!r.compenso) return toast('La richiesta non dice se le ore sono da recuperare o da pagare.', 'err');
  if (!confirm(`Registro ${mm2hm(oreMin)} di ore supplementari del ${dataIt(r.data_inizio)}, ${COMPENSO[r.compenso]}?`)) return;
  attendi(btn, true, 'Registro…');
  try {
    const { error } = await sb.from('s_presenze_extra').insert({
      dipendente: r.dipendente, data: r.data_inizio, causale: 'Ore supplementari', ore_min: oreMin,
      pagato: r.compenso === 'paga', recuperato: false, chiuso: false,
      note: `Richiesta n° ${r.id}, nulla osta ${r.aut_modalita === 'cartacea' ? 'cartaceo' : 'dall\'app'}${r.motivo ? ' — ' + r.motivo : ''}`,
      aggiornato_da: state.email,
    });
    if (error) throw new Error(error.message);
    await sb.from('s_ferie_richieste').update({
      righe_generate: true, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', r.id);
    toast(`Ore supplementari registrate in banca ore (${r.compenso === 'paga' ? 'da pagare' : 'da recuperare'}).`, 'ok');
    chiudiDrawer();
    await renderFerie();
  } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
}

/* dal cruscotto / dal link profondo #ferie-<id> */
export const apriPratica = apriRichiesta;
