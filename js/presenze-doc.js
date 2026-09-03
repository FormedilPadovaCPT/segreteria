/* ============================================================
   I documenti del modulo Presenze.

   1. FOGLIO RILEVAZIONE PRESENZE del mese — ricalca la stampa
      Access che da sempre va all'Amministrazione (Patrizia):
      pagina 1 la griglia dei giorni (entrate/uscite/totale/
      motivazione), pagina 2 il riepilogo del mese per causale
      (straordinari, permessi, recuperi, ferie) dalla banca ore.
      Sigla REGP, deposito in
      2_AREE/Amministrazione/personale/fogli_presenze/.

   2. RICHIESTA DI FERIE O PERMESSI — ricalca il modulo Word
      dell'amministrazione: caselle permesso/ferie/recupero,
      monte ore, riquadro del nulla osta della Direzione.
      Con visto = il riquadro è compilato dall'app (come le
      autorizzazioni dei servizi CPT); senza visto = riquadro
      vuoto, per il giro cartaceo. Documento INTERNO: niente
      protocollo (regola del confine), vale il numero pratica.
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { dataIt } from './comune.js';

const SX = 57;
const DX = 538;

export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export const mm2hm = (min) => {
  const m = Math.abs(Math.round(min || 0));
  const s = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  return (min < 0 ? '-' : '') + s;
};

const salva = async (doc) => new Uint8Array(await doc.save());

/* ── 1. foglio rilevazione presenze ──
   presenze = righe s_presenze del mese (ordinate per data),
   extra = righe s_presenze_extra del mese.
   Disegno «carta Formedil» come gli altri documenti dell'app:
   banda arancio d'intestazione, griglia con verticali, weekend
   ombreggiati, assenze in evidenza, totale in banda piena. */
export async function pdfFoglioPresenze({ dipendente, anno, mese, presenze, extra, matricola, livello }) {
  const c = await apriCarta();

  c.scrivi('FOGLIO RILEVAZIONE PRESENZE', c.bold, 14, c.nero);
  c.scrivi(`${MESI[mese - 1].toUpperCase()} ${anno}`, c.bold, 11, c.arancio);
  c.stato.y -= 4;
  c.campo('Cognome / Nome', dipendente);
  c.campo('In servizio c/o', 'Padova, Via Basilicata, 10');
  if (matricola) c.campo('Matr.', String(matricola));
  if (livello) c.campo('Prof. / Liv.', String(livello));
  c.stato.y -= 8;

  /* colonne: confini verticali della griglia */
  const B = [SX, 148, 194, 240, 286, 332, 380, DX];   /* giorno|e1|u1|e2|u2|tot|note */
  const RH = 13.6;                                     /* altezza riga */
  const biancoSporco = { r: 0.965, g: 0.965, b: 0.965 };
  const rgbOf = (o) => o; /* leggibilità */

  const intesta = () => {
    c.serve(26);
    const y0 = c.stato.y - 4;
    c.stato.pagina.drawRectangle({ x: SX, y: y0 - 2, width: DX - SX, height: 17, color: c.arancio });
    const lab = ['GIORNO', 'ENTRATA', 'USCITA', 'ENTRATA', 'USCITA', 'TOT. ORE', 'ASSENZA / NOTE'];
    for (let i = 0; i < lab.length; i++) {
      c.stato.pagina.drawText(lab[i], { x: B[i] + 6, y: y0 + 3, size: 7.5, font: c.bold, color: c.bianco });
    }
    c.stato.y = y0 - 2 - RH + 3;
  };
  intesta();

  const perGiorno = {};
  for (const p of presenze) {
    const g = Number(p.data.slice(8, 10));
    (perGiorno[g] = perGiorno[g] || []).push(p);
  }
  const nGiorni = new Date(anno, mese, 0).getDate();
  const oraTxt = (t) => (t ? String(t).slice(0, 5) : '');
  const assenza = (n) => /^[A-ZÀÈÌÒÙ' .]+$/.test(String(n || '').trim()) && String(n).trim().length >= 4;
  let totMese = 0;
  let giorniLavorati = 0;

  const rigaGriglia = (yTop) => {
    /* verticali + fondo riga, tra yTop e yTop-RH */
    for (const x of B) c.stato.pagina.drawLine({ start: { x, y: yTop }, end: { x, y: yTop - RH }, thickness: 0.5, color: c.grigioChiaro });
    c.stato.pagina.drawLine({ start: { x: SX, y: yTop - RH }, end: { x: DX, y: yTop - RH }, thickness: 0.5, color: c.grigioChiaro });
  };

  for (let g = 1; g <= nGiorni; g++) {
    const dow = new Date(anno, mese - 1, g).getDay();
    const righe = perGiorno[g] || [null];
    const festivo = dow === 0 || dow === 6;
    for (let i = 0; i < righe.length; i++) {
      if (c.stato.y < 84) { c.nuovaPagina(); intesta(); }
      const p = righe[i];
      const yTop = c.stato.y + RH - 3.5;                 /* bordo alto della cella */
      if (festivo) {
        c.stato.pagina.drawRectangle({ x: SX, y: yTop - RH, width: DX - SX, height: RH,
          color: { type: 'RGB', red: biancoSporco.r, green: biancoSporco.g, blue: biancoSporco.b } });
      }
      rigaGriglia(yTop);
      if (i === 0) {
        c.stato.pagina.drawText(String(g), { x: SX + 6, y: c.stato.y, size: 8.8, font: c.bold, color: festivo ? c.grigio : c.nero });
        c.stato.pagina.drawText(`${GIORNI[dow]} ${String(g).padStart(2, '0')}/${String(mese).padStart(2, '0')}`,
          { x: SX + 24, y: c.stato.y, size: 8.2, font: festivo ? c.italic : c.font, color: festivo ? c.grigio : c.nero });
      }
      if (p) {
        const ore = [oraTxt(p.entra1), oraTxt(p.esce1), oraTxt(p.entra2), oraTxt(p.esce2)];
        for (let k = 0; k < 4; k++) {
          if (ore[k]) c.stato.pagina.drawText(ore[k], { x: B[k + 1] + 11, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
        }
        if (p.tot_min) {
          c.stato.pagina.drawText(mm2hm(p.tot_min), { x: B[5] + 11, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
          totMese += p.tot_min;
        }
        if (p.note) {
          const nota = String(p.note);
          if (assenza(nota)) {
            c.stato.pagina.drawText(nota.slice(0, 30), { x: B[6] + 6, y: c.stato.y, size: 8, font: c.bold, color: c.arancio });
          } else {
            c.stato.pagina.drawText(nota.slice(0, 34), { x: B[6] + 6, y: c.stato.y, size: 7.4, font: c.italic, color: c.grigio });
          }
        }
        if (i === 0 && (p.tot_min || 0) > 0) giorniLavorati += 1;
      }
      c.stato.y -= RH;
    }
  }

  /* banda del totale, piena come l'intestazione */
  c.serve(30);
  const yT = c.stato.y + RH - 3.5;
  c.stato.pagina.drawRectangle({ x: SX, y: yT - 19, width: DX - SX, height: 19, color: c.arancio });
  c.stato.pagina.drawText('TOTALE ORE LAVORATE NEL MESE', { x: SX + 6, y: yT - 13, size: 9, font: c.bold, color: c.bianco });
  const totTxt = `${mm2hm(totMese)}   —   giorni con presenza: ${giorniLavorati}`;
  c.stato.pagina.drawText(totTxt, { x: DX - 8 - c.bold.widthOfTextAtSize(totTxt, 9.5), y: yT - 13, size: 9.5, font: c.bold, color: c.bianco });
  c.stato.y = yT - 34;

  /* ── pagina 2: il riepilogo per causale, come la stampa Access ── */
  if ((extra || []).length) {
    c.nuovaPagina();
    c.scrivi('STRAORDINARI, PERMESSI E RECUPERI', c.bold, 14, c.nero);
    c.scrivi(`${MESI[mese - 1].toUpperCase()} ${anno} — ${dipendente}`, c.bold, 11, c.arancio);
    c.stato.y -= 8;
    const perCausale = {};
    for (const e of extra) (perCausale[e.causale] = perCausale[e.causale] || []).push(e);
    let totMov = 0;
    for (const [causale, righe] of Object.entries(perCausale)) {
      c.serve(34);
      const tot = righe.reduce((s, e) => s + (e.ore_min || 0), 0);
      totMov += tot;
      /* banda grigia con filo arancio a sinistra */
      const yB = c.stato.y + 10;
      c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: DX - SX, height: 16, color: c.grigioChiaro });
      c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: 3.2, height: 16, color: c.arancio });
      c.stato.pagina.drawText(causale.toUpperCase(), { x: SX + 10, y: yB - 10, size: 9, font: c.bold, color: c.nero });
      const totC = `${mm2hm(tot)} ore`;
      c.stato.pagina.drawText(totC, { x: DX - 8 - c.bold.widthOfTextAtSize(totC, 9), y: yB - 10, size: 9, font: c.bold, color: c.arancio });
      c.stato.y = yB - 27;
      for (const e of righe) {
        c.serve(15);
        c.stato.pagina.drawText(dataIt(e.data), { x: SX + 10, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
        c.stato.pagina.drawText(mm2hm(e.ore_min), { x: SX + 76, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
        const stato = e.chiuso ? 'chiusa' : 'APERTA';
        c.stato.pagina.drawText(stato, { x: SX + 116, y: c.stato.y, size: 7.6,
          font: e.chiuso ? c.italic : c.bold, color: e.chiuso ? c.grigio : c.arancio });
        const flag = [e.pagato ? 'pagata' : null, e.recuperato ? `recuperata${e.recuperato_il ? ' il ' + dataIt(e.recuperato_il) : ''}` : null].filter(Boolean).join(', ');
        if (flag) c.stato.pagina.drawText(flag, { x: SX + 158, y: c.stato.y, size: 7.4, font: c.italic, color: c.grigio });
        if (e.note) c.stato.pagina.drawText(String(e.note).slice(0, 52), { x: SX + 244, y: c.stato.y, size: 7.6, font: c.font, color: c.nero });
        c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y - 4 }, end: { x: DX, y: c.stato.y - 4 }, thickness: 0.4, color: c.grigioChiaro });
        c.stato.y -= 13.5;
      }
      c.stato.y -= 8;
    }
    c.serve(26);
    const yT2 = c.stato.y + 10;
    c.stato.pagina.drawRectangle({ x: SX, y: yT2 - 16, width: DX - SX, height: 17, color: c.arancio });
    c.stato.pagina.drawText('TOTALE MOVIMENTI DEL MESE', { x: SX + 6, y: yT2 - 11, size: 9, font: c.bold, color: c.bianco });
    const t2 = `${extra.length} movimenti — ${mm2hm(totMov)} ore`;
    c.stato.pagina.drawText(t2, { x: DX - 8 - c.bold.widthOfTextAtSize(t2, 9), y: yT2 - 11, size: 9, font: c.bold, color: c.bianco });
    c.stato.y = yT2 - 30;
  }
  return salva(c.doc);
}

/* ── 2. richiesta di ferie / permessi ──
   r = riga s_ferie_richieste; visto = null (riquadro vuoto) oppure
   { esito, nome, data_ora, utente, note }; firmaByte = png/jpg o null. */
export async function pdfRichiestaFerie(r, visto, firmaByte) {
  const c = await apriCarta();
  c.scrivi('Richiesta di ferie o permessi del personale dipendente', c.bold, 13, c.nero);
  c.scrivi('Modulo compilato dall’app Segreteria e sottoposto al Direttore per nulla osta; l’originale resta all’amministrazione per i calcoli a registro presenze.', c.italic, 7.5, c.grigio);
  c.stato.y -= 8;
  c.campo('Il dipendente', r.dipendente);
  c.campo('Pratica', `Richiesta n° ${r.id} del ${dataIt((r.created_at || '').slice(0, 10))}`);
  c.stato.y -= 6;

  const casella = (spuntata, testo) => {
    c.serve(18);
    c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 2, width: 11, height: 11, borderColor: c.nero, borderWidth: 0.9 });
    if (spuntata) c.stato.pagina.drawText('X', { x: SX + 2.4, y: c.stato.y, size: 9, font: c.bold, color: c.nero });
    c.stato.pagina.drawText(testo, { x: SX + 18, y: c.stato.y, size: 10, font: spuntata ? c.bold : c.font, color: c.nero });
    c.stato.y -= 16;
  };

  const oraTxt = (t) => (t ? String(t).slice(0, 5) : '—');
  casella(r.tipo === 'permesso', 'chiede un PERMESSO nel seguente periodo');
  if (r.tipo === 'permesso') {
    c.campo('In data', dataIt(r.data_inizio));
    c.campo('Dalle / alle', `${oraTxt(r.ora_dalle)} — ${oraTxt(r.ora_alle)}`);
  }
  casella(r.tipo === 'ferie', 'chiede FERIE nel seguente periodo');
  if (r.tipo === 'ferie') {
    c.campo('Data inizio', dataIt(r.data_inizio));
    c.campo('Data fine', r.data_fine ? dataIt(r.data_fine) : '—');
  }
  casella(r.tipo === 'recupero', 'chiede il RECUPERO per ore già effettuate o da effettuarsi');
  if (r.tipo === 'recupero') {
    c.campo('In data', [dataIt(r.data_inizio), r.data_fine ? `→ ${dataIt(r.data_fine)}` : ''].filter(Boolean).join(' '));
    if (r.ora_dalle || r.ora_alle) c.campo('Dalle / alle', `${oraTxt(r.ora_dalle)} — ${oraTxt(r.ora_alle)}`);
  }
  c.campo('Per totale ore', r.ore != null ? String(r.ore) : '—');
  if (r.motivo) c.campo('Note', r.motivo);
  c.stato.y -= 4;
  casella(r.monte === 'permessi', 'chiede di utilizzare il monte ore di PERMESSI retribuiti disponibile');
  casella(r.monte !== 'permessi', 'chiede di utilizzare il monte ore di FERIE disponibile');
  c.stato.y -= 8;

  c.scrivi('La Direzione, con il nulla osta della Presidenza FORMEDIL PADOVA', c.font, 9.5, c.grigio);
  c.stato.y -= 4;

  if (visto) {
    /* il visto registrato dall'app: come le autorizzazioni dei servizi */
    const ok = visto.esito === 'approvata';
    c.serve(110);
    const h = 92;
    const y0 = c.stato.y - h;
    c.stato.pagina.drawRectangle({ x: SX, y: y0, width: DX - SX, height: h, borderColor: c.arancio, borderWidth: 1.6 });
    c.stato.pagina.drawText(ok ? 'RICHIESTA APPROVATA' : 'RICHIESTA NON APPROVATA',
      { x: SX + 12, y: y0 + h - 20, size: 12, font: c.bold, color: c.arancio });
    c.stato.pagina.drawText(`${visto.nome} — Direttore`, { x: SX + 12, y: y0 + h - 38, size: 10.5, font: c.bold, color: c.nero });
    c.stato.pagina.drawText(`Padova, ${visto.data_ora}`, { x: SX + 12, y: y0 + h - 53, size: 9.5, font: c.font, color: c.nero });
    c.stato.pagina.drawText(`Approvazione registrata dall'app Segreteria — utente: ${visto.utente}`,
      { x: SX + 12, y: y0 + h - 67, size: 8, font: c.font, color: c.grigio });
    if (visto.note) c.stato.pagina.drawText(`Note: ${String(visto.note).slice(0, 90)}`, { x: SX + 12, y: y0 + h - 80, size: 8, font: c.font, color: c.grigio });
    if (firmaByte) {
      try {
        let img;
        try { img = await c.doc.embedPng(firmaByte); } catch { img = await c.doc.embedJpg(firmaByte); }
        const scala = Math.min(110 / img.width, (h - 24) / img.height);
        c.stato.pagina.drawImage(img, { x: DX - img.width * scala - 16, y: y0 + 12, width: img.width * scala, height: img.height * scala });
      } catch { /* senza firma grafica il visto vale lo stesso */ }
    }
    c.stato.y = y0 - 16;
  } else {
    /* riquadro vuoto per il giro cartaceo, come il modulo Word */
    casella(false, 'Approva la richiesta');
    casella(false, 'Non approva la richiesta, con le seguenti motivazioni: ______________________________');
    casella(false, 'Approva la richiesta con le seguenti condizioni: ____________________________________');
    c.serve(70);
    c.stato.y -= 22;
    c.stato.pagina.drawText(`Padova, lì ${dataIt(new Date().toISOString().slice(0, 10))}`, { x: SX, y: c.stato.y, size: 10, font: c.font, color: c.nero });
    c.stato.pagina.drawText('Firma del Direttore', { x: 250, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
    c.stato.pagina.drawText('Firma del dipendente', { x: 420, y: c.stato.y, size: 9, font: c.font, color: c.grigio });
    c.stato.y -= 26;
    c.stato.pagina.drawLine({ start: { x: 250, y: c.stato.y }, end: { x: 380, y: c.stato.y }, thickness: 0.6, color: c.grigio });
    c.stato.pagina.drawLine({ start: { x: 420, y: c.stato.y }, end: { x: DX, y: c.stato.y }, thickness: 0.6, color: c.grigio });
    c.stato.y -= 16;
  }
  c.scrivi('Documento interno: non prende numero di protocollo. La pratica è identificata dal numero di richiesta.', c.font, 7.5, c.grigio);
  return salva(c.doc);
}
