/* ============================================================
   PREVENTIVI DI ASSEVERAZIONE NEL CRUSCOTTO (12/10/2026)

   Il preventivo 5.D.2 lo approva il Direttore nella pagina Direzione
   del gestionale, prima di numero, timbro e firma (eccezione 7). La
   richiesta parte dall'app asseverazione, ma chi aspetta il Direttore
   lo guarda qui: chiesto dall'utente lo stesso giorno («non si
   dovrebbe vedere in attesa del direttore nell'app della segreteria?»).
   Qui solo la lettura e le righe della tessera «⏳ In attesa del
   Direttore»: si corregge e si protocolla nell'app asseverazione.
   ============================================================ */

import { sb, esc, dataIt, toast } from './core.js';

const BUCKET = 'approvazioni-direttore';
const APP_ASSEV = 'https://webapp-asseverazione.vercel.app';

/* l'ultima richiesta di ogni pratica: una rimandata poi rifatta non resta in lista */
export async function datiApprovazioni() {
  const { data, error } = await sb.from('s_approvazioni_direttore')
    .select('id, tipo, rif, titolo, dettaglio, stato, file_bozza, richiesta_il, avviso_il, avviso_esito, decisa_il, nota')
    .in('stato', ['in_attesa', 'rimandata', 'approvata', 'ritirata', 'superata'])
    .order('richiesta_il', { ascending: false }).limit(300);
  if (error) return { errore: error.message, inAttesa: [], rimandate: [], daProtocollare: [] };
  const ultime = new Map();
  for (const r of data || []) { const k = `${r.tipo}|${r.rif}`; if (!ultime.has(k)) ultime.set(k, r); }
  const tutte = [...ultime.values()];
  /* approvato e non ancora protocollato: il passo dopo è della segreteria */
  let daProtocollare = tutte.filter((r) => r.stato === 'approvata');
  if (daProtocollare.length) {
    const { data: prot, error: eP } = await sb.from('a_pratica_protocollo').select('pratica_id')
      .eq('documento', 'preventivo').in('pratica_id', daProtocollare.map((r) => r.rif));
    /* se non riesco a leggere i protocolli non li mostro: meglio una riga in meno che un «da protocollare» falso */
    daProtocollare = eP ? [] : daProtocollare.filter((r) => !(prot || []).some((p) => p.pratica_id === r.rif));
  }
  return {
    errore: null,
    inAttesa: tutte.filter((r) => r.stato === 'in_attesa'),
    rimandate: tutte.filter((r) => r.stato === 'rimandata'),
    daProtocollare,
  };
}

export const quanteApprovazioni = (a) => a && !a.errore ? a.inAttesa.length + a.rimandate.length + a.daProtocollare.length : 0;

const giorni = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : 0;
const euro = (n) => n == null ? '' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const pratica = (r) => `<a href="${APP_ASSEV}/pratiche/${encodeURIComponent(r.rif)}/ufficio" target="_blank" rel="noopener">apri la pratica</a>`;

export function righeApprovazioni(a) {
  if (!a || a.errore) return '';
  const riga = (icona, r, testo, azioni) => `
    <div class="hm-riga" style="cursor:default">
      <span>${icona}</span>
      <span><strong>${esc(r.titolo)}</strong><br><span class="hint">${testo}</span></span>
      <span style="white-space:nowrap">${azioni}</span>
    </div>`;
  const cifre = (r) => {
    const d = r.dettaglio || {};
    return [d.giornate != null ? `${String(d.giornate).replace('.', ',')} gg` : '', euro(d.totale), d.sotto_minimo ? '⚠ sotto il minimo' : '']
      .filter(Boolean).join(' · ');
  };
  return [
    ...a.inAttesa.map((r) => riga('📑', r,
      `${cifre(r)} — dal ${dataIt(String(r.richiesta_il).slice(0, 10))}${giorni(r.richiesta_il) ? ` (${giorni(r.richiesta_il)} g)` : ''}`
        + (String(r.avviso_esito || '').startsWith('non inviat') ? ' · <span style="color:#a01f00">⚠ la mail al Direttore non è partita</span>' : ''),
      `${r.file_bozza ? `<a href="#" data-ad-apri="${esc(r.file_bozza)}">bozza</a> · ` : ''}${pratica(r)}`)),
    ...a.rimandate.map((r) => riga('↩', r,
      `rimandato il ${dataIt(String(r.decisa_il).slice(0, 10))}: «${esc(r.nota || '')}» — si corregge e si rimanda dall'app asseverazione`,
      pratica(r))),
    ...a.daProtocollare.map((r) => riga('✅', r,
      `approvato il ${dataIt(String(r.decisa_il).slice(0, 10))} — «Protocolla e genera» nell'app asseverazione`,
      pratica(r))),
  ].join('');
}

export const bottoneRicorda = (a) => a && !a.errore && a.inAttesa.length
  ? '<button class="btn btn-sm" type="button" id="hm-ad-ricorda">🔔 Ricorda al Direttore i preventivi</button>' : '';

async function testoErrore(error) {
  try { const j = await error?.context?.json?.(); if (j?.error) return j.error; } catch { /* niente */ }
  return error?.message || 'richiesta non riuscita';
}

export function collegaApprovazioni(host, ricarica) {
  host.querySelectorAll('[data-ad-apri]').forEach((el) => el.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(el.dataset.adApri, 600);
    if (error || !data?.signedUrl) return toast('Non riesco ad aprire la bozza: ' + (error?.message || ''), 'err');
    window.open(data.signedUrl, '_blank', 'noopener');
  }));
  host.querySelector('#hm-ad-ricorda')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (!confirm('Rimando al Direttore la mail con tutti i preventivi che aspettano la sua approvazione?')) return;
    b.disabled = true;
    const { data, error } = await sb.functions.invoke('approvazione-direttore', { body: { azione: 'avvisa' } });
    b.disabled = false;
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    if (!data?.avviso?.inviata) return toast('La mail non è partita: ' + (data?.avviso?.errore || 'motivo sconosciuto'), 'err');
    toast(`Mail mandata al Direttore (${data.avviso.documenti} preventivi in attesa).`, 'ok'); ricarica();
  });
}
