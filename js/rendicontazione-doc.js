/* ============================================================
   RENDICONTAZIONE DI UN PROGETTO FINANZIATO

   Ricalca il report «R_rendicontazione» del gestionale Access
   dei progetti SPISAL, che aveva due sezioni e non una:

   1. PRESTAZIONI TECNICHE — da s_prestazioni con progetto_id:
      data, ore, attivita, tecnico, costo orario, impresa,
      imponibile, lordo, n° fattura, e sotto la nota del tecnico.
      Nell'Access venivano da T_Soft, importata il 04/09/2026.

   2. LETTERE DI INCARICO PER ATTIVITA' DI FORMAZIONE — da
      s_corsi_incarichi dei corsi collegati al progetto,
      raggruppate per corso: data lezione, corrispettivo orario,
      ore, n° fattura, docente, protocollo della lettera.

   E' il documento con cui si rendiconta allo SPISAL quanto e'
   costato il progetto: le due sezioni non si sommano a occhio,
   il totale generale sta in fondo.

   Il lordo si calcola col regime fiscale del tecnico VALIDO
   ALLA DATA della prestazione (s_tecnici_fiscale): De Marco e
   Camuffo sono forfettari, gli altri no, e non e' sempre stato
   cosi' — usare l'aliquota di oggi falserebbe gli anni vecchi.
   ============================================================ */

import { apriCarta } from './segnalazioni-doc.js';
import { dataIt, testoPdf } from './comune.js';
import { euro, lordoDi } from './fatture-tecnici-doc.js';

const SX = 57;
const DX = 538;
const salva = async (doc) => new Uint8Array(await doc.save());

/* una riga di tabella a colonne fisse; ogni colonna dice dove
   comincia e se il testo va allineato a destra (gli importi) */
function riga(c, colonne, valori, dim = 7.5, f = null, colore = null) {
  c.serve(dim + 5);
  const font = f || c.font;
  valori.forEach((v, k) => {
    const col = colonne[k];
    if (v == null || v === '' || !col) return;
    const t = testoPdf(String(v));
    const x = col.dx ? col.x - font.widthOfTextAtSize(t, dim) : col.x;
    c.stato.pagina.drawText(t, { x, y: c.stato.y, size: dim, font, color: colore || c.nero });
  });
  c.stato.y -= dim + 4;
}

/* Taglia alla LARGHEZZA della colonna, non a un numero di caratteri:
   «CARRON CAV. ANGELO S.P.A.» sta in 30 caratteri ma non in 105
   punti, e nella prima prova finiva sopra la colonna degli importi. */
function tronca(font, testo, dim, larghezza) {
  /* gli a capo vanno appiattiti PRIMA di misurare: le relazioni dei
     tecnici ne hanno, e widthOfTextAtSize su un \n fa crollare pdf-lib
     («WinAnsi cannot encode 0x000a»). In una cella di tabella un a
     capo non ci starebbe comunque. */
  const t = testoPdf(String(testo || '').replace(/\s*[\r\n]+\s*/g, ' ')).trim();
  if (!t || font.widthOfTextAtSize(t, dim) <= larghezza) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(s + '…', dim) > larghezza) s = s.slice(0, -1);
  return s + '…';
}

function titoloSezione(c, testo) {
  c.serve(34);
  c.stato.y -= 6;
  c.stato.pagina.drawRectangle({ x: SX, y: c.stato.y - 5, width: DX - SX, height: 16, color: c.arancio });
  c.stato.pagina.drawText(testoPdf(testo), {
    x: SX + 6, y: c.stato.y, size: 9, font: c.bold, color: c.bianco,
  });
  c.stato.y -= 22;
}

/* il regime fiscale valido a quella data, fra quelli caricati */
function fiscaleA(fiscali, tecnicoId, data) {
  const righe = (fiscali || []).filter((f) => f.tecnico_id === tecnicoId
    && (!f.valido_dal || f.valido_dal <= data)
    && (!f.valido_al || f.valido_al >= data));
  return righe.sort((a, b) => String(b.valido_dal || '').localeCompare(String(a.valido_dal || '')))[0] || null;
}

/* ══════════ il documento ══════════ */

/* Il docente sull'incarico e' un nominativo, non un tecnico_id: per
   sapere se e' forfettario lo si ricerca fra i tecnici per cognome.
   Se e' un docente esterno non lo si trova, e vale il regime
   ordinario (cassa 4 + IVA 22) — che e' quanto stampava il report
   Access: 260 -> 329,89. */
function tecnicoDalNome(tecnici, nominativo) {
  const n = String(nominativo || '').toLowerCase();
  if (!n) return null;
  return (tecnici || []).find((t) => t.tecnico_cognome
    && n.includes(String(t.tecnico_cognome).toLowerCase()))?.tecnico_id || null;
}

export async function pdfRendicontazione(progetto, prestazioni, corsi, incarichi, fiscali, tecnici) {
  const c = await apriCarta();

  c.stato.pagina.drawText('Rendicontazione', { x: SX, y: c.stato.y, size: 15, font: c.bold, color: c.arancio });
  c.stato.y -= 18;
  c.stato.pagina.drawText('Progetti Finanziati per la sicurezza', {
    x: SX, y: c.stato.y, size: 10.5, font: c.bold, color: c.grigio,
  });
  c.stato.y -= 22;

  c.campo('Progetto', progetto.titolo);
  c.campo('Delibera', [progetto.delibera_num ? `n° ${progetto.delibera_num}` : null,
    progetto.delibera_data ? `del ${dataIt(progetto.delibera_data)}` : null].filter(Boolean).join(' '));
  c.campo('Anno/periodo sanzioni', progetto.anno_sanzioni);
  c.campo('Ente finanziatore', progetto.ente_finanziatore);
  c.campo('Periodo', [progetto.data_inizio ? dataIt(progetto.data_inizio) : null,
    progetto.data_fine ? dataIt(progetto.data_fine) : null].filter(Boolean).join(' — '));
  c.campo('Finanziamento', progetto.finanziamento != null ? `€ ${euro(progetto.finanziamento)}` : null);
  c.campo('Acconto', progetto.acconto_importo
    ? `€ ${euro(progetto.acconto_importo)}${progetto.acconto_data ? ` del ${dataIt(progetto.acconto_data)}` : ''}` : null);
  c.campo('Saldo', progetto.saldo_importo
    ? `€ ${euro(progetto.saldo_importo)}${progetto.saldo_data ? ` del ${dataIt(progetto.saldo_data)}` : ''}` : null);

  /* ── 1. prestazioni tecniche ── */
  /* le tre colonne di destra sono allineate a destra: le colonne di
     testo devono finire PRIMA di dove comincia il numero piu' lungo,
     altrimenti si toccano (succedeva con «CARRON CAV. ANGELO S.P.A.») */
  const colP = [
    { x: SX }, { x: SX + 45 }, { x: SX + 66 }, { x: SX + 180 }, { x: SX + 270 },
    { x: SX + 400, dx: true }, { x: SX + 445, dx: true }, { x: SX + 481, dx: true },
  ];
  titoloSezione(c, '1. Attivita dei tecnici sul progetto');
  riga(c, colP, ['Data', 'Ore', 'Attivita svolta', 'Tecnico', 'Impresa', 'Imponib.', 'Lordo', 'Fatt.'],
    7, c.bold, c.grigio);
  c.stato.pagina.drawLine({
    start: { x: SX, y: c.stato.y + 6 }, end: { x: DX, y: c.stato.y + 6 },
    thickness: 0.5, color: c.grigio,
  });
  c.stato.y -= 2;

  let nettoP = 0;
  let lordoP = 0;
  for (const p of prestazioni) {
    const lordo = lordoDi(p.importo, fiscaleA(fiscali, p.tecnico_id, p.data));
    nettoP += Number(p.importo || 0);
    lordoP += lordo;
    /* la descrizione porta «attivita — impresa (scheda N)»: qui si
       ridividono, cosi' le colonne restano quelle del report Access */
    const pezzi = String(p.descrizione || '').split(' — ');
    const attivita = pezzi[0] || '';
    /* il numero di scheda cantiere sta in coda all'impresa: in stampa
       ruberebbe la colonna, e nel report Access non c'era */
    const impresa = pezzi.slice(1).join(' — ').replace(/\s*\(scheda [^)]*\)\s*$/, '');
    riga(c, colP, [
      p.data ? dataIt(p.data) : '',
      p.quantita != null ? String(p.quantita).replace('.00', '') : '',
      tronca(c.font, attivita, 7.5, 110),
      tronca(c.font, p.tecnico_nome, 7.5, 86),
      tronca(c.font, impresa, 7.5, 92),
      euro(p.importo), euro(lordo), p.fattura_numero || '',
    ]);
    if (p.nota_breve) {
      c.serve(12);
      c.stato.pagina.drawText(tronca(c.italic, p.nota_breve, 6.5, DX - SX - 66), {
        x: SX + 66, y: c.stato.y + 1, size: 6.5, font: c.italic, color: c.grigio,
      });
      c.stato.y -= 9;
    }
  }
  if (!prestazioni.length) riga(c, colP, ['—', '', 'Nessuna prestazione registrata sul progetto'], 8, c.italic, c.grigio);
  c.stato.pagina.drawLine({
    start: { x: SX + 280, y: c.stato.y + 8 }, end: { x: DX, y: c.stato.y + 8 },
    thickness: 0.5, color: c.grigio,
  });
  riga(c, colP, ['', '', '', 'Totale attivita dei tecnici', '', euro(nettoP), euro(lordoP), ''], 8, c.bold);

  /* ── 2. lettere di incarico per la formazione ── */
  titoloSezione(c, '2. Riepilogo da lettere di incarico per attivita di formazione');
  const colD = [
    { x: SX }, { x: SX + 62 }, { x: SX + 100 }, { x: SX + 130 }, { x: SX + 285 },
    { x: SX + 400, dx: true }, { x: SX + 445, dx: true }, { x: SX + 481, dx: true },
  ];
  let nettoD = 0;
  let lordoD = 0;
  const perCorso = new Map();
  for (const i of incarichi) {
    if (!perCorso.has(i.corso_id)) perCorso.set(i.corso_id, []);
    perCorso.get(i.corso_id).push(i);
  }
  for (const [corsoId, righe] of perCorso) {
    const corso = corsi.find((x) => x.id === corsoId);
    c.serve(26);
    c.stato.pagina.drawText(tronca(c.bold, `Cod. corso ${corsoId} — ${corso?.titolo || ''}`, 7.5, DX - SX), {
      x: SX, y: c.stato.y, size: 7.5, font: c.bold, color: c.grigio,
    });
    c.stato.y -= 12;
    riga(c, colD, ['Data lettera', 'Corrisp.', 'Ore', 'Docente', 'Protocollo',
      'Totale', 'Lordo', 'Fatt.'], 6.5, c.bold, c.grigio);
    for (const i of righe) {
      const data = i.data_incarico || corso?.data_inizio || null;
      const lordo = lordoDi(i.corrispettivo,
        fiscaleA(fiscali, tecnicoDalNome(tecnici, i.nominativo), data || '2026-01-01'));
      nettoD += Number(i.corrispettivo || 0);
      lordoD += lordo;
      riga(c, colD, [
        data ? dataIt(data) : '—',
        i.tariffa_oraria != null ? euro(i.tariffa_oraria) : '',
        i.ore != null ? String(i.ore).replace('.00', '') : '',
        tronca(c.font, i.nominativo, 7.5, 150),
        tronca(c.font, i.protocollo_numero
          || (i.protocollo_out_id ? String(i.protocollo_out_id) : '—'), 7.5, 78),
        euro(i.corrispettivo), euro(lordo), i.fattura_num || '',
      ]);
    }
    c.stato.y -= 4;
  }
  if (!incarichi.length) riga(c, colD, ['—', '', '', 'Nessuna docenza collegata al progetto'], 8, c.italic, c.grigio);
  c.stato.pagina.drawLine({
    start: { x: SX + 280, y: c.stato.y + 8 }, end: { x: DX, y: c.stato.y + 8 },
    thickness: 0.5, color: c.grigio,
  });
  riga(c, colD, ['', '', '', 'Totale docenze', '', euro(nettoD), euro(lordoD), ''], 8, c.bold);

  /* ── totale generale ──
     serve() per TUTTO il blocco (riquadro + le due note): chiedendone
     46 la nota finale finiva da sola su una pagina in piu' */
  c.serve(120);
  c.stato.y -= 10;
  c.stato.pagina.drawRectangle({
    x: SX, y: c.stato.y - 8, width: DX - SX, height: 24, color: c.grigioChiaro,
  });
  c.stato.pagina.drawText('COSTO COMPLESSIVO DEL PROGETTO', {
    x: SX + 8, y: c.stato.y, size: 9, font: c.bold, color: c.nero,
  });
  const totN = `${euro(nettoP + nettoD)}`;
  const totL = `${euro(lordoP + lordoD)}`;
  c.stato.pagina.drawText(totN, {
    x: SX + 395 - c.bold.widthOfTextAtSize(totN, 9), y: c.stato.y, size: 9, font: c.bold, color: c.nero,
  });
  c.stato.pagina.drawText(totL, {
    x: SX + 481 - c.bold.widthOfTextAtSize(totL, 9), y: c.stato.y, size: 9, font: c.bold, color: c.arancio,
  });
  c.stato.y -= 34;

  if (progetto.finanziamento) {
    const scarto = Number(progetto.finanziamento) - (lordoP + lordoD);
    c.scrivi(`Finanziamento ammesso € ${euro(progetto.finanziamento)} — costo rendicontato € ${euro(lordoP + lordoD)} `
      + `(${scarto >= 0 ? 'residuo' : 'eccedenza'} € ${euro(Math.abs(scarto))}).`, c.italic, 8.5, c.grigio);
  }
  c.stato.y -= 6;
  c.scrivi('Gli importi lordi comprendono cassa di previdenza e IVA secondo il regime fiscale '
    + 'di ciascun tecnico valido alla data della prestazione.', c.italic, 7.5, c.grigio);

  return salva(c.doc);
}
