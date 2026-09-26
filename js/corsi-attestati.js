/* ============================================================
   ATTESTATI DEI CORSI — nella scheda del corso             (26/09/2026)

   Staccato da corsi.js così com'era, senza cambiare niente:
   · richiesta dei dati che mancano per stampare l'attestato;
   · generazione con la serie N/aaaa, deposito su Drive, QR di verifica;
   · ristampa, invio per mail (singolo o a gruppi), revoca;
   · copia sulla pagina pubblica di verifica.

   Dalla scheda del corso prende `conf` e `TIPI_ATT` (in sola lettura:
   `conf` la ricarica carica() in corsi.js e qui si vede sempre quella
   corrente) e richiama render/apriCorso per ridisegnare dopo il lavoro.
   ⚠️ corsi.js importa questo file e questo importa corsi.js: va bene
   finché qui, al caricamento, non si CHIAMA niente di corsi.js — solo
   dentro le funzioni.
   ============================================================ */

import { sb, $, esc, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { risolviCartella, leggiByte } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { generaCodice, serieVerificabile, urlVerifica, URL_VERIFICA_PREDEFINITA } from './attestati-verifica.js';
import { riassuntoMancanti, raggruppaRichieste, testoRichiestaDati, testoInvioAttestati, destinatariPossibili } from './corsi-anagrafica.js';
import { conf, TIPI_ATT, render, apriCorso } from './corsi.js';

/* ── ATTESTATI: serie N/aaaa + PDF + deposito su Drive ──
   Prende gli iscritti PRESENTI dei corsi con rilascio: chi non ha
   ancora un numero lo riceve (progressivo dell'anno), chi ha già
   un numero della serie nuova ma non il PDF viene rigenerato.
   Gli attestati storici (numero senza /) non si toccano. */
/* ── CHIEDERE I DATI CHE MANCANO PER L'ATTESTATO (21/09/2026) ──
   Chiesto dall'utente: «sarebbe utile predisporre una mail con i dati che
   necessitano, così la segreteria può inviarla e completare».

   ⚠️ DUE MODI, e si scelgono (precisato dall'utente lo stesso giorno:
   «deve essere possibile sia un'opzione che l'altra, perché non sempre
   son persone della stessa impresa oppure sono liberi professionisti»):
     · UNA MAIL PER IMPRESA — un elenco solo a chi ha iscritto il
       gruppo; dieci mail separate allo stesso ufficio non le legge nessuno;
     · UNA MAIL PER PERSONA — per i liberi professionisti e per chi è
       venuto per conto suo. Non è la stessa mail a un altro indirizzo:
       cambia il soggetto, e si chiedono i SUOI dati.

   Gli indirizzi si PROPONGONO (iscrizione, persona, impresa) nell'ordine
   che ha senso per il modo scelto, e restano modificabili: a chi scrivere
   lo decide la segreteria.

   ⚠️ Le bozze si scaricano, non partono: è il confine di sempre. */
async function chiediDatiAttestato(c, incompleti, esitoDati, anagDi, impDi) {
  const righe = incompleti.map((i) => ({
    id: i.id, nominativo: i.nominativo, impresa_txt: i.impresa_txt || '', impresa_id: i.impresa_id || '',
    mancanti: esitoDati[i.id].mancanti, daCompletare: esitoDati[i.id].daCompletare,
    email_iscrizione: i.email_iscrizione, email_persona: anagDi[i.persona_id]?.email || anagDi[i.persona_id]?.email2,
    email_impresa: impDi[i.impresa_id]?.email,
  }));
  /* se nessuno ha un'impresa, «per impresa» non vuol dire niente:
     si parte dal modo che in quel corso ha senso */
  let modo = righe.some((r) => r.impresa_txt || r.impresa_id) ? 'impresa' : 'persona';

  const disegna = () => {
    const lista = raggruppaRichieste(righe, modo).map((g, n) => ({ ...g, n, dest: destinatariPossibili(g.righe, modo) }));
    $('#drawer-body').innerHTML = `
      <p class="hint" style="margin:0 0 8px">Questi sono i dati che <strong>vanno stampati sull'attestato</strong> e che non risultano.
        Le bozze si scaricano: le mandi tu da Outlook e poi registri le risposte.</p>
      <div class="dt-barra">
        <div class="seg" id="cd-modo">
          ${[['impresa', "Una mail per impresa"], ['persona', 'Una mail per persona']].map(([v, l]) =>
            `<button class="seg-btn ${modo === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
        </div>
        <span class="hint">${modo === 'impresa'
          ? 'Un elenco solo a chi ha iscritto il gruppo.'
          : 'Una bozza a testa, intestata alla persona: per i liberi professionisti e per chi è venuto per conto suo.'}</span>
      </div>
      ${lista.map((g) => `
        <div class="dt-doc-riga" style="margin-bottom:10px">
          <label style="display:flex;gap:8px;align-items:flex-start">
            <input type="checkbox" data-grp="${g.n}" checked style="margin-top:4px">
            <span style="flex:1">
              <strong>${esc(g.etichetta)}</strong>${g.righe.length > 1 ? ` — ${g.righe.length} persone` : ''}
              <span class="hint" style="display:block;white-space:normal">${g.righe.map((r) =>
                `${esc(r.nominativo)}: ${esc([...r.mancanti, ...r.daCompletare].map((x) => x.etichetta).join(', ')) || 'da confermare'}`).join(' · ')}</span>
              <span style="display:block;margin-top:6px">
                <input class="inp inp-sm" data-a="${g.n}" style="width:100%" placeholder="A: indirizzo del destinatario"
                  value="${esc(g.dest.map((d) => d.email).join(', '))}">
                ${g.dest.length
                  ? (modo === 'persona' && g.dest.every((d) => d.campo === 'email_impresa')
                    ? '<span class="hint">⚠ di questa persona conosciamo solo l\'indirizzo dell\'impresa.</span>' : '')
                  : '<span class="hint">Nessun indirizzo conosciuto: scrivilo qui.</span>'}
              </span>
            </span>
          </label>
        </div>`).join('')}
      <div class="field"><label>Righe da aggiungere alla mail (facoltativo)</label><input id="cd-nota" value="${esc(nota)}" placeholder="es. servono entro venerdì per la consegna degli attestati"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-primary" id="cd-eml">✉️ Prepara le bozze</button>
      </div>
      <p class="hint" style="margin-top:8px">Un gruppo senza indirizzo non produce bozza: l'app non inventa un destinatario.</p>`;

    $('#cd-modo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b || b.dataset.val === modo) return;
      nota = $('#cd-nota')?.value || nota;      /* quello che hai scritto non si perde cambiando modo */
      modo = b.dataset.val;
      disegna();
    });

    $('#cd-eml').addEventListener('click', () => {
      nota = $('#cd-nota').value.trim();
      let fatte = 0; const senza = [];
      for (const g of lista) {
        if (!$(`[data-grp="${g.n}"]`)?.checked) continue;
        const a = String($(`[data-a="${g.n}"]`)?.value || '').trim();
        if (!a) { senza.push(g.etichetta); continue; }
        const corpo = testoRichiestaDati({ corso: c, righe: g.righe, modo, mittente: FIRMA_SEGRETERIA })
          + (nota ? `\n\n${nota}` : '');
        scaricaEml({
          to: a,
          oggetto: `Dati mancanti per l'attestato — ${c.titolo || `corso n° ${c.id}`}`,
          corpo,
          nomeFile: `dati-attestato-corso-${c.id}-${g.n + 1}.eml`,
        });
        fatte += 1;
      }
      if (!fatte) return toast('Nessuna bozza: spunta almeno un gruppo e scrivi un destinatario.', 'err');
      toast(`${fatte} ${fatte === 1 ? 'bozza scaricata' : 'bozze scaricate'}${senza.length ? `; senza destinatario: ${senza.join(', ')}` : ''}.`,
        senza.length ? 'err' : 'ok');
      chiudiDrawer();
    });
  };

  let nota = '';
  apriDrawer(`Dati mancanti per l'attestato — corso n° ${c.id}`, 'OUT', '<p class="empty">Un istante…</p>');
  disegna();
}

async function generaAttestati(c, giornate, interventi, iscritti, btn, esitoDati = {}) {
  if (!giornate.length) return toast('Un corso ha sempre almeno una giornata: aggiungila prima degli attestati.', 'err');
  const anno = (c.data_fine || c.data_inizio || oggiIso()).slice(0, 4);
  const candidati = iscritti.filter((i) =>
    ['presente', 'presente_online'].includes(i.esito) && i.ammesso !== false &&
    (!i.attestato_numero || (i.attestato_numero.includes('/') && !i.attestato_drive_id)));
  if (!candidati.length) return toast('Nessun iscritto da attestare (servono presenti senza attestato).', 'err');
  /* ⚠️ ULTIMO AVVISO PRIMA DI STAMPARE (21/09/2026). Un attestato senza
     codice fiscale o senza nascita esce con «—» al posto del dato, e il
     nome del file resta senza CF: non si blocca — ci sono casi in cui si
     emette lo stesso — ma non deve succedere per distrazione. */
  const bucati = candidati
    .map((i) => ({ i, e: esitoDati[i.id] }))
    .filter((x) => x.e && x.e.mancanti.length);
  if (bucati.length && !confirm(
    `${bucati.length} ${bucati.length === 1 ? 'attestato uscirebbe incompleto' : 'attestati uscirebbero incompleti'}:\n\n`
    + bucati.slice(0, 8).map((x) => `· ${x.i.nominativo} — manca: ${riassuntoMancanti(x.e)}`).join('\n')
    + (bucati.length > 8 ? `\n· …e altri ${bucati.length - 8}` : '')
    + '\n\nSull\'attestato quei campi escono con «—». Genero lo stesso?')) return;
  if (!confirm(`Genero ${candidati.length} attestati (serie N/${anno}, tipo «${TIPI_ATT[c.tipo_attestato]}»), li deposito su Drive in attestati_emessi/${anno} e scrivo i numeri sulle righe. Procedo?`)) return;
  attendi(btn, true, 'Genero…');
  try {
    const { pdfAttestato, scaricaPdf } = await import('./corsi-doc.js');

    /* firma del responsabile + logo Regione (solo riconosciuti) */
    let firmaByte = null;
    if (conf.responsabile_formativo_firma_id) {
      try { firmaByte = await leggiByte(conf.responsabile_formativo_firma_id); } catch { /* senza firma */ }
    }
    let logoRegioneByte = null;
    if (c.riconosciuto_regione) {
      try { logoRegioneByte = new Uint8Array(await (await fetch('img/logo-regione.png')).arrayBuffer()); }
      catch { toast('img/logo-regione.png non trovato: attestati senza logo Regione.', 'err'); }
    }

    /* progressivo dell'anno sulla serie nuova. Se la lettura fallisce ci si
       ferma: ripartire da 1 darebbe numeri già usati (26/09/2026) */
    const { data: numeri, error: errNum } = await sb.from('s_corsi_iscritti')
      .select('attestato_numero').like('attestato_numero', `%/${anno}`);
    if (errNum) throw new Error(`Non sono riuscito a leggere i numeri già dati agli attestati del ${anno}: nessun attestato generato. Riprova.`);
    let prossimo = Math.max(0, ...(numeri || [])
      .map((r) => Number((r.attestato_numero || '').split('/')[0]))
      .filter((n) => Number.isFinite(n))) + 1;

    /* anagrafiche per luogo/data di nascita */
    const ids = [...new Set(candidati.map((i) => i.persona_id).filter(Boolean))];
    const anag = {};
    if (ids.length) {
      const { data, error: errAn } = await sb.from('persone')
        .select('persona_id, comune_nascita, data_nascita').in('persona_id', ids);
      /* senza anagrafiche gli attestati uscirebbero senza luogo e data di nascita */
      if (errAn) throw new Error('Non sono riuscito a leggere luogo e data di nascita degli iscritti: nessun attestato generato. Riprova.');
      for (const p of data || []) anag[p.persona_id] = { nato_luogo: p.comune_nascita, nato_il: p.data_nascita };
    }

    const cart = await risolviCartella(`2_AREE/Formazione/attestati_emessi/${anno}`);
    const oggi = oggiIso();
    let fatti = 0;
    for (const i of candidati) {
      const numero = i.attestato_numero?.includes('/') ? i.attestato_numero : `${prossimo++}/${anno}`;
      /* il codice di verifica nasce qui perché va dentro il QR (17/09/2026) */
      const codice = i.verifica_codice || generaCodice();
      const byte = await pdfAttestato(c, i, anag[i.persona_id], giornate, interventi, {
        numero, firmaByte, firmaNome: c.responsabile_formativo || conf.responsabile_formativo_nome,
        logoRegioneByte, loghiExtra: [], dataRilascio: oggi,
        verifica: { codice, url: urlVerifica(numero, codice, conf.attestati_verifica_url || URL_VERIFICA_PREDEFINITA) },
      });
      const nome = `${(c.data_fine || c.data_inizio || oggi)}_Attestato_${i.nominativo}${i.cf ? `_${i.cf}` : ''}_Prot_${numero.replace('/', '-')}.pdf`;
      const agg = { attestato_numero: numero, attestato_data: oggi, verifica_codice: codice, updated_at: new Date().toISOString() };
      if (cart.id) {
        const { data: su, error: errUp } = await sb.functions.invoke('allegati-protocollo', {
          body: { action: 'upload', filename: nome, mime_type: 'application/pdf',
            base64: btoa(Array.from(byte, (b) => String.fromCharCode(b)).join('')), parent_id: cart.id },
        });
        if (errUp || su?.error) throw new Error('Deposito su Drive non riuscito: ' + (su?.error || errUp.message));
        agg.attestato_drive_id = su.drive_file_id;
        agg.attestato_drive_url = su.drive_url;
      } else {
        scaricaPdf(byte, nome);   /* cartella dell'anno non ancora su Drive: almeno in locale */
      }
      const { error } = await sb.from('s_corsi_iscritti').update(agg).eq('id', i.id);
      if (error) throw new Error(error.message);
      fatti += 1;
    }
    toast(`${fatti} attestati generati${cart.id ? ` e depositati in attestati_emessi/${anno}` : ' (scaricati in locale: crea la cartella dell\'anno su Drive)'}.`, 'ok');
    await aggiornaVerificaPubblica();
    await render();
    apriCorso(c.id);
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* ── RIGENERA IL PDF di un attestato GIÀ NUMERATO (storico compreso):
   stesso modello standard, stessa firma, stesso QR — usata sia dalla
   ristampa sia dall'invio per mail, così non serve riscaricarlo da Drive
   e i due punti non possono disallinearsi. Se il numero è della serie
   nuova e non ha ancora un codice di verifica, lo crea e lo salva qui
   (unico caso in cui questa funzione scrive sulla riga, 17/09/2026). */
async function pdfByteAttestatoEsistente(c, i, giornate, interventi) {
  const { pdfAttestato } = await import('./corsi-doc.js');
  let firmaByte = null;
  if (conf.responsabile_formativo_firma_id) {
    try { firmaByte = await leggiByte(conf.responsabile_formativo_firma_id); } catch { /* senza firma */ }
  }
  let logoRegioneByte = null;
  if (c.riconosciuto_regione) {
    try { logoRegioneByte = new Uint8Array(await (await fetch('img/logo-regione.png')).arrayBuffer()); } catch { /* senza logo */ }
  }
  let anagrafica = null;
  if (i.persona_id) {
    const { data: p } = await sb.from('persone')
      .select('comune_nascita, data_nascita').eq('persona_id', i.persona_id).maybeSingle();
    if (p) anagrafica = { nato_luogo: p.comune_nascita, nato_il: p.data_nascita };
  }
  let verifica = null;
  if (serieVerificabile(i.attestato_numero)) {
    let codice = i.verifica_codice;
    if (!codice) {
      codice = generaCodice();
      const { error } = await sb.from('s_corsi_iscritti').update({ verifica_codice: codice }).eq('id', i.id);
      if (error) throw new Error('Codice di verifica non salvato: ' + error.message);
      i.verifica_codice = codice;
    }
    verifica = { codice, url: urlVerifica(i.attestato_numero, codice, conf.attestati_verifica_url || URL_VERIFICA_PREDEFINITA) };
  }
  const byte = await pdfAttestato(c, i, anagrafica, giornate, interventi, {
    numero: i.attestato_numero,
    firmaByte, firmaNome: c.responsabile_formativo || conf.responsabile_formativo_nome,
    logoRegioneByte, loghiExtra: [],
    dataRilascio: i.attestato_data || c.data_fine || c.data_inizio,
    verifica,
  });
  const numeroFile = String(i.attestato_numero).replace('/', '-');
  const nome = `${(c.data_fine || c.data_inizio || oggiIso())}_Attestato_${i.nominativo}${i.cf ? `_${i.cf}` : ''}_Prot_${numeroFile}.pdf`;
  if (verifica) await aggiornaVerificaPubblica(true);
  return { byte, nome };
}

/* ── RISTAMPA di un attestato già numerato (storico compreso):
      stesso modello standard, il numero resta quello suo — per lo
      storico è il «Prot.» dell'Access. Solo scarico locale, non
      tocca Drive né la riga. ── */
async function ristampaAttestato(c, i, giornate, interventi) {
  try {
    const { scaricaPdf } = await import('./corsi-doc.js');
    const { byte, nome } = await pdfByteAttestatoEsistente(c, i, giornate, interventi);
    scaricaPdf(byte, nome);
    toast(`Attestato ${i.attestato_numero} ristampato (modello standard).`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ── INVIO ATTESTATI PER MAIL (25/09/2026) ──
   Chiesto dall'utente: dal singolo nominativo, una mail con l'attestato
   allegato; oppure tutti insieme, un allegato a testa nella stessa mail,
   al referente scelto. Stesso raggruppamento di «chiedi i dati mancanti»
   (impresa o persona): non sempre i corsisti sono della stessa impresa. */
async function inviaAttestatoSingolo(c, i, giornate, interventi, anagDi, impDi) {
  const email = i.email_iscrizione || anagDi[i.persona_id]?.email || anagDi[i.persona_id]?.email2 || impDi[i.impresa_id]?.email || '';
  const a = prompt(`Mail con l'attestato di ${i.nominativo} (${i.attestato_numero}) in allegato. Indirizzo destinatario:`, email);
  if (a == null) return;
  if (!a.trim()) return toast('Serve un indirizzo per mandare la mail.', 'err');
  try {
    const { byte, nome } = await pdfByteAttestatoEsistente(c, i, giornate, interventi);
    const corpo = testoInvioAttestati({ corso: c, righe: [{ nominativo: i.nominativo }], modo: 'persona', mittente: FIRMA_SEGRETERIA });
    scaricaEml({
      to: a.trim(),
      oggetto: `Attestato ${TIPI_ATT[c.tipo_attestato] || ''} — ${c.titolo || `corso n° ${c.id}`}`,
      corpo,
      allegati: [{ nome, byte }],
      nomeFile: `attestato-corso-${c.id}-${i.id}.eml`,
    });
    toast('Bozza scaricata, con l\'attestato allegato.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function inviaAttestati(c, giornate, interventi, iscritti, anagDi, impDi) {
  const candidati = (iscritti || []).filter((i) => i.attestato_numero && !i.attestato_revocato_il);
  if (!candidati.length) return toast('Nessun attestato da inviare: generali prima.', 'err');
  const righe = candidati.map((i) => ({
    id: i.id, nominativo: i.nominativo, impresa_txt: i.impresa_txt || '', impresa_id: i.impresa_id || '',
    email_iscrizione: i.email_iscrizione, email_persona: anagDi[i.persona_id]?.email || anagDi[i.persona_id]?.email2,
    email_impresa: impDi[i.impresa_id]?.email,
  }));
  let modo = righe.some((r) => r.impresa_txt || r.impresa_id) ? 'impresa' : 'persona';

  const disegna = () => {
    const lista = raggruppaRichieste(righe, modo).map((g, n) => ({ ...g, n, dest: destinatariPossibili(g.righe, modo) }));
    $('#drawer-body').innerHTML = `
      <p class="hint" style="margin:0 0 8px">Un PDF a testa, allegato alla mail del gruppo. Le bozze si scaricano: le mandi tu da Outlook.</p>
      <div class="dt-barra">
        <div class="seg" id="ia-modo">
          ${[['impresa', 'Una mail per impresa'], ['persona', 'Una mail per persona']].map(([v, l]) =>
            `<button class="seg-btn ${modo === v ? 'is-active' : ''}" data-val="${v}">${l}</button>`).join('')}
        </div>
        <span class="hint">${modo === 'impresa'
          ? 'Un solo allegato multiplo a chi ha iscritto il gruppo (il referente).'
          : 'Una bozza a testa, col proprio attestato in allegato.'}</span>
      </div>
      ${lista.map((g) => `
        <div class="dt-doc-riga" style="margin-bottom:10px">
          <label style="display:flex;gap:8px;align-items:flex-start">
            <input type="checkbox" data-grp="${g.n}" checked style="margin-top:4px">
            <span style="flex:1">
              <strong>${esc(g.etichetta)}</strong> — ${g.righe.length} ${g.righe.length === 1 ? 'attestato' : 'attestati'}
              <span class="hint" style="display:block;white-space:normal">${g.righe.map((r) => esc(r.nominativo)).join(', ')}</span>
              <span style="display:block;margin-top:6px">
                <input class="inp inp-sm" data-a="${g.n}" style="width:100%" placeholder="A: indirizzo del destinatario"
                  value="${esc(g.dest.map((d) => d.email).join(', '))}">
                ${g.dest.length ? '' : '<span class="hint">Nessun indirizzo conosciuto: scrivilo qui.</span>'}
              </span>
            </span>
          </label>
        </div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn btn-primary" id="ia-eml">✉️ Prepara le bozze</button>
      </div>
      <p class="hint" style="margin-top:8px">Un gruppo senza indirizzo non produce bozza: l'app non inventa un destinatario.</p>`;

    $('#ia-modo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-val]');
      if (!b || b.dataset.val === modo) return;
      modo = b.dataset.val;
      disegna();
    });

    $('#ia-eml').addEventListener('click', async (ev) => {
      attendi(ev.currentTarget, true, 'Preparo…');
      let fatte = 0; const senza = []; const errori = [];
      for (const g of lista) {
        if (!$(`[data-grp="${g.n}"]`)?.checked) continue;
        const a = String($(`[data-a="${g.n}"]`)?.value || '').trim();
        if (!a) { senza.push(g.etichetta); continue; }
        try {
          const allegati = [];
          for (const r of g.righe) {
            const i = candidati.find((x) => x.id === r.id);
            const { byte, nome } = await pdfByteAttestatoEsistente(c, i, giornate, interventi);
            allegati.push({ nome, byte });
          }
          const corpo = testoInvioAttestati({ corso: c, righe: g.righe, modo, mittente: FIRMA_SEGRETERIA });
          scaricaEml({
            to: a,
            oggetto: `Attestat${g.righe.length > 1 ? 'i' : 'o'} ${TIPI_ATT[c.tipo_attestato] || ''} — ${c.titolo || `corso n° ${c.id}`}`,
            corpo,
            allegati,
            nomeFile: `attestati-corso-${c.id}-${g.n + 1}.eml`,
          });
          fatte += 1;
        } catch (e) { errori.push(`${g.etichetta}: ${e.message}`); }
      }
      attendi(ev.currentTarget, false);
      if (!fatte && !errori.length) return toast('Nessuna bozza: spunta almeno un gruppo e scrivi un destinatario.', 'err');
      toast(`${fatte} ${fatte === 1 ? 'bozza scaricata' : 'bozze scaricate'}`
        + (senza.length ? `; senza destinatario: ${senza.join(', ')}` : '')
        + (errori.length ? `; errori: ${errori.join('; ')}` : ''),
        (senza.length || errori.length) ? 'err' : 'ok');
      if (fatte) chiudiDrawer();
    });
  };

  apriDrawer(`Invia attestati — corso n° ${c.id}`, 'OUT', '<p class="empty">Un istante…</p>');
  disegna();
}

/* ── VERIFICA PUBBLICA (17/09/2026) ──
   Copia sul progetto Servizi i dati minimi degli attestati nuovi o
   cambiati (funzione attestati-verifica). Se non riesce, l'attestato
   resta valido e la copia la rifà il giro notturno: si avvisa e basta. */
async function aggiornaVerificaPubblica(silenziosa = false) {
  try {
    const { data, error } = await sb.functions.invoke('attestati-verifica', { body: {} });
    if (error) throw new Error(error.message);
    if (data?.errori?.length) throw new Error(data.errori[0]);
    if (!silenziosa && data?.pubblicate) toast(`Verifica online aggiornata: ${data.pubblicate} attestati.`, 'ok');
  } catch (e) {
    toast(`Pagina di verifica non aggiornata (${e.message}): la copia la rifà il giro notturno.`, 'err');
  }
}

/* ── REVOCA di un attestato della serie nuova ──
   Non si cancella niente: la riga resta, con data e motivo, e la pagina
   pubblica mostra «revocato» (il motivo resta qui, non va online). */
async function revocaAttestato(c, i) {
  const motivo = prompt(`Revoco l'attestato ${i.attestato_numero} di ${i.nominativo}. Chi lo verifica online lo vedrà come REVOCATO.\n\nMotivo (resta nell'app, non va sulla pagina pubblica):`);
  if (motivo == null) return;
  if (!motivo.trim()) return toast('Per revocare serve il motivo.', 'err');
  const { error } = await sb.from('s_corsi_iscritti').update({
    attestato_revocato_il: oggiIso(), attestato_revoca_motivo: motivo.trim(), updated_at: new Date().toISOString(),
  }).eq('id', i.id);
  if (error) return toast('Revoca non salvata: ' + error.message, 'err');
  toast(`Attestato ${i.attestato_numero} revocato.`, 'ok');
  await aggiornaVerificaPubblica();
  apriCorso(c.id);
}

export { chiediDatiAttestato, generaAttestati, ristampaAttestato, inviaAttestatoSingolo, inviaAttestati, revocaAttestato };
