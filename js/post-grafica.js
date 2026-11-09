/* ============================================================
   🎨 Immagine proposta dei post (09/11/2026, chiesto dall'utente)

   Nella scheda di un post (pagina Comunicazione) l'immagine arriva già
   proposta, disegnata nel browser con la grafica dell'ente: il modello
   della serie «918 visite» (1080×1350, barra arancione, occhiello,
   titolo in Barlow Condensed, numero grande, piede col logo ufficiale),
   oppure una foto scelta dalla persona con la fascia arancione.
   La persona corregge i testi, vede l'anteprima cambiare, e la
   aggiunge al post (stessa strada del «⬆ Carica»: redazione-social,
   op «immagine») o la scarica. Niente parte da solo, niente QR né link
   nell'immagine (regola del 26/10/2026). Le regole della proposta
   stanno in post-immagine.js.
   ============================================================ */

import { sb, $, esc, toast, attendi } from './core.js';
import { LARGHEZZA as W, ALTEZZA as H, MODELLI, proposta, aCapo } from './post-immagine.js';

const F = { titolo: '"Barlow Condensed", Arial, sans-serif', testo: 'Barlow, Arial, sans-serif' };
const C = { arancio: '#e7500f', grigio: '#565c66', tenue: '#6c727b', inchiostro: '#202327', riga: '#d7dade' };
const X = 80, L = 920;

const carica = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('immagine non leggibile')); i.src = src; });
let _loghi = null;
async function loghi() {
  if (!_loghi) _loghi = Promise.all([carica('img/logo-post-positivo.png'), carica('img/logo-post-negativo.png')]).then(([pos, neg]) => ({ pos, neg }));
  return _loghi;
}
async function caratteriPronti() {
  if (!document.fonts) return;
  await Promise.all(['800 82px "Barlow Condensed"', '800 190px "Barlow Condensed"', '600 27px Barlow', '400 34px Barlow', '700 24px Barlow']
    .map((f) => document.fonts.load(f).catch(() => null)));
}

function scrivi(ctx, righe, x, y, lh) { righe.forEach((r, i) => ctx.fillText(r, x, y + i * lh)); return y + (righe.length - 1) * lh; }
function logoAlto(ctx, img, x, y, h) { if (img) ctx.drawImage(img, x, y, img.width * h / img.height, h); }

/* il post bianco: numero, elenco o frase */
function disegnaChiaro(ctx, c, ris) {
  const misura = (t) => ctx.measureText(t).width;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.arancio; ctx.fillRect(0, 0, W, 18);
  const piede = H - 56 - 70 - 26;
  /* in alto occhiello e titolo; il resto si appoggia sul fondo, sopra il piede, come nella serie «918 visite» */
  ctx.font = `600 30px ${F.testo}`; ctx.fillStyle = C.arancio; ctx.fillText(c.occhiello || '', X, 118);
  ctx.font = `800 92px ${F.titolo}`; ctx.fillStyle = C.inchiostro;
  const alto = scrivi(ctx, aCapo(c.titolo, L, misura, 4), X, 236, 90);
  const fondo = piede - 56;
  if (c.modello === 'elenco' && c.punti && c.punti.length) {
    ctx.font = `400 38px ${F.testo}`;
    const blocchi = c.punti.slice(0, 5).map((t) => aCapo(t, L - 40, misura, 3));
    const frase = c.frase ? aCapo(c.frase, L, misura, 2) : [];
    const altezza = (b) => (b.length - 1) * 50 + 46;
    let tot = blocchi.reduce((s, b) => s + altezza(b) + 30, -30) + (frase.length ? frase.length * 50 + 30 : 0);
    while (blocchi.length > 1 && fondo - tot < alto + 70) { const b = blocchi.pop(); tot -= altezza(b) + 30; }
    let y = fondo - tot + 36;
    if (frase.length) { ctx.font = `500 38px ${F.testo}`; ctx.fillStyle = C.grigio; y = scrivi(ctx, frase, X, y, 50) + 50 + 30; ctx.font = `400 38px ${F.testo}`; }
    for (const b of blocchi) {
      ctx.fillStyle = C.arancio; ctx.fillRect(X, y - 34, 9, altezza(b));
      ctx.fillStyle = C.inchiostro; y = scrivi(ctx, b, X + 40, y, 50) + 50 + 30;
    }
  } else {
    ctx.font = `400 ${c.modello === 'numero' ? 40 : 46}px ${F.testo}`; ctx.fillStyle = C.inchiostro;
    const lh = c.modello === 'numero' ? 54 : 62;
    const frase = c.frase ? aCapo(c.frase, L, misura, c.modello === 'numero' ? 4 : 7) : [];
    const yFrase = fondo - (frase.length - 1) * lh;
    if (frase.length) scrivi(ctx, frase, X, yFrase, lh);
    if (c.modello === 'numero' && c.numero) {
      const yNum = (frase.length ? yFrase - lh - 40 : fondo);
      ctx.font = `800 240px ${F.titolo}`; ctx.fillStyle = C.arancio; ctx.fillText(c.numero, X, yNum);
      const w = misura(c.numero);
      ctx.font = `600 46px ${F.testo}`; ctx.fillStyle = C.grigio;
      const d = aCapo(c.didascalia, L - w - 28, misura, 3);
      scrivi(ctx, d, X + w + 28, yNum - (d.length - 1) * 54, 54);
    }
  }
  ctx.fillStyle = C.riga; ctx.fillRect(X, piede, L, 2);
  logoAlto(ctx, ris.pos, X, piede + 26, 70);
  ctx.font = `700 24px ${F.testo}`; ctx.fillStyle = C.inchiostro; ctx.textAlign = 'right';
  ctx.fillText(c.piede || '', X + L, piede + 26 + 44); ctx.textAlign = 'left';
}

/* la foto a tutto campo con la fascia arancione in basso */
function disegnaFoto(ctx, c, ris) {
  const misura = (t) => ctx.measureText(t).width;
  ctx.fillStyle = C.grigio; ctx.fillRect(0, 0, W, H);
  if (ris.foto) {
    const f = ris.foto, s = Math.max(W / f.width, H / f.height);
    ctx.drawImage(f, (W - f.width * s) / 2, (H - f.height * s) / 2, f.width * s, f.height * s);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.45, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  logoAlto(ctx, ris.neg, 60, 56, 64);
  if (c.occhiello) {
    ctx.font = `600 27px ${F.testo}`;
    const w = misura(c.occhiello);
    ctx.fillStyle = C.arancio; ctx.fillRect(60, 160, w + 36, 48);
    ctx.fillStyle = '#fff'; ctx.fillText(c.occhiello, 78, 194);
  }
  const fascia = H - 380;
  if (c.frase) {
    ctx.font = `500 34px ${F.testo}`; ctx.fillStyle = '#fff';
    const r = aCapo(c.frase, L, misura, 4);
    scrivi(ctx, r, X, fascia - 40 - (r.length - 1) * 46, 46);
  }
  ctx.fillStyle = C.arancio; ctx.fillRect(0, fascia, W, H - fascia);
  ctx.font = `800 76px ${F.titolo}`; ctx.fillStyle = '#fff';
  scrivi(ctx, aCapo(c.titolo, L - 110, misura, 3), X, fascia + 105, 76);
  ctx.font = `800 130px ${F.titolo}`; ctx.textAlign = 'right'; ctx.fillText('»', X + L, fascia + 125); ctx.textAlign = 'left';
  ctx.font = `700 24px ${F.testo}`; ctx.fillText(c.piede || '', X, H - 52);
}

export async function disegna(cv, c, foto) {
  await caratteriPronti();
  const lg = await loghi().catch(() => ({}));
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (c.modello === 'foto') disegnaFoto(ctx, c, { ...lg, foto });
  else disegnaChiaro(ctx, c, lg);
}

/* ════════ nella scheda del post ════════ */
const modificabile = (p) => ['bozza', 'approvato', 'scartato'].includes(p.stato);

export function htmlGrafica(p, quanteImmagini) {
  if (!modificabile(p)) return '';
  const c = proposta(p);
  return `
    <details class="dt-doc-riga" id="pg-box" style="margin-top:8px" ${quanteImmagini ? '' : 'open'}>
      <summary style="cursor:pointer"><strong>🎨 Immagine proposta</strong> <span class="hint">disegnata dall'app con la grafica dell'ente: correggi i testi, guarda l'anteprima e aggiungila al post</span></summary>
      ${p.immagine_suggerita ? `<p class="hint" style="margin:6px 0">La redazione suggeriva: ${esc(p.immagine_suggerita)}</p>` : ''}
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;margin-top:6px">
        <canvas id="pg-tela" width="${W}" height="${H}" style="width:270px;height:auto;border:1px solid var(--bordo);border-radius:8px;background:#fff"></canvas>
        <div style="flex:1;min-width:260px;display:grid;gap:6px">
          <div class="field"><label>Modello</label><select id="pg-modello">${Object.entries(MODELLI).map(([k, v]) => `<option value="${k}" ${c.modello === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          <div class="field"><label>Occhiello</label><input id="pg-occhiello" type="text" value="${esc(c.occhiello)}"></div>
          <div class="field"><label>Titolo</label><textarea id="pg-titolo" rows="2">${esc(c.titolo)}</textarea></div>
          <div id="pg-campi-numero" style="display:grid;grid-template-columns:120px 1fr;gap:8px">
            <div class="field"><label>Numero grande</label><input id="pg-numero" type="text" value="${esc(c.numero)}"></div>
            <div class="field"><label>Accanto al numero</label><input id="pg-didascalia" type="text" value="${esc(c.didascalia)}"></div>
          </div>
          <div class="field"><label>Frase</label><textarea id="pg-frase" rows="3">${esc(c.frase)}</textarea></div>
          <div class="field" id="pg-campi-elenco"><label>Punti dell'elenco (uno per riga)</label><textarea id="pg-punti" rows="4">${esc(c.punti.join('\n'))}</textarea></div>
          <div class="field" id="pg-campi-foto"><label>Foto di sfondo</label><input id="pg-foto" type="file" accept="image/jpeg,image/png,image/webp">
            <span class="hint">Foto dell'ente o d'archivio: mai cantieri o persone riconoscibili senza liberatoria.</span></div>
          <div class="field"><label>Piede</label><input id="pg-piede" type="text" value="${esc(c.piede)}"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            <button class="btn btn-primary btn-sm" id="pg-aggiungi" type="button" data-aiuto="Aggiunge questa immagine al post: se non ne ha, diventa la copertina; altrimenti va in fondo al carosello. Non pubblica niente.">➕ Aggiungi al post</button>
            <button class="btn btn-ghost btn-sm" id="pg-scarica" type="button" data-aiuto="Scarica l'immagine sul computer (JPEG 1080×1350), per esempio da mandare allo Studio Tagliani. Non cambia il post.">⬇ Scarica</button>
            <button class="btn btn-ghost btn-sm" id="pg-riparti" type="button" data-aiuto="Rimette i testi proposti dal post, togliendo le correzioni fatte qui.">↺ Torna alla proposta</button>
          </div>
        </div>
      </div>
    </details>`;
}

export function collegaGrafica(host, p, dopo) {
  const box = $('#pg-box', host); if (!box) return;
  const tela = $('#pg-tela', host);
  let foto = null, timer = null, inCorso = false;
  const leggi = () => ({
    modello: $('#pg-modello', host).value,
    occhiello: $('#pg-occhiello', host).value.trim(),
    titolo: $('#pg-titolo', host).value.replace(/\s+/g, ' ').trim(),
    numero: $('#pg-numero', host).value.trim(),
    didascalia: $('#pg-didascalia', host).value.trim(),
    frase: $('#pg-frase', host).value.replace(/\s+/g, ' ').trim(),
    punti: $('#pg-punti', host).value.split('\n').map((r) => r.trim()).filter(Boolean),
    piede: $('#pg-piede', host).value.trim(),
  });
  const mostraCampi = () => {
    const m = $('#pg-modello', host).value;
    $('#pg-campi-numero', host).style.display = m === 'numero' ? 'grid' : 'none';
    $('#pg-campi-elenco', host).style.display = m === 'elenco' ? '' : 'none';
    $('#pg-campi-foto', host).style.display = m === 'foto' ? '' : 'none';
  };
  const ridisegna = () => { clearTimeout(timer); timer = setTimeout(() => disegna(tela, leggi(), foto).catch((e) => toast('Immagine: ' + e.message, 'err')), 120); };
  box.addEventListener('input', (ev) => { if (ev.target.id !== 'pg-foto') ridisegna(); });
  $('#pg-modello', host).addEventListener('change', () => { mostraCampi(); ridisegna(); });
  $('#pg-foto', host).addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    carica(url).then((img) => { foto = img; ridisegna(); }).catch((e) => toast('Foto: ' + e.message, 'err'));
  });
  $('#pg-riparti', host).addEventListener('click', () => {
    const c = proposta(p);
    $('#pg-modello', host).value = c.modello; $('#pg-occhiello', host).value = c.occhiello; $('#pg-titolo', host).value = c.titolo;
    $('#pg-numero', host).value = c.numero; $('#pg-didascalia', host).value = c.didascalia; $('#pg-frase', host).value = c.frase;
    $('#pg-punti', host).value = c.punti.join('\n'); $('#pg-piede', host).value = c.piede; foto = null; $('#pg-foto', host).value = '';
    mostraCampi(); ridisegna();
  });
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
      await disegna(tela, leggi(), foto);
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
  mostraCampi();
  if (box.open) ridisegna();
  else box.addEventListener('toggle', () => { if (box.open) ridisegna(); }, { once: true });
}
