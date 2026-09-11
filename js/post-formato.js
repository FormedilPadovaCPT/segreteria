/* ============================================================
   post-formato.js — la formattazione dei testi dei post (11/09/2026).

   I testi si scrivono con i segni che Telegram Desktop già conosce,
   così anche chi copia e incolla a mano nel canale ottiene il grassetto:

     **grassetto**   __corsivo__   ++sottolineato++   ~~barrato~~
     [testo del link](https://…)
     > riga di citazione          (all'inizio della riga)

   Nel database resta il testo coi segni. Da qui escono tre forme:
   - postInTelegramHtml   → HTML accettato da Telegram (parse_mode HTML)
   - postInHtmlNotizia    → HTML del corpo della notizia nell'app servizi
   - postInTestoSemplice  → testo senza segni, per LinkedIn e Instagram,
                            che la formattazione non ce l'hanno

   ⚠️ QUESTO FILE HA UNA COPIA in supabase/functions/redazione-social/
   (Deno non legge fuori dalla cartella della funzione al deploy). Non
   si modifica la copia: `npm run post-formato-sync` la rigenera, e
   strumenti/verifica-post-formato.mjs fallisce se divergono.

   Sicurezza: tutto il testo viene PRIMA ripulito (& < > " diventano
   entità), e solo dopo si aggiungono i tag. I link si accettano solo
   verso http, https, mailto e tel: niente javascript:. L'HTML che esce
   da qui può quindi andare in innerHTML senza altri filtri.

   Modulo puro, senza dipendenze: gira nel browser, in Deno e in Node.
   ============================================================ */

const SEGNAPOSTO = '\u0000';

export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* link [testo](url) e indirizzi nudi si mettono da parte prima di
   formattare, così un `__` dentro un indirizzo non diventa corsivo */
const RE_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|tel:)[^\s)]+)\)/g;
const RE_URL = /\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]»"'])/g;

function proteggi(testoEscaped) {
  const link = [];
  const url = [];
  let t = testoEscaped.replace(RE_LINK, (_, testo, indirizzo) => {
    link.push({ testo, indirizzo });
    return `${SEGNAPOSTO}L${link.length - 1}${SEGNAPOSTO}`;
  });
  t = t.replace(RE_URL, (u) => {
    url.push(u);
    return `${SEGNAPOSTO}U${url.length - 1}${SEGNAPOSTO}`;
  });
  return { t, link, url };
}

/* grassetto per primo; gli altri non attraversano tag già aperti
   (niente `<` nel contenuto), così i tag restano sempre annidati bene
   — Telegram rifiuta il messaggio intero se non lo sono. Un segno che
   non si chiude sulla stessa riga resta scritto com'è. */
function inline(t, tag) {
  return t
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, `<${tag.b}>$1</${tag.b}>`)
    .replace(/\+\+(?=\S)([^\n<]*?\S)\+\+/g, '<u>$1</u>')
    .replace(/~~(?=\S)([^\n<]*?\S)~~/g, '<s>$1</s>')
    .replace(/__(?=\S)([^\n<]*?\S)__/g, `<${tag.i}>$1</${tag.i}>`);
}

function ripristina(t, link, url, { target }) {
  const attr = target ? ' target="_blank" rel="noopener"' : '';
  return t.replace(new RegExp(`${SEGNAPOSTO}([LU])(\\d+)${SEGNAPOSTO}`, 'g'), (_, k, n) => {
    if (k === 'U') {
      const u = url[Number(n)];
      return target ? `<a href="${u}"${attr}>${u}</a>` : u;
    }
    const l = link[Number(n)];
    return `<a href="${l.indirizzo}"${attr}>${inline(l.testo, target ? { b: 'strong', i: 'em' } : { b: 'b', i: 'i' })}</a>`;
  });
}

const eCitazione = (riga) => /^&gt;\s?/.test(riga);
const senzaCitazione = (riga) => riga.replace(/^&gt;\s?/, '');

/** HTML per Telegram: \n restano a capo, citazioni in <blockquote>. */
export function postInTelegramHtml(testo) {
  const pulito = String(testo ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  const { t, link, url } = proteggi(escHtml(pulito));
  const righe = inline(t, { b: 'b', i: 'i' }).split('\n');
  const out = [];
  for (let i = 0; i < righe.length; i++) {
    if (!eCitazione(righe[i])) { out.push(righe[i]); continue; }
    const blocco = [];
    while (i < righe.length && eCitazione(righe[i])) blocco.push(senzaCitazione(righe[i++]));
    i--;
    out.push(`<blockquote>${blocco.join('\n')}</blockquote>`);
  }
  return ripristina(out.join('\n'), link, url, { target: false });
}

/** HTML del corpo della notizia: paragrafi, a capo, link cliccabili. */
export function postInHtmlNotizia(testo) {
  const pulito = String(testo ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  if (!pulito) return '';
  const { t, link, url } = proteggi(escHtml(pulito));
  const righe = inline(t, { b: 'strong', i: 'em' }).split('\n');
  const blocchi = [];
  let par = [];
  const chiudiPar = () => { if (par.length) blocchi.push(`<p>${par.join('<br>')}</p>`); par = []; };
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    if (!r.trim()) { chiudiPar(); continue; }
    if (!eCitazione(r)) { par.push(r); continue; }
    chiudiPar();
    const blocco = [];
    while (i < righe.length && eCitazione(righe[i])) blocco.push(senzaCitazione(righe[i++]));
    i--;
    blocchi.push(`<blockquote style="margin:8px 0;padding:4px 0 4px 12px;border-left:3px solid #e7500f">${blocco.join('<br>')}</blockquote>`);
  }
  chiudiPar();
  return ripristina(blocchi.join(''), link, url, { target: true });
}

function togliSegni(t) {
  return t
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/\+\+(?=\S)([^\n]*?\S)\+\+/g, '$1')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/__(?=\S)([^\n]*?\S)__/g, '$1');
}

/** Testo senza segni, per LinkedIn e Instagram. I link diventano «testo (indirizzo)». */
export function postInTestoSemplice(testo) {
  const pulito = String(testo ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  const url = [];
  let t = pulito.replace(RE_LINK, (_, tx, u) => `${tx} (${u})`);
  t = t.replace(/\b(https?:\/\/[^\s)]+)/g, (u) => { url.push(u); return `${SEGNAPOSTO}U${url.length - 1}${SEGNAPOSTO}`; });
  t = togliSegni(t).split('\n').map((r) => r.replace(/^>\s?/, '')).join('\n');
  return t.replace(new RegExp(`${SEGNAPOSTO}U(\\d+)${SEGNAPOSTO}`, 'g'), (_, n) => url[Number(n)]);
}

/** Per incollare a mano in Telegram: restano ** __ ~~ (Telegram li
 *  trasforma all'invio), spariscono sottolineato e citazione, e i link
 *  con testo diventano «testo: indirizzo». */
export function postPerIncollaTelegram(testo) {
  const pulito = String(testo ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  return pulito
    .replace(RE_LINK, (_, tx, u) => `${tx}: ${u}`)
    .replace(/\+\+(?=\S)([^\n]*?\S)\+\+/g, '$1')
    .split('\n').map((r) => r.replace(/^>\s?/, '')).join('\n');
}

/** Caratteri che il lettore vede (senza segni, link col solo testo):
 *  è la misura su cui Telegram applica i limiti 4096 e 1024. */
export function lunghezzaVisibile(testo) {
  const pulito = String(testo ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  const t = togliSegni(pulito.replace(RE_LINK, (_, tx) => tx)).split('\n').map((r) => r.replace(/^>\s?/, '')).join('\n');
  return t.length;
}

export const SEGNI_AMMESSI = '**grassetto** · __corsivo__ · ++sottolineato++ · ~~barrato~~ · [testo](https://…) · riga che inizia con > = citazione';
