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
import { dataIt, siglaProtocollo, testoPdf } from './comune.js';
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

export const TIPO_ACCESSO = {
  1: 'a vista', 2: 'da notifica preliminare', 4: 'su richiesta', 5: 'programmata',
  6: 'su segnalazione', 7: 'indicata dal CPT', 8: 'adesione servizio visite in serie',
  9: 'stage / ASL', 10: 'asseverazione',
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
  c.scrivi(`Oggetto: Comunicazione visite in cantiere — mese di ${MESI[inc.mese - 1]} ${inc.anno}.`, c.bold, 10.5, c.nero);
  c.stato.y -= 6;

  c.campo('Cantieri assegnati', String(inc.cantieri_assegnati ?? 0));
  if (inc.seconde_visite) c.campo('Seconde visite', String(inc.seconde_visite));
  if (inc.altro) c.campo('Altro', String(inc.altro));
  if (d.comuni?.length) c.campo('Comuni di competenza', d.comuni.join(', '));
  c.stato.y -= 6;

  /* cantieri con ritorno previsto (dallo scadenzario del gestionale) */
  bandaTitolo(c, `CANTIERI CON RITORNO PREVISTO DA RICHIUDERE (${d.ncAperte?.length || 0})`);
  if (d.ncAperte?.length) {
    intestaTabella(c, [['Verbale', SX + 4], ['Ultima visita', SX + 62], ['Ritorno', SX + 122], ['Impresa', SX + 178], ['Comune', SX + 370], ['IPC', DX - 28]]);
    for (const r of d.ncAperte) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, w, f = c.font) => c.stato.pagina.drawText(testoPdf(String(s ?? '')).slice(0, w), { x, y, size: 7.8, font: f, color: c.nero });
      t(r.nr_verbale, SX + 4, 14); t(dataIt(r.data_visita), SX + 62, 12); t(r.ritorno ? dataIt(r.ritorno) : '—', SX + 122, 12, c.bold);
      t(r.impresa || '', SX + 178, 40); t(r.comune || '', SX + 370, 26); t(r.ipc || '', DX - 28, 4, c.bold);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
  } else {
    c.scrivi('Nessun cantiere con ritorno previsto.', c.italic, 9, c.grigio);
  }
  c.stato.y -= 6;

  /* richieste in attesa (incarichi aperti del gestionale) */
  bandaTitolo(c, `RICHIESTE IN ATTESA — SERIE DI VISITE, RICHIESTE DA IMPRESA, STAGE, SEGNALAZIONI (${d.richieste?.length || 0})`);
  if (d.richieste?.length) {
    intestaTabella(c, [['N°', SX + 4], ['Data', SX + 40], ['Tipologia', SX + 100], ['Impresa', SX + 250], ['Comune', SX + 400]]);
    for (const r of d.richieste) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, w, f = c.font) => c.stato.pagina.drawText(testoPdf(String(s ?? '')).slice(0, w), { x, y, size: 7.8, font: f, color: c.nero });
      t(r.id, SX + 4, 6, c.bold); t(dataIt(r.data_richiesta), SX + 40, 12); t(r.tipologia_richiesta || r.tipo_richiesta || '', SX + 100, 34);
      t(r.impresa || '', SX + 250, 32); t(r.comune || '', SX + 400, 22);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
  } else {
    c.scrivi('Nessuna richiesta in attesa.', c.italic, 9, c.grigio);
  }
  c.stato.y -= 8;

  if (inc.note) { c.scrivi(inc.note, c.font, 9.5); c.stato.y -= 6; }
  if (d.testo) {
    for (const par of String(d.testo).split(/\n{2,}/)) { c.scrivi(par, c.font, 9, c.nero); c.stato.y -= 4; }
  }
  c.stato.y -= 4;
  c.scrivi(`L'incarico vale per il mese indicato. Per ogni chiarimento resta a disposizione il coordinatore${d.coordinatore ? ` (${d.coordinatore})` : ''}.`, c.italic, 8.5, c.grigio);
  firmaSegreteria(c, prot);
  return salva(c.doc);
}

/* ── 2. riepilogo attività da fatturare ──
   d = { tecnico, prestazioni[], fisc, rlstPct, rlstMinimo, totNetto, totLordo,
         cantieriVisitati, note } */
export async function pdfRiepilogo(inc, prot, d) {
  const c = await apriCarta();
  testataTecnico(c, prot, d.tecnico, inc.area_zona, prot.data_prot);
  c.scrivi('Oggetto: Comunicazione riepilogo attività da fatturare.', c.bold, 10.5, c.nero);
  c.stato.y -= 4;
  c.campo('Mese di riferimento', `${MESI[inc.mese - 1]} ${inc.anno}`);
  c.campo('Cantieri assegnati', `${inc.cantieri_assegnati ?? 0}${inc.altro ? `  —  Altro: ${inc.altro}` : ''}`);
  c.campo('Cantieri visitati', String(d.cantieriVisitati ?? 0));
  /* il riepilogo elenca le attivita' ancora senza fattura, non «quelle del
     mese»: se ne arrivano da mesi precedenti va detto, altrimenti il
     tecnico trova righe con date che non tornano col titolo */
  if (d.arretrate) c.campo('Attivita di mesi precedenti', `${d.arretrate} — non ancora coperte da una fattura`);
  c.stato.y -= 6;

  const visite = d.prestazioni.filter((p) => String(p.tipo).startsWith('visita_'));
  const altre = d.prestazioni.filter((p) => !String(p.tipo).startsWith('visita_'));

  bandaTitolo(c, 'RIEPILOGO VISITE IN CANTIERE');
  c.scrivi('Dicitura in fattura per le visite ordinarie:', c.bold, 8.5, c.nero);
  c.scrivi(`- "Consulenza professionale per (N°) sopralluoghi in cantiere mese di ${MESI[inc.mese - 1]} prime visite"`, c.font, 8.5, c.nero, 10);
  c.scrivi(`- "Consulenza professionale per (N°) sopralluoghi in cantiere mese di ${MESI[inc.mese - 1]} seconde visite"`, c.font, 8.5, c.nero, 10);
  c.scrivi('Visite di progetto: "Consulenza professionale per Progetto (titolo) - (N°) attività di audit in cantiere"', c.font, 8.5, c.nero, 10);
  c.scrivi('Visite stage: "Consulenza professionale per (N°) visite stage in cantiere"', c.font, 8.5, c.nero, 10);
  c.stato.y -= 6;

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
    c.stato.y = yB - 26;

    /* sottogruppi per tipo di accesso, come la stampa Access */
    const perAccesso = {};
    for (const p of righe) (perAccesso[p.tipo_accesso ?? ''] = perAccesso[p.tipo_accesso ?? ''] || []).push(p);
    for (const [acc, rr] of Object.entries(perAccesso)) {
      c.serve(26);
      c.stato.pagina.drawText(testoPdf(`${rr.length} ${TIPO_ACCESSO[acc] || (acc ? `tipo ${acc}` : 'visita')}`), { x: SX + 14, y: c.stato.y, size: 8, font: c.italic, color: c.grigio });
      c.stato.y -= 12;
      intestaTabella(c, [['Data', SX + 4], ['Impresa', SX + 56], ['Stage', SX + 262], ['Accesso n°', SX + 296], ['Verbale n°', SX + 350], ['RLST', SX + 404], ['Importo', DX - 42]]);
      for (const p of rr) {
        c.serve(14);
        const y = c.stato.y;
        const t = (s, x, w, f = c.font) => c.stato.pagina.drawText(testoPdf(String(s ?? '')).slice(0, w), { x, y, size: 7.8, font: f, color: c.nero });
        t(dataIt(p.data), SX + 4, 12);
        t(p.impresa || p.descrizione || '', SX + 56, 42);
        t(p.stage ? 'Sì' : 'No', SX + 262, 3);
        t(p.accesso_n ?? '', SX + 296, 6);
        t((p.nr_verbale || '').replace(/^CPT\/\d\d_\d\d\//, ''), SX + 350, 12, c.bold);
        t(p.rlst ? 'Sì' : 'No', SX + 404, 3);
        c.stato.pagina.drawText(euro(p.importo), { x: DX - 4 - c.font.widthOfTextAtSize(euro(p.importo), 7.8), y, size: 7.8, font: c.font, color: c.nero });
        c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
        c.stato.y -= 12.5;
      }
      c.stato.y -= 4;
    }
  }
  if (!visite.length) c.scrivi('Nessuna visita nel mese.', c.italic, 9, c.grigio);

  /* totale e avviso RLST */
  c.serve(28);
  const yT = c.stato.y + 8;
  c.stato.pagina.drawRectangle({ x: SX, y: yT - 16, width: DX - SX, height: 17, color: c.arancio });
  c.stato.pagina.drawText(`TOTALE VISITE ${visite.length}`, { x: SX + 6, y: yT - 11, size: 9, font: c.bold, color: c.bianco });
  const rlstOk = d.rlstPct >= (d.rlstMinimo ?? 20);
  const avv = visite.length
    ? (rlstOk ? `Visite con RLST: ${d.rlstPct}% (minimo ${d.rlstMinimo ?? 20}%)` : `Attenzione: non è stato raggiunto il minimo del ${d.rlstMinimo ?? 20}% delle visite con RLST — ${d.rlstPct}%`)
    : '';
  if (avv) c.stato.pagina.drawText(testoPdf(avv), { x: DX - 8 - c.bold.widthOfTextAtSize(testoPdf(avv), 8), y: yT - 11, size: 8, font: c.bold, color: c.bianco });
  c.stato.y = yT - 30;

  /* docenze, servizi, asseverazioni */
  if (altre.length) {
    bandaTitolo(c, 'RIEPILOGO DA LETTERE DI INCARICO — FORMAZIONE, SERVIZI, ASSEVERAZIONI');
    c.scrivi('In fattura indicare: "Consulenza professionale per Progetto (TITOLO) - (N° ore) attività di docenza" oppure la voce del servizio reso.', c.font, 8.5, c.nero);
    c.stato.y -= 4;
    intestaTabella(c, [['Data', SX + 4], ['Tipo', SX + 52], ['Descrizione', SX + 126], ['Q.tà', SX + 322], ['Tariffa', SX + 364], ['Netto', SX + 410], ['Lordo', DX - 40]]);
    let totAltre = 0;
    for (const p of altre) {
      c.serve(14);
      const y = c.stato.y;
      const t = (s, x, w, f = c.font) => c.stato.pagina.drawText(testoPdf(String(s ?? '')).slice(0, w), { x, y, size: 7.8, font: f, color: c.nero });
      t(dataIt(p.data), SX + 4, 12); t(TIPI_PRESTAZIONE[p.tipo] || p.tipo, SX + 52, 16); t(p.descrizione || '', SX + 126, 42);
      t(`${p.quantita ?? 1} ${p.unita || ''}`, SX + 322, 9); t(p.tariffa_unitaria != null ? euro(p.tariffa_unitaria) : '—', SX + 364, 9);
      t(euro(p.importo), SX + 410, 10, c.bold);
      c.stato.pagina.drawText(euro(lordoDi(p.importo, d.fisc)), { x: DX - 4 - c.font.widthOfTextAtSize(euro(lordoDi(p.importo, d.fisc)), 7.8), y, size: 7.8, font: c.font, color: c.nero });
      totAltre += Number(p.importo || 0);
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 4 }, end: { x: DX, y: y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 12.5;
    }
    c.serve(16);
    const tt = `Totale altre attività: netto ${euro(totAltre)} — lordo ${euro(lordoDi(totAltre, d.fisc))}`;
    c.stato.pagina.drawText(tt, { x: DX - 4 - c.bold.widthOfTextAtSize(tt, 8.5), y: c.stato.y, size: 8.5, font: c.bold, color: c.arancio });
    c.stato.y -= 18;
  }

  /* riquadro totale del mese */
  c.serve(60);
  const h = 44; const y0 = c.stato.y - h + 8;
  c.stato.pagina.drawRectangle({ x: SX, y: y0, width: DX - SX, height: h, borderColor: c.arancio, borderWidth: 1.4 });
  const regime = d.fisc?.regime === 'forfettario'
    ? `regime forfettario — cassa ${d.fisc?.cassa_pct ?? 4}%, IVA non dovuta`
    : `cassa previdenziale ${d.fisc?.cassa_pct ?? 4}% + IVA ${d.fisc?.iva_pct ?? 22}%`;
  c.stato.pagina.drawText('TOTALE DEL MESE DA FATTURARE', { x: SX + 10, y: y0 + h - 16, size: 9.5, font: c.bold, color: c.arancio });
  c.stato.pagina.drawText(testoPdf(`Netto ${euro(d.totNetto)}  —  Totale oneri e IVA inclusi ${euro(d.totLordo)}  (${regime})`), { x: SX + 10, y: y0 + h - 32, size: 9, font: c.bold, color: c.nero });
  c.stato.y = y0 - 14;

  if (d.note) { c.scrivi(d.note, c.font, 9); c.stato.y -= 4; }
  c.scrivi("Una volta emessa la fattura si prega di inviarne copia anche all'indirizzo cpt@formedilpadova.it. Cordiali saluti.", c.font, 9);
  firmaSegreteria(c, prot);
  return salva(c.doc);
}

/* ── 3. mandato di pagamento ──
   fatture = righe s_fatture_tecnici approvate, ognuna con
   { incarico: riga s_incarichi_mensili | null, cantieri_visitati } */
export async function pdfMandato(mandato, fatture) {
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
    intestaTabella(c, [['Mese di rif.', SX + 4], ['Assegnazione', SX + 78], ['Assegnati', SX + 148], ['Visitati', SX + 200], ['Ricevimento', SX + 246], ['Approvazione', SX + 312], ['N° fattura', SX + 380], ['Importo', DX - 52]]);
    let totT = 0;
    for (const f of ff) {
      c.serve(26);
      const y = c.stato.y;
      const inc = f.incarico;
      const t = (s, x, w, f2 = c.font) => c.stato.pagina.drawText(testoPdf(String(s ?? '')).slice(0, w), { x, y, size: 7.8, font: f2, color: c.nero });
      t(inc ? `${MESI[inc.mese - 1]} ${inc.anno}` : '—', SX + 4, 16);
      t(inc?.data_lettera ? dataIt(inc.data_lettera) : '—', SX + 78, 12);
      t(inc?.cantieri_assegnati ?? '—', SX + 148, 6);
      t(f.cantieri_visitati ?? f.cantieri_fatturati ?? '—', SX + 200, 6);
      t(f.data_ricevimento ? dataIt(f.data_ricevimento) : '—', SX + 246, 12);
      t(f.approvata_il ? dataIt(f.approvata_il) : '—', SX + 312, 12);
      t(f.numero || '—', SX + 380, 12, c.bold);
      const imp = euro(f.importo);
      c.stato.pagina.drawText(imp, { x: DX - 6 - c.bold.widthOfTextAtSize(imp, 8.2), y, size: 8.2, font: c.bold, color: c.nero });
      if (f.note) c.stato.pagina.drawText(testoPdf(String(f.note)).slice(0, 110), { x: SX + 4, y: y - 10, size: 7, font: c.italic, color: c.grigio });
      c.stato.pagina.drawLine({ start: { x: SX, y: y - 15 }, end: { x: DX, y: y - 15 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 24;
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

  c.serve(60);
  c.stato.pagina.drawText('Il Coordinatore / Il Direttore', { x: SX, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('Per ricevuta Amministrazione', { x: 380, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
  c.stato.y -= 26;
  c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y }, end: { x: SX + 160, y: c.stato.y }, thickness: 0.6, color: c.grigio });
  c.stato.pagina.drawLine({ start: { x: 380, y: c.stato.y }, end: { x: DX, y: c.stato.y }, thickness: 0.6, color: c.grigio });
  return salva(c.doc);
}
