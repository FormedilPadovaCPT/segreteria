/* ============================================================
   I documenti del modulo «Incarichi e fatture tecnici».
   Ricalcano le tre stampe Access che l'ufficio usa da sempre:

   1. LETTERA DI INCARICO VISITE del mese (ex «Comunicazione Visite
      in cantiere», sigla COMU): al tecnico, con i cantieri
      assegnati per zona/comuni, i cantieri con ritorno previsto,
      le richieste in attesa e il testo standard. Protocollo OUT.

   2. RIEPILOGO ATTIVITÀ DA FATTURARE (ex «Comunicazione riepilogo
      attività», Prot. NNN/rs.V): a fine mese, con le diciture da
      mettere in fattura, l'elenco delle visite per tipo (prima /
      seconda / stage / progetto), docenze, servizi e asseverazioni,
      il totale con cassa e IVA e l'avviso sul 20% RLST. Protocollo OUT.

   3. MANDATO DI PAGAMENTO (ex «R_RiepilogoVisiteTecnici_Pag»):
      all'Amministrazione, con le fatture approvate dal coordinatore,
      per tecnico, e l'importo totale in lettere. Documento INTERNO:
      niente protocollo (regola del confine).

   Carta intestata da apriCarta() (segnalazioni-doc.js), come tutti
   gli altri documenti dell'app.
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { dataIt, siglaProtocollo, spezza, taglia, testoPdf } from './comune.js';
import { ENTE } from './config.js';

const SX = 57;
const DX = 538;

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export const TIPI_PRESTAZIONE = {
  visita_prima: 'Prima visita',
  visita_successiva: 'Seconda visita',
  visita_stage: 'Visita stage',
  visita_progetto: 'Visita di progetto',
  docenza: 'Docenza',
  conferenza: 'Conferenza di cantiere',
  consulenza: 'Consulenza',
  asseverazione: 'Asseverazione',
  coordinamento: 'Coordinamento',
  altro: 'Altro',
};

/* Gli stessi codici del gestionale visite (TIPO_ACC_LABELS in app-data.js e la tendina
   «Tipologia di accesso» del verbale): visite.tipo_accesso è scritto con quelli.
   Fino al 30/09/2026 qui 1, 2, 4 e 6 avevano i nomi di un'altra codifica («a vista»,
   «da notifica preliminare», «su richiesta», «su segnalazione»): una visita su
   segnalazione sarebbe uscita nel riepilogo come «a vista». */
export const TIPO_ACCESSO = {
  1: 'su segnalazione', 2: 'su richiesta', 3: 'per protocolli di intesa', 4: 'indicata da RLS / RLST',
  5: 'programmata', 6: 'cantiere qualità', 7: 'indicata dal CPT', 8: 'adesione servizio visite in serie',
  9: 'stage / ASL', 10: 'asseverazione', 11: 'attestazione / consulenza e monitoraggio', 12: 'progetto SPISAL',
};

/* euro, lordoDi e inLettere vivono in comune.js dal 05/09/2026 (cosi' Node li
   prova senza pdf-lib); da qui si ri-esportano perche' fatture-tecnici.js e
   rendicontazione-doc.js continuino a trovarli dov'erano. */
import { euro, lordoDi, inLettere } from './comune.js';
export { euro, lordoDi, inLettere };

const salva = async (doc) => new Uint8Array(await doc.save());

/* testata interna dei documenti al tecnico: protocollo a sinistra,
   data e destinatario a destra, come la stampa Access */
function testataTecnico(c, prot, tecnico, area, dataDoc) {
  const rigaProt = prot?.anteprima ? 'ANTEPRIMA — senza numero di protocollo' : `Prot. n°: ${siglaProtocollo(prot)}`;
  c.stato.pagina.drawText(testoPdf(rigaProt), { x: SX, y: c.stato.y, size: 9.5, font: c.bold, color: prot?.anteprima ? c.arancio : c.nero });
  c.stato.pagina.drawText(`DATA: ${dataIt(dataDoc || prot.data_prot)}`, { x: 330, y: c.stato.y, size: 9.5, font: c.font, color: c.nero });
  c.stato.y -= 14;
  if (area) c.stato.pagina.drawText(`AREA: ${testoPdf(String(area))}`, { x: SX, y: c.stato.y, size: 9.5, font: c.font, color: c.nero });
  c.stato.pagina.drawText(`Alla c.a.: ${testoPdf(tecnico)}`, { x: 330, y: c.stato.y, size: 9.5, font: c.italic, color: c.nero });
  c.stato.y -= 22;
}

function bandaTitolo(c, testo) {
  c.serve(24);
  c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 5, width: DX - SX, height: 16, color: c.arancio });
  c.stato.pagina.drawText(testoPdf(testo), { x: SX + 6, y: c.stato.y - 1, size: 8.5, font: c.bold, color: c.bianco });
  c.stato.y -= 20;
}

function intestaTabella(c, colonne) {
  c.serve(20);
  const y0 = c.stato.y;
  c.stato.pagina.drawRectangle({ x: SX, y: y0 - 4, width: DX - SX, height: 13, color: c.grigioChiaro });
  for (const [label, x] of colonne) c.stato.pagina.drawText(label, { x, y: y0, size: 7.4, font: c.bold, color: c.grigio });
  c.stato.y = y0 - 14;
  /* Quanto e' larga ogni colonna lo dice la colonna dopo (l'ultima
     arriva al margine): e' la misura con cui si taglia il testo delle
     celle, al posto di un numero di caratteri buttato li'. */
  const larghezze = {};
  colonne.forEach(([, x], i) => { larghezze[x] = (i + 1 < colonne.length ? colonne[i + 1][1] : DX) - x - 4; });
  return larghezze;
}

function firmaSegreteria(c, prot) {
  c.serve(70);
  c.stato.y = Math.max(c.stato.y - 10, 100);
  c.stato.pagina.drawText(`Padova, ${dataIt(prot?.data_prot || new Date().toISOString().slice(0, 10))}`, { x: SX, y: c.stato.y, size: 10, font: c.font, color: c.nero });
  c.stato.pagina.drawText('FORMEDIL PADOVA', { x: 380, y: c.stato.y + 4, size: 10, font: c.bold, color: c.nero });
  c.stato.pagina.drawText(ENTE.area.toUpperCase(), { x: 380, y: c.stato.y - 8, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('La Segreteria', { x: 380, y: c.stato.y - 22, size: 10, font: c.italic, color: c.nero });
}

/* ── 1. lettera di incarico visite del mese ──
   inc = riga s_incarichi_mensili; d = { tecnico, comuni[], ncAperte[],
   richieste[], testo, coordinatore } */
export async function pdfLetteraIncarico(inc, prot, d) {
  const c = await apriCarta();
  testataTecnico(c, prot, d.tecnico, inc.area_zona, inc.data_lettera);
  c.scrivi(`Oggetto: ${d.integrazione ? 'Integrazione alla c' : 'C'}omunicazione visite in cantiere — mese di ${MESI[inc.mese - 1]} ${inc.anno}.`, c.bold, 10.5, c.nero);
  c.stato.y -= 6;
  if (d.integrazione) {
    c.scrivi('La presente integra la comunicazione già trasmessa con lo stesso numero di protocollo: nella prima stesura gli elenchi dei cantieri con ritorno previsto e delle attività in sospeso non erano stati riportati per un errore dell\'applicazione. Restano invariati i cantieri assegnati e i comuni di competenza.', c.italic, 8.5, c.grigio);
    c.stato.y -= 6;
  }

  c.campo('Cantieri assegnati', String(inc.cantieri_assegnati ?? 0));
  if (inc.seconde_visite) c.campo('Seconde visite', String(inc.seconde_visite));
  if (inc.altro) c.campo('Altro', String(inc.altro));
  if (d.comuni?.length) c.campo('Comuni di competenza', d.comuni.join(', '));
  c.stato.y -= 6;

  /* cantieri con ritorno previsto (dallo scadenzario del gestionale) */
  bandaTitolo(c, `CANTIERI CON RITORNO PREVISTO DA RICHIUDERE (${d.ncAperte?.length || 0})`);
  if (d.ncAperte?.length) {
    const larg = intestaTabella(c, [['Verbale', SX + 4], ['Ultima visita', SX + 62], ['Ritorno', SX + 122], ['Impresa', SX + 178], ['Comune', SX + 370], ['IPC', DX - 28]]);
    for (const r of d.ncAperte) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, f = c.font) => c.stato.pagina.drawText(taglia(f, 7.8, testoPdf(String(s ?? '')), larg[x]), { x, y, size: 7.8, font: f, color: c.nero });
      t(r.nr_verbale, SX + 4); t(dataIt(r.data_visita), SX + 62);
      t(r.ritorno ? dataIt(r.ritorno) + (r.calcolata ? ' *' : '') : '—', SX + 122, c.bold);
      t(r.impresa || '', SX + 178); t(r.comune || '', SX + 370); t(r.ipc || '', DX - 28, c.bold);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
    if (d.ncAperte.some((r) => r.calcolata)) {
      c.stato.y -= 2;
      c.scrivi('* data calcolata con la regola Formedil (n. accesso + IPC); senza asterisco è la data di ritorno indicata dal tecnico sul verbale.', c.italic, 7.5, c.grigio);
    }
  } else {
    c.scrivi('Nessun cantiere con ritorno previsto.', c.italic, 9, c.grigio);
  }
  c.stato.y -= 6;

  /* richieste in attesa (incarichi aperti del gestionale) */
  bandaTitolo(c, `RICHIESTE IN ATTESA — SERIE DI VISITE, RICHIESTE DA IMPRESA, STAGE, SEGNALAZIONI (${d.richieste?.length || 0})`);
  if (d.richieste?.length) {
    const larg = intestaTabella(c, [['N°', SX + 4], ['Data', SX + 40], ['Tipologia', SX + 100], ['Impresa', SX + 250], ['Comune', SX + 400]]);
    for (const r of d.richieste) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, f = c.font) => c.stato.pagina.drawText(taglia(f, 7.8, testoPdf(String(s ?? '')), larg[x]), { x, y, size: 7.8, font: f, color: c.nero });
      t(r.id, SX + 4, c.bold); t(dataIt(r.data_richiesta), SX + 40); t(r.tipologia_richiesta || r.tipo_richiesta || '', SX + 100);
      t(r.impresa || '', SX + 250); t(r.comune || '', SX + 400);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
  } else {
    c.scrivi('Nessuna richiesta in attesa.', c.italic, 9, c.grigio);
  }
  c.stato.y -= 6;

  /* altri incarichi in sospeso: docenze, conferenze, asseverazioni */
  if (d.sospesi?.length) {
    bandaTitolo(c, `ALTRI INCARICHI IN SOSPESO \u2014 DOCENZE, CONFERENZE, ASSEVERAZIONI (${d.sospesi.length})`);
    const larg = intestaTabella(c, [['Attività', SX + 4], ['Riferimento', SX + 110], ['Oggetto', SX + 200], ['Data', SX + 400], ['Note', SX + 460]]);
    for (const r of d.sospesi) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, f = c.font) => c.stato.pagina.drawText(taglia(f, 7.8, testoPdf(String(s ?? '')), larg[x]), { x, y, size: 7.8, font: f, color: c.nero });
      t(r.cosa || '', SX + 4, c.bold); t(r.rif || '', SX + 110); t(r.titolo || '', SX + 200);
      t(r.data ? dataIt(r.data) : '\u2014', SX + 400); t(r.dettaglio || '', SX + 460);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
    c.stato.y -= 2;
  }
  c.stato.y -= 8;

  /* (07/10/2026) la coda in tre parti: avviso del mese per tutti, nota per questo tecnico, testo fisso.
     Tolta la riga «L'incarico vale per il mese indicato…»: lo dice già il punto 1 del testo fisso. */
  if (d.avviso) { c.scrivi(d.avviso, c.bold, 10, c.nero); c.stato.y -= 6; }
  if (inc.note) { c.scrivi(inc.note, c.font, 9.5); c.stato.y -= 6; }
  if (d.testo) {
    for (const par of String(d.testo).split(/\n{2,}/)) { c.scrivi(par, c.font, 9, c.nero); c.stato.y -= 4; }
  }
  firmaSegreteria(c, prot);
  return salva(c.doc);
}

/* ── 2. riepilogo attività da fatturare ──
   d = { tecnico, prestazioni[], fisc, rlstPct, rlstMinimo, totNetto, totLordo,
         cantieriVisitati, note }

   UNA PAGINA SOLA QUANDO CI STA (30/09/2026, chiesto dall'utente: «è brutto
   che vada alla seconda pagina solo per la firma»). Il riepilogo si compone
   in tre stesure, dalla più ariosa alla più fitta, e vale la prima che dà
   meno pagine: con un mese normale sta in un foglio. Quando non ci sta
   nemmeno la più fitta, il blocco finale — totale del mese, saluto e firma —
   non si separa: la firma non resta mai da sola su una pagina. */
const FONDO = 46;   /* sotto non si scrive; la carta non ha pie' di pagina */
const STESURE_RIEPILOGO = [
  { passo: 12.5, corpo: 7.8, aria: 1, campiInRiga: false, testataUnica: false },
  { passo: 11.2, corpo: 7.6, aria: 0.5, campiInRiga: true, testataUnica: false },
  /* la più fitta: i titoli delle colonne una volta sola per gruppo, non a ogni tipo di accesso */
  { passo: 10, corpo: 7.3, aria: 0.2, campiInRiga: true, testataUnica: true },
];

/* a capo come c.scrivi, ma restituisce le righe e non salta pagina:
   serve al blocco finale, che si misura prima di scriverlo */
function aCapo(f, dim, testo, larghezza) {
  const out = [];
  for (const rigaTesto of testoPdf(testo).split(/\n/)) {
    let riga = '';
    for (const w of rigaTesto.split(/\s+/).filter(Boolean)) {
      const prova = riga ? `${riga} ${w}` : w;
      if (f.widthOfTextAtSize(prova, dim) > larghezza && riga) { out.push(riga); riga = w; } else riga = prova;
    }
    out.push(riga);
  }
  return out;
}

export async function pdfRiepilogo(inc, prot, d) {
  let scelta = null;
  for (const st of STESURE_RIEPILOGO) {
    const c = await componiRiepilogo(inc, prot, d, st);
    const pagine = c.doc.getPageCount();
    if (!scelta || pagine < scelta.pagine) scelta = { c, pagine };
    if (pagine === 1) break;
  }
  return salva(scelta.c.doc);
}

async function componiRiepilogo(inc, prot, d, st) {
  const c = await apriCarta();
  const aria = (n) => n * st.aria;
  /* le righe delle tabelle possono scendere fino a FONDO; titoli e campi usano
     c.serve, che si ferma un po' prima: al più vanno a capo pagina in anticipo */
  const serve = (h) => { if (c.stato.y - h < FONDO) c.nuovaPagina(); };
  const mese = MESI[inc.mese - 1];

  testataTecnico(c, prot, d.tecnico, inc.area_zona, prot.data_prot);
  c.scrivi('Oggetto: Comunicazione riepilogo attività da fatturare.', c.bold, 10.5, c.nero);
  c.stato.y -= aria(4);
  const assegnati = `${inc.cantieri_assegnati ?? 0}${inc.altro ? `  —  Altro: ${inc.altro}` : ''}`;
  /* il riepilogo elenca le attivita' ancora senza fattura, non «quelle del
     mese»: se ne arrivano da mesi precedenti va detto, altrimenti il
     tecnico trova righe con date che non tornano col titolo */
  if (st.campiInRiga) {
    c.scrivi(`Mese di riferimento: ${mese} ${inc.anno}   —   Cantieri assegnati: ${assegnati}   —   Cantieri visitati: ${d.cantieriVisitati ?? 0}`, c.italic, 9, c.nero);
    if (d.arretrate) c.scrivi(`Attività di mesi precedenti: ${d.arretrate} — non ancora coperte da una fattura`, c.italic, 9, c.nero);
    c.stato.y -= 3;   /* la riga non deve toccare la banda del titolo */
  } else {
    c.campo('Mese di riferimento', `${mese} ${inc.anno}`);
    c.campo('Cantieri assegnati', assegnati);
    c.campo('Cantieri visitati', String(d.cantieriVisitati ?? 0));
    if (d.arretrate) c.campo('Attivita di mesi precedenti', `${d.arretrate} — non ancora coperte da una fattura`);
  }
  c.stato.y -= aria(6);

  const visite = d.prestazioni.filter((p) => String(p.tipo).startsWith('visita_'));
  const altre = d.prestazioni.filter((p) => !String(p.tipo).startsWith('visita_'));

  /* le diciture da mettere in fattura: solo quelle dei tipi di visita che
     questo riepilogo contiene davvero (prima erano sempre tutte e quattro) */
  bandaTitolo(c, 'RIEPILOGO VISITE IN CANTIERE');
  const tipi = new Set(visite.map((p) => p.tipo));
  const ordinarie = [];
  if (tipi.has('visita_prima')) ordinarie.push(`- "Consulenza professionale per (N°) sopralluoghi in cantiere mese di ${mese} prime visite"`);
  if (tipi.has('visita_successiva')) ordinarie.push(`- "Consulenza professionale per (N°) sopralluoghi in cantiere mese di ${mese} seconde visite"`);
  if (ordinarie.length) {
    c.scrivi('Dicitura in fattura per le visite ordinarie:', c.bold, 8.5, c.nero);
    for (const r of ordinarie) c.scrivi(r, c.font, 8.5, c.nero, 10);
  }
  if (tipi.has('visita_progetto')) c.scrivi('Visite di progetto: "Consulenza professionale per Progetto (titolo) - (N°) attività di audit in cantiere"', c.font, 8.5, c.nero, 10);
  if (tipi.has('visita_stage')) c.scrivi('Visite stage: "Consulenza professionale per (N°) visite stage in cantiere"', c.font, 8.5, c.nero, 10);
  if (visite.length) c.stato.y -= aria(6);

  const gruppi = {};
  for (const p of visite) (gruppi[p.tipo] = gruppi[p.tipo] || []).push(p);
  for (const [tipo, righe] of Object.entries(gruppi)) {
    const netto = righe.reduce((s, p) => s + Number(p.importo || 0), 0);
    c.serve(30);
    const yB = c.stato.y + 8;
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 14, width: DX - SX, height: 15, color: c.grigioChiaro });
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 14, width: 3.2, height: 15, color: c.arancio });
    const tariffa = righe[0]?.tariffa_unitaria != null ? ` da ${euro(righe[0].tariffa_unitaria)}` : '';
    c.stato.pagina.drawText(testoPdf(`${TIPI_PRESTAZIONE[tipo] || tipo}${tariffa}`.toUpperCase()), { x: SX + 10, y: yB - 10, size: 8.5, font: c.bold, color: c.nero });
    const tot = `${righe.length} — netto ${euro(netto)} — tot. oneri e IVA inc. ${euro(lordoDi(netto, d.fisc))}`;
    c.stato.pagina.drawText(tot, { x: DX - 8 - c.bold.widthOfTextAtSize(tot, 8), y: yB - 10, size: 8, font: c.bold, color: c.arancio });
    c.stato.y = yB - 23 - aria(3);

    /* sottogruppi per tipo di accesso, come la stampa Access */
    const perAccesso = {};
    for (const p of righe) (perAccesso[p.tipo_accesso ?? ''] = perAccesso[p.tipo_accesso ?? ''] || []).push(p);
    let larg = null;
    for (const [acc, rr] of Object.entries(perAccesso)) {
      c.serve(26 + st.passo);   /* l'etichetta non resta in fondo alla pagina senza almeno una riga */
      c.stato.pagina.drawText(testoPdf(`${rr.length} ${TIPO_ACCESSO[acc] || (acc ? `tipo ${acc}` : 'visita')}`), { x: SX + 14, y: c.stato.y, size: 8, font: c.italic, color: c.grigio });
      if (!larg || !st.testataUnica) {
        c.stato.y -= 11 + aria(1);
        larg = intestaTabella(c, [['Data', SX + 4], ['Impresa', SX + 56], ['Stage', SX + 262], ['Accesso n°', SX + 296], ['Verbale n°', SX + 350], ['RLST', SX + 404], ['Importo', DX - 42]]);
      } else c.stato.y -= 10;
      for (const p of rr) {
        serve(st.passo + 1.5);
        const y = c.stato.y;
        const t = (s, x, f = c.font) => c.stato.pagina.drawText(taglia(f, st.corpo, testoPdf(String(s ?? '')), larg[x]), { x, y, size: st.corpo, font: f, color: c.nero });
        t(dataIt(p.data), SX + 4);
        t(p.impresa || p.descrizione || '', SX + 56);
        t(p.stage ? 'Sì' : 'No', SX + 262);
        t(p.accesso_n ?? '', SX + 296);
        t((p.nr_verbale || '').replace(/^CPT\/\d\d_\d\d\//, ''), SX + 350, c.bold);
        t(p.rlst ? 'Sì' : 'No', SX + 404);
        c.stato.pagina.drawText(euro(p.importo), { x: DX - 4 - c.font.widthOfTextAtSize(euro(p.importo), st.corpo), y, size: st.corpo, font: c.font, color: c.nero });
        c.stato.pagina.drawLine({ start: { x: SX, y: y - 3.5 }, end: { x: DX, y: y - 3.5 }, thickness: 0.4, color: c.grigioChiaro });
        c.stato.y -= st.passo;
      }
      c.stato.y -= 3 + aria(1);   /* l'ultima riga non deve toccare quel che segue */
    }
  }
  if (!visite.length) c.scrivi('Nessuna visita nel mese.', c.italic, 9, c.grigio);

  /* totale e avviso RLST */
  serve(28);
  const yT = c.stato.y + 8;
  c.stato.pagina.drawRectangle({ x: SX, y: yT - 16, width: DX - SX, height: 17, color: c.arancio });
  c.stato.pagina.drawText(`TOTALE VISITE ${visite.length}`, { x: SX + 6, y: yT - 11, size: 9, font: c.bold, color: c.bianco });
  const rlstOk = d.rlstPct >= (d.rlstMinimo ?? 20);
  const avv = visite.length
    ? (rlstOk ? `Visite con RLST: ${d.rlstPct}% (minimo ${d.rlstMinimo ?? 20}%)` : `Attenzione: non è stato raggiunto il minimo del ${d.rlstMinimo ?? 20}% delle visite con RLST — ${d.rlstPct}%`)
    : '';
  if (avv) c.stato.pagina.drawText(testoPdf(avv), { x: DX - 8 - c.bold.widthOfTextAtSize(testoPdf(avv), 8), y: yT - 11, size: 8, font: c.bold, color: c.bianco });
  c.stato.y = yT - 26 - aria(4);

  /* docenze, servizi, asseverazioni */
  if (altre.length) {
    bandaTitolo(c, 'RIEPILOGO DA LETTERE DI INCARICO — FORMAZIONE, SERVIZI, ASSEVERAZIONI');
    c.scrivi('In fattura indicare: "Consulenza professionale per Progetto (TITOLO) - (N° ore) attività di docenza" oppure la voce del servizio reso.', c.font, 8.5, c.nero);
    c.stato.y -= aria(4);
    const larg = intestaTabella(c, [['Data', SX + 4], ['Tipo', SX + 52], ['Descrizione', SX + 126], ['Q.tà', SX + 322], ['Tariffa', SX + 364], ['Netto', SX + 410], ['Lordo', DX - 40]]);
    let totAltre = 0;
    for (const p of altre) {
      serve(st.passo + 1.5);
      const y = c.stato.y;
      const t = (s, x, f = c.font) => c.stato.pagina.drawText(taglia(f, st.corpo, testoPdf(String(s ?? '')), larg[x]), { x, y, size: st.corpo, font: f, color: c.nero });
      t(dataIt(p.data), SX + 4); t(TIPI_PRESTAZIONE[p.tipo] || p.tipo, SX + 52); t(p.descrizione || '', SX + 126);
      t(`${p.quantita ?? 1} ${p.unita || ''}`, SX + 322); t(p.tariffa_unitaria != null ? euro(p.tariffa_unitaria) : '—', SX + 364);
      t(euro(p.importo), SX + 410, c.bold);
      c.stato.pagina.drawText(euro(lordoDi(p.importo, d.fisc)), { x: DX - 4 - c.font.widthOfTextAtSize(euro(lordoDi(p.importo, d.fisc)), st.corpo), y, size: st.corpo, font: c.font, color: c.nero });
      totAltre += Number(p.importo || 0);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 3.5 }, end: { x: DX, y: y - 3.5 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= st.passo;
    }
    serve(16);
    const tt = `Totale altre attività: netto ${euro(totAltre)} — lordo ${euro(lordoDi(totAltre, d.fisc))}`;
    c.stato.pagina.drawText(tt, { x: DX - 4 - c.bold.widthOfTextAtSize(tt, 8.5), y: c.stato.y, size: 8.5, font: c.bold, color: c.arancio });
    c.stato.y -= 12 + aria(6);
  }

  /* BLOCCO FINALE, tutto insieme: riquadro del totale, note, saluto, firma.
     Si misura prima: se non ci sta intero va intero alla pagina dopo. */
  const larghezza = DX - SX;
  const righeNota = d.note ? aCapo(c.font, 9, d.note, larghezza) : [];
  const saluto = aCapo(c.font, 9, "Una volta emessa la fattura si prega di inviarne copia anche all'indirizzo cpt@formedilpadova.it. Cordiali saluti.", larghezza);
  const h = 44;
  const hFirma = 8 + aria(6) + 26;
  const hBlocco = (h - 8) + 14 + (righeNota.length ? righeNota.length * 13 + 4 : 0) + saluto.length * 13 + hFirma;
  if (c.stato.y - hBlocco < FONDO) c.nuovaPagina();

  const y0 = c.stato.y - h + 8;
  c.stato.pagina.drawRectangle({ x: SX, y: y0, width: DX - SX, height: h, borderColor: c.arancio, borderWidth: 1.4 });
  const regime = d.fisc?.regime === 'forfettario'
    ? `regime forfettario — cassa ${d.fisc?.cassa_pct ?? 4}%, IVA non dovuta`
    : `cassa previdenziale ${d.fisc?.cassa_pct ?? 4}% + IVA ${d.fisc?.iva_pct ?? 22}%`;
  c.stato.pagina.drawText('TOTALE DEL MESE DA FATTURARE', { x: SX + 10, y: y0 + h - 16, size: 9.5, font: c.bold, color: c.arancio });
  c.stato.pagina.drawText(testoPdf(`Netto ${euro(d.totNetto)}  —  Totale oneri e IVA inclusi ${euro(d.totLordo)}  (${regime})`), { x: SX + 10, y: y0 + h - 32, size: 9, font: c.bold, color: c.nero });
  c.stato.y = y0 - 14;

  for (const r of righeNota) { c.stato.pagina.drawText(r, { x: SX, y: c.stato.y, size: 9, font: c.font, color: c.nero }); c.stato.y -= 13; }
  if (righeNota.length) c.stato.y -= 4;
  for (const r of saluto) { c.stato.pagina.drawText(r, { x: SX, y: c.stato.y, size: 9, font: c.font, color: c.nero }); c.stato.y -= 13; }

  /* la firma, attaccata al saluto */
  c.stato.y -= 8 + aria(6);
  c.stato.pagina.drawText(`Padova, ${dataIt(prot?.data_prot || new Date().toISOString().slice(0, 10))}`, { x: SX, y: c.stato.y, size: 10, font: c.font, color: c.nero });
  c.stato.pagina.drawText('FORMEDIL PADOVA', { x: 380, y: c.stato.y + 4, size: 10, font: c.bold, color: c.nero });
  c.stato.pagina.drawText(ENTE.area.toUpperCase(), { x: 380, y: c.stato.y - 8, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('La Segreteria', { x: 380, y: c.stato.y - 22, size: 10, font: c.italic, color: c.nero });
  c.stato.y -= 26;
  return c;
}

/* ── 3. mandato di pagamento ──
   fatture = righe s_fatture_tecnici approvate, ognuna con
   { incarico: riga s_incarichi_mensili | null, cantieri_visitati }
   visto = null per il mandato che parte; dopo la presa visione
   dell'Amministrazione (16/09/2026) { nome, data_ora, utente } e la
   firma scansionata, se c'è: si stampano nel riquadro «Per ricevuta
   Amministrazione». Il documento è lo stesso, rigenerato col visto. */
export async function pdfMandato(mandato, fatture, visto = null, firmaByte = null) {
  const c = await apriCarta();
  c.stato.pagina.drawText(dataIt(mandato.data), { x: DX - 60, y: c.stato.y + 8, size: 9, font: c.font, color: c.grigio });
  c.scrivi('Riepilogo delle visite in cantiere effettuate dai Tecnici di FORMEDIL PADOVA. Per ogni incaricato sono indicati: il numero dei cantieri assegnati per mese di riferimento, il totale dei cantieri effettivamente visitati, la data di ricevimento della fattura e la data di approvazione per il pagamento da parte del Coordinatore.', c.font, 8.5, c.grigio);
  c.stato.y -= 8;
  c.scrivi('MANDATO DI PAGAMENTO AREA SICUREZZA E SALUTE', c.bold, 13, c.nero);
  c.scrivi(`Mandato n° ${mandato.id} del ${dataIt(mandato.data)} — documento interno, senza protocollo.`, c.italic, 8, c.grigio);
  c.stato.y -= 4;
  c.scrivi("Si autorizza l'emissione degli ordinativi di pagamento per le seguenti fatture:", c.font, 10);
  c.stato.y -= 6;

  const perTecnico = {};
  for (const f of fatture) (perTecnico[f.tecnico_nome || '?'] = perTecnico[f.tecnico_nome || '?'] || []).push(f);
  let totale = 0;
  for (const [tecnico, ff] of Object.entries(perTecnico)) {
    bandaTitolo(c, tecnico.toUpperCase());
    const larg = intestaTabella(c, [['Mese di rif.', SX + 4], ['Assegnazione', SX + 78], ['Assegnati', SX + 148], ['Visitati', SX + 200], ['Ricevimento', SX + 246], ['Approvazione', SX + 312], ['N° fattura', SX + 380], ['Importo', DX - 52]]);
    let totT = 0;
    for (const f of ff) {
      /* La dicitura della fattura va a capo invece di essere tagliata a
         meta' parola: e' quella che dice all'Amministrazione a che cosa
         si riferisce l'importo. Oltre tre righe si taglia, coi puntini. */
      const nota = f.note ? spezza(c.italic, 7, testoPdf(String(f.note)), DX - SX - 8, 3) : [];
      c.serve(26 + (nota.length ? (nota.length - 1) * 9 : 0));
      const y = c.stato.y;
      const inc = f.incarico;
      const t = (s, x, f2 = c.font) => c.stato.pagina.drawText(taglia(f2, 7.8, testoPdf(String(s ?? '')), larg[x]), { x, y, size: 7.8, font: f2, color: c.nero });
      t(inc ? `${MESI[inc.mese - 1]} ${inc.anno}` : '—', SX + 4);
      t(inc?.data_lettera ? dataIt(inc.data_lettera) : '—', SX + 78);
      t(inc?.cantieri_assegnati ?? '—', SX + 148);
      t(f.cantieri_visitati ?? f.cantieri_fatturati ?? '—', SX + 200);
      t(f.data_ricevimento ? dataIt(f.data_ricevimento) : '—', SX + 246);
      t(f.approvata_il ? dataIt(f.approvata_il) : '—', SX + 312);
      t(f.numero || '—', SX + 380, c.bold);
      const imp = euro(f.importo);
      c.stato.pagina.drawText(imp, { x: DX - 6 - c.bold.widthOfTextAtSize(imp, 8.2), y, size: 8.2, font: c.bold, color: c.nero });
      nota.forEach((riga, i) => c.stato.pagina.drawText(riga, { x: SX + 4, y: y - 10 - i * 9, size: 7, font: c.italic, color: c.grigio }));
      const yRiga = y - 15 - (nota.length ? (nota.length - 1) * 9 : 0);
      c.stato.pagina.drawLine({ start: { x: SX, y: yRiga }, end: { x: DX, y: yRiga }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y = yRiga - 9;
      totT += Number(f.importo || 0);
    }
    c.serve(14);
    const tt = `totale tecnico: ${euro(totT)}`;
    c.stato.pagina.drawText(tt, { x: DX - 6 - c.bold.widthOfTextAtSize(tt, 8.5), y: c.stato.y, size: 8.5, font: c.bold, color: c.arancio });
    c.stato.y -= 18;
    totale += totT;
  }

  c.serve(70);
  const h = 40; const y0 = c.stato.y - h + 8;
  c.stato.pagina.drawRectangle({ x: SX, y: y0, width: DX - SX, height: h, color: c.grigioChiaro });
  c.stato.pagina.drawText(`Importo totale: ${euro(totale)}`, { x: SX + 10, y: y0 + h - 16, size: 11, font: c.bold, color: c.nero });
  c.stato.pagina.drawText(testoPdf(`Importo totale in lettere: ${euro(totale)} .=(${inLettere(totale)})`), { x: SX + 10, y: y0 + h - 31, size: 8.5, font: c.italic, color: c.nero });
  c.stato.y = y0 - 30;

  c.serve(visto ? 110 : 60);
  c.stato.pagina.drawText('Il Coordinatore / Il Direttore', { x: SX, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('Per ricevuta Amministrazione', { x: 380, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
  const yTitoli = c.stato.y;
  c.stato.y -= visto ? 58 : 26;
  c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y }, end: { x: SX + 160, y: c.stato.y }, thickness: 0.6, color: c.grigio });
  c.stato.pagina.drawLine({ start: { x: 380, y: c.stato.y }, end: { x: DX, y: c.stato.y }, thickness: 0.6, color: c.grigio });
  if (visto) {
    /* la firma sta sopra la linea, fra il titolo e la linea; sotto,
       nome, data-ora e utente: è quello che lega il visto all'accesso
       all'app, e vale anche se la firma scansionata non c'è */
    if (firmaByte) {
      try {
        let img;
        try { img = await c.doc.embedPng(firmaByte); } catch { img = await c.doc.embedJpg(firmaByte); }
        const alto = yTitoli - 6 - (c.stato.y + 2);
        const scala = Math.min((DX - 380) / img.width, alto / img.height);
        const w = img.width * scala;
        c.stato.pagina.drawImage(img, { x: 380 + ((DX - 380) - w) / 2, y: c.stato.y + 2, width: w, height: img.height * scala });
      } catch { /* firma non leggibile: il visto vale lo stesso */ }
    }
    const riga = (testo, dy, font, size, colore) => c.stato.pagina.drawText(
      taglia(font, size, testoPdf(testo), DX - 380), { x: 380, y: c.stato.y - dy, size, font, color: colore });
    riga(visto.nome, 12, c.bold, 9, c.nero);
    riga(`Presa visione: ${visto.data_ora}`, 23, c.font, 8, c.nero);
    riga("Registrata dall'app Segreteria dall'utente", 33, c.font, 6.8, c.grigio);
    riga(visto.utente || '', 41, c.font, 6.8, c.grigio);
    c.stato.y -= 48;
  }
  return salva(c.doc);
}
