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
import { PAGE_SIZE } from './config.js';
import { agganci, caricaFile, cestina, dove, idDaLink, risolviCartella, sfoglia, LIMITE_MB } from './drive.js';
import { UFFICI, MEZZI, normalizzaMezzo, vuoleTimbro, PERCHE_NIENTE_TIMBRO } from './lookups.js';
import { CARTELLE_VAULT } from './cartelle-vault.js';

/* ── stato del modulo ─────────────────────────────────────── */
const f = { direzione: '', testo: '', anno: '', tipo: '', ufficio: '' };
let pagina = 0;
let totale = 0;
let cartelleNote = [];
let referentiNoti = [];
let assegnatiNoti = [];
let recordCorrente = null;
let modificaId = null;
let dopoSalvaCb = null;

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
      `sintesi.ilike.%${t}%`,
      `scadenze.ilike.%${t}%`,
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
      ${p.cartella_access && p.cartella_access !== p.cartella
        ? `<dt>Diceva in Access</dt><dd style="color:var(--testo-soft)">${esc(p.cartella_access)}</dd>` : ''}
    </dl>

    <div class="sect-title">Oggetto</div>
    <p style="margin:0 0 14px;white-space:pre-line">${esc(p.oggetto || '—')}</p>

    ${p.scadenze ? `
      <div class="sect-title">Scadenze</div>
      <p class="avviso-scadenza" style="margin:0 0 14px;white-space:pre-line">${esc(p.scadenze)}</p>` : ''}

    ${p.sintesi ? `<div class="sect-title">Sintesi</div><p style="margin:0 0 14px;white-space:pre-line">${esc(p.sintesi)}</p>` : ''}

    ${p.note ? `
      <div class="sect-title">Note — testo ${inn ? 'ricevuto' : 'spedito'}</div>
      <p style="margin:0 0 14px;white-space:pre-line">${esc(p.note)}</p>` : ''}

    <div class="sect-title">Documenti protocollati</div>
    <p class="hint" style="margin:-6px 0 8px">
      I documenti vengono smistati nel vault come tutto il resto: qui il protocollo
      dice <strong>dove sono finiti</strong>. Il link punta sempre al singolo file, e
      regge anche dopo lo spostamento.
    </p>
    <ul class="att-list" id="att-list">
      ${(allegati || []).map((a) => `
        <li class="att-item">
          <span class="nm">${esc(a.nome)}
            ${a.drive_file_id ? `<span class="cell-sub" data-dove="${esc(a.drive_file_id)}">cerco dov'è…</span>` : ''}
          </span>
          ${a.timbrato ? '<span class="tag">timbrato</span>' : ''}
          <button class="btn btn-ghost btn-sm" data-az="scarica" data-url="${esc(a.drive_url || '')}" data-nome="${esc(a.nome)}">Apri su Drive ↗</button>
          ${/\.pdf$/i.test(a.nome) ? `<button class="btn btn-ghost btn-sm" data-az="timbra" data-att="${a.id}">${a.timbrato ? 'Timbra di nuovo' : 'Timbra'}</button>` : ''}
          <button class="icon-btn" data-az="elimina-all" data-att="${a.id}" data-drive="${esc(a.drive_file_id || '')}" title="Metti nel cestino di Drive">🗑</button>
        </li>`).join('') || '<li class="empty" style="padding:12px">Nessun documento allegato.</li>'}
    </ul>
    <input type="file" id="att-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.eml,.msg" style="display:none">
    <button class="btn btn-ghost btn-sm" data-az="collega">🔗 Collega un documento già su Drive</button>
    <button class="btn btn-ghost btn-sm" data-az="carica">＋ Carica un documento nuovo</button>
    <p class="hint" style="margin:6px 0 0">
      <strong>Collega</strong> se il documento sta già nel vault: resta dov'è, e il timbrato
      gli nascerà accanto. <strong>Carica</strong> solo per un documento che non è ancora stato
      processato: finisce in <code>00_INBOX/_protocollo</code>, da smistare.
    </p>
    ${p.drive_url ? `<p style="margin-top:10px;font-size:12px"><a href="${esc(p.drive_url)}" target="_blank" rel="noopener">Documento su Drive ↗</a></p>` : ''}

    <div class="sect-title">Azioni</div>
    <div class="drawer-actions">
      <button class="btn btn-primary btn-sm" data-az="modifica">Modifica</button>
      <button class="btn btn-ghost btn-sm" data-az="timbra-doc">🖃 Timbra un documento</button>
      ${p.direzione === 'IN' ? '<button class="btn btn-ghost btn-sm" data-az="avviso">✉️ Avviso al mittente</button>' : ''}
      <button class="btn btn-ghost btn-sm" data-az="inoltra">📨 Inoltra</button>
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

  /* I documenti che portano il numero nel nome si agganciano da soli.
     Anche questo dopo il render, per la stessa ragione. */
  agganciaDalNome(p, allegati || []);

  /* Dove sta adesso ogni documento. Si chiede a Drive dopo aver
     mostrato il pannello: e' la parte lenta, e non deve far
     aspettare tutto il resto. */
  $$('[data-dove]').forEach(async (el) => {
    try {
      const d = await dove(el.dataset.dove);
      el.textContent = d.cestinato ? '⚠️ nel cestino di Drive' : '📁 ' + (d.cartella || 'Drive');
      el.title = d.cartella || '';
    } catch (err) {
      el.textContent = 'posizione non leggibile';
      el.title = err.message;
    }
  });
}

/* ── i documenti si trovano da soli ─────────────────────────
   La regola dell'ufficio dice che il numero di protocollo va scritto
   nel NOME del file, perche' chi sfoglia Drive lo riconosca. Allora
   lo riconosce anche l'app: qui si cercano i file che portano questo
   protocollo nel nome e si collegano da soli, senza che nessuno vada
   a ripescare i link a mano. Poi si sceglie solo che cosa timbrare.

   Vale per i documenti battezzati con la forma nuova (`Prot_2012-in`,
   o il codice in testa). Sui file storici, che portano `_Prot1450`
   senza direzione, non scatta — e non deve: quel numero da solo non
   dice a quale dei due registri appartiene, ed e' proprio l'equivoco
   che il suffisso `-in`/`-out` e' nato per togliere.                */
async function agganciaDalNome(p, gia) {
  let trovati;
  try { trovati = (await agganci(codiceProtocollo(p))).voci || []; }
  catch { return; }                       /* silenzioso: e' un aiuto, non un obbligo */

  const noti = new Set((gia || []).map((a) => a.drive_file_id).filter(Boolean));
  const nuovi = trovati.filter((v) => !noti.has(v.id));
  if (!nuovi.length) return;

  const { error } = await sb.from('s_prot_allegati').insert(nuovi.map((v) => ({
    protocollo_id: p.id, nome: v.nome, mime: v.mime,
    dimensione: v.dimensione, drive_file_id: v.id, drive_url: v.drive_url,
    created_by: state.email,
  })));
  if (error) { toast('Documenti trovati ma non collegati: ' + error.message, 'err'); return; }

  toast(nuovi.length === 1
    ? `Collegato dal nome: ${nuovi[0].nome}`
    : `Collegati dal nome ${nuovi.length} documenti che portano ${codiceProtocollo(p)}.`, 'ok');

  /* Se il protocollo non aveva ancora un documento principale, lo
     diventa il primo PDF trovato: e' quello che si timbra e che si
     allega alle mail. */
  if (!p.drive_file_id) {
    const pdf = nuovi.find((v) => /\.pdf$/i.test(v.nome)) || nuovi[0];
    await sb.from('s_protocollo')
      .update({ drive_file_id: pdf.id, drive_url: pdf.drive_url }).eq('id', p.id);
  }
  if (recordCorrente?.id === p.id) apriDettaglio(p.id);
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

  if (az === 'collega') { collegaDaDrive(); return; }

  if (az === 'scarica') {
    /* Il documento sta su Drive: si apre di la'. Non e' pubblico —
       lo vede chi ha accesso alla cartella dell'ente. */
    const url = btn.dataset.url;
    if (!url) return toast('Questo allegato non ha un link su Drive.', 'err');
    window.open(url, '_blank', 'noopener');
    return;
  }

  if (az === 'elimina-all') {
    if (!confirm('Tolgo questo documento dal protocollo?\n\nIl file va nel cestino di Drive, da cui si recupera.')) return;
    try {
      if (btn.dataset.drive) await cestina(btn.dataset.drive);
    } catch (err) { toast('Non riesco a spostarlo nel cestino: ' + err.message, 'err'); return; }
    await sb.from('s_prot_allegati').delete().eq('id', Number(btn.dataset.att));
    toast('Documento tolto dal protocollo e messo nel cestino di Drive.', 'ok');
    apriDettaglio(p.id);
    return;
  }

  if (az === 'timbra') { timbra(Number(btn.dataset.att)); return; }

  if (az === 'timbra-doc') { chiediQualeDocumento(); return; }

  if (az === 'avviso' || az === 'inoltra') {
    const { apriDialogoMail } = await import('./mail.js');
    apriDialogoMail(p, az === 'avviso' ? 'avviso' : 'inoltra');
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

async function caricaAllegato(file, poiTimbra = false) {
  if (!file || !recordCorrente) return;
  const p = recordCorrente;
  if (file.size > LIMITE_MB * 1024 * 1024) {
    return toast(`Il file supera i ${LIMITE_MB} MB: mettilo a mano nella cartella su Drive `
      + 'e incolla il link nel campo «Link al documento».', 'err');
  }

  toast('Caricamento su Drive in corso…');
  let su;
  try { su = await caricaFile(p, file); }
  catch (err) { return toast('Caricamento non riuscito: ' + err.message, 'err'); }

  const { data: att } = await sb.from('s_prot_allegati').insert({
    protocollo_id: p.id, nome: su.file_name || file.name, mime: file.type,
    dimensione: file.size, created_by: state.email,
    drive_file_id: su.drive_file_id, drive_url: su.drive_url,
  }).select().single();
  toast('Documento caricato su Drive e allegato al protocollo.', 'ok');

  /* Se il documento e' stato caricato apposta per timbrarlo, si va
     dritti all'anteprima invece di far ricominciare da capo. */
  if (poiTimbra && att && /\.pdf$/i.test(file.name)) return timbra(att.id);
  apriDettaglio(p.id);
}

/* ── collegare un documento che sta GIÀ su Drive ────────────
   Serve per i documenti già archiviati nel vault: non si ricarica
   niente, si registra dov'è. È la differenza che mancava — senza,
   l'unico modo di allegare era caricare dal PC, e la copia caricata
   finiva nella zona d'attesa insieme al suo timbrato.            */
async function collegaDaDrive() {
  const scelto = await sfogliaDrive({ partiDa: recordCorrente?.cartella || null });
  if (!scelto) return;
  await registraAllegato(scelto.id, scelto.nome, scelto.cartella);
}

/* Registra un documento di Drive come allegato di questo protocollo.
   Non copia e non sposta niente: scrive solo che quel file appartiene
   a questo protocollo, e dove sta. */
async function registraAllegato(id, nome, cartella) {
  const p = recordCorrente;
  const { data: gia } = await sb.from('s_prot_allegati')
    .select('id').eq('protocollo_id', p.id).eq('drive_file_id', id).maybeSingle();
  if (gia) return toast('Quel documento è già collegato a questo protocollo.', 'err');

  let d = { nome, cartella, drive_url: `https://drive.google.com/file/d/${id}/view` };
  try { d = { ...d, ...(await dove(id)) }; }
  catch (err) { toast('Collegato, ma non riesco a leggerne la posizione: ' + err.message, 'err'); }
  if (d.cestinato) return toast('Quel documento sta nel cestino di Drive.', 'err');

  await sb.from('s_prot_allegati').insert({
    protocollo_id: p.id, nome: d.nome,
    drive_file_id: id, drive_url: d.drive_url, created_by: state.email,
  });
  toast(`Collegato: ${d.nome} — ${d.cartella || 'Drive'}`, 'ok');
  apriDettaglio(p.id);
}

/* ── sfogliare Drive dall'app ───────────────────────────────
   Si naviga fra le cartelle del vault come in un gestore file,
   oppure si cerca per nome. Serve a non dover aprire Drive in
   un'altra scheda per andare a copiare un link a mano.        */
function sfogliaDrive({ partiDa = null } = {}) {
  return new Promise((risolvi) => {
    const bg = document.createElement('div');
    bg.className = 'drawer-bg ant-bg';
    bg.style.zIndex = 63;
    bg.innerHTML = `
      <div class="ant-box" style="width:min(660px,96vw);max-height:88vh">
        <div class="ant-testa">
          <div>
            <h3>Quale documento?</h3>
            <p>Si sfogliano le cartelle del vault. Il documento <strong>resta dov'è</strong>:
               il protocollo prende solo nota di dove sta.${partiDa
                 ? ` Si parte da <code>${esc(partiDa)}</code>, la cartella di archivio di questo
                    protocollo; da lì ci si sposta dove si vuole.` : ''}</p>
          </div>
        </div>
        <div style="padding:10px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="sf-su">↑ Su</button>
          <input type="text" id="sf-cerca" class="inp inp-sm" placeholder="Cerca per nome in tutto il Drive…" style="flex:1;min-width:180px">
        </div>
        <div class="sf-briciole" id="sf-briciole"></div>
        <div class="ant-foglio" id="sf-elenco" style="display:block;padding:0 16px 8px;background:#fff"></div>
        <div class="ant-piede">
          <span class="hint" id="sf-nota">Le cartelle si aprono con un clic; i documenti si scelgono.</span>
          <span style="flex:1"></span>
          <button class="btn btn-ghost btn-sm" id="sf-link">Ho il link</button>
          <button class="btn btn-ghost" id="sf-annulla">Annulla</button>
        </div>
      </div>`;
    document.body.appendChild(bg);

    const pila = [];                       // dove siamo scesi
    const elenco = $('#sf-elenco', bg);
    const briciole = $('#sf-briciole', bg);
    const nota = (t) => { $('#sf-nota', bg).textContent = t; };
    const chiudi = (esito) => { bg.remove(); risolvi(esito); };

    const misura = (n) => (n == null ? '' : n > 1048576
      ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

    /* Cartelle prima e in ordine di nome — altrimenti la radice del
       vault (00_INBOX, 1_PROGETTI, 2_AREE…) si scombina e non si
       trova più niente. I file invece dal più recente: quando si
       cerca un documento appena arrivato è quasi sempre in cima. */
    const ordina = (voci) => voci.sort((a, b) => {
      if (a.cartella !== b.cartella) return a.cartella ? -1 : 1;
      if (a.cartella) return a.nome.localeCompare(b.nome, 'it');
      return String(b.modificato || '').localeCompare(String(a.modificato || ''));
    });

    async function mostra(cerca = null) {
      elenco.innerHTML = '<p class="empty">Un istante…</p>';
      briciole.innerHTML = cerca
        ? `<span>Risultati per «${esc(cerca)}»</span>`
        : ['Vault', ...pila.map((x) => x.nome)]
          .map((n, i) => `<span data-liv="${i}">${esc(n)}</span>`).join('<i>›</i>');
      let voci;
      try { voci = ordina((await sfoglia({ parentId: pila.at(-1)?.id || null, cerca })).voci); }
      catch (err) { elenco.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
      if (!voci.length) { elenco.innerHTML = '<p class="empty">Qui non c\'è niente.</p>'; return; }
      elenco.innerHTML = voci.map((v) => `
        <div class="sf-riga" data-id="${esc(v.id)}" data-cart="${v.cartella ? 1 : 0}" data-nome="${esc(v.nome)}">
          <span class="sf-ico">${v.cartella ? '📁' : '📄'}</span>
          <span class="sf-nome">${esc(v.nome)}</span>
          <span class="sf-data">${v.cartella ? '' : dataIt(v.modificato)}</span>
          <span class="sf-dim">${misura(v.dimensione)}</span>
        </div>`).join('');
    }

    elenco.addEventListener('click', (ev) => {
      const r = ev.target.closest('.sf-riga');
      if (!r) return;
      if (r.dataset.cart === '1') {
        pila.push({ id: r.dataset.id, nome: r.dataset.nome });
        $('#sf-cerca', bg).value = '';
        mostra();
        return;
      }
      chiudi({ id: r.dataset.id, nome: r.dataset.nome, cartella: pila.map((x) => x.nome).join(' / ') });
    });

    briciole.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-liv]');
      if (!b) return;
      pila.length = Number(b.dataset.liv);
      mostra();
    });

    $('#sf-su', bg).addEventListener('click', () => { pila.pop(); mostra(); });

    let attesa;
    $('#sf-cerca', bg).addEventListener('input', (ev) => {
      clearTimeout(attesa);
      const t = ev.target.value.trim();
      attesa = setTimeout(() => mostra(t.length >= 3 ? t : null), 350);
    });

    /* la vecchia strada resta, per chi il link ce l'ha gia' in mano */
    $('#sf-link', bg).addEventListener('click', () => {
      const incollato = prompt('Incolla il link del documento su Drive (o il suo id):', '');
      if (incollato === null) return;
      if (/\/folders\//.test(incollato)) {
        return nota('Quello è il link di una cartella: serve il singolo file.');
      }
      const id = idDaLink(incollato);
      if (!id) return nota('Non riconosco un documento di Drive in quello che hai incollato.');
      chiudi({ id, nome: null, cartella: null });
    });

    $('#sf-annulla', bg).addEventListener('click', () => chiudi(null));
    bg.addEventListener('click', (ev) => { if (ev.target === bg) chiudi(null); });

    /* Non si parte dalla radice se si sa gia' dove guardare: il campo
       «Cartella di archivio» del protocollo dice dove quel documento e'
       stato messo, e nove volte su dieci e' li'. Le briciole restano
       cliccabili, «Vault» riporta in cima: si parte vicini, non chiusi. */
    (async () => {
      if (partiDa) {
        try {
          const r = await risolviCartella(partiDa);
          if (r.pila?.length) pila.push(...r.pila);
          if (r.mancante) {
            nota(pila.length
              ? `Di «${partiDa}» su Drive c'è fin qui; «${r.mancante}» non esiste.`
              : `«${partiDa}» su Drive non c'è: si parte dalla radice.`);
          }
        } catch { /* si parte dalla radice, come prima */ }
      }
      mostra();
    })();
  });
}

/* ── timbrare un documento di questo protocollo ─────────────
   Vale per i protocolli di oggi e per quelli del 2013: il timbro
   porta il numero e la data DEL PROTOCOLLO, non di oggi. E' la
   ristampa del timbro su un documento ritrovato o appena
   scansionato.                                                */
async function timbra(attId) {
  const p = recordCorrente;
  try {
    const { timbraAllegato } = await import('./timbro.js');
    const esito = await timbraAllegato(attId, p);
    toast(`Timbrato in ${esito.cartella || 'Drive'}. Originale ${esito.originale}.`, 'ok');
    apriDettaglio(p.id);
  } catch (err) {
    if (err.message !== 'Timbro annullato') toast('Timbro non riuscito: ' + err.message, 'err');
  }
}

/* Quale documento timbrare: uno di quelli gia' allegati, oppure
   uno nuovo da caricare. Se non ce n'e' nessuno — ed e' il caso di
   tutto l'archivio ereditato da Access — si va dritti al file. */
async function chiediQualeDocumento() {
  const p = recordCorrente;
  const { data: allegati } = await sb.from('s_prot_allegati')
    .select('id, nome, timbrato').eq('protocollo_id', p.id).order('id');
  const pdf = (allegati || []).filter((a) => /\.pdf$/i.test(a.nome));

  if (!pdf.length) {
    /* Nessun documento ancora: si chiede COME, perche' collegarne uno
       gia' archiviato e caricarne uno nuovo portano in due posti
       diversi, e la differenza conta. */
    const su = confirm(
      'Questo protocollo non ha ancora documenti.\n\n'
      + 'OK  → collego un documento che sta GIÀ su Drive (resta dov\'è)\n'
      + 'Annulla → carico un documento nuovo dal computer '
      + '(finisce in 00_INBOX/_protocollo, da smistare)');
    if (su) { collegaDaDrive(); return; }
    const inp = $('#att-file');
    inp.click();
    inp.onchange = (ev) => caricaAllegato(ev.target.files[0], true);
    return;
  }

  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  bg.style.zIndex = 62;
  bg.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;
                border-radius:10px;padding:22px;width:min(460px,94vw);box-shadow:var(--ombra)">
      <h3 style="margin:0 0 6px;font-size:17px">Quale documento timbro?</h3>
      <p style="margin:0 0 14px;color:var(--testo-soft);font-size:13px">
        Il timbro portera' <strong>${esc(codiceProtocollo(p))} del ${dataIt(p.data_prot)}</strong>,
        cioe' il numero e la data di questo protocollo — non quelli di oggi.
      </p>
      ${pdf.map((a) => `
        <button class="btn btn-ghost btn-block" data-att="${a.id}" style="text-align:left">
          ${esc(a.nome)}${a.timbrato ? ' <span class="tag">gia\' timbrato</span>' : ''}
        </button>`).join('')}
      <button class="btn btn-ghost btn-block" data-collega="1">🔗 Collega un documento già su Drive</button>
      <button class="btn btn-ghost btn-block" data-nuovo="1">＋ Carica un documento nuovo</button>
      <button class="btn btn-ghost btn-block" data-chiudi="1">Annulla</button>
    </div>`;
  document.body.appendChild(bg);

  bg.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-att],[data-nuovo],[data-collega],[data-chiudi]');
    if (!b && ev.target !== bg) return;
    bg.remove();
    if (!b || b.dataset.chiudi) return;
    if (b.dataset.collega) { collegaDaDrive(); return; }
    if (b.dataset.nuovo) {
      const inp = $('#att-file');
      inp.click();
      inp.onchange = (e2) => caricaAllegato(e2.target.files[0], true);
      return;
    }
    timbra(Number(b.dataset.att));
  });
}

/* ══════════════ FORM ══════════════ */
export async function apriForm(direzione, record = null, duplica = false, dopoSalva = null) {
  /* chi precompila la maschera (RLST, segnalazioni…) può farsi
     richiamare col protocollo appena creato, per collegarlo alla
     propria pratica senza ricopiare il numero a mano */
  dopoSalvaCb = typeof dopoSalva === 'function' ? dopoSalva : null;
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
            <textarea id="c-note" placeholder="${inn ? 'Incolla qui il testo della comunicazione ricevuta, tale e quale.' : 'Il testo della comunicazione in partenza, tale e quale.'}">${esc(r.note || '')}</textarea>
            <span class="hint"><strong>Solo il testo ${inn ? 'ricevuto' : 'spedito'}, parola per parola.</strong>
              Serve a ritrovare il protocollo cercando le parole ${inn ? 'che il mittente ha scritto' : 'scritte nella comunicazione'}:
              se ci si mette un riassunto, quelle parole qui dentro non ci sono pi&ugrave;.
              La lettura va in <em>Sintesi</em>, i termini in <em>Scadenze</em>.</span>
          </div>
          <div class="field full" style="margin-top:8px">
            <label for="c-scadenze">Scadenze &mdash; i termini che il documento impone</label>
            <textarea id="c-scadenze" rows="2" placeholder="Es. iscrizione entro il 04/09/2026">${esc(r.scadenze || '')}</textarea>
          </div>
          <div class="field full" style="margin-top:8px">
            <label for="c-sintesi">Sintesi &mdash; di che cosa si tratta</label>
            <textarea id="c-sintesi" rows="3" placeholder="Contesto, collegamenti ad altre pratiche, cose da decidere...">${esc(r.sintesi || '')}</textarea>
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
              <label for="c-cartella">Cartella di archivio — dove deve andare</label>
              <input type="text" id="c-cartella" list="dl-cartelle" value="${esc(r.cartella || '')}" placeholder="Es. 2_AREE/Asseverazione/imprese/01_CAVINATO_03347930285">
              <datalist id="dl-cartelle">
                ${CARTELLE_VAULT.map((x) => `<option value="${esc(x)}">`).join('')}
                ${cartelleNote.filter((x) => !CARTELLE_VAULT.includes(x)).map((x) => `<option value="${esc(x)}">`).join('')}
              </datalist>
              <span class="hint">Percorso del vault. Dice dove il documento <em>deve</em> stare; dov'è
                davvero lo legge da Drive il dettaglio del protocollo.</span>
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
            <span class="hint" id="hint-timbro"></span>
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

  /* Certi documenti il timbro non lo vogliono: l'attestato esce già
     completo. La spunta si toglie da sola, ma resta cliccabile. */
  aggiornaTimbro();
  $('#c-tipo').addEventListener('change', aggiornaTimbro);

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

/* La spunta del timbro segue il tipo di documento scelto. */
function aggiornaTimbro() {
  const sel = $('#c-tipo');
  const box = $('#c-timbra');
  if (!sel || !box) return;
  const tipo = sel.value ? sel.options[sel.selectedIndex].text : '';
  const serve = vuoleTimbro(tipo);
  box.checked = serve;
  $('#hint-timbro').textContent = serve ? '' : PERCHE_NIENTE_TIMBRO;
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
    scadenze: $('#c-scadenze')?.value.trim() || null,
    sintesi: $('#c-sintesi')?.value.trim() || null,
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
    try {
      const su = await caricaFile(nuovo, file);
      const { data: att } = await sb.from('s_prot_allegati').insert({
        protocollo_id: nuovo.id, nome: su.file_name || file.name, mime: file.type,
        dimensione: file.size, principale: true, created_by: state.email,
        drive_file_id: su.drive_file_id, drive_url: su.drive_url,
      }).select().single();

      /* il link del documento principale sta anche sulla riga del
         protocollo, cosi' si vede dall'elenco senza aprire nulla */
      await sb.from('s_protocollo').update({
        drive_file_id: su.drive_file_id, drive_url: su.drive_url,
      }).eq('id', nuovo.id);

      if (att && $('#c-timbra')?.checked && /pdf$/i.test(file.name)) {
        const { timbraAllegato } = await import('./timbro.js');
        await timbraAllegato(att.id, nuovo).catch((err) => {
          if (err.message !== 'Timbro annullato') toast('Timbro non riuscito: ' + err.message, 'err');
        });
      }
    } catch (err) {
      toast('Protocollo salvato, ma il documento non è stato caricato: ' + err.message, 'err');
    }
  }

  attendi(btn, false);
  toast(`Protocollo ${codiceProtocollo(nuovo)} registrato.`, 'ok');

  /* la pratica che ha precompilato la maschera si collega da sola */
  if (dopoSalvaCb) {
    try { await dopoSalvaCb(nuovo); } catch (e) { toast('Protocollo salvato, ma la pratica non si è collegata: ' + e.message, 'err'); }
    dopoSalvaCb = null;
  }

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
