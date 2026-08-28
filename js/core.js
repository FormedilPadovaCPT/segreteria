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

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function dataIt(iso) {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return g && m && a ? `${g}/${m}/${a}` : iso;
}

export function oggiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── come si scrive il numero di protocollo ────────────────
   Fino al 30/09/2026 due registri separati: il numero da solo
   non basta, serve la direzione (2554-out). Dal 01/10/2026 una
   serie sola per esercizio: Prot_26-27_0001.
   Il codice lo calcola il database nella colonna `codice`: qui
   si usa quello, e si ricostruisce a mano solo per l'anteprima
   del form, dove la riga non esiste ancora.
   ────────────────────────────────────────────────────────── */
export function codiceProtocollo(p) {
  if (!p) return '';
  if (p.codice) return p.codice;
  if (p.esercizio) return `Prot_${p.esercizio}_${String(p.numero ?? '').padStart(4, '0')}`;
  const coda = p.direzione === 'IN' ? '-in' : p.direzione === 'OUT' ? '-out' : '';
  return `${p.numero ?? ''}${coda}`;
}

/* Come si scrive su un documento, in un QR o in un nome di file:
   sempre con il prefisso Prot_, come vuole la convenzione del vault. */
export function siglaProtocollo(p) {
  const c = codiceProtocollo(p);
  return c.startsWith('Prot_') ? c : `Prot_${c}`;
}

/* Come si legge dentro una frase, non in una colonna. */
export function protocolloEsteso(p) {
  if (!p) return '';
  if (p.esercizio) return codiceProtocollo(p);
  return `n° ${p.numero} in ${p.direzione === 'IN' ? 'entrata' : 'uscita'}`;
}

/* Esercizio dell'ente (1/10-30/9) in forma AA-AA: la stessa
   regola della funzione s_esercizio nel database. */
export function esercizioDi(iso) {
  const [a, m] = String(iso || oggiIso()).slice(0, 10).split('-').map(Number);
  const primo = m >= 10 ? a : a - 1;
  return `${String(primo % 100).padStart(2, '0')}-${String((primo + 1) % 100).padStart(2, '0')}`;
}

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
    lettere: '#view-lettere',
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
