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

  if (vista === 'imprese') {
    mostraVista('imprese');
    $('#imprese-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.imprese = mod.imprese || await import('./imprese.js');
    return mod.imprese.render();
  }

  if (vista === 'doc-tecnici') {
    mostraVista('doc-tecnici');
    $('#doc-tecnici-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.docTecnici = mod.docTecnici || await import('./documenti-tecnici.js');
    return mod.docTecnici.render();
  }

  if (vista === 'rlst') {
    mostraVista('rlst');
    $('#rlst-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.rlst = mod.rlst || await import('./rlst.js');
    return mod.rlst.render();
  }

  if (vista === 'rls') {
    mostraVista('rls');
    $('#rls-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.rls = mod.rls || await import('./rls.js');
    return mod.rls.render();
  }

  if (vista === 'segnalazioni') {
    mostraVista('segnalazioni');
    $('#segnalazioni-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.segnalazioni = mod.segnalazioni || await import('./segnalazioni.js');
    return mod.segnalazioni.render();
  }

  if (vista === 'consulenze') {
    mostraVista('consulenze');
    $('#consulenze-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.consulenze = mod.consulenze || await import('./consulenze.js');
    return mod.consulenze.render();
  }

  if (vista === 'visite') {
    mostraVista('visite');
    $('#visite-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.visite = mod.visite || await import('./visite.js');
    return mod.visite.render();
  }

  if (vista === 'notifiche') {
    mostraVista('notifiche');
    $('#notifiche-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.notifiche = mod.notifiche || await import('./notifiche.js');
    return mod.notifiche.render();
  }

  if (vista === 'conferenze') {
    mostraVista('conferenze');
    $('#conferenze-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.conferenze = mod.conferenze || await import('./conferenze.js');
    return mod.conferenze.render();
  }

  if (vista === 'attestazioni') {
    mostraVista('attestazioni');
    $('#attestazioni-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.attestazioni = mod.attestazioni || await import('./attestazioni.js');
    return mod.attestazioni.render();
  }

  if (vista === 'corsi') {
    mostraVista('corsi');
    $('#corsi-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.corsi = mod.corsi || await import('./corsi.js');
    return mod.corsi.render();
  }

  if (vista === 'persone') {
    mostraVista('persone');
    $('#persone-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.persona = mod.persona || await import('./persona.js');
    return mod.persona.render();
  }

  if (vista === 'nomine') {
    mostraVista('nomine');
    $('#nomine-host').innerHTML = '<p class="empty">Un istante…</p>';
    mod.nomine = mod.nomine || await import('./nomine.js');
    return mod.nomine.render();
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

    /* l'app è riservata alla segreteria; il Direttore ha un ingresso
       suo, limitato alle autorizzazioni (pagina Segnalazioni) */
    const { data: abilitato, error: errRuolo } = await sb.rpc('is_segreteria');
    let soloDirettore = false;
    if (errRuolo || !abilitato) {
      const { data: dir } = await sb.rpc('is_direttore');
      soloDirettore = !!dir;
    }
    if ((errRuolo || !abilitato) && !soloDirettore) {
      await sb.auth.signOut();
      mostraLogin(`L'indirizzo ${state.email} non è abilitato all'app Segreteria. Chiedi l'abilitazione al coordinatore.`);
    } else {
      state.soloDirettore = soloDirettore;
      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#user-email').textContent = state.email;

      const { data: tipi } = await sb.from('s_tipo_doc').select('*').order('descrizione');
      state.tipiDoc = tipi || [];

      /* link profondo dalle mail: #segnalazione-<id>, #consulenza-<id>,
         #visita-<id> o #conferenza-<id> apre la pratica */
      const hashPratica = location.hash.match(/^#(segnalazione|consulenza|visita|conferenza|attestazione)-(\d+)$/);
      const apriDaHash = async () => {
        if (!hashPratica) return;
        const vista = { segnalazione: 'segnalazioni', consulenza: 'consulenze', visita: 'visite', conferenza: 'conferenze', attestazione: 'attestazioni' }[hashPratica[1]];
        await vaiA(vista);
        await mod[vista]?.apriPratica?.(Number(hashPratica[2]));
      };

      if (soloDirettore) {
        /* il Direttore vede solo le pratiche da autorizzare: le altre
           viste sono comunque chiuse dalle policy del database */
        $('#topbar-sub').textContent = 'Autorizzazioni — Direzione';
        $$('.nav-item').forEach((b) => {
          if (!['segnalazioni', 'consulenze', 'visite', 'conferenze', 'attestazioni'].includes(b.dataset.view)) b.style.display = 'none';
        });
        if (hashPratica) await apriDaHash();
        else await vaiA('segnalazioni');
      } else {
        mod.protocollo = await import('./protocollo.js');
        await mod.protocollo.init();
        await apriDaHash();
      }
    }
  }
} catch (e) {
  console.error('[avvio]', e);
  const tb = $('#tb-registro');
  if (tb) tb.innerHTML = `<tr><td colspan="8" class="empty">Avvio non riuscito: ${esc(e.message)}</td></tr>`;
  toast('Avvio non riuscito: ' + e.message, 'err');
}
