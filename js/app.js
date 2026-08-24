/* ============================================================
   Avvio dell'applicazione: client Supabase, accesso, navigazione.
   Nota: niente DOMContentLoaded (con l'await di primo livello
   scatterebbe prima) e nessun onclick scritto nell'HTML: gli
   eventi si agganciano tutti da qui.
   ============================================================ */

import { SB_URL, SB_KEY } from './config.js';
import { supabaseJs } from './cdn.js';

/* ── client e stato condiviso ─────────────────────────────── */
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
    statistiche: '#view-statistiche',
  };
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const sel = mappa[nome] || '#view-registro';
  $(sel).classList.remove('hidden');
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

/* ── accesso ──────────────────────────────────────────────── */
async function inviaLink() {
  const email = $('#login-email').value.trim();
  const msg = $('#login-msg');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msg.className = 'login-msg err';
    msg.textContent = 'Indirizzo email non valido.';
    return;
  }
  const btn = $('#login-btn');
  attendi(btn, true, 'Invio in corso…');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] },
  });
  attendi(btn, false);
  if (error) {
    msg.className = 'login-msg err';
    msg.textContent = error.message.includes('rate')
      ? 'Troppe richieste ravvicinate: attendi qualche minuto e riprova.'
      : error.message;
  } else {
    msg.className = 'login-msg ok';
    msg.textContent = 'Ti abbiamo inviato il link di accesso: controlla la posta.';
  }
}

function mostraLogin(messaggio = '') {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  if (messaggio) {
    $('#login-msg').className = 'login-msg err';
    $('#login-msg').textContent = messaggio;
  }
}

/* ── avvio ────────────────────────────────────────────────── */
$('#login-btn').addEventListener('click', inviaLink);
$('#login-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') inviaLink(); });
$('#logout-btn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('is-open'));
$('#drawer-close').addEventListener('click', chiudiDrawer);
$('#drawer-bg').addEventListener('click', chiudiDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiDrawer(); });

$$('.nav-item').forEach((b) => b.addEventListener('click', () => vaiA(b.dataset.view)));
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) vaiA(g.dataset.goto);
});

/* smistamento verso i moduli: le librerie pesanti (PDF) si caricano
   solo quando servono davvero, non all'avvio */
const mod = {};
async function vaiA(vista) {
  if (vista === 'nuovo-in') return mod.protocollo?.apriForm('IN');
  if (vista === 'nuovo-out') return mod.protocollo?.apriForm('OUT');

  if (vista === 'lettere') {
    mostraVista('lettere');
    $('#lettere-host').innerHTML = '<p class="empty">Preparazione dei modelli…</p>';
    try {
      mod.lettere = mod.lettere || await import('./lettere.js');
      return mod.lettere.render();
    } catch (e) {
      $('#lettere-host').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
      return;
    }
  }

  if (vista === 'statistiche') {
    mostraVista('statistiche');
    mod.statistiche = mod.statistiche || await import('./statistiche.js');
    return mod.statistiche.render();
  }

  mostraVista('registro');
  mod.protocollo?.ricarica();
}
export { vaiA };

const { data: { session } } = await sb.auth.getSession();

if (!session) {
  mostraLogin();
} else {
  state.user = session.user;
  state.email = session.user.email || '';

  /* controllo del ruolo: l'app è riservata alla segreteria */
  const { data: abilitato, error: errRuolo } = await sb.rpc('is_segreteria');
  if (errRuolo || !abilitato) {
    await sb.auth.signOut();
    mostraLogin(`L'indirizzo ${state.email} non è abilitato all'app Segreteria. Chiedi l'abilitazione al coordinatore.`);
  } else {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-email').textContent = state.email;

    const { data: tipi } = await sb.from('s_tipo_doc').select('*').order('descrizione');
    state.tipiDoc = tipi || [];

    mod.protocollo = await import('./protocollo.js');
    await mod.protocollo.init();
  }
}
