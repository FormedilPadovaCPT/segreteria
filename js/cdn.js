/* ============================================================
   Caricamento delle librerie esterne con più CDN di riserva.
   In ufficio è già capitato che un CDN venisse bloccato dal
   proxy: qui si prova jsDelivr, poi esm.sh, poi Skypack, e solo
   se falliscono tutti si dichiara l'errore.
   ============================================================ */

const cache = new Map();

async function prova(urls, verifica) {
  let ultimo = null;
  for (const url of urls) {
    try {
      const m = await import(/* @vite-ignore */ url);
      if (!verifica || verifica(m)) {
        console.log('[cdn] caricato da', url);
        return m;
      }
    } catch (e) {
      ultimo = e;
      console.warn('[cdn] non raggiungibile:', url, e?.message || e);
    }
  }
  throw new Error(
    'Libreria non caricabile da nessun CDN (jsdelivr, esm.sh, skypack). ' +
    'Probabile blocco del proxy aziendale.' + (ultimo ? ' Dettaglio: ' + (ultimo.message || ultimo) : ''),
  );
}

export function caricaModulo(nome, urls, verifica) {
  if (!cache.has(nome)) cache.set(nome, prova(urls, verifica));
  return cache.get(nome);
}

export const supabaseJs = () => caricaModulo('supabase', [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2',
  'https://cdn.skypack.dev/@supabase/supabase-js@2',
], (m) => typeof m.createClient === 'function');

export const pdfLib = () => caricaModulo('pdf-lib', [
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
  'https://esm.sh/pdf-lib@1.17.1',
  'https://cdn.skypack.dev/pdf-lib@1.17.1',
], (m) => typeof m.PDFDocument?.create === 'function');

export const qrGen = async () => {
  const m = await caricaModulo('qrcode-generator', [
    'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm',
    'https://esm.sh/qrcode-generator@1.4.4',
    'https://cdn.skypack.dev/qrcode-generator@1.4.4',
  ], (m) => typeof (m.default || m) === 'function');
  return m.default || m;
};

/* pdf.js serve solo all'anteprima del timbro: disegna la pagina
   per farla vedere e per cercarci sopra lo spazio bianco. Si
   carica quando si apre l'anteprima, non all'avvio.

   ⚠️ Il worker non si puo' caricare direttamente dal CDN: un
   worker deve stare sulla STESSA origine della pagina, e i
   permessi CORS non bastano a scavalcare la regola. Senza questo
   accorgimento pdf.js resta appeso senza dire niente. Si scarica
   quindi il file del worker come testo e lo si trasforma in un
   blob locale, che e' della nostra origine. */
const VERSIONE_PDFJS = '4.7.76';

const WORKER = [
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSIONE_PDFJS}/build/pdf.worker.min.mjs`,
  `https://esm.sh/pdfjs-dist@${VERSIONE_PDFJS}/build/pdf.worker.min.mjs`,
];

async function workerLocale() {
  let ultimo = null;
  for (const url of WORKER) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const testo = await r.text();
      return URL.createObjectURL(new Blob([testo], { type: 'text/javascript' }));
    } catch (e) { ultimo = e; console.warn('[cdn] worker non preso da', url, e?.message || e); }
  }
  throw new Error('Worker di pdf.js non scaricabile: ' + (ultimo?.message || ultimo));
}

export const pdfJs = async () => {
  /* ⚠️ Il build UFFICIALE per browser, non il pacchetto «+esm».
     Il «+esm» di jsDelivr rimaneggia il controllo con cui pdf.js
     capisce se sta girando in Node: finisce per crederlo, sceglie
     la fabbrica di tele di Node e muore con
       «Cannot read properties of undefined (reading 'createCanvas')»
     — ma solo sui documenti che hanno bisogno di una tela
     d'appoggio (immagini, trasparenze, maschere), quindi su un PDF
     di prova semplice non si vede. Visto in produzione il
     2026-08-28, su un documento vero. */
  const m = await caricaModulo('pdfjs', [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSIONE_PDFJS}/build/pdf.min.mjs`,
    `https://unpkg.com/pdfjs-dist@${VERSIONE_PDFJS}/build/pdf.min.mjs`,
    `https://esm.sh/pdfjs-dist@${VERSIONE_PDFJS}`,
  ], (x) => typeof x.getDocument === 'function');
  if (m.GlobalWorkerOptions && !m.GlobalWorkerOptions.__nostro) {
    m.GlobalWorkerOptions.workerSrc = await workerLocale();
    m.GlobalWorkerOptions.__nostro = true;
  }
  return m;
};
