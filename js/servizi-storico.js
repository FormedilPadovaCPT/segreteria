/* ============================================================
   STORICO DEI SERVIZI (Access «VisiteCassaEdile», 1.078 richieste
   2011-2026, serie 95/2014 → 1082/2026) — consultazione condivisa.

   La tabella s_servizi_storico contiene TUTTE le tipologie; la
   pagina Segnalazioni la mostra intera («📜 Storico Access»),
   qui la stessa consultazione arriva anche a Consulenze, Richieste
   visita e Conferenze, PREFILTRATA per tipologia (chiesto
   dall'utente il 01/09/2026). Sola lettura: le pratiche nuove non
   proseguono quella serie — dal 1/10/2026 vale il registro unico.
   ============================================================ */

import { sb, $, esc, dataIt, apriDrawer } from './core.js';

let cache = null;

export async function apriStoricoServizi(host, { titolo, filtra, indietro }) {
  host.innerHTML = '<p class="empty">Un istante…</p>';
  if (!cache) {
    /* a blocchi: la tabella ha 1.078 righe e Supabase ne dà al massimo
       1.000 per chiamata — senza paginazione le ultime sparirebbero */
    cache = [];
    for (let da = 0; ; da += 1000) {
      const { data } = await sb.from('s_servizi_storico').select('*')
        .order('id', { ascending: false }).range(da, da + 999);
      cache.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  const base = cache.filter((r) => filtra(r));
  let cerca = '';

  const disegna = () => {
    const q = cerca.toLowerCase();
    const filtrate = q
      ? base.filter((r) => [r.richiedente, r.impresa, r.comune_cantiere, r.tipologia, r.tecnico, r.comunicazione, String(r.id)]
          .some((v) => (v || '').toLowerCase().includes(q)))
      : base;
    const MOSTRA = 150;
    const righe = filtrate.slice(0, MOSTRA).map((r) => `<tr data-sid="${r.id}">
      <td>${r.id}</td>
      <td>${r.data_richiesta ? dataIt(r.data_richiesta) : '—'}</td>
      <td>${esc((r.tipologia || '').replace(/^Richiesta /, ''))}</td>
      <td>${esc(r.richiedente || '—')}</td>
      <td>${esc(r.impresa || '—')}</td>
      <td>${esc(r.comune_cantiere || '—')}</td>
      <td>${esc(r.tecnico || '—')}</td>
    </tr>`).join('');

    host.innerHTML = `
      <div class="dt-barra">
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-ghost btn-sm" id="ss-indietro">← Torna alle pratiche</button>
          <strong>${esc(titolo)}</strong>
        </div>
        <input id="ss-cerca" class="inp" type="search" style="max-width:340px"
          placeholder="Cerca in richiedente, impresa, comune, tecnico…" value="${esc(cerca)}">
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>N°</th><th>Data</th><th>Tipologia</th><th>Richiedente</th><th>Impresa</th><th>Comune</th><th>Tecnico</th></tr></thead>
          <tbody>${righe || '<tr><td colspan="7" class="empty">Niente con questa ricerca.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px">
        Storico Access (VisiteCassaEdile) 2011-2026: ${base.length} pratiche di questa famiglia,
        ${filtrate.length} con la ricerca${filtrate.length > MOSTRA ? ` (mostrate le prime ${MOSTRA})` : ''}.
        L'ID è la vecchia serie «richieste visite», chiusa col registro unico dal 1/10/2026. Sola consultazione.
      </p>`;

    $('#ss-indietro').addEventListener('click', indietro);
    $('#ss-cerca').addEventListener('input', (e) => { cerca = e.target.value; disegna(); });
    host.querySelectorAll('tbody tr[data-sid]').forEach((tr) =>
      tr.addEventListener('click', () => dettaglio(Number(tr.dataset.sid))));
  };

  const dettaglio = (id) => {
    const r = base.find((x) => x.id === id) || cache.find((x) => x.id === id);
    if (!r) return;
    const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(String(v))}</div>` : '';
    apriDrawer(`Storico n° ${r.id} — ${(r.tipologia || '').replace(/^Richiesta /, '')}`, '', `
      ${campo('Tipologia', r.tipologia)}
      ${campo('Data richiesta', r.data_richiesta ? dataIt(r.data_richiesta) : null)}
      ${campo('Mezzo', r.mezzo)}
      ${campo('Richiedente', r.richiedente)}
      ${campo('Impresa', r.impresa)}
      ${campo('Cantiere', [r.cantiere, r.indirizzo_cantiere, r.comune_cantiere].filter(Boolean).join(' — '))}
      ${campo('Referente', [r.referente, r.cell_referente].filter(Boolean).join(' — '))}
      ${r.comunicazione ? `<div class="dt-doc-riga"><strong>Comunicazione:</strong><br>${esc(r.comunicazione)}</div>` : ''}
      ${campo('Oggetto', r.oggetto)}
      <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
      ${campo('Approvata', r.approvato)}
      ${campo('Data risposta', r.data_risposta ? dataIt(r.data_risposta) : null)}
      ${campo('Tecnico', r.tecnico)}
      ${campo('Verbale visita', [r.verbale_visita, r.data_verbale ? `del ${dataIt(r.data_verbale)}` : null].filter(Boolean).join(' '))}
      ${campo('Verbale comunicato il', r.data_com_verbale ? dataIt(r.data_com_verbale) : null)}
      ${campo('Valutazione', r.valutazione)}
      ${r.note_tecnico ? `<div class="dt-doc-riga"><strong>Note del tecnico:</strong><br>${esc(r.note_tecnico)}</div>` : ''}
      ${r.note ? `<div class="dt-doc-riga"><strong>Note:</strong><br>${esc(r.note)}</div>` : ''}
      ${campo('Ore', r.ore)}
      ${campo('Corrispettivo', r.corrispettivo)}
      ${campo('Fattura', [r.da_fatturare ? 'da fatturare' : null, r.n_fatt].filter(Boolean).join(' — '))}
      ${campo('Pratica chiusa', r.pratica_chiusa)}
      <p class="hint" style="margin-top:10px">Registro storico di Access: sola consultazione, non si modifica.
        L'ID ${r.id} è il numero della vecchia serie «richieste visite».</p>`);
  };

  disegna();
}
