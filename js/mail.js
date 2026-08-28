/* ============================================================
   Avviso di avvenuta protocollazione.
   Propone i destinatari già presenti in anagrafica (impresa e
   persona) e permette di allegare uno dei documenti del
   protocollo, preferendo quello timbrato.
   L'invio passa dalla edge function "send-protocollo".
   ============================================================ */

import { sb, $, $$, esc, dataIt, toast, attendi, protocolloEsteso } from './core.js';

export async function apriDialogoMail(p) {
  /* indirizzi suggeriti */
  const suggeriti = new Set();
  if (p.impresa_id) {
    const { data: imp } = await sb.from('imprese')
      .select('impresa_email_ref, impresa_email2, pec')
      .eq('impresa_id', p.impresa_id).maybeSingle();
    [imp?.impresa_email_ref, imp?.impresa_email2, imp?.pec].forEach((e) => e && suggeriti.add(e.trim()));
  }
  if (p.persona) {
    const cognome = p.persona.split(/\s+/)[0];
    const { data: per } = await sb.from('persone')
      .select('email, email2').ilike('cognome', cognome).limit(3);
    (per || []).forEach((x) => { if (x.email) suggeriti.add(x.email.trim()); });
  }

  const { data: allegati } = await sb.from('s_prot_allegati')
    .select('*').eq('protocollo_id', p.id).order('timbrato', { ascending: false }).order('id');

  const dir = p.direzione === 'IN' ? 'entrata' : 'uscita';
  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  bg.style.zIndex = 60;
  bg.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;
                padding:22px;width:min(560px,94vw);max-height:90vh;overflow-y:auto;box-shadow:var(--ombra)">
      <h3 style="margin:0 0 4px;font-size:17px">Avviso di protocollazione</h3>
      <p style="margin:0 0 18px;color:var(--testo-soft);font-size:13px">
        Protocollo in ${dir} <strong>${esc(protocolloEsteso(p))}</strong> del ${dataIt(p.data_prot)}
      </p>

      <div class="field" style="margin-bottom:12px">
        <label for="m-to">Destinatari (separati da virgola)</label>
        <input type="text" id="m-to" value="${esc([...suggeriti].join(', '))}" placeholder="nome@dominio.it">
        ${suggeriti.size ? '<span class="hint">Indirizzi presi dall\'anagrafica: controllali prima di inviare.</span>'
                         : '<span class="hint">Nessun indirizzo trovato in anagrafica: scrivilo a mano.</span>'}
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-cc">Copia conoscenza (facoltativa)</label>
        <input type="text" id="m-cc" placeholder="cpt@formedilpadova.it">
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-ogg">Oggetto della mail</label>
        <input type="text" id="m-ogg" value="Protocollo in ${dir} ${esc(protocolloEsteso(p))} del ${dataIt(p.data_prot)}">
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-msg">Messaggio (facoltativo, va sopra al riepilogo)</label>
        <textarea id="m-msg" placeholder="Gentili…"></textarea>
      </div>

      <div class="field" style="margin-bottom:18px">
        <label for="m-att">Documento da allegare</label>
        <select id="m-att">
          <option value="">Nessun allegato</option>
          ${(allegati || []).map((a, i) =>
            `<option value="${esc(a.path)}" ${i === 0 && a.timbrato ? 'selected' : ''}>${esc(a.nome)}${a.timbrato ? ' (timbrato)' : ''}</option>`).join('')}
        </select>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" id="m-annulla">Annulla</button>
        <button class="btn btn-primary" id="m-invia">Invia avviso</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const chiudi = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) chiudi(); });
  $('#m-annulla', bg).addEventListener('click', chiudi);

  $('#m-invia', bg).addEventListener('click', async (ev) => {
    const to = $('#m-to', bg).value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!to.length) return toast('Serve almeno un destinatario.', 'err');
    const cc = $('#m-cc', bg).value.split(',').map((x) => x.trim()).filter(Boolean);

    attendi(ev.currentTarget, true, 'Invio…');
    const { data, error } = await sb.functions.invoke('send-protocollo', {
      body: {
        protocolloId: p.id,
        to, cc,
        oggetto: $('#m-ogg', bg).value.trim(),
        messaggio: $('#m-msg', bg).value.trim(),
        allegatoPath: $('#m-att', bg).value || null,
      },
    });
    attendi(ev.currentTarget, false);

    if (error || data?.error) {
      toast('Invio non riuscito: ' + (data?.error || error.message), 'err');
      return;
    }
    chiudi();
    toast('Avviso inviato a ' + to.join(', '), 'ok');
  });
}
