/* ============================================================
   Le due mail che partono da un protocollo.

   «Avviso al mittente» — in entrata, si scrive a CHI CI HA
   SCRITTO per dirgli che la sua comunicazione è stata
   protocollata. Testo e firma ripresi dalla vecchia maschera
   Access. Nessun allegato: il documento ce l'ha già lui.

   «Inoltra» — a chi in ufficio deve vederlo: il Direttore, il
   coordinatore, altri. Con il documento allegato, il corpo della
   comunicazione ricevuta e il testo che si aggiunge.

   ⚠️ L'app NON spedisce. Prepara il messaggio — intestazione, firma
   istituzionale, nota privacy, allegato — e lo consegna come file
   .eml: si apre in Outlook nella finestra di composizione, con
   l'account ufficiale cpt@formedilpadova.it, e l'invio lo fa una
   persona. È quel che faceva la macro Access, che finiva con
   .Display e non con .Send, ed è lo stesso confine del timbro.
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, codiceProtocollo } from './core.js';
import { RUBRICA_INTERNA, emailAssegnatario } from './lookups.js';

/* Indirizzi già noti del mittente, per non riscriverli a mano. */
async function indirizziMittente(p) {
  const trovati = new Set();
  if (p.impresa_id) {
    const { data: imp } = await sb.from('imprese')
      .select('impresa_email_ref, impresa_email2, pec')
      .eq('impresa_id', p.impresa_id).maybeSingle();
    [imp?.impresa_email_ref, imp?.impresa_email2, imp?.pec].forEach((e) => e && trovati.add(e.trim()));
  }
  if (p.persona) {
    const cognome = p.persona.split(/\s+/)[0];
    const { data: per } = await sb.from('persone').select('email, email2').ilike('cognome', cognome).limit(3);
    (per || []).forEach((x) => { if (x.email) trovati.add(x.email.trim()); });
  }
  return [...trovati];
}

export async function apriDialogoMail(p, modo = 'avviso') {
  const avviso = modo === 'avviso';
  const codice = codiceProtocollo(p);

  const { data: allegati } = await sb.from('s_prot_allegati')
    .select('id, nome, timbrato, principale, drive_file_id')
    .eq('protocollo_id', p.id)
    .order('principale', { ascending: false })
    .order('timbrato', { ascending: false })
    .order('id');
  const conDrive = (allegati || []).filter((a) => a.drive_file_id);

  /* A chi si scrive, secondo il verso: al mittente, o dentro. */
  const suggeriti = avviso
    ? await indirizziMittente(p)
    : [emailAssegnatario(p.alla_ca)].filter(Boolean);

  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  bg.style.zIndex = 62;
  bg.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;
                padding:22px;width:min(620px,95vw);max-height:92vh;overflow-y:auto;box-shadow:var(--ombra)">
      <h3 style="margin:0 0 4px;font-size:17px">${avviso ? 'Avviso di protocollazione' : 'Inoltra il documento protocollato'}</h3>
      <p style="margin:0 0 16px;color:var(--testo-soft);font-size:13px;line-height:1.5">
        Protocollo <strong>${esc(codice)}</strong> del ${dataIt(p.data_prot)}.
        ${avviso
          ? `Va <strong>al mittente</strong> — ${esc(p.impresa_nome || p.persona || 'chi ci ha scritto')} —
             per dirgli che la sua comunicazione è stata protocollata.`
          : 'Va a chi in ufficio deve vederlo, col documento allegato.'}
      </p>

      ${!avviso ? `
      <div class="field" style="margin-bottom:10px">
        <label>Aggiungi in fretta</label>
        <div class="chip-riga" id="m-rubrica">
          ${RUBRICA_INTERNA.map((r) => `<button type="button" class="chip" data-mail="${esc(r.email)}">${esc(r.nome)}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="field" style="margin-bottom:12px">
        <label for="m-to">Destinatari (separati da virgola)</label>
        <input type="text" id="m-to" value="${esc(suggeriti.join(', '))}" placeholder="nome@dominio.it">
        <span class="hint">${suggeriti.length
          ? 'Indirizzo preso dall&rsquo;anagrafica: controllalo prima di inviare.'
          : 'Nessun indirizzo trovato in anagrafica: scrivilo a mano.'}</span>
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-cc">Copia conoscenza (facoltativa)</label>
        <input type="text" id="m-cc" placeholder="${avviso ? 'es. l&rsquo;ente mittente' : 'es. cptpd@did.formedilpadova.it'}">
      </div>

      ${conDrive.length ? `
      <div class="field" style="margin-bottom:12px">
        <label for="m-att">Documento da allegare</label>
        <select id="m-att">
          <option value="">Nessun allegato</option>
          ${conDrive.map((a, i) => `<option value="${esc(a.drive_file_id)}" ${!avviso && i === 0 ? 'selected' : ''}>${esc(a.nome)}${a.timbrato ? ' (timbrato)' : ''}</option>`).join('')}
        </select>
        ${avviso ? '<span class="hint">Di norma non serve: il documento è suo, ce l&rsquo;ha già.</span>' : ''}
      </div>` : `<p class="hint" style="margin:0 0 12px">Nessun documento su Drive collegato a questo protocollo.</p>`}

      <div class="field" style="margin-bottom:14px">
        <label for="m-msg">Il tuo testo (facoltativo)</label>
        <textarea id="m-msg" placeholder="${avviso ? 'Righe da aggiungere prima dei saluti…' : 'Es. «Ti giro questa, scade il 18 settembre»…'}"></textarea>
      </div>

      <p class="hint" style="margin:0 0 16px;line-height:1.5">
        Intestazione, firma della Segreteria, dati dell'ente, orari e nota privacy vengono aggiunti
        automaticamente${avviso ? '' : ', insieme alla scheda del protocollo e al testo della comunicazione ricevuta'}.<br>
        <strong>La mail non parte da qui</strong>: si scarica pronta e si apre in Outlook
        &mdash; mittente <code>cpt@formedilpadova.it</code> &mdash; dove la rileggi e premi Invia tu.
      </p>

      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" id="m-annulla">Annulla</button>
        <button class="btn btn-primary" id="m-invia">${avviso ? '📧 Apri l&rsquo;avviso in Outlook' : '📧 Apri l&rsquo;inoltro in Outlook'}</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const chiudi = () => bg.remove();
  bg.addEventListener('click', (e) => { if (e.target === bg) chiudi(); });
  $('#m-annulla', bg).addEventListener('click', chiudi);

  /* i pulsantini della rubrica aggiungono, non sostituiscono */
  $('#m-rubrica', bg)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mail]');
    if (!b) return;
    const campo = $('#m-to', bg);
    const gia = campo.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (gia.includes(b.dataset.mail)) return;
    campo.value = [...gia, b.dataset.mail].join(', ');
  });

  $('#m-invia', bg).addEventListener('click', async (ev) => {
    const to = $('#m-to', bg).value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!to.length) return toast('Serve almeno un destinatario.', 'err');
    const cc = $('#m-cc', bg).value.split(',').map((x) => x.trim()).filter(Boolean);
    const driveFileId = $('#m-att', bg)?.value || null;

    attendi(ev.currentTarget, true, 'Preparo…');
    const { data, error } = await sb.functions.invoke('send-protocollo', {
      body: {
        protocolloId: p.id,
        modo,
        azione: 'bozza',          // non spedire: preparare e basta
        to,
        cc,
        messaggio: $('#m-msg', bg).value.trim(),
        driveFileId,
      },
    });
    attendi(ev.currentTarget, false);

    if (error || data?.error || !data?.eml) {
      toast('Non sono riuscito a preparare la mail: ' + (data?.error || error?.message || 'risposta vuota'), 'err');
      return;
    }

    /* Il .eml scaricato: doppio clic e Outlook lo apre in
       composizione, allegato compreso. Non e' una mail ricevuta,
       e' una bozza — la riga «X-Unsent: 1» serve a questo. */
    scarica(data.eml, data.nomeFile || 'protocollo.eml');
    chiudi();
    toast(`Bozza pronta: aprila da Outlook e premi Invia. A ${to.join(', ')}`, 'ok');
  });
}

/* base64 → file scaricato. Il tipo message/rfc822 e' quello che
   fa scegliere Outlook come applicazione predefinita. */
function scarica(b64, nome) {
  const bin = atob(b64);
  const byte = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([byte], { type: 'message/rfc822' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
