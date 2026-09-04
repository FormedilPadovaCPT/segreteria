/* ============================================================
   Ordinamento per colonna di TUTTE le tabelle `.tbl` dell'app.
   Si importa una volta da app.js e lavora per delega: un clic
   sull'intestazione ordina le righe già caricate (primo clic
   crescente, secondo decrescente). Le date gg/mm/aaaa e gli
   importi 1.234,56 si ordinano come numeri, il resto come testo
   con le regole italiane; le celle vuote finiscono in fondo.

   Chi rende le righe sul server (registro protocollo, paginato)
   intercetta l'evento `ordina-colonna` sulla tabella e fa
   preventDefault(): il modulo aggiorna solo la freccia.

   L'ordinamento scelto viene ricordato per vista + intestazioni,
   così quando la tabella si ridisegna (filtro, refresh) resta
   ordinata come l'aveva lasciata l'utente.
   ============================================================ */

const memoria = new Map();          // firma → { idx, dir }
const IGNORA_DENTRO = 'button, a, input, select, textarea, label';

/* ── lettura dei valori ─────────────────────────────────── */
function interpreta(s) {
  s = (s || '').trim();
  if (!s || s === '—' || s === '-' || s === '?') return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D{1,3}(\d{1,2}):(\d{2}))?/);
  if (m) return { n: Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { n: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
  const num = s.replace(/[€%\s]/g, '');
  if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(num) || /^[+-]?\d+(,\d+)?$/.test(num)) {
    return { n: parseFloat(num.replace(/\./g, '').replace(',', '.')) };
  }
  if (/^[+-]?\d+\.\d+$/.test(num)) return { n: parseFloat(num) };
  return { s };
}

function valoreCella(td) {
  if (!td) return null;
  if (td.dataset.ord !== undefined) return interpreta(td.dataset.ord);
  return interpreta(td.textContent);
}

function confronta(a, b, dir) {
  if (!a && !b) return 0;
  if (!a) return 1;                 // vuoti sempre in fondo, in ogni direzione
  if (!b) return -1;
  let r;
  if ('n' in a && 'n' in b) r = a.n - b.n;
  else if ('n' in a) r = -1;        // numeri prima del testo
  else if ('n' in b) r = 1;
  else r = a.s.localeCompare(b.s, 'it', { numeric: true, sensitivity: 'base' });
  return r * dir;
}

/* ── identità della tabella (per ricordare la scelta) ───── */
function firma(tbl) {
  const vista = tbl.closest('.view')?.id || tbl.closest('.drawer')?.id || '';
  const testi = [...(tbl.tHead?.rows[0]?.cells || [])].map((c) => c.textContent.trim());
  return `${vista}|${tbl.id || ''}|${testi.join('¦')}`;
}

function segnaIntestazione(tbl, idx, dir) {
  [...(tbl.tHead?.rows[0]?.cells || [])].forEach((c, i) => {
    c.classList.toggle('ord-asc', i === idx && dir === 1);
    c.classList.toggle('ord-desc', i === idx && dir === -1);
  });
}

/* ── ordinamento delle righe già nel DOM ────────────────── */
function ordinaDom(tbl, idx, dir) {
  const tb = tbl.tBodies[0];
  if (!tb || tb.querySelector('[rowspan]')) return false;
  const mobili = [];
  const fisse = [];
  [...tb.rows].forEach((r, i) => {
    const ok = r.cells.length > idx && ![...r.cells].some((c) => c.colSpan > 1);
    (ok ? mobili : fisse).push({ r, i });
  });
  if (mobili.length < 2) return false;
  const chiavi = new Map(mobili.map((o) => [o.r, valoreCella(o.r.cells[idx])]));
  mobili.sort((a, b) => confronta(chiavi.get(a.r), chiavi.get(b.r), dir) || a.i - b.i);
  /* Se le righe sono già nell'ordine giusto non si tocca il DOM: è ciò che
     ferma il rimbalzo con l'osservatore (la nostra stessa mutazione viene
     riesaminata, trova tutto in ordine e si ferma). */
  const attuale = [...tb.rows];
  const voluto = [...mobili.map((o) => o.r), ...fisse.map((o) => o.r)];
  if (voluto.every((r, i) => r === attuale[i])) return false;
  const frag = document.createDocumentFragment();
  mobili.forEach((o) => frag.appendChild(o.r));
  fisse.forEach((o) => frag.appendChild(o.r));   // «nessun risultato», totali: restano in coda
  tb.appendChild(frag);
  return true;
}

function applica(tbl, idx, dir, daClic) {
  const th = tbl.tHead?.rows[0]?.cells[idx];
  if (!th) return;
  if (daClic) {
    const ev = new CustomEvent('ordina-colonna', {
      bubbles: true, cancelable: true,
      detail: { idx, dir, th, etichetta: th.textContent.trim() },
    });
    tbl.dispatchEvent(ev);
    if (ev.defaultPrevented) {          // il modulo ricarica dal server
      tbl.dataset.ordServer = '1';
      segnaIntestazione(tbl, idx, dir);
      return;
    }
  }
  if (tbl.dataset.ordServer) return;
  ordinaDom(tbl, idx, dir);
  segnaIntestazione(tbl, idx, dir);
  memoria.set(firma(tbl), { idx, dir });
}

/* ── clic sulle intestazioni ────────────────────────────── */
document.addEventListener('click', (e) => {
  const th = e.target.closest('table.tbl thead th');
  if (!th || e.target.closest(IGNORA_DENTRO)) return;
  if (!th.textContent.trim() || th.dataset.noOrd !== undefined) return;
  const tbl = th.closest('table');
  const idx = th.cellIndex;
  const dir = th.classList.contains('ord-asc') ? -1 : 1;
  applica(tbl, idx, dir, true);
});

/* Le intestazioni si presentano da sole come cliccabili. */
function preparaIntestazioni(radice) {
  const tabelle = radice.matches?.('table.tbl') ? [radice] : [...(radice.querySelectorAll?.('table.tbl') || [])];
  for (const tbl of tabelle) {
    [...(tbl.tHead?.rows[0]?.cells || [])].forEach((c) => {
      if (c.textContent.trim() && c.dataset.noOrd === undefined) {
        c.classList.add('ordinabile');
        if (!c.title) c.title = `Ordina per ${c.textContent.trim().toLowerCase()}`;
      }
    });
    const ric = memoria.get(firma(tbl));
    if (ric && !tbl.dataset.ordServer) applica(tbl, ric.idx, ric.dir, false);
  }
}

/* ── tabelle ridisegnate: si riapplica la scelta ricordata ── */
let inAttesa = null;
const daGuardare = new Set();
const oss = new MutationObserver((records) => {
  for (const r of records) {
    const t = r.target;
    const tbl = t.nodeType === 1 ? (t.closest?.('table.tbl') || null) : null;
    if (tbl) daGuardare.add(tbl);
    r.addedNodes.forEach((n) => { if (n.nodeType === 1) daGuardare.add(n); });
  }
  if (inAttesa) return;
  // setTimeout e non requestAnimationFrame: quello si ferma nelle schede in secondo piano
  inAttesa = setTimeout(() => {
    inAttesa = null;
    const lotto = [...daGuardare];
    daGuardare.clear();
    lotto.forEach((n) => { if (n.isConnected) preparaIntestazioni(n); });
  }, 0);
});
oss.observe(document.body, { childList: true, subtree: true });
preparaIntestazioni(document.body);
