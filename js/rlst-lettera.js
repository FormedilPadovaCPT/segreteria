/* ============================================================
   La lettera di risposta a una richiesta di affidamento RLST.

   Due varianti, come da prassi dell'ufficio:
   - AFFIDAMENTO (impresa iscritta CEIV): i contatti degli RLST di
     ASC Veneto presi da s_config.rlst_contatti — il competente per
     Padova e Rovigo per primo — la riga «Documenti ricevuti» col
     verbale di non elezione (o l'avviso che lo controllerà l'RLST),
     e il link alla NOTA RLST Veneto;
   - NEGATIVA (non iscritta): la richiesta va all'organismo
     paritetico della categoria dell'impresa.

   Il PDF nasce su carta intestata Formedil disegnata qui con
   pdf-lib (logo + dati ente da config.js): niente modelli Word,
   niente campi da ricopiare. Il numero di protocollo è già nel
   testo e nel nome del file.
   ============================================================ */

import { ENTE, COLORI } from './config.js';
import { pdfLib } from './cdn.js';
import { dataIt, siglaProtocollo } from './comune.js';

/* ── testi ────────────────────────────────────────────────── */

export const ISTITUZIONALE =
  "Lo scrivente Formedil Padova — Scuola Costruzioni Giuseppe Jappelli, Ente Unico per la " +
  "Formazione e la Sicurezza per il settore dell'Edilizia ed affini della Provincia di Padova, " +
  "costituito da rappresentanti del Collegio Costruttori Edili della Provincia di Padova e da " +
  "rappresentanti delle Organizzazioni Territoriali dei Lavoratori FeNEAL-UIL, FILCA-CISL e " +
  "FILLEA-CGIL, ha il compito di curare la prevenzione degli infortuni e l'applicazione delle " +
  "norme vigenti in materia nei cantieri edili della ns. Provincia.";

export function corpoAffidamento(p, contatti, notaUrl) {
  const ordinati = [...contatti].sort((a, b) => (b.competente ? 1 : 0) - (a.competente ? 1 : 0));
  const elenco = ordinati.map((c) =>
    `- sig. ${c.nome} — Cell. ${c.cell} — Mail ${c.email}, operante nella zona di competenza ` +
    `compresa nelle province di ${c.zona}${c.competente ? ' (il riferimento per la Vostra impresa)' : ''}`);

  const verbale = p.data_verbale
    ? `Documenti ricevuti: verbale di assemblea di non elezione del RLS del ${p.data_verbale}` +
      `${p.luogo_riunione ? ` (${p.luogo_riunione})` : ''}.`
    : 'Il verbale di assemblea di non elezione del RLS interno non risulta pervenuto: ' +
      "sarà verificato dall'RLST alla presa in carico dell'impresa.";

  return [
    ISTITUZIONALE,
    'Con riferimento alla Vostra richiesta vogliate trovare qui sotto riportati i contatti degli ' +
    'RLST — scelti congiuntamente dalle Segreterie regionali del Veneto di Feneal-Uil, Filca-Cisl ' +
    'e Fillea-Cgil tra persone con adeguata esperienza lavorativa nel settore edile — dipendenti ' +
    "dell'Associazione per la Sicurezza Costruzioni del Veneto (A.S.C. Veneto — Via Piave n. 7 — " +
    '30171 Mestre Venezia). Essi sono rispettivamente:',
    ...elenco,
    'Muniti di appropriata tessera di riconoscimento ed equipaggiati con DPI per l’accesso ai ' +
    'cantieri, agli RLST sono riconosciute le attribuzioni previste dall’art. 50 del T.U. per la ' +
    'Sicurezza (D.Lgs. n. 81/2008 e smi) e dall’art. 87 del Ccnl per l’industria edile.',
    verbale,
    ...(notaUrl ? [`Nota operativa RLST Veneto: ${notaUrl}`] : []),
    'Rimaniamo a disposizione per ulteriori chiarimenti.',
    'Distinti saluti.',
  ];
}

export function corpoNegativa(p) {
  return [
    ISTITUZIONALE,
    'A seguito di un controllo effettuato presso C.E.I.V. (Cassa Edile Interprovinciale del ' +
    `Veneto), ${(p.ragione_sociale || 'la Vostra impresa').toUpperCase()} non risulta iscritta; ciò considerato, con riferimento ` +
    'alla Vostra richiesta di affidamento al servizio di RLS-T ci spiace informarVi che, essendo ' +
    'Formedil Padova ente paritetico e bilaterale con riferimento al settore edile industriale, ' +
    'tale richiesta dovrà essere inoltrata all’organismo paritetico della Vs. ' +
    'categoria/associazione.',
    'Rimaniamo a disposizione per ulteriori chiarimenti.',
    'Distinti saluti.',
  ];
}

/* Il riscontro alla comunicazione dell'RLS aziendale: iscrizione nel
   «Registro Anagrafe degli R.L.S.» (CCNL allegato 2 e CCPL 3/3/2022),
   promemoria della formazione ex art. 37 co. 11 e dell'obbligo di
   aggiornamento annuale, invito a comunicare gli avvicendamenti.
   Testo ricalcato sulla lettera storica dell'ufficio. */
export function corpoRiscontroRls(p) {
  const rls = [p.rls_titolo, p.rls_cognome, p.rls_nome].filter(Boolean).join(' ') || p.rls_nominativo || 'il nominativo comunicato';
  const rielezione = /riel/i.test(p.tipo_elezione || '');
  return [
    ISTITUZIONALE,
    `Con riferimento alla Vostra comunicazione di ${rielezione ? 'rielezione' : 'elezione'} dell'RLS` +
    `${p.data_verbale ? ` del ${p.data_verbale}` : ''}${p.protocollo_verbale ? `, Vs. Prot. ${p.protocollo_verbale}` : ''}, ` +
    'in attuazione di quanto stabilito nell’allegato 2 dell’accordo di rinnovo del Contratto ' +
    'Collettivo Nazionale di Lavoro per i dipendenti delle imprese edili ed affini e delle ' +
    'Cooperative, e dell’aggiornamento del Contratto Collettivo Provinciale di Lavoro del ' +
    '3 marzo 2022, lo scrivente Ente inserisce nel proprio «Registro Anagrafe degli R.L.S.» ' +
    `${rls}${p.rls_cf ? ` — Cod. Fisc. ${p.rls_cf}` : ''}, al ruolo di Rappresentante dei ` +
    `Lavoratori per la Sicurezza${p.decorrenza ? ` a decorrere dal ${p.decorrenza.split('-').reverse().join('/')}` : ''}.`,
    'Come indicato nel D.Lgs. 81/08 e s.m.i. (art. 37 co. 11) il Rappresentante dei Lavoratori ' +
    'per la Sicurezza ha diritto ad una formazione particolare in materia di salute e sicurezza ' +
    'concernente i rischi specifici esistenti negli ambiti in cui esercita la propria ' +
    'rappresentanza, tale da assicurargli adeguate competenze sulle principali tecniche di ' +
    'controllo e prevenzione dei rischi stessi.',
    'Ricordiamo che l’art. 37 comma 11 del D.Lgs. 81/08 ha introdotto l’obbligo di aggiornamento ' +
    'annuale dei Rappresentanti dei Lavoratori per la Sicurezza della seguente durata:',
    '- non inferiore a 4 ore per le imprese che occupano dai 15 ai 50 lavoratori',
    '- non inferiore a 8 ore per le imprese che occupano più di 50 lavoratori',
    'Ricordiamo inoltre di comunicare alla scrivente ogni eventuale successiva variazione ' +
    'sull’avvicendamento dell’RLS.',
    'Rimaniamo a disposizione per ogni eventuale chiarimento.',
    'Distinti saluti.',
  ];
}

/* ── il PDF ───────────────────────────────────────────────── */

export async function generaLetteraPdf(p, protocollo, paragrafi, oggettoRiga) {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let pagina = doc.addPage([595.28, 841.89]);   // A4
  const arancio = rgb(...COLORI.arancio);
  const grigio = rgb(...COLORI.grigio);
  const nero = rgb(0.1, 0.1, 0.1);
  const SX = 57, DX = 538;
  let y = 800;

  /* le lettere con molti riepiloghi (es. riscontro notifica cantiere)
     non stanno in una pagina: quando il corpo arriva in fondo si
     continua su una pagina nuova, senza testata */
  const nuovaPagina = () => {
    pagina = doc.addPage([595.28, 841.89]);
    y = 790;
  };

  /* logo, se raggiungibile: la carta regge anche senza */
  try {
    const logoBytes = new Uint8Array(await (await fetch('img/logo.png')).arrayBuffer());
    const logo = await doc.embedPng(logoBytes);
    const w = 120, h = (logo.height / logo.width) * w;
    pagina.drawImage(logo, { x: SX, y: y - h + 8, width: w, height: h });
  } catch { /* niente logo */ }

  /* intestazione a destra */
  const testataDx = [
    [ENTE.nome, bold, 10, arancio],
    [ENTE.sotto, bold, 8.5, grigio],
    ["Ente Unico per la Formazione e la Sicurezza per il settore", font, 6.5, grigio],
    ["dell'Edilizia ed affini della Provincia di Padova", font, 6.5, grigio],
    ['ANCE PADOVA  FENEAL UIL  FILCA CISL  FILLEA CGIL', bold, 6.5, grigio],
    ['Accreditamento Regione Veneto L.R. N. 19 del 09.08.02 cod. A0119', font, 6.5, grigio],
    ['CF 80006850285 - P IVA 02585760289 - CCIAA PD n. REA 294715', font, 6.5, grigio],
    [`${ENTE.indirizzo} — tel. ${ENTE.tel}`, font, 6.5, grigio],
    [`${ENTE.email} — ${ENTE.web}`, font, 6.5, grigio],
  ];
  let yDx = y;
  for (const [testo, f, dim, colore] of testataDx) {
    pagina.drawText(testo, { x: 250, y: yDx, size: dim, font: f, color: colore });
    yDx -= dim + 2.5;
  }
  y = Math.min(yDx, y - 60) - 8;
  pagina.drawLine({ start: { x: SX, y }, end: { x: DX, y }, thickness: 1.2, color: arancio });
  y -= 24;

  /* protocollo a sinistra, destinatario a destra */
  pagina.drawText(`Prot. n°: ${siglaProtocollo(protocollo)}`, { x: SX, y, size: 9.5, font: bold, color: nero });
  const destinatario = [
    ['Spett.le Impresa', font, 9.5],
    [(p.ragione_sociale || '').toUpperCase(), bold, 10.5],
    [[p.ind_sede_legale, p.comune_legale].filter(Boolean).join(' — '), font, 9.5],
    ...(p.email ? [[`Email: ${p.email}`, font, 9.5]] : []),
  ];
  let yDest = y;
  for (const [testo, f, dim] of destinatario) {
    if (!testo) continue;
    pagina.drawText(String(testo).slice(0, 60), { x: 300, y: yDest, size: dim, font: f, color: nero });
    yDest -= dim + 3.5;
  }
  y -= 14;
  const rigaSx = (t) => { pagina.drawText(t, { x: SX, y, size: 8.5, font, color: grigio }); y -= 12; };
  if (p.telefono || p.cellulare) rigaSx(`Tel: ${[p.telefono, p.cellulare].filter(Boolean).join(' / ')}`);
  if (p.codice_ceiv_dich) rigaSx(`Cod. CEIV: ${p.codice_ceiv_dich}`);
  if (p.partita_iva) rigaSx(`P.IVA: ${p.partita_iva}`);
  y = Math.min(y, yDest) - 8;

  /* la riga «Alla c.a.»: di norma il legale rappresentante; chi chiama
     puo' sostituirla per intero (es. «e.p.c. alla c.a. <RLS>») */
  const rl = p.alla_ca_riga || (() => {
    const n = [p.rl_titolo, p.rl_cognome, p.rl_nome].filter(Boolean).join(' ');
    return n ? `Alla c.a. ${n}` : '';
  })();
  if (rl) {
    pagina.drawText(rl, { x: 300, y, size: 9.5, font: italic, color: nero });
    y -= 20;
  }

  pagina.drawText('Prevenzione infortuni.', { x: SX, y, size: 10, font: italic, color: nero });
  y -= 18;

  /* a capo automatico */
  const scrivi = (testo, f = font, dim = 10, colore = nero, rientro = 0) => {
    const larghezza = DX - SX - rientro;
    const parole = String(testo).split(/\s+/);
    let riga = '';
    const righe = [];
    for (const w of parole) {
      const prova = riga ? riga + ' ' + w : w;
      if (f.widthOfTextAtSize(prova, dim) > larghezza && riga) { righe.push(riga); riga = w; }
      else riga = prova;
    }
    if (riga) righe.push(riga);
    for (const r of righe) {
      if (y < 90) nuovaPagina();
      pagina.drawText(r, { x: SX + rientro, y, size: dim, font: f, color: colore });
      y -= dim + 4;
    }
  };

  scrivi(oggettoRiga, italic, 10);
  y -= 10;
  for (const par of paragrafi) {
    const elenco = par.startsWith('- ');
    scrivi(par, elenco ? font : font, 10, nero, elenco ? 14 : 0);
    y -= elenco ? 4 : 8;
  }

  /* firma: se il corpo è arrivato in fondo, va su una pagina nuova */
  if (y < 160) nuovaPagina();
  y = Math.max(y - 14, 120);
  pagina.drawText(`Padova, ${dataIt(protocollo.data_prot)}`, { x: SX, y, size: 10, font, color: nero });
  pagina.drawText('FORMEDIL PADOVA', { x: 380, y: y + 4, size: 10, font: bold, color: nero });
  pagina.drawText(ENTE.area.toUpperCase(), { x: 380, y: y - 8, size: 8.5, font, color: grigio });
  pagina.drawText('La Segreteria', { x: 380, y: y - 22, size: 10, font: italic, color: nero });

  return new Uint8Array(await doc.save());
}
