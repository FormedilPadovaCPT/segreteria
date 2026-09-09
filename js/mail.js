/* ============================================================
   Le mail che partono da un protocollo.

   «Avviso al mittente» — in entrata, si scrive a CHI CI HA
   SCRITTO per dirgli che la sua comunicazione è stata
   protocollata. Testo e firma ripresi dalla vecchia maschera
   Access. Nessun allegato: il documento ce l'ha già lui.

   «Inoltra» — a chi in ufficio deve vederlo: il Direttore, il
   coordinatore, altri. Con il documento allegato, il corpo della
   comunicazione ricevuta e il testo che si aggiunge.

   «Invia protocollato» — in USCITA (dal 09/09/2026): il documento
   protocollato va all'impresa e alle persone indicate, con la
   «stampa del protocollo» in testa (numero, data, ufficio — la
   tabellina della macro Access «Protocollo in USCITA»), il testo
   della comunicazione, gli allegati scelti e la firma dell'ufficio
   in piede. Oggetto nella forma di Access: «FORMEDIL Padova -AREA
   SICUREZZA E SALUTE- <oggetto> Prot. <N> - email del <data ora> -
   alla c.a. <persona>».

   ⚠️ Di norma l'app NON spedisce. Prepara il messaggio — intestazione,
   firma istituzionale, nota privacy, allegati — e lo consegna come
   file .eml: si apre in Outlook nella finestra di composizione, con
   l'account ufficiale cpt@formedilpadova.it, e l'invio lo fa una
   persona. È quel che faceva la macro Access, che finiva con
   .Display e non con .Send, ed è lo stesso confine del timbro.
   Per il protocollato c'è anche, A SCELTA, la strada Gmail: la bozza
   nasce direttamente nelle Bozze della casella cptpd@did.formedilpadova.it
   (indirizzo istituzionale a tutti gli effetti dal 09/09/2026, Reply-To
   cpt@formedilpadova.it), si apre da Gmail, si ritocca e si invia a
   mano. L'app non spedisce mai (scelta dell'utente, 09/09/2026).
   ============================================================ */

import { sb, $, esc, dataIt, toast, attendi, codiceProtocollo } from './core.js';
import { RUBRICA_INTERNA, emailAssegnatario } from './lookups.js';

/* Indirizzi già noti dell'impresa e delle persone del protocollo, per
   non riscriverli a mano: l'impresa (referente, seconda mail, PEC) e
   le persone citate come «persona» e «alla c.a.», cercate per cognome. */
async function indirizziControparte(p) {
  const trovati = new Set();
  if (p.impresa_id) {
    const { data: imp } = await sb.from('imprese')
      .select('impresa_email_ref, impresa_email2, pec')
      .eq('impresa_id', p.impresa_id).maybeSingle();
    [imp?.impresa_email_ref, imp?.impresa_email2, imp?.pec].forEach((e) => e && trovati.add(e.trim()));
  }
  const nomi = [p.persona, p.alla_ca].filter(Boolean);
  for (const n of nomi) {
    /* il cognome: la prima parola che non sia un titolo */
    const parole = n.split(/\s+/).filter((w) => !/^(sig\.?ra?|dott\.?(ssa)?|dr\.?(ssa)?|ing\.?|arch\.?|geom\.?|rag\.?|avv\.?|prof\.?|p\.?i\.?)$/i.test(w));
    const cognome = parole[0];
    if (!cognome || cognome.length < 3) continue;
    const { data: per } = await sb.from('persone').select('email, email2').ilike('cognome', cognome).limit(3);
    (per || []).forEach((x) => { if (x.email) trovati.add(x.email.trim()); });
  }
  return [...trovati];
}

export async function apriDialogoMail(p, modo = 'avviso') {
  const avviso = modo === 'avviso';
  const protocollato = modo === 'protocollato';
  const codice = codiceProtocollo(p);

  const { data: allegati } = await sb.from('s_prot_allegati')
    .select('id, nome, timbrato, principale, drive_file_id')
    .eq('protocollo_id', p.id)
    .order('principale', { ascending: false })
    .order('timbrato', { ascending: false })
    .order('id');
  const conDrive = (allegati || []).filter((a) => a.drive_file_id);

  /* Quali allegati proporre gia' spuntati, secondo il verso:
     - avviso: nessuno (il documento e' del mittente, ce l'ha gia');
     - inoltro: il primo (principale o timbrato);
     - protocollato: i timbrati; se non ce ne sono, tutti. */
  const preselezione = (a, i) => {
    if (avviso) return false;
    if (protocollato) return conDrive.some((x) => x.timbrato) ? !!a.timbrato : true;
    return i === 0;
  };

  /* A chi si scrive, secondo il verso: fuori, o dentro. */
  const suggeriti = (avviso || protocollato)
    ? await indirizziControparte(p)
    : [emailAssegnatario(p.alla_ca)].filter(Boolean);

  const titolo = avviso ? 'Avviso di protocollazione'
    : protocollato ? 'Invia il documento protocollato' : 'Inoltra il documento protocollato';
  const chi = esc(p.impresa_nome || p.persona || p.alla_ca || '');

  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  bg.style.zIndex = 62;
  bg.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;
                padding:22px;width:min(640px,95vw);max-height:92vh;overflow-y:auto;box-shadow:var(--ombra)">
      <h3 style="margin:0 0 4px;font-size:17px">${titolo}</h3>
      <p style="margin:0 0 16px;color:var(--testo-soft);font-size:13px;line-height:1.5">
        Protocollo <strong>${esc(codice)}</strong> del ${dataIt(p.data_prot)}.
        ${avviso
          ? `Va <strong>al mittente</strong> — ${chi || 'chi ci ha scritto'} —
             per dirgli che la sua comunicazione è stata protocollata.`
          : protocollato
            ? `Va <strong>all'impresa e alle persone indicate</strong> — ${chi || 'il destinatario del protocollo'} —
               con la stampa del protocollo in testa, i documenti allegati e la firma dell'ufficio in piede.`
            : 'Va a chi in ufficio deve vederlo, col documento allegato.'}
      </p>

      <div class="field" style="margin-bottom:10px">
        <label>${protocollato ? 'Aggiungi in copia (ufficio)' : 'Aggiungi in fretta'}</label>
        <div class="chip-riga" id="m-rubrica" data-campo="${protocollato ? 'm-cc' : 'm-to'}">
          ${RUBRICA_INTERNA.map((r) => `<button type="button" class="chip" data-mail="${esc(r.email)}">${esc(r.nome)}</button>`).join('')}
        </div>
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-to">Destinatari (separati da virgola)</label>
        <input type="text" id="m-to" value="${esc(suggeriti.join(', '))}" placeholder="nome@dominio.it">
        <span class="hint">${suggeriti.length
          ? 'Indirizzi presi dall&rsquo;anagrafica (impresa e persone del protocollo): controllali prima di inviare.'
          : 'Nessun indirizzo trovato in anagrafica: scrivilo a mano.'}</span>
      </div>

      <div class="field" style="margin-bottom:12px">
        <label for="m-cc">Copia conoscenza (facoltativa)</label>
        <input type="text" id="m-cc" placeholder="${avviso ? 'es. l&rsquo;ente mittente' : protocollato ? 'es. il coordinatore, il tecnico incaricato' : 'es. cptpd@did.formedilpadova.it'}">
      </div>

      ${conDrive.length ? `
      <div class="field" style="margin-bottom:12px">
        <label>Documenti da allegare</label>
        <div id="m-att" style="display:flex;flex-direction:column;gap:4px">
          ${conDrive.map((a, i) => `
            <label style="font-weight:400;display:flex;gap:8px;align-items:center">
              <input type="checkbox" style="width:auto" value="${esc(a.drive_file_id)}" ${preselezione(a, i) ? 'checked' : ''}>
              <span>${esc(a.nome)}${a.timbrato ? ' <span class="tag">timbrato</span>' : ''}${a.principale ? ' <span class="tag">principale</span>' : ''}</span>
            </label>`).join('')}
        </div>
        ${avviso ? '<span class="hint">Di norma non serve: il documento è suo, ce l&rsquo;ha già.</span>'
          : protocollato ? '<span class="hint">Proposti i timbrati: è la copia protocollata che deve uscire.</span>' : ''}
      </div>` : `<p class="hint" style="margin:0 0 12px">Nessun documento su Drive collegato a questo protocollo${protocollato ? ': la mail partirebbe senza allegati' : ''}.</p>`}

      <div class="field" style="margin-bottom:14px">
        <label for="m-msg">${protocollato ? 'Testo della comunicazione' : 'Il tuo testo (facoltativo)'}</label>
        <textarea id="m-msg" ${protocollato ? 'rows="6"' : ''} placeholder="${avviso ? 'Righe da aggiungere prima dei saluti…' : protocollato ? 'Es. «vogliate trovare in allegato…»' : 'Es. «Ti giro questa, scade il 18 settembre»…'}">${protocollato ? esc(p.note || '') : ''}</textarea>
        ${protocollato ? '<span class="hint">Proposto il testo registrato nelle note del protocollo. Saluto iniziale e «Cordialmente» li mette la mail.</span>' : ''}
      </div>

      ${protocollato ? `
      <div class="field" style="margin-bottom:14px">
        <label>Come parte</label>
        <label style="font-weight:400;display:flex;gap:8px;align-items:center">
          <input type="radio" name="m-canale" value="bozza" style="width:auto" checked>
          <span><strong>Outlook</strong> — si scarica la bozza pronta, la rileggi e premi Invia tu (mittente <code>cpt@formedilpadova.it</code>)</span>
        </label>
        <label style="font-weight:400;display:flex;gap:8px;align-items:center;margin-top:6px">
          <input type="radio" name="m-canale" value="gmail" style="width:auto">
          <span><strong>Gmail</strong> — la bozza nasce nelle Bozze di <code>cptpd@did.formedilpadova.it</code>: la apri da Gmail, la modifichi se serve e la invii tu (risposte a <code>cpt@formedilpadova.it</code>)</span>
        </label>
      </div>` : ''}

      <p class="hint" style="margin:0 0 16px;line-height:1.5">
        ${protocollato
          ? 'In testa alla mail va la stampa del protocollo (numero, data, ufficio); in piede la firma della Segreteria con dati dell&rsquo;ente, orari e nota privacy. L&rsquo;oggetto è nella forma di sempre: «FORMEDIL Padova -AREA SICUREZZA E SALUTE- &lt;oggetto&gt; Prot. &lt;N&gt; - email del &lt;data e ora&gt; - alla c.a. &lt;persona&gt;».'
          : `Intestazione, firma della Segreteria, dati dell'ente, orari e nota privacy vengono aggiunti
             automaticamente${avviso ? '' : ', insieme alla scheda del protocollo e al testo della comunicazione ricevuta'}.<br>
             <strong>La mail non parte da qui</strong>: si scarica pronta e si apre in Outlook
             &mdash; mittente <code>cpt@formedilpadova.it</code> &mdash; dove la rileggi e premi Invia tu.`}
      </p>

      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" id="m-annulla">Annulla</button>
        <button class="btn btn-primary" id="m-invia">${avviso ? '📧 Apri l&rsquo;avviso in Outlook' : protocollato ? '📧 Apri in Outlook' : '📧 Apri l&rsquo;inoltro in Outlook'}</button>
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
    const campo = $('#' + $('#m-rubrica', bg).dataset.campo, bg);
    const gia = campo.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (gia.includes(b.dataset.mail)) return;
    campo.value = [...gia, b.dataset.mail].join(', ');
  });

  /* l'etichetta del bottone segue il canale scelto */
  bg.querySelectorAll('input[name="m-canale"]').forEach((r) => r.addEventListener('change', () => {
    $('#m-invia', bg).textContent = r.value === 'gmail' && r.checked ? '📝 Crea la bozza in Gmail' : '📧 Apri in Outlook';
  }));

  $('#m-invia', bg).addEventListener('click', async (ev) => {
    const to = $('#m-to', bg).value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!to.length) return toast('Serve almeno un destinatario.', 'err');
    const cc = $('#m-cc', bg).value.split(',').map((x) => x.trim()).filter(Boolean);
    const driveFileIds = [...bg.querySelectorAll('#m-att input:checked')].map((c) => c.value);
    const canale = bg.querySelector('input[name="m-canale"]:checked')?.value || 'bozza';
    const gmail = protocollato && canale === 'gmail';

    const btn = ev.currentTarget;
    attendi(btn, true, 'Preparo…');
    const { data, error } = await sb.functions.invoke('send-protocollo', {
      body: {
        protocolloId: p.id,
        modo,
        azione: gmail ? 'bozza-gmail' : 'bozza',
        to,
        cc,
        messaggio: $('#m-msg', bg).value.trim(),
        driveFileIds,
      },
    });
    attendi(btn, false);

    if (error || data?.error) {
      toast('Non sono riuscito a preparare la mail: ' + (data?.error || error?.message || 'risposta vuota'), 'err');
      return;
    }

    /* Resta scritto che cosa abbiamo mandato e, soprattutto, che cosa
       abbiamo SCRITTO: prima il testo viveva solo in questo campo e
       spariva alla chiusura del dialogo. Registriamo la PREPARAZIONE —
       l'invio lo fa una persona, e l'app non lo sa. */
    /* I nomi degli allegati li dice la funzione, che sa quali ha davvero
       messo nella mail; il DOM è solo la riserva. */
    const nomiAllegati = (data?.allegati?.length ? data.allegati
      : [...bg.querySelectorAll('#m-att input:checked')]
          .map((c) => c.closest('label')?.textContent.trim() || c.value)
    ).filter(Boolean);
    const { error: eStorico } = await sb.from('s_prot_invii').insert({
      protocollo_id: p.id,
      modo,
      canale: gmail ? 'gmail' : 'outlook',
      destinatari: to,
      cc,
      oggetto: data?.oggetto || null,
      testo: $('#m-msg', bg).value.trim() || null,
      allegati: nomiAllegati,
      preparata_da: (await sb.auth.getUser()).data?.user?.email || null,
    });
    if (eStorico) toast('Mail pronta, ma non sono riuscito a registrarla nel protocollo: ' + eStorico.message, 'err');

    if (gmail) {
      chiudi();
      /* La bozza e' nella casella: si apre Gmail su quella bozza. Da li'
         si rilegge, si corregge e si preme Invia — l'app non ha spedito
         niente. */
      if (data?.url) window.open(data.url, '_blank', 'noopener');
      toast(`Bozza creata nelle Bozze di ${data?.casella || 'cptpd@did.formedilpadova.it'}${data?.allegati?.length ? ` con ${data.allegati.length} allegat${data.allegati.length === 1 ? 'o' : 'i'}` : ''}: aprila da Gmail e premi Invia tu.`, 'ok');
      return;
    }

    if (!data?.eml) { toast('Non sono riuscito a preparare la mail: risposta vuota', 'err'); return; }

    /* Il .eml scaricato: doppio clic e Outlook lo apre in
       composizione, allegati compresi. Non e' una mail ricevuta,
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
