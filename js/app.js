/* ============================================================
   Avvio dell'applicazione: accesso, controllo del ruolo,
   navigazione tra i moduli.
   Il client Supabase e le funzioni condivise stanno in core.js:
   questo file ha un await di primo livello e nessun altro modulo
   deve dipendere da lui, altrimenti l'import resta appeso.
   ============================================================ */

import { sb, state, $, $$, esc, toast, attendi, mostraVista, chiudiDrawer } from './core.js';

/* ── accesso ──────────────────────────────────────────────── */
async function accedi() {
  const email = $('#login-email').value.trim();
  const pwd = $('#login-pwd').value;
  const msg = $('#login-msg');
  msg.className = 'login-msg';
  msg.textContent = '';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msg.className = 'login-msg err';
    msg.textContent = 'Indirizzo email non valido.';
    return;
  }
  if (!pwd) {
    msg.className = 'login-msg err';
    msg.textContent = 'Inserisci la password, oppure chiedi il link di accesso via email.';
    return;
  }

  const btn = $('#login-btn');
  attendi(btn, true, 'Accesso in corso…');
  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
  attendi(btn, false);

  if (error) {
    msg.className = 'login-msg err';
    msg.textContent = /invalid login|invalid credentials/i.test(error.message)
      ? 'Email o password non corretti.'
      : error.message;
    return;
  }

  /* l'avvio dell'app sta in un await di primo livello, ormai concluso:
     si ricarica, cosi' la sessione appena creata viene letta da capo. */
  location.reload();
}

/* Il link via posta resta per chi non ha ancora una password.
   La password invece non passa dall'SMTP, quindi regge anche
   quando l'invio delle mail e' fermo. */

async function inviaLink() {
  const email = $('#login-email').value.trim();
  const msg = $('#login-msg');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    msg.className = 'login-msg err';
    msg.textContent = 'Indirizzo email non valido.';
    return;
  }
  const btn = $('#login-link');
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

/* ── smistamento verso i moduli ───────────────────────────────
   Le librerie pesanti (PDF) si caricano solo quando servono. */
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

  if (vista === 'imprese') {
    mostraVista('imprese');
    $('#imprese-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.imprese = mod.imprese || await import('./imprese.js');
    return mod.imprese.render();
  }

  if (vista === 'statistiche') {
    mostraVista('statistiche');
    mod.statistiche = mod.statistiche || await import('./statistiche.js');
    return mod.statistiche.render();
  }

  mostraVista('registro');
  mod.protocollo?.ricarica();
}

/* ── eventi di base ───────────────────────────────────────── */
$('#login-btn').addEventListener('click', accedi);
$('#login-link').addEventListener('click', inviaLink);
$('#login-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#login-pwd').focus(); });
$('#login-pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') accedi(); });
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

/* ── avvio ────────────────────────────────────────────────── */
try {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    mostraLogin();
  } else {
    state.user = session.user;
    state.email = session.user.email || '';

    /* l'app è riservata alla segreteria */
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
} catch (e) {
  console.error('[avvio]', e);
  const tb = $('#tb-registro');
  if (tb) tb.innerHTML = `<tr><td colspan="8" class="empty">Avvio non riuscito: ${esc(e.message)}</td></tr>`;
  toast('Avvio non riuscito: ' + e.message, 'err');
}
