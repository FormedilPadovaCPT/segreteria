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
