/* ============================================================
   Cronologia dello stato in Cassa Edile di un'impresa (19/09/2026).

   I dati stanno in `imprese_cassa_storico`, una riga per PERIODO, e
   li scrive solo il database: `ceiv_applica` a ogni lista caricata,
   un trigger quando lo stato si cambia a mano da una maschera.

   ⚠️ `visto_dal` e `visto_fino` sono le LISTE che riportano quello
   stato, non le date vere del cambio: di un passaggio da Attiva a
   Sospesa si sa solo fra quali due liste è avvenuto. Per questo qui
   si scrive «dalla lista del…» e mai «dal…».

   Modulo puro (niente DOM, niente Supabase): si prova con node --test.
   ============================================================ */
import { esc, dataIt } from './comune.js';

const FONTI = {
  lista: 'lista CEIV',
  anagrafica: 'era in anagrafica',
  manuale: 'scritto a mano',
};

/* il colore dice lo stato, non il giudizio: verde chi è in regola con
   l'iscrizione, ambra chi è sospeso, grigio il resto */
function classeStato(stato) {
  if (/^attiva$/i.test(stato || '')) return 'background:#e8f5e9;color:#1b5e20';
  if (/^sospesa$/i.test(stato || '')) return 'background:#fff3d6;color:#7a5200';
  if (/non più in lista/i.test(stato || '')) return 'background:#fde8e8;color:#8a1c1c';
  return 'background:#eceff1;color:#37474f';
}

/* «dalla lista del 30/08/2026» · «confermato fino alla lista del 30/09/2026» */
export function periodoTesto(p) {
  const daLista = p.fonte === 'lista';
  const dal = p.visto_dal ? dataIt(p.visto_dal) : null;
  const fino = p.visto_fino ? dataIt(p.visto_fino) : null;
  let t;
  if (!dal) t = 'da data non nota';
  else if (daLista) t = `dalla lista del ${dal}`;
  else if (p.fonte === 'manuale') t = `dal ${dal}`;
  else t = `risultava al ${dal}`;
  if (daLista && fino && fino !== dal) t += ` · confermato fino alla lista del ${fino}`;
  return t;
}

/* Le righe arrivano in qualunque ordine: si mostrano dalla più recente. */
export function ordinaPeriodi(periodi) {
  return [...(periodi || [])].sort((a, b) => {
    if (!!b.attuale !== !!a.attuale) return b.attuale ? 1 : -1;
    const da = a.visto_dal || '', db = b.visto_dal || '';
    if (da !== db) return da < db ? 1 : -1;
    return (b.id || 0) - (a.id || 0);
  });
}

export function cronologiaCassaHtml(periodi, listaAl) {
  const righe = ordinaPeriodi(periodi);
  if (!righe.length) {
    return `<p class="hint">Nessuno stato registrato: l'impresa non è mai comparsa in una lista CEIV caricata${listaAl ? ` (ultima: ${esc(dataIt(listaAl))})` : ''} e non ha uno stato scritto in anagrafica.</p>`;
  }
  const tr = (p) => `
    <tr${p.attuale ? ' style="font-weight:600"' : ''}>
      <td><span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:12px;${classeStato(p.stato)}">${esc(p.stato)}</span>${p.attuale ? ' <span class="tag">attuale</span>' : ''}</td>
      <td>${esc(periodoTesto(p))}</td>
      <td>${esc(p.cod_ceiv || '—')}</td>
      <td>${esc(FONTI[p.fonte] || p.fonte || '')}</td>
      <td style="font-weight:400;color:var(--testo-soft)">${esc(p.nota || '')}</td>
    </tr>`;
  return `
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th style="width:170px">Stato</th><th>Quando</th><th style="width:110px">Codice CEIV</th><th style="width:130px">Da dove viene</th><th>Nota</th></tr></thead>
        <tbody>${righe.map(tr).join('')}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:6px">Lo storico lo scrive il database a ogni lista CEIV caricata. Le date sono quelle delle <b>liste</b> che riportano lo stato, non del giorno in cui è cambiato: di un passaggio si sa solo fra quali due liste è avvenuto. «Non più in lista» è un fatto sulla lista, non uno stato dell'impresa: in anagrafica lo stato non viene cambiato.</p>`;
}
