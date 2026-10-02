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

   3. PROSPETTO PRESENZE DI UN PERIODO scelto a mano (più mesi):
      riepilogo per mese in testa, poi le sole giornate con
      presenza. Per chi fattura a trimestre (01/10/2026).
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { dataIt, taglia } from './comune.js';

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

/* Il PERMESSO SINDACALE (RSU o sindacale) è una RIPARTIZIONE dentro la giornata
   lavorativa, non un'ora in più o in meno (regola dell'utente, 24/09/2026): la sua
   riga si mostra, con le sue ore «di cui», ma NON si somma al totale. Prima il
   22/09 e il 24/09 contavano 5 ore in più. Vale per schermata, mail e PDF. */
/* La riga-ripartizione è quella della CAUSALE, scritta in maiuscolo come le assenze
   («PERMESSO SINDACALE RSU»); la riga della giornata può CITARE il permesso nella sua
   nota («Permesso sindacale RSU dalle 10 alle 12») e quella si somma, eccome. */
export const eRipartizione = (p) => {
  const n = String(p?.note || '').trim();
  return n.length >= 4 && n === n.toUpperCase() && /SINDACAL|\bRSU\b/.test(n);
};
export const totaleOre = (presenze) =>
  (presenze || []).reduce((s, p) => s + (eRipartizione(p) ? 0 : (p.tot_min || 0)), 0);

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
  const contato = {};   /* un giorno si conta una volta, qualunque riga venga prima */

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
        if (p.tot_min && eRipartizione(p)) {
          /* quota della giornata, non un'ora in più: si legge, non si somma */
          c.stato.pagina.drawText(`di cui ${mm2hm(p.tot_min)}`, { x: B[5] + 4, y: c.stato.y, size: 7.6, font: c.italic, color: c.grigio });
        } else if (p.tot_min) {
          c.stato.pagina.drawText(mm2hm(p.tot_min), { x: B[5] + 11, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
          totMese += p.tot_min;
        }
        if (p.note) {
          const nota = String(p.note);
          if (assenza(nota)) {
            c.stato.pagina.drawText(taglia(c.bold, 8, nota, DX - B[6] - 10), { x: B[6] + 6, y: c.stato.y, size: 8, font: c.bold, color: c.arancio });
          } else {
            c.stato.pagina.drawText(taglia(c.italic, 7.4, nota, DX - B[6] - 10), { x: B[6] + 6, y: c.stato.y, size: 7.4, font: c.italic, color: c.grigio });
          }
        }
        if ((p.tot_min || 0) > 0 && !eRipartizione(p) && !contato[g]) { contato[g] = true; giorniLavorati += 1; }
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
  paginaMovimenti(c, `${MESI[mese - 1].toUpperCase()} ${anno} — ${dipendente}`, extra, 'TOTALE MOVIMENTI DEL MESE');
  return salva(c.doc);
}

/* Movimenti di banca ore raggruppati per causale, su pagina nuova.
   Comune al foglio del mese e al prospetto del periodo. */
function paginaMovimenti(c, sottotitolo, extra, etichettaTotale) {
  /* due sezioni distinte (02/10/2026): i movimenti che toccano banca ore o
     monti, e il DETTAGLIO ATTIVITÀ, che dice soltanto come sono state spese
     ore già contate nelle presenze. Prima stavano insieme e il totale le
     sommava: riunioni + ferie + supplementari, un numero senza significato. */
  const movimenti = (extra || []).filter((e) => famigliaCausale(e.causale) !== 'dettaglio');
  const dettaglio = (extra || []).filter((e) => famigliaCausale(e.causale) === 'dettaglio');
  if (!movimenti.length && !dettaglio.length) return;
  c.nuovaPagina();
  if (movimenti.length) sezioneCausali(c, 'STRAORDINARI, PERMESSI E RECUPERI', sottotitolo, movimenti, etichettaTotale, false);
  if (dettaglio.length) {
    if (movimenti.length) c.stato.y -= 10;
    sezioneCausali(c, 'DETTAGLIO ATTIVITÀ', `${sottotitolo} — ore già comprese nelle presenze`, dettaglio,
      'TOTALE DETTAGLIO (GIÀ NELLE ORE LAVORATE, NON SI SOMMA)', true);
  }
}

function sezioneCausali(c, titolo, sottotitolo, righeTutte, etichettaTotale, eDettaglio) {
  c.serve(70);
  c.scrivi(titolo, c.bold, 14, c.nero);
  c.scrivi(sottotitolo, c.bold, 11, c.arancio);
  c.stato.y -= 8;
  const perCausale = {};
  for (const e of righeTutte) (perCausale[e.causale] = perCausale[e.causale] || []).push(e);
  let totMov = 0;
  for (const [causale, righe] of Object.entries(perCausale)) {
    c.serve(34);
    const tot = righe.reduce((s, e) => s + (e.ore_min || 0), 0);
    totMov += tot;
    /* banda grigia con filo arancio a sinistra */
    const yB = c.stato.y + 10;
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: DX - SX, height: 16, color: c.grigioChiaro });
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: 3.2, height: 16, color: c.arancio });
    c.stato.pagina.drawText(taglia(c.bold, 9, causale.toUpperCase(), DX - SX - 110), { x: SX + 10, y: yB - 10, size: 9, font: c.bold, color: c.nero });
    const totC = `${mm2hm(tot)} ore`;
    c.stato.pagina.drawText(totC, { x: DX - 8 - c.bold.widthOfTextAtSize(totC, 9), y: yB - 10, size: 9, font: c.bold, color: c.arancio });
    c.stato.y = yB - 27;
    for (const e of righe) {
      c.serve(15);
      c.stato.pagina.drawText(dataIt(e.data), { x: SX + 10, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
      c.stato.pagina.drawText(mm2hm(e.ore_min), { x: SX + 76, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
      let flag;
      if (eDettaglio) {
        /* il dettaglio non ha partite da chiudere; le spunte che lo storico Access
           gli aveva messo si dicono, non si nascondono e non si correggono */
        flag = [e.pagato ? 'segnata pagata (storico)' : null, e.recuperato ? 'segnata recuperata (storico)' : null].filter(Boolean).join(', ');
      } else {
        const stato = e.chiuso ? 'chiusa' : 'APERTA';
        c.stato.pagina.drawText(stato, { x: SX + 116, y: c.stato.y, size: 7.6,
          font: e.chiuso ? c.italic : c.bold, color: e.chiuso ? c.grigio : c.arancio });
        /* per le supplementari si dice sempre la scelta: da recuperare, da pagare,
           oppure recuperata con la data (24/09/2026: il prospetto diceva «recuperata»
           per un'ora ancora da recuperare, e taceva quando non c'era nessuna spunta) */
        const suppl = /suppl|straord/i.test(e.causale || '');
        flag = suppl
          ? (e.pagato ? 'da pagare (busta paga)'
            : e.recuperato ? `recuperata${e.recuperato_il ? ' il ' + dataIt(e.recuperato_il) : ''}`
            : 'da recuperare')
          : [e.pagato ? 'pagata' : null, e.recuperato ? `recuperata${e.recuperato_il ? ' il ' + dataIt(e.recuperato_il) : ''}` : null].filter(Boolean).join(', ');
      }
      if (flag) c.stato.pagina.drawText(flag, { x: SX + (eDettaglio ? 116 : 158), y: c.stato.y, size: 7.4, font: c.italic, color: c.grigio });
      if (e.note) c.stato.pagina.drawText(taglia(c.font, 7.6, String(e.note), DX - (SX + 244) - 4), { x: SX + 244, y: c.stato.y, size: 7.6, font: c.font, color: c.nero });
      c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y - 4 }, end: { x: DX, y: c.stato.y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 13.5;
    }
    c.stato.y -= 8;
  }
  c.serve(26);
  const yT2 = c.stato.y + 10;
  c.stato.pagina.drawRectangle({ x: SX, y: yT2 - 16, width: DX - SX, height: 17, color: c.arancio });
  c.stato.pagina.drawText(etichettaTotale, { x: SX + 6, y: yT2 - 11, size: 8.5, font: c.bold, color: c.bianco });
  const t2 = `${righeTutte.length} ${eDettaglio ? 'righe' : 'movimenti'} — ${mm2hm(totMov)} ore`;
  c.stato.pagina.drawText(t2, { x: DX - 8 - c.bold.widthOfTextAtSize(t2, 9), y: yT2 - 11, size: 9, font: c.bold, color: c.bianco });
  c.stato.y = yT2 - 30;
}

/* ── 4. DETTAGLIO ATTIVITÀ e contatori ──
   Chiesto dall'utente il 02/10/2026: dentro le ore lavorate di una giornata
   si vuole dire che due ore erano una riunione o il lavoro sul progetto X,
   per avere dei CONTATORI (ore per progetto da rendicontare, quante riunioni,
   quanta formazione frequentata). Non sono straordinari né banca ore: sono un
   «di cui», come il permesso sindacale.

   L'ufficio lo faceva già da Access: 202 righe dal 2016 in Straordinari_Recuperi
   («Riunione», «Formazione», «Progettazione SPISAL (2021 AUDIT)»…), tutte
   chiuse. La famiglia si decide dalla CAUSALE, non da una spunta: così vale
   identica per lo storico e per le righe nuove, senza riscrivere niente.

   REGOLA per le ore oltre l'orario (dell'utente, 02/10/2026): il dettaglio
   conta TUTTE le ore spese sull'attività, comprese quelle in più; le ore in
   più si registrano ANCHE come «Ore supplementari», che dicono soltanto come
   vengono compensate. Lo storico è già scritto così (08/10/2021: AUDIT 7:00
   e 7:00 di supplementari). */

const BANCA = /suppl|straord/i;
const BANCA_ESATTE = /^(recupero|pagato)$/i;
const ASSENZE = /^(ferie|permesso|malattia|festivit[aà]|ex[ -]?festivit[aà]|rol|permessi legge 104\/92|permesso sindacale rsu|riunione sindacale)$/i;

/* 'banca' | 'assenza' | 'dettaglio' */
export function famigliaCausale(causale) {
  const c = String(causale || '').trim().replace(/\s+/g, ' ');
  if (!c) return 'banca';
  if (BANCA.test(c) || BANCA_ESATTE.test(c)) return 'banca';
  if (ASSENZE.test(c)) return 'assenza';
  return 'dettaglio';
}

const chiaveCausale = (c) => String(c || '').trim().replace(/\s+/g, ' ').toLowerCase();

/* I contatori di un periodo.
   extra    = righe s_presenze_extra (qualunque famiglia: si tiene il dettaglio,
              e delle supplementari si legge quante ce n'erano nel giorno);
   presenze = righe s_presenze degli stessi dipendenti e date.
   Restituisce le attività ordinate per ore, ognuna con le sue righe e, per
   riga, gli AVVISI sullo storico: si segnalano, non si correggono.
     'doppia'          stessa persona, giorno, attività e ore scritte due volte
     'oltre'           il dettaglio del giorno supera le ore lavorate registrate
     'senza-presenze'  quel giorno nel foglio presenze non c'è nessuna riga
     'spunte-storico'  la riga porta «pagata»/«recuperata», che al dettaglio non servono */
export function contaAttivita({ extra, presenze, collegamenti = [], nomiProgetti = {} }) {
  const perRiga = {};
  for (const l of collegamenti) (perRiga[l.extra_id] = perRiga[l.extra_id] || []).push({ id: l.progetto_id, nome: nomiProgetti[l.progetto_id] || `progetto ${l.progetto_id}`, quota: Number(l.quota) });
  const giorno = (dip, data) => `${dip}|${data}`;
  const lav = {};
  for (const p of presenze || []) {
    const k = giorno(p.dipendente, p.data);
    (lav[k] = lav[k] || []).push(p);
  }
  const lavMin = {};
  for (const [k, rr] of Object.entries(lav)) lavMin[k] = totaleOre(rr);
  const dettGiorno = {};
  const supplGiorno = {};
  const visti = {};
  const dettaglio = [];
  for (const e of extra || []) {
    const k = giorno(e.dipendente, e.data);
    const fam = famigliaCausale(e.causale);
    if (fam === 'dettaglio') {
      dettGiorno[k] = (dettGiorno[k] || 0) + (e.ore_min || 0);
      const kd = `${k}|${chiaveCausale(e.causale)}|${e.ore_min}`;
      visti[kd] = (visti[kd] || 0) + 1;
      dettaglio.push(e);
    } else if (BANCA.test(e.causale || '')) {
      supplGiorno[k] = (supplGiorno[k] || 0) + (e.ore_min || 0);
    }
  }
  const gruppi = {};
  for (const e of dettaglio) {
    const k = giorno(e.dipendente, e.data);
    const avvisi = [];
    if (visti[`${k}|${chiaveCausale(e.causale)}|${e.ore_min}`] > 1) avvisi.push('doppia');
    if (lav[k] === undefined) avvisi.push('senza-presenze');
    else if (dettGiorno[k] > lavMin[k]) avvisi.push('oltre');
    if (e.pagato || e.recuperato) avvisi.push('spunte-storico');
    const riga = { ...e, lavorateGiorno: lavMin[k] ?? null, supplGiorno: supplGiorno[k] || 0, dettaglioGiorno: dettGiorno[k], avvisi, progetti: perRiga[e.id] || [] };
    const g = (gruppi[chiaveCausale(e.causale)] = gruppi[chiaveCausale(e.causale)] || { grafie: {}, righe: [] });
    g.grafie[e.causale] = (g.grafie[e.causale] || 0) + 1;
    g.righe.push(riga);
  }
  return Object.values(gruppi).map((g) => {
    g.righe.sort((p, q) => (p.data < q.data ? -1 : p.data > q.data ? 1 : (p.id || 0) - (q.id || 0)));
    /* la grafia più usata dà il nome; le altre si dichiarano */
    const grafie = Object.entries(g.grafie).sort((a, b) => b[1] - a[1]).map(([t]) => t);
    return {
      causale: grafie[0],
      altreGrafie: grafie.slice(1),
      totMin: g.righe.reduce((s, r) => s + (r.ore_min || 0), 0),
      giorni: new Set(g.righe.map((r) => `${r.dipendente}|${r.data}`)).size,
      righe: g.righe,
      avvisi: g.righe.filter((r) => r.avvisi.some((a) => a !== 'senza-presenze')).length,
    };
  }).sort((a, b) => b.totMin - a.totMin || a.causale.localeCompare(b.causale));
}

/* Le stesse righe viste dal lato dei PROGETTI (02/10/2026): ore con la quota
   applicata — una riga divisa fra due progetti dà metà ore a ciascuno — e,
   in coda, le ore di dettaglio che non sono collegate a nessun progetto. */
export function contaProgetti(attivita) {
  const per = {};
  let senza = 0;
  for (const a of attivita) {
    for (const r of a.righe) {
      if (!r.progetti?.length) { senza += r.ore_min || 0; continue; }
      for (const pr of r.progetti) {
        const g = (per[pr.id] = per[pr.id] || { id: pr.id, nome: pr.nome, totMin: 0, righe: [] });
        g.totMin += (r.ore_min || 0) * pr.quota;
        g.righe.push({ ...r, quota: pr.quota, attivita: a.causale });
      }
    }
  }
  return {
    progetti: Object.values(per).map((g) => ({ ...g, totMin: Math.round(g.totMin) })).sort((a, b) => b.totMin - a.totMin),
    senzaProgettoMin: senza,
  };
}

export const TESTO_AVVISO = {
  doppia: 'forse scritta due volte (stesso giorno, attività e ore)',
  oltre: 'il dettaglio del giorno supera le ore lavorate',
  'senza-presenze': 'giornata non registrata nel foglio presenze',
  'spunte-storico': 'porta «pagata/recuperata» dallo storico',
};

/* Contatori in CSV per Excel italiano: punto e virgola, BOM, ore decimali con la virgola */
export function csvContatori(attivita, { tutti } = {}) {
  const q = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const dec = (min) => (Math.round((min || 0) / 60 * 100) / 100).toFixed(2).replace('.', ',');
  const testa = [...(tutti ? ['Dipendente'] : []), 'Attività', 'Data', 'Ore (hh:mm)', 'Ore (decimali)', 'Ore lavorate nel giorno', 'Supplementari nel giorno', 'Progetto', 'Note', 'Avvisi'];
  const righe = [testa.join(';')];
  for (const a of attivita) {
    for (const r of a.righe) {
      righe.push([...(tutti ? [r.dipendente] : []), a.causale, dataIt(r.data), mm2hm(r.ore_min), dec(r.ore_min),
        r.lavorateGiorno == null ? '' : mm2hm(r.lavorateGiorno), r.supplGiorno ? mm2hm(r.supplGiorno) : '',
        (r.progetti || []).map((x) => (x.quota < 1 ? `${x.nome} (${Math.round(x.quota * 100)}%)` : x.nome)).join(' + '),
        r.note || '', r.avvisi.map((x) => TESTO_AVVISO[x]).join(', ')].map(q).join(';'));
    }
  }
  return '﻿' + righe.join('\r\n') + '\r\n';
}

/* PDF dei contatori: riepilogo per attività in testa, poi le righe di ognuna */
export async function pdfContatori({ chi, da, a, attivita, tutti }) {
  const c = await apriCarta();
  const tot = attivita.reduce((s, x) => s + x.totMin, 0);
  c.scrivi('CONTATORI DELLE ATTIVITÀ', c.bold, 14, c.nero);
  c.scrivi(etichettaPeriodo(da, a).toUpperCase(), c.bold, 11, c.arancio);
  c.stato.y -= 4;
  c.campo('Dipendente', chi);
  c.campo('Periodo', `dal ${dataIt(da)} al ${dataIt(a)}`);
  c.campo('Che cosa conta', 'Ore di dettaglio delle attività: sono già comprese nelle ore lavorate e non si sommano. Le ore oltre l’orario compaiono anche come ore supplementari.');
  c.stato.y -= 8;
  const RH = 13.6;
  const C = [SX, 330, 400, 460, DX];
  const banda = (lab) => {
    c.serve(26);
    const y0 = c.stato.y - 4;
    c.stato.pagina.drawRectangle({ x: SX, y: y0 - 2, width: DX - SX, height: 17, color: c.arancio });
    lab.forEach(([t, x]) => c.stato.pagina.drawText(t, { x: x + 6, y: y0 + 3, size: 7.5, font: c.bold, color: c.bianco }));
    c.stato.y = y0 - 2 - RH + 3;
  };
  const filo = () => c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y - 4 }, end: { x: DX, y: c.stato.y - 4 }, thickness: 0.5, color: c.grigioChiaro });
  banda([['ATTIVITÀ', C[0]], ['ORE', C[1]], ['GIORNATE', C[2]], ['AVVISI', C[3]]]);
  for (const x of attivita) {
    c.serve(RH + 4);
    c.stato.pagina.drawText(taglia(c.font, 9, x.causale, C[1] - C[0] - 12), { x: C[0] + 6, y: c.stato.y, size: 9, font: c.font, color: c.nero });
    c.stato.pagina.drawText(mm2hm(x.totMin), { x: C[1] + 6, y: c.stato.y, size: 9, font: c.bold, color: c.nero });
    c.stato.pagina.drawText(String(x.giorni), { x: C[2] + 6, y: c.stato.y, size: 9, font: c.font, color: c.nero });
    if (x.avvisi) c.stato.pagina.drawText(`${x.avvisi} da guardare`, { x: C[3] + 6, y: c.stato.y, size: 8, font: c.italic, color: c.arancio });
    filo();
    c.stato.y -= RH;
  }
  c.serve(24);
  const yR = c.stato.y + RH - 3.5;
  c.stato.pagina.drawRectangle({ x: SX, y: yR - 19, width: DX - SX, height: 19, color: c.arancio });
  c.stato.pagina.drawText('TOTALE DETTAGLIO NEL PERIODO', { x: SX + 6, y: yR - 13, size: 9, font: c.bold, color: c.bianco });
  const tt = `${mm2hm(tot)} ore`;
  c.stato.pagina.drawText(tt, { x: DX - 8 - c.bold.widthOfTextAtSize(tt, 9.5), y: yR - 13, size: 9.5, font: c.bold, color: c.bianco });
  c.stato.y = yR - 40;

  /* per progetto: le ore con la quota, per la rendicontazione */
  const { progetti, senzaProgettoMin } = contaProgetti(attivita);
  if (progetti.length) {
    banda([['PROGETTO', C[0]], ['ORE', C[1]], ['RIGHE', C[2]]]);
    for (const g of progetti) {
      c.serve(RH + 4);
      c.stato.pagina.drawText(taglia(c.font, 8.5, g.nome, C[1] - C[0] - 12), { x: C[0] + 6, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
      c.stato.pagina.drawText(mm2hm(g.totMin), { x: C[1] + 6, y: c.stato.y, size: 9, font: c.bold, color: c.nero });
      c.stato.pagina.drawText(String(g.righe.length), { x: C[2] + 6, y: c.stato.y, size: 9, font: c.font, color: c.nero });
      filo();
      c.stato.y -= RH;
    }
    c.serve(RH + 4);
    c.stato.pagina.drawText(`non collegate a un progetto: ${mm2hm(senzaProgettoMin)} ore`, { x: C[0] + 6, y: c.stato.y, size: 8, font: c.italic, color: c.grigio });
    c.stato.y -= RH + 14;
  }

  for (const x of attivita) {
    c.serve(60);
    const yB = c.stato.y + 10;
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: DX - SX, height: 16, color: c.grigioChiaro });
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: 3.2, height: 16, color: c.arancio });
    c.stato.pagina.drawText(taglia(c.bold, 9, x.causale.toUpperCase(), DX - SX - 130), { x: SX + 10, y: yB - 10, size: 9, font: c.bold, color: c.nero });
    const sub = `${mm2hm(x.totMin)} ore — ${x.giorni} ${x.giorni === 1 ? 'giornata' : 'giornate'}`;
    c.stato.pagina.drawText(sub, { x: DX - 8 - c.bold.widthOfTextAtSize(sub, 9), y: yB - 10, size: 9, font: c.bold, color: c.arancio });
    c.stato.y = yB - 27;
    if (x.altreGrafie.length) {
      c.stato.pagina.drawText(taglia(c.italic, 7.4, `scritta anche: ${x.altreGrafie.join(' / ')}`, DX - SX - 20), { x: SX + 10, y: c.stato.y, size: 7.4, font: c.italic, color: c.grigio });
      c.stato.y -= 12;
    }
    for (const r of x.righe) {
      c.serve(15);
      let xx = SX + 10;
      if (tutti) {
        c.stato.pagina.drawText(taglia(c.font, 7.6, r.dipendente, 90), { x: xx, y: c.stato.y, size: 7.6, font: c.font, color: c.nero });
        xx += 96;
      }
      c.stato.pagina.drawText(dataIt(r.data), { x: xx, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
      c.stato.pagina.drawText(mm2hm(r.ore_min), { x: xx + 64, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
      const extraTxt = r.supplGiorno ? `+ ${mm2hm(r.supplGiorno)} suppl. nel giorno` : '';
      if (extraTxt) c.stato.pagina.drawText(extraTxt, { x: xx + 100, y: c.stato.y, size: 7.2, font: c.italic, color: c.grigio });
      const av = r.avvisi.filter((v) => v !== 'senza-presenze').map((v) => TESTO_AVVISO[v]).join('; ');
      const testo = [av ? `! ${av}` : null, r.note].filter(Boolean).join(' — ');
      if (testo) c.stato.pagina.drawText(taglia(c.font, 7.4, testo, DX - (xx + 190) - 4), { x: xx + 190, y: c.stato.y, size: 7.4, font: av ? c.bold : c.font, color: av ? c.arancio : c.nero });
      c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y - 4 }, end: { x: DX, y: c.stato.y - 4 }, thickness: 0.4, color: c.grigioChiaro });
      c.stato.y -= 13.5;
    }
    c.stato.y -= 8;
  }
  return salva(c.doc);
}

/* ── 3. prospetto presenze di un PERIODO ──
   Chiesto dall'utente il 01/10/2026: chi fattura a trimestre (Nicola De Marco)
   ha bisogno delle presenze di più mesi in un foglio solo, e il periodo non è
   sempre un trimestre di calendario — con la scuola chiusa ad agosto si manda
   giugno-settembre. Il periodo si sceglie a mano, da una data a un'altra.
   Si elencano SOLO i giorni con presenza (quattro mesi di griglia piena
   sarebbero dieci pagine quasi vuote); ogni mese del periodo compare
   comunque, anche senza righe, con «nessuna presenza registrata», perché un
   mese che sparisce dal prospetto non si distingue da un mese dimenticato. */

/* i mesi toccati dal periodo, in ordine: [{ anno, mese }] */
export function mesiDelPeriodo(da, a) {
  const out = [];
  let [y, m] = String(da).slice(0, 7).split('-').map(Number);
  const [y2, m2] = String(a).slice(0, 7).split('-').map(Number);
  if (!y || !m || !y2 || !m2) return out;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push({ anno: y, mese: m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 120) break;   /* periodo sbagliato a mano: non si gira all'infinito */
  }
  return out;
}

/* presenze del periodo divise per mese, con totale e giorni di ogni mese.
   Il permesso sindacale resta fuori dal totale, come nel foglio del mese. */
export function raggruppaPeriodo(presenze, da, a) {
  const mesi = mesiDelPeriodo(da, a).map((x) => ({ ...x, righe: [], totMin: 0, giorni: 0 }));
  const indice = Object.fromEntries(mesi.map((x, i) => [`${x.anno}-${String(x.mese).padStart(2, '0')}`, i]));
  for (const p of presenze || []) {
    if (!p?.data || p.data < da || p.data > a) continue;
    const i = indice[p.data.slice(0, 7)];
    if (i != null) mesi[i].righe.push(p);
  }
  for (const x of mesi) {
    x.righe.sort((p, q) => (p.data < q.data ? -1 : p.data > q.data ? 1 : (p.id || 0) - (q.id || 0)));
    x.totMin = totaleOre(x.righe);
    x.giorni = new Set(x.righe.filter((p) => (p.tot_min || 0) > 0 && !eRipartizione(p)).map((p) => p.data)).size;
  }
  return mesi;
}

/* «giugno – settembre 2026», «dicembre 2026 – febbraio 2027», «dal 10/06/2026 al 20/09/2026» */
export function etichettaPeriodo(da, a) {
  const interi = da.slice(8, 10) === '01'
    && Number(a.slice(8, 10)) === new Date(Number(a.slice(0, 4)), Number(a.slice(5, 7)), 0).getDate();
  if (!interi) return `dal ${dataIt(da)} al ${dataIt(a)}`;
  const [ya, ma] = [Number(da.slice(0, 4)), Number(da.slice(5, 7))];
  const [yb, mb] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))];
  if (ya === yb && ma === mb) return `${MESI[ma - 1]} ${ya}`;
  if (ya === yb) return `${MESI[ma - 1]} – ${MESI[mb - 1]} ${ya}`;
  return `${MESI[ma - 1]} ${ya} – ${MESI[mb - 1]} ${yb}`;
}

export async function pdfPresenzePeriodo({ dipendente, da, a, presenze, extra }) {
  const c = await apriCarta();
  const mesi = raggruppaPeriodo(presenze, da, a);
  const totPeriodo = mesi.reduce((s, x) => s + x.totMin, 0);
  const giorniPeriodo = mesi.reduce((s, x) => s + x.giorni, 0);

  c.scrivi('PROSPETTO PRESENZE DEL PERIODO', c.bold, 14, c.nero);
  c.scrivi(etichettaPeriodo(da, a).toUpperCase(), c.bold, 11, c.arancio);
  c.stato.y -= 4;
  c.campo('Cognome / Nome', dipendente);
  c.campo('Periodo', `dal ${dataIt(da)} al ${dataIt(a)}`);
  c.campo('In servizio c/o', 'Padova, Via Basilicata, 10');
  c.stato.y -= 8;

  /* riepilogo per mese in testa: è la parte che serve a chi fattura */
  const RH = 13.6;
  const C = [SX, 250, 360, DX];   /* mese | giorni | ore */
  const bandaTesta = (lab) => {
    c.serve(26);
    const y0 = c.stato.y - 4;
    c.stato.pagina.drawRectangle({ x: SX, y: y0 - 2, width: DX - SX, height: 17, color: c.arancio });
    lab.forEach(([t, x]) => c.stato.pagina.drawText(t, { x: x + 6, y: y0 + 3, size: 7.5, font: c.bold, color: c.bianco }));
    c.stato.y = y0 - 2 - RH + 3;
  };
  const filo = () => c.stato.pagina.drawLine({ start: { x: SX, y: c.stato.y - 4 }, end: { x: DX, y: c.stato.y - 4 }, thickness: 0.5, color: c.grigioChiaro });
  bandaTesta([['MESE', C[0]], ['GIORNI CON PRESENZA', C[1]], ['ORE', C[2]]]);
  for (const x of mesi) {
    c.serve(RH + 4);
    c.stato.pagina.drawText(`${MESI[x.mese - 1]} ${x.anno}`, { x: C[0] + 6, y: c.stato.y, size: 9, font: c.font, color: c.nero });
    if (x.righe.length) {
      c.stato.pagina.drawText(String(x.giorni), { x: C[1] + 6, y: c.stato.y, size: 9, font: c.font, color: c.nero });
      c.stato.pagina.drawText(mm2hm(x.totMin), { x: C[2] + 6, y: c.stato.y, size: 9, font: c.bold, color: c.nero });
    } else {
      c.stato.pagina.drawText('nessuna presenza registrata', { x: C[1] + 6, y: c.stato.y, size: 8.5, font: c.italic, color: c.grigio });
    }
    filo();
    c.stato.y -= RH;
  }
  c.serve(24);
  const yR = c.stato.y + RH - 3.5;
  c.stato.pagina.drawRectangle({ x: SX, y: yR - 19, width: DX - SX, height: 19, color: c.arancio });
  c.stato.pagina.drawText('TOTALE ORE NEL PERIODO', { x: SX + 6, y: yR - 13, size: 9, font: c.bold, color: c.bianco });
  const totTxt = `${mm2hm(totPeriodo)}   —   giorni con presenza: ${giorniPeriodo}`;
  c.stato.pagina.drawText(totTxt, { x: DX - 8 - c.bold.widthOfTextAtSize(totTxt, 9.5), y: yR - 13, size: 9.5, font: c.bold, color: c.bianco });
  c.stato.y = yR - 40;

  /* dettaglio: le sole giornate con presenza, mese per mese */
  c.serve(40);
  c.scrivi('DETTAGLIO DELLE GIORNATE', c.bold, 11, c.nero);
  c.stato.y -= 2;
  const B = [SX, 148, 194, 240, 286, 332, 380, DX];
  const intesta = () => bandaTesta(['DATA', 'ENTRATA', 'USCITA', 'ENTRATA', 'USCITA', 'TOT. ORE', 'ASSENZA / NOTE'].map((t, i) => [t, B[i]]));
  const oraTxt = (t) => (t ? String(t).slice(0, 5) : '');
  const assenza = (n) => /^[A-ZÀÈÌÒÙ' .]+$/.test(String(n || '').trim()) && String(n).trim().length >= 4;
  intesta();
  for (const x of mesi) {
    /* banda grigia del mese con filo arancio, come le causali */
    if (c.stato.y < 110) { c.nuovaPagina(); intesta(); }
    const yB = c.stato.y + 10;
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: DX - SX, height: 16, color: c.grigioChiaro });
    c.stato.pagina.drawRectangle({ x: SX, y: yB - 15, width: 3.2, height: 16, color: c.arancio });
    c.stato.pagina.drawText(`${MESI[x.mese - 1].toUpperCase()} ${x.anno}`, { x: SX + 10, y: yB - 10, size: 9, font: c.bold, color: c.nero });
    const sub = x.righe.length ? `${mm2hm(x.totMin)} ore — ${x.giorni} ${x.giorni === 1 ? 'giorno' : 'giorni'}` : 'nessuna presenza registrata';
    c.stato.pagina.drawText(sub, { x: DX - 8 - c.bold.widthOfTextAtSize(sub, 9), y: yB - 10, size: 9, font: c.bold, color: x.righe.length ? c.arancio : c.grigio });
    c.stato.y = yB - 27;
    for (const p of x.righe) {
      if (c.stato.y < 84) { c.nuovaPagina(); intesta(); }
      const dow = new Date(Number(p.data.slice(0, 4)), Number(p.data.slice(5, 7)) - 1, Number(p.data.slice(8, 10))).getDay();
      c.stato.pagina.drawText(`${GIORNI[dow]} ${dataIt(p.data)}`, { x: B[0] + 6, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
      const ore = [oraTxt(p.entra1), oraTxt(p.esce1), oraTxt(p.entra2), oraTxt(p.esce2)];
      for (let k = 0; k < 4; k++) {
        if (ore[k]) c.stato.pagina.drawText(ore[k], { x: B[k + 1] + 11, y: c.stato.y, size: 8.5, font: c.font, color: c.nero });
      }
      if (p.tot_min && eRipartizione(p)) {
        c.stato.pagina.drawText(`di cui ${mm2hm(p.tot_min)}`, { x: B[5] + 4, y: c.stato.y, size: 7.6, font: c.italic, color: c.grigio });
      } else if (p.tot_min) {
        c.stato.pagina.drawText(mm2hm(p.tot_min), { x: B[5] + 11, y: c.stato.y, size: 8.5, font: c.bold, color: c.nero });
      }
      if (p.note) {
        const nota = String(p.note);
        const forte = assenza(nota);
        c.stato.pagina.drawText(taglia(forte ? c.bold : c.italic, forte ? 8 : 7.4, nota, DX - B[6] - 10),
          { x: B[6] + 6, y: c.stato.y, size: forte ? 8 : 7.4, font: forte ? c.bold : c.italic, color: forte ? c.arancio : c.grigio });
      }
      filo();
      c.stato.y -= RH;
    }
    c.stato.y -= 6;
  }

  paginaMovimenti(c, `${etichettaPeriodo(da, a).toUpperCase()} — ${dipendente}`, extra, 'TOTALE MOVIMENTI DEL PERIODO');
  return salva(c.doc);
}

/* ── 2. richiesta di ferie / permessi ──
   r = riga s_ferie_richieste; visto = null (riquadro vuoto) oppure
   { esito, nome, data_ora, utente, note }; firmaByte = png/jpg o null. */
export async function pdfRichiestaFerie(r, visto, firmaByte) {
  const c = await apriCarta();
  c.scrivi(r.tipo === 'supplementari' ? 'Richiesta di ore supplementari del personale dipendente'
    : 'Richiesta di ferie o permessi del personale dipendente', c.bold, 13, c.nero);
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
  casella(r.tipo === 'supplementari', 'chiede di effettuare ORE SUPPLEMENTARI');
  if (r.tipo === 'supplementari') {
    c.campo('In data', dataIt(r.data_inizio));
    if (r.ora_dalle || r.ora_alle) c.campo('Dalle / alle', `${oraTxt(r.ora_dalle)} — ${oraTxt(r.ora_alle)}`);
  }
  c.campo('Per totale ore', r.ore != null ? String(r.ore) : '—');
  if (r.motivo) c.campo('Note', r.motivo);
  c.stato.y -= 4;
  /* il recupero attinge alla BANCA ORE e non scala i monti del contratto
     (regola dell'utente, 03/09/2026) */
  if (r.tipo === 'supplementari') {
    /* la scelta del lavoratore, che il Direttore vede prima di dare il nulla osta */
    casella(r.compenso === 'recupero', 'le ore saranno RECUPERATE: alimentano la BANCA ORE');
    casella(r.compenso === 'paga', 'chiede che le ore siano PAGATE in busta paga');
  } else {
    const monteEff = r.monte || (r.tipo === 'recupero' ? 'banca_ore' : 'ferie');
    casella(monteEff === 'permessi', 'chiede di utilizzare il monte ore di PERMESSI retribuiti disponibile');
    casella(monteEff === 'ferie', 'chiede di utilizzare il monte ore di FERIE disponibile');
    casella(monteEff === 'banca_ore', 'recupera dalla BANCA ORE (non scala ferie né permessi del contratto)');
  }
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
    /* la firma del Direttore sta a destra: la nota si ferma prima di finirci sotto */
    if (visto.note) c.stato.pagina.drawText(taglia(c.font, 8, `Note: ${visto.note}`, DX - 140 - (SX + 12)), { x: SX + 12, y: y0 + h - 80, size: 8, font: c.font, color: c.grigio });
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

/* ── 5. SALDI di ferie e permessi (02/10/2026) ──
   L'utente vuole un'idea del saldo, come per la banca ore. Le ore SPETTANTI
   non erano agli atti: si scrivono dalla busta paga in s_presenze_spettanze
   (una riga per dipendente, anno e monte) e non si ricavano a stima dal
   contratto. Il GODUTO si conta dalle righe vere di s_presenze_extra con la
   causale del monte, come i monti sindacali: una richiesta approvata ma non
   ancora generata non ha scalato niente, e si mostra a parte.
   saldo = residuo al 1° gennaio + spettanza dell'anno − goduto dell'anno.
   Residuo non scritto = si riporta il saldo calcolato dell'anno prima, se
   l'anno prima ha la sua spettanza; altrimenti si dice che manca. */
/* I monti sono quelli del riquadro «Riposi» della busta paga (agosto 2026):
   FERIE, EX FESTIVITÀ, ROL/PAR. Le ex festività si usano anche a ore
   (l'utente, 02/10/2026), e in busta il «Permesso» registrato in ufficio
   scala proprio le ex festività: nel 2026 di Renato Squizzato il ROL/PAR è
   vuoto e le ex festività godute sono 11 h (9 h di «Permesso» del 2026 più,
   con ogni probabilità, le 2 h del 29/12/2025 passate sul cedolino di gennaio).
   «Festività» NON è un monte: sono i festivi veri (Pasquetta, 2 giugno). */
export const MONTI_SALDO = [
  { monte: 'ferie', nome: 'Ferie', causali: ['Ferie'] },
  { monte: 'ex_festivita', nome: 'Ex festività', causali: ['Ex festività', 'Permesso'] },
  { monte: 'rol', nome: 'ROL / PAR', causali: ['ROL'] },
];
export const CAUSALI_SALDO = MONTI_SALDO.flatMap((m) => m.causali);

export function godutoPerAnno(righe, monte) {
  const causali = (MONTI_SALDO.find((m) => m.monte === monte)?.causali || []).map((c) => c.toLowerCase());
  const per = {};
  for (const r of righe || []) {
    if (!causali.includes(String(r.causale || '').trim().toLowerCase())) continue;
    const anno = Number(String(r.data).slice(0, 4));
    per[anno] = (per[anno] || 0) + (r.ore_min || 0);
  }
  return per;
}

/* spettanze = righe s_presenze_spettanze di UN dipendente e UN monte */
export function saldoMonte(anno, spettanze, godute, profondita = 0) {
  const sp = (spettanze || []).find((s) => Number(s.anno) === Number(anno));
  const goduto = (godute || {})[anno] || 0;
  if (!sp) return { anno, spettanza: null, residuoIniziale: null, residuoDa: null, goduto, saldo: null };
  /* numeric(10,2) arriva dal database come TESTO («9597.60»): senza Number()
     il saldo concatenerebbe le cifre invece di sommarle */
  let residuo = sp.residuo_iniziale_min == null ? null : Number(sp.residuo_iniziale_min);
  let residuoDa = residuo != null ? 'busta-paga' : null;
  if (residuo == null && profondita < 50) {
    const prec = saldoMonte(anno - 1, spettanze, godute, profondita + 1);
    if (prec.saldo != null) { residuo = prec.saldo; residuoDa = 'anno-prima'; }
  }
  return {
    anno, spettanza: Number(sp.spettanza_min), residuoIniziale: residuo, residuoDa, goduto,
    saldo: (residuo ?? 0) + Number(sp.spettanza_min) - goduto,
    fonte: sp.fonte || null,
  };
}

/* «176», «176,5», «176:30», «8.30» → minuti; vuoto → null; non valido → NaN.
   Punto con due cifre = ore e minuti, come nel resto della scheda presenze
   («8.30» sono 8 ore e mezza); la virgola è il decimale («176,5»).
   Con { centesimi: true } — le ore della BUSTA PAGA, scritte in centesimi
   («152,58» = 152 ore e 58 centesimi, non 58 minuti) — anche il punto è
   decimale, e solo i due punti dicono ore e minuti. */
export function oreInMinuti(testo, { centesimi = false } = {}) {
  const t = String(testo ?? '').trim();
  if (!t) return null;
  let m = centesimi ? t.match(/^(\d{1,4}):(\d{2})$/) : t.match(/^(\d{1,4})[:.](\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  /* dalla busta: niente arrotondamento al minuto, o il saldo perde un centesimo
     (106,64 h = 6398,4 minuti); si tengono due decimali di minuto */
  const minDec = (x) => Math.round(x * 60 * 100) / 100;
  if (centesimi && /^-?\d{1,4}([.,]\d{1,2})?$/.test(t)) return minDec(Number(t.replace(',', '.')));
  m = t.match(/^-?\d{1,4}([.,]\d{1,2})?$/);
  if (m) return Math.round(Number(t.replace(',', '.')) * 60);
  m = t.match(/^-(\d{1,4}):(\d{2})$/);
  if (m) return -(Number(m[1]) * 60 + Number(m[2]));
  return NaN;
}

/* minuti → ore in centesimi, come sulla busta paga: 4238 → «70,63» */
export const oreCentesimi = (min) => (Math.round((min || 0) / 60 * 100) / 100).toFixed(2).replace('.', ',');
