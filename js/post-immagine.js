/* L'immagine proposta di un post, ridotta alle sue regole. Modulo puro:
   niente DOM, niente database — lo usa js/post-grafica.js (che disegna) e lo provano
   i test (test/post-immagine.test.mjs).

   Regole dal Brand Design System dell'ente (9_APPLICATIVI/Claude/DERSIGN Formedil
   Padova/, rifatto il 09/11/2026 dopo che il primo modello bianco era stato giudicato
   lontano dal brand): post 1080×1080 e quattro modelli
     A  fondo arancione a sinistra, foto a destra, testo bianco
     B  foto a tutto campo, velatura scura, fascia arancione in basso con »
     C  foto editoriale, testo minimo
     T  solo testo su bianco (quando la grafica suggerita dice «niente foto»)
   La proposta parte dalla «Grafica suggerita» che la redazione scrive in ogni bozza
   (s_post.immagine_suggerita): modello, testi fra virgolette e foto. Quello che non
   c'è si prende dal post. I numeri si prendono dal testo così come sono. */

export const LARGHEZZA = 1080;
export const ALTEZZA = 1080;

export const MODELLI = {
  A: 'A · fondo arancione e foto',
  B: 'B · foto e fascia arancione',
  C: 'C · foto editoriale',
  T: 'Solo testo su bianco',
};

const ETICHETTE = {
  cantiere: 'Dal cantiere', normativa: 'Normativa e scadenze', servizi: 'Servizi per le imprese',
  formazione: 'Formazione', rassegna: 'Rassegna', avviso: 'Avviso',
};
const MODELLO_DI_BASE = { cantiere: 'B', normativa: 'A', servizi: 'A', formazione: 'B', rassegna: 'C', avviso: 'T' };
/* la chiusura nella fascia arancione (B): l'invito fisso del 06/11/2026, mai telefono o mail */
const FASCE = {
  cantiere: 'Chiedi una visita dall\'app servizi', normativa: 'Un dubbio? Chiedi una consulenza',
  servizi: 'Richiedilo dall\'app servizi', formazione: 'Iscrizioni dall\'app servizi',
  rassegna: 'Un dubbio? Chiedi una consulenza', avviso: 'Tutte le informazioni nell\'app servizi',
};
const FOTO_DI_BASE = {
  cantiere: 'allievi-cantiere-scuola', normativa: 'istruttore-planimetria', servizi: 'tecnico-casco-gilet',
  formazione: 'istruttore-indica-lavoro', rassegna: 'edificio-ponteggio', avviso: 'casco-sul-cantiere-ai',
};

const MESI = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';

/* toglie i segni della formattazione di Telegram (**, __, ++, ~~, [testo](link)) */
export function senzaSegni(t) {
  return String(t ?? '')
    .replace(/\[([^\]]+)\]\((?:https?|mailto|tel):[^)]+\)/g, '$1')
    .replace(/\*\*|__|\+\+|~~/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* il titolo senza il numero della serie davanti («3/9 · Quando il tecnico torna») */
export function titoloPulito(t) {
  return senzaSegni(t).replace(/^\s*\d+\s*\/\s*\d+\s*[·\-–—:]\s*/, '').trim();
}

/* un numero in testa alla frase: «28 volte in un anno: …», «71,2% dei cantieri…»,
   «Dal 18 novembre: …». Restituisce numero, didascalia e il resto della frase. */
export function numeroInTesta(frase) {
  const f = senzaSegni(frase);
  const d = f.match(new RegExp(`^(?:dal|il|dall'|entro il)?\\s*(\\d{1,2})\\s+(${MESI})\\b[\\s:,.]*(.*)$`, 'i'));
  if (d) return { numero: d[1], didascalia: d[2].toLowerCase(), resto: d[3].trim() };
  const m = f.match(/^(\d{1,3}(?:\.\d{3})*(?:,\d+)?\s?%?)\s+([^:.,;]{1,40}?)\s*(?:[:.,;]\s*(.*))?$/);
  if (m) return { numero: m[1].replace(/\s/g, ''), didascalia: m[2].trim(), resto: (m[3] || '').trim() };
  return null;
}

/* i punti di un elenco nel testo: righe che cominciano con -, •, ›, «1.» */
export function puntiDelTesto(testo) {
  return String(testo ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((r) => r.trim())
    .filter((r) => /^([-•›*]|\d+[.)])\s+/.test(r))
    .map((r) => senzaSegni(r.replace(/^([-•›*]|\d+[.)])\s+/, '')).replace(/[;.,]\s*$/, ''))
    .filter(Boolean);
}

/* ── la «Grafica suggerita» della redazione ── */
const VIRGOLETTE = /«([^»]{1,140})»|'([^']{2,140})'|"([^"]{2,140})"|“([^”]{2,140})”/g;
function citazioni(t) {
  const out = []; let m;
  const re = new RegExp(VIRGOLETTE.source, 'g');
  while ((m = re.exec(t))) out.push({ testo: (m[1] || m[2] || m[3] || m[4]).trim(), da: m.index, fine: m.index + m[0].length });
  return out;
}
const eNumero = (s) => /^[+\-]?\d[\d.,/]*\s?%?$/.test(s);
/* il testo fra virgolette che segue una parola («titolo», «fascia»…), entro poche parole;
   `parola` è una regex: «titolo» non deve prendere «sottotitolo» */
function dopo(t, parola, cit, presi) {
  const re = new RegExp(`(?<![a-zàèéìòù])(?:${parola})`, 'ig'); let m;
  while ((m = re.exec(t))) {
    const c = cit.find((x) => !presi.has(x) && x.da >= m.index + m[0].length && x.da - (m.index + m[0].length) < 40);
    if (c) { presi.add(c); return c.testo; }
  }
  return '';
}
export function leggiSuggerita(testo) {
  const t = senzaSegni(testo || '');
  const r = { modello: '', numero: '', didascalia: '', titolo: '', sottotitolo: '', fascia: '', testi: [] };
  if (!t) return r;
  if (/niente foto|senza foto|solo testo/i.test(t)) r.modello = 'T';
  else { const m = t.match(/template\s*([ABC])\b/i); if (m) r.modello = m[1].toUpperCase(); }
  const cit = citazioni(t);
  const presi = new Set();
  r.testi = cit.map((c) => c.testo);
  /* il numero: «numero grande '15'» oppure «'47%' in grande» */
  const nCit = cit.find((c) => eNumero(c.testo) && (/numero grande\W*$/i.test(t.slice(Math.max(0, c.da - 20), c.da)) || /^\s*in grande/i.test(t.slice(c.fine))));
  if (nCit) { r.numero = nCit.testo; presi.add(nCit); }
  /* «'NOVEMBRE' sotto» accanto al numero */
  const dCit = cit.find((c) => !presi.has(c) && r.numero && /^\s*sotto\b/i.test(t.slice(c.fine)));
  if (dCit) { r.didascalia = dCit.testo; presi.add(dCit); }
  r.titolo = dopo(t, 'titolo|testo in evidenza', cit, presi);
  r.sottotitolo = dopo(t, 'sottotitolo|con sotto|più piccolo|e sotto', cit, presi);
  r.fascia = dopo(t, 'testo in fascia(?: arancione)?|fascia', cit, presi);
  /* un testo lungo «in fascia» è il titolo dell'immagine, non la chiusura */
  if (r.fascia.length > 30 && !r.titolo) { r.titolo = r.fascia; r.fascia = ''; }
  for (const c of cit) {
    if (presi.has(c)) continue;
    if (!r.titolo) { r.titolo = c.testo; presi.add(c); } else if (!r.sottotitolo) { r.sottotitolo = c.testo; presi.add(c); }
  }
  return r;
}

/* la foto dell'archivio che meglio risponde alle parole della grafica suggerita */
export function sceltaFoto(archivio, testo, pilastro) {
  const t = String(testo || '').toLowerCase();
  let meglio = null, punti = 0;
  for (const f of archivio || []) {
    const s = (f.parole || []).reduce((n, w) => n + (t.includes(w) ? w.length : 0), 0);
    if (s > punti) { punti = s; meglio = f; }
  }
  if (meglio) return meglio.nome;
  const base = FOTO_DI_BASE[pilastro];
  return (archivio || []).some((f) => f.nome === base) ? base : ((archivio || [])[0]?.nome || '');
}

/* la proposta a partire dal post: si può sempre correggere */
export function proposta(p, archivio = []) {
  p = p || {};
  const s = leggiSuggerita(p.immagine_suggerita);
  const etichetta = ETICHETTE[p.pilastro] || 'Area Sicurezza e Salute';
  const t0 = titoloPulito(p.titolo || '');
  /* «Rassegna: …» nel titolo ripete l'etichetta: si toglie */
  const tr = t0.replace(/^rassegna\s*[:·\-–—]\s*/i, '');
  const titoloPost = tr !== t0 ? tr.charAt(0).toUpperCase() + tr.slice(1) : t0;
  const gancio = senzaSegni(p.gancio || '');
  const n = s.numero ? null : numeroInTesta(gancio);
  const modello = s.modello || MODELLO_DI_BASE[p.pilastro] || 'A';
  const titolo = s.titolo || titoloPost;
  const frase = s.sottotitolo || (n ? n.resto : (gancio && gancio !== titolo ? gancio : ''));
  return {
    modello,
    etichetta,
    numero: s.numero || (n ? n.numero : ''),
    didascalia: s.numero ? s.didascalia : (n ? n.didascalia : ''),
    titolo,
    frase,
    punti: modello === 'A' ? puntiDelTesto(p.testo_telegram || p.testo_app || '').slice(0, 3) : [],
    fascia: s.fascia && s.fascia !== titolo ? s.fascia : (FASCE[p.pilastro] || 'Tutte le informazioni nell\'app servizi'),
    nota: '',
    foto: modello === 'T' ? '' : sceltaFoto(archivio, `${p.immagine_suggerita || ''} ${titolo}`, p.pilastro),
    fuoco: 50,
  };
}

/* va a capo per parole dentro una larghezza; `misura(testo)` dà la larghezza in pixel.
   Con `massimo` righe, l'ultima si chiude con «…». */
export function aCapo(testo, larghezza, misura, massimo = Infinity) {
  const parole = String(testo ?? '').split(/\s+/).filter(Boolean);
  const righe = [];
  let riga = '';
  for (const w of parole) {
    const prova = riga ? riga + ' ' + w : w;
    if (misura(prova) <= larghezza || !riga) riga = prova;
    else { righe.push(riga); riga = w; }
  }
  if (riga) righe.push(riga);
  if (righe.length > massimo) {
    const tenute = righe.slice(0, massimo);
    let ultima = tenute[massimo - 1];
    while (ultima && misura(ultima + ' …') > larghezza) ultima = ultima.split(' ').slice(0, -1).join(' ');
    tenute[massimo - 1] = (ultima || '') + ' …';
    return tenute;
  }
  return righe;
}
