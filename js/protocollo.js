/* ============================================================
   Modulo Protocollo — registro, ricerca, inserimento, dettaglio.
   Sostituisce le maschere Access "Protocollo in ENTRATA" e
   "Protocollo in USCITA" con un unico registro a numerazione
   separata IN / OUT.
   ============================================================ */

import {
  sb, state, $, $$, esc, dataIt, oggiIso, toast, attendi,
  mostraVista, apriDrawer, chiudiDrawer,
  codiceProtocollo, protocolloEsteso,
} from './core.js';
import { PAGE_SIZE, BUCKET } from './config.js';
import { UFFICI, MEZZI, normalizzaMezzo } from './lookups.js';

/* ── stato del modulo ─────────────────────────────────────── */
const f = { direzione: '', testo: '', anno: '', tipo: '', ufficio: '' };
let pagina = 0;
let totale = 0;
let cartelleNote = [];
let referentiNoti = [];
let assegnatiNoti = [];
let recordCorrente = null;
let modificaId = null;

/* ══════════════ AVVIO ══════════════ */
export async function init() {
  /* tendine dei filtri */
  const selTipo = $('#f-tipo');
  state.tipiDoc.forEach((t) => {
    selTipo.insertAdjacentHTML('beforeend', `<option value="${t.id_doc}">${esc(t.descrizione)}</option>`);
  });
  const selUff = $('#f-ufficio');
  UFFICI.forEach((u) => selUff.insertAdjacentHTML('beforeend', `<option value="${esc(u)}">${esc(u)}</option>`));

  const annoOra = new Date().getFullYear();
  const selAnno = $('#f-anno');
  for (let a = annoOra; a >= 2012; a--) {
    selAnno.insertAdjacentHTML('beforeend', `<option value="${a}">${a}</option>`);
  }

  /* eventi dei filtri */
  $$('#f-direzione .seg-btn').forEach((b) => b.addEventListener('click', () => {
    $$('#f-direzione .seg-btn').forEach((x) => x.classList.remove('is-active'));
    b.classList.add('is-active');
    f.direzione = b.dataset.val;
    pagina = 0; caricaElenco();
  }));

  let timerRicerca;
  $('#f-testo').addEventListener('input', (e) => {
    clearTimeout(timerRicerca);
    timerRicerca = setTimeout(() => { f.testo = e.target.value.trim(); pagina = 0; caricaElenco(); }, 320);
  });
  ['anno', 'tipo', 'ufficio'].forEach((k) => {
    $(`#f-${k}`).addEventListener('change', (e) => { f[k] = e.target.value; pagina = 0; caricaElenco(); });
  });
  $('#f-reset').addEventListener('click', () => {
    Object.keys(f).forEach((k) => (f[k] = ''));
    $('#f-testo').value = ''; $('#f-anno').value = ''; $('#f-tipo').value = ''; $('#f-ufficio').value = '';
    $$('#f-direzione .seg-btn').forEach((x, i) => x.classList.toggle('is-active', i === 0));
    pagina = 0; caricaElenco();
  });

  $('#pg-prev').addEventListener('click', () => { if (pagina > 0) { pagina--; caricaElenco(); } });
  $('#pg-next').addEventListener('click', () => { if ((pagina + 1) * PAGE_SIZE < totale) { pagina++; caricaElenco(); } });
  $('#form-close').addEventListener('click', () => { mostraVista('registro'); caricaElenco(); });

  /* apertura dettaglio dalla riga */
  $('#tb-registro').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) apriDettaglio(Number(tr.dataset.id));
  });

  /* azioni dentro al drawer */
  $('#drawer-body').addEventListener('click', gestisciAzioneDrawer);

  await Promise.all([caricaElenco(), caricaValoriNoti()]);
}

export function ricarica() { caricaElenco(); }

/* valori già usati in archivio: cartelle e referenti, per le tendine */
async function caricaValoriNoti() {
  const { data: righe } = await sb.from('s_protocollo')
    .select('cartella, referente, alla_ca').order('id', { ascending: false }).limit(1500);
  const c = new Set(), r = new Set();
  /* Chi in ufficio prende in carico il documento in arrivo: l'elenco si
     ricava dal registro, non da un organigramma scritto a mano — cosi'
     si aggiorna da se' e non afferma ruoli non documentati. Ordinato per
     quante volte il nome compare, non alfabeticamente. */
  const quante = new Map();
  (righe || []).forEach((x) => {
    if (x.cartella) c.add(x.cartella);
    if (x.referente) r.add(x.referente);
    if (x.alla_ca) quante.set(x.alla_ca, (quante.get(x.alla_ca) || 0) + 1);
  });
  cartelleNote = [...c].sort();
  referentiNoti = [...r].sort();
  assegnatiNoti = [...quante.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/* ══════════════ ELENCO ══════════════ */
async function caricaElenco() {
  const tb = $('#tb-registro');
  tb.innerHTML = `<tr><td colspan="8" class="empty">Caricamento…</td></tr>`;

  let q = sb.from('s_protocollo')
    .select('id,direzione,numero,esercizio,codice,data_prot,data_doc,impresa_nome,persona,alla_ca,oggetto,tipo_doc_txt,tipo_doc_id,mezzo,ufficio,annullato,drive_url', { count: 'exact' });

  if (f.direzione) q = q.eq('direzione', f.direzione);
  if (f.tipo) q = q.eq('tipo_doc_id', Number(f.tipo));
  if (f.ufficio) q = q.eq('ufficio', f.ufficio);
  if (f.anno) q = q.gte('data_prot', `${f.anno}-01-01`).lte('data_prot', `${f.anno}-12-31`);

  if (f.testo) {
    const t = f.testo.replace(/[%,()]/g, ' ').trim();
    const parti = [
      `oggetto.ilike.%${t}%`,
      `impresa_nome.ilike.%${t}%`,
      `persona.ilike.%${t}%`,
      `note.ilike.%${t}%`,
      `alla_ca.ilike.%${t}%`,
    ];
    parti.push(`codice.ilike.%${t.split('/').join('_')}%`);
    if (/^\d+$/.test(t)) parti.push(`numero.eq.${t}`);
    q = q.or(parti.join(','));
  }

  const da = pagina * PAGE_SIZE;
  const { data, count, error } = await q
    .order('data_prot', { ascending: false, nullsFirst: false })
    .order('numero', { ascending: false })
    .range(da, da + PAGE_SIZE - 1);

  if (error) {
    tb.innerHTML = `<tr><td colspan="8" class="empty">Errore di lettura: ${esc(error.message)}</td></tr>`;
    return;
  }

  totale = count || 0;
  $('#registro-empty').classList.toggle('hidden', totale > 0);
  $('#pg-info').textContent = totale
    ? `${da + 1}–${Math.min(da + PAGE_SIZE, totale)} di ${totale.toLocaleString('it-IT')}`
    : '';
  $('#pg-prev').disabled = pagina === 0;
  $('#pg-next').disabled = (pagina + 1) * PAGE_SIZE >= totale;

  tb.innerHTML = (data || []).map(riga).join('') ||
    `<tr><td colspan="8" class="empty">Nessun protocollo con questi filtri.</td></tr>`;

  aggiornaContatori();
}

function riga(p) {
  const inn = p.direzione === 'IN';
  const contatto = p.impresa_nome || p.persona || p.alla_ca || '—';
  const sotto = [p.persona && p.impresa_nome ? p.persona : '', p.alla_ca && !inn ? `c.a. ${p.alla_ca}` : '']
    .filter(Boolean).join(' · ');
  return `
  <tr data-id="${p.id}" class="${inn ? 'row-in' : 'row-out'}${p.annullato ? ' is-annullato' : ''}">
    <td class="num">${p.esercizio
      ? `${String(p.numero).padStart(4, '0')}<span class="cell-sub">${esc(p.esercizio)}</span>`
      : (p.numero ?? '')}</td>
    <td><span class="dot ${inn ? 'dot-in' : 'dot-out'}" title="${inn ? 'Entrata' : 'Uscita'}"></span></td>
    <td>${dataIt(p.data_prot)}</td>
    <td>${esc(contatto)}${sotto ? `<span class="cell-sub">${esc(sotto)}</span>` : ''}</td>
    <td><div class="clamp">${esc(p.oggetto || '')}</div></td>
    <td>${esc(p.tipo_doc_txt || '')}</td>
    <td>${esc(normalizzaMezzo(p.mezzo))}</td>
    <td>${p.drive_url ? '📎' : ''}</td>
  </tr>`;
}

async function aggiornaContatori() {
  const conta = async (dir) => {
    const { count } = await sb.from('s_protocollo')
      .select('id', { count: 'exact', head: true }).eq('direzione', dir);
    return count || 0;
  };
  const [nIn, nOut] = await Promise.all([conta('IN'), conta('OUT')]);
  $('#nav-counts').innerHTML =
    `Registro:<br>${nIn.toLocaleString('it-IT')} in entrata<br>${nOut.toLocaleString('it-IT')} in uscita`;
}

/* ══════════════ DETTAGLIO ══════════════ */
export async function apriDettaglio(id) {
  apriDrawer('Caricamento…', '', '<p class="empty">Un istante…</p>');

  const { data: p, error } = await sb.from('s_protocollo').select('*').eq('id', id).single();
  if (error) { apriDrawer('Errore', '', `<p class="empty">${esc(error.message)}</p>`); return; }
  recordCorrente = p;

  const { data: allegati } = await sb.from('s_prot_allegati')
    .select('*').eq('protocollo_id', id).order('id');

  const inn = p.direzione === 'IN';
  const voce = (dt, dd) => (dd ? `<dt>${dt}</dt><dd>${esc(dd)}</dd>` : '');

  const html = `
    ${p.annullato ? `<p class="tag" style="background:var(--out-bg);color:var(--out)">Protocollo annullato${p.annullato_motivo ? ': ' + esc(p.annullato_motivo) : ''}</p>` : ''}

    <dl class="dl">
      ${voce('Data protocollo', dataIt(p.data_prot))}
      ${voce('Data documento', dataIt(p.data_doc))}
      ${voce(inn ? 'Mittente impresa' : 'Destinatario impresa', p.impresa_nome)}
      ${voce(inn ? 'Mittente persona' : 'Destinatario persona', p.persona)}
      ${voce('Alla cortese attenzione', p.alla_ca)}
      ${voce('Vostro protocollo', p.vostro_protocollo)}
      ${voce('Tipo documento', p.tipo_doc_txt)}
      ${voce('Mezzo', p.mezzo)}
      ${voce('Ufficio', p.ufficio)}
      ${voce('Referente', p.referente)}
      ${voce('Cartella archivio', p.cartella)}
    </dl>

    <div class="sect-title">Oggetto</div>
    <p style="margin:0 0 14px;white-space:pre-line">${esc(p.oggetto || '—')}</p>

    ${p.note ? `<div class="sect-title">Note</div><p style="margin:0 0 14px;white-space:pre-line">${esc(p.note)}</p>` : ''}

    <div class="sect-title">Documenti allegati</div>
    <ul class="att-list" id="att-list">
      ${(allegati || []).map((a) => `
        <li class="att-item">
          <span class="nm">${esc(a.nome)}</span>
          ${a.timbrato ? '<span class="tag">timbrato</span>' : ''}
          <button class="btn btn-ghost btn-sm" data-az="scarica" data-path="${esc(a.path)}" data-nome="${esc(a.nome)}">Apri</button>
          ${!a.timbrato && /\.pdf$/i.test(a.nome) ? `<button class="btn btn-ghost btn-sm" data-az="timbra" data-att="${a.id}">Timbra</button>` : ''}
          <button class="icon-btn" data-az="elimina-all" data-att="${a.id}" data-path="${esc(a.path)}" title="Elimina">🗑</button>
        </li>`).join('') || '<li class="empty" style="padding:12px">Nessun documento allegato.</li>'}
    </ul>
    <input type="file" id="att-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.eml,.msg" style="display:none">
    <button class="btn btn-ghost btn-sm" data-az="carica">＋ Allega un documento</button>
    ${p.drive_url ? `<p style="margin-top:10px;font-size:12px"><a href="${esc(p.drive_url)}" target="_blank" rel="noopener">Documento su Drive ↗</a></p>` : ''}

    <div class="sect-title">Azioni</div>
    <div class="drawer-actions">
      <button class="btn btn-primary btn-sm" data-az="modifica">Modifica</button>
      <button class="btn btn-ghost btn-sm" data-az="mail">✉️ Avviso di protocollazione</button>
      <button class="btn btn-ghost btn-sm" data-az="copia">Duplica come nuovo</button>
      ${p.impresa_id ? '<button class="btn btn-ghost btn-sm" data-az="impresa">🏢 Scheda impresa</button>' : ''}
      ${p.annullato
        ? '<button class="btn btn-ghost btn-sm" data-az="ripristina">Togli annullamento</button>'
        : '<button class="btn btn-ghost btn-sm" data-az="annulla">Annulla protocollo</button>'}
    </div>
    <p style="font-size:11px;color:var(--testo-soft);margin-top:14px">
      ${p.mail_inviata_at ? `Avviso inviato il ${dataIt(p.mail_inviata_at)} a ${esc(p.mail_destinatari || '')}.<br>` : ''}
      Inserito da ${esc(p.creato_da || 'archivio Access')}${p.created_at ? ` il ${dataIt(p.created_at)}` : ''}.
      Il numero di protocollo non è modificabile.
    </p>`;

  apriDrawer(`Protocollo ${protocolloEsteso(p)} del ${dataIt(p.data_prot)}`, p.direzione, html);
}

/* ── azioni del drawer ────────────────────────────────────── */
async function gestisciAzioneDrawer(e) {
  const btn = e.target.closest('[data-az]');
  if (!btn || !recordCorrente) return;
  const az = btn.dataset.az;
  const p = recordCorrente;

  if (az === 'modifica') { chiudiDrawer(); apriForm(p.direzione, p); return; }

  if (az === 'copia') {
    chiudiDrawer();
    const copia = { ...p };
    delete copia.id; delete copia.numero; delete copia.created_at;
    copia.data_prot = oggiIso();
    apriForm(p.direzione, copia, true);
    return;
  }

  if (az === 'impresa') {
    chiudiDrawer();
    const { apriScheda } = await import('./imprese.js');
    apriScheda(p.impresa_id);
    return;
  }

  if (az === 'carica') { $('#att-file').click(); $('#att-file').onchange = (ev) => caricaAllegato(ev.target.files[0]); return; }

  if (az === 'scarica') {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(btn.dataset.path, 300);
    if (error) return toast('Non riesco ad aprire il documento: ' + error.message, 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
    return;
  }

  if (az === 'elimina-all') {
    if (!confirm('Elimino questo allegato dal protocollo?')) return;
    await sb.storage.from(BUCKET).remove([btn.dataset.path]);
    await sb.from('s_prot_allegati').delete().eq('id', Number(btn.dataset.att));
    toast('Allegato eliminato.', 'ok');
    apriDettaglio(p.id);
    return;
  }

  if (az === 'timbra') {
    attendi(btn, true, 'Timbro…');
    try {
      const { timbraAllegato } = await import('./timbro.js');
      await timbraAllegato(Number(btn.dataset.att), p);
      toast('Documento timbrato.', 'ok');
      apriDettaglio(p.id);
    } catch (err) {
      toast('Timbro non riuscito: ' + err.message, 'err');
      attendi(btn, false);
    }
    return;
  }

  if (az === 'mail') {
    const { apriDialogoMail } = await import('./mail.js');
    apriDialogoMail(p);
    return;
  }

  if (az === 'annulla') {
    const motivo = prompt('Motivo dell\'annullamento (resta scritto nel registro):', '');
    if (motivo === null) return;
    await sb.from('s_protocollo').update({
      annullato: true, annullato_motivo: motivo, aggiornato_da: state.email,
    }).eq('id', p.id);
    toast('Protocollo annullato.', 'ok');
    apriDettaglio(p.id); caricaElenco();
    return;
  }

  if (az === 'ripristina') {
    await sb.from('s_protocollo').update({
      annullato: false, annullato_motivo: null, aggiornato_da: state.email,
    }).eq('id', p.id);
    toast('Annullamento rimosso.', 'ok');
    apriDettaglio(p.id); caricaElenco();
  }
}

async function caricaAllegato(file) {
  if (!file || !recordCorrente) return;
  const p = recordCorrente;
  if (file.size > 50 * 1024 * 1024) return toast('Il file supera i 50 MB.', 'err');

  const anno = String(p.data_prot || oggiIso()).slice(0, 4);
  const pulito = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${anno}/${p.direzione}/${codiceProtocollo(p)}/${Date.now()}_${pulito}`;

  toast('Caricamento in corso…');
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) return toast('Caricamento non riuscito: ' + error.message, 'err');

  await sb.from('s_prot_allegati').insert({
    protocollo_id: p.id, nome: file.name, path, mime: file.type,
    dimensione: file.size, created_by: state.email,
  });
  toast('Documento allegato.', 'ok');
  apriDettaglio(p.id);
}

/* ══════════════ FORM ══════════════ */
export async function apriForm(direzione, record = null, duplica = false) {
  modificaId = record && !duplica ? record.id : null;
  const inn = direzione === 'IN';
  const r = record || {};

  /* Anteprima del prossimo protocollo. Quale serie usare lo decide
     il database dalla data, quindi la si richiede daccapo a ogni
     cambio di data: il 30 settembre e il 1 ottobre danno due numeri
     di due serie diverse. */
  let anteprima = null;
  if (!modificaId) anteprima = await anteprimaProtocollo(direzione, r.data_prot || oggiIso());
  const codiceMostrato = modificaId ? codiceProtocollo(r) : (anteprima?.codice ?? '—');

  $('#form-title').textContent = modificaId
    ? `Modifica protocollo n° ${r.numero} (${inn ? 'entrata' : 'uscita'})`
    : `Nuovo protocollo in ${inn ? 'ENTRATA' : 'USCITA'}`;

  const optTipi = state.tipiDoc.map((t) =>
    `<option value="${t.id_doc}" ${Number(r.tipo_doc_id) === t.id_doc ? 'selected' : ''}>${esc(t.descrizione)}</option>`).join('');
  const optUff = UFFICI.map((u) => `<option ${r.ufficio === u ? 'selected' : ''}>${esc(u)}</option>`).join('');
  const optMezzi = MEZZI.map((m) => `<option ${normalizzaMezzo(r.mezzo) === m ? 'selected' : ''}>${esc(m)}</option>`).join('');

  /* Maschera compatta: due colonne e misure verticali strette, per
     vederla tutta senza scorrere. Il protocollo si compila molte volte
     al giorno e ogni scroll e' tempo perso. */
  const host = $('#form-host');
  host.className = `form-host compatta dir-${direzione}`;
  host.innerHTML = `
    <div class="f-testa">
      <div class="numero-box">
        <span class="lbl">${modificaId ? 'Protocollo' : 'Prossimo protocollo'}</span>
        <span class="n${codiceMostrato.length > 6 ? ' lungo' : ''}" id="c-numero">${esc(codiceMostrato)}</span>
        <span class="serie" id="c-serie">${esc(notaSerie(anteprima, inn, modificaId ? r : null))}</span>
      </div>
      <div class="field">
        <label for="c-data_prot">Data di protocollo</label>
        <input type="date" id="c-data_prot" value="${r.data_prot || oggiIso()}">
      </div>
      <div class="field">
        <label for="c-oggetto">Oggetto</label>
        <input type="text" id="c-oggetto" value="${esc(r.oggetto || '')}" placeholder="Oggetto del documento" maxlength="300">
      </div>
    </div>

    <div class="f-colonne">
      <div class="f-col">
        <fieldset class="fieldset">
          <legend>${inn ? 'Mittente' : 'Destinatario'}</legend>
          <div class="grid">
            <div class="field full ac-wrap">
              <label for="c-impresa">${inn ? 'Mittente impresa' : 'Destinatario impresa'}</label>
              <input type="text" id="c-impresa" value="${esc(r.impresa_nome || '')}" placeholder="Almeno 3 lettere della ragione sociale...">
              <input type="hidden" id="c-impresa_id" value="${esc(r.impresa_id || '')}">
              <span class="hint" id="hint-impresa">${r.impresa_id ? 'Agganciata all\'anagrafica (CF ' + esc(r.impresa_id) + ')' : 'Se non e\' in anagrafica, scrivi comunque il nome.'}</span>
            </div>
            <div class="field ac-wrap">
              <label for="c-persona">${inn ? 'Mittente persona' : 'Destinatario persona'}</label>
              <input type="text" id="c-persona" value="${esc(r.persona || '')}" placeholder="Cognome Nome...">
            </div>
            ${inn ? `
            <div class="field">
              <label for="c-alla_ca">Assegnato a</label>
              <input type="text" id="c-alla_ca" list="dl-assegnati" value="${esc(r.alla_ca || 'Squizzato Sig. Renato')}">
              <datalist id="dl-assegnati">${assegnatiNoti.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
            </div>` : `
            <div class="field">
              <label>Alla cortese attenzione</label>
              <span class="hint" style="padding-top:7px">Si ricava dal destinatario: la persona se c\'e\', altrimenti la ragione sociale.</span>
            </div>`}
          </div>
        </fieldset>

        <fieldset class="fieldset">
          <legend>Documento</legend>
          <div class="grid-3">
            <div class="field">
              <label for="c-tipo">Tipo documento</label>
              <select id="c-tipo"><option value="">&mdash;</option>${optTipi}</select>
            </div>
            <div class="field">
              <label for="c-data_doc">Data del documento</label>
              <input type="date" id="c-data_doc" value="${r.data_doc || ''}">
            </div>
            <div class="field">
              <label for="c-vostro">${inn ? 'Vostro protocollo' : 'Riferimento'}</label>
              <input type="text" id="c-vostro" value="${esc(r.vostro_protocollo || '')}">
            </div>
          </div>
          <div class="field full" style="margin-top:8px">
            <label for="c-note">${inn ? 'Note &mdash; corpo della mail' : 'Note &mdash; testo della comunicazione'}</label>
            <textarea id="c-note" placeholder="Testo o annotazioni...">${esc(r.note || '')}</textarea>
          </div>
        </fieldset>
      </div>

      <div class="f-col">
        <fieldset class="fieldset">
          <legend>Gestione interna</legend>
          <div class="grid">
            <div class="field">
              <label for="c-ufficio">Ufficio</label>
              <select id="c-ufficio">${optUff}</select>
            </div>
            <div class="field">
              <label for="c-mezzo">Mezzo</label>
              <select id="c-mezzo">${optMezzi}</select>
            </div>
            <div class="field full">
              <label for="c-referente">Referente</label>
              <input type="text" id="c-referente" list="dl-referenti" value="${esc(r.referente || 'Squizzato Sig. Renato')}">
              <datalist id="dl-referenti">${referentiNoti.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
            </div>
            <div class="field full">
              <label for="c-cartella">Cartella di archivio</label>
              <input type="text" id="c-cartella" list="dl-cartelle" value="${esc(r.cartella || '')}" placeholder="Es. CARTELLA - ASSEVERAZIONE - Documenti">
              <datalist id="dl-cartelle">${cartelleNote.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
            </div>
            <div class="field full">
              <label for="c-drive">Link al documento (Drive)</label>
              <input type="text" id="c-drive" value="${esc(r.drive_url || '')}" placeholder="https://drive.google.com/...">
            </div>
          </div>
        </fieldset>

        ${modificaId ? '' : `
        <fieldset class="fieldset">
          <legend>Documento da protocollare</legend>
          <div class="field">
            <input type="file" id="c-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.eml,.msg">
          </div>
          <div class="field" style="margin-top:6px">
            <label style="font-weight:400"><input type="checkbox" id="c-timbra" style="width:auto" checked> Timbra subito il PDF con numero, data e QR</label>
          </div>
        </fieldset>`}
      </div>
    </div>

    <div class="form-actions">
      <button class="btn btn-ghost" id="btn-annulla-form">Annulla</button>
      <button class="btn ${inn ? 'btn-in' : 'btn-out'}" id="btn-salva">
        ${modificaId ? 'Salva le modifiche' : `Protocolla ${esc(codiceMostrato)}`}
      </button>
    </div>`;

  mostraVista('form');

  /* La data comanda la serie: se cambia, cambia il numero proposto. */
  if (!modificaId) {
    $('#c-data_prot').addEventListener('change', async () => {
      const a = await anteprimaProtocollo(direzione, $('#c-data_prot').value || oggiIso());
      if (!a) return;
      anteprima = a;
      const el = $('#c-numero');
      el.textContent = a.codice;
      el.classList.toggle('lungo', a.codice.length > 6);
      $('#c-serie').textContent = notaSerie(a, inn, null);
      $('#btn-salva').textContent = `Protocolla ${a.codice}`;
    });
  }

  /* aggancio anagrafica imprese */
  autocompleta($('#c-impresa'), cercaImprese, (scelta) => {
    $('#c-impresa').value = scelta.impresa_nome;
    $('#c-impresa_id').value = scelta.impresa_id;
    $('#hint-impresa').textContent = `Agganciata all'anagrafica (CF ${scelta.impresa_id})`;
  }, () => { $('#c-impresa_id').value = ''; $('#hint-impresa').textContent = 'Nome scritto a mano, non agganciato all\'anagrafica.'; });

  autocompleta($('#c-persona'), cercaPersone, (scelta) => {
    $('#c-persona').value = scelta.etichetta;
  });

  $('#btn-annulla-form').addEventListener('click', () => { mostraVista('registro'); caricaElenco(); });
  $('#btn-salva').addEventListener('click', salva);
}

/* Chiede al database quale numero toccherebbe, senza assegnarlo. */
async function anteprimaProtocollo(direzione, data) {
  const { data: a, error } = await sb.rpc('s_prossimo_protocollo', { p_dir: direzione, p_data: data });
  if (error) { toast('Non riesco a leggere il prossimo numero: ' + error.message, 'err'); return null; }
  return a;
}

/* Riga sotto al numero: dice a quale registro appartiene. */
function notaSerie(a, inn, rec) {
  const dir = inn ? 'entrata' : 'uscita';
  if (rec) {
    return rec.esercizio
      ? `serie unica · esercizio ${rec.esercizio} · ${dir}`
      : `registro ${dir} · serie storica`;
  }
  if (!a) return '';
  return a.serie === 'unica'
    ? `serie unica · esercizio ${a.esercizio} · ${dir}`
    : `registro ${dir} · serie storica, il passaggio non è ancora avvenuto`;
}

/* ── salvataggio ──────────────────────────────────────────── */
async function salva(ev) {
  const btn = ev.currentTarget;
  const tipoSel = $('#c-tipo');
  const dati = {
    data_prot: $('#c-data_prot').value || oggiIso(),
    data_doc: $('#c-data_doc').value || null,
    impresa_nome: $('#c-impresa').value.trim() || null,
    impresa_id: $('#c-impresa_id').value.trim() || null,
    persona: $('#c-persona').value.trim() || null,
    /* In uscita non si scrive: si ricava dal destinatario al momento
       dell'uso. In entrata invece porta l'informazione vera, cioe' a chi
       in ufficio e' assegnato il documento in arrivo. */
    alla_ca: $('#c-alla_ca')?.value.trim() || null,
    vostro_protocollo: $('#c-vostro').value.trim() || null,
    oggetto: $('#c-oggetto').value.trim() || null,
    note: $('#c-note').value.trim() || null,
    ufficio: $('#c-ufficio').value || null,
    referente: $('#c-referente').value.trim() || null,
    mezzo: $('#c-mezzo').value || null,
    tipo_doc_id: tipoSel.value ? Number(tipoSel.value) : null,
    tipo_doc_txt: tipoSel.value ? tipoSel.options[tipoSel.selectedIndex].text : null,
    cartella: $('#c-cartella').value.trim() || null,
    drive_url: $('#c-drive').value.trim() || null,
  };

  if (!dati.oggetto) { toast('L\'oggetto è obbligatorio.', 'err'); $('#c-oggetto').focus(); return; }

  attendi(btn, true, 'Salvataggio…');

  /* ── modifica ── */
  if (modificaId) {
    const { error } = await sb.from('s_protocollo')
      .update({ ...dati, aggiornato_da: state.email }).eq('id', modificaId);
    attendi(btn, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Modifiche salvate.', 'ok');
    mostraVista('registro'); caricaElenco();
    return;
  }

  /* ── nuovo: il numero lo assegna il database ── */
  const direzione = $('#form-host').classList.contains('dir-IN') ? 'IN' : 'OUT';
  const { data: nuovo, error } = await sb.rpc('s_crea_protocollo', { p: { ...dati, direzione } });
  if (error) { attendi(btn, false); return toast('Protocollazione non riuscita: ' + error.message, 'err'); }

  /* allegato + timbro */
  const file = $('#c-file')?.files?.[0];
  if (file) {
    const anno = String(nuovo.data_prot).slice(0, 4);
    const pulito = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${anno}/${nuovo.direzione}/${codiceProtocollo(nuovo)}/${Date.now()}_${pulito}`;
    const { error: errUp } = await sb.storage.from(BUCKET).upload(path, file);
    if (errUp) toast('Protocollo salvato, ma il file non è stato caricato: ' + errUp.message, 'err');
    else {
      const { data: att } = await sb.from('s_prot_allegati').insert({
        protocollo_id: nuovo.id, nome: file.name, path, mime: file.type,
        dimensione: file.size, principale: true, created_by: state.email,
      }).select().single();

      if (att && $('#c-timbra')?.checked && /pdf$/i.test(file.name)) {
        try {
          const { timbraAllegato } = await import('./timbro.js');
          await timbraAllegato(att.id, nuovo);
        } catch (err) { toast('Timbro non riuscito: ' + err.message, 'err'); }
      }
    }
  }

  attendi(btn, false);
  toast(`Protocollo ${codiceProtocollo(nuovo)} registrato.`, 'ok');
  mostraVista('registro');
  await caricaElenco();
  apriDettaglio(nuovo.id);
}

/* ══════════════ AUTOCOMPLETAMENTO ══════════════ */
async function cercaImprese(testo) {
  const { data } = await sb.from('imprese')
    .select('impresa_id, impresa_nome, comune, prov')
    .ilike('impresa_nome', `%${testo}%`)
    .limit(12);
  return (data || []).map((x) => ({
    ...x,
    etichetta: x.impresa_nome,
    dettaglio: [x.comune, x.prov].filter(Boolean).join(' — '),
  }));
}

async function cercaPersone(testo) {
  const { data } = await sb.from('persone')
    .select('persona_id, titolo, nome, cognome, qualifica')
    .or(`cognome.ilike.%${testo}%,nome.ilike.%${testo}%`)
    .limit(12);
  return (data || []).map((x) => ({
    ...x,
    etichetta: [x.cognome, x.titolo, x.nome].filter(Boolean).join(' '),
    dettaglio: x.qualifica || '',
  }));
}

function autocompleta(input, cerca, onScelta, onLibero) {
  if (!input) return;
  let lista = null, timer, voci = [], sel = -1;

  const chiudi = () => { lista?.remove(); lista = null; sel = -1; };

  input.addEventListener('input', () => {
    onLibero?.();
    const t = input.value.trim();
    clearTimeout(timer);
    if (t.length < 3) return chiudi();
    timer = setTimeout(async () => {
      voci = await cerca(t);
      chiudi();
      if (!voci.length) return;
      lista = document.createElement('div');
      lista.className = 'ac-list';
      lista.innerHTML = voci.map((v, i) =>
        `<div class="ac-item" data-i="${i}">${esc(v.etichetta)}${v.dettaglio ? `<small>${esc(v.dettaglio)}</small>` : ''}</div>`).join('');
      input.parentElement.appendChild(lista);
      lista.addEventListener('mousedown', (e) => {
        const it = e.target.closest('.ac-item');
        if (it) { onScelta(voci[Number(it.dataset.i)]); chiudi(); }
      });
    }, 280);
  });

  input.addEventListener('keydown', (e) => {
    if (!lista) return;
    const items = $$('.ac-item', lista);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = e.key === 'ArrowDown' ? Math.min(sel + 1, items.length - 1) : Math.max(sel - 1, 0);
      items.forEach((it, i) => it.classList.toggle('is-sel', i === sel));
      items[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && sel >= 0) {
      e.preventDefault(); onScelta(voci[sel]); chiudi();
    } else if (e.key === 'Escape') chiudi();
  });

  input.addEventListener('blur', () => setTimeout(chiudi, 150));
}
