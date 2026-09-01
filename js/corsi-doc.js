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

/* riquadro etichetta sopra / valore sotto, come la scheda degli attestati */
function cella(c, x, w, etichetta, valore, hMin = 30) {
  const pg = c.stato.pagina;
  pg.drawText(etichetta, { x: x + 4, y: c.stato.y - 10, size: 7, font: c.font, color: c.grigio });
  const righe = spezza(c, String(valore ?? '—'), w - 8, c.bold, 9);
  let y = c.stato.y - 21;
  for (const r of righe.slice(0, 3)) {
    pg.drawText(r, { x: x + 4, y, size: 9, font: c.bold, color: c.nero });
    y -= 11;
  }
  const h = Math.max(hMin, 21 + righe.slice(0, 3).length * 11 + 3);
  pg.drawRectangle({ x, y: c.stato.y - h, width: w, height: h, borderWidth: 0.7, borderColor: c.grigio });
  return h;
}
function rigaCelle(c, celle) {
  const tot = celle.reduce((s, [, peso]) => s + peso, 0);
  let x = SX;
  let hMax = 30;
  const misure = celle.map(([_, peso]) => (DX - SX) * (peso / tot));
  celle.forEach(([contenuto], i) => {
    const h = cella(c, x, misure[i], contenuto[0], contenuto[1]);
    hMax = Math.max(hMax, h);
    x += misure[i];
  });
  c.stato.y -= hMax;
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

/* pagina 2 (o coda): argomenti trattati */
function argomentiTrattati(c, corso, giornate, interventi) {
  c.nuovaPagina();
  c.scrivi('Argomenti trattati', c.bold, 12, c.arancio);
  c.stato.y -= 6;
  let crediti = 0;
  const stampaIntervento = (it) => {
    c.serve(30);
    c.scrivi(`${fascia(it.dalle, it.alle) || '—'}  ·  ${it.qualita === 'docente' ? 'Docente' : it.qualita}  ${it.nominativo}${it.crediti ? `  ·  crediti ${it.crediti}` : ''}`, c.font, 9.5, c.nero, 8);
    if (it.materia) c.scrivi(`Materia: ${it.materia}`, c.italic, 9, c.grigio, 8);
    if (it.argomenti) c.scrivi(it.argomenti, c.font, 9, c.nero, 8);
    crediti += Number(it.crediti || 0);
    c.stato.y -= 3;
  };
  for (const g of giornate) {
    c.serve(24);
    c.scrivi(`Lezione del ${dataIt(g.data)}${g.aula ? ` — ${g.aula}` : ''}${g.sede && g.sede !== corso.sede ? ` — ${g.sede}` : ''}`, c.bold, 10);
    interventi.filter((x) => x.giornata_id === g.id).forEach(stampaIntervento);
    c.stato.y -= 4;
  }
  const orfani = interventi.filter((x) => !x.giornata_id || !giornate.some((g) => g.id === x.giornata_id));
  orfani.forEach(stampaIntervento);
  c.stato.y -= 4;
  c.scrivi(`Totale crediti formativi: ${crediti}`, c.bold, 10);
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

  c.scrivi('ATTESTATO', c.bold, 15, c.arancio);
  c.stato.y -= 4;

  rigaCelle(c, [[['Titolo del corso', corso.titolo], 2], [['Sede', corso.sede || '—'], 1]]);
  rigaCelle(c, [
    [['Anno formativo', corso.anno_formativo || '—'], 1],
    [['Data inizio', dataIt(corso.data_inizio) || '—'], 1],
    [['Data fine', dataIt(corso.data_fine || corso.data_inizio) || '—'], 1],
  ]);
  const oreTot = corso.durata_ore ?? '—';
  const oreFreq = iscritto.ore_frequentate ?? oreTot;
  const perc = iscritto.perc_frequenza != null ? `${Math.round(iscritto.perc_frequenza)}%` : '100%';
  rigaCelle(c, [
    [['Totale ore corso', oreTot], 1],
    [['Tot. ore frequentate', oreFreq], 1],
    [['% di frequenza del corsista', perc], 1],
    [['% minima di frequenza', `${corso.perc_freq_min ?? 90}%`], 1],
  ]);
  rigaCelle(c, [[['Tipologia di corso', corso.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : (corso.modalita ? { aula: 'Corso in aula', cantiere: 'Corso in cantiere', impresa: 'Corso in impresa', videoconferenza: 'Corso in videoconferenza', mista: 'Corso in modalità mista' }[corso.modalita] : 'Corso')], 1],
    [['Settore ATECO', corso.ateco_txt || '—'], 1]]);
  rigaCelle(c, [[['Il presente certificato è valido per', corso.validita_txt || 'Informazione'], 1]]);
  c.stato.y -= 10;

  const certificazione = {
    partecipazione: `Si certifica la partecipazione a ${corso.titolo} per il corsista:`,
    frequenza: 'Si certifica la regolare frequenza per il corsista:',
    frequenza_verifica: 'Si certifica la regolare frequenza e il superamento con esito positivo della verifica finale di apprendimento per il corsista:',
  }[corso.tipo_attestato || 'frequenza'];
  c.scrivi(certificazione, c.bold, 10.5);
  c.stato.y -= 6;

  rigaCelle(c, [[['Nome e cognome', iscritto.nominativo], 2], [['Codice fiscale', iscritto.cf || '—'], 1]]);
  if (anagrafica?.nato_luogo || anagrafica?.nato_il) {
    rigaCelle(c, [
      [['Luogo di nascita', anagrafica.nato_luogo || '—'], 2],
      [['Data di nascita', anagrafica.nato_il ? dataIt(anagrafica.nato_il) : '—'], 1],
    ]);
  }
  if (corso.tipo_attestato === 'partecipazione') {
    rigaCelle(c, [[['In qualità di', iscritto.ruolo || '—'], 1], [['Ruolo aziendale', iscritto.mansione || '—'], 1]]);
  } else {
    rigaCelle(c, [
      [['Ragione sociale', iscritto.impresa_txt || '—'], 2],
      [['In qualità di', iscritto.ruolo || '—'], 1],
      [['Ruolo aziendale', iscritto.mansione || '—'], 1],
    ]);
  }

  /* firma del responsabile del corso */
  c.serve(96);
  const yF = c.stato.y - 8;
  pg().drawText('Timbro e firma del responsabile del corso', { x: 330, y: yF, size: 9, font: c.font, color: c.grigio });
  pg().drawText(`(${ctx.firmaNome || 'Il responsabile del progetto formativo'})`, { x: 330, y: yF - 12, size: 9.5, font: c.bold, color: c.nero });
  if (ctx.firmaByte) {
    try {
      let img;
      try { img = await c.doc.embedPng(ctx.firmaByte); } catch { img = await c.doc.embedJpg(ctx.firmaByte); }
      const w = 130, h = Math.min((img.height / img.width) * w, 60);
      pg().drawImage(img, { x: 340, y: yF - 16 - h, width: w, height: h });
    } catch { /* si firma a mano */ }
  }
  pg().drawText(`Rilasciato a Padova il ${dataIt(ctx.dataRilascio) || dataIt(new Date().toISOString().slice(0, 10))}`,
    { x: SX, y: yF - 12, size: 9, font: c.font, color: c.nero });
  pg().drawText(`Verifica integrità documento — ${nTxt}`, { x: SX, y: yF - 26, size: 7, font: c.font, color: c.grigio });

  argomentiTrattati(c, corso, giornate, interventi);
  return salva(c.doc);
}

/* ── 2. REGISTRO PRESENZE ── */
export async function pdfRegistro(corso, giornate, interventi, iscritti, conf) {
  const c = await apriCarta();
  c.scrivi('REGISTRO PRESENZA ALLIEVI', c.bold, 14, c.arancio);
  c.stato.y -= 6;
  c.campo('Ente Attuatore', "FORMEDIL PADOVA — Ente Unico per la Formazione e la Sicurezza per il settore dell'Edilizia ed affini della Provincia di Padova");
  c.campo('Codice corso', String(corso.id));
  c.campo('Titolo corso', corso.titolo);
  c.campo('Sede di svolgimento', corso.sede);
  c.campo('Data inizio corso', dataIt(corso.data_inizio));
  c.campo('Data fine corso', dataIt(corso.data_fine || corso.data_inizio));
  c.campo('Settore ATECO', corso.ateco_txt);
  c.campo('Rappresentante Legale', corso.rappresentante_legale || conf.presidente_nome);
  c.campo('Resp. progetto formativo', corso.responsabile_formativo || conf.responsabile_formativo_nome);
  c.campo('Tipologia di corso', corso.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : corso.tipo);
  c.campo('Numero partecipanti', `Presenti allievi n° ______  (iscritti: ${iscritti.length})`);

  const partecipanti = iscritti.filter((i) => !['annullato', 'sostituito'].includes(i.esito))
    .sort((a, b) => a.nominativo.localeCompare(b.nominativo));

  for (const g of giornate) {
    c.nuovaPagina();
    c.scrivi(`${corso.titolo}`, c.bold, 10.5);
    c.scrivi(`Giorno lezione: ${dataIt(g.data)}    ·    Orario: ${fascia(g.dalle, g.alle)}${g.dalle2 ? ` e ${fascia(g.dalle2, g.alle2)}` : ''}    ·    Aula: ${g.aula || g.sede || corso.sede || '—'}`, c.font, 9.5, c.grigio);
    c.stato.y -= 6;

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

  /* numeri di pagina, ora che il totale è noto */
  const pagine = c.doc.getPages();
  pagine.forEach((p, i) => p.drawText(`Pagina ${i + 1} di ${pagine.length}`, { x: DX - 70, y: 40, size: 7.5, font: c.font, color: c.grigio }));
  const nota = `Il presente registro è composto di n° ${pagine.length} pagine progressivamente numerate dal n° 1 al n° ${pagine.length}`;
  pagine[0].drawText(nota, { x: SX, y: 52, size: 8, font: c.italic, color: c.nero });
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
