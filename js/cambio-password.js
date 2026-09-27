/* ============================================================
   Cambio password obbligatorio al prossimo accesso (27/09/2026)

   Chiesto dall'utente dopo le password circolate in chiaro via
   mail: a chi ha una riga aperta in app_cambio_password l'app,
   subito dopo l'accesso, chiede una password nuova e non si apre
   finché non l'ha cambiata. È lo stesso controllo del Gestionale
   Visite (index.html, obbligaCambioPassword): la password è una
   sola per tutte e due le app, quindi basta cambiarla in una.

   Se la LETTURA fallisce si prosegue (lo si dice in console) e la
   richiesta resta aperta per il prossimo accesso.
   Restituisce true se si può aprire l'app.
   ============================================================ */

import { sb } from './core.js';

export async function obbligaCambioPassword() {
  try {
    const { data, error } = await sb.rpc('deve_cambiare_password');
    if (error) throw error;
    if (data !== true) return true;
  } catch (e) {
    console.warn('[cambio password] non sono riuscito a leggere se serve:', e);
    return true;
  }

  const wrap = document.createElement('div');
  wrap.className = 'login-wrap';
  wrap.id = 'cambio-pwd';
  wrap.innerHTML = `
    <div class="login-card">
      <h1>Cambia la password</h1>
      <p class="sub">Per sicurezza la segreteria ha chiesto a tutti di scegliere una password nuova. Serve una volta sola: poi l'app si apre come sempre, e la nuova vale anche per il Gestionale Visite.</p>
      <label for="cp-nuova">Nuova password</label>
      <input id="cp-nuova" type="password" autocomplete="new-password">
      <label for="cp-ripeti" class="login-label-2">Ripeti la nuova password</label>
      <input id="cp-ripeti" type="password" autocomplete="new-password">
      <p class="login-alt">Almeno 10 caratteri, con lettere e numeri, diversa da quella di prima. Non mandarla per mail a nessuno.</p>
      <button id="cp-salva" class="btn btn-primary btn-block">Salva la nuova password</button>
      <p class="login-alt"><button id="cp-esci" type="button" class="btn-link">Esci</button></p>
      <p id="cp-msg" class="login-msg"></p>
    </div>`;
  document.body.appendChild(wrap);
  $id('login')?.classList.add('hidden');

  return await new Promise((resolve) => {
    const msg = $id('cp-msg');
    const errore = (t) => { msg.className = 'login-msg err'; msg.textContent = t; };
    const btn = $id('cp-salva');

    $id('cp-esci').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    $id('cp-ripeti').onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };

    btn.onclick = async () => {
      const p1 = $id('cp-nuova').value || '';
      const p2 = $id('cp-ripeti').value || '';
      if (p1.length < 10) return errore('La password deve avere almeno 10 caratteri.');
      if (!/[A-Za-z]/.test(p1) || !/[0-9]/.test(p1)) return errore('La password deve contenere lettere e numeri.');
      if (p1 !== p2) return errore('Le due password non coincidono.');
      btn.disabled = true;
      msg.className = 'login-msg';
      msg.textContent = 'Salvataggio…';
      try {
        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) {
          const c = error.code || '', m = error.message || '';
          if (c === 'same_password' || /different from the old/i.test(m)) return errore('La nuova password deve essere diversa da quella di prima.');
          if (c === 'weak_password' || /weak|at least/i.test(m)) return errore('Password troppo debole: allungala o aggiungi numeri e simboli.');
          if (c === 'reauthentication_needed' || /reauthenticat/i.test(m)) {
            errore('Per sicurezza devi rientrare con la password attuale: ti riporto all’accesso, poi ti verrà richiesto di nuovo il cambio.');
            setTimeout(async () => { await sb.auth.signOut(); location.reload(); }, 3500);
            return;
          }
          return errore('Password non cambiata: ' + m);
        }
        /* la password è cambiata: si chiude la richiesta. Se questa scrittura
           fallisce la password resta cambiata, e al prossimo accesso verrà
           chiesto di nuovo. */
        const r = await sb.rpc('password_cambiata');
        if (r.error) console.warn('[cambio password] cambiata, ma non registrata:', r.error);
        wrap.remove();
        resolve(true);
      } catch (e) {
        errore('Password non cambiata: ' + (e.message || e));
      } finally {
        btn.disabled = false;
      }
    };
  });
}

function $id(id) { return document.getElementById(id); }
