/* ============================================================
   Service worker della Segreteria: copie legate alla VERSIONE.

   Storia. GitHub Pages serve i file con cache di 10 minuti: dopo ogni
   pubblicazione il browser poteva tenere un modulo vecchio accanto a
   uno nuovo, e l'app faceva cose strane finché non si premeva Ctrl+F5
   (successo tre volte il 30/08/2026). La cura fu «rete prima»: ogni
   nostro file andava sempre in rete. Funzionava, ma all'accensione
   il telefono aspettava una ventina di moduli, a strati, uno strato
   dopo l'altro (17/11/2026, l'utente: «l'accensione delle app tramite
   cellulare è lentissima»).

   Adesso. La pubblicazione scrive il codice del commit in due posti:
   qui (VERSIONE) e nella pagina (<meta name="versione-app">). Le copie
   dei file stanno in un contenitore che porta la versione nel nome,
   quindi moduli di due pubblicazioni diverse NON possono stare insieme.
     · La pagina principale arriva sempre dalla rete. Se la sua versione
       è quella di questo service worker, i moduli si servono dalla
       copia (se manca, si prende dalla rete e la si salva).
     · Se la pagina è più nuova (pubblicazione appena uscita, il
       service worker nuovo si sta installando) o la versione non si
       legge, si va in rete come prima: nessun rischio di mescolare.
     · In locale (VERSIONE 'locale') niente copie: si lavora sempre
       sui file appena scritti.
     · All'attivazione di una versione nuova le copie vecchie si
       cancellano. Se la rete manca, la copia salvata fa da ripiego.
   Le richieste esterne (CDN, Supabase, Google) non si toccano.
   ============================================================ */

const VERSIONE = 'locale';   // la pubblicazione ci scrive il commit (deploy-pages.yml)
const COPIE = 'segreteria-' + VERSIONE;
let versionePagina = null;   // la versione scritta nella pagina appena aperta

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('segreteria-') && k !== COPIE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(pagina(req)); return; }
  if (VERSIONE === 'locale' || versionePagina !== VERSIONE) { e.respondWith(retePrima(req)); return; }
  e.respondWith(dallaCopia(req));
});

const versioneDi = (testo) => {
  const m = /<meta name="versione-app" content="([^"]*)"/.exec(testo || '');
  return m ? m[1] : null;
};

async function pagina(req) {
  try {
    const fresca = await fetch(req, { cache: 'no-cache' });
    if (fresca.ok) {
      const copia = fresca.clone();
      versionePagina = versioneDi(await fresca.clone().text());
      if (versionePagina === VERSIONE && VERSIONE !== 'locale') caches.open(COPIE).then((c) => c.put(req, copia)).catch(() => {});
    }
    return fresca;
  } catch (err) {
    const salvata = await caches.match(req, { ignoreSearch: true });
    if (!salvata) throw err;
    versionePagina = versioneDi(await salvata.clone().text());
    return salvata;
  }
}

async function retePrima(req) {
  try {
    return await fetch(req, { cache: 'no-cache' });
  } catch (err) {
    const salvata = await caches.match(req);
    if (salvata) return salvata;
    throw err;
  }
}

async function dallaCopia(req) {
  let cache;
  try { cache = await caches.open(COPIE); } catch (err) { return retePrima(req); }
  const salvata = await cache.match(req);
  if (salvata) return salvata;
  const fresca = await fetch(req, { cache: 'no-cache' });   // scavalca la cache HTTP di 10 minuti
  if (fresca.ok && fresca.type === 'basic') await cache.put(req, fresca.clone()).catch(() => {});
  return fresca;
}
