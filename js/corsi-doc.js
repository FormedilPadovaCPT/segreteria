/* ============================================================
   I documenti del modulo formazione, sulla carta Formedil di
   segnalazioni-doc.js (apriCarta):

   1. ATTESTATO — ricalca i tre modelli storici (stessa scheda
      dati, cambia la certificazione): partecipazione (senza
      impresa) / regolare frequenza / frequenza + verifica finale.
      Numero della serie dedicata N/aaaa (decisa il 01/09/2026).
      ⚠️ Il logo blu della Regione va SOLO sui corsi riconosciuti
      (riconosciuto_regione): img/logo-regione.png, se presente.
      I corsi in progetti finanziati possono avere altri loghi
      (ctx.loghiExtra, byte immagine).
      Pagina 2: argomenti trattati (giornate + interventi).

   2. REGISTRO PRESENZE — scheda corso + per ogni giornata i
      docenti (con spazio firma) e l'elenco partecipanti con le
      colonne firma entrata/uscita. Lo firma il RESPONSABILE DEL
      PROGETTO FORMATIVO (Balladore), non il Direttore.

   3. LETTERA DI INCARICO DOCENZA — il contratto d'opera del
      modello storico (Prot. OUT nel registro unico), con i
      compiti del docente, i compensi e l'accordo quadro.
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { dataIt } from './comune.js';

const SX = 57;
const DX = 538;
const salva = async (doc) => new Uint8Array(await doc.save());

export function scaricaPdf(byte, nome) {
  const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const orario = (t) => (t ? String(t).slice(0, 5) : '');
const fascia = (dalle, alle) => [orario(dalle), orario(alle)].filter(Boolean).join('–');

/* ── GRIGLIA CONTINUA in stile modello storico: le celle di una
      riga hanno tutte la stessa altezza e condividono i bordi.
      cella = { l: etichetta, v: valore, peso, dim?, centro? } ── */
function tabella(c, righe) {
  const largoTot = DX - SX;
  for (const riga of righe) {
    const tot = riga.reduce((s, x) => s + (x.peso || 1), 0);
    const misure = riga.map((x) => largoTot * ((x.peso || 1) / tot));
    /* prima si misura l'altezza necessaria a tutta la riga */
    const testi = riga.map((x, i) => spezza(c, String(x.v ?? '—'), misure[i] - 10, c.bold, x.dim || 9.5));
    const h = Math.max(...riga.map((x, i) => 14 + testi[i].length * ((x.dim || 9.5) + 2.5) + 5));
    if (c.stato.y - h < 90) c.nuovaPagina();
    let x0 = SX;
    riga.forEach((cella, i) => {
      const pg = c.stato.pagina;
      pg.drawRectangle({ x: x0, y: c.stato.y - h, width: misure[i], height: h, borderWidth: 0.8, borderColor: c.grigio });
      pg.drawText(cella.l, { x: x0 + 5, y: c.stato.y - 11, size: 7, font: c.font, color: c.grigio });
      const dim = cella.dim || 9.5;
      let y = c.stato.y - 14 - dim;
      for (const r of testi[i]) {
        const xTxt = cella.centro ? x0 + (misure[i] - c.bold.widthOfTextAtSize(r, dim)) / 2 : x0 + 5;
        pg.drawText(r, { x: xTxt, y, size: dim, font: c.bold, color: c.nero });
        y -= dim + 2.5;
      }
      x0 += misure[i];
    });
    c.stato.y -= h;   /* nessuno spazio fra le righe: griglia continua */
  }
}

/* testo centrato con a capo */
function centrato(c, testo, f, dim, colore) {
  for (const r of spezza(c, testo, DX - SX - 20, f, dim)) {
    c.serve(dim + 6);
    c.stato.pagina.drawText(r, { x: SX + (DX - SX - f.widthOfTextAtSize(r, dim)) / 2, y: c.stato.y, size: dim, font: f, color: colore });
    c.stato.y -= dim + 4;
  }
}

/* banda colorata a tutta larghezza */
function banda(c, testo, colore, colTxt, centraTesto = true) {
  c.serve(20);
  c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 5, width: DX - SX, height: 16, color: colore });
  const f = c.bold;
  const x = centraTesto ? SX + (DX - SX - f.widthOfTextAtSize(testo, 10)) / 2 : SX + 6;
  c.stato.pagina.drawText(testo, { x, y: c.stato.y - 1, size: 10, font: f, color: colTxt });
  c.stato.y -= 20;
}

/* cornice arancione doppia + piè «Stampato a Padova il» su ogni pagina */
function cornice(c, dataStampa) {
  for (const pg of c.doc.getPages()) {
    pg.drawRectangle({ x: 14, y: 14, width: 567, height: 814, borderWidth: 3, borderColor: c.arancio });
    pg.drawRectangle({ x: 21, y: 21, width: 553, height: 800, borderWidth: 0.8, borderColor: c.arancio });
    pg.drawText(`Stampato a Padova il ${dataIt(dataStampa) || ''}`, { x: 30, y: 26, size: 6.5, font: c.italic, color: c.grigio });
  }
}

function spezza(c, testo, largo, f, dim) {
  const parole = String(testo).split(/\s+/).filter(Boolean);
  const righe = [];
  let riga = '';
  for (const w of parole) {
    const prova = riga ? riga + ' ' + w : w;
    if (f.widthOfTextAtSize(prova, dim) > largo && riga) { righe.push(riga); riga = w; }
    else riga = prova;
  }
  righe.push(riga || '—');
  return righe;
}

/* pagina 2: argomenti trattati — banda arancio del titolo, banda
   verde per ogni giornata, riga «Totale crediti», come il modello */
function argomentiTrattati(c, corso, giornate, interventi) {
  const verde = c.verde;
  c.nuovaPagina();
  c.stato.y = 795;
  const banda = (testo, colore, colTxt, bold = true) => {
    c.serve(20);
    c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 5, width: DX - SX, height: 16, color: colore });
    const f = bold ? c.bold : c.font;
    c.stato.pagina.drawText(testo, { x: SX + (bold ? (DX - SX - f.widthOfTextAtSize(testo, 10)) / 2 : 6), y: c.stato.y - 1, size: 10, font: f, color: colTxt });
    c.stato.y -= 20;
  };
  banda('Argomenti trattati', c.arancio, c.bianco);
  let crediti = 0;
  const stampaIntervento = (it) => {
    c.serve(34);
    const y0 = c.stato.y;
    c.stato.pagina.drawText(`Dalle ${orario(it.dalle) || '—'}  Alle ${orario(it.alle) || '—'}`, { x: SX + 4, y: y0, size: 9, font: c.font, color: c.grigio });
    c.stato.pagina.drawText(`${it.qualita === 'docente' ? 'Docente' : it.qualita.charAt(0).toUpperCase() + it.qualita.slice(1)}  ${it.nominativo}`, { x: SX + 130, y: y0, size: 9.5, font: c.bold, color: c.nero });
    const cred = `Crediti formativi  ${it.crediti ?? 0}`;
    c.stato.pagina.drawText(cred, { x: DX - 6 - c.italic.widthOfTextAtSize(cred, 8.5), y: y0, size: 8.5, font: c.italic, color: c.grigio });
    c.stato.y -= 13;
    if (it.materia) c.scrivi(`Materia   ${it.materia}`, c.font, 9, c.grigio, 4);
    if (it.argomenti) c.scrivi(it.argomenti, c.italic, 9, c.nero, 4);
    crediti += Number(it.crediti || 0);
    c.stato.y -= 4;
  };
  for (const g of giornate) {
    banda(`Data Lezione   ${dataIt(g.data)}${g.aula ? `   —   ${g.aula}` : ''}`, verde, c.bianco, false);
    interventi.filter((x) => x.giornata_id === g.id).forEach(stampaIntervento);
    c.stato.y -= 2;
  }
  interventi.filter((x) => !x.giornata_id || !giornate.some((g) => g.id === x.giornata_id)).forEach(stampaIntervento);
  c.serve(20);
  const tot = `Totale crediti   ${crediti}`;
  c.stato.pagina.drawRectangle({ x: DX - 150, y: c.stato.y - 5, width: 150, height: 16, color: c.grigioChiaro });
  c.stato.pagina.drawText(tot, { x: DX - 145, y: c.stato.y - 1, size: 9.5, font: c.italic, color: c.nero });
  c.stato.y -= 22;
}

/* ── 1. ATTESTATO ──
   iscritto: riga s_corsi_iscritti; anagrafica: {nato_luogo, nato_il} se agganciato;
   ctx: { numero, firmaByte, firmaNome, logoRegioneByte, loghiExtra: [byte] } */
export async function pdfAttestato(corso, iscritto, anagrafica, giornate, interventi, ctx) {
  const c = await apriCarta();
  const pg = () => c.stato.pagina;

  /* numero in alto a destra: serie nuova N/aaaa, o «Prot.» storico
     (ristampa di un attestato delle vecchie gestioni col suo numero) */
  const nTxt = String(ctx.numero).includes('/') ? `Attestato n. ${ctx.numero}` : `Prot.: ${ctx.numero}`;
  pg().drawText(nTxt, { x: DX - c.bold.widthOfTextAtSize(nTxt, 11), y: 800, size: 11, font: c.bold, color: c.nero });

  /* loghi: Regione SOLO se riconosciuto, più gli eventuali loghi di progetto */
  let xLogo = SX;
  const disegnaLogo = (img) => {
    const h = 30, w = (img.width / img.height) * h;
    pg().drawImage(img, { x: xLogo, y: c.stato.y - h + 6, width: w, height: h });
    xLogo += w + 14;
    return true;
  };
  let cambiaRiga = false;
  if (corso.riconosciuto_regione && ctx.logoRegioneByte) {
    try { cambiaRiga = disegnaLogo(await c.doc.embedPng(ctx.logoRegioneByte)); } catch { /* senza logo */ }
  }
  for (const byte of ctx.loghiExtra || []) {
    try { cambiaRiga = disegnaLogo(await c.doc.embedPng(byte).catch(() => c.doc.embedJpg(byte))); } catch { /* ignora */ }
  }
  if (cambiaRiga) c.stato.y -= 34;
  c.stato.y -= 4;

  /* ── la griglia continua del modello storico ── */
  const oreTot = corso.durata_ore ?? '—';
  const oreFreq = iscritto.ore_frequentate ?? oreTot;
  const perc = iscritto.perc_frequenza != null ? `${Math.round(iscritto.perc_frequenza)}%` : '100%';
  tabella(c, [
    [{ l: 'Titolo del corso', v: corso.titolo, peso: 2, dim: 10.5 }, { l: 'Sede', v: corso.sede || '—', peso: 1 }],
    [{ l: 'Anno formativo', v: corso.anno_formativo || '—', centro: true },
     { l: 'Data inizio', v: dataIt(corso.data_inizio) || '—', centro: true },
     { l: 'Data fine', v: dataIt(corso.data_fine || corso.data_inizio) || '—', centro: true }],
    [{ l: 'Totale ore corso', v: oreTot, centro: true },
     { l: 'Tot. ore frequentate', v: oreFreq, centro: true },
     { l: '% di frequenza del corsista', v: perc, centro: true },
     { l: '% minima di frequenza', v: `${corso.perc_freq_min ?? 90}%`, centro: true }],
    [{ l: 'Tipologia di corso', v: corso.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : (corso.modalita ? { aula: 'Corso in aula', cantiere: 'Corso in cantiere', impresa: 'Corso in impresa', videoconferenza: 'Corso in videoconferenza', mista: 'Corso in modalità mista' }[corso.modalita] : 'Corso'), peso: 1 },
     { l: 'Settore ATECO', v: corso.ateco_txt || '—', peso: 2 }],
    [{ l: 'Il presente certificato è valido per', v: corso.validita_txt || 'Informazione', peso: 1 }],
  ]);
  c.stato.y -= 16;

  const certificazione = {
    partecipazione: `Si certifica la partecipazione a ${corso.titolo} per il corsista:`,
    frequenza: 'Si certifica la regolare frequenza per il corsista:',
    frequenza_verifica: 'Si certifica la regolare frequenza e il superamento con esito positivo della verifica finale di apprendimento per il corsista:',
  }[corso.tipo_attestato || 'frequenza'];
  centrato(c, certificazione, c.bold, 11.5, c.nero);
  c.stato.y -= 8;

  const righeCorsista = [
    [{ l: 'Nome e cognome', v: iscritto.nominativo, peso: 2, dim: 15 }, { l: 'Codice fiscale', v: iscritto.cf || '—', peso: 1 }],
  ];
  if (anagrafica?.nato_luogo || anagrafica?.nato_il) {
    righeCorsista.push([
      { l: 'Luogo di nascita', v: anagrafica.nato_luogo || '—', peso: 2 },
      { l: 'Data di nascita', v: anagrafica.nato_il ? dataIt(anagrafica.nato_il) : '—', peso: 1 },
    ]);
  }
  righeCorsista.push(corso.tipo_attestato === 'partecipazione'
    ? [{ l: 'In qualità di', v: iscritto.ruolo || '—' }, { l: 'Ruolo aziendale', v: iscritto.mansione || '—' }]
    : [{ l: 'Ragione sociale', v: iscritto.impresa_txt || '—', peso: 2 },
       { l: 'In qualità di', v: iscritto.ruolo || '—', peso: 1 },
       { l: 'Ruolo aziendale', v: iscritto.mansione || '—', peso: 1 }]);
  tabella(c, righeCorsista);
  c.stato.y -= 22;

  /* ── firma centrata in basso, come il modello ── */
  c.serve(110);
  const centro = SX + (DX - SX) / 2;
  const yF = c.stato.y;
  const t1 = 'Timbro e firma del responsabile del corso';
  pg().drawText(t1, { x: centro - c.font.widthOfTextAtSize(t1, 9.5) / 2, y: yF, size: 9.5, font: c.font, color: c.nero });
  const t2 = `(${ctx.firmaNome || 'Il responsabile del progetto formativo'})`;
  pg().drawText(t2, { x: centro - c.bold.widthOfTextAtSize(t2, 10) / 2, y: yF - 14, size: 10, font: c.bold, color: c.nero });
  if (ctx.firmaByte) {
    try {
      let img;
      try { img = await c.doc.embedPng(ctx.firmaByte); } catch { img = await c.doc.embedJpg(ctx.firmaByte); }
      const w = 150, h = Math.min((img.height / img.width) * w, 75);
      pg().drawImage(img, { x: centro - w / 2, y: yF - 22 - h, width: w, height: h });
    } catch { /* si firma a mano */ }
  }
  pg().drawText(`Rilasciato a Padova il ${dataIt(ctx.dataRilascio) || dataIt(new Date().toISOString().slice(0, 10))}`,
    { x: SX, y: yF - 14, size: 9, font: c.font, color: c.nero });
  pg().drawText('Verifica integrità documento', { x: SX, y: yF - 28, size: 7.5, font: c.font, color: c.grigio });
  pg().drawText(nTxt, { x: SX, y: yF - 38, size: 8, font: c.bold, color: c.nero });

  argomentiTrattati(c, corso, giornate, interventi);
  cornice(c, ctx.dataRilascio || new Date().toISOString().slice(0, 10));
  return salva(c.doc);
}

/* ── 2. REGISTRO PRESENZE ── */
export async function pdfRegistro(corso, giornate, interventi, iscritti, conf) {
  const c = await apriCarta();
  banda(c, 'REGISTRO PRESENZA ALLIEVI', c.arancio, c.bianco);
  c.stato.y -= 4;
  tabella(c, [
    [{ l: 'Ente Attuatore', v: "FORMEDIL PADOVA — Ente Unico per la Formazione e la Sicurezza per il settore dell'Edilizia ed affini della Provincia di Padova", dim: 9 }],
    [{ l: 'Codice corso', v: String(corso.id), peso: 1, centro: true }, { l: 'Titolo corso', v: corso.titolo, peso: 3, dim: 10.5 }],
    [{ l: 'Sede di svolgimento', v: corso.sede || '—' }],
    [{ l: 'Data inizio corso', v: dataIt(corso.data_inizio) || '—', centro: true },
     { l: 'Data fine corso', v: dataIt(corso.data_fine || corso.data_inizio) || '—', centro: true },
     { l: 'Durata (ore)', v: corso.durata_ore ?? '—', centro: true }],
    [{ l: 'Tipologia di corso', v: corso.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : corso.tipo, peso: 1 },
     { l: 'Settore ATECO', v: corso.ateco_txt || '—', peso: 2 }],
    [{ l: 'Rappresentante Legale', v: corso.rappresentante_legale || conf.presidente_nome || '—' },
     { l: 'Resp. del progetto formativo', v: corso.responsabile_formativo || conf.responsabile_formativo_nome || '—' }],
    [{ l: 'Numero partecipanti', v: `Presenti allievi n° ______   (iscritti: ${iscritti.length})` }],
  ]);
  c.stato.y -= 16;
  const yNotaPagine = c.stato.y;   /* la riga si scrive alla fine, quando il totale è noto */

  const partecipanti = iscritti.filter((i) => !['annullato', 'sostituito'].includes(i.esito))
    .sort((a, b) => a.nominativo.localeCompare(b.nominativo, 'it', { numeric: true }));

  for (const g of giornate) {
    c.nuovaPagina();
    c.stato.y = 795;
    c.scrivi(`${corso.titolo}`, c.bold, 10.5);
    c.stato.y -= 2;
    banda(c, `Data lezione   ${dataIt(g.data)}    ·    Orario ${fascia(g.dalle, g.alle)}${g.dalle2 ? ` e ${fascia(g.dalle2, g.alle2)}` : ''}    ·    ${g.aula || g.sede || corso.sede || ''}`, c.verde, c.bianco, false);
    c.stato.y -= 4;

    /* docenti della giornata, con spazio firma */
    for (const it of interventi.filter((x) => x.giornata_id === g.id && ['docente', 'codocente', 'relatore'].includes(x.qualita))) {
      c.serve(40);
      const y0 = c.stato.y;
      c.stato.pagina.drawText(`${it.nominativo}   ·   ${fascia(it.dalle, it.alle)}`, { x: SX, y: y0, size: 9.5, font: c.bold, color: c.nero });
      c.stato.pagina.drawText(it.materia || '', { x: SX, y: y0 - 12, size: 8.5, font: c.italic, color: c.grigio });
      c.stato.pagina.drawText('Firma docente', { x: 380, y: y0, size: 7, font: c.font, color: c.grigio });
      c.stato.pagina.drawLine({ start: { x: 380, y: y0 - 14 }, end: { x: DX, y: y0 - 14 }, thickness: 0.7, color: c.grigio });
      c.stato.y -= 32;
      if (it.argomenti) { c.scrivi(it.argomenti, c.font, 8.5, c.nero); c.stato.y -= 4; }
    }
    c.stato.y -= 6;

    /* tabella partecipanti: n / nominativo+CF / impresa / firma entrata / firma uscita */
    const col = [26, 175, 130, 75, 75];
    const x0 = SX;
    const intesta = () => {
      const y0 = c.stato.y;
      let x = x0;
      ['N°', 'Cognome e nome — CF', 'Impresa', 'Firma entrata', 'Firma uscita'].forEach((t, i) => {
        c.stato.pagina.drawRectangle({ x, y: y0 - 16, width: col[i], height: 16, color: c.arancio });
        c.stato.pagina.drawText(t, { x: x + 3, y: y0 - 11, size: 7.5, font: c.bold, color: c.bianco });
        x += col[i];
      });
      c.stato.y -= 16;
    };
    intesta();
    partecipanti.forEach((p, n) => {
      if (c.stato.y - 26 < 70) { c.nuovaPagina(); intesta(); }
      const y0 = c.stato.y;
      let x = x0;
      const vals = [String(n + 1), null, null, '', ''];
      col.forEach((w, i) => {
        c.stato.pagina.drawRectangle({ x, y: y0 - 26, width: w, height: 26, borderWidth: 0.6, borderColor: c.grigio });
        if (i === 0) c.stato.pagina.drawText(vals[0], { x: x + 3, y: y0 - 16, size: 8, font: c.font, color: c.nero });
        if (i === 1) {
          c.stato.pagina.drawText(p.nominativo.slice(0, 38), { x: x + 3, y: y0 - 11, size: 8, font: c.bold, color: c.nero });
          if (p.cf) c.stato.pagina.drawText(p.cf, { x: x + 3, y: y0 - 21, size: 7, font: c.font, color: c.grigio });
        }
        if (i === 2) c.stato.pagina.drawText((p.impresa_txt || '').slice(0, 30), { x: x + 3, y: y0 - 16, size: 7.5, font: c.font, color: c.nero });
        x += w;
      });
      c.stato.y -= 26;
    });

    /* chiusura giornata */
    c.serve(70);
    c.stato.y -= 8;
    c.scrivi('NOTE (entrate in ritardo, uscite anticipate, variazioni di orario rispetto al calendario):', c.font, 8, c.grigio);
    c.stato.y -= 18;
    const yV = c.stato.y;
    c.stato.pagina.drawText('Totale presenze del giorno ______    Totale ore del giorno ______    Totale progressivo ore ______', { x: SX, y: yV, size: 8.5, font: c.font, color: c.nero });
    c.stato.pagina.drawText('Visto del responsabile del corso', { x: 380, y: yV - 18, size: 7.5, font: c.font, color: c.grigio });
    c.stato.pagina.drawText(`(${corso.responsabile_formativo || conf.responsabile_formativo_nome || ''})`, { x: 380, y: yV - 28, size: 8.5, font: c.bold, color: c.nero });
    c.stato.pagina.drawLine({ start: { x: 380, y: yV - 46 }, end: { x: DX, y: yV - 46 }, thickness: 0.7, color: c.grigio });
    c.stato.y -= 60;
    c.scrivi('Ai sensi degli artt. 13 e 14 del Regolamento Europeo n. 2016/679 (GDPR), ciascun firmatario esprime il consenso al trattamento dei propri dati personali da parte di Formedil Padova, Via Basilicata 10 — Padova, per le finalità e con le modalità contenute nell\'informativa, che conferma di aver ricevuto e della quale ha preso integrale visione.', c.font, 6.5, c.grigio);
  }

  /* cornice + numeri di pagina, ora che il totale è noto */
  cornice(c, new Date().toISOString().slice(0, 10));
  const pagine = c.doc.getPages();
  pagine.forEach((p, i) => p.drawText(`Pagina ${i + 1} di ${pagine.length}`, { x: DX - 70, y: 30, size: 7.5, font: c.font, color: c.grigio }));
  const nota = `Il presente registro di formazione è composto di n° ${pagine.length} pagine progressivamente numerate dal n° 1 al n° ${pagine.length}`;
  pagine[0].drawText(nota, { x: SX + (DX - SX - c.italic.widthOfTextAtSize(nota, 9.5)) / 2, y: yNotaPagine, size: 9.5, font: c.italic, color: c.nero });
  return salva(c.doc);
}

/* ── 3. LETTERA DI INCARICO DOCENZA (contratto d'opera) ── */
export async function pdfLetteraIncarico(corso, incarico, mieiInterventi, conf, protocolloTxt, firmaByte, anagDocente) {
  const c = await apriCarta();
  c.scrivi('CONFERIMENTO INCARICO DOCENZA CORSO DI FORMAZIONE', c.bold, 12, c.arancio);
  c.scrivi('PER LA SALUTE E LA SICUREZZA NEI LUOGHI DI LAVORO — Contratto d\'opera', c.bold, 9.5, c.grigio);
  c.stato.y -= 6;
  c.campo('Protocollo', protocolloTxt || '—');
  c.campo('Data', dataIt(incarico.data_incarico) || dataIt(new Date().toISOString().slice(0, 10)));
  c.campo('Ufficio', 'Segreteria Area Sicurezza e Salute');
  c.stato.y -= 8;
  c.scrivi(`Egr. ${incarico.nominativo}`, c.bold, 10.5);
  c.stato.y -= 2;
  c.scrivi('Con riferimento alle intese intercorse Le confermiamo l\'incarico professionale per la seguente attività formativa:', c.font, 9.5);
  c.stato.y -= 4;
  c.campo('Oggetto del corso', corso.titolo);
  c.campo('Sede corso', corso.sede);
  const gg = [...new Set(mieiInterventi.map((i) => i.giornata_data).filter(Boolean))];
  c.campo('Data', gg.length ? gg.map(dataIt).join(', ') : dataIt(corso.data_inizio));
  const fasce = mieiInterventi.map((i) => fascia(i.dalle, i.alle)).filter(Boolean);
  c.campo('Orario', fasce.join(' / ') || '—');
  c.campo('Ore complessive', incarico.ore != null ? String(incarico.ore) : '—');
  c.campo('Argomenti', mieiInterventi.map((i) => i.argomenti).filter(Boolean).join('; ') || corso.titolo);
  c.stato.y -= 6;

  c.scrivi('MODALITÀ DI SVOLGIMENTO DELL\'ATTIVITÀ DI DOCENZA — il Docente dovrà attenersi ai seguenti compiti:', c.bold, 9.5);
  for (const r of [
    'Effettuare attività di docenza con lavoro proprio a norma dell\'art. 2222 del Codice Civile secondo il programma e i contenuti previsti dal progetto di riferimento;',
    'Fatta salva la libertà di docenza, per un alto standard formativo dovrà basarsi sulla didattica del D.Lgs 81/08 integrando le nozioni suggerite dalla propria professionalità;',
    'Compilare e firmare di propria responsabilità il registro presenze e tutti i relativi documenti gestionali e didattici predisposti da Formedil Padova;',
    'Collaborare con il responsabile del progetto formativo, nonché con il gestore della sede formativa, al fine di applicare le strategie didattiche dell\'ente;',
    'Comunicare con congruo anticipo eventuali assenze, ritardi o problematiche e/o proporre un idoneo sostituto con capacità equipollenti;',
    'Proporre al responsabile del progetto formativo eventuali modifiche e/o migliorie del programma;',
    'Redigere tutti i test di verifica, nonché procedere alle valutazioni e all\'attestazione dell\'apprendimento dei discenti presenti al corso;',
    'Far pervenire alla segreteria di FORMEDIL PADOVA tutta la documentazione relativa al corso svolto;',
    'Osservare tutte le indicazioni di sicurezza e comportamentali contenute nel progetto;',
    'Compiere la docenza a regola d\'arte e rispettare i massimi standard di sicurezza propria, dei discenti e di terzi, specie nelle prove pratiche delle attrezzature di lavoro.',
  ]) c.scrivi('•  ' + r, c.font, 8.5, c.nero, 6);
  c.stato.y -= 6;

  c.scrivi('Compensi e condizioni di pagamento', c.bold, 9.5);
  const tariffa = incarico.tariffa_oraria != null ? Number(incarico.tariffa_oraria).toFixed(2).replace('.', ',') : '______';
  c.scrivi(`A titolo di compenso e corrispettivo per le docenze svolte, il Docente ${incarico.nominativo} riceverà per ogni ora di docenza, teorica o pratica, effettiva, un compenso pari a € ${tariffa} oneri e IVA esclusi${incarico.corrispettivo != null ? ` (corrispettivo complessivo per ${incarico.ore ?? '—'} ore: € ${Number(incarico.corrispettivo).toFixed(2).replace('.', ',')})` : ''}.`, c.font, 9);
  c.scrivi('Le spettanze saranno liquidate a mezzo bonifico bancario a 60 giorni fine mese data fattura, a conclusione del regolare termine di chiusura della docenza e a seguito di presentazione di fattura o equivalente documento fiscale, su cui il Docente avrà cura di indicare il tipo, le date e il numero del corso svolto.', c.font, 9);
  c.stato.y -= 10;

  /* firme */
  c.serve(80);
  const yF = c.stato.y;
  c.stato.pagina.drawText('PER ACCETTAZIONE — il Docente', { x: SX, y: yF, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText(incarico.nominativo, { x: SX, y: yF - 12, size: 9.5, font: c.bold, color: c.nero });
  c.stato.pagina.drawLine({ start: { x: SX, y: yF - 40 }, end: { x: SX + 180, y: yF - 40 }, thickness: 0.7, color: c.grigio });
  c.stato.pagina.drawText('FORMEDIL PADOVA — il Legale Rappresentante', { x: 320, y: yF, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText(corso.rappresentante_legale || conf.presidente_nome || '', { x: 320, y: yF - 12, size: 9.5, font: c.bold, color: c.nero });
  if (firmaByte) {
    try {
      let img;
      try { img = await c.doc.embedPng(firmaByte); } catch { img = await c.doc.embedJpg(firmaByte); }
      const w = 120, h = Math.min((img.height / img.width) * w, 55);
      c.stato.pagina.drawImage(img, { x: 330, y: yF - 16 - h, width: w, height: h });
    } catch { /* firma a mano */ }
  }
  c.stato.y -= 86;

  /* accordo quadro (testo standard dell'ente) */
  c.nuovaPagina();
  c.scrivi('ACCORDO PER DOCENZE CON COMPENSO A PRESTAZIONE', c.bold, 11, c.arancio);
  c.stato.y -= 4;
  const anag = anagDocente
    ? ` nato a ${anagDocente.nato_luogo || '—'} il ${anagDocente.nato_il ? dataIt(anagDocente.nato_il) : '—'}${anagDocente.cf ? `, C.F. ${anagDocente.cf}` : ''}`
    : '';
  c.scrivi(`Oggi ${dataIt(incarico.data_incarico) || dataIt(new Date().toISOString().slice(0, 10))}, a Padova, tra FORMEDIL PADOVA, in persona del suo Legale Rappresentante ${corso.rappresentante_legale || conf.presidente_nome || ''}, domiciliato c/o Formedil Padova in Via Basilicata 10, Padova — di seguito, per brevità: «Committente» — e ${incarico.nominativo}${anag} — di seguito, per brevità: «Docente» — le Parti formalizzano termini e condizioni delle intese già raggiunte e stipulano quanto segue:`, c.font, 9);
  c.stato.y -= 4;
  for (const [n, t] of [
    ['1.1', 'Il presente Accordo regola il conferimento di incarichi di docenza per la tenuta di corsi di formazione generali e specifici nelle materie inerenti la salute e la sicurezza sul lavoro, e di corsi abilitanti l\'uso di attrezzature di lavoro specifiche come da D.Lgs 81/08, organizzati dal Committente.'],
    ['1.2', 'Il Docente si impegna a confermare via e-mail la propria disponibilità alle docenze di volta in volta assegnate, tempestivamente e comunque non oltre le 48 ore; senza risposta l\'incarico si ritiene annullato. Qualora il Docente, accettato l\'incarico, fosse impossibilitato, il Committente si impegna a reperire in tempo utile un idoneo sostituto equipollente per capacità, requisiti e competenze.'],
    ['1.3', 'Il Docente si impegna a svolgere le attività di docenza in armonia con le direttive e il codice etico dell\'Ente, nel rispetto dei criteri tecnici approvati e degli standard formativi di legge, e delle vigenti leggi e regolamenti (D.Lgs 81/2008); l\'incaricato della formazione è tenuto a osservare gli obblighi dell\'art. 19 D.Lgs 81/2008 in quanto «preposto» per le attività formative di cui al presente incarico.'],
    ['1.4', 'L\'incarico verrà svolto previa conferma del Committente solo in caso di raggiungimento del numero minimo di iscritti. Il Committente invierà al Docente la conferma di effettuazione del corso entro 5 giorni prima della data di inizio.'],
    ['1.5', 'Orari e sede della formazione verranno indicati dal Committente. Il Docente ha l\'obbligo di compiere le formalità di attestazione delle presenze, dei programmi svolti, dei contenuti e delle valutazioni, e di firmare il registro per la parte di competenza, secondo le buone prassi e le leggi vigenti.'],
    ['1.6', 'Il Docente svolgerà la propria opera con lavoro proprio, senza vincolo di subordinazione, senza obbligo disciplinare né osservanza di orario di lavoro; resta in capo al Committente la definizione di luoghi, orari di inizio e modalità di accesso alle sedi corsuali.'],
    ['1.7', 'Nell\'espletamento dell\'incarico il Docente, salva la libera determinazione delle modalità di esecuzione, si atterrà alle indicazioni del Committente sui criteri tecnici; sarà libero di utilizzare il proprio materiale nei modi e con le finalità previste dalla legge.'],
    ['1.8', 'Ogni incarico ha natura di contratto d\'opera occasionale a sé stante; il Docente dichiara di essere in regola e di occuparsi in proprio degli adempimenti fiscali, previdenziali e assistenziali cui è tenuto.'],
    ['1.9', 'Al Committente spetta il diritto di vigilanza sull\'intera attività.'],
    ['2.0', 'Tutti i dati e le informazioni di cui il Docente entri in possesso sono da considerarsi riservati: ne è vietata qualsiasi divulgazione. Il Docente si obbliga al più rigoroso riserbo e segreto professionale.'],
    ['2.1', 'Il Docente si obbliga ad astenersi, durante l\'attività di docenza, da qualsiasi forma diretta o indiretta di pubblicità o promozione della propria persona o attività professionale, e a non promuovere terzi; in caso di trasgressione il Committente si riserva gli opportuni provvedimenti, compresa l\'immediata risoluzione del rapporto.'],
    ['2.2', 'Qualsiasi controversia sul presente contratto sarà oggetto, ad istanza della parte più diligente, di un tentativo preliminare di conciliazione secondo il regolamento dell\'organismo di mediazione della CCIAA di Padova, con gli effetti del D.Lgs 28/2010.'],
  ]) c.scrivi(`${n}  ${t}`, c.font, 8.5, c.nero);
  c.stato.y -= 14;
  c.serve(50);
  const yA = c.stato.y;
  c.stato.pagina.drawText('PER ACCETTAZIONE — il Docente', { x: SX, y: yA, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawLine({ start: { x: SX, y: yA - 28 }, end: { x: SX + 180, y: yA - 28 }, thickness: 0.7, color: c.grigio });
  c.stato.pagina.drawText('FORMEDIL PADOVA', { x: 320, y: yA, size: 8.5, font: c.font, color: c.grigio });
  c.stato.pagina.drawText(corso.rappresentante_legale || conf.presidente_nome || '', { x: 320, y: yA - 12, size: 9.5, font: c.bold, color: c.nero });
  return salva(c.doc);
}
