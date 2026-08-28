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
  esc, dataIt, oggiIso,
  codiceProtocollo, siglaProtocollo, protocolloEsteso, esercizioDi,
} from './comune.js';

let toastTimer;
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
    registro: '#view-registro',
    'nuovo-in': '#view-form',
    'nuovo-out': '#view-form',
    form: '#view-form',
    imprese: '#view-imprese',
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
