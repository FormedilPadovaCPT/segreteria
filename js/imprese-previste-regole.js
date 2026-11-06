/* Imprese previste del cantiere: le regole pure, senza pagina (06/11/2026). Le stesse stanno nel gestionale
   (filtroPreviste, previsteUniche in index.html): chi le cambia le cambia in tutti e due. */

/* filtro PostgREST: le righe della Cassa (per CNCE) e quelle della segreteria (per cantiere) */
export function filtroPreviste(cnce, cid) {
  const q = (v) => '"' + String(v).replace(/["\\]/g, '') + '"';
  const p = [];
  if (cnce) p.push('cnce.eq.' + q(cnce));
  if (cid) p.push('cantiere_id.eq.' + q(cid));
  return p.join(',');
}

/* una impresa una volta sola: vince la riga della Cassa */
export function previsteUniche(righe) {
  const m = new Map();
  (righe || []).forEach((r) => {
    const k = String(r.impresa_cf || '').trim().toUpperCase();
    if (!k) return;
    const g = m.get(k);
    if (!g || (g.fonte === 'segreteria' && r.fonte !== 'segreteria')) m.set(k, r);
  });
  return [...m.values()].sort((a, b) => String(a.impresa_nome || '').localeCompare(String(b.impresa_nome || '')));
}
