/* ============================================================
   CRUSCOTTO — la prima pagina dell'app (chiesto dall'utente il
   01/09/2026): non si apre più sul registro protocollo ma su un
   quadro di controllo che dice che cosa c'è da fare.

   Regola del vault «una lista di task non è lo stato del mondo»:
   il cruscotto NON dichiara verità sue — conta le righe delle
   tabelle vere e ci porta sopra con un click. Dove il giudizio
   richiede la logica della sua pagina (es. il rinnovo tacito dei
   documenti tecnici) si dice «da controllare», non «scaduto».
   ============================================================ */

import { sb, $, esc, dataIt, oggiIso, mostraVista, codiceProtocollo, toast } from './core.js';

const SERVIZI = [
  { tab: 's_segnalazioni', vista: 'segnalazioni', nome: 'Segnalazione', icona: '🚨', chi: (p) => p.notificante },
  { tab: 's_consulenze', vista: 'consulenze', nome: 'Consulenza', icona: '💬', chi: (p) => p.ragione_sociale },
  { tab: 's_visite_richieste', vista: 'visite', nome: 'Richiesta visita', icona: '🏗️', chi: (p) => p.ragione_sociale },
  { tab: 's_conferenze_cantiere', vista: 'conferenze', nome: 'Conferenza', icona: '🎓', chi: (p) => p.ragione_sociale },
  { tab: 's_attestazioni_dm132', vista: 'attestazioni', nome: 'Attestazione DM 132', icona: '🪪', chi: (p) => p.ragione_sociale },
];
const CHIUSE = ['chiusa', 'scartata', 'annullata', 'rilasciata'];

const apriPratica = (vista, id) =>
  document.dispatchEvent(new CustomEvent('apri-pratica', { detail: { vista, id } }));

export async function render() {
  const host = $('#home-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';

  const oggi = oggiIso();
  const fra60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [servizi, { data: rlst }, { data: docTecTutti }, { data: corsi }, { data: prot }, { data: tecAttivi }] = await Promise.all([
    Promise.all(SERVIZI.map(async (s) => {
      const { data } = await sb.from(s.tab).select('*').order('id', { ascending: false }).limit(400);
      return { ...s, righe: (data || []).filter((p) => !CHIUSE.includes(p.stato)) };
    })),
    sb.from('s_rlst_pratiche').select('id, progressivo, ragione_sociale, stato, timestamp_modulo').neq('stato', 'chiusa'),
    sb.from('s_doc_tecnico').select('id, tecnico_id, persona_txt, descrizione, data_fine, senza_scadenza, disdetto_il')
      .eq('senza_scadenza', false).not('data_fine', 'is', null).lte('data_fine', fra60),
    sb.from('s_corsi').select('id, titolo, tipo, stato, data_inizio').not('stato', 'in', '("chiuso","annullato")'),
    sb.from('s_protocollo').select('*').order('id', { ascending: false }).limit(6),
    sb.from('tecnici').select('tecnico_id').eq('attivo', true),
  ]);

  /* ── posta e agenda (08/09/2026): quello che bacheca-giornata ha letto
     alle 8 dalle caselle e dai calendari dell'ufficio. Solo intestazioni
     e anteprima: la mail si apre in Gmail. ─────────────────────────── */
  let bacheca = null;
  try {
    const [{ data: bMail }, { data: bEventi }, { data: bCfg }] = await Promise.all([
      sb.from('s_bacheca_mail').select('casella, thread_id, gmail_id, mittente, mittente_email, oggetto, data, letta, ha_allegati, anteprima, punteggio, motivi, importante')
        .eq('importante', true).order('data', { ascending: false }).limit(40),
      sb.from('s_bacheca_eventi').select('calendario, casella, titolo, inizio, fine, tutto_il_giorno, luogo, link')
        .gte('fine', new Date(Date.now() - 3600000).toISOString()).order('inizio').limit(30),
      sb.from('s_config').select('chiave, valore').in('chiave', ['bacheca_al', 'bacheca_esito']),
    ]);
    const cfgB = Object.fromEntries((bCfg || []).map((r) => [r.chiave, r.valore]));
    let esitoB = null; try { esitoB = cfgB.bacheca_esito ? JSON.parse(cfgB.bacheca_esito) : null; } catch { esitoB = null; }
    bacheca = { mail: bMail || [], eventi: bEventi || [], al: cfgB.bacheca_al || null, esito: esitoB };
  } catch { /* senza il ruolo segreteria la card non compare */ }

  /* ── flussi mai usati (17/09/2026): quante volte ogni flusso ha lavorato su
     un caso vero. Serve a provarli prima che arrivi il primo caso: chi lo
     usa fra tre mesi non ricorda come funziona. Il conto lo fa il database
     (s_flussi_uso), che esclude lo storico importato e gli annullati. ── */
  let flussi = null;
  try {
    const { data, error } = await sb.rpc('s_flussi_uso');
    if (!error) flussi = data || [];
  } catch { /* senza il ruolo segreteria la card non compare */ }

  /* ── stato del canale del portale servizi (04/09/2026, rifatto il 13/09/2026) ──
     Un canale senza richieste nuove e' ambiguo: puo' voler dire che non ha
     scritto nessuno, o che il tubo e' rotto (incidente di agosto: Apps Script
     morto da cinque settimane e in ufficio non si poteva sapere). Dal 13/09/2026
     foglio Google e Apps Script sono spenti: restano il battito della funzione
     portale-richieste e il giro della cassetta delle lettere sul progetto Servizi. */
  let canale = null;
  try {
    const [{ data: cfg }, { count: senzaRiscontro }] = await Promise.all([
      sb.from('s_config').select('chiave, valore').in('chiave', ['portale_battito_ore', 'portale_diretto_battito_al', 'cassetta_giro_al', 'cassetta_in_attesa']),
      /* «senza riscontro» = richiesta scritta nella scatola nera e non ancora
         lavorata dopo un quarto d'ora: e' arrivata, ma la pratica non c'e'. */
      sb.from('s_portale_ricezioni').select('id', { count: 'exact', head: true })
        .is('elaborata_at', null)
        .lte('ricevuto_at', new Date(Date.now() - 15 * 60000).toISOString()),
    ]);
    const c = Object.fromEntries((cfg || []).map((r) => [r.chiave, r.valore]));
    const limite = Number(c.portale_battito_ore || 36);
    /* il battito notturno di portale-richieste: database, cartella dei file,
       delega Gmail e cassetta rispondono davvero */
    const diretto = c.portale_diretto_battito_al ? new Date(c.portale_diretto_battito_al) : null;
    const oreDiretto = diretto && !isNaN(diretto) ? (Date.now() - diretto.getTime()) / 3600000 : null;
    /* la cassetta delle lettere sul progetto Servizi (13/09/2026): il giro
       di ritiro gira ogni 3 minuti e scrive qui il suo stato. Fermo da piu' di
       15 minuti, o con richieste ferme in cassetta, e' un allarme */
    const giro = c.cassetta_giro_al ? new Date(c.cassetta_giro_al) : null;
    const minGiro = giro && !isNaN(giro) ? (Date.now() - giro.getTime()) / 60000 : null;
    let cassetta = null;
    try { cassetta = c.cassetta_in_attesa ? JSON.parse(c.cassetta_in_attesa) : null; } catch { cassetta = null; }
    canale = {
      limite, diretto, oreDiretto, giro, minGiro,
      senzaRiscontro: senzaRiscontro || 0,
      mutoDiretto: oreDiretto === null || oreDiretto > limite,
      mutoCassetta: minGiro === null || minGiro > 15,
      ferme: Number(cassetta?.ferme_oltre_15_min) || 0,
      inAttesa: Number(cassetta?.totali) || 0,
    };
  } catch (e) {
    /* la tabella o le chiavi non ci sono ancora: si tace, non si inventa */
    console.warn('stato canale portale non disponibile:', e.message);
  }

  /* le visite ESEGUITE dai tecnici (gestionale): la chiusura arriva qui,
     poi la segreteria decide se e a chi comunicare (deciso 01/09/2026) */
  let eseguiti = [];
  let rifiutati = [];
  /* cantieri critici (17/09/2026): gli accessi negati segnalati dal tecnico
     nel gestionale e le proposte di segnalazione a SPISAL / ITL spuntate nei
     verbali. Un registro solo, gestito da segreteria e coordinatore */
  let critici = [];
  let ccMod = null;
  try { ccMod = await import('./cantieri-critici.js'); critici = await ccMod.aperti(); } catch { /* senza accesso la card resta vuota */ }
  /* questionari sul sopralluogo (18/09/2026): da quando l'invito parte dalla
     mail del verbale le risposte arrivano davvero, e vanno guardate — un
     giudizio basso invecchia male, e chi ha chiesto di essere richiamato
     aspetta */
  let questionari = [];
  let qsMod = null;
  try { qsMod = await import('./questionari.js'); questionari = await qsMod.daLavorare(); } catch { /* senza accesso la card resta vuota */ }
  /* iscrizioni arrivate dal portale (18/09/2026): sono richieste, non
     iscritti, e finche' restano in coda OCCUPANO IL POSTO nel conteggio dei
     liberi — un evento puo' sembrare pieno solo perche' nessuno le ha
     guardate. Per questo stanno qui e non solo dentro la scheda del corso. */
  let iscrizioni = [];
  try {
    const { data } = await sb.from('s_iscrizioni')
      .select('id, corso_id, stato, per_conto, ragione_sociale, persone, email, creato_il, timestamp_modulo, esito_ceiv')
      .in('stato', ['nuova', 'in_attesa']).order('id', { ascending: false }).limit(30);
    iscrizioni = data || [];
  } catch { /* senza accesso la card resta vuota */ }
  const praticaDi = {};
  try {
    const { data } = await sb.from('incarichi')
      .select('id, tipo_richiesta, impresa, comune, tecnico_nome, visita_id, eseguito_il, data_richiesta')
      .eq('stato', 'eseguito').order('eseguito_il', { ascending: false }).limit(30);
    eseguiti = data || [];
    /* il tecnico che non puo' prendere una visita lo dichiara motivando
       (04/09/2026): il rifiuto vive nel gestionale, ma a doverci fare
       qualcosa e' la segreteria, quindi si vede qui */
    const { data: rif } = await sb.from('incarichi')
      .select('id, tipo_richiesta, impresa, comune, indirizzo, tecnico_nome, rifiutato_il, rifiuto_motivo')
      .not('rifiutato_il', 'is', null).eq('stato', 'aperto')
      .order('rifiutato_il', { ascending: false });
    rifiutati = rif || [];
    const ids = [...eseguiti.map((r) => r.id), ...rifiutati.map((r) => r.id)];
    if (ids.length) {
      for (const [tab, vista] of [['s_segnalazioni', 'segnalazioni'], ['s_visite_richieste', 'visite'],
        ['s_conferenze_cantiere', 'conferenze'], ['s_consulenze', 'consulenze']]) {
        const { data: pr } = await sb.from(tab).select('id, incarico_id').in('incarico_id', ids);
        for (const r of pr || []) praticaDi[r.incarico_id] = { vista, id: r.id };
      }
    }
  } catch { /* senza accesso agli incarichi la card resta vuota */ }
  /* incarichi mensili e fatture dei tecnici: i mesi passati ancora aperti,
     le fatture da verificare/approvare, quelle approvate senza mandato */
  let ftMesiAperti = [], ftDaLavorare = [], ftDaMandato = 0, ftStandby = 0;
  /* dal 16/09/2026: mandati che aspettano la presa visione
     dell'Amministrazione, e fatture pagate il cui avviso automatico al
     tecnico non è partito — un canale che parte da solo va sorvegliato */
  let mandDaVedere = 0, avvisiNonPartiti = [];
  /* dal 21/09/2026: fatture verificate il cui avviso automatico al
     coordinatore non è partito — anche questo canale va sorvegliato */
  let avvisiApprNonPartiti = [];
  try {
    const meseCorr = oggi.slice(0, 7);
    const [{ data: im }, { data: ft }] = await Promise.all([
      sb.from('s_incarichi_mensili').select('id, tecnico_nome, anno, mese, stato').eq('stato', 'aperto').order('anno').order('mese').limit(200),
      sb.from('s_fatture_tecnici').select('id, tecnico_nome, numero, importo, stato, data_ricevimento, avviso_appr_il, avviso_appr_esito').in('stato', ['ricevuta', 'verificata', 'approvata', 'standby']).order('id', { ascending: false }).limit(100),
    ]);
    ftMesiAperti = (im || []).filter((i) => `${i.anno}-${String(i.mese).padStart(2, '0')}` < meseCorr);
    ftDaLavorare = (ft || []).filter((f) => ['ricevuta', 'verificata'].includes(f.stato));
    ftDaMandato = (ft || []).filter((f) => f.stato === 'approvata').length;
    ftStandby = (ft || []).filter((f) => f.stato === 'standby').length;
    avvisiApprNonPartiti = (ft || []).filter((f) => ['ricevuta', 'verificata'].includes(f.stato) && !f.avviso_appr_il && f.avviso_appr_esito);
    const [{ count: nv }, { data: av }] = await Promise.all([
      sb.from('s_mandati_pagamento').select('id', { count: 'exact', head: true }).is('visto_il', null),
      sb.from('s_fatture_tecnici').select('id, tecnico_nome, numero, mandato_id, avviso_pagamento_esito')
        .eq('stato', 'pagata').not('pagata_il', 'is', null).not('mandato_id', 'is', null).is('avviso_pagamento_il', null).limit(50),
    ]);
    mandDaVedere = nv || 0;
    avvisiNonPartiti = av || [];
  } catch { /* senza accesso il riquadro resta vuoto */ }

  /* contano solo i documenti dei tecnici ATTIVI: gli altri sono storia */
  const attivi = new Set((tecAttivi || []).map((t) => t.tecnico_id));
  const docTec = (docTecTutti || []).filter((d) => attivi.has(d.tecnico_id));

  /* ── i tre mucchi che contano ── */
  const daAutorizzare = [];
  const daEseguire = [];
  for (const s of servizi) {
    for (const p of s.righe) {
      const riga = {
        vista: s.vista, id: p.id, icona: s.icona, nome: s.nome,
        chi: s.chi(p) || '?', quando: p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10) : null,
        n: p.progressivo ?? `m${p.id}`,
      };
      if (['da_richiedere', 'richiesta'].includes(p.aut_stato)) daAutorizzare.push(riga);
      else if (p.aut_stato === 'approvata' && !['svolta'].includes(p.stato)) daEseguire.push(riga);
    }
  }
  daAutorizzare.sort((a, b) => String(a.quando || '').localeCompare(String(b.quando || '')));

  /* segnalazioni aperte: hanno anche il loro riquadro, oltre ai mucchi
     autorizzativi comuni (chiesto dall'utente il 01/09) */
  const segnalazioni = servizi.find((s) => s.vista === 'segnalazioni').righe;

  /* consulenze in corsia immediata: il giro segreteria→coordinatore→impresa */
  const cons = servizi.find((s) => s.vista === 'consulenze').righe;
  const consDaGirare = cons.filter((p) => p.corsia !== 'uscita' && !p.girata_il && !p.risposta);
  const consInAttesa = cons.filter((p) => p.girata_il && !p.risposta);
  const consDaTrasmettere = cons.filter((p) => p.risposta && !p.trasmessa_il);

  const docScaduti = (docTec || []).filter((d) => !d.disdetto_il && d.data_fine < oggi);
  const docInScadenza = (docTec || []).filter((d) => !d.disdetto_il && d.data_fine >= oggi);

  const rigaPratica = (r) => `
    <div class="hm-riga" data-vista="${r.vista}" data-id="${r.id}">
      <span>${r.icona}</span>
      <span><strong>${esc(r.nome)} n° ${esc(String(r.n))}</strong> — ${esc(r.chi)}</span>
      <span class="hint">${r.quando ? dataIt(r.quando) : ''}</span>
    </div>`;

  const card = (titolo, conteggio, corpo, azione = '') => `
    <div class="hm-card ${conteggio ? '' : 'hm-vuota'}">
      <div class="hm-testa"><h3>${titolo}</h3><span class="hm-n ${conteggio ? 'hm-n-attivo' : ''}">${conteggio}</span></div>
      ${corpo}${azione}
    </div>`;

  const vai = (vista, etichetta) => `<button class="btn btn-ghost btn-sm hm-vai" data-goto="${vista}">${etichetta} →</button>`;

  /* Il banner compare SOLO quando c'e' qualcosa che non va: un cruscotto
     che urla sempre non lo guarda piu' nessuno. Lo stato normale sta nella
     card in fondo. */
  const bannerCanale = (() => {
    if (!canale) return '';
    const guai = [];
    if (canale.mutoDiretto) {
      guai.push(canale.diretto
        ? `la strada diretta del portale (tutti i moduli) non dà segno di vita da ${Math.round(canale.oreDiretto)} ore (ultimo battito ${dataIt(canale.diretto.toISOString().slice(0, 10))})`
        : 'non risulta nessun battito della strada diretta del portale (tutti i moduli)');
    }
    if (canale.mutoCassetta) {
      guai.push(canale.giro
        ? `il giro della cassetta delle lettere è fermo da ${Math.round(canale.minGiro)} minuti`
        : 'non risulta nessun giro della cassetta delle lettere');
    }
    if (canale.ferme) {
      guai.push(`${canale.ferme} richiest${canale.ferme === 1 ? 'a è ferma' : 'e sono ferme'} in cassetta da oltre 15 minuti`);
    }
    if (canale.senzaRiscontro) {
      guai.push(`${canale.senzaRiscontro} richiest${canale.senzaRiscontro === 1 ? 'a' : 'e'} risultano partite dal portale ma non sono state registrate`);
    }
    if (!guai.length) return '';
    return `<div class="hm-allarme">
      <strong>⚠️ Canale del portale servizi da controllare</strong><br>
      ${esc(guai.join('; '))}.<br>
      <span class="hint">I moduli inviati dalle imprese potrebbero non arrivare. Controllare su Supabase
      i log della funzione <em>portale-richieste</em> e i job pg_cron <em>ritiro-cassetta</em> e
      <em>battito-portale-diretto</em>.</span>
    </div>`;
  })();

  /* la card «Posta e agenda»: gli eventi raggruppati per giorno, poi le mail
     che le regole hanno segnato come importanti, in ordine di punteggio */
  const cardBacheca = (() => {
    if (!bacheca) return '';
    const oraIt = (iso) => iso && iso.length > 10 ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const giornoIt = (iso) => new Date(iso.length > 10 ? iso : iso + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const perGiorno = {};
    for (const e of bacheca.eventi) { const g = String(e.inizio || '').slice(0, 10); (perGiorno[g] = perGiorno[g] || []).push(e); }
    const eventiHtml = Object.keys(perGiorno).sort().map((g) => `
      <div class="hint" style="margin-top:6px;font-weight:600">${esc(giornoIt(g))}</div>
      ${perGiorno[g].map((e) => `
        <div class="hm-riga" ${e.link ? `onclick="window.open('${esc(e.link)}','_blank','noopener')"` : ''}>
          <span>${e.tutto_il_giorno ? '📌' : '🕒'}</span>
          <span><strong>${esc(e.titolo || '')}</strong>${e.luogo ? ` <span class="hint">· ${esc(e.luogo)}</span>` : ''}
            ${e.calendario && !/^primary/.test(e.calendario) ? `<span class="hint"> · ${esc(e.calendario)}</span>` : ''}</span>
          <span class="hint">${e.tutto_il_giorno ? 'tutto il giorno' : oraIt(e.inizio) + (e.fine ? '–' + oraIt(e.fine) : '')}</span>
        </div>`).join('')}`).join('');
    const mail = [...bacheca.mail].sort((a, b) => (b.punteggio - a.punteggio) || String(b.data).localeCompare(String(a.data))).slice(0, 10);
    /* l'anteprima di Gmail arriva già con le entità HTML (&lt; &#39; …): si decodifica prima
       di ri-escapare, altrimenti si legge «&lt;»; e va a capo, non è un'etichetta */
    const deHtml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
    const mailHtml = mail.map((m) => {
      const link = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(m.casella)}#all/${encodeURIComponent(m.thread_id || m.gmail_id)}`;
      const anteprima = deHtml(m.anteprima).replace(/\s+/g, ' ').trim().slice(0, 140);
      return `
      <div class="hm-riga" onclick="window.open('${link}','_blank','noopener')" title="${esc((m.motivi || []).join(', '))}">
        <span>${m.letta ? '📨' : '📩'}</span>
        <span><strong>${esc(m.oggetto || '')}</strong>${m.ha_allegati ? ' 📎' : ''}
          <span class="hint" style="display:block;white-space:normal;overflow:hidden;text-overflow:ellipsis">${esc(m.mittente || m.mittente_email || '')}${anteprima ? ' — ' + esc(anteprima) + (m.anteprima && m.anteprima.length > 140 ? '…' : '') : ''}</span></span>
        <span class="hint" style="text-align:right">${m.data ? dataIt(String(m.data).slice(0, 10)) + '<br>' + oraIt(m.data) : ''} <span class="hm-mini" title="punteggio delle regole">· ${m.punteggio}</span></span>
      </div>`;
    }).join('');
    const nImp = bacheca.mail.length;
    const alTesto = bacheca.al ? `${dataIt(bacheca.al.slice(0, 10))} ${oraIt(bacheca.al)}` : 'mai';
    const errori = bacheca.esito?.errori?.length ? `<p class="hint" style="color:#b91c1c;margin-top:6px">⚠ Ultimo giro con avvisi: ${esc(bacheca.esito.errori.slice(0, 2).join('; '))}</p>` : '';
    /* due card separate (chiesto dall'utente 08/09): agenda e posta, entrambe in coda al cruscotto;
       il bottone rilegge tutte e due, quindi sta su entrambe */
    const piede = `<div class="hint" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <span>Aggiornata alle ${esc(alTesto)}, dal lunedì al giovedì alle 8.</span>
        <button class="btn btn-ghost btn-sm hm-bacheca-aggiorna" title="Rilegge adesso posta e calendari">🔄 Aggiorna adesso</button>
      </div>`;
    const agenda = card('📅 Agenda della settimana', bacheca.eventi.length,
      (eventiHtml || '<p class="hint">Nessun evento nei prossimi giorni.</p>') + piede);
    const posta = card('✉️ Posta da guardare', nImp,
      (mailHtml || '<p class="hint">Nessuna mail segnata come importante nell\'ultimo giro.</p>')
      + '<p class="hint" style="margin-top:6px">Le mail si aprono in Gmail; l\'app non risponde e non archivia. Il numero a destra è il punteggio delle regole.</p>'
      + errori + piede);
    return { agenda, posta };
  })();

  host.innerHTML = `
    ${bannerCanale}
    <div class="hm-griglia">

      ${card('⏳ In attesa del Direttore', daAutorizzare.length,
        daAutorizzare.length
          ? daAutorizzare.slice(0, 8).map(rigaPratica).join('') + (daAutorizzare.length > 8 ? `<p class="hint">…e altre ${daAutorizzare.length - 8}.</p>` : '')
          : '<p class="hint">Nessuna pratica da autorizzare.</p>')}

      ${card('✋ Incarichi rifiutati dal tecnico', rifiutati.length,
        rifiutati.length
          ? rifiutati.slice(0, 6).map((r) => {
              const pr = praticaDi[r.id];
              return `<div class="hm-riga">
                <span>✋</span>
                <span>${pr ? `<a href="#" data-vista-inc="${pr.vista}" data-id-inc="${pr.id}"><strong>inc. ${r.id}</strong></a>` : `<strong>inc. ${r.id}</strong>`}
                  — ${esc(r.impresa || r.comune || r.indirizzo || '?')}
                  <span class="hint">(${esc(r.tecnico_nome || '')})</span>
                  ${r.rifiuto_motivo ? `<br><span class="hint">«${esc(r.rifiuto_motivo)}»</span>` : ''}</span>
                <button class="btn btn-ghost btn-sm" data-riassegna="${r.id}">Riassegna</button>
              </div>`;
            }).join('') + '<p class="hint" style="margin-top:6px">Il tecnico ha dichiarato di non essere disponibile: riassegnando, l\'incarico torna «da vedere» per il nuovo.</p>'
          : '<p class="hint">Nessun incarico rifiutato.</p>')}

      ${card('🚧 Cantieri critici', critici.length,
        (critici.length
          ? critici.slice(0, 8).map((d) => `
            <div class="hm-riga" data-critico="${d.id}">
              <span title="${esc((ccMod.ORIGINI[d.origine] || [])[1] || '')}">${(ccMod.ORIGINI[d.origine] || ['🚧'])[0]}</span>
              <span><strong>${esc(d.impresa_nome)}</strong> — ${esc(d.cantiere_desc)}
                <span class="hint">(${esc(ccMod.cognomeDi(d.tecnico_nome))})</span>
                <br><span class="hint">«${esc(String(d.note || '').slice(0, 90))}${String(d.note || '').length > 90 ? '…' : ''}»</span></span>
              <span class="hint">${dataIt(d.data_evento)} · ${d.stato === 'nuovo' ? '<strong style="color:#a01f00">nuovo</strong>'
                : ccMod.scaduto(d) ? `<strong style="color:#a01f00">termine scaduto il ${dataIt(d.termine_il)}</strong>`
                : esc((ccMod.STATI[d.stato] || [])[1] || d.stato) + (d.stato === 'attesa_impresa' && d.termine_il ? ` fino al ${dataIt(d.termine_il)}` : '')}</span>
            </div>`).join('') + (critici.length > 8 ? `<p class="hint">…e altri ${critici.length - 8}.</p>` : '')
          : '<p class="hint">Nessun caso aperto.</p>')
        + '<p class="hint" style="margin-top:6px">🚫 accesso negato · ⚠️ proposta di segnalazione a SPISAL / ITL dal verbale — <a href="#" id="hm-critici-tutti">tutti i casi, anche chiusi, e nuovo caso</a></p>')}

      ${(() => {
        if (!qsMod) return '';
        const bassi = questionari.filter((q) => { const v = qsMod.voto(q); return v !== null && v <= 2; });
        const contatti = questionari.filter((q) => qsMod.daContattare(q));
        return card('⭐ Questionari sul sopralluogo', questionari.length,
          (questionari.length
            ? questionari.slice(0, 6).map((q) => {
              const v = qsMod.voto(q);
              const dice = [q.motivi, q.commento || q.proposte_miglioramento].filter(Boolean).join(' — ');
              return `
            <div class="hm-riga" data-questionario="${q.id}">
              <span>${v !== null && v <= 2 ? '🔻' : qsMod.daContattare(q) ? '📞' : '⭐'}</span>
              <span>${q.nr_verbale ? `<strong>${esc(q.nr_verbale)}</strong> — ` : ''}${esc(q.tecnico || 'tecnico non indicato')}
                ${q.data_visita ? `<span class="hint">(visita del ${dataIt(q.data_visita)})</span>` : ''}
                ${dice ? `<br><span class="hint">«${esc(dice.slice(0, 90))}${dice.length > 90 ? '…' : ''}»</span>` : ''}
                ${qsMod.daContattare(q) ? `<br><span class="hint">📞 chiede di essere richiamato${q.recapito_contatto ? ' — ' + esc(q.recapito_contatto) : ''}</span>` : ''}</span>
              <span class="hint">${qsMod.votoCella(q)}${q.stato === 'ricevuto' ? ' · <strong style="color:#a01f00">da leggere</strong>' : ''}</span>
            </div>`;
            }).join('') + (questionari.length > 6 ? `<p class="hint">…e altri ${questionari.length - 6}.</p>` : '')
            : '<p class="hint">Nessun questionario da guardare.</p>')
          + `<p class="hint" style="margin-top:6px">${bassi.length ? `🔻 ${bassi.length} con voto basso · ` : ''}${contatti.length ? `📞 ${contatti.length} da richiamare · ` : ''}<a href="#" data-goto="questionari">tutti i questionari</a></p>`);
      })()}

      ${(() => {
        const titoli = Object.fromEntries((corsi || []).map((c) => [c.id, c.titolo]));
        const quante = iscrizioni.reduce((n, r) => n + (Array.isArray(r.persone) ? r.persone.length : 0), 0);
        return card('🎓 Iscrizioni da confermare', iscrizioni.length,
          (iscrizioni.length
            ? iscrizioni.slice(0, 6).map((r) => {
              const n = Array.isArray(r.persone) ? r.persone.length : 0;
              const chi = r.per_conto === 'persona' ? 'una persona per sé' : (r.ragione_sociale || '—');
              return `
            <div class="hm-riga" data-iscrizione="${r.corso_id || ''}">
              <span>🎓</span>
              <span><strong>${esc(chi)}</strong> — ${n} person${n === 1 ? 'a' : 'e'}
                ${r.esito_ceiv === 'non_iscritta' ? '<span class="hint">(non CEIV)</span>' : ''}
                <br><span class="hint">${esc(titoli[r.corso_id] || (r.corso_id ? 'corso n° ' + r.corso_id : 'evento non agganciato'))}</span></span>
              <span class="hint">${dataIt(String(r.timestamp_modulo || r.creato_il || '').slice(0, 10))}</span>
            </div>`;
            }).join('') + (iscrizioni.length > 6 ? `<p class="hint">…e altre ${iscrizioni.length - 6}.</p>` : '')
            : '<p class="hint">Nessuna iscrizione in attesa.</p>')
          + (iscrizioni.length ? `<p class="hint" style="margin-top:6px">${quante} persone in tutto. Finché non sono confermate
              <strong>occupano il posto</strong>: il portale mostra meno posti liberi di quanti ce ne siano davvero.</p>` : ''));
      })()}

      ${card('✅ Autorizzate — da eseguire', daEseguire.length,
        daEseguire.length
          ? daEseguire.slice(0, 8).map(rigaPratica).join('') + (daEseguire.length > 8 ? `<p class="hint">…e altre ${daEseguire.length - 8}.</p>` : '')
          : '<p class="hint">Niente in coda: le autorizzate sono state svolte.</p>')}

      ${card('💬 Consulenze — corsia immediata', consDaGirare.length + consInAttesa.length + consDaTrasmettere.length, `
        <div class="hm-riga" data-goto="consulenze"><span>📨</span><span>Da girare al coordinatore</span><span class="hm-mini">${consDaGirare.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>⏱</span><span>In attesa della risposta del coordinatore</span><span class="hm-mini">${consInAttesa.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>📤</span><span>Risposta pronta, da trasmettere all'impresa</span><span class="hm-mini">${consDaTrasmettere.length}</span></div>`,
        vai('consulenze', 'Apri le consulenze'))}

      ${card('🚨 Segnalazioni cantiere', segnalazioni.length,
        segnalazioni.length
          ? segnalazioni.slice(0, 6).map((p) => `
            <div class="hm-riga" data-vista="segnalazioni" data-id="${p.id}"><span>🚨</span>
              <span><strong>n° ${esc(String(p.progressivo ?? `m${p.id}`))}</strong> — ${esc(p.notificante || '?')}${p.comune_cantiere ? ` · ${esc(p.comune_cantiere)}` : ''}</span>
              <span class="hint">${esc(p.stato)}${['da_richiedere', 'richiesta'].includes(p.aut_stato) ? ' · dal Direttore' : ''}</span></div>`).join('')
          : '<p class="hint">Nessuna segnalazione aperta.</p>',
        vai('segnalazioni', 'Apri le segnalazioni'))}

      ${card('🔧 Visite eseguite dai tecnici', eseguiti.length,
        eseguiti.length
          ? eseguiti.slice(0, 6).map((r) => {
              const pr = praticaDi[r.id];
              return `<div class="hm-riga" ${pr ? `data-vista="${pr.vista}" data-id="${pr.id}"` : 'data-goto="visite"'}><span>🔧</span>
                <span><strong>inc. ${r.id}</strong> — ${esc(r.impresa || r.comune || '?')}${r.visita_id ? ` · verbale ${esc(String(r.visita_id))}` : ''} <span class="hint">(${esc(r.tecnico_nome || '')})</span></span>
                <span class="hint">${r.eseguito_il ? dataIt(String(r.eseguito_il).slice(0, 10)) : ''}</span></div>`;
            }).join('') + '<p class="hint" style="margin-top:6px">Eseguite nel gestionale, in attesa della chiusura della segreteria — da qui si decide se e a chi comunicare l\'esito.</p>'
          : '<p class="hint">Nessuna visita eseguita in attesa di chiusura.</p>')}

      ${card('📡 Canale portale servizi', canale && !canale.mutoDiretto && !canale.senzaRiscontro && !canale.mutoCassetta && !canale.ferme ? '✓' : '!',
        !canale
          ? '<p class="hint">Stato non disponibile.</p>'
          : `<div class="hm-riga"><span>${canale.mutoDiretto ? '🔴' : '🟢'}</span>
               <span>Ultimo battito del portale (database, Drive, posta, cassetta)</span>
               <span class="hint">${canale.diretto ? dataIt(canale.diretto.toISOString().slice(0, 10)) + ' · ' + Math.round(canale.oreDiretto) + ' ore fa' : 'mai'}</span></div>
             <div class="hm-riga"><span>${canale.mutoCassetta || canale.ferme ? '🔴' : '🟢'}</span>
               <span>Cassetta del portale (progetto Servizi): ritiro ogni 3 minuti</span>
               <span class="hint">${canale.giro ? 'ultimo giro ' + Math.round(canale.minGiro) + ' min fa' : 'mai'} · in attesa ${canale.inAttesa}${canale.ferme ? ' · <strong>ferme da oltre 15 min: ' + canale.ferme + '</strong>' : ''}</span></div>
             <div class="hm-riga"><span>${canale.senzaRiscontro ? '🔴' : '🟢'}</span>
               <span>Richieste partite ma non registrate</span>
               <span class="hm-mini">${canale.senzaRiscontro}</span></div>
             <p class="hint" style="margin-top:6px">Il battito lo scrive ogni notte un controllo automatico e lo rilegge
             l'import delle 6:30: serve a distinguere «nessuno ha inviato» da «il canale è rotto».</p>`)}

      ${card('🦺 Pratiche RLST aperte', (rlst || []).length,
        (rlst || []).length
          ? (rlst || []).slice(0, 6).map((p) => `
            <div class="hm-riga" data-goto="rlst"><span>🦺</span>
              <span><strong>n° ${esc(String(p.progressivo ?? p.id))}</strong> — ${esc(p.ragione_sociale || '?')}</span>
              <span class="hint">${esc(p.stato)}</span></div>`).join('')
          : '<p class="hint">Nessuna pratica aperta.</p>',
        vai('rlst', 'Apri le pratiche RLST'))}

      ${card('🗂️ Documenti dei tecnici', docScaduti.length + docInScadenza.length, `
        <p class="hint" style="margin:0 0 6px">Con data di fine passata o entro 60 giorni — <strong>fa fede la pagina</strong>
        (lì si vede anche il rinnovo tacito):</p>
        ${docScaduti.slice(0, 4).map((d) => `
          <div class="hm-riga" data-goto="doc-tecnici"><span>⛔</span>
            <span>${esc(d.persona_txt || '?')} — ${esc(d.descrizione || '')}</span>
            <span class="hint">${dataIt(d.data_fine)}</span></div>`).join('')}
        ${docInScadenza.slice(0, 4).map((d) => `
          <div class="hm-riga" data-goto="doc-tecnici"><span>⚠️</span>
            <span>${esc(d.persona_txt || '?')} — ${esc(d.descrizione || '')}</span>
            <span class="hint">${dataIt(d.data_fine)}</span></div>`).join('')}`,
        vai('doc-tecnici', 'Apri i documenti tecnici'))}

      ${card('📖 Formazione in corso', (corsi || []).length,
        (corsi || []).length
          ? (corsi || []).slice(0, 6).map((c) => `
            <div class="hm-riga" data-vista-corso="${c.id}"><span>📖</span>
              <span><strong>n° ${c.id}</strong> — ${esc((c.titolo || '').slice(0, 55))}</span>
              <span class="hint">${esc(c.stato)}${c.data_inizio ? ` · ${dataIt(c.data_inizio)}` : ''}</span></div>`).join('')
          : '<p class="hint">Nessun corso aperto.</p>',
        vai('corsi', 'Apri i corsi'))}

      ${card('💶 Incarichi e fatture tecnici', ftMesiAperti.length + ftDaLavorare.length + ftDaMandato + ftStandby + mandDaVedere + avvisiNonPartiti.length + avvisiApprNonPartiti.length, `
        ${ftMesiAperti.slice(0, 4).map((i) => `
          <div class="hm-riga" data-goto="fatture-tecnici"><span>📅</span>
            <span>Mese da chiudere: <strong>${esc(i.tecnico_nome || '?')}</strong> — ${['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'][i.mese - 1]} ${i.anno}</span>
            <span class="hint">incarico n° ${i.id}</span></div>`).join('')}
        ${ftMesiAperti.length > 4 ? `<p class="hint">…e altri ${ftMesiAperti.length - 4} mesi aperti.</p>` : ''}
        ${ftDaLavorare.slice(0, 4).map((f) => `
          <div class="hm-riga" data-vista="fatture-tecnici" data-id="${f.id}"><span>🧾</span>
            <span><strong>${esc(f.tecnico_nome || '?')}</strong> — fattura n° ${esc(f.numero || '?')} · ${Number(f.importo || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €</span>
            <span class="hint">${esc(f.stato)}</span></div>`).join('')}
        <div class="hm-riga" data-goto="fatture-tecnici"><span>✅</span><span>Approvate dal coordinatore, da mettere in mandato</span><span class="hm-mini">${ftDaMandato}</span></div>
        ${ftStandby ? `<div class="hm-riga" data-goto="fatture-tecnici"><span>⏸</span><span>In stand-by (anomalia da risolvere col tecnico)</span><span class="hm-mini">${ftStandby}</span></div>` : ''}
        ${mandDaVedere ? `<div class="hm-riga" data-goto="amministrazione"><span>✍️</span><span>Mandati in attesa della presa visione dell'Amministrazione</span><span class="hm-mini">${mandDaVedere}</span></div>` : ''}
        ${avvisiApprNonPartiti.slice(0, 4).map((f) => `
          <div class="hm-riga" data-vista="fatture-tecnici" data-id="${f.id}" style="color:#a01f00"><span>✉️</span>
            <span>Verificata, <strong>avviso al coordinatore NON partito</strong>: ${esc(f.tecnico_nome || '?')} — fattura n° ${esc(f.numero || '?')}</span>
            <span class="hint" title="${esc(f.avviso_appr_esito || '')}">${esc((f.avviso_appr_esito || '').slice(0, 40))}</span></div>`).join('')}
        ${avvisiNonPartiti.slice(0, 4).map((f) => `
          <div class="hm-riga" data-vista="amministrazione" data-id="${f.mandato_id}" style="color:#a01f00"><span>📧</span>
            <span>Pagata, <strong>avviso al tecnico non partito</strong>: ${esc(f.tecnico_nome || '?')} — fattura n° ${esc(f.numero || '?')}</span>
            <span class="hint" title="${esc(f.avviso_pagamento_esito || '')}">${esc((f.avviso_pagamento_esito || 'in corso').slice(0, 40))}</span></div>`).join('')}`,
        vai('fatture-tecnici', 'Apri incarichi e fatture'))}

      ${flussi ? (() => {
        const mai = flussi.filter((x) => !x.casi);
        const usati = flussi.filter((x) => x.casi).sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
        const perArea = mai.reduce((m, x) => ((m[x.area] = m[x.area] || []).push(x), m), {});
        return card('🧪 Flussi mai usati', mai.length, `
          <p class="hint" style="margin:0 0 6px">Mai usati su un caso vero: vanno provati prima che servano,
            con un caso di prova da annullare subito dopo. Lo storico importato e gli annullati non contano.</p>
          ${Object.entries(perArea).map(([area, righe]) => `
            <div class="hm-riga"><span>⚪</span><span><strong>${esc(area)}</strong> — ${righe.map((x) => esc(x.flusso)).join(' · ')}</span><span class="hm-mini">${righe.length}</span></div>`).join('')}
          ${usati.length ? `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">Già usati (${usati.length})</summary>
            ${usati.map((x) => `
              <div class="hm-riga"><span>🟢</span><span>${esc(x.flusso)} <span class="hint">(${esc(x.area)})</span></span>
                <span class="hint">${x.casi} ${x.casi === 1 ? 'caso' : 'casi'} · ultimo ${dataIt(x.ultimo)}</span></div>`).join('')}
          </details>` : ''}`);
      })() : ''}

      ${card('📚 Ultimi protocolli', '', `
        ${(prot || []).map((r) => `
          <div class="hm-riga" data-goto="registro"><span>${r.direzione === 'IN' ? '📥' : '📤'}</span>
            <span><strong>${esc(codiceProtocollo(r))}</strong> — ${esc((r.oggetto || '').slice(0, 60))}</span>
            <span class="hint">${dataIt(r.data_prot)}</span></div>`).join('')}`,
        vai('registro', 'Apri il registro'))}
      ${cardBacheca ? cardBacheca.agenda + cardBacheca.posta : ''}
    </div>
    <p class="hint" style="margin-top:12px">Il cruscotto conta le righe delle tabelle, non tiene una lista sua:
      un click porta sempre sulla pratica vera. Le pratiche chiuse e scartate non compaiono.</p>`;

  /* «Aggiorna adesso» della card Posta e agenda: rilancia bacheca-giornata e ridisegna.
     La funzione non onora input e scrive solo le sue tabelle: un clic in più non fa danni. */
  host.querySelectorAll('.hm-bacheca-aggiorna').forEach((btn) => btn.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = '⏳ Leggo posta e agenda…';
    const { data, error } = await sb.functions.invoke('bacheca-giornata', { body: {} });
    if (error) { b.disabled = false; b.textContent = '🔄 Aggiorna adesso'; return toast('Aggiornamento non riuscito: ' + error.message, 'err'); }
    const err = data?.errori?.length ? ` (${data.errori.length} avvisi)` : '';
    toast(`Aggiornata: ${data?.scritte_mail ?? 0} mail, ${data?.scritti_eventi ?? 0} eventi${err}.`, 'ok');
    render();
  }));

  host.querySelectorAll('.hm-riga[data-vista]').forEach((r) =>
    r.addEventListener('click', () => apriPratica(r.dataset.vista, Number(r.dataset.id))));
  host.querySelectorAll('[data-vista-inc]').forEach((a) =>
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      apriPratica(a.dataset.vistaInc, Number(a.dataset.idInc));
    }));
  host.querySelectorAll('[data-riassegna]').forEach((b) =>
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (await riassegnaIncarico(Number(b.dataset.riassegna), praticaDi[Number(b.dataset.riassegna)] || null)) render();
    }));
  host.querySelectorAll('[data-critico]').forEach((r) =>
    r.addEventListener('click', async () => (await import('./cantieri-critici.js')).dettaglio(Number(r.dataset.critico), render)));
  host.querySelector('#hm-critici-tutti')?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    (await import('./cantieri-critici.js')).elenco(render);
  });
  /* dal cruscotto al questionario: «apri-pratica» va alla vista, la disegna e
     apre la riga — lo stesso giro delle altre card */
  host.querySelectorAll('[data-questionario]').forEach((r) =>
    r.addEventListener('click', () => apriPratica('questionari', Number(r.dataset.questionario))));
  /* l'iscrizione si guarda nella scheda del corso: e' li' che sta
     l'istruttoria, e non ha senso duplicarla qui */
  host.querySelectorAll('[data-iscrizione]').forEach((r) =>
    r.addEventListener('click', () => {
      const id = Number(r.dataset.iscrizione);
      if (id) apriPratica('corsi', id);
    }));
  host.querySelectorAll('[data-vista-corso]').forEach((r) =>
    r.addEventListener('click', async () => {
      document.dispatchEvent(new CustomEvent('apri-pratica', { detail: { vista: 'corsi', id: Number(r.dataset.vistaCorso) } }));
    }));
}

/* ── RIASSEGNARE UN INCARICO RIFIUTATO (04/09/2026) ──
   Si azzera tutto quel che il tecnico precedente aveva dichiarato:
   il nuovo deve poter prendere visione, accettare o rifiutare a sua
   volta, altrimenti erediterebbe un rifiuto che non e' suo.
   Dall'08/09/2026 il lavoro lo fa `riassegnaTecnico` in
   incarico-tecnico.js (lo stesso delle viste dei servizi): aggiorna
   anche la pratica collegata, se si sa qual è, e prepara le due
   bozze mail — avviso al precedente, assegnazione al nuovo. */
export async function riassegnaIncarico(id, praticaRif = null) {
  const { data: tec } = await sb.from('tecnici')
    .select('tecnico_nome, tecnico_cognome, email').eq('attivo', true)
    .not('email', 'is', null).order('tecnico_cognome');
  const lista = (tec || []).filter((x) => x.email);
  if (!lista.length) { alert('Nessun tecnico attivo con email in anagrafica.'); return false; }
  const scelta = prompt(`A chi riassegno l'incarico n° ${id}?\n\n`
    + lista.map((x, i) => `${i + 1}) ${[x.tecnico_nome, x.tecnico_cognome].filter(Boolean).join(' ')}`).join('\n')
    + '\n\nScrivi il numero:');
  if (scelta === null) return false;
  const x = lista[parseInt(scelta, 10) - 1];
  if (!x) { alert('Numero non valido.'); return false; }

  /* la pratica dei servizi collegata, per aggiornarla insieme */
  const TABELLA = { segnalazioni: 's_segnalazioni', visite: 's_visite_richieste',
    conferenze: 's_conferenze_cantiere', consulenze: 's_consulenze' };
  let tabella = null, pratica = null;
  if (praticaRif && TABELLA[praticaRif.vista]) {
    tabella = TABELLA[praticaRif.vista];
    const { data } = await sb.from(tabella).select('*').eq('id', praticaRif.id).maybeSingle();
    pratica = data || null;
    if (!pratica) tabella = null;
  }
  const { riassegnaTecnico } = await import('./incarico-tecnico.js');
  return riassegnaTecnico({ incaricoId: id, tabella, pratica, nuovoEmail: x.email });
}
