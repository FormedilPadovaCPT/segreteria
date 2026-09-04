/* ============================================================
   RICERCA IN ANAGRAFICA — imprese e persone

   Serve dove si inserisce a mano quello che l'import dal foglio
   Google trova da solo: la maschera manuale non deve far
   riscrivere dati che in anagrafica ci sono gia'.

   Regola di casa (04/09/2026): prima si cerca, e si crea solo se
   non c'e'. Chiave dell'impresa la partita IVA (impresa_id),
   della persona il codice fiscale.

   Per le imprese si usa la RPC s_cerca_imprese, la stessa della
   pagina Imprese: la logica di ricerca sta in un posto solo. La
   RPC pero' torna poche colonne, quindi alla scelta si rilegge
   la riga intera — e' quella che serve a riempire i campi.
   ============================================================ */

import { sb, $, esc } from './core.js';

function collega(inputSel, boxSel, cerca, disegna, onScelta, vuoto) {
  const input = $(inputSel);
  if (!input) return;
  let timer = null;
  const box = () => $(boxSel);
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 3) { if (box()) box().innerHTML = ''; return; }
    timer = setTimeout(async () => {
      let righe = [];
      try { righe = (await cerca(q)) || []; } catch (err) { console.warn('ricerca anagrafica:', err); }
      if (!box()) return;
      box().innerHTML = righe.length
        ? righe.map((r, k) => `<button class="btn btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin-top:4px" data-k="${k}">${disegna(r)}</button>`).join('')
        : `<p class="hint">${vuoto}</p>`;
      box().querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async (ev) => {
        ev.preventDefault();
        await onScelta(righe[Number(b.dataset.k)]);
      }));
    }, 250);
  });
}

/* La riga completa dell'impresa: la RPC di ricerca non porta
   recapiti e indirizzo, che invece servono a riempire la maschera */
export async function impresaIntera(impresaId) {
  const { data } = await sb.from('imprese')
    .select('impresa_id, impresa_nome, ragione_sociale2, impresa_cf, piva, cod_ceiv, stato_cassa, '
      + 'impresa_telefono, impresa_telefono2, cellulare, impresa_email_ref, impresa_email2, pec, '
      + 'indirizzo, comune, cap, prov')
    .eq('impresa_id', impresaId).maybeSingle();
  return data || null;
}

export function collegaRicercaImprese(inputSel, boxSel, onScelta) {
  collega(inputSel, boxSel,
    async (q) => {
      const { data } = await sb.rpc('s_cerca_imprese', { p_testo: q, p_limite: 8 });
      return data;
    },
    (r) => `${esc(r.impresa_nome || '(senza nome)')} <span class="hint">${esc(r.impresa_id || '')}`
      + `${r.comune ? ' · ' + esc(r.comune) : ''}${r.cod_ceiv ? ' · CEIV ' + esc(r.cod_ceiv) : ''}</span>`,
    async (r) => onScelta(await impresaIntera(r.impresa_id) || r),
    'Nessuna impresa in anagrafica: scrivi i dati a mano — la pratica si aggancia poi con la partita IVA.');
}

export function collegaRicercaPersone(inputSel, boxSel, onScelta) {
  collega(inputSel, boxSel,
    async (q) => {
      const { data } = await sb.from('persone')
        .select('persona_id, cognome, nome, titolo, cf, email, telefono, telefono2, qualifica')
        .or(`cognome.ilike.%${q}%,nome.ilike.%${q}%,cf.ilike.%${q}%`)
        .order('cognome').limit(8);
      return data;
    },
    (r) => `${esc([r.cognome, r.nome].filter(Boolean).join(' '))} <span class="hint">${esc(r.cf || r.email || '')}`
      + `${r.qualifica ? ' · ' + esc(r.qualifica) : ''}</span>`,
    onScelta,
    'Nessuna persona in anagrafica: scrivi il nominativo a mano.');
}

/* Il nome per esteso, come si scrive sui documenti */
export function nomePersona(p) {
  return [p.cognome, p.titolo, p.nome].filter(Boolean).join(' ');
}
