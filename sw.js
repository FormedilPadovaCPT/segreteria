/* ============================================================
   Service worker: rete prima, cache come ripiego.

   GitHub Pages serve i file con cache di 10 minuti: dopo ogni
   pubblicazione il browser poteva tenere un modulo vecchio
   accanto a uno nuovo, e l'app faceva cose strane finché non si
   premeva Ctrl+F5 (successo tre volte il 30/08/2026, basta).

   Qui ogni richiesta ai NOSTRI file va sempre in rete
   scavalcando la cache HTTP; la copia salvata serve solo se la
   rete manca. Le richieste esterne (CDN, Supabase, Google) non
   si toccano.
   ============================================================ */

const CACHE = 'segreteria-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const fresca = await fetch(e.request, { cache: 'no-cache' });
      if (fresca.ok) {
        const copia = fresca.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
      }
      return fresca;
    } catch {
      const salvata = await caches.match(e.request);
      if (salvata) return salvata;
      throw new Error('Rete assente e nessuna copia salvata di ' + url.pathname);
    }
  })());
});
