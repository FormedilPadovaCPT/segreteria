/* ============================================================
   DOCUMENTO ALLA FIRMA — le regole (26/10/2026)

   Chiesto dall'utente per la dichiarazione delle attività svolte
   per Carron: un documento scritto in Word sulla carta intestata,
   da mettere alla firma del Direttore nell'app «che poi lo
   protocolliamo e inviamo». Fino a oggi in firma andavano solo i
   documenti che l'app genera da sé (lettere, schede, verbali), che
   sanno dove mettere la firma; per un PDF qualsiasi il posto si
   trova leggendolo: la firma va SOTTO la scritta della carica
   («Il Direttore», «Il Presidente»), l'ultima del documento.

   Qui la parte pura, coi test (test/documento-firma.test.mjs):
   dal testo del PDF letto con pdf.js al riquadro {pagina, x, y, w, h}
   che la funzione firma-documenti usa per disegnare la firma.
   Le coordinate sono quelle del PDF: punti, origine in basso a
   sinistra, y verso l'alto.
   ============================================================ */

export const CARICHE = { direttore: 'Il Direttore', presidente: 'Il Presidente' };

/* misure del riquadro, in punti (1 punto = 0,35 mm) */
export const MISURE = { w: 150, hMax: 60, hMin: 26, stacco: 4, timbro: 10, margine: 28, lato: 30 };

const norma = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/* I pezzi di testo di pdf.js ({pagina, str, x, y, w, h}, y = linea di
   base) diventano righe: stessa pagina e stessa altezza, da sinistra
   a destra. Word spezza spesso una riga in più pezzi. */
export function righeDaTesto(pezzi) {
  const righe = [];
  const ordinati = [...(pezzi || [])].filter((p) => String(p.str || '').trim() !== '' || p.str === ' ')
    .sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);
  for (const p of ordinati) {
    const r = righe.find((x) => x.pagina === p.pagina && Math.abs(x.y - p.y) < 2);
    if (r) {
      r.pezzi.push(p);
      r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x + p.w); r.h = Math.max(r.h, p.h);
    } else {
      righe.push({ pagina: p.pagina, y: p.y, x0: p.x, x1: p.x + p.w, h: p.h, pezzi: [p] });
    }
  }
  for (const r of righe) {
    r.pezzi.sort((a, b) => a.x - b.x);
    r.testo = r.pezzi.map((p) => p.str).join('').replace(/\s+/g, ' ').trim();
    delete r.pezzi;
  }
  return righe;
}

/* Il riquadro della firma sotto l'ULTIMA scritta della carica.
   pagine: [{w, h}] in punti. → {pagina, x, y, w, h}
   Lancia un errore che si può mostrare così com'è quando la scritta
   non c'è o sotto non c'è abbastanza spazio. */
export function riquadroFirma(righe, ruolo, pagine) {
  const carica = CARICHE[ruolo];
  if (!carica) throw new Error(`Firmatario non previsto: «${ruolo}».`);
  const cerca = norma(carica);
  const trovate = righe.filter((r) => norma(r.testo).includes(cerca));
  if (!trovate.length) {
    throw new Error(`Nel PDF non trovo la scritta «${carica}»: scrivila dove va la firma e ricarica il documento.`);
  }
  /* l'ultima: pagina più avanti, poi più in basso */
  const riga = trovate.sort((a, b) => b.pagina - a.pagina || a.y - b.y)[0];
  const pg = pagine[riga.pagina] || pagine[pagine.length - 1];
  const sottoScritta = riga.y - 0.25 * (riga.h || 10);
  /* il pavimento: la riga più alta fra quelle sotto la scritta (il piè di
     pagina, di solito), oppure il margine della pagina */
  const sotto = righe.filter((r) => r.pagina === riga.pagina && r.y < riga.y - 1);
  const pavimento = sotto.length ? Math.max(...sotto.map((r) => r.y + 0.8 * (r.h || 10))) : MISURE.margine;
  const spazio = sottoScritta - MISURE.stacco - (pavimento + MISURE.stacco + MISURE.timbro);
  if (spazio < MISURE.hMin) {
    throw new Error(`Sotto «${carica}» c'è poco spazio per la firma (${Math.max(0, Math.round(spazio))} punti, ne servono almeno ${MISURE.hMin}): aggiungi spazio sotto la scritta, oppure alza il blocco della firma, e ricarica il PDF.`);
  }
  const h = Math.min(MISURE.hMax, spazio);
  const w = MISURE.w;
  const centro = (riga.x0 + riga.x1) / 2;
  const x = Math.max(MISURE.lato, Math.min(pg.w - MISURE.lato - w, centro - w / 2));
  const y = sottoScritta - MISURE.stacco - h;
  const tondo = (n) => Math.round(n * 10) / 10;
  return { pagina: riga.pagina, x: tondo(x), y: tondo(y), w, h: tondo(h) };
}

/* Il riferimento della richiesta: unico per documento, leggibile */
export const RIF_PREFISSO = 'libero:';
export function rifDocumento(nomeFile, adesso = new Date()) {
  const base = String(nomeFile || 'documento').replace(/\.pdf$/i, '').replace(/[^\w-]+/g, '_').slice(0, 80);
  return `${RIF_PREFISSO}${base}_${adesso.getTime()}`;
}

/* Il titolo proposto dal nome del file: senza data, sigla ed estensione */
export function titoloDaFile(nomeFile) {
  return String(nomeFile || '').replace(/\.pdf$/i, '')
    .replace(/^\d{4}_\d{2}_\d{2}_/, '').replace(/^[A-Z][A-Z-]+_/, '')
    .replace(/_bozza$/i, '').replace(/[_]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Il nome del file firmato: quello caricato, pulito */
export const nomePulito = (nomeFile) => {
  const n = String(nomeFile || 'documento.pdf').replace(/[^\w.\-]+/g, '_');
  return /\.pdf$/i.test(n) ? n : `${n}.pdf`;
};
