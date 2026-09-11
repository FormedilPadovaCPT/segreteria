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

const canaliDi = (p) => (p.canali_pubblicati && typeof p.canali_pubblicati === 'object') ? p.canali_pubblicati : {};
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
    <div class="field"><label>Testo (Telegram) *</label><textarea id="np-testo" rows="8"></textarea></div>
    <button class="btn btn-primary" id="np-crea" style="margin-top:10px">Crea la bozza</button>`);
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
  const area = (idc, label, val, rows = 6) => `
    <div class="field" style="margin-top:8px">
      <label style="display:flex;justify-content:space-between;align-items:center">${label}
        <button class="btn btn-ghost btn-sm" data-copia="${idc}" type="button" style="padding:2px 8px;font-size:11px">⧉ copia</button></label>
      <textarea id="${idc}" rows="${rows}">${esc(val || '')}</textarea>
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

    <div class="dt-doc-riga" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px">
      <strong>Immagine di testa:</strong>
      ${p.immagine_url ? `<a href="${esc(p.immagine_url)}" target="_blank" rel="noopener"><img src="${esc(p.immagine_url)}" alt="" style="height:72px;border-radius:8px;border:1px solid var(--bordo)"></a>` : '<span class="hint">nessuna (su Telegram esce solo testo)</span>'}
      <input type="file" id="pd-img-file" accept="image/jpeg,image/png,image/webp" style="max-width:220px">
      <button class="btn btn-ghost btn-sm" id="pd-img-carica" type="button">⬆ Carica</button>
      ${p.immagine_url ? '<button class="btn btn-ghost btn-sm" id="pd-img-togli" type="button">✕ Togli</button>' : ''}
      <span class="hint">Su Telegram esce come foto col testo sotto (max 1024 caratteri in didascalia); nell'app servizi come immagine della notizia. Foto dell'ente o d'archivio, mai cantieri o persone riconoscibili.</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
      <div class="field"><label>Pilastro</label><select id="pd-pilastro">${Object.entries(PILASTRI).map(([k, [i, n]]) => `<option value="${k}" ${k === p.pilastro ? 'selected' : ''}>${i} ${n}</option>`).join('')}</select></div>
      <div class="field"><label>Da pubblicare il</label><input type="date" id="pd-data" value="${p.data_programmata || ''}"></div>
      <div class="field"><label>Titolo di lavoro</label><input type="text" id="pd-titolo" value="${esc(p.titolo)}"></div>
    </div>
    ${area('pd-telegram', '📋 Telegram (esce da qui col bot)', p.testo_telegram, 9)}
    ${area('pd-app', '🔔 App servizi — notizia estesa', p.testo_app, 8)}
    ${area('pd-linkedin', '💼 LinkedIn (all\'agenzia)', p.testo_linkedin, 7)}
    ${area('pd-instagram', '📸 Instagram / Facebook (all\'agenzia)', p.testo_instagram, 5)}
    <div class="field" style="margin-top:8px"><label>Hashtag</label><input type="text" id="pd-hashtag" value="${esc(p.hashtag || '')}"></div>

    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">
      <button class="btn btn-ghost" id="pd-salva">💾 Salva le modifiche</button>
      ${p.stato === 'bozza' || p.stato === 'scartato' ? '<button class="btn btn-primary" id="pd-approva">✅ Approva</button>' : ''}
      ${p.stato === 'approvato' ? '<button class="btn btn-ghost" id="pd-bozza">↩ Riporta a bozza</button>' : ''}
      ${p.stato !== 'scartato' && p.stato !== 'pubblicato' ? '<button class="btn btn-ghost" id="pd-scarta">🗑 Scarta con motivo</button>' : ''}
    </div>
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

  const valori = () => ({
    pilastro: $('#pd-pilastro').value, data_programmata: $('#pd-data').value || null,
    titolo: $('#pd-titolo').value.trim() || p.titolo,
    testo_telegram: $('#pd-telegram').value.trim() || null, testo_app: $('#pd-app').value.trim() || null,
    testo_linkedin: $('#pd-linkedin').value.trim() || null, testo_instagram: $('#pd-instagram').value.trim() || null,
    hashtag: $('#pd-hashtag').value.trim() || null, aggiornato_da: state.email,
  });
  const salva = async (extra = {}, msg = 'Salvato.') => {
    const { error } = await sb.from('s_post').update({ ...valori(), ...extra }).eq('id', id);
    if (error) { toast('Non salvato: ' + error.message, 'err'); return false; }
    toast(msg, 'ok');
    await render();
    return true;
  };

  $('#drawer-body').querySelectorAll('[data-copia]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#' + b.dataset.copia).value); toast('Copiato.', 'ok'); }
    catch { toast('Copia non riuscita: seleziona il testo e copia a mano.', 'err'); }
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
    const file = $('#pd-img-file').files?.[0];
    if (!file) return toast('Scegli prima un file immagine.', 'err');
    const btn = ev.currentTarget;
    attendi(btn, true, 'Carico…');
    try {
      const img = await immagineRidotta(file);
      const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'immagine', id, mime: img.mime, base64: img.base64 } });
      if (error || data?.error) throw new Error(await messaggioErrore(error, data));
      toast('Immagine caricata.', 'ok');
      await render(); apriPratica(id);
    } catch (e) {
      attendi(btn, false);
      toast('Immagine: ' + e.message, 'err');
    }
  });
  $('#pd-img-togli')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'immagine_rimuovi', id } });
    if (error || data?.error) { attendi(ev.currentTarget, false); return toast('Immagine: ' + await messaggioErrore(error, data), 'err'); }
    toast('Immagine tolta.', 'ok');
    await render(); apriPratica(id);
  });

  /* pubblicazione */
  $('#pd-tg')?.addEventListener('click', async (ev) => {
    if (!confirm('Pubblico ADESSO questo testo sul canale Telegram pubblico?')) return;
    const btn = ev.currentTarget;
    attendi(btn, true, 'Pubblico…');
    await salva({}, 'Testo salvato.');
    const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'pubblica', id } });
    attendi(btn, false);
    if (error || data?.error) return toast('Telegram: ' + await messaggioErrore(error, data), 'err');
    toast(`Pubblicato su Telegram (messaggio ${data.message_id}).`, 'ok');
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
      '', '— LinkedIn —', v.testo_linkedin || '(non previsto)',
      '', '— Instagram / Facebook —', v.testo_instagram || '(non previsto)',
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
