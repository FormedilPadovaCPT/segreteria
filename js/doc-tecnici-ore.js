/* ============================================================
   Documenti dei tecnici: requisiti con attestato di base e
   aggiornamenti a ore (somma sul periodo).   (17/11/2026)

   Alcuni requisiti non si rinnovano con un solo documento: la
   norma chiede un attestato di base e poi, a cadenza fissa, un
   numero di ore di aggiornamento che possono venire da PIU' corsi.
     - coordinatore: 40 ore ogni 5 anni, anche in piu' moduli
       (art. 98 e all. XIV D.Lgs. 81/2008; interpello 19/2014: la
       frequenza deve essere del 100% delle ore, e chi non le ha
       completate non puo' esercitare finche' non le completa);
     - formatore: 24 ore ogni 3 anni, di cui almeno 8 in corsi di
       aggiornamento, OPPURE 24 ore di docenza (D.I. 6/3/2013,
       allegato, «Aggiornamento professionale»).

   Questo modulo e' PURO (niente rete, niente pagina) perche' lo
   leggono la pagina «Documenti tecnici», il cruscotto e i test.

   Due modelli, scelti dal catalogo:
     - periodo_mobile (coordinatore, corretto la sera del 17/11/2026
       dopo la lettura dell'Accordo 59/CSR e delle FAQ): vedi
       statoMobile() qui sotto;
     - periodi fissi (formatore, trienni consecutivi: interpello 9/2015).
   Nota: la frase sul coordinatore qui sopra («non puo' esercitare
   finche' non completa») vale ancora; il modo di contare e' il mobile.
   Fonti in 3_RISORSE/Normativa/2026_11_17_REL_Area-Sicurezza_
   aggiornamento-coordinatori-e-formatori-regole-e-fonti.md.

   Modello a periodi fissi:
     - la riga «attestato» (tipo 'attestato', o una riga vecchia
       senza tipo) da' la data di partenza B; per il coordinatore
       la partenza puo' venire dal corso da 120 ore (origine);
     - i periodi sono [B, B+D), [B+D, B+2D)…, con D = durata_mesi;
     - in ogni periodo contano le righe 'aggiornamento' (e, dove la
       norma lo ammette, 'docenza') con data compresa nel periodo;
     - a periodo CHIUSO senza le ore: scaduto dal giorno di fine.
       Se il requisito ha il «recupero» (coordinatore), le ore fatte
       DOPO la fine completano le ore mancanti di quel periodo
       prima di contare per il successivo;
     - a periodo APERTO: valido fino alla fine del periodo; «in
       scadenza» se mancano ancora ore e siamo nel preavviso.
   Le ore in piu' di una soglia non si riportano al periodo dopo.
   ============================================================ */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function aggiungiMesiIso(iso, mesi) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + mesi);
  return d.toISOString().slice(0, 10);
}
function giorniTra(aIso, daIso) {
  return Math.round((new Date(aIso + 'T00:00:00Z') - new Date(daIso + 'T00:00:00Z')) / 86400000);
}
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/* ── requisiti a scadenza (contratto, polizze, UNI 11751…) ─────
   (18/11/2026) La regola di sempre della pagina «Documenti tecnici»,
   spostata qui perché anche il gestionale la mostri al tecnico con lo
   stesso esito. Conta l'ultima riga (per inizio, poi per fine):
   - senza_scadenza → in regola; una_tantum → in regola dalla data;
   - tacito: senza data di fine la fine è inizio + durata, e finché
     nessuno disdice il rinnovo corre da solo (non va mai «in scadenza»);
   - altrimenti scaduto, in scadenza dentro il preavviso, in regola.
   Ritorna { classe, doc, scadenza?, tacito?, una_tantum?, senza_scadenza? }. */
export function statoScadenza(req, suoi, oggi) {
  if (!suoi || !suoi.length) return { classe: 'mancante' };
  const doc = [...suoi].sort((a, b) =>
    (b.data_inizio || b.data_fine || '').localeCompare(a.data_inizio || a.data_fine || ''))[0];
  if (doc.senza_scadenza) return { classe: 'ok', doc, senza_scadenza: true };
  if (req.rinnovo === 'una_tantum') return { classe: 'ok', doc, una_tantum: true };
  let fine = doc.data_fine;
  const D = num(req.durata_mesi);
  if (!fine && req.rinnovo === 'tacito' && doc.data_inizio && D) fine = aggiungiMesiIso(doc.data_inizio, D);
  if (!fine) return { classe: 'senzadata', doc };
  let tacito = false;
  if (req.rinnovo === 'tacito' && !doc.disdetto_il && D) {
    let giri = 0;
    while (giorniTra(fine, oggi) < 0 && giri++ < 600) fine = aggiungiMesiIso(fine, D);
    tacito = true;
  }
  const g = giorniTra(fine, oggi);
  if (g < 0) return { classe: 'scaduto', doc, scadenza: fine };
  if (!tacito && g <= (num(req.preavviso_giorni) || 60)) return { classe: 'scade', doc, scadenza: fine };
  return { classe: 'ok', doc, scadenza: fine, tacito };
}
/* il testo breve della casella, come lo scriveva la pagina della segreteria */
export function testoScadenza(s, fmt = (x) => x) {
  if (!s) return '';
  if (s.classe === 'mancante') return 'mancante';
  if (s.senza_scadenza) return 'senza scadenza';
  if (s.una_tantum) return s.doc && s.doc.data_inizio ? fmt(s.doc.data_inizio) : 'presente';
  if (s.classe === 'senzadata') return 'senza data';
  return fmt(s.scadenza) + (s.tacito ? ' ⟳' : '');
}

/* il requisito e' «a ore» se il catalogo gli da' una soglia e un periodo */
export function requisitoAOre(req) {
  return num(req && req.ore_soglia) > 0 && num(req && req.durata_mesi) > 0;
}

/* Ritorna null quando si deve usare la logica di sempre (requisito
   non a ore, o nessuna riga con il tipo compilato: le righe vecchie
   hanno la loro data di fine e restano com'erano).
   Altrimenti { classe, scadenza, doc, periodo:{inizio,fine}, ore,
   corsi, docenza, soglia, soglia_corsi, manca, testo? }.
   `origine` = righe del requisito da cui parte il conteggio, se
   manca l'attestato proprio (es. il corso da 120 ore).            */
export function statoConOre(req, suoi, oggi, origine = []) {
  if (!requisitoAOre(req)) return null;
  if (!suoi.some((d) => d.tipo)) return null;

  const S = num(req.ore_soglia);
  const Sc = num(req.ore_soglia_corsi);
  const D = num(req.durata_mesi);
  const preavviso = num(req.preavviso_giorni) || 60;

  const eBase = (d) => (!d.tipo || d.tipo === 'attestato') && ISO.test(d.data_inizio || '');
  const basi = [...suoi.filter(eBase), ...(suoi.some(eBase) ? [] : origine.filter((d) => ISO.test(d.data_inizio || '')))]
    .sort((a, b) => b.data_inizio.localeCompare(a.data_inizio));
  if (!basi.length) {
    return { classe: 'senzadata', testo: 'manca l\'attestato di base', soglia: S, soglia_corsi: Sc };
  }
  const base = basi[0];

  const agg = suoi
    .filter((d) => (d.tipo === 'aggiornamento' || d.tipo === 'docenza') && ISO.test(d.data_inizio || ''))
    .sort((a, b) => a.data_inizio.localeCompare(b.data_inizio))
    .map((d) => ({
      data: d.data_inizio, tipo: d.tipo, rest: num(d.ore),
      corsi: d.tipo === 'aggiornamento' ? Math.min(num(d.ore_di_corso), num(d.ore)) : 0,
    }));

  if (req.periodo_mobile) return statoMobile(req, base, agg.filter((r) => r.data <= oggi), oggi, { S, Sc, D, preavviso });

  /* (18/11/2026) tecnico verificatore UNI 11751-2, punto 6.2: nel triennio
     anche almeno `verifiche_soglia` verifiche di asseverazione (3), che insieme
     durino almeno `verifiche_gu_soglia` giorni/uomo (6). Scelte dell'utente del
     18/11/2026: i 6 g/u sono il totale delle verifiche, contano anche i
     mantenimenti e l'osservatore (affiancamento). Le verifiche arrivano come
     righe { tipo:'verifica', data_inizio, gu } lette dall'app asseverazione. */
  const Vs = num(req.verifiche_soglia), Gs = num(req.verifiche_gu_soglia);
  const verifiche = suoi.filter((d) => d.tipo === 'verifica' && ISO.test(d.data_inizio || '') && d.data_inizio <= oggi);

  /* qualifica (UNI 11751-2, punto 6.1, criterio 2): oltre all'attestato
     servono `affiancamento_giorni_soglia` giorni di verifica in affiancamento
     (10), anche fatti prima dell'attestato. Si contano le giornate da
     osservatore del gruppo di verifica; una riga «riconoscimento» registra
     la qualifica già riconosciuta (De Marco: affiancamenti precedenti ritenuti
     validi da FORMEDIL Italia, mail del 29/07/2026). Finché manca, il
     tecnico non è operativo e il mantenimento non si conta. */
  const Af = num(req.affiancamento_giorni_soglia);
  if (Af && !suoi.some((d) => d.tipo === 'riconoscimento')) {
    const giorni = Math.round(verifiche.filter((v) => v.ruolo === 'osservatore').reduce((s, v) => s + num(v.giornate), 0) * 100) / 100;
    if (giorni < Af) {
      return {
        classe: 'senzadata', doc: base, affiancamento: giorni, affiancamento_soglia: Af, soglia: S, soglia_corsi: Sc,
        testo: `affiancamento ${String(giorni).replace('.', ',')} giorni su ${Af}: non ancora operativo`,
      };
    }
  }

  for (let n = 0; n < 60; n++) {
    const inizio = aggiungiMesiIso(base.data_inizio, D * n);
    const fine = aggiungiMesiIso(base.data_inizio, D * (n + 1));
    const nel = agg.filter((r) => r.data >= inizio && r.data < fine);
    let ore = 0; let corsi = 0; let docenza = 0;
    for (const r of nel) {
      if (r.tipo === 'docenza') docenza += r.rest; else { ore += r.rest; corsi += Math.min(r.corsi, r.rest); }
    }
    const vNel = verifiche.filter((v) => v.data_inizio >= inizio && v.data_inizio < fine);
    const nVer = vNel.length;
    const gu = Math.round(vNel.reduce((s, v) => s + num(v.gu), 0) * 100) / 100;
    const verOk = !Vs || (nVer >= Vs && gu >= Gs);
    const docOk = !!req.docenza_alternativa && docenza >= S;
    let ok = ((ore >= S && corsi >= Sc) || docOk) && verOk;
    const chiuso = fine < oggi;
    let recuperato = false;

    if (!ok && chiuso && req.recupero_ore) {
      /* «sospeso finche' non recupera» (formatore: scelta dell'utente del
         17/11/2026, la norma non lo dice): le ore fatte DOPO la fine
         completano quelle mancanti di questo periodo; quello che avanza
         conta per il periodo dopo. Si consuma solo se basta davvero. */
      const dopo = agg.filter((r) => r.data >= fine && r.rest > 0);
      const dispAgg = dopo.filter((r) => r.tipo === 'aggiornamento').reduce((s, r) => s + r.rest, 0);
      const dispCorsi = dopo.filter((r) => r.tipo === 'aggiornamento').reduce((s, r) => s + Math.min(r.corsi, r.rest), 0);
      const dispDoc = dopo.filter((r) => r.tipo === 'docenza').reduce((s, r) => s + r.rest, 0);
      if (ore + dispAgg >= S && corsi + dispCorsi >= Sc) {
        let mancaOre = Math.max(0, S - ore); let mancaCorsi = Math.max(0, Sc - corsi);
        for (const r of dopo) {
          if (r.tipo !== 'aggiornamento') continue;
          if (mancaOre <= 0 && mancaCorsi <= 0) break;
          const cr = Math.min(r.corsi, r.rest);
          const u = Math.min(r.rest, Math.max(mancaOre, Math.min(cr, mancaCorsi)));
          const uc = Math.min(u, cr, mancaCorsi);
          r.rest -= u; r.corsi -= uc; mancaOre -= u; mancaCorsi -= uc; ore += u; corsi += uc;
        }
        ok = true; recuperato = true;
      } else if (req.docenza_alternativa && docenza + dispDoc >= S) {
        let manca = S - docenza;
        for (const r of dopo) {
          if (r.tipo !== 'docenza' || manca <= 0) continue;
          const u = Math.min(r.rest, manca);
          r.rest -= u; manca -= u; docenza += u;
        }
        ok = true; recuperato = true;
      }
    }

    const dati = {
      doc: base, periodo: { inizio, fine }, ore, corsi, docenza, recuperato,
      soglia: S, soglia_corsi: Sc, manca: Math.max(0, S - ore), docenza_alternativa: !!req.docenza_alternativa,
      ...(Vs ? { verifiche: nVer, verifiche_gu: gu, verifiche_soglia: Vs, verifiche_gu_soglia: Gs,
        manca_verifiche: Math.max(0, Vs - nVer), manca_gu: Math.max(0, Math.round((Gs - gu) * 100) / 100) } : {}),
    };

    if (chiuso) {
      if (!ok) return { classe: 'scaduto', scadenza: fine, ...dati };
      for (const r of nel) r.rest = 0;
      continue;
    }
    /* periodo aperto: valido fino alla fine del periodo */
    const g = giorniTra(fine, oggi);
    if (!ok && g <= preavviso) return { classe: 'scade', scadenza: fine, ...dati };
    return { classe: 'ok', scadenza: fine, ...dati };
  }
  return { classe: 'senzadata', testo: 'periodi non calcolabili', soglia: S, soglia_corsi: Sc };
}

/* ── quinquennio mobile (coordinatore, dal 17/11/2026) ─────────
   Accordo 59/CSR del 17/04/2025, Parte III, e FAQ di Ministero
   (27/03/2026, quesito 8) e Regione Veneto: trascorsi D mesi dalla
   prima abilitazione, a una data t il coordinatore deve avere S ore
   di aggiornamento nei D mesi prima di t («quinquennio mobile»).
   Senza ore non esercita, ma il recupero tardivo vale finche' non
   passano `decadenza_mesi` (10 anni) senza nessun aggiornamento:
   allora il titolo decade e si rifà il corso abilitante (nuova base).
   La finestra di t e' [t-D, t]: la riga del giorno t-D conta ancora,
   quindi la riga del giorno a vale fino al giorno a+D compreso.
   (18/11/2026) `req.aggiornamento_dal`: per chi ha l'attestato da prima
   della norma l'obbligo di aggiornamento decorre da quella data, non dal
   corso (coordinatore: 15/05/2008, Allegato XIV D.Lgs. 81/2008, «Per
   coloro che hanno conseguito l'attestato prima dell'entrata in vigore
   del presente decreto, l'obbligo di aggiornamento decorre dalla data di
   entrata in vigore del medesimo decreto»). Da li' partono i primi D mesi
   e i dieci anni; le ore si contano comunque dal corso.               */
function statoMobile(req, base, righe, oggi, { S, D, preavviso }) {
  const B0 = base.data_inizio;
  const dal = ISO.test(req.aggiornamento_dal || '') ? req.aggiornamento_dal : '';
  const B = dal > B0 ? dal : B0;
  const fineGrazia = aggiungiMesiIso(B, D);
  const agg = righe.filter((r) => r.tipo === 'aggiornamento' && r.data >= B0);
  const oreIn = (t) => agg.reduce((s, r) => s + (r.data >= aggiungiMesiIso(t, -D) && r.data <= t ? r.rest : 0), 0);
  const valido = (t) => t <= fineGrazia || oreIn(t) >= S;
  const dopo = (iso) => new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

  const finestra = { inizio: aggiungiMesiIso(oggi, -D), fine: oggi };
  const ore = oreIn(oggi);
  const dati = {
    doc: base, periodo: finestra, mobile: true, grazia_fino: fineGrazia, decorrenza: B !== B0 ? B : null,
    ore, corsi: 0, docenza: 0, soglia: S, soglia_corsi: 0, manca: Math.max(0, S - ore), docenza_alternativa: false,
  };

  /* decadenza: dieci anni (o quanti ne dice il catalogo) senza aggiornamenti */
  const DEC = num(req.decadenza_mesi);
  if (DEC > 0) {
    const tappe = [B, ...agg.filter((r) => r.data > B).map((r) => r.data)].sort();
    for (let i = 0; i < tappe.length; i++) {
      const limite = aggiungiMesiIso(tappe[i], DEC);
      const prossima = tappe[i + 1] || null;
      if ((prossima && prossima > limite) || (!prossima && limite < oggi)) {
        return { classe: 'scaduto', decaduto: true, scadenza: limite, ...dati };
      }
    }
  }

  /* le date in cui la validita' puo' finire: la fine dei primi D mesi
     e il giorno in cui ogni riga esce dalla finestra */
  const candidati = [...new Set([fineGrazia, ...agg.map((r) => aggiungiMesiIso(r.data, D))])].sort();

  if (!valido(oggi)) {
    /* l'ultimo giorno valido prima di oggi */
    const passati = candidati.filter((c) => c < oggi && valido(c));
    return { classe: 'scaduto', scadenza: passati.length ? passati[passati.length - 1] : fineGrazia, ...dati };
  }
  /* valido oggi: fino a quando, se non fa altre ore? */
  let fine = null;
  for (const c of candidati) {
    if (c < oggi) continue;
    if (!valido(dopo(c))) { fine = c; break; }
  }
  if (!fine) fine = candidati[candidati.length - 1];
  const g = giorniTra(fine, oggi);
  return { classe: g <= preavviso ? 'scade' : 'ok', scadenza: fine, ...dati };
}

/* Frase per l'etichetta e per l'avviso. `fmt` formatta la data
   (dataIt nell'app); nei test basta una funzione qualunque.        */
export function dettaglioOre(s, fmt = (x) => x) {
  if (!s || !s.periodo) return '';
  const nOre = (x) => String(x).replace('.', ',');
  if (s.mobile) {
    if (s.decaduto) return `nessun aggiornamento registrato per dieci anni: titolo decaduto il ${fmt(s.scadenza)}, va rifatto il corso abilitante (se il tecnico ha attestati di quegli anni, registrarli cambia il conto)`;
    /* (18/11/2026) i corsi prima dell'abilitazione non contano: nei primi
       cinque anni si dice che le ore non servono ancora, e la finestra
       non comincia prima del corso abilitante */
    const B = s.doc && s.doc.data_inizio;
    if (s.grazia_fino >= s.periodo.fine) {
      if (s.decorrenza) return `attestato anteriore all'obbligo di aggiornamento, che decorre dal ${fmt(s.decorrenza)}: le ore non servono fino al ${fmt(s.grazia_fino)}; registrate finora ${nOre(s.ore)} ore su ${nOre(s.soglia)}`;
      return `primi cinque anni dall'abilitazione${B ? ` (${fmt(B)})` : ''}: le ore non servono fino al ${fmt(s.grazia_fino)}; registrate finora ${nOre(s.ore)} ore su ${nOre(s.soglia)}`;
    }
    const dal = B && B > s.periodo.inizio ? B : s.periodo.inizio;
    return `ultimi cinque anni (dal ${fmt(dal)}): ${nOre(s.ore)} ore su ${nOre(s.soglia)}`;
  }
  const parti = [`periodo dal ${fmt(s.periodo.inizio)} al ${fmt(s.periodo.fine)}: ${nOre(s.ore)} ore su ${nOre(s.soglia)}`];
  if (s.soglia_corsi) parti.push(`di cui in corsi di aggiornamento ${nOre(s.corsi)} su ${nOre(s.soglia_corsi)}`);
  if (s.docenza_alternativa) parti.push(`docenza ${nOre(s.docenza)} ore su ${nOre(s.soglia)} (in alternativa)`);
  if (s.verifiche_soglia) parti.push(`verifiche di asseverazione ${s.verifiche} su ${s.verifiche_soglia}, ${nOre(s.verifiche_gu)} g/u su ${nOre(s.verifiche_gu_soglia)}`);
  return parti.join('; ');
}
