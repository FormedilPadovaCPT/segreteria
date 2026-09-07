/* ============================================================
   Funzioni pure, senza dipendenze: nessun Supabase, nessun DOM,
   nessuna libreria caricata da CDN.
   Stanno in un modulo a sé perché servono in due mondi diversi —
   il browser (che passa da core.js) e Node (gli strumenti da riga
   di comando, che devono timbrare un PDF senza aprire una pagina).
   Se il modo di scrivere un numero di protocollo vivesse dentro
   core.js, Node non potrebbe leggerlo senza tirarsi dietro il
   client Supabase.
   ============================================================ */

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function dataIt(iso) {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return g && m && a ? `${g}/${m}/${a}` : iso;
}

/* I font standard dei PDF (Helvetica, codifica WinAnsi) non sanno
   scrivere i caratteri fuori dal Latin-1 + cp1252: un solo «□» in un
   testo faceva crollare l'intera generazione. Qui i caratteri noti
   si traducono, gli ignoti diventano «?» — il PDF esce sempre. */
const PDF_TRADUZIONI = {
  '□': '[ ]', '☐': '[ ]', '☑': '[x]', '☒': '[x]',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>',
  ' ': ' ', '​': '', '️': '', '✓': 'v', '✔': 'v',
  '●': '-', '▪': '-', '◦': '-', '─': '-', '═': '=',
  /* nelle note dell'ufficio capita l'avviso: meglio un punto esclamativo
     che un «?», che sembra un dubbio invece di un richiamo */
  '⚠': '(!)', '❗': '(!)', '⭐': '*',
};
const PDF_AMMESSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ'
  + '‘’“”•–—˜™š›œžŸ');
export function testoPdf(s) {
  return String(s ?? '').replace(/[Ā-￿]/g, (ch) =>
    PDF_AMMESSI.has(ch) ? ch : (PDF_TRADUZIONI[ch] ?? '?'));
}

export function oggiIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ── come si scrive il numero di protocollo ────────────────
   Fino al 30/09/2026 due registri separati: il numero da solo
   non basta, serve la direzione (2554-out). Dal 01/10/2026 una
   serie sola per esercizio: Prot_26-27_0001.
   Il codice lo calcola il database nella colonna `codice`: qui
   si usa quello, e si ricostruisce a mano solo per l'anteprima
   del form, dove la riga non esiste ancora.
   ────────────────────────────────────────────────────────── */
export function codiceProtocollo(p) {
  if (!p) return '';
  if (p.codice) return p.codice;
  if (p.esercizio) return `Prot_${p.esercizio}_${String(p.numero ?? '').padStart(4, '0')}`;
  const coda = p.direzione === 'IN' ? '-in' : p.direzione === 'OUT' ? '-out' : '';
  return `${p.numero ?? ''}${coda}`;
}

/* Come si scrive su un documento, in un QR o in un nome di file:
   sempre con il prefisso Prot_, come vuole la convenzione del vault. */
export function siglaProtocollo(p) {
  const c = codiceProtocollo(p);
  return c.startsWith('Prot_') ? c : `Prot_${c}`;
}

/* Come si legge dentro una frase, non in una colonna. */
export function protocolloEsteso(p) {
  if (!p) return '';
  if (p.esercizio) return codiceProtocollo(p);
  return `n° ${p.numero} in ${p.direzione === 'IN' ? 'entrata' : 'uscita'}`;
}

/* Esercizio dell'ente (1/10-30/9) in forma AA-AA: la stessa
   regola della funzione s_esercizio nel database. */
export function esercizioDi(iso) {
  const [a, m] = String(iso || oggiIso()).slice(0, 10).split('-').map(Number);
  const primo = m >= 10 ? a : a - 1;
  return `${String(primo % 100).padStart(2, '0')}-${String((primo + 1) % 100).padStart(2, '0')}`;
}

/* ── i numeri delle fatture dei tecnici ────────────────────
   Stavano in fatture-tecnici-doc.js, che si porta dietro pdf-lib
   dal CDN: qui possono essere provate da Node (test/fatture.test.mjs)
   senza aprire un browser. Spostate il 05/09/2026.
   ────────────────────────────────────────────────────────── */
export const euro = (n) => (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Lordo = netto x (1 + cassa) x (1 + IVA): 100 x 1,04 x 1,22 = 126,88 */
/* ── Testo dentro a una colonna di tabella ──
   Nelle stampe il testo si taglia sulla LARGHEZZA vera della colonna,
   misurata col font, non contando i caratteri: «i» e «M» non sono
   larghe uguali, e un numero fisso di caratteri o lascia mezza colonna
   vuota o sborda. Contando si spezzavano anche le parole a meta'
   («13 prime vis», «rivalsa INP» sul mandato n. 1 del 07/09/2026).
   `font` e' un font di pdf-lib: qui serve solo il suo
   `widthOfTextAtSize`, cosi' queste due funzioni restano pure e Node
   le prova senza tirarsi dietro pdf-lib. */
export function taglia(font, size, testo, larghezza) {
  const s = String(testo ?? '');
  if (!s || larghezza <= 0) return '';
  if (font.widthOfTextAtSize(s, size) <= larghezza) return s;
  const punti = '...';
  const utile = larghezza - font.widthOfTextAtSize(punti, size);
  if (utile <= 0) return '';
  let t = s;
  while (t && font.widthOfTextAtSize(t, size) > utile) t = t.slice(0, -1);
  /* si torna indietro fino allo spazio, per non troncare una parola a
     meta'; ma solo se non si butta via mezzo contenuto della cella. */
  const spazio = t.lastIndexOf(' ');
  if (spazio > 0 && spazio >= t.length * 0.6) t = t.slice(0, spazio);
  return t.replace(/[\s.,;:-]+$/, '') + punti;
}

/* Lo stesso testo mandato a capo su piu' righe, per le note che in una
   riga sola non ci stanno. Oltre `maxRighe` si taglia, con i puntini
   che dicono che il testo continua. */
export function spezza(font, size, testo, larghezza, maxRighe = 2) {
  const parole = String(testo ?? '').split(/\s+/).filter(Boolean);
  if (!parole.length || larghezza <= 0) return [];
  const righe = [];
  let r = '';
  for (const parola of parole) {
    const prova = r ? `${r} ${parola}` : parola;
    if (font.widthOfTextAtSize(prova, size) <= larghezza) { r = prova; continue; }
    if (r) righe.push(r);
    /* una parola sola piu' larga della colonna (un link, un codice):
       si taglia lei, altrimenti sborderebbe */
    if (font.widthOfTextAtSize(parola, size) > larghezza) { righe.push(taglia(font, size, parola, larghezza)); r = ''; }
    else r = parola;
  }
  if (r) righe.push(r);
  if (righe.length <= maxRighe) return righe;
  const tenute = righe.slice(0, maxRighe);
  const resto = righe.slice(maxRighe - 1).join(' ');
  tenute[maxRighe - 1] = taglia(font, size, resto, larghezza);
  return tenute;
}

export function lordoDi(netto, fisc) {
  const cassa = Number(fisc?.cassa_pct ?? 4) / 100;
  const iva = Number(fisc?.iva_pct ?? 22) / 100;
  return Math.round(Number(netto || 0) * (1 + cassa) * (1 + iva) * 100) / 100;
}

/* Importo in lettere, come sulla stampa Access:
   3538,08 -> «tremilacinquecentotrentotto/08» */
export function inLettere(n) {
  const unita = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici',
    'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
  const decine = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
  const cento = (x) => {
    if (x < 20) return unita[x];
    const d = Math.floor(x / 10); const u = x % 10;
    let s = decine[d];
    if (u === 1 || u === 8) s = s.slice(0, -1);
    return s + unita[u];
  };
  const tre = (x) => {
    const c = Math.floor(x / 100); const r = x % 100;
    let s = c === 0 ? '' : c === 1 ? 'cento' : unita[c] + 'cento';
    if (c > 0 && r >= 80 && r < 90) s = s.slice(0, -1);
    return s + cento(r);
  };
  const intero = Math.floor(Math.abs(Number(n) || 0));
  const cent = Math.round((Math.abs(Number(n) || 0) - intero) * 100);
  let s = '';
  const mil = Math.floor(intero / 1000000); const mig = Math.floor((intero % 1000000) / 1000); const res = intero % 1000;
  if (mil) s += mil === 1 ? 'unmilione' : tre(mil) + 'milioni';
  if (mig) s += mig === 1 ? 'mille' : tre(mig) + 'mila';
  s += tre(res);
  if (!s) s = 'zero';
  return `${s}/${String(cent).padStart(2, '0')}`;
}
