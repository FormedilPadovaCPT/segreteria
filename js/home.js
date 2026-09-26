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

  const [servizi, { data: rlst, error: eRlst }, { data: docTecTutti, error: eDoc }, { data: corsi, error: eCorsi }, { data: prot, error: eProt }, { data: tecAttivi, error: eTec }, { data: docReq, error: eReq }] = await Promise.all([
    Promise.all(SERVIZI.map(async (s) => {
      /* le chiuse restano sul server (26/09/2026: sul telefono il cruscotto era lento); una riga senza stato passa, come prima */
      const { data, error } = await sb.from(s.tab).select('*').or(`stato.is.null,stato.not.in.(${CHIUSE.map((c) => `"${c}"`).join(',')})`).order('id', { ascending: false }).limit(400);
      return { ...s, errore: !!error, righe: (data || []).filter((p) => !CHIUSE.includes(p.stato)) };
    })),
    sb.from('s_rlst_pratiche').select('id, progressivo, ragione_sociale, stato, timestamp_modulo').neq('stato', 'chiusa'),
    /* documenti dei tecnici (26/09/2026): tutti, per calcolare lo stato
       con la stessa regola della loro pagina — prima si contava ogni riga
       con data passata, e i contratti superati da quelli nuovi tenevano il
       numero a 40 per sempre */
    sb.from('s_doc_tecnico').select('*'),
    sb.from('s_corsi').select('id, titolo, tipo, stato, data_inizio').not('stato', 'in', '("chiuso","annullato")'),
    sb.from('s_protocollo').select('*').order('id', { ascending: false }).limit(6),
    sb.from('tecnici').select('tecnico_id, tecnico_cognome, tecnico_nome, email, attivo, asseveratore, dipendente').eq('attivo', true),
    sb.from('s_doc_requisito').select('*').eq('attivo', true).order('ordine'),
  ]);
  /* le letture non riuscite (26/09/2026): una tessera che non ha letto non
     è «a posto» — finisce fra le pastiglie in rosso, «non letto» */
  const nonLetti = new Set();
  if (eRlst) nonLetti.add('rlst');
  if (eCorsi) nonLetti.add('corsi');
  if (eDoc || eTec || eReq) nonLetti.add('doc');
  /* un servizio non letto: i mucchi comuni (Direttore, da eseguire) sono
     incompleti, e la tessera del singolo servizio pure (26/09/2026) */
  for (const s of servizi) if (s.errore) { nonLetti.add('servizi'); nonLetti.add('serv-' + s.vista); }
  const aPosto = [];
  const aiutoDi = (k) => (k && (window.AIUTO_TESTI || {})['hm-' + k]) || '';

  /* ── posta e agenda (08/09/2026): quello che bacheca-giornata ha letto
     alle 8 dalle caselle e dai calendari dell'ufficio. Solo intestazioni
     e anteprima: la mail si apre in Gmail. ─────────────────────────── */
  let bacheca = null;
  const pBacheca = (async () => { try {
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
  } catch { /* senza il ruolo segreteria la card non compare */ } })();

  /* ── flussi mai usati (17/09/2026): quante volte ogni flusso ha lavorato su
     un caso vero. Serve a provarli prima che arrivi il primo caso: chi lo
     usa fra tre mesi non ricorda come funziona. Il conto lo fa il database
     (s_flussi_uso), che esclude lo storico importato e gli annullati. ── */
  let flussi = null;
  const pFlussi = (async () => { try {
    const { data, error } = await sb.rpc('s_flussi_uso');
    if (!error) flussi = data || [];
  } catch { /* senza il ruolo segreteria la card non compare */ } })();

  /* ── formazione mancante dai verbali (25/09/2026): le segnalazioni partite
     all'ufficio corsi di cui non si è ancora registrato l'esito, e lo stato
     del calendario corsi (se sta per finire, la segreteria deve importare la
     programmazione nuova: senza date la mail all'impresa non propone niente) ── */
  let formSegn = [], formStato = null, formErr = null;
  const pForm = (async () => { try {
    const [{ data: fs, error: e1 }, { data: st, error: e2 }] = await Promise.all([
      sb.from('s_formazione_segnalazioni').select('id, created_at, impresa_nome, partita_iva, ceiv, tipi, nota, stato, tecnico_nome, nr_verbale, email, telefono, referente, mail_esito').in('stato', ['inviata', 'contattata']).order('created_at', { ascending: false }).limit(40),
      sb.rpc('formazione_programmazione_stato'),
    ]);
    if (e1) formErr = e1.message; else formSegn = fs || [];
    if (!e2) formStato = st;
  } catch (e) { formErr = e?.message || String(e); } })();

  /* ── stato del canale del portale servizi (04/09/2026, rifatto il 13/09/2026) ──
     Un canale senza richieste nuove e' ambiguo: puo' voler dire che non ha
     scritto nessuno, o che il tubo e' rotto (incidente di agosto: Apps Script
     morto da cinque settimane e in ufficio non si poteva sapere). Dal 13/09/2026
     foglio Google e Apps Script sono spenti: restano il battito della funzione
     portale-richieste e il giro della cassetta delle lettere sul progetto Servizi. */
  let canale = null;
  const pCanale = (async () => { try {
    const [{ data: cfg, error: eCfg }, { count: senzaRiscontro, error: eRisc }] = await Promise.all([
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
      /* lettura fallita: il canale non si dichiara sano (26/09/2026) */
      nonLetto: !!(eCfg || eRisc),
      senzaRiscontro: senzaRiscontro || 0,
      mutoDiretto: oreDiretto === null || oreDiretto > limite,
      mutoCassetta: minGiro === null || minGiro > 15,
      ferme: Number(cassetta?.ferme_oltre_15_min) || 0,
      inAttesa: Number(cassetta?.totali) || 0,
    };
  } catch (e) {
    /* la tabella o le chiavi non ci sono ancora: si tace, non si inventa */
    console.warn('stato canale portale non disponibile:', e.message);
  } })();

  /* le visite ESEGUITE dai tecnici (gestionale): la chiusura arriva qui,
     poi la segreteria decide se e a chi comunicare (deciso 01/09/2026) */
  let eseguiti = [];
  let rifiutati = [];
  /* cantieri critici (17/09/2026): gli accessi negati segnalati dal tecnico
     nel gestionale e le proposte di segnalazione a SPISAL / ITL spuntate nei
     verbali. Un registro solo, gestito da segreteria e coordinatore */
  let critici = [];
  let ccMod = null;
  const pCritici = (async () => { try { ccMod = await import('./cantieri-critici.js'); critici = await ccMod.aperti(); } catch { nonLetti.add('critici'); } })();
  /* questionari sul sopralluogo (18/09/2026): da quando l'invito parte dalla
     mail del verbale le risposte arrivano davvero, e vanno guardate — un
     giudizio basso invecchia male, e chi ha chiesto di essere richiamato
     aspetta */
  let questionari = [];
  let qsMod = null;
  const pQuest = (async () => { try { qsMod = await import('./questionari.js'); questionari = await qsMod.daLavorare(); } catch { nonLetti.add('questionari'); } })();
  /* iscrizioni arrivate dal portale (18/09/2026): sono richieste, non
     iscritti, e finche' restano in coda OCCUPANO IL POSTO nel conteggio dei
     liberi — un evento puo' sembrare pieno solo perche' nessuno le ha
     guardate. Per questo stanno qui e non solo dentro la scheda del corso. */
  let iscrizioni = [];
  const pIscr = (async () => { try {
    const { data, error } = await sb.from('s_iscrizioni')
      .select('id, corso_id, stato, per_conto, ragione_sociale, persone, email, creato_il, timestamp_modulo, esito_ceiv')
      .in('stato', ['nuova', 'in_attesa']).order('id', { ascending: false }).limit(30);
    if (error) nonLetti.add('iscrizioni');
    iscrizioni = data || [];
  } catch { nonLetti.add('iscrizioni'); } })();
  const praticaDi = {};
  const pEseguiti = (async () => { try {
    const { data, error: eEs } = await sb.from('incarichi')
      .select('id, tipo_richiesta, impresa, comune, tecnico_nome, visita_id, eseguito_il, data_richiesta')
      .eq('stato', 'eseguito').order('eseguito_il', { ascending: false }).limit(30);
    if (eEs) nonLetti.add('incarichi');
    eseguiti = data || [];
    /* il tecnico che non puo' prendere una visita lo dichiara motivando
       (04/09/2026): il rifiuto vive nel gestionale, ma a doverci fare
       qualcosa e' la segreteria, quindi si vede qui */
    const { data: rif, error: eRif } = await sb.from('incarichi')
      .select('id, tipo_richiesta, impresa, comune, indirizzo, tecnico_nome, rifiutato_il, rifiuto_motivo')
      .not('rifiutato_il', 'is', null).eq('stato', 'aperto')
      .order('rifiutato_il', { ascending: false });
    if (eRif) nonLetti.add('incarichi');
    rifiutati = rif || [];
    const ids = [...eseguiti.map((r) => r.id), ...rifiutati.map((r) => r.id)];
    if (ids.length) {
      await Promise.all([['s_segnalazioni', 'segnalazioni'], ['s_visite_richieste', 'visite'],
        ['s_conferenze_cantiere', 'conferenze'], ['s_consulenze', 'consulenze']].map(async ([tab, vista]) => {
        const { data: pr } = await sb.from(tab).select('id, incarico_id').in('incarico_id', ids);
        for (const r of pr || []) praticaDi[r.incarico_id] = { vista, id: r.id };
      }));
    }
  } catch { nonLetti.add('incarichi'); } })();
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
  const pFatture = (async () => { try {
    const meseCorr = oggi.slice(0, 7);
    const [{ data: im, error: eIm }, { data: ft, error: eFt }] = await Promise.all([
      /* tutti i mesi aperti, anche di chi non è più attivo: quello che è
         ancora da pagare si deve vedere (26/09/2026, l'utente) */
      sb.from('s_incarichi_mensili').select('id, tecnico_nome, anno, mese, stato').eq('stato', 'aperto').order('anno').order('mese').limit(200),
      sb.from('s_fatture_tecnici').select('id, tecnico_nome, numero, importo, stato, data_ricevimento, avviso_appr_il, avviso_appr_esito').in('stato', ['ricevuta', 'verificata', 'approvata', 'standby']).order('id', { ascending: false }).limit(100),
    ]);
    if (eIm || eFt) nonLetti.add('fatture');
    ftMesiAperti = (im || []).filter((i) => `${i.anno}-${String(i.mese).padStart(2, '0')}` < meseCorr);
    ftDaLavorare = (ft || []).filter((f) => ['ricevuta', 'verificata'].includes(f.stato));
    ftDaMandato = (ft || []).filter((f) => f.stato === 'approvata').length;
    ftStandby = (ft || []).filter((f) => f.stato === 'standby').length;
    avvisiApprNonPartiti = (ft || []).filter((f) => ['ricevuta', 'verificata'].includes(f.stato) && !f.avviso_appr_il && f.avviso_appr_esito);
    const [{ count: nv, error: eNv }, { data: av, error: eAv }] = await Promise.all([
      sb.from('s_mandati_pagamento').select('id', { count: 'exact', head: true }).is('visto_il', null),
      sb.from('s_fatture_tecnici').select('id, tecnico_nome, numero, mandato_id, avviso_pagamento_esito')
        .eq('stato', 'pagata').not('pagata_il', 'is', null).not('mandato_id', 'is', null).is('avviso_pagamento_il', null).limit(50),
    ]);
    if (eNv || eAv) nonLetti.add('fatture');
    mandDaVedere = nv || 0;
    avvisiNonPartiti = av || [];
  } catch { nonLetti.add('fatture'); } })();

  /* 26/09/2026: le nove letture qui sopra sono indipendenti e partono insieme —
     prima erano una dopo l'altra, e sul telefono ogni giro di rete si sommava */
  await Promise.all([pBacheca, pFlussi, pForm, pCanale, pCritici, pQuest, pIscr, pEseguiti, pFatture]);

  /* documenti dei tecnici: lo stato si calcola come nella loro pagina —
     per ogni tecnico in griglia e ogni requisito conta il documento PIÙ
     RECENTE, col rinnovo tacito. I contratti superati non contano più. */
  const docProblemi = [];
  let docMancanti = 0, docMancantiTec = new Set();
  if (!nonLetti.has('doc')) {
    try {
      const { statoRequisito, fuoriGriglia } = await import('./documenti-tecnici.js');
      const visti = new Set();
      for (const t of (tecAttivi || []).filter((x) => !fuoriGriglia(x))) {
        const nome = `${t.tecnico_cognome || ''} ${t.tecnico_nome || ''}`.trim();
        if (visti.has(nome.toLowerCase())) continue;
        visti.add(nome.toLowerCase());
        for (const req of docReq || []) {
          const st = statoRequisito(t, req, docTecTutti || []);
          if (['scaduto', 'scade', 'senzadata'].includes(st.classe)) docProblemi.push({ nome, req: req.breve || req.descrizione, ...st });
          else if (st.classe === 'mancante') { docMancanti++; docMancantiTec.add(t.tecnico_cognome || nome); }
        }
      }
      docProblemi.sort((a, b) => String(a.scadenza || '').localeCompare(String(b.scadenza || '')));
    } catch (e) { console.warn('stato documenti tecnici non calcolato:', e.message); nonLetti.add('doc'); }
  }

  /* ── i tre mucchi che contano ── */
  const daAutorizzare = [];
  const daEseguire = [];
  for (const s of servizi) {
    for (const p of s.righe) {
      const riga = {
        vista: s.vista, id: p.id, icona: s.icona, nome: s.nome,
        chi: s.chi(p) || '?', quando: p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10) : null,
        n: p.progressivo ?? `m${p.id}`, incarico_id: p.incarico_id || null,
      };
      if (['da_richiedere', 'richiesta'].includes(p.aut_stato)) daAutorizzare.push(riga);
      else if (p.aut_stato === 'approvata' && !['svolta'].includes(p.stato)) daEseguire.push(riga);
    }
  }
  daAutorizzare.sort((a, b) => String(a.quando || '').localeCompare(String(b.quando || '')));

  /* dopo l'autorizzazione il passo che conta e' il tecnico (24/09/2026,
     chiesto dall'utente sulla consulenza Noventa): l'incarico l'ha visto?
     l'ha accettato? Si legge dal gestionale, riga per riga */
  const incDi = {};
  const idsInc = daEseguire.map((r) => r.incarico_id).filter(Boolean);
  if (idsInc.length) {
    const { data, error } = await sb.from('incarichi')
      .select('id, stato, tecnico_nome, presa_visione_il, accettato_il, rifiutato_il, rifiuto_motivo, eseguito_il')
      .in('id', idsInc);
    if (error) console.warn('stato incarichi non letto:', error.message);
    for (const i of data || []) incDi[i.id] = i;
    for (const r of daEseguire) if (r.incarico_id && !incDi[r.incarico_id]) incDi[r.incarico_id] = error ? 'errore' : null;
  }
  /* il passo del tecnico è una pastiglia colorata, non una nota grigia
     (26/09/2026): è il fatto che conta della riga */
  const pastiglia = (tipo, html) => `<span class="hm-passo hm-passo-${tipo}">${html}</span>`;
  const passoTecnico = (r) => {
    if (!r.incarico_id) return pastiglia('fare', '📨 incarico al tecnico da preparare');
    const i = incDi[r.incarico_id];
    if (i === 'errore') return pastiglia('err', `incarico n° ${r.incarico_id} — non sono riuscito a leggerne lo stato`);
    if (!i) return pastiglia('err', `incarico n° ${r.incarico_id} non trovato nel gestionale`);
    const chi = esc(i.tecnico_nome || 'il tecnico');
    if (i.eseguito_il || i.stato === 'eseguito') return pastiglia('ok', `🔧 eseguito da ${chi}`);
    if (i.rifiutato_il) return pastiglia('err', `<strong>❌ rifiutato da ${chi}</strong>${i.rifiuto_motivo ? ' — ' + esc(i.rifiuto_motivo) : ''}`);
    if (i.accettato_il) return pastiglia('ok', `✅ accettato da ${chi} il ${dataIt(String(i.accettato_il).slice(0, 10))}`);
    if (i.presa_visione_il) return pastiglia('attesa', `👁 visto da ${chi}, non ancora accettato`);
    return pastiglia('fermo', `⏳ ${chi} non l'ha ancora aperto`);
  };
  /* i giorni di attesa (26/09/2026): da quando la richiesta è arrivata.
     Oltre SOGLIA_GG la cifra è rossa; nessun altro giudizio di urgenza */
  const SOGLIA_GG = 60;
  const attesa = (q) => {
    if (!q) return '';
    const g = Math.floor((new Date(oggi) - new Date(q)) / 864e5);
    return g >= 0 ? ` <span class="hm-gg${g > SOGLIA_GG ? ' hm-gg-fermo' : ''}" data-aiuto="${esc(aiutoDi('giorni'))}">${g} gg</span>` : '';
  };
  const rigaEseguire = (r) => `
    <div class="hm-riga" data-vista="${r.vista}" data-id="${r.id}">
      <span>${r.icona}</span>
      <span><strong>${esc(r.nome)} n° ${esc(String(r.n))}</strong> — ${esc(r.chi)}
        <br>${passoTecnico(r)}</span>
      <span class="hint">${r.quando ? dataIt(r.quando) + attesa(r.quando) : ''}</span>
    </div>`;

  /* segnalazioni aperte: hanno anche il loro riquadro, oltre ai mucchi
     autorizzativi comuni (chiesto dall'utente il 01/09) */
  const segnalazioni = servizi.find((s) => s.vista === 'segnalazioni').righe;

  /* consulenze in corsia immediata: il giro segreteria→coordinatore→impresa */
  const cons = servizi.find((s) => s.vista === 'consulenze').righe;
  /* solo la corsia immediata: quelle con uscita stanno fra le autorizzazioni
     (Noventa 24/09/2026 era contata qui come «risposta da trasmettere») */
  const consImm = cons.filter((p) => p.corsia !== 'uscita');
  const consDaGirare = consImm.filter((p) => !p.girata_il && !p.risposta);
  const consInAttesa = consImm.filter((p) => p.girata_il && !p.risposta);
  const consDaTrasmettere = consImm.filter((p) => p.risposta && !p.trasmessa_il);


  const rigaPratica = (r) => `
    <div class="hm-riga" data-vista="${r.vista}" data-id="${r.id}">
      <span>${r.icona}</span>
      <span><strong>${esc(r.nome)} n° ${esc(String(r.n))}</strong> — ${esc(r.chi)}</span>
      <span class="hint">${r.quando ? dataIt(r.quando) + attesa(r.quando) : ''}</span>
    </div>`;

  /* Le tessere a zero non occupano posto (26/09/2026, veste «Solo ciò che
     c'è» scelta dall'utente): diventano pastiglie nella riga «A posto» in
     testa, e un clic apre la loro pagina. Una tessera che NON è riuscita a
     leggere non è a posto: la sua pastiglia è rossa e dice «non letto».
     Opzioni: k = chiave della nuvoletta (hm-<k> in aiuto.js), goto = vista
     da aprire dalla pastiglia, id = id della pastiglia, segno = cosa
     scrivere al posto dello 0, aiuto = nuvoletta della pastiglia al posto di
     quella di k, sempre = tessera anche a zero (quando dentro c'è un
     messaggio da leggere), nonLetto = lettura fallita. */
  const card = (titolo, conteggio, corpo, azione = '', o = {}) => {
    if (o.nonLetto || (conteggio === 0 && !o.sempre)) {
      aPosto.push({ titolo, nonLetto: !!o.nonLetto, goto: o.goto, id: o.id, segno: o.segno,
        aiuto: o.nonLetto ? aiutoDi('non-letto') : (o.aiuto || aiutoDi(o.k)) });
      return '';
    }
    const aiuto = aiutoDi(o.k);
    return `
    <div class="hm-card">
      <div class="hm-testa"><h3${aiuto ? ` data-aiuto="${esc(aiuto)}"` : ''}>${titolo}</h3><span class="hm-n ${conteggio ? 'hm-n-attivo' : ''}">${conteggio}</span></div>
      ${corpo}${azione}
    </div>`;
  };
  const striscia = () => {
    if (!aPosto.length) return '';
    const pill = (z) => {
      const tag = z.goto || z.id ? 'button' : 'span';
      return `<${tag}${tag === 'button' ? ' type="button"' : ''} class="hm-zero${z.nonLetto ? ' hm-zero-err' : ''}"${z.goto ? ` data-goto="${z.goto}"` : ''}${z.id ? ` id="${z.id}"` : ''}${z.aiuto ? ` data-aiuto="${esc(z.aiuto)}"` : ''}>${z.titolo}<i>${z.nonLetto ? 'non letto' : esc(z.segno || '0')}</i></${tag}>`;
    };
    const ko = aPosto.filter((z) => z.nonLetto), ok = aPosto.filter((z) => !z.nonLetto);
    return `<div class="hm-aposto">
      ${ko.length ? `<em class="hm-aposto-err" data-aiuto="${esc(aiutoDi('non-letto'))}">⚠ Non letti</em>${ko.map(pill).join('')}` : ''}
      ${ok.length ? `<em data-aiuto="${esc(aiutoDi('aposto'))}">✓ A posto</em>${ok.map(pill).join('')}` : ''}
    </div>`;
  };

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

  /* ── i verbali tornati indietro (21/09/2026) ──
     Il rapporto di mancata consegna arriva alla casella dell'ufficio e lo
     vedrebbe una persona sola: qui si vede da solo, insieme alla posta. */
  let respinte = [], respinteErr = false;
  try {
    const { data, error } = await sb.from('s_mail_respinte')
      .select('id, ricevuta_il, destinatario, codice, permanente, motivo, nr_verbale, tecnico_email, ruolo, impresa_nome, stato, avviso_il, avviso_esito')
      .in('stato', ['nuova', 'avvisato']).order('ricevuta_il', { ascending: false }).limit(40);
    /* lettura fallita ≠ «nessun verbale respinto»: pastiglia «non letto» */
    if (error) respinteErr = true;
    respinte = data || [];
  } catch { respinteErr = true; }

  /* ── proposte di chiusura dei cantieri (23/09/2026) ──
     Il tecnico le fa dal gestionale; decide la segreteria. Un errore di
     lettura non è «nessuna proposta»: si dice nella card. */
  let propChius = [], propChiusErr = null;
  try {
    const { data, error } = await sb.from('cantieri_proposte_chiusura')
      .select('id, cantiere_id, proposta_da, proposta_nome, proposta_il, motivo, cantieri(cantiere_etichetta, cantiere_indirizzo, cantiere_civico, comune_nome)')
      .is('esito', null).order('proposta_il').limit(200);
    if (error) propChiusErr = error.message;
    propChius = data || [];
  } catch (e) { propChiusErr = e.message || String(e); }
  const lblCant = (p) => {
    const c = p.cantieri || {};
    return c.cantiere_etichetta || `${c.cantiere_indirizzo || ''} ${c.cantiere_civico || ''}`.trim() || p.cantiere_id;
  };

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
      (eventiHtml || '<p class="hint">Nessun evento nei prossimi giorni.</p>') + piede, '', { k: 'agenda' });
    const posta = card('✉️ Posta da guardare', nImp,
      (mailHtml || '<p class="hint">Nessuna mail segnata come importante nell\'ultimo giro.</p>')
      + errori + piede, '', { k: 'posta', sempre: !!errori });
    return { agenda, posta };
  })();

  /* ⚠️ Un rimbalzo NON dice quale sia l'indirizzo giusto: dice che quello
     non ha accettato la mail. Lo corregge il tecnico, che sa chi ha
     incontrato in cantiere — qui si vede e si chiude, non si sistema. */
  const cardRespinte = respinteErr ? card('📭 Verbali non consegnati', 0, '', '', { k: 'respinte', nonLetto: true })
    : !respinte.length ? '' : card('📭 Verbali non consegnati', respinte.length, `
    ${respinte.slice(0, 8).map((r) => `
      <div class="hm-riga" data-respinta="${r.id}" title="${esc(r.motivo || '')}">
        <span>${r.permanente === false ? '🕒' : '📭'}</span>
        <span><strong>${esc(r.destinatario || '')}</strong>${r.ruolo ? ` <span class="hint">(${esc(r.ruolo)})</span>` : ''}
          <span class="hint" style="display:block;white-space:normal">${r.nr_verbale ? `verbale ${esc(r.nr_verbale)}` : 'senza verbale agganciato'}${r.impresa_nome ? ` · ${esc(r.impresa_nome)}` : ''}${r.tecnico_email ? ` · ${esc(r.tecnico_email.split('@')[0])}` : ' · nessun tecnico'}${r.codice ? ` · ${esc(r.codice)}` : ''}</span></span>
        <span class="hint" style="text-align:right">${r.ricevuta_il ? dataIt(String(r.ricevuta_il).slice(0, 10)) : ''}<br>
          ${r.stato === 'avvisato' ? '<span class="hm-mini">tecnico avvisato</span>' : r.tecnico_email ? '<span class="hm-mini" style="color:#a01f00">da avvisare</span>' : '<span class="hm-mini">da guardare</span>'}</span>
      </div>`).join('')}
    ${respinte.length > 8 ? `<p class="hint">…e altri ${respinte.length - 8}.</p>` : ''}
    <div class="hint" style="margin-top:6px"><button class="btn btn-ghost btn-sm" id="hm-respinte-cerca" title="Rilegge adesso i rapporti di mancata consegna">🔄 Cerca adesso</button></div>`, '', { k: 'respinte' });

  /* l'avviso sulla programmazione corsi: compare solo quando serve */
  const bannerFormazione = (() => {
    if (!formStato) return '';
    const giorni = Number(formStato.avviso_giorni || 45);
    const ultima = formStato.ultima_data ? new Date(formStato.ultima_data) : null;
    const limite = new Date(Date.now() + giorni * 864e5);
    if (ultima && ultima > limite && Number(formStato.edizioni_future || 0) > 0) return '';
    const testo = !ultima ? 'nel calendario corsi non c\'è nessuna edizione'
      : ultima < new Date() ? `il calendario corsi è finito: l'ultima edizione era il ${dataIt(String(formStato.ultima_data))}`
      : `il calendario corsi finisce il ${dataIt(String(formStato.ultima_data))}, fra meno di ${giorni} giorni`;
    return `<div class="hm-banner" style="background:#fff3e0;border-left:4px solid #b35c00;padding:10px 14px;border-radius:8px;margin:0 0 12px;font-size:13px">
      <strong>🎓 Aggiorna la programmazione corsi:</strong> ${testo} (fonte «${esc(formStato.fonte || '—')}»). Senza date in calendario la mail del verbale non può proporre i corsi all'impresa. Chiedi all'ufficio corsi la programmazione nuova e importala con <code>_SISTEMA/scripts/importa_programmazione_corsi.py</code>.</div>`;
  })();
  const TIPI_ETI = { base: 'Base lavoratori', preposto: 'Preposto', primo_soccorso: 'Primo soccorso', antincendio: 'Antincendio', quota: 'Lavori in quota / DPI', ponteggi: 'Ponteggi', attrezzature: 'Macchine e attrezzature', confinati: 'Ambienti confinati', datore: 'Datore di lavoro / RSPP', rls: 'RLS' };
  const cardFormazione = card('🎓 Formazione mancante segnalata all\'ufficio corsi', formSegn.length, formErr
    ? `<p class="hint" style="color:#a01f00">Non sono riuscito a leggere le segnalazioni: ${esc(formErr)}</p>`
    : (formSegn.length ? formSegn.slice(0, 8).map((r) => `
      <div class="hm-riga" data-fseg="${r.id}">
        <span>${r.stato === 'contattata' ? '📞' : '📨'}</span>
        <span><strong>${esc(r.impresa_nome || '?')}</strong>${r.ceiv === 'si' ? ' <span class="hm-mini">CEIV</span>' : r.ceiv === 'no' ? ' <span class="hm-mini" style="color:#a01f00">non CEIV</span>' : ''}
          <span class="hint" style="display:block;white-space:normal">${esc((r.tipi || []).map((t) => TIPI_ETI[t] || t).join(', ') || '—')}${r.nota ? ` · «${esc(String(r.nota).slice(0, 80))}${String(r.nota).length > 80 ? '…' : ''}»` : ''}<br>${r.nr_verbale ? `verbale ${esc(r.nr_verbale)} · ` : ''}${esc(r.tecnico_nome || '')}${r.email ? ` · ${esc(r.email)}` : ''}${r.telefono ? ` · ${esc(r.telefono)}` : ''}</span></span>
        <span class="hint" style="text-align:right">${dataIt(String(r.created_at).slice(0, 10))}<br>
          <select data-fseg-stato="${r.id}" style="font-size:11px;padding:2px 4px" title="Registra com'è andata: lo dice l'ufficio corsi, tu lo scrivi qui">
            <option value="inviata" ${r.stato === 'inviata' ? 'selected' : ''}>inviata</option><option value="contattata" ${r.stato === 'contattata' ? 'selected' : ''}>contattata</option>
            <option value="iscritta">iscritta</option><option value="non_interessata">non interessata</option><option value="chiusa">chiusa</option></select></span>
      </div>`).join('') + (formSegn.length > 8 ? `<p class="hint">…e altre ${formSegn.length - 8}.</p>` : '')
      : '<p class="hint">Nessuna segnalazione in attesa di esito.</p>'), '', { k: 'formazione', sempre: !!formErr });

  const canaleOk = !!canale && !canale.nonLetto && !canale.mutoDiretto && !canale.senzaRiscontro && !canale.mutoCassetta && !canale.ferme;
  const griglia = `

      ${card('⏳ In attesa del Direttore', daAutorizzare.length,
        daAutorizzare.length
          ? daAutorizzare.slice(0, 8).map(rigaPratica).join('') + (daAutorizzare.length > 8 ? `<p class="hint">…e altre ${daAutorizzare.length - 8}.</p>` : '')
          : '<p class="hint">Nessuna pratica da autorizzare.</p>', '', { k: 'direttore', nonLetto: nonLetti.has('servizi') })}

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
            }).join('')
          : '<p class="hint">Nessun incarico rifiutato.</p>', '', { k: 'rifiutati', nonLetto: nonLetti.has('incarichi') })}

      ${card('📨 Cantieri proposti per la chiusura', propChius.length,
        propChiusErr
          ? `<p class="hint" style="color:#b91c1c">Non sono riuscito a leggere le proposte: ${esc(propChiusErr)}</p>`
          : propChius.length
            ? propChius.slice(0, 8).map((p) => `<div class="hm-riga">
                <span>📨</span>
                <span><strong>${esc(lblCant(p))}</strong>${p.cantieri?.comune_nome ? ` <span class="hint">· ${esc(p.cantieri.comune_nome)}</span>` : ''}
                  <span class="hint">(${esc(p.proposta_nome || p.proposta_da || '')}, ${dataIt(String(p.proposta_il).slice(0, 10))})</span>
                  <br><span class="hint">«${esc(p.motivo || '')}»</span></span>
                <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                  <button class="btn btn-sm" data-pc-chiudi="${p.id}">🔒 Chiudi cantiere</button>
                  <button class="btn btn-ghost btn-sm" data-pc-respingi="${p.id}">✖ Respingi proposta</button></span>
              </div>`).join('') + (propChius.length > 8 ? `<p class="hint">…e altre ${propChius.length - 8}.</p>` : '')
            : '<p class="hint">Nessuna proposta da decidere.</p>', '', { k: 'proposte', sempre: !!propChiusErr })}

      ${cardFormazione}

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
        + '<p class="hint" style="margin-top:6px">🚫 accesso negato · ⚠️ proposta di segnalazione a SPISAL / ITL dal verbale — <a href="#" id="hm-critici-tutti">tutti i casi, anche chiusi, e nuovo caso</a></p>', '', { k: 'critici', id: 'hm-critici-tutti', nonLetto: nonLetti.has('critici') })}

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
          + `<p class="hint" style="margin-top:6px">${bassi.length ? `🔻 ${bassi.length} con voto basso · ` : ''}${contatti.length ? `📞 ${contatti.length} da richiamare · ` : ''}<a href="#" data-goto="questionari">tutti i questionari</a></p>`, '', { k: 'questionari', goto: 'questionari', nonLetto: nonLetti.has('questionari') });
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
              <strong>occupano il posto</strong>: il portale mostra meno posti liberi di quanti ce ne siano davvero.</p>` : ''), '', { k: 'iscrizioni', goto: 'corsi', nonLetto: nonLetti.has('iscrizioni') });
      })()}

      ${card('✅ Autorizzate — da eseguire', daEseguire.length,
        daEseguire.length
          ? daEseguire.slice(0, 8).map(rigaEseguire).join('') + (daEseguire.length > 8 ? `<p class="hint">…e altre ${daEseguire.length - 8}.</p>` : '')
          : '<p class="hint">Niente in coda: le autorizzate sono state svolte.</p>', '', { k: 'eseguire', nonLetto: nonLetti.has('servizi') })}

      ${card('💬 Consulenze — corsia immediata', consDaGirare.length + consInAttesa.length + consDaTrasmettere.length, `
        <div class="hm-riga" data-goto="consulenze"><span>📨</span><span>Da girare al coordinatore</span><span class="hm-mini">${consDaGirare.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>⏱</span><span>In attesa della risposta del coordinatore</span><span class="hm-mini">${consInAttesa.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>📤</span><span>Risposta pronta, da trasmettere all'impresa</span><span class="hm-mini">${consDaTrasmettere.length}</span></div>`,
        vai('consulenze', 'Apri le consulenze'), { k: 'consulenze', goto: 'consulenze', nonLetto: nonLetti.has('serv-consulenze') })}

      ${card('🚨 Segnalazioni cantiere', segnalazioni.length,
        segnalazioni.length
          ? segnalazioni.slice(0, 6).map((p) => `
            <div class="hm-riga" data-vista="segnalazioni" data-id="${p.id}"><span>🚨</span>
              <span><strong>n° ${esc(String(p.progressivo ?? `m${p.id}`))}</strong> — ${esc(p.notificante || '?')}${p.comune_cantiere ? ` · ${esc(p.comune_cantiere)}` : ''}</span>
              <span class="hint">${esc(p.stato)}${['da_richiedere', 'richiesta'].includes(p.aut_stato) ? ' · dal Direttore' : ''}</span></div>`).join('')
          : '<p class="hint">Nessuna segnalazione aperta.</p>',
        vai('segnalazioni', 'Apri le segnalazioni'), { k: 'segnalazioni', goto: 'segnalazioni', nonLetto: nonLetti.has('serv-segnalazioni') })}

      ${card('🔧 Visite eseguite dai tecnici', eseguiti.length,
        eseguiti.length
          ? eseguiti.slice(0, 6).map((r) => {
              const pr = praticaDi[r.id];
              return `<div class="hm-riga" ${pr ? `data-vista="${pr.vista}" data-id="${pr.id}"` : 'data-goto="visite"'}><span>🔧</span>
                <span><strong>inc. ${r.id}</strong> — ${esc(r.impresa || r.comune || '?')}${r.visita_id ? ` · verbale ${esc(String(r.visita_id))}` : ''} <span class="hint">(${esc(r.tecnico_nome || '')})</span></span>
                <span class="hint">${r.eseguito_il ? dataIt(String(r.eseguito_il).slice(0, 10)) : ''}</span></div>`;
            }).join('')
          : '<p class="hint">Nessuna visita eseguita in attesa di chiusura.</p>', '', { k: 'eseguite', nonLetto: nonLetti.has('incarichi') })}

      ${card('📡 Canale portale servizi', canaleOk ? 0 : '!',
        !canale
          ? '<p class="hint">Stato non disponibile.</p>'
          : canale.nonLetto
          ? '<p class="hint" style="color:#a01f00">⚠ Non sono riuscito a leggere lo stato del canale: non si può dire che sia a posto.</p>'
          : `<div class="hm-riga"><span>${canale.mutoDiretto ? '🔴' : '🟢'}</span>
               <span>Ultimo battito del portale (database, Drive, posta, cassetta)</span>
               <span class="hint">${canale.diretto ? dataIt(canale.diretto.toISOString().slice(0, 10)) + ' · ' + Math.round(canale.oreDiretto) + ' ore fa' : 'mai'}</span></div>
             <div class="hm-riga"><span>${canale.mutoCassetta || canale.ferme ? '🔴' : '🟢'}</span>
               <span>Cassetta del portale (progetto Servizi): ritiro ogni 3 minuti</span>
               <span class="hint">${canale.giro ? 'ultimo giro ' + Math.round(canale.minGiro) + ' min fa' : 'mai'} · in attesa ${canale.inAttesa}${canale.ferme ? ' · <strong>ferme da oltre 15 min: ' + canale.ferme + '</strong>' : ''}</span></div>
             <div class="hm-riga"><span>${canale.senzaRiscontro ? '🔴' : '🟢'}</span>
               <span>Richieste partite ma non registrate</span>
               <span class="hm-mini">${canale.senzaRiscontro}</span></div>`,
        '', { k: 'canale', segno: '✓', aiuto: canaleOk ? `${aiutoDi('canale')} Ultimo battito ${Math.round(canale.oreDiretto)} ore fa; ultimo giro della cassetta ${Math.round(canale.minGiro)} minuti fa.` : '' })}

      ${card('🦺 Pratiche RLST aperte', (rlst || []).length,
        (rlst || []).length
          ? (rlst || []).slice(0, 6).map((p) => `
            <div class="hm-riga" data-goto="rlst"><span>🦺</span>
              <span><strong>n° ${esc(String(p.progressivo ?? p.id))}</strong> — ${esc(p.ragione_sociale || '?')}</span>
              <span class="hint">${esc(p.stato)}</span></div>`).join('')
          : '<p class="hint">Nessuna pratica aperta.</p>',
        vai('rlst', 'Apri le pratiche RLST'), { k: 'rlst', goto: 'rlst', nonLetto: nonLetti.has('rlst') })}

      ${card('🗂️ Documenti dei tecnici', docProblemi.length, `
        ${docProblemi.slice(0, 6).map((d) => `
          <div class="hm-riga" data-goto="doc-tecnici"><span>${d.classe === 'scaduto' ? '⛔' : '⚠️'}</span>
            <span><strong>${esc(d.nome)}</strong> — ${esc(d.req)}</span>
            <span class="hint">${d.classe === 'senzadata' ? 'senza data' : (d.classe === 'scaduto' ? 'scaduto il ' : 'scade il ') + dataIt(d.scadenza)}</span></div>`).join('')}
        ${docProblemi.length > 6 ? `<p class="hint">…e altri ${docProblemi.length - 6}.</p>` : ''}
        ${docMancanti ? `<div class="hm-riga" data-goto="doc-tecnici"><span>▫️</span>
            <span>Mai registrati nella pagina: ${docMancanti} document${docMancanti === 1 ? 'o' : 'i'} di ${docMancantiTec.size} tecnic${docMancantiTec.size === 1 ? 'o' : 'i'}</span>
            <span class="hm-mini">${docMancanti}</span></div>` : ''}`,
        vai('doc-tecnici', 'Apri i documenti tecnici'), { k: 'documenti', goto: 'doc-tecnici', sempre: docMancanti > 0, nonLetto: nonLetti.has('doc') })}

      ${card('📖 Formazione in corso', (corsi || []).length,
        (corsi || []).length
          ? (corsi || []).slice(0, 6).map((c) => `
            <div class="hm-riga" data-vista-corso="${c.id}"><span>📖</span>
              <span><strong>n° ${c.id}</strong> — ${esc((c.titolo || '').slice(0, 55))}</span>
              <span class="hint">${esc(c.stato)}${c.data_inizio ? ` · ${dataIt(c.data_inizio)}` : ''}</span></div>`).join('')
          : '<p class="hint">Nessun corso aperto.</p>',
        vai('corsi', 'Apri i corsi'), { k: 'corsi', goto: 'corsi', nonLetto: nonLetti.has('corsi') })}

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
        vai('fatture-tecnici', 'Apri incarichi e fatture'), { k: 'fatture', goto: 'fatture-tecnici', nonLetto: nonLetti.has('fatture') })}

      ${flussi ? (() => {
        const mai = flussi.filter((x) => !x.casi);
        const usati = flussi.filter((x) => x.casi).sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
        const perArea = mai.reduce((m, x) => ((m[x.area] = m[x.area] || []).push(x), m), {});
        return card('🧪 Flussi mai usati', mai.length, `
          ${Object.entries(perArea).map(([area, righe]) => `
            <div class="hm-riga"><span>⚪</span><span><strong>${esc(area)}</strong> — ${righe.map((x) => esc(x.flusso)).join(' · ')}</span><span class="hm-mini">${righe.length}</span></div>`).join('')}
          ${usati.length ? `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">Già usati (${usati.length})</summary>
            ${usati.map((x) => `
              <div class="hm-riga"><span>🟢</span><span>${esc(x.flusso)} <span class="hint">(${esc(x.area)})</span></span>
                <span class="hint">${x.casi} ${x.casi === 1 ? 'caso' : 'casi'} · ultimo ${dataIt(x.ultimo)}</span></div>`).join('')}
          </details>` : ''}`, '', { k: 'flussi' });
      })() : ''}

      ${card('📚 Ultimi protocolli', '', `
        ${(prot || []).map((r) => `
          <div class="hm-riga" data-goto="registro"><span>${r.direzione === 'IN' ? '📥' : '📤'}</span>
            <span><strong>${esc(codiceProtocollo(r))}</strong> — ${esc((r.oggetto || '').slice(0, 60))}</span>
            <span class="hint">${dataIt(r.data_prot)}</span></div>`).join('')}
        ${eProt ? '<p class="hint" style="color:#a01f00">⚠ Non sono riuscito a leggere gli ultimi protocolli.</p>' : ''}`,
        vai('registro', 'Apri il registro'))}
      ${cardBacheca ? cardBacheca.agenda + cardBacheca.posta : ''}
      ${cardRespinte}`;
  host.innerHTML = `
    ${bannerCanale}${bannerFormazione}${striscia()}
    <div class="hm-griglia">${griglia}</div>`;

  /* «Aggiorna adesso» della card Posta e agenda: rilancia bacheca-giornata e ridisegna.
     La funzione non onora input e scrive solo le sue tabelle: un clic in più non fa danni. */
  host.querySelectorAll('.hm-bacheca-aggiorna').forEach((btn) => btn.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = '⏳ Leggo posta e agenda…';
    const { data, error } = await sb.functions.invoke('bacheca-giornata', { body: {} });
    if (error) { b.disabled = false; b.textContent = '🔄 Aggiorna adesso'; return toast('Aggiornamento non riuscito: ' + error.message, 'err'); }
    const err = data?.errori?.length ? ` (${data.errori.length} avvisi)` : '';
    const tolte = data?.tolte_mail ? `, ${data.tolte_mail} tolte perché eliminate in Gmail` : '';
    toast(`Aggiornata: ${data?.scritte_mail ?? 0} mail${tolte}, ${data?.scritti_eventi ?? 0} eventi${err}.`, 'ok');
    render();
  }));

  /* «Cerca adesso» dei verbali non consegnati: rilegge i rapporti di
     mancata consegna. È la stessa funzione del giro quotidiano, chiamata
     con l'accesso della segreteria: non scrive altro e non manda mail
     che non manderebbe da sola. */
  /* formazione: l'esito del contatto (25/09/2026) */
  host.querySelectorAll('[data-fseg-stato]').forEach((sel) => sel.addEventListener('change', async () => {
    const id = Number(sel.dataset.fsegStato);
    const nuovo = sel.value;
    const nota = ['iscritta', 'non_interessata', 'chiusa'].includes(nuovo) ? prompt('Due parole sull\'esito (facoltative):') : null;
    if (nota === null && ['iscritta', 'non_interessata', 'chiusa'].includes(nuovo)) { render(); return; }
    const { error } = await sb.from('s_formazione_segnalazioni').update({ stato: nuovo, esito_note: nota || null }).eq('id', id);
    if (error) { toast('Esito non registrato: ' + error.message, 'err'); return; }
    toast('Esito registrato.', 'ok'); render();
  }));

  $('#hm-respinte-cerca')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = '⏳ Cerco i rimbalzi…';
    const { data, error } = await sb.functions.invoke('mail-respinte', { body: {} });
    if (error || data?.error) {
      b.disabled = false; b.textContent = '🔄 Cerca adesso';
      return toast('Non riuscito: ' + (data?.error || error.message), 'err');
    }
    toast(`Esaminati ${data.esaminati} rapporti: ${data.nuovi} nuovi, ${data.avvisati} tecnici avvisati.`
      + (data.errori?.length ? ` ⚠ ${data.errori.length} avvisi.` : ''), data.errori?.length ? 'err' : 'ok');
    render();
  });
  host.querySelectorAll('[data-respinta]').forEach((r) => r.addEventListener('click', async () => {
    const id = Number(r.dataset.respinta);
    const riga = respinte.find((x) => x.id === id);
    if (!riga) return;
    const che = prompt(`Indirizzo respinto: ${riga.destinatario}\n${riga.nr_verbale ? `Verbale ${riga.nr_verbale}\n` : ''}${riga.motivo || ''}\n\n`
      + 'Scrivi come si chiude (l\'indirizzo corretto, o perché non serviva). Lascia vuoto per non chiudere.');
    if (!che || !che.trim()) return;
    const stato = confirm('Chiudere come RISOLTA?\nOK = risolta (indirizzo sistemato) · Annulla = ignorata') ? 'risolta' : 'ignorata';
    const { error } = await sb.rpc('s_mail_respinta_chiudi', { p_id: id, p_stato: stato, p_note: che.trim() });
    if (error) return toast(error.message, 'err');
    toast('Rimbalzo chiuso.', 'ok');
    render();
  }));

  host.querySelectorAll('[data-pc-chiudi]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const p = propChius.find((x) => x.id === Number(b.dataset.pcChiudi));
    if (!p) return;
    if (!confirm(`Chiudere il cantiere «${lblCant(p)}» per fine lavori?\nTutte le visite collegate verranno chiuse.\n\nProposta di ${p.proposta_nome || p.proposta_da}: «${p.motivo}»`)) return;
    const note = prompt('Note sulla chiusura (facoltative). Annulla per interrompere.', p.motivo || '');
    if (note === null) return;
    const { data, error } = await sb.rpc('chiudi_cantiere', { p_cantiere_id: p.cantiere_id, p_motivo: 'termini_lavori', p_note: note.trim() || null });
    if (error) return toast('Chiusura non riuscita: ' + error.message, 'err');
    toast(`Cantiere chiuso · ${(data && data.visite_chiuse) || 0} visite chiuse. La proposta risulta accolta.`, 'ok');
    render();
  }));
  host.querySelectorAll('[data-pc-respingi]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const p = propChius.find((x) => x.id === Number(b.dataset.pcRespingi));
    if (!p) return;
    const note = prompt(`Respingere la proposta di chiusura di «${lblCant(p)}»?\n\nPerché il cantiere resta aperto? (lo legge chi l'ha proposta)`);
    if (note === null) return;
    if (!note.trim()) return toast('Scrivi il motivo: è la risposta per chi ha proposto.', 'err');
    const { error } = await sb.rpc('respingi_proposta_chiusura', { p_id: p.id, p_note: note.trim() });
    if (error) return toast('Non riuscito: ' + error.message, 'err');
    toast('Proposta respinta: il cantiere resta aperto.', 'ok');
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
  const { data: tec, error: errTec } = await sb.from('tecnici')
    .select('tecnico_nome, tecnico_cognome, email').eq('attivo', true)
    .not('email', 'is', null).order('tecnico_cognome');
  /* lettura fallita ≠ «nessun tecnico attivo» (26/09/2026) */
  if (errTec) { alert("Non sono riuscito a leggere l'elenco dei tecnici. Riprova."); return false; }
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
    const { data, error } = await sb.from(tabella).select('*').eq('id', praticaRif.id).maybeSingle();
    /* senza la pratica si riassegnerebbe l'incarico lasciandola indietro */
    if (error) { alert('Non sono riuscito a leggere la pratica collegata: incarico non riassegnato. Riprova.'); return false; }
    pratica = data || null;
    if (!pratica) tabella = null;
  }
  const { riassegnaTecnico } = await import('./incarico-tecnico.js');
  return riassegnaTecnico({ incaricoId: id, tabella, pratica, nuovoEmail: x.email });
}
