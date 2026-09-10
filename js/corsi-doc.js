/* ============================================================
   I documenti del modulo formazione.

   1. ATTESTATO — veste «ciclo a griglia», scelta dall'utente l'11/09/2026
      fra quattro varianti: banda arancione a sinistra, logo in alto a
      destra, i campi del modello storico in due griglie a filetti («Dati
      del corso», «Dati del corsista») con in mezzo la frase di
      certificazione. I dati e le frasi sono quelli di prima, parola per
      parola: è cambiata la grafica, non il contenuto. Tre certificazioni:
      partecipazione (senza impresa) / regolare frequenza / frequenza +
      verifica finale. Numero della serie dedicata N/aaaa (decisa il
      01/09/2026), o «Prot.» storico in ristampa.
      ⚠️ Il logo blu della Regione va SOLO sui corsi riconosciuti
      (riconosciuto_regione): img/logo-regione.png, se presente. I corsi
      in progetti finanziati possono avere altri loghi (ctx.loghiExtra,
      byte immagine). Stanno in alto, a sinistra del logo Formedil.
      Pagina 2: argomenti trattati (giornate + interventi + crediti).

   2. REGISTRO PRESENZE — veste «ciclo», scelta dall'utente l'11/09/2026:
      la stessa della copertina del fascicolo di asseverazione. Copertina
      coi dati del corso, poi per ogni giornata i docenti con lo spazio
      firma, l'elenco dei partecipanti con firma entrata/uscita e la
      chiusura (note, totali, visto). Lo firma il RESPONSABILE DEL
      PROGETTO FORMATIVO (Balladore), non il Direttore.

   Attestato e registro disegnano la loro carta da sé (apriCiclo); il logo
   è img/logo-pdf.jpg (600 px, lo stesso della copertina asseverazione),
   con img/logo.png come riserva.

   3. LETTERA DI INCARICO DOCENZA — il contratto d'opera del
      modello storico (Prot. OUT nel registro unico), con i
      compiti del docente, i compensi e l'accordo quadro. Resta sulla
      carta intestata di segnalazioni-doc.js (apriCarta).
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { ENTE, COLORI } from './config.js';
import { dataIt, oggiIso, taglia, testoPdf } from './comune.js';
import { pdfLib, qrGen } from './cdn.js';

const SX = 57;
const DX = 538;
const A4 = [595.28, 841.89];
const salva = async (doc) => new Uint8Array(await doc.save());

/* dimensioni entro un riquadro SENZA deformare (proporzioni conservate) */
function adatta(img, maxW, maxH) {
  const scala = Math.min(maxW / img.width, maxH / img.height);
  return { width: img.width * scala, height: img.height * scala };
}

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
const fasciaGiornata = (g) => fascia(g.dalle, g.alle) + (g.dalle2 ? ` e ${fascia(g.dalle2, g.alle2)}` : '');
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const giornoSett = (iso) => (iso ? GIORNI[new Date(`${String(iso).slice(0, 10)}T12:00:00`).getDay()] : '');
const nome = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const QUALITA_DOCENTE = ['docente', 'codocente', 'relatore'];
const MODALITA = { aula: 'Corso in aula', cantiere: 'Corso in cantiere', impresa: 'Corso in impresa', videoconferenza: 'Corso in videoconferenza', mista: 'Corso in modalità mista' };
const tipologia = (corso) => (corso.tipo === 'conferenza_cantiere' ? 'Conferenza di Cantiere' : (MODALITA[corso.modalita] || 'Corso'));
const GDPR = 'Ai sensi degli artt. 13 e 14 del Regolamento Europeo n. 2016/679 (GDPR), ciascun firmatario esprime il consenso al trattamento dei propri dati personali da parte di Formedil Padova, Via Basilicata 10 — Padova, per le finalità e con le modalità contenute nell\'informativa, che conferma di aver ricevuto e della quale ha preso integrale visione.';
const righeEnte = () => [
  "FORMEDIL PADOVA — Ente Unico per la Formazione e la Sicurezza per il settore dell'Edilizia ed affini della Provincia di Padova",
  'ANCE PADOVA · FENEAL UIL · FILCA CISL · FILLEA CGIL — Accreditamento Regione Veneto L.R. N. 19 del 09.08.02 cod. A0119',
  `CF 80006850285 · P.IVA 02585760289 · CCIAA PD REA 294715 · ${ENTE.indirizzo} · tel. ${ENTE.tel} · ${ENTE.email}`,
];

/* QR a vettore, come il timbro (nitido in stampa, niente bitmap) */
function disegnaQr(pg, qrcode, testo, x, y, lato, colore) {
  const qr = qrcode(0, 'M');
  qr.addData(testo);
  qr.make();
  const n = qr.getModuleCount();
  const passo = lato / n;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(r, col)) continue;
      pg.drawRectangle({ x: x + col * passo, y: y + lato - (r + 1) * passo, width: passo + 0.2, height: passo + 0.2, color: colore });
    }
  }
}

/* ── la carta «ciclo»: documento, font, colori e logo ── */
async function apriCiclo() {
  const { PDFDocument, StandardFonts, rgb } = await pdfLib();
  const doc = await PDFDocument.create();
  const F = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold),
    i: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const C = {
    arancio: rgb(...COLORI.arancio), grigio: rgb(...COLORI.grigio), bianco: rgb(1, 1, 1), nero: rgb(0.1, 0.1, 0.1),
    tenue: rgb(0.545, 0.569, 0.6), linea: rgb(0.835, 0.847, 0.863), bordo: rgb(0.62, 0.64, 0.67),
    zebra: rgb(0.965, 0.965, 0.97), alone: rgb(0.988, 0.863, 0.796), filigrana: rgb(0.945, 0.949, 0.953),
    etichetta: rgb(0.765, 0.784, 0.808),
  };
  /* il logo in alta risoluzione; se non si trova, quello della carta intestata; la carta regge anche senza */
  let logo = null;
  for (const [url, jpg] of [['img/logo-pdf.jpg', true], ['img/logo.png', false]]) {
    try {
      const byte = new Uint8Array(await (await fetch(url)).arrayBuffer());
      logo = jpg ? await doc.embedJpg(byte) : await doc.embedPng(byte);
      break;
    } catch { /* si prova il successivo */ }
  }
  const pagina = () => {
    const pg = doc.addPage(A4);
    pg.drawRectangle({ x: 0, y: 0, width: 34, height: A4[1], color: C.arancio });
    return pg;
  };
  return { doc, F, C, logo, pagina };
}

/* testo con allineamento e spaziatura delle lettere; restituisce la larghezza.
   Gli a capo si appiattiscono: pdf-lib non sa misurare «\n» (WinAnsi). */
function T(pg, s, x, y, size, f, color, o = {}) {
  const t = testoPdf(String(s ?? '')).replace(/\s*[\r\n\t]+\s*/g, ' ');
  const sp = o.sp || 0;
  const w = f.widthOfTextAtSize(t, size) + sp * Math.max(0, t.length - 1);
  let xx = o.al === 'r' ? x - w : o.al === 'c' ? x - w / 2 : x;
  if (!sp) pg.drawText(t, { x: xx, y, size, font: f, color });
  else for (const ch of t) { pg.drawText(ch, { x: xx, y, size, font: f, color }); xx += f.widthOfTextAtSize(ch, size) + sp; }
  return w;
}
/* a capo alla parola, misurando col font */
function righe(s, f, size, largo) {
  const out = [];
  let r = '';
  for (const p of testoPdf(String(s ?? '')).replace(/\s+/g, ' ').trim().split(' ')) {
    const prova = r ? `${r} ${p}` : p;
    if (r && f.widthOfTextAtSize(prova, size) > largo) { out.push(r); r = p; } else r = prova;
  }
  out.push(r || '—');
  return out;
}
const cut = (f, size, s, largo) => taglia(f, size, testoPdf(nome(s)), largo);
const linea = (pg, x1, y1, x2, y2, color, thickness = 0.6, dashArray) =>
  pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness, ...(dashArray ? { dashArray } : {}) });
const altLogo = (k, w) => (k.logo ? w * k.logo.height / k.logo.width : 0);
function logoIn(k, pg, x, y, w) {
  if (!k.logo) return 0;
  const h = altLogo(k, w);
  pg.drawImage(k.logo, { x, y, width: w, height: h });
  return h;
}
function enteBlocco(k, pg, x, y, largo) {
  let yy = y;
  righeEnte().forEach((s, i) => {
    const f = i === 0 ? k.F.b : k.F.r;
    for (const r of righe(s, f, 6.2, largo)) { T(pg, r, x, yy, 6.2, f, k.C.tenue); yy -= 8.2; }
  });
}
/* griglia a filetti: righe di celle [etichetta, valore, peso, corpo] */
function griglia(k, pg, X0, Wc, y, rows, { val = 10.5, verticali = false } = {}) {
  const { F, C } = k;
  linea(pg, X0, y, X0 + Wc, y, C.linea);
  for (const row of rows) {
    const tot = row.reduce((s, c) => s + (c[2] || 1), 0);
    let x = X0, hMax = 0;
    const celle = [];
    for (const [l, v, peso = 1, corpo = val] of row) {
      const w = Wc * peso / tot;
      const rr = righe(v ?? '—', F.b, corpo, w - 14);
      hMax = Math.max(hMax, 16 + corpo + 10 + (rr.length - 1) * (corpo + 3));
      celle.push([x, l, rr, corpo]);
      x += w;
    }
    celle.forEach(([cx, l, rr, corpo], i) => {
      const pad = verticali && i ? 7 : 0;
      T(pg, String(l).toUpperCase(), cx + pad, y - 12, 6.3, F.r, C.tenue, { sp: 1.1 });
      rr.forEach((r, j) => T(pg, r, cx + pad, y - 18 - corpo - j * (corpo + 3), corpo, F.b, C.grigio));
      if (verticali && i) linea(pg, cx, y, cx, y - hMax, C.linea);
    });
    y -= hMax;
    linea(pg, X0, y, X0 + Wc, y, C.linea);
  }
  return y;
}

/* ── 1. ATTESTATO ──
   iscritto: riga s_corsi_iscritti; anagrafica: {nato_luogo, nato_il} se agganciato;
   ctx: { numero, firmaByte, firmaNome, logoRegioneByte, loghiExtra: [byte], dataRilascio } */
export async function pdfAttestato(corso, iscritto, anagrafica, giornate, interventi, ctx) {
  const k = await apriCiclo();
  const { doc, F, C } = k;
  const H = A4[1], X0 = 70, X1 = 545, Wc = X1 - X0;
  const numero = String(ctx.numero ?? '');
  const nTxt = numero.includes('/') ? `Attestato n. ${numero}` : `Prot.: ${numero}`;
  const tipoAtt = corso.tipo_attestato || 'frequenza';
  const partecipazione = tipoAtt === 'partecipazione';
  const titoloAtt = { partecipazione: 'Attestato di partecipazione', frequenza: 'Attestato di frequenza', frequenza_verifica: 'Attestato di frequenza e verifica finale' }[tipoAtt] || 'Attestato';
  const certificazione = {
    partecipazione: `Si certifica la partecipazione a ${corso.titolo} per il corsista:`,
    frequenza: 'Si certifica la regolare frequenza per il corsista:',
    frequenza_verifica: 'Si certifica la regolare frequenza e il superamento con esito positivo della verifica finale di apprendimento per il corsista:',
  }[tipoAtt];
  const dataRil = ctx.dataRilascio || oggiIso();
  const oreTot = corso.durata_ore ?? '—';
  const oreFreq = iscritto.ore_frequentate ?? oreTot;
  const perc = iscritto.perc_frequenza != null ? `${Math.round(iscritto.perc_frequenza)}%` : '100%';

  let pg = k.pagina();

  /* testata: logo Formedil a destra; a sinistra di questo il logo Regione
     (SOLO corsi riconosciuti) e gli eventuali loghi di progetto */
  const lw = 150, lh = altLogo(k, lw);
  logoIn(k, pg, X1 - lw, H - 46 - lh, lw);
  const loghi = [];
  if (corso.riconosciuto_regione && ctx.logoRegioneByte) loghi.push(ctx.logoRegioneByte);
  loghi.push(...(ctx.loghiExtra || []));
  let xLogo = X1 - (k.logo ? lw + 16 : 0);
  for (const byte of loghi) {
    let img;
    try { img = await doc.embedPng(byte); } catch { try { img = await doc.embedJpg(byte); } catch { continue; } }
    const h = 34, w = (img.width / img.height) * h;
    if (xLogo - w < X0 + 230) break;   /* non sopra il numero */
    pg.drawImage(img, { x: xLogo - w, y: H - 46 - (lh || h) / 2 - h / 2, width: w, height: h });
    xLogo -= w + 14;
  }
  T(pg, `${titoloAtt}  ·  ${tipologia(corso)}`.toUpperCase(), X0, H - 56, 7, F.r, C.arancio, { sp: 1.4 });
  T(pg, nTxt, X0, H - 79, 18, F.b, C.grigio);

  const barra = (testo, y) => {
    pg.drawRectangle({ x: X0, y: y - 18, width: Wc, height: 18, color: C.grigio });
    T(pg, testo.toUpperCase(), X0 + 8, y - 12, 7, F.b, C.bianco, { sp: 1.4 });
    return y - 18;
  };

  let y = barra('Dati del corso', H - 122);
  y = griglia(k, pg, X0, Wc, y, [
    [['Titolo del corso', corso.titolo, 2, 11.5], ['Sede', corso.sede || '—', 1, 9.5]],
    [['Anno formativo', corso.anno_formativo ?? '—'], ['Data inizio', dataIt(corso.data_inizio) || '—'], ['Data fine', dataIt(corso.data_fine || corso.data_inizio) || '—']],
    [['Totale ore corso', oreTot], ['Ore frequentate', oreFreq], ['Frequenza corsista', perc], ['Frequenza minima', `${corso.perc_freq_min ?? 90}%`]],
    [['Tipologia di corso', tipologia(corso)], ['Settore ATECO', corso.ateco_txt || '—', 2]],
    [['Il presente certificato è valido per', corso.validita_txt || 'Informazione']],
  ], { verticali: true });

  y -= 30;
  pg.drawRectangle({ x: X0, y: y - 6, width: 4, height: 20, color: C.arancio });
  righe(certificazione, F.b, 12.5, Wc - 16).forEach((r) => { T(pg, r, X0 + 14, y, 12.5, F.b, C.grigio); y -= 16; });
  y -= 18;

  y = barra('Dati del corsista', y);
  const corsista = [[['Nome e cognome', nome(iscritto.nominativo), 2, 17], ['Codice fiscale', iscritto.cf || '—', 1, 11]]];
  if (anagrafica?.nato_luogo || anagrafica?.nato_il) {
    corsista.push([['Luogo di nascita', anagrafica.nato_luogo || '—', 2], ['Data di nascita', anagrafica.nato_il ? dataIt(anagrafica.nato_il) : '—', 1]]);
  }
  corsista.push(partecipazione
    ? [['In qualità di', iscritto.ruolo || '—'], ['Ruolo aziendale', iscritto.mansione || '—']]
    : [['Ragione sociale', iscritto.impresa_txt || '—', 2], ['In qualità di', iscritto.ruolo || '—', 1], ['Ruolo aziendale', iscritto.mansione || '—', 1]]);
  y = griglia(k, pg, X0, Wc, y, corsista, { verticali: true });

  /* rilascio e QR a sinistra, firma del responsabile a destra */
  const yb = y - 30;
  T(pg, `Rilasciato a Padova il ${dataIt(dataRil)}`, X0, yb, 10, F.b, C.grigio);
  try {
    const qrcode = await qrGen();
    const testoQr = [
      'FORMEDIL PADOVA', nTxt, iscritto.nominativo, iscritto.cf ? `CF ${iscritto.cf}` : null,
      `Corso ${corso.id} — ${String(corso.titolo).slice(0, 60)}`,
      dataIt(dataRil) || '',
    ].filter(Boolean).join(' | ');
    disegnaQr(pg, qrcode, testoQr, X0, yb - 72, 58, C.nero);
    T(pg, 'Verifica integrità documento', X0, yb - 82, 6.5, F.r, C.tenue);
    T(pg, nTxt, X0, yb - 93, 8, F.b, C.grigio);
  } catch {
    T(pg, nTxt, X0, yb - 16, 8, F.b, C.grigio);
  }
  const cf = X0 + Wc * 0.68;
  T(pg, 'Timbro e firma del responsabile del corso', cf, yb, 8, F.r, C.tenue, { al: 'c' });
  T(pg, `(${ctx.firmaNome || 'Il responsabile del progetto formativo'})`, cf, yb - 13, 10, F.b, C.grigio, { al: 'c' });
  if (ctx.firmaByte) {
    try {
      let img;
      try { img = await doc.embedPng(ctx.firmaByte); } catch { img = await doc.embedJpg(ctx.firmaByte); }
      const { width, height } = adatta(img, 175, 98);
      pg.drawImage(img, { x: cf - width / 2, y: yb - 18 - height, width, height });
    } catch { /* si firma a mano */ }
  }
  enteBlocco(k, pg, X0, 68, Wc);

  argomentiTrattati(k, corso, nome(iscritto.nominativo), nTxt, giornate, interventi);

  const pagine = doc.getPages();
  pagine.forEach((p, i) => {
    T(p, `Stampato a Padova il ${dataIt(dataRil)}`, X0, 24, 6.8, F.i, C.tenue);
    T(p, `Pagina ${i + 1} di ${pagine.length}`, X1, 24, 7.5, F.b, C.grigio, { al: 'r' });
  });
  return salva(doc);
}

/* pagina 2 dell'attestato: argomenti trattati, giornata per giornata */
function argomentiTrattati(k, corso, nominativo, nTxt, giornate, interventi) {
  const { F, C } = k;
  const H = A4[1], X0 = 70, X1 = 545;
  let pg = k.pagina();
  const testa = (segue) => {
    T(pg, `Argomenti trattati  ·  ${nTxt}`.toUpperCase(), X0, H - 40, 7, F.r, C.arancio, { sp: 1.4 });
    T(pg, cut(F.b, 12, nominativo, X1 - X0), X0, H - 57, 12, F.b, C.grigio);
    T(pg, cut(F.r, 8.5, `${corso.titolo}${segue ? '  (segue)' : ''}`, X1 - X0), X0, H - 70, 8.5, F.r, C.tenue);
    linea(pg, X0, H - 82, X1, H - 82, C.linea, 0.8);
    return H - 112;
  };
  let y = testa(false);
  const serve = (h) => { if (y - h < 60) { pg = k.pagina(); y = testa(true); } };
  let crediti = 0;
  const intervento = (it) => {
    const tx = X0 + 84;
    const arg = it.argomenti ? righe(it.argomenti, F.i, 8.5, X1 - tx) : [];
    serve(30 + arg.length * 11);
    T(pg, fascia(it.dalle, it.alle) || '—', X0, y, 8.5, F.r, C.tenue);
    const q = it.qualita ? it.qualita.charAt(0).toUpperCase() + it.qualita.slice(1) : 'Docente';
    const wq = T(pg, `${q}  `, tx, y, 8.5, F.r, C.tenue);
    T(pg, cut(F.b, 10, it.nominativo, X1 - tx - wq - 100), tx + wq, y, 10, F.b, C.grigio);
    T(pg, `Crediti formativi  ${it.crediti ?? 0}`, X1, y, 8, F.i, C.tenue, { al: 'r' });
    y -= 12.5;
    if (it.materia) { T(pg, cut(F.r, 8, `Materia: ${it.materia}`, X1 - tx), tx, y, 8, F.r, C.tenue); y -= 11; }
    arg.forEach((r) => { T(pg, r, tx, y, 8.5, F.i, C.grigio); y -= 11; });
    y -= 10;
    crediti += Number(it.crediti || 0);
  };
  for (const g of giornate) {
    serve(64);
    const w = T(pg, dataIt(g.data), X0, y, 17, F.b, C.grigio);
    T(pg, giornoSett(g.data), X0 + w + 8, y, 9, F.r, C.tenue);
    T(pg, fasciaGiornata(g), X1, y + 1, 12, F.b, C.arancio, { al: 'r' });
    y -= 13;
    if (g.aula || g.sede) T(pg, cut(F.r, 8, g.aula || g.sede, 260), X1, y, 8, F.r, C.tenue, { al: 'r' });
    y -= 16;
    interventi.filter((x) => x.giornata_id === g.id).forEach(intervento);
    linea(pg, X0, y + 4, X1, y + 4, C.linea, 0.6);
    y -= 14;
  }
  const orfani = interventi.filter((x) => !x.giornata_id || !giornate.some((g) => g.id === x.giornata_id));
  if (orfani.length) { orfani.forEach(intervento); y -= 4; }
  serve(40);
  const bw = 190, bh = 34;
  pg.drawRectangle({ x: X1 - bw, y: y - bh, width: bw, height: bh, color: C.grigio });
  T(pg, 'TOTALE CREDITI', X1 - bw + 14, y - 21, 7, F.r, C.etichetta, { sp: 1.4 });
  T(pg, String(crediti), X1 - 14, y - 24, 16, F.b, C.bianco, { al: 'r' });
}

/* ── 2. REGISTRO PRESENZE ── */
export async function pdfRegistro(corso, giornate, interventi, iscritti, conf) {
  const k = await apriCiclo();
  const { doc, F, C } = k;
  const H = A4[1], X0 = 70, X1 = 545, Wc = X1 - X0, FONDO = 50, RIGA = 22;
  const resp = corso.responsabile_formativo || conf.responsabile_formativo_nome || '';
  const legale = corso.rappresentante_legale || conf.presidente_nome || '—';
  const tipoTxt = tipologia(corso);
  const fine = corso.data_fine || corso.data_inizio;
  const dateTxt = corso.data_inizio === fine ? (dataIt(corso.data_inizio) || '—') : `${dataIt(corso.data_inizio) || '—'} – ${dataIt(fine) || '—'}`;
  const partecipanti = iscritti.filter((i) => !['annullato', 'sostituito'].includes(i.esito))
    .sort((a, b) => a.nominativo.localeCompare(b.nominativo, 'it', { numeric: true }));
  const docentiDi = (g) => interventi.filter((x) => x.giornata_id === g.id && QUALITA_DOCENTE.includes(x.qualita));
  const docentiUnici = [...new Map(interventi.filter((x) => QUALITA_DOCENTE.includes(x.qualita)).map((x) => [nome(x.nominativo), x])).values()];

  /* ── copertina ── */
  let pg = k.pagina();
  T(pg, String(corso.id), X1 + 4, 124, 118, F.b, C.filigrana, { al: 'r' });
  logoIn(k, pg, X1 - 150, H - 46 - altLogo(k, 150), 150);
  let y = 650;
  T(pg, `Registro presenze allievi  ·  ${tipoTxt}`.toUpperCase(), X0, y, 8, F.r, C.arancio, { sp: 1.4 });
  y -= 36;
  const tit = righe(corso.titolo, F.b, 27, Wc);
  tit.forEach((r, i) => T(pg, r, X0, y - i * 31, 27, F.b, C.grigio));
  y -= (tit.length - 1) * 31 + 21;
  const sede = righe(corso.sede || '—', F.r, 10.5, Wc);
  sede.forEach((r, i) => T(pg, r, X0, y - i * 14, 10.5, F.r, C.tenue));
  y -= (sede.length - 1) * 14 + 50;

  /* le giornate: una sola in chiaro, più d'una come tappe su una linea */
  if (giornate.length === 1) {
    const g = giornate[0];
    pg.drawEllipse({ x: X0 + 11, y: y + 4, xScale: 12, yScale: 12, color: C.alone });
    pg.drawEllipse({ x: X0 + 11, y: y + 4, xScale: 6.5, yScale: 6.5, color: C.arancio });
    const w1 = T(pg, `${giornoSett(g.data)} ${dataIt(g.data)}`, X0 + 34, y, 13, F.b, C.grigio);
    T(pg, cut(F.r, 10.5, `·  ${fasciaGiornata(g)}  ·  ${g.aula || g.sede || ''}`, Wc - w1 - 50), X0 + 42 + w1, y, 10.5, F.r, C.tenue);
    y -= 46;
  } else if (giornate.length > 1) {
    const cx = (i) => X0 + Wc * (2 * i + 1) / (2 * giornate.length);
    const fitte = giornate.length > 6;
    linea(pg, cx(0), y, cx(giornate.length - 1), y, C.grigio, 2.5);
    giornate.forEach((g, i) => {
      pg.drawEllipse({ x: cx(i), y, xScale: 6, yScale: 6, color: i === 0 ? C.arancio : C.grigio });
      T(pg, fitte ? String(dataIt(g.data)).slice(0, 5) : dataIt(g.data), cx(i), y - 20, fitte ? 7.5 : 8.5, F.b, C.grigio, { al: 'c' });
      if (!fitte) T(pg, fasciaGiornata(g), cx(i), y - 31, 7.5, F.r, C.tenue, { al: 'c' });
    });
    y -= 64;
  }

  /* banda grigia coi tre dati */
  const bh = 60;
  pg.drawRectangle({ x: X0, y: y - bh, width: Wc, height: bh, color: C.grigio });
  [['Codice corso', String(corso.id)], [giornate.length > 1 ? 'Date' : 'Data', dateTxt], ['Durata', `${corso.durata_ore ?? '—'} ore`]]
    .forEach(([l, v], i) => {
      const cx = X0 + 18 + i * (Wc / 3);
      T(pg, l.toUpperCase(), cx, y - 21, 7, F.r, C.etichetta, { sp: 1.4 });
      T(pg, v, cx, y - 43, F.b.widthOfTextAtSize(testoPdf(v), 15) > Wc / 3 - 24 ? 11 : 15, F.b, C.bianco);
    });
  y -= bh + 36;

  /* docenti a sinistra, responsabili e partecipanti a destra */
  const xR = X0 + Wc * 0.5;
  let yl = y;
  T(pg, 'DOCENTI', X0, yl, 7.5, F.r, C.tenue, { sp: 1.4 });
  yl -= 18;
  const mostrati = docentiUnici.slice(0, 5);
  for (const it of mostrati) {
    T(pg, cut(F.b, 13.5, it.nominativo, xR - X0 - 12), X0, yl, 13.5, F.b, C.grigio);
    T(pg, cut(F.r, 8, it.materia || '', xR - X0 - 16), X0, yl - 12, 8, F.r, C.tenue);
    yl -= 33;
  }
  if (docentiUnici.length > mostrati.length) T(pg, `e altri ${docentiUnici.length - mostrati.length}`, X0, yl + 8, 8.5, F.i, C.tenue);
  let yr = y;
  const campoR = (l, v, corpo = 11.5, colore = C.grigio) => {
    T(pg, l.toUpperCase(), xR, yr, 7.5, F.r, C.tenue, { sp: 1.4 });
    const rr = righe(v, F.b, corpo, X1 - xR);
    rr.forEach((r, i) => T(pg, r, xR, yr - 16 - i * (corpo + 3), corpo, F.b, colore));
    yr -= 16 + rr.length * (corpo + 3) + 12;
  };
  campoR('Responsabile del progetto formativo', resp || '—');
  campoR('Rappresentante legale', legale);
  campoR('Settore', corso.ateco_txt || '—', 9.5);
  campoR('Partecipanti', `Presenti n° ______ su ${partecipanti.length} iscritti`, 11, C.arancio);
  const yNota = 108;
  enteBlocco(k, pg, X0, 80, Wc);

  /* ── pagine delle giornate ── */
  const testata = (g, segue) => {
    const lh = altLogo(k, 88);
    logoIn(k, pg, X1 - 88, H - 30 - lh, 88);
    T(pg, `REGISTRO PRESENZE  ·  CORSO ${corso.id}`, X0, H - 34, 7, F.r, C.arancio, { sp: 1.4 });
    T(pg, cut(F.b, 10.5, corso.titolo, X1 - X0 - 104), X0, H - 49, 10.5, F.b, C.grigio);
    const yt = H - 30 - Math.max(lh, 28) - 36;
    const w = T(pg, dataIt(g.data), X0, yt, 22, F.b, C.grigio);
    T(pg, `${giornoSett(g.data)}${segue ? '  ·  segue' : ''}`, X0 + w + 9, yt, 10, F.r, C.tenue);
    T(pg, fasciaGiornata(g), X1, yt + 2, 15, F.b, C.arancio, { al: 'r' });
    T(pg, cut(F.r, 8.5, g.aula || g.sede || corso.sede || '', 220), X1, yt - 12, 8.5, F.r, C.tenue, { al: 'r' });
    linea(pg, X0, yt - 22, X1, yt - 22, C.linea, 0.8);
    return yt - 38;
  };
  const cols = [0.052, 0.33, 0.258, 0.18, 0.18].map((p) => p * Wc);
  const xs = cols.map((_, i) => X0 + cols.slice(0, i).reduce((s, w) => s + w, 0));
  const intesta = (yy) => {
    pg.drawRectangle({ x: X0, y: yy - 18, width: Wc, height: 18, color: C.grigio });
    ['N°', 'Partecipante · codice fiscale', 'Impresa', 'Firma entrata', 'Firma uscita'].forEach((t, i) =>
      T(pg, t.toUpperCase(), i ? xs[i] + 5 : xs[0] + cols[0] / 2, yy - 12, 6.2, F.b, C.bianco, { sp: 0.5, al: i ? undefined : 'c' }));
    return yy - 18;
  };

  for (const g of giornate) {
    pg = k.pagina();
    y = testata(g, false);

    /* docenti della giornata, due per riga, con lo spazio firma */
    const lista = docentiDi(g);
    if (lista.length) {
      const gap = 20, cw = (Wc - gap) / 2;
      T(pg, 'DOCENTI DELLA GIORNATA', X0, y, 7, F.r, C.tenue, { sp: 1.4 });
      y -= 16;
      for (let i = 0; i < lista.length; i += 2) {
        if (y - 56 < FONDO + 40) { pg = k.pagina(); y = testata(g, true); }
        lista.slice(i, i + 2).forEach((it, j) => {
          const x = X0 + j * (cw + gap);
          T(pg, cut(F.b, 10.5, it.nominativo, cw), x, y, 10.5, F.b, C.grigio);
          T(pg, cut(F.r, 7.5, `${fascia(it.dalle, it.alle)}  ·  ${it.materia || ''}`, cw), x, y - 11, 7.5, F.r, C.tenue);
          if (it.argomenti) T(pg, cut(F.i, 7.5, it.argomenti, cw), x, y - 21, 7.5, F.i, C.grigio);
          T(pg, 'Firma', x, y - 40, 6.5, F.r, C.tenue);
          linea(pg, x + 24, y - 40, x + cw, y - 40, C.grigio, 0.7);
        });
        y -= 56;
      }
      y += 6;
    }
    y -= 12;

    /* partecipanti */
    y = intesta(y);
    partecipanti.forEach((p, n) => {
      if (y - RIGA < FONDO) { pg = k.pagina(); y = testata(g, true) - 6; y = intesta(y); }
      if (n % 2) pg.drawRectangle({ x: X0, y: y - RIGA, width: Wc, height: RIGA, color: C.zebra });
      linea(pg, X0, y - RIGA, X1, y - RIGA, C.linea, 0.5);
      [3, 4].forEach((i) => linea(pg, xs[i], y, xs[i], y - RIGA, C.linea, 0.5));
      T(pg, String(n + 1), xs[0] + cols[0] / 2, y - 13.5, 7.5, F.r, C.tenue, { al: 'c' });
      T(pg, cut(F.b, 8, p.nominativo, cols[1] - 8), xs[1] + 4, y - 9.5, 8, F.b, C.grigio);
      if (p.cf) T(pg, p.cf, xs[1] + 4, y - 18, 6.2, F.r, C.tenue);
      T(pg, cut(F.r, 7.3, p.impresa_txt || '', cols[2] - 8), xs[2] + 4, y - 13.5, 7.3, F.r, C.grigio);
      y -= RIGA;
    });

    /* chiusura della giornata */
    if (y - 122 < FONDO) { pg = k.pagina(); y = testata(g, true); }
    y -= 16;
    T(pg, 'Note (entrate in ritardo, uscite anticipate, variazioni di orario rispetto al calendario)', X0, y, 7, F.r, C.tenue);
    linea(pg, X0, y - 16, X1, y - 16, C.bordo, 0.6, [1.2, 2.2]);
    y -= 38;
    ['Presenti del giorno', 'Ore del giorno', 'Totale progressivo ore'].forEach((l, i) => {
      const bx = X0 + i * 88;
      T(pg, l, bx, y, 6.5, F.r, C.tenue);
      pg.drawRectangle({ x: bx, y: y - 27, width: 80, height: 21, borderColor: C.bordo, borderWidth: 0.7 });
    });
    const vx = X1 - 196;
    T(pg, 'Visto del responsabile del progetto formativo', vx, y, 6.5, F.r, C.tenue);
    T(pg, resp, vx, y - 11, 8.5, F.b, C.grigio);
    linea(pg, vx, y - 31, X1, y - 31, C.grigio, 0.7);
    y -= 46;
    righe(GDPR, F.r, 5.8, Wc).forEach((r, i) => T(pg, r, X0, y - i * 7.4, 5.8, F.r, C.tenue));
  }

  /* piè di pagina e numero di pagine, ora che il totale è noto */
  const pagine = doc.getPages();
  const stampa = dataIt(oggiIso());
  pagine.forEach((p, i) => {
    T(p, `Registro presenze allievi · corso ${corso.id} · stampato a Padova il ${stampa}`, X0, 26, 6.8, F.r, C.tenue);
    T(p, `Pagina ${i + 1} di ${pagine.length}`, X1, 26, 7.5, F.b, C.grigio, { al: 'r' });
  });
  const nota = `Il presente registro di formazione è composto di n° ${pagine.length} pagine progressivamente numerate dal n° 1 al n° ${pagine.length}`;
  righe(nota, F.i, 8.5, Wc).forEach((r, i) => T(pagine[0], r, X0, yNota - i * 11.5, 8.5, F.i, C.grigio));
  return salva(doc);
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
      const { width, height } = adatta(img, 130, 60);
      c.stato.pagina.drawImage(img, { x: 330, y: yF - 16 - height, width, height });
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
