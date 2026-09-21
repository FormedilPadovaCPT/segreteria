/* ============================================================
   SPUNTA TUTTI — la casella in testa alla colonna delle spunte.
   Chiesta dall'utente il 21/09/2026, guardando la chiusura del
   mese di Camuffo con 42 arretrate: «sarebbe utile alla
   segreteria avere una casella di controllo che seleziona o
   deseleziona tutte le fatture o voci in una volta sola, che se
   son tante rispuntarle una a una è impegnativo».

   Sta in un posto solo e vale per OGNI tabella `.tbl` dell'app,
   come l'ordinamento di ordina.js: si importa una volta da
   app.js e lavora per delega, così una tabella nuova con le
   spunte la eredita senza doversene ricordare.

   Quando compare: la prima intestazione è vuota e almeno due
   righe del corpo hanno una casella nella prima cella. Una
   tabella che non la vuole scrive `data-no-spunta` sul <table>.

   ⚠️ Le righe DISABILITATE non si toccano: sono le prestazioni
   già fatturate, che non devono rientrare per un clic solo.

   ⚠️ Un solo evento alla fine, non uno per casella: chi ascolta
   (la chiusura del mese ricalcola il totale a ogni `change`)
   rifarebbe il conto 42 volte. Le caselle si cambiano tutte in
   silenzio e poi si lascia salire UN `change` dalla tabella.
   ============================================================ */

const CASELLA = 'input[type="checkbox"]';

/* le caselle di selezione della tabella: prima cella di ogni riga del corpo */
function caselle(tbl) {
  const tb = tbl.tBodies[0];
  if (!tb) return [];
  return [...tb.rows]
    .map((r) => (r.cells[0] && r.cells[0].querySelector(CASELLA)))
    .filter(Boolean);
}

function aggiornaPadrona(tbl) {
  const padrona = tbl.tHead?.rows[0]?.cells[0]?.querySelector('input[data-spunta-tutti]');
  if (!padrona) return;
  const cc = caselle(tbl).filter((c) => !c.disabled);
  const n = cc.filter((c) => c.checked).length;
  padrona.disabled = !cc.length;
  padrona.checked = cc.length > 0 && n === cc.length;
  padrona.indeterminate = n > 0 && n < cc.length;
  padrona.title = padrona.checked
    ? 'Togli la spunta a tutte le righe'
    : 'Spunta tutte le righe';
}

function prepara(radice) {
  const tabelle = radice.matches?.('table.tbl') ? [radice] : [...(radice.querySelectorAll?.('table.tbl') || [])];
  for (const tbl of tabelle) {
    if (tbl.dataset.noSpunta !== undefined) continue;
    const th = tbl.tHead?.rows[0]?.cells[0];
    if (!th || th.textContent.trim()) continue;          // la prima colonna non è quella delle spunte
    if (caselle(tbl).length < 2) continue;               // con una riga sola non serve
    if (!th.querySelector('input[data-spunta-tutti]')) {
      const padrona = document.createElement('input');
      padrona.type = 'checkbox';
      padrona.dataset.spuntaTutti = '';
      padrona.style.cursor = 'pointer';
      th.appendChild(padrona);
    }
    aggiornaPadrona(tbl);
  }
}

/* ── il clic sulla padrona ── */
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  const tbl = t.closest('table.tbl');
  if (!tbl) return;

  if (t.dataset.spuntaTutti !== undefined) {
    const vuoi = t.checked;
    let cambiate = 0;
    for (const c of caselle(tbl)) {
      if (c.disabled || c.checked === vuoi) continue;
      c.checked = vuoi;
      cambiate += 1;
    }
    aggiornaPadrona(tbl);
    /* un evento solo, dalla tabella: chi ricalcola lo fa una volta */
    if (cambiate) tbl.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  /* una riga cambiata a mano: la padrona si riallinea (piena, vuota, a metà) */
  if (t.closest('tbody') && t.closest('td') === t.closest('tr')?.cells[0]) aggiornaPadrona(tbl);
});

/* ── tabelle ridisegnate: la casella ricompare da sola ── */
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
  inAttesa = setTimeout(() => {
    inAttesa = null;
    const lotto = [...daGuardare];
    daGuardare.clear();
    lotto.forEach((n) => { if (n.isConnected) prepara(n); });
  }, 0);
});
oss.observe(document.body, { childList: true, subtree: true });
prepara(document.body);
