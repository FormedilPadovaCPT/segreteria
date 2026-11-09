/* L'immagine proposta di un post, ridotta alle sue regole (09/11/2026). Modulo puro:
   niente DOM, niente database — lo usa js/post-grafica.js (che disegna) e lo provano
   i test (test/post-immagine.test.mjs).

   Chiesto dall'utente: ogni bozza arriva con un'immagine già proposta, disegnata
   con la grafica dell'ente (il modello della serie «918 visite»: post 1080×1350,
   barra arancione, occhiello, titolo in Barlow Condensed, numero grande, piede col
   logo ufficiale). La persona la guarda, corregge i testi e la aggiunge al post.
   I numeri si prendono dal testo del post così come sono: non si calcolano. */

export const LARGHEZZA = 1080;
export const ALTEZZA = 1350;

export const MODELLI = {
  numero: 'Numero grande',
  elenco: 'Elenco di punti',
  frase: 'Titolo e frase',
  foto: 'Foto con fascia arancione',
};

const OCCHIELLI = {
  cantiere: 'Dal cantiere', normativa: 'Normativa e scadenze', servizi: 'I servizi dell\'Area',
  formazione: 'Formazione', rassegna: 'Rassegna', avviso: 'Avviso',
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

/* la proposta a partire dal post: si può sempre correggere */
export function proposta(p) {
  p = p || {};
  const titolo = titoloPulito(p.titolo || '');
  const gancio = senzaSegni(p.gancio || '');
  const occhiello = OCCHIELLI[p.pilastro] || 'Area Sicurezza e Salute';
  const n = numeroInTesta(gancio);
  const punti = puntiDelTesto(p.testo_telegram || p.testo_app || '');
  const base = { occhiello, titolo, numero: '', didascalia: '', frase: '', punti: [], piede: 'Area Sicurezza e Salute' };
  if (n) return { ...base, modello: 'numero', numero: n.numero, didascalia: n.didascalia, frase: n.resto };
  if (punti.length >= 3) return { ...base, modello: 'elenco', frase: gancio && gancio !== titolo ? gancio : '', punti: punti.slice(0, 5) };
  return { ...base, modello: 'frase', frase: gancio && gancio !== titolo ? gancio : '' };
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
