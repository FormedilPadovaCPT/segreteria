/* ============================================================
   🎨 Immagine proposta dei post (09/11/2026, chiesto dall'utente)

   Nella scheda di un post (pagina Comunicazione) l'immagine arriva già
   proposta, disegnata nel browser col Brand Design System dell'ente
   (9_APPLICATIVI/Claude/DERSIGN Formedil Padova/): post 1080×1080,
   template A (arancione + foto), B (foto, velatura, fascia arancione con »),
   C (foto editoriale) o solo testo su bianco, Barlow, logo ufficiale.
   Modello, testi e foto partono dalla «Grafica suggerita» della redazione
   (regole in post-immagine.js); le foto sono l'archivio scelto da 5_MEDIA
   in img/foto-post/ (tools/prepara_foto_post.py), oppure una foto del computer.
   La persona corregge, vede l'anteprima cambiare, e la aggiunge al post
   (stessa strada del «⬆ Carica»: redazione-social, op «immagine») o la
   scarica. Niente parte da solo, niente QR né link nell'immagine (26/10/2026).
   ============================================================ */

import { sb, $, esc, toast, attendi } from './core.js';
import { LARGHEZZA as W, ALTEZZA as H, MODELLI, proposta, aCapo } from './post-immagine.js';

const F = 'Barlow, Arial, sans-serif';
const C = { arancio: '#e7500f', grigio: '#565c66', verde: '#6cd220', bianco: '#ffffff' };
const M = 64, FX = 540;

const carica = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('immagine non leggibile')); i.src = src; });
let _loghi = null, _archivio = null;
async function loghi() {
  if (!_loghi) _loghi = Promise.all([carica('img/logo-post-positivo.png'), carica('img/logo-post-negativo.png')]).then(([pos, neg]) => ({ pos, neg }));
  return _loghi;
}
export async function archivioFoto() {
  if (!_archivio) _archivio = fetch('img/foto-post/archivio.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return _archivio;
}
const _foto = new Map();
function fotoArchivio(rel) {
  if (!_foto.has(rel)) _foto.set(rel, carica(rel).catch((e) => { _foto.delete(rel); throw e; }));
  return _foto.get(rel);
}
async function caratteriPronti() {
  if (!document.fonts) return;
  await Promise.all(['800 260px Barlow', '700 90px Barlow', '600 46px Barlow', '500 31px Barlow', '400 24px Barlow']
    .map((f) => document.fonts.load(f).catch(() => null)));
}

const misuraDi = (ctx) => (t) => ctx.measureText(t).width;
function righe(ctx, testo, font, larg, max) { ctx.font = font; const r = aCapo(testo, larg, misuraDi(ctx), max); r.font = font; return r; }
function scrivi(ctx, rr, x, y, lh, colore) { if (rr.font) ctx.font = rr.font; ctx.fillStyle = colore; rr.forEach((r, i) => ctx.fillText(r, x, y + i * lh)); return y + rr.length * lh; }
function logo(ctx, img, x, y, h) { if (img) ctx.drawImage(img, x, y, img.width * h / img.height, h); }
/* la foto ritagliata a riempire un riquadro; `fuoco` 0-100 sposta l'inquadratura in orizzontale */
function riquadro(ctx, foto, x, y, w, h, fuoco) {
  if (!foto) { ctx.fillStyle = C.grigio; ctx.fillRect(x, y, w, h); return; }
  const s = Math.max(w / foto.width, h / foto.height);
  const fw = foto.width * s, fh = foto.height * s;
  const dx = (w - fw) * (Math.min(100, Math.max(0, fuoco ?? 50)) / 100);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(foto, x + dx, y + (h - fh) / 2, fw, fh); ctx.restore();
}
function velatura(ctx, alto, basso, da) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(0,0,0,${alto})`); g.addColorStop(da, `rgba(0,0,0,${alto})`); g.addColorStop(1, `rgba(0,0,0,${basso})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function fasciaArancio(ctx, testo) {
  const h = 150;
  ctx.fillStyle = C.arancio; ctx.fillRect(0, H - h, W, h);
  const rr = righe(ctx, (testo || '').toUpperCase(), `700 46px ${F}`, W - 2 * M - 120, 2);
  scrivi(ctx, rr, M, H - h + (h - rr.length * 54) / 2 + 40, 54, C.bianco);
  ctx.font = `700 110px ${F}`; ctx.fillStyle = C.bianco; ctx.fillText('»', W - M - 70, H - 32);
}

/* A: fondo arancione a sinistra, foto a destra, testo bianco */
function disegnaA(ctx, c, r) {
  ctx.fillStyle = C.arancio; ctx.fillRect(0, 0, W, H);
  riquadro(ctx, r.foto, FX, 0, W - FX, H, c.fuoco);
  ctx.fillStyle = C.grigio; ctx.fillRect(FX - 10, 0, 10, H);
  logo(ctx, r.neg, M, 64, 74);
  const larg = FX - 10 - M - 30;
  let y = 210;
  if (c.etichetta) { ctx.font = `600 28px ${F}`; ctx.fillStyle = C.grigio; ctx.fillText(c.etichetta.toUpperCase(), M, y); y += 40; }
  if (c.numero) {
    let px = 260; ctx.font = `800 ${px}px ${F}`;
    while (ctx.measureText(c.numero).width > larg && px > 120) { px -= 10; ctx.font = `800 ${px}px ${F}`; }
    ctx.fillStyle = C.bianco; ctx.fillText(c.numero, M - 6, y + px * 0.74); y += px * 0.74 + 20;
    if (c.didascalia) y = scrivi(ctx, righe(ctx, c.didascalia, `700 46px ${F}`, larg, 2), M, y + 46, 52, C.grigio) + 4;
  }
  const lungo = (c.titolo || '').length > 34 || c.numero;
  y = scrivi(ctx, righe(ctx, c.titolo, `${lungo ? 600 : 700} ${lungo ? 46 : 68}px ${F}`, larg, 5), M, y + (lungo ? 56 : 72), lungo ? 56 : 74, C.bianco);
  if (c.frase) y = scrivi(ctx, righe(ctx, c.frase, `500 31px ${F}`, larg, 4), M, y + 28, 40, C.bianco);
  for (const p of (c.punti || []).slice(0, 3)) {
    if (y > H - 170) break;
    ctx.font = `700 34px ${F}`; ctx.fillStyle = C.bianco; ctx.fillText('»', M, y + 40);
    y = scrivi(ctx, righe(ctx, p, `500 31px ${F}`, larg - 32, 2), M + 32, y + 40, 40, C.bianco) - 28;
  }
  if (c.nota) { ctx.font = `400 24px ${F}`; ctx.fillStyle = C.bianco; ctx.fillText(c.nota, M, H - 56); }
}

/* B: foto a tutto campo, velatura scura, fascia arancione con » */
function disegnaB(ctx, c, r) {
  riquadro(ctx, r.foto, 0, 0, W, H, c.fuoco);
  velatura(ctx, 0.30, 0.82, 0.15);
  logo(ctx, r.neg, M, 60, 74);
  const larg = W - 2 * M;
  const rt = righe(ctx, (c.titolo || '').toUpperCase(), `700 84px ${F}`, larg, 3);
  const rf = c.frase ? righe(ctx, c.frase, `600 38px ${F}`, larg, 3) : [];
  /* dal basso: la frase appoggiata sulla fascia, sopra il titolo, il numero e l'etichetta */
  let base = H - 150 - 46;                       // linea di base dell'ultima riga
  if (rf.length) { scrivi(ctx, rf, M, base - (rf.length - 1) * 48, 48, C.bianco); base -= (rf.length - 1) * 48 + 62; }
  scrivi(ctx, rt, M, base - (rt.length - 1) * 86, 86, C.bianco);
  base -= (rt.length - 1) * 86 + 86;
  if (c.numero) {
    ctx.font = `800 220px ${F}`; ctx.fillStyle = C.bianco; ctx.fillText(c.numero, M - 6, base + 10);
    if (c.didascalia) { const w = ctx.measureText(c.numero).width; ctx.font = `700 64px ${F}`; ctx.fillText(c.didascalia.toUpperCase(), M + w + 24, base + 10); }
    base -= 175;
  }
  if (c.etichetta) { ctx.font = `600 30px ${F}`; ctx.fillStyle = C.verde; ctx.fillText(c.etichetta.toUpperCase(), M, base); }
  fasciaArancio(ctx, c.fascia);
}

/* C: foto editoriale, testo minimo in basso */
function disegnaC(ctx, c, r) {
  riquadro(ctx, r.foto, 0, 0, W, H, c.fuoco);
  velatura(ctx, 0.30, 0.84, 0.30);
  logo(ctx, r.neg, M, 60, 64);
  const larg = W - 2 * M;
  const rf = c.frase ? righe(ctx, c.frase, `600 40px ${F}`, larg, 3) : [];
  let y = H - 90 - rf.length * 50;
  scrivi(ctx, rf, M, y + 40, 50, C.bianco);
  let top;
  if (c.numero) {
    ctx.font = `800 220px ${F}`; ctx.fillStyle = C.bianco; top = y - 200; ctx.fillText(c.numero, M - 6, y - 26);
  } else {
    const rt = righe(ctx, (c.titolo || '').toUpperCase(), `700 80px ${F}`, larg, 3);
    top = y - rt.length * 82 - 20; scrivi(ctx, rt, M, top + 70, 82, C.bianco);
  }
  if (c.etichetta) { ctx.font = `600 30px ${F}`; ctx.fillStyle = C.verde; ctx.fillText(c.etichetta.toUpperCase(), M, top - 20); }
  if (c.nota) { ctx.font = `400 22px ${F}`; ctx.fillStyle = C.bianco; ctx.textAlign = 'right'; ctx.fillText(c.nota, W - M, H - 40); ctx.textAlign = 'left'; }
}

/* solo testo su bianco: titolo arancione, testo grigio, fascia arancione */
function disegnaT(ctx, c, r) {
  ctx.fillStyle = C.bianco; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.arancio; ctx.fillRect(0, 0, W, 14);
  logo(ctx, r.pos, M, 70, 84);
  const larg = W - 2 * M;
  let y = 320;
  if (c.etichetta) { ctx.font = `600 30px ${F}`; ctx.fillStyle = C.grigio; ctx.fillText(c.etichetta.toUpperCase(), M, y); y += 30; }
  if (c.numero) { ctx.font = `800 220px ${F}`; ctx.fillStyle = C.arancio; ctx.fillText(c.numero, M - 6, y + 180); y += 200; }
  y = scrivi(ctx, righe(ctx, (c.titolo || '').toUpperCase(), `800 120px ${F}`, larg, 3), M, y + 110, 122, C.arancio);
  if (c.frase) scrivi(ctx, righe(ctx, c.frase, `600 46px ${F}`, larg, 4), M, y + 30, 58, C.grigio);
  fasciaArancio(ctx, c.fascia);
}

const DISEGNI = { A: disegnaA, B: disegnaB, C: disegnaC, T: disegnaT };

export async function disegna(cv, c, foto) {
  await caratteriPronti();
  const lg = await loghi().catch(() => ({}));
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.clearRect(0, 0, W, H);
  (DISEGNI[c.modello] || disegnaA)(ctx, c, { ...lg, foto });
}

/* ════════ nella scheda del post ════════ */
const modificabile = (p) => ['bozza', 'approvato', 'scartato'].includes(p.stato);

export function htmlGrafica(p, quanteImmagini) {
  if (!modificabile(p)) return '';
  const c = proposta(p);
  const campo = (id, etichetta, val, righeT = 0) => `<div class="field" id="pg-c-${id}"><label>${etichetta}</label>${righeT
    ? `<textarea id="pg-${id}" rows="${righeT}">${esc(val)}</textarea>` : `<input id="pg-${id}" type="text" value="${esc(val)}">`}</div>`;
  return `
    <details class="dt-doc-riga" id="pg-box" style="margin-top:8px" ${quanteImmagini ? '' : 'open'}>
      <summary style="cursor:pointer"><strong>🎨 Immagine proposta</strong> <span class="hint">col manuale grafico dell'ente e la grafica suggerita dalla redazione: correggi, guarda l'anteprima e aggiungila al post</span></summary>
      ${p.immagine_suggerita ? `<p class="hint" style="margin:6px 0">Grafica suggerita: ${esc(p.immagine_suggerita)}</p>` : ''}
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin-top:6px">
        <canvas id="pg-tela" width="${W}" height="${H}" style="width:300px;height:auto;border:1px solid var(--bordo);border-radius:8px;background:#fff"></canvas>
        <div style="flex:1;min-width:260px;display:grid;gap:6px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="field"><label>Modello</label><select id="pg-modello">${Object.entries(MODELLI).map(([k, v]) => `<option value="${k}" ${c.modello === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
            <div class="field" id="pg-c-foto"><label>Foto</label><select id="pg-foto"><option value="">(caricamento…)</option></select></div>
          </div>
          <div class="field" id="pg-c-file"><label>Oppure una foto dal computer</label><input id="pg-file" type="file" accept="image/jpeg,image/png,image/webp">
            <span class="hint">Mai cantieri o persone riconoscibili senza liberatoria.</span></div>
          <div class="field" id="pg-c-fuoco"><label>Inquadratura della foto</label><input id="pg-fuoco" type="range" min="0" max="100" value="${esc(c.fuoco)}"></div>
          ${campo('etichetta', 'Etichetta', c.etichetta)}
          <div style="display:grid;grid-template-columns:120px 1fr;gap:8px">
            ${campo('numero', 'Numero grande', c.numero)}
            ${campo('didascalia', 'Accanto al numero', c.didascalia)}
          </div>
          ${campo('titolo', 'Titolo', c.titolo, 2)}
          ${campo('frase', 'Frase', c.frase, 2)}
          ${campo('punti', 'Punti con » (uno per riga, solo modello A)', c.punti.join('\n'), 3)}
          ${campo('fascia', 'Fascia arancione', c.fascia)}
          ${campo('nota', 'Nota in basso (fonte, facoltativa)', c.nota)}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            <button class="btn btn-primary btn-sm" id="pg-aggiungi" type="button" data-aiuto="Aggiunge questa immagine al post: se non ne ha, diventa la copertina; altrimenti va in fondo al carosello. Non pubblica niente.">➕ Aggiungi al post</button>
            <button class="btn btn-ghost btn-sm" id="pg-scarica" type="button" data-aiuto="Scarica l'immagine sul computer (JPEG 1080×1080), per esempio da mandare allo Studio Tagliani. Non cambia il post.">⬇ Scarica</button>
            <button class="btn btn-ghost btn-sm" id="pg-riparti" type="button" data-aiuto="Rimette i testi, il modello e la foto proposti dalla grafica suggerita, togliendo le correzioni fatte qui.">↺ Torna alla proposta</button>
          </div>
        </div>
      </div>
    </details>`;
}

export function collegaGrafica(host, p, dopo) {
  const box = $('#pg-box', host); if (!box) return;
  const tela = $('#pg-tela', host);
  const sel = $('#pg-foto', host);
  let archivio = [], fotoFile = null, timer = null, inCorso = false;
  const v = (id) => $('#pg-' + id, host).value;
  const leggi = () => ({
    modello: v('modello'), etichetta: v('etichetta').trim(), numero: v('numero').trim(), didascalia: v('didascalia').trim(),
    titolo: v('titolo').replace(/\s+/g, ' ').trim(), frase: v('frase').replace(/\s+/g, ' ').trim(),
    punti: v('punti').split('\n').map((r) => r.trim()).filter(Boolean),
    fascia: v('fascia').trim(), nota: v('nota').trim(), fuoco: Number(v('fuoco')),
  });
  const fotoScelta = async () => {
    if (v('modello') === 'T') return null;
    if (sel.value === '__file') return fotoFile;
    const f = archivio.find((x) => x.nome === sel.value);
    return f ? fotoArchivio(f.file).catch(() => null) : null;
  };
  const mostraCampi = () => {
    const m = v('modello');
    const vedi = (id, si) => { const el = $('#pg-c-' + id, host); if (el) el.style.display = si ? '' : 'none'; };
    vedi('foto', m !== 'T'); vedi('file', m !== 'T'); vedi('fuoco', m !== 'T');
    vedi('punti', m === 'A'); vedi('fascia', m === 'B' || m === 'T'); vedi('nota', m === 'A' || m === 'C');
  };
  const ridisegna = () => { clearTimeout(timer); timer = setTimeout(async () => { try { await disegna(tela, leggi(), await fotoScelta()); } catch (e) { toast('Immagine: ' + e.message, 'err'); } }, 120); };
  const riempi = (scelta) => {
    sel.innerHTML = archivio.map((f) => `<option value="${esc(f.nome)}" ${f.nome === scelta ? 'selected' : ''}>${esc(f.descrizione)}</option>`).join('')
      + `<option value="__file" ${scelta === '__file' ? 'selected' : ''}>La foto caricata dal computer</option>`;
  };
  const applica = (c) => {
    for (const k of ['modello', 'etichetta', 'numero', 'didascalia', 'titolo', 'frase', 'fascia', 'nota', 'fuoco']) $('#pg-' + k, host).value = c[k] ?? '';
    $('#pg-punti', host).value = (c.punti || []).join('\n');
    riempi(c.foto); mostraCampi(); ridisegna();
  };
  box.addEventListener('input', (ev) => { if (ev.target.id !== 'pg-file') ridisegna(); });
  $('#pg-modello', host).addEventListener('change', () => { mostraCampi(); ridisegna(); });
  sel.addEventListener('change', ridisegna);
  $('#pg-file', host).addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    carica(URL.createObjectURL(file)).then((img) => { fotoFile = img; riempi('__file'); ridisegna(); }).catch((e) => toast('Foto: ' + e.message, 'err'));
  });
  $('#pg-riparti', host).addEventListener('click', () => { fotoFile = null; $('#pg-file', host).value = ''; applica(proposta(p, archivio)); });
  $('#pg-scarica', host).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = tela.toDataURL('image/jpeg', 0.92);
    a.download = `post-${p.id}-immagine.jpg`;
    a.click();
  });
  $('#pg-aggiungi', host).addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (inCorso) return;
    inCorso = true; attendi(btn, true, 'Aggiungo…');
    try {
      await disegna(tela, leggi(), await fotoScelta());
      const base64 = tela.toDataURL('image/jpeg', 0.92).split(',')[1];
      const { data, error } = await sb.functions.invoke('redazione-social', { body: { op: 'immagine', id: p.id, mime: 'image/jpeg', base64 } });
      if (error || data?.error) {
        let msg = data?.error || error?.message || 'non riuscito';
        try { const j = await error?.context?.json?.(); if (j?.error) msg = j.error; } catch { /* niente */ }
        throw new Error(msg);
      }
      toast('Immagine aggiunta al post.', 'ok');
      if (dopo) await dopo();
    } catch (e) {
      toast('Immagine: ' + e.message, 'err');
    } finally { inCorso = false; attendi(btn, false); }
  });
  const parti = async () => {
    archivio = await archivioFoto();
    if (!archivio.length) toast('Archivio delle foto non letto: si può usare una foto dal computer.', 'err');
    applica(proposta(p, archivio));
  };
  if (box.open) parti();
  else box.addEventListener('toggle', () => { if (box.open) parti(); }, { once: true });
}
