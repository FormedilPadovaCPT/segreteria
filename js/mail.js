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

   DESTINATARI (14/09/2026, chiesto dall'utente): gli indirizzi che
   l'anagrafica conosce — impresa del protocollo, persone indicate in
   «persona» e «alla c.a.», persone collegate all'impresa — sono righe
   da spuntare, «A» o «Cc». Altre persone si aggiungono in copia
   cercandole in anagrafica; restano i campi liberi per chi non c'è.
   La logica sta in mail-indirizzi.js, provata con node --test.

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
import {
  RUBRICA_INTERNA, emailAssegnatario, testoProposto, salutoProposto, modelloProtocollato,
  oggettoProposto, MODELLI_PROTOCOLLATO,
} from './lookups.js';
import {
  paroleNominativo, chiaveNominativo, vociIndirizzi, raccogliDestinatari, dividiIndirizzi, nomeDiPersona, E_NOTA, EMAIL_VALIDA,
  vociDaGruppo,
} from './mail-indirizzi.js';
import { collegaBarraFormato } from './testo-formato.js';

const CAMPI_PERSONA = 'persona_id, nome, cognome, titolo, email, email2, email3';

/* Quello che l'anagrafica sa della controparte del protocollo: la riga
   dell'impresa, le persone il cui cognome compare in «persona» e «alla
   c.a.» (il confronto per nome e cognome lo fa mail-indirizzi.js) e le
   persone collegate all'impresa che hanno una e-mail. */
async function anagraficaControparte(p) {
  let impresa = null;
  let personeImpresa = [];
  if (p.impresa_id) {
    const { data: imp } = await sb.from('imprese')
      .select('impresa_nome, impresa_email_ref, impresa_email2, impresa_email3, pec')
      .eq('impresa_id', p.impresa_id).maybeSingle();
    impresa = imp || null;

    const { data: legami } = await sb.from('persone_imprese')
      .select('persona_id').eq('impresa_id', p.impresa_id).limit(300);
    const ids = [...new Set((legami || []).map((l) => l.persona_id).filter(Boolean))];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from('persone').select(CAMPI_PERSONA)
        .in('persona_id', ids.slice(i, i + 100))
        .or('email.not.is.null,email2.not.is.null,email3.not.is.null');
      personeImpresa.push(...(data || []));
    }
  }

  const nominativi = [p.persona, p.alla_ca].filter(Boolean);
  const parole = [...new Set(nominativi.flatMap(paroleNominativo))];
  let personeTrovate = [];
  if (parole.length) {
    /* anche i tecnici (14/09/2026): la lettera di incarico va a loro, e in
       `persone` spesso non ci sono o non hanno la e-mail dell'ufficio */
    const [{ data: pers }, { data: tec }] = await Promise.all([
      sb.from('persone').select(CAMPI_PERSONA)
        .or(parole.map((w) => `cognome.ilike.${w}`).join(','))
        .limit(60),
      sb.from('tecnici').select('tecnico_nome, tecnico_cognome, titolo, email')
        .or(parole.map((w) => `tecnico_cognome.ilike.%${w}%`).join(','))
        .limit(20),
    ]);
    /* chi non ha e-mail non aggiunge indirizzi e farebbe solo sembrare
       ambiguo un nome; la stessa persona in `persone` e in `tecnici` con la
       stessa e-mail conta una volta */
    const visti = new Set();
    personeTrovate = [
      ...(pers || []),
      ...(tec || []).map((t) => ({ nome: t.tecnico_nome, cognome: t.tecnico_cognome, titolo: t.titolo, email: t.email })),
    ].filter((r) => {
      const mail = [r.email, r.email2, r.email3].map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
      if (!mail.length) return false;
      const k = `${chiaveNominativo(`${r.nome || ''} ${r.cognome || ''}`)}|${mail[0]}`;
      if (visti.has(k)) return false;
      visti.add(k);
      return true;
    });
  }
  return { impresa, nominativi, personeTrovate, personeImpresa };
}

/* Il gruppo di verifica della pratica di asseverazione a cui appartiene il
   protocollo (a_pratica_protocollo → a_pratica_gdv → tecnici): serve ai
   documenti che vanno ai tecnici, come il piano 5.D.4. La segreteria lo
   legge da utente «ufficio» dell'app asseverazione. Prima i verificatori,
   poi gli osservatori. */
async function gruppoVerificaDelProtocollo(p) {
  const { data: legami } = await sb.from('a_pratica_protocollo').select('pratica_id').eq('protocollo_id', p.id);
  const pratiche = [...new Set((legami || []).map((l) => l.pratica_id).filter(Boolean))];
  if (!pratiche.length) return [];
  const { data: gdv } = await sb.from('a_pratica_gdv')
    .select('tecnico_id, ruolo, rgv, ordine').in('pratica_id', pratiche);
  const righe = (gdv || []).filter((g) => g.tecnico_id)
    .sort((a, b) => (a.ruolo === 'osservatore') - (b.ruolo === 'osservatore') || (a.ordine ?? 0) - (b.ordine ?? 0));
  if (!righe.length) return [];
  const { data: tecnici } = await sb.from('tecnici')
    .select('tecnico_id, tecnico_cognome, tecnico_nome, titolo, email')
    .in('tecnico_id', [...new Set(righe.map((g) => g.tecnico_id))]);
  const perId = new Map((tecnici || []).map((t) => [t.tecnico_id, t]));
  return righe.map((g) => {
    const t = perId.get(g.tecnico_id) || {};
    return {
      email: t.email || '',
      nome: [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' '),
      ruolo: g.ruolo,
      rgv: !!g.rgv,
    };
  });
}

/* Il tecnico a cui è intestata una lettera di incarico fatta dall'app
   asseverazione: la riga del gruppo di verifica porta il protocollo della
   sua lettera (a_pratica_gdv.incarico_protocollo_id). Le lettere di Access
   non ce l'hanno: lì il tecnico si trova dal nominativo del protocollo. */
async function incaricatiDelProtocollo(p) {
  const { data: righe } = await sb.from('a_pratica_gdv').select('tecnico_id').eq('incarico_protocollo_id', p.id);
  const ids = [...new Set((righe || []).map((r) => r.tecnico_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data: tecnici } = await sb.from('tecnici')
    .select('tecnico_id, tecnico_cognome, tecnico_nome, titolo, email').in('tecnico_id', ids);
  return (tecnici || []).map((t) => ({
    email: t.email || '',
    nome: [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' '),
  }));
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
  /* le note del vault (.md) non sono documenti da allegare */
  const conDrive = (allegati || []).filter((a) => a.drive_file_id && !E_NOTA(a.nome));

  /* il modello del tipo di documento: testo, saluto, a chi va e che cosa
     parte sempre con lui (lookups.js, dal 14/09/2026) */
  /* la lettera di incarico dell'asseverazione si riconosce anche dal gruppo
     di verifica che la cita: va saputo prima di scegliere il modello */
  const incaricati = protocollato && MODELLI_PROTOCOLLATO[p.tipo_doc_id]?.a === 'incaricato'
    ? await incaricatiDelProtocollo(p) : [];
  const contesto = { incaricoAsseverazione: incaricati.length > 0 };
  const modello = protocollato ? modelloProtocollato(p, contesto) : {};
  const fissi = (modello.allegati || [])
    .filter((f) => !conDrive.some((a) => a.drive_file_id === f.drive_file_id))
    .map((f) => ({ ...f, fisso: true }));
  const documenti = [...conDrive, ...fissi];

  /* Quali allegati proporre gia' spuntati, secondo il verso:
     - avviso: nessuno (il documento e' del mittente, ce l'ha gia');
     - inoltro: il primo (principale o timbrato);
     - protocollato: i timbrati; se non ce ne sono, tutti; e sempre quelli
       che il tipo di documento si porta dietro (la UNI 11751-1 col 5.D.3). */
  const preselezione = (a, i) => {
    if (avviso) return false;
    if (a.fisso) return true;
    if (protocollato) return conDrive.some((x) => x.timbrato) ? !!a.timbrato : true;
    return i === 0;
  };

  /* A chi si scrive, secondo il verso: fuori (anagrafica), o dentro (ufficio). */
  let voci;
  let gdvMancante = false;
  if (avviso || protocollato) {
    const serveGdv = modello.a === 'gdv' || modello.cc === 'gdv';
    const gruppoVerifica = serveGdv ? await gruppoVerificaDelProtocollo(p) : [];
    gdvMancante = serveGdv && !gruppoVerifica.some((g) => EMAIL_VALIDA.test(String(g.email || '').trim()));
    voci = vociIndirizzi({ ...(await anagraficaControparte(p)), gruppoVerifica, incaricati, modello });
  } else {
    const interno = emailAssegnatario(p.alla_ca);
    voci = vociIndirizzi({ interni: interno ? [{ email: interno, nome: p.alla_ca || '' }] : [] });
  }

  /* i gruppi di destinatari: chi ha oggi una certa nomina (tabella
     s_gruppi_destinatari, dal 16/09/2026). I membri si leggono al clic. */
  const { data: gruppi, error: erroreGruppi } = await sb.from('s_gruppi_destinatari')
    .select('codice, nome').eq('attivo', true).order('ordine');

  const titolo = avviso ? 'Avviso di protocollazione'
    : protocollato ? 'Invia il documento protocollato' : 'Inoltra il documento protocollato';
  const chi = esc(p.impresa_nome || p.persona || p.alla_ca || '');

  const bg = document.createElement('div');
  bg.className = 'drawer-bg';
  bg.style.zIndex = 62;
  bg.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;
                padding:22px;width:min(680px,95vw);max-height:92vh;overflow-y:auto;box-shadow:var(--ombra)">
      <h3 style="margin:0 0 4px;font-size:17px">${titolo}</h3>
      <p style="margin:0 0 16px;color:var(--testo-soft);font-size:13px;line-height:1.5">
        Protocollo <strong>${esc(codice)}</strong> del ${dataIt(p.data_prot)}.
        ${avviso
          ? `Va <strong>al mittente</strong> — ${chi || 'chi ci ha scritto'} —
             per dirgli che la sua comunicazione è stata protocollata.`
          : protocollato
            ? `${modello.a === 'incaricato'
                ? `Va <strong>al tecnico incaricato</strong> — ${chi || 'il destinatario del protocollo'} —`
                : modello.a === 'gdv'
                ? `Va <strong>al gruppo di verifica</strong> e per conoscenza all'impresa — ${chi || 'il destinatario del protocollo'} —`
                : `Va <strong>all'impresa e alle persone indicate</strong> — ${chi || 'il destinatario del protocollo'} —${modello.cc === 'gdv' ? ' in copia al gruppo di verifica —' : ''}`}
               con la stampa del protocollo in testa, i documenti allegati e la firma dell'ufficio in piede.`
            : 'Va a chi in ufficio deve vederlo, col documento allegato.'}
      </p>

      <div class="field" style="margin-bottom:10px">
        <label>Indirizzi <span class="hint" style="font-weight:400">— spunta <strong>A</strong> per i destinatari, <strong>Cc</strong> per la copia</span></label>
        <div id="m-indirizzi" style="display:flex;flex-direction:column;gap:2px"></div>
        ${gdvMancante ? `<span class="hint" style="color:#b42318">Questo documento va anche al gruppo di verifica, ma non trovo la pratica di asseverazione collegata al protocollo (o i tecnici non hanno e-mail in anagrafica): aggiungili a mano.</span>` : ''}
      </div>

      <div class="field" style="margin-bottom:10px">
        <label>${protocollato ? 'Aggiungi dall&rsquo;ufficio (in copia)' : 'Aggiungi dall&rsquo;ufficio'}</label>
        <div class="chip-riga" id="m-rubrica">
          ${RUBRICA_INTERNA.map((r) => `<button type="button" class="chip" data-mail="${esc(r.email)}" data-nome="${esc(r.nome)}">${esc(r.nome)}</button>`).join('')}
        </div>
      </div>

      <div class="field" style="margin-bottom:10px">
        <label>Aggiungi un gruppo <span class="hint" style="font-weight:400">— chi ha oggi la nomina, tutti in <strong>A</strong></span></label>
        ${(gruppi || []).length ? `
        <div class="chip-riga" id="m-gruppi">
          ${gruppi.map((g) => `<button type="button" class="chip" data-gruppo="${esc(g.codice)}" data-nome="${esc(g.nome)}">👥 ${esc(g.nome)}</button>`).join('')}
        </div>
        <div id="m-gruppi-esito"></div>`
        /* mai sparire in silenzio: se i gruppi non si leggono, si dice perché */
        : `<p class="hint" style="margin:0;color:#b42318">${erroreGruppi
            ? `Non riesco a leggere i gruppi: ${esc(erroreGruppi.message)}`
            : 'Nessun gruppo disponibile per questo account: i gruppi li vede solo chi ha il ruolo di segreteria.'}</p>`}
      </div>

      <div class="field" style="margin-bottom:10px">
        <label for="m-cerca-persona">Aggiungi una persona dall&rsquo;anagrafica (in copia)</label>
        <input type="text" id="m-cerca-persona" placeholder="Cognome, nome o codice fiscale…" autocomplete="off">
        <div id="m-cerca-esito"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="field">
          <label for="m-to">Altri destinatari (a mano)</label>
          <input type="text" id="m-to" placeholder="nome@dominio.it">
        </div>
        <div class="field">
          <label for="m-cc">Altri in copia (a mano)</label>
          <input type="text" id="m-cc" placeholder="${avviso ? 'es. l&rsquo;ente mittente' : protocollato ? 'es. il tecnico incaricato' : 'es. cptpd@did.formedilpadova.it'}">
        </div>
      </div>

      ${documenti.length ? `
      <div class="field" style="margin-bottom:12px">
        <label>Documenti da allegare</label>
        <div id="m-att" style="display:flex;flex-direction:column;gap:4px">
          ${documenti.map((a, i) => `
            <label style="font-weight:400;display:flex;gap:8px;align-items:center">
              <input type="checkbox" style="width:auto" value="${esc(a.drive_file_id)}" ${preselezione(a, i) ? 'checked' : ''}>
              <span>${esc(a.nome)}${a.timbrato ? ' <span class="tag">timbrato</span>' : ''}${a.principale ? ' <span class="tag">principale</span>' : ''}${a.fisso ? ' <span class="tag">va sempre con questo documento</span>' : ''}</span>
            </label>`).join('')}
        </div>
        ${avviso ? '<span class="hint">Di norma non serve: il documento è suo, ce l&rsquo;ha già.</span>'
          : protocollato ? '<span class="hint">Proposti i timbrati: è la copia protocollata che deve uscire.</span>' : ''}
      </div>` : `<p class="hint" style="margin:0 0 12px">Nessun documento su Drive collegato a questo protocollo${protocollato ? ': la mail partirebbe senza allegati' : ''}.</p>`}

      ${protocollato ? `
      <div class="field" style="margin-bottom:10px">
        <label for="m-oggetto">Oggetto della mail</label>
        <input type="text" id="m-oggetto" value="${esc(oggettoProposto(p, contesto))}">
        <span class="hint">Davanti la mail mette sempre «FORMEDIL Padova -AREA SICUREZZA E SALUTE-», dopo «Prot. N - email del … - alla c.a. …».</span>
      </div>
      <div class="field" style="margin-bottom:10px">
        <label for="m-saluto">Saluto iniziale</label>
        <textarea id="m-saluto" rows="3">${esc(salutoProposto(p, contesto))}</textarea>
      </div>` : ''}

      <div class="field" style="margin-bottom:14px">
        <label for="m-msg">${protocollato ? 'Testo della comunicazione' : 'Il tuo testo (facoltativo)'}</label>
        <textarea id="m-msg" ${protocollato ? 'rows="6"' : ''} placeholder="${avviso ? 'Righe da aggiungere prima dei saluti…' : protocollato ? 'Es. «vogliate trovare in allegato…»' : 'Es. «Ti giro questa, scade il 18 settembre»…'}">${protocollato ? esc(testoProposto(p, contesto)) : ''}</textarea>
        ${protocollato ? '<span class="hint">Proposti il testo delle note del protocollo o, se sono vuote, quello usuale per questo tipo di documento. «Cordialmente» lo aggiunge la mail: se lo scrivi tu in fondo, non si ripete. <strong>Quello che scrivi qui resta nel protocollo</strong>: se poi lo cambi in Outlook, correggilo anche qui dal dettaglio.</span>' : ''}
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
  /* si chiude solo con «Annulla»: un clic sullo sfondo buttava via
     destinatari e testo gia' scritti (18/09/2026) */
  $('#m-annulla', bg).addEventListener('click', chiudi);
  /* elenchi, grassetto, anteprima sul testo (25/09/2026): lo stesso traduttore della mail */
  collegaBarraFormato($('#m-msg', bg), { stile: protocollato ? { colore: '#000', interlinea: '1.6' } : {} });

  /* ── le righe degli indirizzi: A e Cc si escludono a vicenda ── */
  const disegnaIndirizzi = () => {
    const box = $('#m-indirizzi', bg);
    if (!voci.length) {
      box.innerHTML = `<p class="hint" style="margin:0">Nessun indirizzo in anagrafica per ${chi || 'questo protocollo'}: aggiungilo dall&rsquo;ufficio, dalla ricerca o scrivilo a mano qui sotto.</p>`;
      return;
    }
    let gruppo = null;
    box.innerHTML = voci.map((v, i) => {
      const intesta = v.gruppo !== gruppo
        ? `<div class="hint" style="margin:${gruppo === null ? 0 : 8}px 0 2px;font-weight:600">${esc(v.gruppo)}</div>` : '';
      gruppo = v.gruppo;
      return `${intesta}
        <div style="display:flex;gap:10px;align-items:center;padding:3px 6px;border-radius:6px;${v.ruolo ? 'background:var(--sfondo-soft,#f5f6f7)' : ''}">
          <label style="font-weight:400;display:flex;gap:4px;align-items:center;margin:0">
            <input type="checkbox" style="width:auto" data-i="${i}" data-ruolo="to" ${v.ruolo === 'to' ? 'checked' : ''}> A
          </label>
          <label style="font-weight:400;display:flex;gap:4px;align-items:center;margin:0">
            <input type="checkbox" style="width:auto" data-i="${i}" data-ruolo="cc" ${v.ruolo === 'cc' ? 'checked' : ''}> Cc
          </label>
          <span style="flex:1;min-width:0;overflow-wrap:anywhere"><strong>${esc(v.email)}</strong>
            ${v.etichetta ? `<span class="hint"> · ${esc(v.etichetta)}</span>` : ''}</span>
        </div>`;
    }).join('');
  };
  disegnaIndirizzi();

  $('#m-indirizzi', bg).addEventListener('change', (e) => {
    const c = e.target.closest('input[data-ruolo]');
    if (!c) return;
    const v = voci[Number(c.dataset.i)];
    v.ruolo = c.checked ? c.dataset.ruolo : null;
    disegnaIndirizzi();
  });

  /* aggiunge (o sposta) un indirizzo nelle righe, già spuntato */
  const aggiungiVoce = (email, etichetta, gruppo, ruolo) => {
    const e = String(email || '').trim();
    if (!EMAIL_VALIDA.test(e)) return false;
    const gia = voci.find((v) => v.email.toLowerCase() === e.toLowerCase());
    if (gia) { gia.ruolo = gia.ruolo || ruolo; }
    else voci.push({ email: e, etichetta, gruppo, ruolo });
    disegnaIndirizzi();
    return true;
  };

  /* i pulsantini dell'ufficio: in copia per il protocollato, in «A» altrimenti */
  $('#m-rubrica', bg)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mail]');
    if (!b) return;
    aggiungiVoce(b.dataset.mail, b.dataset.nome, 'Ufficio', protocollato || avviso ? 'cc' : 'to');
  });

  /* un gruppo: i membri si chiedono al database adesso, non all'apertura,
     così una nomina chiusa un minuto fa non c'è più. Si tiene nota di quali
     indirizzi porta ogni gruppo: sulla mail resta scritto a quali gruppi è
     andata davvero (almeno un indirizzo rimasto in «A» o in copia). */
  const gruppiUsati = new Map();   // nome del gruppo → indirizzi (minuscolo)
  const esitiGruppi = [];
  const caricaGruppo = async (codice, nome, bottone) => {
    const esito = $('#m-gruppi-esito', bg);
    if (bottone) attendi(bottone, true, 'Carico…');
    const { data: membri, error } = await sb.rpc('s_gruppo_destinatari', { p_codice: codice });
    if (bottone) attendi(bottone, false);
    if (error) {
      if (esito) esito.innerHTML = `<p class="hint" style="color:#b42318">Non riesco a leggere il gruppo: ${esc(error.message)}</p>`;
      return;
    }
    const { voci: nuove, senzaEmail, dominioVecchio } = vociDaGruppo(membri, nome);
    nuove.forEach((v) => aggiungiVoce(v.email, v.etichetta, v.gruppo, v.ruolo));
    gruppiUsati.set(nome, new Set(nuove.map((v) => v.email.toLowerCase())));
    const righe = [(membri || []).length
      ? `«${esc(nome)}»: ${nuove.length} ${nuove.length === 1 ? 'indirizzo aggiunto' : 'indirizzi aggiunti'}.`
      : `«${esc(nome)}»: nessuno ha oggi questa nomina in corso.`];
    if (senzaEmail.length) righe.push(`<span style="color:#b42318">Senza indirizzo in anagrafica: ${esc(senzaEmail.join(', '))}.</span>`);
    if (dominioVecchio.length) righe.push(`<span style="color:#b42318">Indirizzo sul vecchio dominio scuolaedilepadova.net: ${esc(dominioVecchio.join(', '))} — controlla prima di inviare.</span>`);
    esitiGruppi.push(righe.join('<br>'));
    if (esito) esito.innerHTML = `<p class="hint" style="margin:4px 0 0;line-height:1.5">${esitiGruppi.join('<br>')}</p>`;
  };

  $('#m-gruppi', bg)?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gruppo]');
    if (b) caricaGruppo(b.dataset.gruppo, b.dataset.nome, b);
  });

  /* il protocollo è destinato a un gruppo: i membri entrano da soli in «A» */
  if (p.gruppo_destinatari) {
    const g = (gruppi || []).find((x) => x.codice === p.gruppo_destinatari);
    if (g) caricaGruppo(g.codice, g.nome, bg.querySelector(`[data-gruppo="${g.codice}"]`));
  }

  /* ricerca di una persona in anagrafica: tutte le sue e-mail entrano
     nelle righe, la prima già in copia */
  let timerCerca = null;
  $('#m-cerca-persona', bg).addEventListener('input', (ev) => {
    clearTimeout(timerCerca);
    const q = ev.target.value.trim().replace(/[(),]/g, ' ');
    const esito = $('#m-cerca-esito', bg);
    if (q.length < 3) { esito.innerHTML = ''; return; }
    timerCerca = setTimeout(async () => {
      const { data } = await sb.from('persone').select(CAMPI_PERSONA + ', cf, qualifica')
        .or(`cognome.ilike.%${q}%,nome.ilike.%${q}%,cf.ilike.%${q}%`)
        .order('cognome').limit(8);
      const righe = data || [];
      esito.innerHTML = righe.length
        ? righe.map((r, k) => {
            const mail = [r.email, r.email2, r.email3].filter(Boolean);
            return `<button type="button" class="btn btn-ghost btn-sm" data-k="${k}" ${mail.length ? '' : 'disabled'}
                      style="display:block;width:100%;text-align:left;margin-top:4px">
                      ${esc(nomeDiPersona(r))} <span class="hint">${mail.length ? esc(mail.join(', ')) : 'nessuna e-mail in anagrafica'}${r.qualifica ? ' · ' + esc(r.qualifica) : ''}</span>
                    </button>`;
          }).join('')
        : '<p class="hint">Nessuna persona in anagrafica con questo nome: scrivi l&rsquo;indirizzo a mano.</p>';
      esito.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
        const r = righe[Number(b.dataset.k)];
        [r.email, r.email2, r.email3].filter(Boolean)
          .forEach((m, n) => aggiungiVoce(m, nomeDiPersona(r), 'Aggiunte dalla ricerca', n === 0 ? 'cc' : null));
        $('#m-cerca-persona', bg).value = '';
        esito.innerHTML = '';
      }));
    }, 250);
  });

  /* l'etichetta del bottone segue il canale scelto */
  bg.querySelectorAll('input[name="m-canale"]').forEach((r) => r.addEventListener('change', () => {
    $('#m-invia', bg).textContent = r.value === 'gmail' && r.checked ? '📝 Crea la bozza in Gmail' : '📧 Apri in Outlook';
  }));

  $('#m-invia', bg).addEventListener('click', async (ev) => {
    const { to, cc, nonValidi } = raccogliDestinatari(voci, dividiIndirizzi($('#m-to', bg).value), dividiIndirizzi($('#m-cc', bg).value));
    if (nonValidi.length) return toast(`Questi non sembrano indirizzi e-mail: ${nonValidi.join(', ')}`, 'err');
    if (!to.length) return toast('Serve almeno un destinatario: spunta «A» su un indirizzo o scrivilo a mano.', 'err');
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
        saluto: protocollato ? $('#m-saluto', bg).value.trim() : undefined,
        oggettoMail: protocollato ? $('#m-oggetto', bg).value.trim() : undefined,
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
    const indirizziMail = new Set([...to, ...cc].map((x) => x.toLowerCase()));
    const gruppiInviati = [...gruppiUsati]
      .filter(([, indirizzi]) => [...indirizzi].some((x) => indirizziMail.has(x)))
      .map(([nome]) => nome);
    const { error: eStorico } = await sb.from('s_prot_invii').insert({
      protocollo_id: p.id,
      modo,
      canale: gmail ? 'gmail' : 'outlook',
      destinatari: to,
      cc,
      gruppi: gruppiInviati,
      oggetto: data?.oggetto || null,
      testo: $('#m-msg', bg).value.trim() || null,
      saluto: protocollato ? ($('#m-saluto', bg).value.trim() || null) : null,
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
    toast(`Bozza pronta: aprila da Outlook e premi Invia. A ${to.join(', ')}${cc.length ? ` · Cc ${cc.join(', ')}` : ''}`, 'ok');
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
