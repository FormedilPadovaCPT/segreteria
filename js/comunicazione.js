/* ============================================================
   «Comunicazione» — la coda della REDAZIONE AUTOMATICA social
   dell'Area Sicurezza e Salute (06/09/2026).

   Ogni lunedì una routine cloud legge la materia prima che l'ufficio
   produce già (aggregati delle visite, circolari protocollate, corsi,
   campagne, rassegna esterna) e scrive le bozze dei post in s_post,
   passando dalla funzione redazione-social. Qui la segreteria le
   rilegge, le ritocca, le approva o le scarta con un motivo (che la
   routine rilegge al giro dopo, per rieducarsi).

   Il confine è quello del timbro e della posta: l'AI prepara, la
   persona decide che cosa esce. Telegram e app servizi si pubblicano
   da qui col bot; LinkedIn/Instagram/Facebook li pubblica l'agenzia,
   a cui parte un kit in bozza .eml — l'invio resta a una persona.

   Regole fisse (stanno anche nel prompt della routine):
   - mai nomi di imprese, cantieri, persone; mai foto riconoscibili;
   - solo aggregati, sempre col perimetro dichiarato;
   - ogni affermazione normativa cita la norma;
   - i contenuti tecnici sul merito della sicurezza li valida il
     coordinatore (regola d'oro 1), non solo la segreteria.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { scaricaEml } from './eml.js';
import { postInTelegramHtml, postInHtmlNotizia, postInTestoSemplice, postPerIncollaTelegram, lunghezzaVisibile, SEGNI_AMMESSI } from './post-formato.js';

let post = [];
let filtro = 'bozza';
let linee = '';

const PILASTRI = {
  cantiere: ['🏗️', 'Dal cantiere'], normativa: ['📖', 'Normativa e scadenze'], servizi: ['🧰', 'Servizi dell\'Area'],
  formazione: ['🎓', 'Formazione ed eventi'], rassegna: ['📰', 'Rassegna'], avviso: ['📢', 'Avviso'],
};
const STATI = { bozza: 'Bozza', approvato: 'Approvato', pubblicato: 'Pubblicato', scartato: 'Scartato' };
const CANALI = [['telegram', 'Telegram'], ['app', 'App servizi'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram / Facebook']];
const AGENZIA_EMAIL = '';   // indirizzo dell'agenzia: si compila nella bozza, non lo cabliamo qui

async function carica() {
  const [{ data: p }, { data: c }] = await Promise.all([
    sb.from('s_post').select('*').order('created_at', { ascending: false }).limit(400),
    sb.from('s_config').select('valore').eq('chiave', 'redazione_linee').maybeSingle(),
  ]);
  post = p || [];
  linee = c?.valore || '';
}

/* supabase-js nasconde il corpo della risposta quando la funzione risponde
   non-2xx («Edge Function returned a non-2xx status code»): il messaggio
   vero sta in error.context. Qui lo si tira fuori, altrimenti chi preme il
   bottone legge un codice e non capisce che manca un secret. */
async function messaggioErrore(error, data) {
  if (data?.error) return data.error;
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const j = await error.context.json();
      if (j?.error) return j.error;
    }
  } catch { /* corpo non JSON */ }
  return error?.message || 'errore sconosciuto';
}

/* immagine di testa: ridotta nel browser (lato lungo 1600 px, JPEG) prima
   di partire, così non si caricano foto da 8 MB per un post */
function immagineRidotta(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.86);
      resolve({ mime: 'image/jpeg', base64: dataUrl.split(',')[1], larghezza: c.width, altezza: c.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('file non leggibile come immagine')); };
    img.src = url;
  });
}

/* ══════════ formattazione dei testi (11/09/2026) ══════════
   Nel testo restano i segni in stile Telegram (vedi js/post-formato.js):
   la barra li mette e li toglie, il contatore conta i caratteri che il
   lettore vede, l'anteprima mostra come uscirà. Telegram e app servizi
   mostrano la formattazione; LinkedIn e Instagram escono in testo
   semplice, quindi lì la barra ha solo l'elenco. */
const EMOJI_FUNZIONALI = ['📋', '📌', '📢', '📅', '⏱', '📍', '👥', '👷', 'ℹ️', '📖', '🔧', '📊', '✅', '⚠️', '👉', '📧', '📞', '🖥'];
const LIMITI = { telegram: 4096, app: 0, linkedin: 3000, instagram: 2200 };
const RICCO = { telegram: true, app: true, linkedin: false, instagram: false };

export function barraFormato(idc, canale) {
  const ricco = RICCO[canale];
  return `<div class="fmt-barra" data-fmt-per="${idc}" data-canale="${canale}">
    ${ricco ? `<button type="button" data-fmt="**" title="Grassetto (Ctrl+B)"><b>G</b></button>
    <button type="button" data-fmt="__" title="Corsivo (Ctrl+I)"><i>C</i></button>
    <button type="button" data-fmt="++" title="Sottolineato (Ctrl+U)"><u>S</u></button>
    <button type="button" data-fmt="~~" title="Barrato"><s>B</s></button>
    <span class="fmt-sep"></span>
    <button type="button" data-fmt="link" title="Link con testo (Ctrl+K)">🔗</button>
    <button type="button" data-fmt="cit" title="Citazione: le righe selezionate iniziano con &gt;">❝</button>` : ''}
    <button type="button" data-fmt="elenco" title="Elenco: le righe selezionate iniziano con ›">›</button>
    ${canale === 'telegram' ? `<select data-fmt="emoji" title="Emoji funzionali in testa alla riga"><option value="">📋▾</option>${EMOJI_FUNZIONALI.map((e) => `<option value="${e}">${e}</option>`).join('')}</select>` : ''}
    <button type="button" data-fmt="anteprima" title="Mostra come uscirà">👁 Anteprima</button>
    <span class="fmt-conta" data-conta></span>
  </div>`;
}

/* insertText tiene l'annulla (Ctrl+Z) del browser; setRangeText no */
function inserisci(ta, testo) {
  ta.focus();
  let fatto = false;
  try { fatto = document.execCommand('insertText', false, testo); } catch { fatto = false; }
  if (!fatto) { ta.setRangeText(testo, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
}

function avvolgi(ta, segno) {
  const a = ta.selectionStart; const b = ta.selectionEnd; const v = ta.value;
  const sel = v.slice(a, b);
  const n = segno.length;
  if (v.slice(a - n, a) === segno && v.slice(b, b + n) === segno) {   /* già dentro i segni: si tolgono */
    ta.setSelectionRange(a - n, b + n); inserisci(ta, sel);
    ta.setSelectionRange(a - n, a - n + sel.length); return;
  }
  if (sel.length > 2 * n && sel.startsWith(segno) && sel.endsWith(segno)) {
    const dentro = sel.slice(n, -n); inserisci(ta, dentro);
    ta.setSelectionRange(a, a + dentro.length); return;
  }
  if (!sel.trim()) { inserisci(ta, segno + segno); ta.setSelectionRange(a + n, a + n); return; }
  /* i segni valgono sulla riga: con più righe selezionate si avvolge ogni riga */
  const nuovo = sel.split('\n').map((r) => {
    if (!r.trim()) return r;
    return r.match(/^\s*/)[0] + segno + r.trim() + segno + r.match(/\s*$/)[0];
  }).join('\n');
  inserisci(ta, nuovo);
  ta.setSelectionRange(a, a + nuovo.length);
}

function prefissa(ta, prefisso) {
  const v = ta.value;
  const inizio = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let fine = v.indexOf('\n', ta.selectionEnd > ta.selectionStart ? ta.selectionEnd - 1 : ta.selectionEnd);
  if (fine === -1) fine = v.length;
  const righe = v.slice(inizio, fine).split('\n');
  const tutte = righe.filter((r) => r.trim()).length > 0 && righe.filter((r) => r.trim()).every((r) => r.startsWith(prefisso));
  const nuovo = righe.map((r) => (!r.trim() ? r : tutte ? r.slice(prefisso.length) : prefisso + r)).join('\n');
  ta.setSelectionRange(inizio, fine); inserisci(ta, nuovo);
  ta.setSelectionRange(inizio, inizio + nuovo.length);
}

function inserisciLink(ta) {
  const a = ta.selectionStart; const b = ta.selectionEnd;
  const sel = ta.value.slice(a, b).trim();
  const url = prompt('Indirizzo del link (https://…, mailto: o tel:)', 'https://');
  if (url === null) return;
  const u = url.trim();
  if (!/^(https?:\/\/\S+|mailto:\S+|tel:\S+)$/.test(u) || u === 'https://') {
    toast('Indirizzo non valido: deve iniziare con https://, mailto: o tel:', 'err'); return;
  }
  const testo = sel || (prompt('Testo da mostrare al posto dell\'indirizzo', '') || '').trim() || u;
  ta.focus(); ta.setSelectionRange(a, b);
  inserisci(ta, `[${testo.replace(/[[\]\n]/g, ' ')}](${u.replace(/\)/g, '%29')})`);
}

function aggiornaFormato(host, idc, immagineUrl) {
  const ta = host.querySelector('#' + idc);
  const barra = host.querySelector(`.fmt-barra[data-fmt-per="${idc}"]`);
  if (!ta || !barra) return;
  const canale = barra.dataset.canale;
  const n = lunghezzaVisibile(ta.value);
  const conta = barra.querySelector('[data-conta]');
  if (conta) {
    if (canale === 'telegram' && immagineUrl) {
      conta.textContent = n <= 1024 ? `${n} / 1024 in didascalia` : `${n} · oltre 1024: foto e testo escono in due messaggi`;
      conta.classList.toggle('oltre', n > 4096);
    } else {
      const lim = LIMITI[canale];
      conta.textContent = lim ? `${n} / ${lim}` : `${n} caratteri`;
      conta.classList.toggle('oltre', !!lim && n > lim);
    }
    conta.title = 'Caratteri che il lettore vede, senza i segni della formattazione.';
  }
  const ant = host.querySelector(`[data-anteprima="${idc}"]`);
  if (!ant || ant.hidden) return;
  const vuoto = '<span class="hint">testo vuoto</span>';
  if (canale === 'telegram') {
    ant.innerHTML = `<div class="bolla">${immagineUrl ? `<img src="${esc(immagineUrl)}" alt="">` : ''}${postInTelegramHtml(ta.value) || vuoto}</div>`;
  } else if (canale === 'app') {
    ant.innerHTML = (immagineUrl ? `<img src="${esc(immagineUrl)}" alt="">` : '') + (postInHtmlNotizia(ta.value) || vuoto);
  } else {
    ant.innerHTML = `<div style="white-space:pre-wrap">${esc(postInTestoSemplice(ta.value)) || vuoto}</div>`;
  }
}

export function collegaFormato(host, { immagineUrl = null } = {}) {
  host.querySelectorAll('.fmt-barra').forEach((barra) => {
    const idc = barra.dataset.fmtPer;
    const ta = host.querySelector('#' + idc);
    if (!ta) return;
    const agg = () => aggiornaFormato(host, idc, immagineUrl);
    const azione = (fmt) => {
      if (['**', '__', '++', '~~'].includes(fmt)) avvolgi(ta, fmt);
      else if (fmt === 'link') inserisciLink(ta);
      else if (fmt === 'cit') prefissa(ta, '> ');
      else if (fmt === 'elenco') prefissa(ta, '› ');
      agg();
    };
    barra.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-fmt]');
      if (!b) return;
      if (b.dataset.fmt === 'anteprima') {
        const ant = host.querySelector(`[data-anteprima="${idc}"]`);
        ant.hidden = !ant.hidden;
        b.classList.toggle('is-active', !ant.hidden);
        agg(); return;
      }
      azione(b.dataset.fmt);
    });
    barra.querySelector('select[data-fmt="emoji"]')?.addEventListener('change', (e) => {
      if (!e.target.value) return;
      inserisci(ta, e.target.value + ' ');
      e.target.value = '';
      agg();
    });
    ta.addEventListener('input', agg);
    if (RICCO[barra.dataset.canale]) {
      ta.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
        const fmt = { b: '**', i: '__', u: '++', k: 'link' }[e.key.toLowerCase()];
        if (!fmt) return;
        e.preventDefault();
        azione(fmt);
      });
    }
    agg();
  });
}

const canaliDi = (p) => (p.canali_pubblicati && typeof p.canali_pubblicati === 'object') ? p.canali_pubblicati : {};
/* Le immagini del post in fila: prima la copertina, poi il carosello (18/09/2026). */
const immagini = (p) => (p.immagine_url ? [p.immagine_url] : [])
  .concat((Array.isArray(p.immagini) ? p.immagini : []).map((x) => (typeof x === 'string' ? x : x && x.url)).filter(Boolean));
const pillPilastro = (k) => { const [ico, nome] = PILASTRI[k] || ['•', k]; return `<span class="badge" style="background:#eef0f3;color:var(--grigio)">${ico} ${esc(nome)}</span>`; };
const pillStato = (s) => {
  const col = { bozza: ['#fff3e8', 'var(--arancio)'], approvato: ['#e7f5e1', '#3d7a1f'], pubblicato: ['#e3edf7', '#1f4f8a'], scartato: ['#f1f1f1', '#777'] }[s] || ['#eee', '#555'];
  return `<span class="badge" style="background:${col[0]};color:${col[1]}">${esc(STATI[s] || s)}</span>`;
};

/* ══════════ elenco ══════════ */

export async function render() {
  const host = $('#comunicazione-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const n = (s) => post.filter((p) => p.stato === s).length;
  const ultimoGiro = post.find((p) => p.creato_da === 'routine')?.giro;
  const visibili = post.filter((p) => filtro === 'tutti' ? true : p.stato === filtro);

  const righe = visibili.map((p) => {
    const c = canaliDi(p);
    const spunte = CANALI.map(([k, l]) => c[k] ? `<span title="${esc(l)} · ${esc((c[k].at || '').slice(0, 10))}">✓ ${esc(l.split(' ')[0])}</span>` : '').filter(Boolean).join(' ');
    return `<tr data-id="${p.id}">
      <td>${pillPilastro(p.pilastro)}</td>
      <td><strong>${esc(p.titolo)}</strong>${p.gancio ? `<br><span class="hint">${esc(p.gancio.slice(0, 120))}</span>` : ''}</td>
      <td class="hint">${esc(p.fonte || '—')}</td>
      <td>${p.data_programmata ? dataIt(p.data_programmata) : '—'}</td>
      <td class="hint">${spunte || '—'}</td>
      <td>${pillStato(p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella ${n('bozza') ? 'dt-senzadata' : 'dt-ok'}" style="padding:4px 10px">✍️ ${n('bozza')} bozze da rivedere</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">✅ ${n('approvato')} approvati da pubblicare</span>
      <span class="dt-cella dt-ok" style="padding:4px 10px">📣 ${n('pubblicato')} pubblicati</span>
      ${ultimoGiro ? `<span class="dt-cella" style="padding:4px 10px">🤖 ultimo giro della routine: ${esc(ultimoGiro)}</span>` : '<span class="dt-cella dt-senzadata" style="padding:4px 10px">🤖 la routine non ha ancora scritto niente</span>'}
    </div>
    <div class="dt-barra">
      <div class="seg" id="cm-f">
        ${[['bozza', 'Bozze'], ['approvato', 'Approvati'], ['pubblicato', 'Pubblicati'], ['scartato', 'Scartati'], ['tutti', 'Tutti']].map(([v, l]) =>
          `<button class="seg-btn ${filtro === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="cm-linee">🧭 Indicazioni per la prossima redazione</button>
        <button class="btn btn-ghost btn-sm" id="cm-materia">📊 Con che numeri lavora</button>
        <button class="btn btn-primary btn-sm" id="cm-nuovo">+ Nuovo post</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Pilastro</th><th>Titolo</th><th>Fonte</th><th>Programmato</th><th>Uscito su</th><th>Stato</th></tr></thead>
        <tbody>${righe || `<tr><td colspan="6" class="empty">Niente con questo filtro.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      Le bozze le scrive la routine del lunedì; qui si rileggono, si ritoccano e si decide che cosa esce.
      Telegram e app servizi si pubblicano da qui; per LinkedIn, Instagram e Facebook parte un kit all'agenzia.
      Mai nomi di imprese, cantieri o persone nei post; i contenuti tecnici li valida il coordinatore.
    </p>`;

  $('#cm-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtro = b.dataset.val; render(); }
  });
  $('#cm-linee').addEventListener('click', apriLinee);
  $('#cm-materia').addEventListener('click', apriMateria);
  $('#cm-nuovo').addEventListener('click', nuovoPost);
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ══════════ indicazioni alla routine ══════════ */

function apriLinee() {
  apriDrawer('Indicazioni per la prossima redazione', '', `
    <p class="hint" style="margin:0 0 10px">La routine le legge a ogni giro, insieme ai motivi degli scarti. Temi da trattare, cose da evitare, un tono da correggere: in italiano, come le diresti a un collaboratore.</p>
    <div class="field"><label>Indicazioni</label><textarea id="ln-testo" rows="10">${esc(linee)}</textarea></div>
    <button class="btn btn-primary" id="ln-salva" style="margin-top:10px">Salva</button>`);
  $('#ln-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_config').update({ valore: $('#ln-testo').value.trim() || 'Nessuna indicazione particolare.', updated_at: new Date().toISOString(), updated_by: state.email }).eq('chiave', 'redazione_linee');
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Indicazioni salvate: la routine le leggerà lunedì.', 'ok');
    chiudiDrawer(); render();
  });
}

async function apriMateria() {
  apriDrawer('Con che numeri lavora la routine', '', '<p class="empty">Un istante…</p>');
  const { data, error } = await sb.rpc('s_redazione_materia', { p_mesi: 12 });
  if (error) { $('#drawer-body').innerHTML = `<p class="empty">Non leggibile: ${esc(error.message)}</p>`; return; }
  const t = data?.totali || {};
  const nc = data?.non_conformita_frequenti || [];
  $('#drawer-body').innerHTML = `
    <p class="hint" style="margin:0 0 8px">Ultimi 12 mesi (${esc(data.periodo?.dal)} → ${esc(data.periodo?.al)}). Solo aggregati: nessun nome di impresa, cantiere o persona arriva alla routine.</p>
    <div class="dt-doc-riga"><strong>Visite:</strong> ${t.visite} · <strong>imprese:</strong> ${t.imprese} · <strong>cantieri:</strong> ${t.cantieri} · <strong>lavoratori incontrati:</strong> ${t.lavoratori_incontrati} · <strong>tecnici:</strong> ${t.tecnici}</div>
    <div class="dt-doc-riga"><strong>Indice di pericolo:</strong> basso ${t.ipc?.basso} · medio ${t.ipc?.medio} · alto ${t.ipc?.alto} · non rilevato ${t.ipc?.non_rilevato}</div>
    <div class="dt-doc-riga"><strong>Non conformità:</strong> gravi ${t.nc_gravi} · lievi ${t.nc_lievi} · osservazioni ${t.osservazioni}</div>
    <div class="dt-doc-riga"><strong>Mese precedente (${esc(data.mese_precedente?.mese)}):</strong> ${data.mese_precedente?.visite} visite, ${data.mese_precedente?.imprese} imprese</div>
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <strong>Le non conformità più frequenti</strong>
    <table class="tbl" style="margin-top:6px"><thead><tr><th>Voce</th><th>Zona</th><th>Norma</th><th>N</th></tr></thead><tbody>
      ${nc.map((r) => `<tr><td>${esc(r.descrizione)}</td><td class="hint">${esc(r.zona_etichetta)}</td><td class="hint">${esc(r.articolo || '—')}</td><td>${r.n}</td></tr>`).join('')}
    </tbody></table>
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <div class="dt-doc-riga"><strong>Circolari e normativa recenti:</strong> ${(data.circolari_e_normativa_recenti || []).length} · <strong>corsi in apertura:</strong> ${(data.corsi_in_apertura || []).length} · <strong>campagne attive:</strong> ${(data.campagne_attive || []).length}</div>`;
}

/* ══════════ nuovo post a mano ══════════ */

function nuovoPost() {
  apriDrawer('Nuovo post (a mano)', '', `
    <p class="hint" style="margin:0 0 10px">Per quello che non aspetta il lunedì: un'ordinanza, un avviso, un evento. Nasce come bozza e segue la stessa coda.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Pilastro</label><select id="np-pilastro">${Object.entries(PILASTRI).map(([k, [i, n]]) => `<option value="${k}">${i} ${n}</option>`).join('')}</select></div>
      <div class="field"><label>Da pubblicare il</label><input type="date" id="np-data" value="${oggiIso()}"></div>
    </div>
    <div class="field"><label>Titolo di lavoro *</label><input type="text" id="np-titolo"></div>
    <div class="field"><label>Fonte (documento, protocollo, link)</label><input type="text" id="np-fonte"></div>
    <div class="field"><label>Testo (Telegram) *</label>
      ${barraFormato('np-testo', 'telegram')}
      <textarea id="np-testo" rows="8"></textarea>
      <div class="fmt-anteprima tg" data-anteprima="np-testo" hidden></div>
      <span class="hint">${esc(SEGNI_AMMESSI)}</span></div>
    <button class="btn btn-primary" id="np-crea" style="margin-top:10px">Crea la bozza</button>`);
  collegaFormato($('#drawer-body'));
  $('#np-crea').addEventListener('click', async (ev) => {
    const titolo = $('#np-titolo').value.trim();
    const testo = $('#np-testo').value.trim();
    if (!titolo || !testo) return toast('Servono titolo e testo.', 'err');
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.from('s_post').insert({
      pilastro: $('#np-pilastro').value, titolo, fonte: $('#np-fonte').value.trim() || null,
      testo_telegram: testo, testo_app: testo, data_programmata: $('#np-data').value || null,
      stato: 'bozza', creato_da: state.email, aggiornato_da: state.email,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    toast('Bozza creata.', 'ok');
    filtro = 'bozza';
    await render();
    apriPratica(data.id);
  });
}

/* ══════════ dettaglio ══════════ */

export async function apriPratica(id) {
  const p = post.find((x) => x.id === id);
  if (!p) return;
  const c = canaliDi(p);
  const area = (idc, label, val, rows, canale) => `
    <div class="field" style="margin-top:8px">
      <label style="display:flex;justify-content:space-between;align-items:center">${label}
        <button class="btn btn-ghost btn-sm" data-copia="${idc}" data-canale="${canale}" type="button" style="padding:2px 8px;font-size:11px">⧉ copia</button></label>
      ${barraFormato(idc, canale)}
      <textarea id="${idc}" rows="${rows}">${esc(val || '')}</textarea>
      <div class="fmt-anteprima${canale === 'telegram' ? ' tg' : ''}" data-anteprima="${idc}" hidden></div>
    </div>`;

  apriDrawer(`${PILASTRI[p.pilastro]?.[0] || ''} ${p.titolo}`, '', `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      ${pillStato(p.stato)} ${pillPilastro(p.pilastro)}
      <span class="hint">${p.creato_da === 'routine' ? `scritto dalla routine (giro ${esc(p.giro || '?')})` : `scritto da ${esc(p.creato_da)}`} · ${dataIt(p.created_at.slice(0, 10))}</span>
    </div>
    ${p.verifica ? `<div class="dt-doc-riga" style="background:#fff8e6;border-left:3px solid var(--arancio);padding:8px 10px;margin-bottom:8px"><strong>Da verificare prima di approvare:</strong><br>${esc(p.verifica)}</div>` : ''}
    ${p.fonte ? `<div class="dt-doc-riga"><strong>Fonte:</strong> ${esc(p.fonte)}${p.fonte_url ? ` · <a href="${esc(p.fonte_url)}" target="_blank" rel="noopener">apri</a>` : ''}</div>` : ''}
    ${p.norma ? `<div class="dt-doc-riga"><strong>Norma citata:</strong> ${esc(p.norma)}</div>` : ''}
    ${p.immagine_suggerita ? `<div class="dt-doc-riga"><strong>Grafica suggerita:</strong> ${esc(p.immagine_suggerita)}</div>` : ''}
    ${p.scarto_motivo ? `<div class="dt-doc-riga"><strong>Motivo dello scarto:</strong> ${esc(p.scarto_motivo)}</div>` : ''}
    ${Object.keys(c).length ? `<div class="dt-doc-riga"><strong>Uscito su:</strong> ${CANALI.filter(([k]) => c[k]).map(([k, l]) => `${esc(l)} (${esc((c[k].at || '').slice(0, 10))}${c[k].message_id ? `, msg ${c[k].message_id}` : ''})`).join(' · ')}</div>` : ''}

    <div class="dt-doc-riga" style="margin-top:8px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <strong>Immagini${immagini(p).length > 1 ? ` (${immagini(p).length} — carosello)` : ''}:</strong>
        ${immagini(p).length ? immagini(p).map((u, i) => `
          <span style="position:relative;display:inline-block">
            <a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="height:72px;border-radius:8px;border:1px solid var(--bordo);display:block"></a>
            <button class="btn btn-ghost btn-sm pd-img-togli" data-i="${i}" type="button" title="Togli questa immagine" style="position:absolute;top:-6px;right:-6px;padding:1px 6px;border-radius:999px;background:#fff">✕</button>
            <span style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.6);color:#fff;font-size:9px;font-weight:700;text-align:center;border-radius:0 0 8px 8px">${i === 0 ? 'copertina' : i + 1}</span>
          </span>`).join('') : '<span class="hint">nessuna (su Telegram esce solo testo)</span>'}
        <input type="file" id="pd-img-file" accept="image/jpeg,image/png,image/webp" multiple style="max-width:220px">
        <button class="btn btn-ghost btn-sm" id="pd-img-carica" type="button">⬆ Carica</button>
      </div>
      <span class="hint">La prima è la <b>copertina</b>, le altre fanno il <b>carosello</b>: nell'app servizi si scorrono, su Telegram escono come album (didascalia sulla prima, max 1024 caratteri). Le immagini si rimpiccioliscono da sole. Foto dell'ente o d'archivio, mai cantieri o persone riconoscibili.</span>
    </div>

    <div class="dt-doc-riga" style="margin-top:8px">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <strong>▶ Video (link YouTube):</strong>
        <input type="url" id="pd-video" value="${esc(p.video_url || '')}" placeholder="https://www.youtube.com/watch?v=…" style="flex:1;min-width:280px">
        ${p.video_url ? `<a href="${esc(p.video_url)}" target="_blank" rel="noopener">apri</a>` : ''}
      </div>
      <span class="hint">Il video <b>non si carica qui</b>: si mette sul canale dell'Area (@formedilpadova_areasicurezza) e si incolla il link. Nell'app servizi la notizia lo mostra con copertina e tasto play (il lettore parte solo al tocco, quindi nessun cookie prima); su Telegram esce il link nel testo. Si salva con «Salva le modifiche».</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Pilastro</label><select id="pd-pilastro">${Object.entries(PILASTRI).map(([k, [i, n]]) => `<option value="${k}" ${k === p.pilastro ? 'selected' : ''}>${i} ${n}</option>`).join('')}</select></div>
      <div class="field"><label>Da pubblicare il</label><input type="date" id="pd-data" value="${p.data_programmata || ''}"></div>
      <div class="field"><label>Titolo di lavoro</label><input type="text" id="pd-titolo" value="${esc(p.titolo)}"></div>
    </div>
    <div class="field" style="margin-top:10px">
      <label>In evidenza nell'app fino al <span class="hint">— vuoto: notizia normale</span></label>
      <input type="date" id="pd-evidenza" value="${p.evidenza_fino_al || ''}">
      <span class="hint">Il riquadro in cima alla home dell'app servizi, per una cosa che ha una data: un corso da
        riempire, un convegno con le iscrizioni aperte. <b>Passata la data sparisce da sé</b> — non c'è niente da
        ricordarsi di togliere. Vale dal momento in cui la notizia viene pubblicata nell'app.</span>
    </div>
    <p class="hint" style="margin:10px 0 0">Formattazione: ${esc(SEGNI_AMMESSI)}. Si mette coi pulsanti o con Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+K. Telegram e app servizi la mostrano; LinkedIn e Instagram escono in testo semplice e i segni si tolgono da soli.</p>
    ${area('pd-telegram', '📋 Telegram (esce da qui col bot)', p.testo_telegram, 9, 'telegram')}
    ${area('pd-app', '🔔 App servizi — notizia estesa', p.testo_app, 8, 'app')}
    ${area('pd-linkedin', '💼 LinkedIn (all\'agenzia)', p.testo_linkedin, 7, 'linkedin')}
    ${area('pd-instagram', '📸 Instagram / Facebook (all\'agenzia)', p.testo_instagram, 5, 'instagram')}
    <div class="field" style="margin-top:8px"><label>Hashtag</label><input type="text" id="pd-hashtag" value="${esc(p.hashtag || '')}"></div>

    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
      <button class="btn btn-ghost" id="pd-salva">💾 Salva le modifiche</button>
      ${p.stato === 'bozza' || p.stato === 'scartato' ? '<button class="btn btn-primary" id="pd-approva">✅ Approva</button>' : ''}
      ${p.stato === 'approvato' ? '<button class="btn btn-ghost" id="pd-bozza">↩ Riporta a bozza</button>' : ''}
      ${p.stato !== 'scartato' && p.stato !== 'pubblicato' ? '<button class="btn btn-ghost" id="pd-scarta">🗑 Scarta con motivo</button>' : ''}
    </div>
    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <strong>🧪 Prova prima di pubblicare</strong>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px">
      <button class="btn btn-ghost" id="pd-prova">🧪 Manda al canale di prova</button>
      ${c.prova ? `<span class="hint">ultima prova: <b>${esc(dataIt((c.prova.at || '').slice(0, 10)))}</b>${c.prova.formattazione_tolta ? ' — ⚠ la formattazione è stata tolta' : ''}</span>` : '<span class="hint">non ancora provato</span>'}
      <button class="btn btn-ghost btn-sm" id="pd-canale-prova">⚙ Canale di prova…</button>
    </div>
    <p class="hint" style="margin-top:6px">Esce sul canale di prova esattamente come uscirebbe su quello pubblico — stesse immagini, stesso album, stessa formattazione — ma <b>non</b> conta come pubblicazione: il post resta dov'è. Si può provare anche una bozza, e quante volte si vuole.</p>
    ${c.prova && p.stato === 'bozza' ? `<p class="hint" style="margin-top:6px;background:#f2f8ec;border-left:3px solid var(--verde, #5d7f18);padding:7px 10px">👍 <b>Se com'è uscito ti convince</b>, premi <b>✅ Approva</b> qui sopra: compaiono i pulsanti per il <b>canale pubblico</b> e per l'<b>app servizi</b>. Se invece va corretto, cambia il testo o le immagini e riprova: le prove sono illimitate.</p>` : ''}

    ${['approvato', 'pubblicato'].includes(p.stato) ? `
    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <strong>Pubblica</strong>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-primary" id="pd-tg" ${c.telegram ? 'disabled title="già pubblicato su Telegram"' : ''}>📋 Pubblica su Telegram</button>
      <button class="btn btn-primary" id="pd-notizia" ${c.app ? 'disabled title="già pubblicato nell\'app"' : ''}>🔔 Pubblica nell'app servizi</button>
      <button class="btn btn-ghost" id="pd-kit">✉️ Kit per l'agenzia (.eml)</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${CANALI.map(([k, l]) => `<button class="btn btn-ghost btn-sm" data-segna="${k}" ${c[k] ? 'disabled' : ''}>${c[k] ? '✓' : '☐'} segna uscito su ${esc(l)} (a mano)</button>`).join('')}
    </div>
    <p class="hint" style="margin-top:8px">Telegram e app partono da qui. LinkedIn, Instagram e Facebook li pubblica l'agenzia col kit; quando è uscito, si segna a mano.</p>` : ''}`);

  $('#drawer').classList.add('drawer-xl');
  collegaFormato($('#drawer-body'), { immagineUrl: p.immagine_url });

  const valori = () => ({
    pilastro: $('#pd-pilastro').value, data_programmata: $('#pd-data').value || null,
    evidenza_fino_al: $('#pd-evidenza')?.value || null,
    titolo: $('#pd-titolo').value.trim() || p.titolo,
    testo_telegram: $('#pd-telegram').value.trim() || null, testo_app: $('#pd-app').value.trim() || null,
    testo_linkedin: $('#pd-linkedin').value.trim() || null, testo_instagram: $('#pd-instagram').value.trim() || null,
    hashtag: $('#pd-hashtag').value.trim() || null, aggiornato_da: state.email,
    video_url: $('#pd-video')?.value.trim() || null,
  });
  const salva = async (extra = {}, msg = 'Salvato.') => {
    const { error } = await sb.from('s_post').update({ ...valori(), ...extra }).eq('id', id);
    if (error) { toast('Non salvato: ' + error.message, 'err'); return false; }
    toast(msg, 'ok');
    await render();
    return true;
  };

  /* copia: per Telegram restano ** __ ~~ (Telegram li trasforma all'invio),
     per LinkedIn e Instagram il testo senza segni; dove si incolla in un
     editor che accetta HTML arriva anche la versione formattata */
  $('#drawer-body').querySelectorAll('[data-copia]').forEach((b) => b.addEventListener('click', async () => {
    const v = $('#' + b.dataset.copia).value;
    const canale = b.dataset.canale;
    const piano = canale === 'telegram' ? postPerIncollaTelegram(v) : postInTestoSemplice(v);
    const html = RICCO[canale] ? postInHtmlNotizia(v) : '';
    try {
      if (html && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([piano], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        })]);
      } else {
        await navigator.clipboard.writeText(piano);
      }
      toast(canale === 'telegram' ? 'Copiato. Incollato in Telegram, grassetto, corsivo e barrato escono all\'invio; il sottolineato no.' : 'Copiato.', 'ok');
    } catch { toast('Copia non riuscita: seleziona il testo e copia a mano.', 'err'); }
  }));
  $('#pd-salva').addEventListener('click', async (ev) => { attendi(ev.currentTarget, true); await salva(); attendi(ev.currentTarget, false); });
  $('#pd-approva')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    if (await salva({ stato: 'approvato', scarto_motivo: null }, 'Approvato: ora si può pubblicare.')) apriPratica(id);
  });
  $('#pd-bozza')?.addEventListener('click', async () => { if (await salva({ stato: 'bozza' }, 'Riportato a bozza.')) apriPratica(id); });
  $('#pd-scarta')?.addEventListener('click', async () => {
    const motivo = prompt('Perché si scarta? (la routine lo rilegge al giro dopo, per non riproporlo)');
    if (motivo === null) return;
    if (await salva({ stato: 'scartato', scarto_motivo: motivo.trim() || 'scartato senza motivo' }, 'Scartato.')) chiudiDrawer();
  });

  /* immagine di testa */
  $('#pd-img-carica').addEventListener('click', async (ev) => {
    const files = [...($('#pd-img-file').files || [])];
    if (!files.length) return toast('Scegli prima uno o più file immagine.', 'err');
    const btn = ev.currentTarget;
    attendi(btn, true, 'Carico…');
    try {
      /* una per volta e in fila: la prima diventa la copertina, le altre il
         carosello, e l'ordine in cui si scelgono e' quello che si vedra' */
      for (const [k, file] of files.entries()) {
        const img = await immagineRidotta(file);
        const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'immagine', id, mime: img.mime, base64: img.base64 } });
        if (error || data?.error) throw new Error(await messaggioErrore(error, data));
        /* La funzione aggiornata risponde anche con «quante»: se manca, sul server
           c'e' ancora quella vecchia, che SOSTITUISCE la copertina invece di
           aggiungere - e caricando in fila resterebbe solo l'ultima immagine.
           Ci si ferma alla prima e lo si dice. */
        if (data && data.quante === undefined && files.length > 1) {
          if (k === 0) throw new Error('la funzione «redazione-social» non e\u0027 ancora stata pubblicata con il carosello: per ora si carica una immagine sola. Caricata la prima, le altre no.');
        }
      }
      toast(files.length > 1 ? `${files.length} immagini caricate.` : 'Immagine caricata.', 'ok');
      await render(); apriPratica(id);
    } catch (e) {
      attendi(btn, false);
      toast('Immagine: ' + e.message, 'err');
    }
  });
  document.querySelectorAll('.pd-img-togli').forEach((b) => b.addEventListener('click', async (ev) => {
    const i = Number(ev.currentTarget.dataset.i);
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'immagine_rimuovi', id, indice: i } });
    if (error || data?.error) { attendi(ev.currentTarget, false); return toast('Immagine: ' + await messaggioErrore(error, data), 'err'); }
    toast('Immagine tolta.', 'ok');
    await render(); apriPratica(id);
  }));

  /* prova sul canale di prova: stesso invio della pubblicazione, altro canale */
  $('#pd-prova')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Mando…');
    try {
      await salva({}, 'Salvato prima della prova.');
      const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'pubblica', id, prova: true, testo: $('#pd-telegram').value.trim() } });
      if (error || data?.error) throw new Error(await messaggioErrore(error, data));
      toast(data.formattazione_tolta
        ? 'Mandato al canale di prova, ma Telegram ha rifiutato la formattazione: è uscito in testo semplice.'
        : 'Mandato al canale di prova: guarda com\'è uscito.', data.formattazione_tolta ? 'err' : 'ok');
      await render(); apriPratica(id);
    } catch (e) {
      attendi(btn, false);
      toast('Prova non riuscita: ' + e.message, 'err');
    }
  });

  /* quale canale di prova: si cerca fra quelli che il bot vede, o si scrive a mano */
  $('#pd-canale-prova')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Cerco…');
    try {
      const { data: riga } = await sb.from('s_config').select('valore').eq('chiave', 'telegram_canale_prova').maybeSingle();
      const attuale = riga?.valore || '';
      const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'canali_bot', id } });
      if (error || data?.error) throw new Error(await messaggioErrore(error, data));
      const elenco = (data.canali || []).map((x) => `${x.titolo} → ${x.id} (${x.tipo})`).join('\n') || '(nessun canale visto di recente)';
      const scelto = prompt(
        'Canale Telegram di PROVA.\n\nIl bot è ' + (data.bot ? '@' + data.bot : 'sconosciuto') +
        ': deve essere AMMINISTRATORE del canale, e nel canale dev\'essere stato scritto qualcosa di recente perché compaia qui sotto.\n\n' +
        'Canali visti dal bot:\n' + elenco + '\n\nScrivi l\'id numerico (es. -1001234567890) oppure @nome del canale di prova:', attuale);
      if (scelto === null) return;
      /* L'id di un canale Telegram è NEGATIVO e comincia per -100: copiandolo a mano
         il meno si perde facilmente, e Telegram risponde «chat not found» cercando una
         chat privata che non esiste (successo davvero il 18/09). Si rimette qui. */
      let canale = scelto.trim();
      if (/^100\d{6,}$/.test(canale)) canale = '-' + canale;
      const { error: e2 } = await sb.from('s_config').update({ valore: canale }).eq('chiave', 'telegram_canale_prova');
      if (e2) throw new Error(e2.message);
      toast(!canale ? 'Canale di prova tolto.'
        : canale !== scelto.trim() ? `Canale di prova impostato: ${canale} (mancava il meno davanti, l'ho messo io).`
        : 'Canale di prova impostato.', 'ok');
    } catch (e) {
      toast('Canale di prova: ' + e.message, 'err');
    } finally { attendi(btn, false); }
  });

  /* pubblicazione */
  $('#pd-tg')?.addEventListener('click', async (ev) => {
    /* Non blocca: ricorda soltanto che questo post dal canale di prova non è mai passato. */
    const avviso = c.prova
      ? 'Pubblico ADESSO questo testo sul canale Telegram PUBBLICO?'
      : 'Questo post non è mai stato provato sul canale di prova.\n\nPubblico lo stesso ADESSO sul canale PUBBLICO?';
    if (!confirm(avviso)) return;
    const btn = ev.currentTarget;
    attendi(btn, true, 'Pubblico…');
    await salva({}, 'Testo salvato.');
    const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'pubblica', id } });
    attendi(btn, false);
    if (error || data?.error) return toast('Telegram: ' + await messaggioErrore(error, data), 'err');
    toast(data.formattazione_tolta
      ? `Pubblicato su Telegram (messaggio ${data.message_id}) ma SENZA formattazione: Telegram non ha accettato i segni. Guarda l'anteprima.`
      : `Pubblicato su Telegram (messaggio ${data.message_id}).`, data.formattazione_tolta ? 'err' : 'ok');
    await render(); apriPratica(id);
  });
  $('#pd-notizia')?.addEventListener('click', async (ev) => {
    if (!confirm('Pubblico ADESSO la notizia nell\'app servizi?')) return;
    const btn = ev.currentTarget;
    attendi(btn, true, 'Pubblico…');
    await salva({}, 'Testo salvato.');
    const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'notizia', id } });
    attendi(btn, false);
    if (error || data?.error) return toast('App servizi: ' + await messaggioErrore(error, data), 'err');
    toast('Pubblicato nell\'app servizi.', 'ok');
    await render(); apriPratica(id);
  });
  $('#pd-kit')?.addEventListener('click', async () => {
    await salva({}, 'Testo salvato.');
    const v = valori();
    const corpo = [
      'Ciao,', '',
      `vi giro il testo per i canali social di Formedil Padova, Area Sicurezza e Salute — «${v.titolo}».`,
      p.data_programmata ? `Da pubblicare, se possibile, il ${dataIt(p.data_programmata)}.` : '',
      '', '— LinkedIn —', v.testo_linkedin ? postInTestoSemplice(v.testo_linkedin) : '(non previsto)',
      '', '— Instagram / Facebook —', v.testo_instagram ? postInTestoSemplice(v.testo_instagram) : '(non previsto)',
      '', v.hashtag ? `Hashtag: ${v.hashtag}` : '',
      p.immagine_suggerita ? `Grafica suggerita: ${p.immagine_suggerita}` : '',
      p.fonte_url ? `Fonte: ${p.fonte_url}` : '',
      '', 'Grazie, a disposizione per qualunque ritocco.',
    ].filter((r) => r !== null).join('\n');
    scaricaEml({ to: AGENZIA_EMAIL, oggetto: `Formedil Padova – Area Sicurezza e Salute – post social: ${v.titolo}`, corpo, nomeFile: `kit-social-${id}.eml` });
    toast('Bozza .eml scaricata: si apre in Outlook, si mette il destinatario e si invia a mano.', 'ok');
  });
  $('#drawer-body').querySelectorAll('[data-segna]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.segna;
    const nuovi = { ...canaliDi(p), [k]: { at: new Date().toISOString(), da: state.email, manuale: true } };
    if (await salva({ canali_pubblicati: nuovi, stato: 'pubblicato', pubblicato_il: p.pubblicato_il || new Date().toISOString() }, 'Segnato.')) apriPratica(id);
  }));
}
