/* ============================================================
   Nucleo condiviso: client Supabase, stato, scorciatoie, drawer.
   Sta in un modulo a sé — e non in app.js — perché app.js resta
   sospeso sull'await di primo livello dell'accesso: se i moduli
   importassero da lì si creerebbe un anello che non si chiude
   mai (l'app resterebbe ferma senza dare errore).
   ============================================================ */

import { SB_URL, SB_KEY } from './config.js';
import { supabaseJs } from './cdn.js';

/* ── client ───────────────────────────────────────────────── */
let createClient;
try {
  ({ createClient } = await supabaseJs());
} catch (e) {
  document.body.innerHTML = `
    <div style="max-width:520px;margin:16vh auto;padding:28px;background:#fff;border-radius:10px;
                border-top:5px solid #e7500f;font-family:Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.1)">
      <h2 style="color:#e7500f;margin:0 0 10px">Avvio non riuscito</h2>
      <p style="line-height:1.6;color:#444">${e.message}</p>
      <p style="line-height:1.6;color:#444">Chiedi all'assistenza informatica di autorizzare
      <code>cdn.jsdelivr.net</code>, <code>esm.sh</code> e <code>cdn.skypack.dev</code>,
      oppure prova da un'altra connessione.</p>
      <button onclick="location.reload()" style="background:#e7500f;color:#fff;border:0;border-radius:6px;
              padding:10px 18px;font-size:14px;cursor:pointer">Riprova</button>
    </div>`;
  throw e;
}

export const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const state = {
  user: null,
  email: '',
  tipiDoc: [],       // [{id_doc, descrizione}]
  vistaCorrente: 'registro',
};

/* ── scorciatoie ──────────────────────────────────────────── */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Le funzioni pure stanno in comune.js e da qui si ri-esportano:
   chi importa da core.js continua a trovarle dov'erano. */
export {
  esc, dataIt, leggiData, oggiIso,
  codiceProtocollo, siglaProtocollo, protocolloEsteso, esercizioDi,
} from './comune.js';

let toastTimer;
/* L'impresa in anagrafica a partire dalla P.IVA. La chiave impresa_id è la
   P.IVA per le società, ma per le DITTE INDIVIDUALI è il codice fiscale del
   titolare, e la P.IVA sta nel campo piva: cercando la sola chiave le ditte
   individuali non si trovavano, e la pratica usciva «CEIV da verificare»
   anche con l'impresa attiva in lista (Noventa Christian, consulenza n. 1
   del 24/09/2026). Si cercano tutte e due; a parità vince la riga non
   eliminata, poi quella la cui chiave è la P.IVA. Stessa forma di risposta
   di maybeSingle(), così i chiamanti non cambiano. */
export async function impresaPerPiva(piva, colonne = 'impresa_id') {
  const v = String(piva || '').trim();
  if (!/^[0-9A-Za-z]+$/.test(v)) return { data: null, error: null };
  const { data, error } = await sb.from('imprese')
    .select(`${colonne}, impresa_id, piva, elimina`)
    .or(`impresa_id.eq.${v},piva.eq.${v}`)
    .limit(10);
  if (error || !data?.length) return { data: null, error };
  const punti = (r) => (r.elimina ? 0 : 2) + (r.impresa_id === v ? 1 : 0);
  return { data: [...data].sort((a, b) => punti(b) - punti(a))[0], error: null };
}

/* La riga «Spesa prevista» dei servizi CPT (consulenze, visite su richiesta,
   conferenze), uguale sul foglio al Direttore e nella mail. Il campo
   corrispettivo è la TARIFFA ORARIA, come negli incarichi del gestionale
   (dove la fattura del tecnico fa corrispettivo × ore): «2 ore — € 50» si
   leggeva come un totale, quindi si scrivono tariffa e totale (24/09/2026).
   «Ordinaria» non è un dato mancante: la prestazione rientra fra le visite
   già assegnate al tecnico per il mese, quindi è già pagata. */
export function testoSpesa(p) {
  if (p.spesa_ordinaria !== false) return 'ordinaria — rientra nelle visite già assegnate al tecnico per il mese';
  const eur = (n) => `€ ${Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const ore = p.ore != null && p.ore !== '' ? Number(p.ore) : null;
  const tariffa = p.corrispettivo != null && p.corrispettivo !== '' ? Number(p.corrispettivo) : null;
  const oreTxt = ore != null ? `${ore.toLocaleString('it-IT')} ${ore === 1 ? 'ora' : 'ore'}` : null;
  if (ore != null && tariffa != null) return `a corrispettivo — ${oreTxt} × ${eur(tariffa)}/ora = ${eur(ore * tariffa)} totale`;
  if (tariffa != null) return `a corrispettivo — ${eur(tariffa)}/ora, ore da definire`;
  if (ore != null) return `a corrispettivo — ${oreTxt}, tariffa oraria da definire`;
  return 'a corrispettivo, importo da definire';
}

export function toast(msg, tipo = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), tipo === 'err' ? 6000 : 3500);
}

export function attendi(btn, attivo, testoAttesa = 'Attendere…') {
  if (!btn) return;
  if (attivo) {
    btn.dataset.testo = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${testoAttesa}`;
    btn.disabled = true;
  } else {
    if (btn.dataset.testo) btn.innerHTML = btn.dataset.testo;
    btn.disabled = false;
  }
}

/* ── navigazione ──────────────────────────────────────────── */
export function mostraVista(nome) {
  const mappa = {
    home: '#view-home',
    registro: '#view-registro',
    'nuovo-in': '#view-form',
    'nuovo-out': '#view-form',
    form: '#view-form',
    imprese: '#view-imprese',
    'doc-tecnici': '#view-doc-tecnici',
    rlst: '#view-rlst',
    rls: '#view-rls',
    segnalazioni: '#view-segnalazioni',
    consulenze: '#view-consulenze',
    visite: '#view-visite',
    stage: '#view-stage',
    notifiche: '#view-notifiche',
    conferenze: '#view-conferenze',
    attestazioni: '#view-attestazioni',
    questionari: '#view-questionari',
    corsi: '#view-corsi',
    persone: '#view-persone',
    nomine: '#view-nomine',
    presenze: '#view-presenze',
    'fatture-tecnici': '#view-fatture-tecnici',
    amministrazione: '#view-amministrazione',
    comunicazione: '#view-comunicazione',
    statistiche: '#view-statistiche',
  };
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(mappa[nome] || '#view-registro').classList.remove('hidden');
  $$('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === nome));
  $('#sidebar').classList.remove('is-open');
  state.vistaCorrente = nome;
  window.scrollTo(0, 0);
}

/* ── drawer ───────────────────────────────────────────────── */
export function apriDrawer(titolo, direzione, html) {
  $('#drawer').classList.remove('drawer-xl');   /* la scheda larga la ri-chiede chi la vuole */
  const head = $('#drawer-head');
  head.className = `drawer-head dir-${direzione || ''}`;
  $('#drawer-badge').className = `badge badge-${(direzione || '').toLowerCase()}`;
  $('#drawer-badge').textContent = direzione === 'IN' ? 'Entrata' : direzione === 'OUT' ? 'Uscita' : '';
  $('#drawer-title').textContent = titolo;
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.remove('hidden');
  $('#drawer-bg').classList.remove('hidden');
}

export function chiudiDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-bg').classList.add('hidden');
}
