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
   extra = righe s_presenze_extra del mese. */
export async function pdfFoglioPresenze({ dipendente, anno, mese, presenze, extra, matricola, livello }) {
  const c = await apriCarta();

  c.scrivi(`FOGLIO RILEVAZIONE PRESENZE — ${MESI[mese - 1].toUpperCase()} ${anno}`, c.bold, 13, c.nero);
  c.stato.y -= 2;
  c.campo('Cognome / Nome', dipendente);
  c.campo('In servizio c/o', 'Padova, Via Basilicata, 10');
  if (matricola) c.campo('Matr.', String(matricola));
  if (livello) c.campo('Prof. / Liv.', String(livello));
  c.stato.y -= 6;

  /* intestazione della griglia */
  const COL = { g: SX, e1: 150, u1: 195, e2: 240, u2: 285, tot: 332, note: 378 };
  const intesta = () => {
    c.serve(20);
    for (const [x, t] of [[COL.g, 'giorno'], [COL.e1, 'entrata'], [COL.u1, 'uscita'],
      [COL.e2, 'entrata'], [COL.u2, 'uscita'], [COL.tot, 'tot. ore'], [COL.note, 'motivazione assenza / note']]) {
      c.stato.pagina.drawText(t, { x, y: c.stato.y, size: 7.5, font: c.bold, color: c.grigio });
    }
    c.stato.y -= 11;
    c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y + 4 }, end: { x: DX, y: c.stato.y + 4 }, thickness: 0.6, color: c.grigio });
  };
  intesta();

  const perGiorno = {};
  for (const p of presenze) {
    const g = Number(p.data.slice(8, 10));
    (perGiorno[g] = perGiorno[g] || []).push(p);
  }
  const nGiorni = new Date(anno, mese, 0).getDate();
  const oraTxt = (t) => (t ? String(t).slice(0, 5) : '');
  let totMese = 0;
  let giorniLavorati = 0;

  for (let g = 1; g <= nGiorni; g++) {
    const dow = new Date(anno, mese - 1, g).getDay();
    const righe = perGiorno[g] || [null];
    const festivo = dow === 0 || dow === 6;
    for (let i = 0; i < righe.length; i++) {
      if (c.stato.y < 80) { c.nuovaPagina(); intesta(); }
      const p = righe[i];
      if (i === 0) {
        const et = `${g} ${GIORNI[dow]} ${String(g).padStart(2, '0')}/${String(mese).padStart(2, '0')}`;
        c.stato.pagina.drawText(et, { x: COL.g, y: c.stato.y, size: 8.5,
          font: festivo ? c.italic : c.font, color: festivo ? c.grigio : c.nero });
      }
      if (p) {
        for (const [x, v] of [[COL.e1, oraTxt(p.entra1)], [COL.u1, oraTxt(p.esce1)],
          [COL.e2, oraTxt(p.entra2)], [COL.u2, oraTxt(p.esce2)]]) {
          if (v) c.stato.pagina.drawText(v, { x, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
        }
        if (p.tot_min) {
          c.stato.pagina.drawText(mm2hm(p.tot_min), { x: COL.tot, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
          totMese += p.tot_min;
        }
        if (p.note) {
          c.stato.pagina.drawText(String(p.note).slice(0, 42), { x: COL.note, y: c.stato.y, size: 7.5, font: c.italic, color: c.nero });
        }
        if (i === 0 && (p.tot_min || 0) > 0) giorniLavorati += 1;
      }
      c.stato.y -= 12.5;
    }
  }

  c.stato.y -= 6;
  c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y + 8 }, end: { x: DX, y: c.stato.y + 8 }, thickness: 0.8, color: c.arancio });
  c.scrivi(`Totale ore lavorate nel mese: ${mm2hm(totMese)} — giorni con presenza: ${giorniLavorati}`, c.bold, 10);

  /* ── pagina 2: il riepilogo per causale, come la stampa Access ── */
  if ((extra || []).length) {
    c.nuovaPagina();
    c.scrivi(`Straordinari, permessi e recuperi — ${MESI[mese - 1]} ${anno}`, c.bold, 13, c.nero);
    c.stato.y -= 6;
    const perCausale = {};
    for (const e of extra) (perCausale[e.causale] = perCausale[e.causale] || []).push(e);
    for (const [causale, righe] of Object.entries(perCausale)) {
      c.serve(28);
      const tot = righe.reduce((s, e) => s + (e.ore_min || 0), 0);
      c.scrivi(`${causale} — ${mm2hm(tot)} ore`, c.bold, 10.5, c.arancio);
      for (const e of righe) {
        c.serve(14);
        c.stato.pagina.drawText(dataIt(e.data), { x: SX + 8, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
        c.stato.pagina.drawText(mm2hm(e.ore_min), { x: SX + 78, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
        const flag = [e.pagato ? 'pagato' : null, e.recuperato ? 'recuperato' : null, e.chiuso ? 'chiuso' : 'APERTO'].filter(Boolean).join(', ');
        c.stato.pagina.drawText(flag, { x: SX + 122, y: c.stato.y, size: 7.5, font: c.italic, color: c.grigio });
        if (e.note) c.stato.pagina.drawText(String(e.note).slice(0, 58), { x: SX + 210, y: c.stato.y, size: 7.5, font: c.font, color: c.nero });
        c.stato.y -= 12;
      }
      c.stato.y -= 6;
    }
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
