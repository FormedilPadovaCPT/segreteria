/* ============================================================
   I documenti della pratica di segnalazione cantiere.

   Tre PDF, tutti su carta intestata Formedil disegnata con
   pdf-lib (come rlst-lettera.js):

   1. RICHIESTA DI AUTORIZZAZIONE al Direttore — ricalca la
      stampa Access «Richiesta di autorizzazione»: banda arancio
      col tecnico proposto, i dati della segnalazione, il riquadro
      «Firma per approvazione». È un documento INTERNO: non prende
      numero di protocollo (regola del confine), porta il numero
      di pratica.

   2. AUTORIZZAZIONE con VISTO — lo stesso foglio, ma al posto del
      riquadro vuoto c'è il visto del Direttore: esito, nome, data
      e ora, utente che ha approvato dall'app, e la firma se
      configurata (s_config.direttore_firma_id → immagine su Drive).
      È il «firma e timbro» gestito dal programma: si sa che ha
      autorizzato lui perché l'approvazione è legata al suo accesso.

   3. RISCONTRO al segnalante — due varianti:
      - «esito»: il modello «Risposta» dell'ufficio (Richiesta /
        Risposta con l'esito del sopralluogo), per i segnalanti
        del sistema (sindacati, enti, presidenza, CEIV);
      - «presa d'atto»: due righe di ringraziamento e presa in
        carico, senza merito, per chi è fuori dal sistema.
      Il riscontro è protocollato OUT nel registro unico.
   ============================================================ */

import { ENTE, COLORI } from './config.js';
import { pdfLib } from './cdn.js';
import { dataIt, siglaProtocollo } from './comune.js';

const A4 = [595.28, 841.89];
const SX = 57;
const DX = 538;

/* Carta intestata + scrittura con cambio pagina automatico.
   Esportata: la riusa anche corsi-doc.js (attestati, registro, incarichi). */
export async function apriCarta() {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const arancio = rgb(...COLORI.arancio);
  const grigio = rgb(...COLORI.grigio);
  const nero = rgb(0.1, 0.1, 0.1);
  const bianco = rgb(1, 1, 1);

  const stato = { pagina: doc.addPage(A4), y: 800 };

  /* logo, se raggiungibile: la carta regge anche senza */
  let logo = null;
  try {
    const logoBytes = new Uint8Array(await (await fetch('img/logo.png')).arrayBuffer());
    logo = await doc.embedPng(logoBytes);
  } catch { /* niente logo */ }

  const intestazione = () => {
    if (logo) {
      const w = 120, h = (logo.height / logo.width) * w;
      stato.pagina.drawImage(logo, { x: SX, y: stato.y - h + 8, width: w, height: h });
    }
    const righe = [
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
    let yDx = stato.y;
    for (const [testo, f, dim, colore] of righe) {
      stato.pagina.drawText(testo, { x: 250, y: yDx, size: dim, font: f, color: colore });
      yDx -= dim + 2.5;
    }
    stato.y = Math.min(yDx, stato.y - 60) - 8;
    stato.pagina.drawLine({ start: { x: SX, y: stato.y }, end: { x: DX, y: stato.y }, thickness: 1.2, color: arancio });
    stato.y -= 24;
  };
  intestazione();

  const nuovaPagina = () => {
    stato.pagina = doc.addPage(A4);
    stato.y = 800;
  };
  const serve = (h) => { if (stato.y - h < 70) nuovaPagina(); };

  /* a capo automatico + cambio pagina */
  const scrivi = (testo, f = font, dim = 10, colore = nero, rientro = 0) => {
    const larghezza = DX - SX - rientro;
    for (const rigaTesto of String(testo).split(/\n/)) {
      const parole = rigaTesto.split(/\s+/).filter(Boolean);
      let riga = '';
      const righe = [];
      for (const w of parole) {
        const prova = riga ? riga + ' ' + w : w;
        if (f.widthOfTextAtSize(prova, dim) > larghezza && riga) { righe.push(riga); riga = w; }
        else riga = prova;
      }
      righe.push(riga);
      for (const r of righe) {
        serve(dim + 4);
        stato.pagina.drawText(r, { x: SX + rientro, y: stato.y, size: dim, font: f, color: colore });
        stato.y -= dim + 4;
      }
    }
  };

  /* riga etichetta + valore, come nella stampa Access */
  const campo = (etichetta, valore) => {
    if (!valore) return;
    serve(30);
    stato.pagina.drawText(etichetta, { x: SX, y: stato.y, size: 8, font, color: grigio });
    const yEt = stato.y;
    stato.y -= 0;
    const largo = DX - (SX + 130);
    const parole = String(valore).split(/\s+/).filter(Boolean);
    let riga = '';
    const righe = [];
    for (const w of parole) {
      const prova = riga ? riga + ' ' + w : w;
      if (italic.widthOfTextAtSize(prova, 9.5) > largo && riga) { righe.push(riga); riga = w; }
      else riga = prova;
    }
    righe.push(riga || '—');
    let yv = yEt;
    for (const r of righe) {
      if (yv - 13 < 70) { nuovaPagina(); yv = stato.y; }
      stato.pagina.drawText(r, { x: SX + 130, y: yv, size: 9.5, font: italic, color: nero });
      yv -= 13;
    }
    stato.y = Math.min(yEt, yv) - 5;
  };

  const verde = rgb(0.55, 0.71, 0.13);          /* la banda verde degli attestati storici */
  const grigioChiaro = rgb(0.93, 0.93, 0.93);
  return { doc, stato, font, bold, italic, arancio, grigio, nero, bianco, verde, grigioChiaro, scrivi, campo, serve, nuovaPagina };
}

const salva = async (doc) => new Uint8Array(await doc.save());

/* ── i dati della pratica, in righe etichetta+valore ──
   Come array [etichetta, valore]: cosi' lo stesso foglio di
   autorizzazione serve a segnalazioni, consulenze e ai prossimi
   servizi — cambiano i campi, non il documento. */
function campiSegnalazione(p) {
  return [
    ['Pratica', `Segnalazione n° ${p.progressivo || p.id}${p.fonte && p.fonte !== 'modulo' ? ` (arrivata per ${p.fonte})` : ' (modulo online)'}`],
    ['Data segnalazione', p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'],
    ['TipologiaRichiesta', 'Richiesta Visita su segnalazione'],
    ['Segnalante', [p.notificante, p.segnalante_tipo ? `(${p.segnalante_tipo})` : ''].filter(Boolean).join(' ')],
    ['Contatti', [p.telefono, p.email].filter(Boolean).join(' — ')],
    ['Comunicazione', p.motivo],
    ['Stato lavori', p.stato_lavori],
    ['Imprese presenti', p.imprese_presenti],
    ['Indirizzo cantiere', p.ind_cantiere],
    ['Comune cantiere', p.comune_cantiere],
    ['Note', p.note_modulo],
    ['Foto', p.foto_urls ? `${String(p.foto_urls).split(';').filter((s) => s.trim()).length} allegate alla pratica (su Drive)` : null],
  ];
}

function scriviCampi(c, campi) {
  for (const [etichetta, valore] of campi) c.campo(etichetta, valore);
}

/* banda arancio col tecnico, come la stampa Access */
function bandaTecnico(c, nomeTecnico) {
  c.serve(30);
  c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 6, width: DX - SX, height: 20, color: c.arancio });
  c.stato.pagina.drawText('Tecnico proposto per zona:', { x: SX + 6, y: c.stato.y, size: 9, font: c.bold, color: c.bianco });
  const nome = nomeTecnico || 'da assegnare';
  c.stato.pagina.drawText(nome, {
    x: DX - 6 - c.bold.widthOfTextAtSize(nome, 9),
    y: c.stato.y, size: 9, font: c.bold, color: c.bianco,
  });
  c.stato.y -= 30;
}

/* ── 1. richiesta di autorizzazione (riquadro firma vuoto) ── */
export async function pdfRichiestaAut(p, nomeTecnico) {
  return pdfRichiestaAutCampi(campiSegnalazione(p), nomeTecnico,
    'Ai sensi della procedura sui servizi CPT, si chiede al Direttore l’autorizzazione a effettuare la visita di sopralluogo sul cantiere segnalato.');
}

export async function pdfRichiestaAutCampi(campi, nomeTecnico, richiestaTxt) {
  const c = await apriCarta();
  c.scrivi('Richiesta di autorizzazione', c.bold, 15, c.nero);
  c.scrivi(`Padova, ${dataIt(new Date().toISOString().slice(0, 10))}`, c.font, 9, c.grigio);
  c.stato.y -= 8;
  bandaTecnico(c, nomeTecnico);
  scriviCampi(c, campi);
  c.stato.y -= 6;
  c.scrivi(richiestaTxt, c.font, 9.5);

  /* riquadro per la firma */
  c.serve(90);
  const y0 = c.stato.y - 70;
  c.stato.pagina.drawRectangle({ x: 320, y: y0, width: DX - 320, height: 70, borderColor: c.grigio, borderWidth: 0.8 });
  c.stato.pagina.drawText('Approvato   SI □   /   NO □', { x: 332, y: y0 + 50, size: 10, font: c.font, color: c.nero });
  c.stato.pagina.drawText('Firma per approvazione', { x: 332, y: y0 + 8, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('Il Direttore', { x: 332, y: y0 + 34, size: 9.5, font: c.italic, color: c.nero });
  c.stato.y = y0 - 18;
  c.scrivi('Documento interno: non prende numero di protocollo. La pratica è identificata dal numero di segnalazione.', c.font, 7.5, c.grigio);
  return salva(c.doc);
}

/* ── 2. autorizzazione con visto del Direttore ──
   visto = { esito: 'approvata'|'respinta', nome, data_ora, utente, note }
   firmaByte = immagine della firma (png/jpg) o null */
export async function pdfAutorizzazione(p, nomeTecnico, visto, firmaByte) {
  return pdfAutorizzazioneCampi(campiSegnalazione(p), nomeTecnico, visto, firmaByte,
    'Autorizzazione visita su segnalazione');
}

export async function pdfAutorizzazioneCampi(campi, nomeTecnico, visto, firmaByte, titolo) {
  const c = await apriCarta();
  c.scrivi(titolo, c.bold, 15, c.nero);
  c.stato.y -= 8;
  bandaTecnico(c, nomeTecnico);
  scriviCampi(c, campi);
  c.stato.y -= 10;

  /* il visto: riquadro col bordo arancio — numero pratica, esito,
     nome del Direttore, data-ora e utente. È quello che dice che ha
     autorizzato lui: l'approvazione è legata al suo accesso all'app. */
  const ok = visto.esito === 'approvata';
  c.serve(120);
  const h = 96;
  const y0 = c.stato.y - h;
  c.stato.pagina.drawRectangle({ x: SX, y: y0, width: DX - SX, height: h, borderColor: c.arancio, borderWidth: 1.6 });
  c.stato.pagina.drawText(ok ? 'AUTORIZZAZIONE APPROVATA' : 'AUTORIZZAZIONE RESPINTA',
    { x: SX + 12, y: y0 + h - 20, size: 12, font: c.bold, color: c.arancio });
  c.stato.pagina.drawText(`${visto.nome} — Direttore`, { x: SX + 12, y: y0 + h - 38, size: 10.5, font: c.bold, color: c.nero });
  c.stato.pagina.drawText(`Padova, ${visto.data_ora}`, { x: SX + 12, y: y0 + h - 53, size: 9.5, font: c.font, color: c.nero });
  c.stato.pagina.drawText(`Approvazione registrata dall'app Segreteria — utente: ${visto.utente}`,
    { x: SX + 12, y: y0 + h - 68, size: 8, font: c.font, color: c.grigio });
  if (visto.note) c.stato.pagina.drawText(`Note: ${String(visto.note).slice(0, 90)}`, { x: SX + 12, y: y0 + h - 82, size: 8, font: c.font, color: c.grigio });
  if (firmaByte) {
    try {
      let img;
      try { img = await c.doc.embedPng(firmaByte); } catch { img = await c.doc.embedJpg(firmaByte); }
      /* proporzioni conservate: si riduce tutto, non si schiaccia */
      const scala = Math.min(110 / img.width, (h - 24) / img.height);
      c.stato.pagina.drawImage(img, { x: DX - img.width * scala - 16, y: y0 + 12, width: img.width * scala, height: img.height * scala });
    } catch { /* firma non leggibile: il visto vale lo stesso */ }
  }
  c.stato.y = y0 - 16;
  c.scrivi('Documento interno: non prende numero di protocollo. La pratica è identificata dal numero di segnalazione.', c.font, 7.5, c.grigio);
  return salva(c.doc);
}

/* ── 2-bis. ATTESTAZIONE DM 132/2024 ──
   Ricalca il modello nazionale FORMEDIL (rev. 15/10/2025):
   «Attestazione attività di consulenza e monitoraggio» ai sensi
   dell'art. 5, co. 4, lett. b, n. 4 del DM 132/2024 e dell'Accordo
   PP.SS. 19/09/2025. Esito positivo (senza rilievi / dopo verifica
   adempimenti), validità 6 MESI, firma del PRESIDENTE (legale
   rappresentante dell'OPT), numerazione propria N/anno + protocollo.
   att = { numero: 'N/aaaa', protocollo, esito: 'positivo_senza_rilievi'|
   'positivo_dopo_verifica', data_rilascio, firma_nome } */
export async function pdfAttestazioneDM132(p, att, firmaByte) {
  const c = await apriCarta();
  c.scrivi('ATTESTAZIONE ATTIVITÀ DI CONSULENZA E MONITORAGGIO', c.bold, 14, c.arancio);
  c.scrivi('(ai sensi del D.M. 132/2024, art. 5, co. 4, lett. b, n. 4 e dell’Accordo delle Parti Sociali del 19/09/2025)', c.italic, 8.5, c.grigio);
  c.stato.y -= 10;
  c.campo('Organismo Paritetico', 'FORMEDIL PADOVA — Scuola Costruzioni Giuseppe Jappelli, Ente Unico per la Formazione e la Sicurezza della Provincia di Padova');
  c.stato.y -= 6;
  c.scrivi('Impresa richiedente', c.bold, 10.5);
  c.campo('Ragione sociale', p.ragione_sociale);
  c.campo('Codice fiscale', p.cf_impresa || p.partita_iva);
  c.campo('P. IVA', p.partita_iva);
  c.campo('Sede legale', [p.indirizzo, p.comune].filter(Boolean).join(' — '));
  c.stato.y -= 6;
  c.scrivi('Dati dell’attività di monitoraggio svolta', c.bold, 10.5);
  const cc = Array.isArray(p.cantieri) ? p.cantieri : [];
  const principale = cc[0] || {};
  c.campo('Localizzazione cantiere', [principale.indirizzo, principale.comune].filter(Boolean).join(' — ') || att.cantiere || '—');
  c.campo('Committente', principale.committente || att.committente);
  c.campo('Tipo di intervento', att.tipo_intervento);
  c.campo('Durata dei lavori', principale.durata);
  c.campo('Importo lavori', principale.importo);
  if (cc.length > 1) {
    c.campo('Altri cantieri monitorati', cc.slice(1).map((x) => [x.indirizzo, x.comune].filter(Boolean).join(', ')).join('; '));
  }
  c.stato.y -= 8;

  /* esito con caselle, come il modello nazionale */
  c.serve(24);
  const ok1 = att.esito === 'positivo_senza_rilievi';
  const casella = (x, spuntata) => {
    c.stato.pagina.drawRectangle({ x, y: c.stato.y - 2, width: 11, height: 11, borderColor: c.nero, borderWidth: 0.9 });
    if (spuntata) c.stato.pagina.drawText('X', { x: x + 2.4, y: c.stato.y, size: 9, font: c.bold, color: c.nero });
  };
  c.stato.pagina.drawText('Esito dell’attività svolta:', { x: SX, y: c.stato.y, size: 10, font: c.bold, color: c.nero });
  casella(SX + 150, ok1);
  c.stato.pagina.drawText('Positivo senza rilievi', { x: SX + 166, y: c.stato.y, size: 10, font: c.font, color: c.nero });
  casella(SX + 290, !ok1);
  c.stato.pagina.drawText('Positivo dopo verifica adempimenti', { x: SX + 306, y: c.stato.y, size: 10, font: c.font, color: c.nero });
  c.stato.y -= 22;
  c.scrivi('La presente attestazione ha validità di 6 (sei) mesi dalla data di rilascio.', c.bold, 10);
  c.stato.y -= 6;
  c.campo('Luogo e data di rilascio', `Padova, ${dataIt(att.data_rilascio)}`);
  c.campo('Attestazione n°', att.numero);
  c.campo('Protocollo n°', att.protocollo ? siglaProtocollo(att.protocollo) : null);

  /* firma del Presidente (legale rappresentante dell'OPT) */
  c.serve(90);
  const yF = c.stato.y - 60;
  c.stato.pagina.drawText('Timbro e firma del legale rappresentante', { x: 320, y: yF + 52, size: 9, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('dell’Organismo Paritetico Territoriale', { x: 320, y: yF + 41, size: 9, font: c.font, color: c.grigio });
  c.stato.pagina.drawText(att.firma_nome || 'Il Presidente', { x: 320, y: yF + 26, size: 10.5, font: c.bold, color: c.nero });
  if (firmaByte) {
    try {
      let img;
      try { img = await c.doc.embedPng(firmaByte); } catch { img = await c.doc.embedJpg(firmaByte); }
      /* proporzioni conservate: si riduce tutto, non si schiaccia */
      const scala = Math.min(130 / img.width, 60 / img.height);
      c.stato.pagina.drawImage(img, { x: 330, y: yF - 30, width: img.width * scala, height: img.height * scala });
    } catch { /* senza firma grafica: si firma a mano */ }
  }
  c.stato.y = yF - 40;
  return salva(c.doc);
}

/* ── 3. riscontro al segnalante ──
   tipo = 'esito' (modello «Risposta») | 'presa_atto' (due righe) */
export async function pdfRiscontro(p, prot, tipo) {
  const c = await apriCarta();
  c.scrivi(tipo === 'esito' ? 'Riscontro alla Vostra segnalazione' : 'Presa in carico della segnalazione', c.bold, 14, c.nero);
  c.stato.y -= 4;
  c.stato.pagina.drawText(`Prot. n°: ${siglaProtocollo(prot)}`, { x: SX, y: c.stato.y, size: 9.5, font: c.bold, color: c.nero });
  if (p.notificante) {
    const t = `Alla c.a. ${p.notificante}`;
    c.stato.pagina.drawText(t.slice(0, 55), { x: 300, y: c.stato.y, size: 9.5, font: c.italic, color: c.nero });
  }
  c.stato.y -= 24;

  if (tipo === 'esito') {
    c.campo('Segnalante', p.notificante);
    c.campo('E-mail', p.email);
    c.campo('Data segnalazione', p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : null);
    c.campo('Impresa', p.imprese_presenti);
    c.campo('Indirizzo cantiere', p.ind_cantiere);
    c.campo('Comune', p.comune_cantiere);
    c.campo('Data verbale', p.data_verbale ? dataIt(p.data_verbale) : null);
    c.stato.y -= 4;
    c.campo('Richiesta', p.motivo);
    c.stato.y -= 6;
    c.serve(20);
    c.scrivi('Risposta:', c.bold, 10);
    c.scrivi(p.risposta_testo || '', c.font, 10);
  } else {
    c.stato.y -= 6;
    c.scrivi(`Gentile ${p.notificante || 'Segnalante'},`, c.font, 10);
    c.stato.y -= 4;
    c.scrivi('Vi ringraziamo per la collaborazione e per l’attenzione alla sicurezza nei cantieri della nostra Provincia. Vi informiamo che la Vostra segnalazione è stata presa in carico dallo scrivente Ente, che ha proceduto secondo le proprie procedure di verifica.', c.font, 10);
    c.stato.y -= 4;
    c.scrivi('Non seguiranno ulteriori comunicazioni di merito.', c.font, 10);
  }

  /* firma */
  c.serve(70);
  c.stato.y = Math.max(c.stato.y - 14, 110);
  c.stato.pagina.drawText(`Padova, ${dataIt(prot.data_prot)}`, { x: SX, y: c.stato.y, size: 10, font: c.font, color: c.nero });
  c.stato.pagina.drawText('FORMEDIL PADOVA', { x: 380, y: c.stato.y + 4, size: 10, font: c.bold, color: c.nero });
  c.stato.pagina.drawText(ENTE.area.toUpperCase(), { x: 380, y: c.stato.y - 8, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText('La Segreteria', { x: 380, y: c.stato.y - 22, size: 10, font: c.italic, color: c.nero });
  return salva(c.doc);
}
