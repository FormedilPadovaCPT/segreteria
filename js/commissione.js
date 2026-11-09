/* ============================================================
   Commissione Sicurezza — gli accessi al gestionale (09/11/2026)

   Chiesto dall'utente: i membri della Commissione cambiano, e il
   gestionale deve seguirli. Il quadro NON tiene un secondo elenco:
   i membri sono le NOMINE attive col ruolo «Commissione Sicurezza»
   (maschera Nomine, con lo storico e le date). Qui si vede, per
   ciascuno, se ha l'accesso al gestionale e se è entrato, e si fa
   l'azione che manca:
     · 🔑 Crea l'accesso — la funzione commissione-accesso crea
       l'account (password provvisoria = codice fiscale, cambio
       obbligatorio al primo accesso). Nessuna mail parte da sola;
     · 🔁 Passaggio di consegne — stesso indirizzo di ruolo
       (presidente@…), persona nuova: chiede conferma;
     · ✏️ Aggiorna la carica — la mansione della nomina è cambiata;
     · ⛔ Chiudi l'accesso — chi non è più nominato: lo stato diventa
       «revocato», niente si cancella;
     · ✉️ Benvenuto — apre il protocollo OUT precompilato con la
       mail di benvenuto: la manda una persona, protocollata.
   Chi entra o esce si registra in Nomine («+ Nuovo membro» apre la
   nomina già col ruolo giusto).
   ============================================================ */

import { sb, $, esc, dataIt, oggiIso, toast, attendi } from './core.js';
import { CARICHE, statoAccesso, azione, testoBenvenuto } from './commissione-regole.js';
const FORMEDIL = { impresa_txt: 'FORMEDIL PADOVA', impresa_id: '80006850285' };

let quadro = null;

async function testoErrore(error, data) {
  if (data && data.messaggio) return data.messaggio;
  try { const j = await error?.context?.json?.(); if (j?.messaggio) return j.messaggio; if (j?.error) return j.error; } catch { /* niente */ }
  return error?.message || 'richiesta non riuscita';
}

async function carica() {
  const { data, error } = await sb.rpc('s_commissione_situazione');
  if (error) throw new Error(error.message);
  quadro = data || { membri: [], da_chiudere: [], ultimi_eventi: [] };
}

export async function render() {
  const host = $('#commissione-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  try { await carica(); } catch (e) {
    host.innerHTML = `<p class="empty" style="color:#c0392b">Non sono riuscito a leggere la Commissione: ${esc(e.message)}</p>`;
    return;
  }
  const membri = quadro.membri || [];
  const fuori = quadro.da_chiudere || [];
  const eventi = quadro.ultimi_eventi || [];
  const mai = membri.filter((m) => statoAccesso(m).testo === 'mai entrato').length;
  host.innerHTML = `
    <div class="dt-barra">
      <p class="hint" style="margin:0;max-width:760px">I membri sono le nomine attive col ruolo <b>Commissione Sicurezza</b>: chi entra o esce si registra in Nomine, e qui si aprono e chiudono i loro accessi al gestionale (sola consultazione).
        ${membri.length} membri${mai ? `, <b>${mai} mai ${mai === 1 ? 'entrato' : 'entrati'}</b>` : ''}.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="cm-nomine" data-aiuto="Apre la maschera Nomine sul ruolo Commissione Sicurezza, con lo storico di chi è entrato e uscito.">📋 Nomine della Commissione</button>
        <button class="btn btn-primary btn-sm" id="cm-nuovo" data-aiuto="Registra un membro nuovo: apre la nomina già col ruolo Commissione Sicurezza. Salvata la nomina, qui compare con il pulsante per creargli l'accesso.">+ Nuovo membro</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>Nominativo</th><th style="width:120px">Carica</th><th style="width:95px">Nominato dal</th>
          <th>Indirizzo d'accesso</th><th style="width:170px">Accesso</th><th style="width:210px">Da fare</th></tr></thead>
        <tbody>${membri.map((m) => { const s = statoAccesso(m); return `
          <tr>
            <td><a href="#" data-cm-nomina="${m.nomina_id}"><strong>${esc(m.nominativo)}</strong></a></td>
            <td>${esc(CARICHE[m.carica] || m.carica)}</td>
            <td>${dataIt(m.dal) || '—'}</td>
            <td style="font-size:12px">${esc(m.email || '—')}</td>
            <td><span class="pill ${s.classe}">${esc(s.testo)}</span></td>
            <td>${azione(m)}</td>
          </tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nessuna nomina attiva nella Commissione Sicurezza.</td></tr>'}
        </tbody>
      </table>
    </div>
    ${fuori.length ? `<h3 style="margin:14px 0 6px">Hanno ancora l'accesso ma non sono più nominati</h3>
    <div class="table-wrap"><table class="tbl"><tbody>${fuori.map((f) => `
      <tr><td><strong>${esc(f.nome || f.email)}</strong></td><td>${esc(CARICHE[f.carica] || f.carica || '')}</td><td style="font-size:12px">${esc(f.email)}</td>
        <td style="width:210px"><button class="btn btn-secondary btn-sm" data-cm-chiudi="${esc(f.email)}" data-aiuto="Chiude l'accesso al gestionale: lo stato diventa «revocato», niente si cancella. Le decisioni prese restano col suo nome.">⛔ Chiudi l'accesso</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${eventi.length ? `<details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Ultimi passaggi registrati</summary>
      ${eventi.map((e) => `<div class="hint" style="padding:3px 0">${dataIt(String(e.il).slice(0, 10))} · ${esc(e.evento.replace(/_/g, ' '))} · ${esc(e.email)}${e.dettaglio ? ' — ' + esc(e.dettaglio) : ''}</div>`).join('')}
    </details>` : ''}`;

  $('#cm-nuovo').addEventListener('click', async () => {
    const mod = await import('./nomine.js');
    mod.nuovaNomina({ ruolo_txt: 'Commissione Sicurezza', mansione: 'Consigliere', ...FORMEDIL }, render);
  });
  $('#cm-nomine').addEventListener('click', () => { document.querySelector('.nav-item[data-view="nomine"]')?.click(); });
  host.querySelectorAll('[data-cm-nomina]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const mod = await import('./nomine.js');
    mod.apriNomina(Number(a.dataset.cmNomina), render);
  }));
  host.querySelectorAll('[data-cm-crea]').forEach((b) => b.addEventListener('click', () => crea(b)));
  host.querySelectorAll('[data-cm-carica]').forEach((b) => b.addEventListener('click', () => aggiornaCarica(b)));
  host.querySelectorAll('[data-cm-chiudi]').forEach((b) => b.addEventListener('click', () => chiudi(b)));
  host.querySelectorAll('[data-cm-benvenuto]').forEach((b) => b.addEventListener('click', () => benvenuto(Number(b.dataset.cmBenvenuto))));
}

const membro = (id) => (quadro?.membri || []).find((m) => m.nomina_id === id);

async function crea(btn, subentroConfermato = false) {
  const m = membro(Number(btn.dataset.cmCrea)); if (!m) return;
  const subentro = btn.dataset.cmSubentro === '1';
  if (!subentroConfermato) {
    const domanda = subentro
      ? `Passaggio di consegne a ${m.nominativo} (${CARICHE[m.carica] || m.carica}).\n\nL'indirizzo ${m.email} era di ${m.accesso?.nome || 'un\'altra persona'}: la sua password smette di valere, ${m.nominativo} entra con la password provvisoria (il suo codice fiscale).\n\nProcedo?`
      : `Creo l'accesso al gestionale per ${m.nominativo} (${CARICHE[m.carica] || m.carica})?\n\nUtente: ${m.email}\nPassword provvisoria: il suo codice fiscale, da cambiare al primo accesso.\nNessuna mail parte da sola: il benvenuto lo prepari dopo, protocollato.`;
    if (!confirm(domanda)) return;
  }
  attendi(btn, true, 'Un istante…');
  const { data, error } = await sb.functions.invoke('commissione-accesso', { body: { nomina_id: m.nomina_id, subentro: subentro || subentroConfermato } });
  attendi(btn, false);
  if (error || !data?.ok) {
    const msg = await testoErrore(error, data);
    return toast('Non riuscito: ' + msg, 'err');
  }
  toast(`Accesso pronto per ${data.nome}. Ora prepara il benvenuto.`, 'ok');
  await render();
  if (confirm(`Accesso pronto per ${data.nome}.\n\nPreparo adesso il protocollo in uscita con la mail di benvenuto?`)) benvenuto(m.nomina_id);
}

async function aggiornaCarica(btn) {
  const m = membro(Number(btn.dataset.cmCarica)); if (!m) return;
  if (!confirm(`Porto ${m.nominativo} alla carica di ${CARICHE[m.carica] || m.carica} anche nel gestionale?`)) return;
  attendi(btn, true, 'Un istante…');
  const { error } = await sb.rpc('s_commissione_aggiorna_carica', { p_nomina: m.nomina_id });
  attendi(btn, false);
  if (error) return toast('Non riuscito: ' + error.message, 'err');
  toast('Carica aggiornata.', 'ok');
  render();
}

async function chiudi(btn) {
  const email = btn.dataset.cmChiudi;
  const f = (quadro?.da_chiudere || []).find((x) => x.email === email);
  const motivo = prompt(`Chiudo l'accesso di ${f?.nome || email}?\n\nLo stato diventa «revocato», niente si cancella. Motivo (facoltativo):`, 'fine mandato');
  if (motivo === null) return;
  attendi(btn, true, 'Un istante…');
  const { error } = await sb.rpc('s_commissione_chiudi', { p_email: email, p_motivo: motivo });
  attendi(btn, false);
  if (error) return toast('Non riuscito: ' + error.message, 'err');
  toast('Accesso chiuso.', 'ok');
  render();
}

async function benvenuto(id) {
  const m = membro(id); if (!m) return;
  const mod = await import('./protocollo.js');
  mod.apriForm('OUT', {
    persona: m.nominativo,
    oggetto: 'Accesso all\'applicazione delle visite in cantiere (Commissione Sicurezza, sola consultazione)',
    note: testoBenvenuto(m),
    data_prot: oggiIso(),
  }, true);
}
