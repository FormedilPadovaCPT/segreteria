/* ============================================================
   STORICO DEI SERVIZI (Access «VisiteCassaEdile», 1.078 richieste
   2011-2026, serie 95/2014 → 1082/2026) — consultazione condivisa.

   Due modi di vederlo (chiesti dall'utente il 01/09/2026):
   1. DENTRO le viste Consulenze / Richieste visita / Conferenze,
      sotto il filtro «Chiuse», in coda alle pratiche vere, marcato
      📜 — come le DNL storiche nei Cantieri notificati;
   2. il pannello «📜 Storico Access» con la ricerca libera.
   Sola lettura: le pratiche nuove non proseguono quella serie —
   dal 1/10/2026 vale il registro unico.
   ============================================================ */

import { sb, $, esc, dataIt, apriDrawer } from './core.js';

let cache = null;

/* carico a blocchi: la tabella ha 1.078 righe e Supabase ne dà al
   massimo 1.000 per chiamata — senza paginazione le ultime sparirebbero */
export async function caricaStorico() {
  if (!cache) {
    cache = [];
    for (let da = 0; ; da += 1000) {
      const { data } = await sb.from('s_servizi_storico').select('*')
        .order('id', { ascending: false }).range(da, da + 999);
      cache.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return cache;
}

/* dettaglio in sola lettura, uguale ovunque lo si apra */
export function apriDettaglioStorico(r) {
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
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-ghost btn-sm" id="ss-stampa">🖨 Scheda in PDF</button>
    </div>
    <p class="hint" style="margin-top:10px">Registro storico di Access: sola consultazione, non si modifica.
      L'ID ${r.id} è il numero della vecchia serie «richieste visite».</p>`);

  $('#ss-stampa').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const byte = await pdfSchedaStorico(r);
      const { scaricaPdf } = await import('./corsi-doc.js');
      scaricaPdf(byte, `Storico_${r.id}_${String(r.tipologia || 'pratica').replace(/^Richiesta /, '').replace(/[^\w]+/g, '-').slice(0, 40)}.pdf`);
    } finally { ev.currentTarget.disabled = false; }
  });
}

/* la scheda stampabile di una pratica storica, su carta Formedil */
export async function pdfSchedaStorico(r) {
  const { apriCarta } = await import('./segnalazioni-doc.js');
  const c = await apriCarta();
  c.scrivi(`Pratica storica n° ${r.id}`, c.bold, 14, c.arancio);
  c.scrivi(r.tipologia || '', c.bold, 10.5, c.nero);
  c.scrivi('Registro richieste/servizi Access (VisiteCassaEdile) — ristampa di consultazione', c.italic, 8, c.grigio);
  c.stato.y -= 8;
  c.campo('Data richiesta', r.data_richiesta ? dataIt(r.data_richiesta) : null);
  c.campo('Mezzo', r.mezzo);
  c.campo('Richiedente', r.richiedente);
  c.campo('Impresa', r.impresa);
  c.campo('Cantiere', [r.cantiere, r.indirizzo_cantiere, r.comune_cantiere].filter(Boolean).join(' — '));
  c.campo('Referente', [r.referente, r.cell_referente].filter(Boolean).join(' — '));
  c.campo('Comunicazione', r.comunicazione);
  c.campo('Oggetto', r.oggetto);
  c.stato.y -= 6;
  c.campo('Approvata', r.approvato);
  c.campo('Data risposta', r.data_risposta ? dataIt(r.data_risposta) : null);
  c.campo('Tecnico', r.tecnico);
  c.campo('Verbale visita', [r.verbale_visita, r.data_verbale ? `del ${dataIt(r.data_verbale)}` : null].filter(Boolean).join(' '));
  c.campo('Verbale comunicato il', r.data_com_verbale ? dataIt(r.data_com_verbale) : null);
  c.campo('Valutazione', r.valutazione);
  c.campo('Note del tecnico', r.note_tecnico);
  c.campo('Note', r.note);
  c.campo('Ore', r.ore);
  c.campo('Corrispettivo', r.corrispettivo);
  c.campo('Fattura', [r.da_fatturare ? 'da fatturare' : null, r.n_fatt].filter(Boolean).join(' — '));
  c.campo('Pratica chiusa', r.pratica_chiusa);
  c.stato.y -= 10;
  c.scrivi(`L'ID ${r.id} è il numero della vecchia serie «richieste visite», chiusa col registro unico dal 1/10/2026. Stampata il ${dataIt(new Date().toISOString().slice(0, 10))}.`, c.font, 7.5, c.grigio);
  return new Uint8Array(await c.doc.save());
}

/* righe 📜 da accodare a «Chiuse» nelle viste: colspan tarato sul
   numero di colonne della tabella che le ospita */
export function righeStorico(righe, colonne) {
  return righe.map((r) => `<tr data-sid="${r.id}" title="Registro storico Access — sola consultazione">
    <td>📜 ${r.id}</td>
    <td>${r.data_richiesta ? dataIt(r.data_richiesta) : '—'}</td>
    <td>${esc(r.impresa || r.richiedente || '—')}</td>
    <td colspan="${Math.max(1, colonne - 4)}" class="hint">${esc([
      (r.tipologia || '').replace(/^Richiesta /, ''),
      r.comune_cantiere, r.tecnico ? `tecnico ${r.tecnico}` : null, r.valutazione,
    ].filter(Boolean).join(' · '))}</td>
    <td>Storico</td>
  </tr>`).join('');
}

/* aggancia il click delle righe 📜 dentro un host */
export function collegaRigheStorico(host, righe) {
  host.querySelectorAll('tbody tr[data-sid]').forEach((tr) =>
    tr.addEventListener('click', () => apriDettaglioStorico(righe.find((x) => x.id === Number(tr.dataset.sid)))));
}

/* ── il pannello con la ricerca libera («📜 Storico Access») ── */
export async function apriStoricoServizi(host, { titolo, filtra, indietro }) {
  host.innerHTML = '<p class="empty">Un istante…</p>';
  const base = (await caricaStorico()).filter((r) => filtra(r));
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
      tr.addEventListener('click', () => apriDettaglioStorico(base.find((x) => x.id === Number(tr.dataset.sid)))));
  };

  disegna();
}
