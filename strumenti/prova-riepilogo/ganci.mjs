// Ganci di risoluzione per provare in Node i moduli dell'app che caricano pdf-lib da un CDN.
const LOCALE = new URL('../node_modules/pdf-lib/dist/pdf-lib.esm.js', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (/^https:\/\/[^/]+\/.*pdf-lib@/.test(specifier)) return { url: LOCALE, shortCircuit: true };
  return next(specifier, context);
}
