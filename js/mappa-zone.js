/* ============================================================
   Mappa delle aree dei tecnici (07/10/2026, chiesto dall'utente)

   La provincia di Padova coi comuni colorati per area, una pagina
   stampabile (A4 orizzontale) con la legenda: chi ha l'area, quanti
   comuni, quali. Si apre da «Tecnici e zone» e si disegna con i dati
   di oggi già letti dalla scheda: nessuna lettura in più dal database.

   - I confini dei comuni sono quelli ISTAT (openpolis, CC BY 4.0),
     già proiettati e semplificati da strumenti/mappa_comuni.py in
     img/mappa-comuni-pd.json.
   - I quartieri di Padova non hanno confini pubblicati: la città ha
     un riquadro a SCHEMA (Q1 al centro, gli altri per punto cardinale),
     e sulla mappa resta grigia col rimando al riquadro.
   - Un comune o quartiere in due aree è a strisce coi due colori.
   - I nomi dei comuni soppressi (Saletto, Carceri…) valgono solo se
     il comune nato dalla fusione non ha un'area sua.
   - Un comune della provincia senza area è tratteggiato: si vede subito.
   ============================================================ */

/* colori lontani fra loro anche stampati: niente rosso accanto all'arancione */
const COLORI = ['#e7500f', '#2f7fc1', '#95c22f', '#8e44ad', '#f2b705', '#16a085', '#d81b60', '#6d4c41', '#2c3e50', '#7f8c8d', '#00acc1', '#827717'];
const QNOME = { 1: 'Q1 Centro', 2: 'Q2 Nord', 3: 'Q3 Est', 4: 'Q4 Sud-Est', 5: 'Q5 Sud-Ovest', 6: 'Q6 Ovest' };
/* nome scritto nelle zone → nome ISTAT di oggi (forme diverse e comuni fusi) */
const ALIAS = {
  'GAZZO PADOVANO': 'GAZZO',
  'SALETTO': 'BORGO VENETO', 'MEGLIADINO SAN FIDENZIO': 'BORGO VENETO', 'SANTA MARGHERITA D ADIGE': 'BORGO VENETO',
  'CARCERI': 'SANTA CATERINA D ESTE', 'VIGHIZZOLO D ESTE': 'SANTA CATERINA D ESTE',
};
const SOPPRESSI = new Set(['SALETTO', 'MEGLIADINO SAN FIDENZIO', 'SANTA MARGHERITA D ADIGE', 'CARCERI', 'VIGHIZZOLO D ESTE']);

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Chi ha che cosa: per ogni comune ISTAT le aree (senza doppioni), per ogni quartiere di Padova le aree.
   aree = [{ area_id, tecnici: ['Cognome Nome'] }], comuni = righe aperte di zone_aree_comuni */
export function calcolaMappa(aree, comuni, nomiIstat) {
  const istat = new Set(nomiIstat.map(norm));
  const perComune = {}, perQuartiere = {}, soppressiUsati = [];
  const dirette = new Set();
  for (const c of comuni) {
    const n = norm(c.comune_nome);
    if (n === 'PADOVA' && c.quartiere) { (perQuartiere[c.quartiere] ||= new Set()).add(c.area_id); continue; }
    if (!SOPPRESSI.has(n)) dirette.add(ALIAS[n] || n);
  }
  for (const c of comuni) {
    const n = norm(c.comune_nome);
    if (n === 'PADOVA' && c.quartiere) continue;
    const dest = ALIAS[n] || n;
    if (SOPPRESSI.has(n)) {
      if (dirette.has(dest)) continue;            // il comune nuovo ha già la sua area: il nome vecchio non conta
      soppressiUsati.push(c.comune_nome);
    }
    (perComune[dest] ||= new Set()).add(c.area_id);
  }
  const fuori = Object.keys(perComune).filter((n) => !istat.has(n) && n !== 'PADOVA');
  const senzaArea = nomiIstat.filter((n) => norm(n) !== 'PADOVA' && !perComune[norm(n)]);
  const usate = [...new Set([...Object.values(perComune), ...Object.values(perQuartiere)].flatMap((s) => [...s]))];
  const ordinate = aree.filter((a) => usate.includes(a.area_id))
    .sort((x, y) => (x.tecnici[0] || '~').localeCompare(y.tecnici[0] || '~', 'it') || x.area_id - y.area_id);
  const colore = Object.fromEntries(ordinate.map((a, i) => [a.area_id, COLORI[i % COLORI.length]]));
  const arr = (s) => [...s].sort((a, b) => ordinate.findIndex((x) => x.area_id === a) - ordinate.findIndex((x) => x.area_id === b));
  return {
    colore, ordinate, senzaArea, fuori, soppressiUsati,
    comune: Object.fromEntries(Object.entries(perComune).map(([k, v]) => [k, arr(v)])),
    quartiere: Object.fromEntries(Object.entries(perQuartiere).map(([k, v]) => [k, arr(v)])),
  };
}

/* riempimento: un colore, oppure strisce se le aree sono più d'una */
function riempimento(ids, m, defs) {
  if (!ids || !ids.length) return 'url(#senza-area)';
  if (ids.length === 1) return m.colore[ids[0]];
  const id = 'str-' + ids.join('-');
  if (!defs.has(id)) {
    const w = 8, passo = w / ids.length;
    defs.set(id, `<pattern id="${id}" width="${w}" height="${w}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + ids.map((a, i) => `<rect x="${i * passo}" y="0" width="${passo}" height="${w}" fill="${m.colore[a]}"/>`).join('') + '</pattern>');
  }
  return `url(#${id})`;
}

/* settore di corona (schema dei quartieri): angoli in gradi, 0 = est, senso orario */
function settore(cx, cy, r1, r2, a1, a2) {
  const p = (r, a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)].map((v) => v.toFixed(1)).join(',');
  const grande = a2 - a1 > 180 ? 1 : 0;
  return `M${p(r2, a1)}A${r2},${r2} 0 ${grande} 1 ${p(r2, a2)}L${p(r1, a2)}A${r1},${r1} 0 ${grande} 0 ${p(r1, a1)}Z`;
}
const SETTORI = { 2: [-135, -45, -90], 3: [-45, 30, -8], 4: [30, 90, 60], 5: [90, 150, 120], 6: [150, 225, 188] };

export function disegna(geo, m, { nomi = true } = {}) {
  const defs = new Map();
  const W = geo.larghezza, H = geo.altezza;
  const forme = geo.comuni.map((c) => {
    const pd = c.norm === 'PADOVA';
    const f = pd ? '#e9eaec' : riempimento(m.comune[c.norm], m, defs);
    const chi = pd ? 'vedi il riquadro dei quartieri' : (m.comune[c.norm] || []).map((a) => m.ordinate.find((x) => x.area_id === a)?.tecnici.join(' + ') || 'area ' + a).join(' / ') || 'senza area';
    return `<path d="${c.d}" fill="${f}" stroke="#fff" stroke-width="1.1"><title>${esc(c.nome)} — ${esc(chi)}</title></path>`;
  }).join('');
  const etichette = nomi ? geo.comuni.map((c) => `<text x="${c.x}" y="${c.y}" class="nome${c.norm === 'PADOVA' ? ' pd' : ''}">${esc(c.norm === 'PADOVA' ? 'PADOVA (quartieri nel riquadro)' : c.nome)}</text>`).join('') : '';
  /* riquadro dei quartieri in alto a sinistra: a ovest di Cittadella la provincia lascia spazio libero */
  const R = 105, cx = R + 14, cy = R + 36;
  const q = (n) => riempimento(m.quartiere[n], m, defs);
  const spicchi = Object.entries(SETTORI).map(([n, [a1, a2, am]]) => {
    const lx = cx + (R * 0.68) * Math.cos(am * Math.PI / 180), ly = cy + (R * 0.68) * Math.sin(am * Math.PI / 180);
    return `<path d="${settore(cx, cy, R * 0.36, R, a1, a2)}" fill="${q(n)}" stroke="#fff" stroke-width="2"/>`
      + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="q">${esc(QNOME[n])}</text>`;
  }).join('');
  const riquadro = `<g class="riquadro"><rect x="${cx - R - 12}" y="${cy - R - 34}" width="${2 * R + 24}" height="${2 * R + 46}" rx="8" fill="#fff" stroke="#c9ccd1"/>`
    + `<text x="${cx}" y="${cy - R - 14}" class="titq">Padova, i 6 quartieri (schema)</text>`
    + spicchi + `<circle cx="${cx}" cy="${cy}" r="${(R * 0.36).toFixed(1)}" fill="${q(1)}" stroke="#fff" stroke-width="2"/>`
    + `<text x="${cx}" y="${cy + 4}" class="q">${esc(QNOME[1])}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="mappa" role="img" aria-label="Mappa delle aree dei tecnici">
    <defs><pattern id="senza-area" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#fff"/><rect width="2" height="7" fill="#c0392b" opacity=".55"/></pattern>${[...defs.values()].join('')}</defs>
    ${forme}${etichette}${riquadro}</svg>`;
}

/* «PIOVE DI SACCO» → «Piove di Sacco», «PIACENZA D'ADIGE» → «Piacenza d'Adige» */
const MINUSCOLE = new Set(['di', 'del', 'della', 'delle', 'dei', 'in', 'sul', 'sulla', 'd']);
export const nomeBello = (x) => String(x).toLowerCase().split(/(\s+|')/)
  .map((w, i) => (i > 0 && MINUSCOLE.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');

function legenda(m, comuni) {
  const comuniDi = (a) => comuni.filter((c) => c.area_id === a)
    .map((c) => (c.quartiere ? 'Padova ' + QNOME[c.quartiere] : nomeBello(c.comune_nome)))
    .sort((x, y) => x.localeCompare(y, 'it'));
  const condivisi = (a) => comuni.filter((c) => c.area_id === a && comuni.some((d) => d !== c && d.area_id !== a && d.comune_nome === c.comune_nome && (d.quartiere || 0) === (c.quartiere || 0)));
  return m.ordinate.map((a) => {
    const lista = comuniDi(a.area_id), cond = condivisi(a.area_id);
    return `<div class="voce"><div class="testa"><span class="tinta" style="background:${m.colore[a.area_id]}"></span>
      <b>${esc(a.tecnici.join(' + ') || 'nessun tecnico')}</b> <span class="muto">area ${a.area_id} · ${lista.length}</span></div>
      <div class="elenco">${esc(lista.join(', '))}</div>
      ${cond.length ? `<div class="muto cond">condiviso con altre aree: ${esc(cond.map((c) => (c.quartiere ? 'Padova ' + QNOME[c.quartiere] : c.comune_nome)).join(', '))}</div>` : ''}</div>`;
  }).join('');
}

/* apre la pagina stampabile in una finestra nuova */
export async function apri({ aree, comuni }) {
  const w = window.open('', '_blank');
  if (!w) { alert('Il browser ha bloccato la finestra della mappa: consenti i popup per questa pagina e riprova.'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>Mappa delle aree</title><p style="font:14px system-ui;padding:20px">Disegno la mappa…</p>');
  let geo;
  try {
    const r = await fetch('img/mappa-comuni-pd.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    geo = await r.json();
  } catch (e) {
    w.document.body.innerHTML = `<p style="font:14px system-ui;padding:20px;color:#c0392b">Non sono riuscito a leggere i confini dei comuni (${esc(e.message)}): la mappa non si può disegnare.</p>`;
    return;
  }
  const m = calcolaMappa(aree, comuni, geo.comuni.map((c) => c.nome));
  const oggi = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const avvisi = [
    m.senzaArea.length ? `<p class="avviso">Comuni senza area (tratteggiati): ${esc(m.senzaArea.join(', '))}.</p>` : '',
    m.fuori.length ? `<p class="avviso">Nomi nelle zone che non trovo fra i comuni ISTAT, quindi non disegnati: ${esc(m.fuori.join(', '))}.</p>` : '',
  ].join('');
  w.document.open();
  w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aree dei tecnici — ${esc(oggi)}</title>
<style>
  :root{--arancio:#e7500f;--grigio:#565c66}
  *{box-sizing:border-box} body{margin:0;font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#222;background:#f4f5f7}
  .barra{display:flex;gap:10px;align-items:center;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd;position:sticky;top:0}
  .barra button{background:var(--arancio);color:#fff;border:0;border-radius:6px;padding:7px 14px;font-weight:600;cursor:pointer}
  .barra label{display:flex;gap:6px;align-items:center}
  .foglio{max-width:1400px;margin:14px auto;background:#fff;padding:16px 18px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  h1{margin:0;font-size:19px;color:var(--arancio)} .sotto{color:var(--grigio);margin:2px 0 10px}
  .corpo{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;align-items:start}
  .mappa{width:100%;height:auto;display:block}
  .mappa .nome{font-size:7.2px;text-anchor:middle;dominant-baseline:middle;fill:#1d1f22;paint-order:stroke;stroke:#fff;stroke-width:2px;stroke-linejoin:round}
  .mappa .nome.pd{font-weight:700;font-size:8.5px}
  .mappa .q{font-size:10px;font-weight:700;text-anchor:middle;dominant-baseline:middle;fill:#1d1f22;paint-order:stroke;stroke:#fff;stroke-width:2.5px}
  .mappa .titq{font-size:11px;font-weight:700;text-anchor:middle;fill:var(--grigio)}
  .voce{break-inside:avoid;padding:6px 0;border-bottom:1px solid #eee}
  .testa{display:flex;gap:7px;align-items:center} .tinta{width:16px;height:16px;border-radius:4px;flex:0 0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .elenco{font-size:11px;color:#444;margin:3px 0 0 23px} .muto{color:#777;font-size:11px}
  .cond{margin-left:23px}
  .avviso{background:#fdeaea;border-left:3px solid #c0392b;padding:5px 8px;font-size:12px;margin:6px 0}
  .piede{color:#888;font-size:10px;margin-top:10px}
  @media (max-width:900px){.corpo{grid-template-columns:1fr}}
  @page{size:A4 landscape;margin:8mm}
  @media print{body{background:#fff}.barra{display:none}.foglio{margin:0;padding:0;box-shadow:none;max-width:none}
    .corpo{grid-template-columns:1.5fr 1fr;gap:6mm}.mappa{max-height:178mm;width:auto;max-width:100%}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}.elenco{font-size:9px}.voce{padding:3px 0}}
</style></head><body>
<div class="barra"><button type="button" onclick="print()">🖨️ Stampa</button>
  <label><input type="checkbox" id="nomi" checked> nomi dei comuni</label>
  <span style="color:#777">Si stampa su un foglio A4 orizzontale. Passa col mouse su un comune per vedere di chi è.</span></div>
<div class="foglio">
  <h1>Aree dei tecnici — Provincia di Padova</h1>
  <div class="sotto">Situazione al ${esc(oggi)} · Area Sicurezza e Salute, Formedil Padova</div>
  ${avvisi}
  <div class="corpo"><div id="mappa">${disegna(geo, m, { nomi: true })}</div><div>${legenda(m, comuni)}</div></div>
  <div class="piede">Confini dei comuni: ISTAT, da openpolis/geojson-italy (CC BY 4.0). I quartieri di Padova sono uno schema, non i confini reali. A strisce le zone seguite da più tecnici; tratteggiati i comuni senza area.</div>
</div></body></html>`);
  w.document.close();
  const svgCon = disegna(geo, m, { nomi: true }), svgSenza = disegna(geo, m, { nomi: false });
  w.document.getElementById('nomi').addEventListener('change', (e) => { w.document.getElementById('mappa').innerHTML = e.target.checked ? svgCon : svgSenza; });
}
