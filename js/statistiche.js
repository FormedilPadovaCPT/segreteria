/* ============================================================
   Statistiche del registro di protocollo.
   Numeri a colpo d'occhio più quattro distribuzioni:
   andamento per anno, tipo documento, mezzo, cartella d'archivio.
   ============================================================ */

import { sb, $, esc, dataIt, toast } from './core.js';

export async function render(anno = null) {
  const host = $('#stat-host');
  host.innerHTML = '<div class="card empty">Calcolo in corso…</div>';

  const { data: s, error } = await sb.rpc('s_stat_protocollo', { p_anno: anno });
  if (error || !s) {
    host.innerHTML = `<div class="card empty">Non riesco a calcolare le statistiche: ${esc(error?.message || '')}</div>`;
    return;
  }

  const annoOra = new Date().getFullYear();
  const opzioni = ['<option value="">Tutti gli anni</option>']
    .concat((s.per_anno || []).map((x) => `<option value="${x.anno}" ${anno === x.anno ? 'selected' : ''}>${x.anno}</option>`))
    .join('');

  host.innerHTML = `
    <div class="card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <label for="st-anno" style="font-size:12px;font-weight:600;color:var(--grigio)">Periodo</label>
      <select id="st-anno" class="inp inp-sm">${opzioni}</select>
      <span style="font-size:12px;color:var(--testo-soft)">I protocolli annullati sono esclusi dai conteggi.</span>
    </div>

    <div class="kpi"><div class="v">${(s.tot_in || 0).toLocaleString('it-IT')}</div><div class="l">In entrata</div></div>
    <div class="kpi" style="border-left-color:var(--out)"><div class="v">${(s.tot_out || 0).toLocaleString('it-IT')}</div><div class="l">In uscita</div></div>
    <div class="kpi" style="border-left-color:var(--grigio)"><div class="v">${(s.anno_corr || 0).toLocaleString('it-IT')}</div><div class="l">Protocollati nel ${annoOra}</div></div>
    ${s.serie_attiva === 'unica'
      ? `<div class="kpi"><div class="v" style="font-size:19px">Prot_${esc(s.esercizio_corr)}_${String(s.ultimo_unica || 0).padStart(4, '0')}</div>
           <div class="l">Ultimo protocollo dell'esercizio ${esc(s.esercizio_corr)}</div></div>`
      : `<div class="kpi"><div class="v">${s.ultimo_in || 0} / ${s.ultimo_out || 0}</div>
           <div class="l">Ultimo numero IN / OUT · serie unica dal ${dataIt(s.serie_unica_dal)}</div></div>`}

    ${cardEsercizi(s.per_esercizio)}
    ${cardAnni(s.per_anno)}
    ${cardBarre('Tipo di documento', s.per_tipo)}
    ${cardBarre('Mezzo di trasmissione', s.per_mezzo)}
    ${cardBarre("Cartella d'archivio", s.per_cartella)}`;

  $('#st-anno').addEventListener('change', (e) => render(e.target.value ? Number(e.target.value) : null));
}

function cardEsercizi(righe) {
  if (!righe?.length) return '';
  const max = Math.max(...righe.map((r) => r.n));
  return `
    <div class="card">
      <div class="sect-title" style="margin-top:0">Serie unica, per esercizio</div>
      ${righe.map((r) => `
        <div class="bar-row">
          <span class="lb">${esc(r.v)}</span>
          <span class="br" style="display:flex">
            <i style="width:${(r.entrata / max * 100).toFixed(1)}%;background:var(--in)"></i>
            <i style="width:${(r.uscita / max * 100).toFixed(1)}%;background:var(--out)"></i>
          </span>
          <span class="vl">${r.n}</span>
        </div>`).join('')}
      <p style="font-size:11px;color:var(--testo-soft);margin:10px 0 0">
        Un solo contatore per esercizio: entrata e uscita si dividono gli stessi numeri.
      </p>
    </div>`;
}

function cardAnni(righe) {
  if (!righe?.length) return '';
  const max = Math.max(...righe.map((r) => r.entrata + r.uscita));
  return `
    <div class="card">
      <div class="sect-title" style="margin-top:0">Protocolli per anno</div>
      ${righe.map((r) => {
        const tot = r.entrata + r.uscita;
        return `
        <div class="bar-row">
          <span class="lb">${r.anno}</span>
          <span class="br" style="display:flex">
            <i style="width:${(r.entrata / max * 100).toFixed(1)}%;background:var(--in)"></i>
            <i style="width:${(r.uscita / max * 100).toFixed(1)}%;background:var(--out)"></i>
          </span>
          <span class="vl">${tot}</span>
        </div>`;
      }).join('')}
      <p style="font-size:11px;color:var(--testo-soft);margin:10px 0 0">
        <span class="dot dot-in"></span> entrata &nbsp; <span class="dot dot-out"></span> uscita
      </p>
    </div>`;
}

function cardBarre(titolo, righe) {
  if (!righe?.length) return '';
  const max = Math.max(...righe.map((r) => r.n));
  return `
    <div class="card">
      <div class="sect-title" style="margin-top:0">${esc(titolo)}</div>
      ${righe.map((r) => `
        <div class="bar-row">
          <span class="lb" title="${esc(r.v)}">${esc(r.v)}</span>
          <span class="br"><i style="width:${(r.n / max * 100).toFixed(1)}%"></i></span>
          <span class="vl">${r.n}</span>
        </div>`).join('')}
    </div>`;
}
