/* ============================================================
   Veste grafica dell'app: «attuale» o «ciclo» (11/09/2026).

   L'utente ha scelto la veste «Ciclo» fra quattro proposte e
   vuole provarla su tutta l'app PRIMA di confermarla, potendo
   tornare indietro. Quindi:
   - la veste attuale resta la predefinita;
   - il pulsante in alto la cambia, e la scelta resta salvata su
     QUESTO browser (localStorage): gli altri non vedono niente
     finché non premono il pulsante anche loro;
   - tutto lo stile nuovo sta in css/veste-ciclo.css, sotto
     :root[data-veste="ciclo"].

   Modulo a sé, senza import: non deve dipendere da core.js né
   da app.js (che ha un await di primo livello).
   ============================================================ */

const CHIAVE = 'segreteria.veste';
const FONT = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&display=swap';

/* I gruppi del menu nella veste Ciclo. Le voci sono i data-view
   dei pulsanti di index.html: il markup del menu non cambia (lo
   leggono i test), si spostano solo i nodi. Una voce nuova non
   elencata qui finisce in «Altro», non sparisce. */
const GRUPPI = [
  ['Protocollo', ['home', 'registro', 'nuovo-in', 'nuovo-out']],
  ['Servizi CPT', ['segnalazioni', 'visite', 'consulenze', 'conferenze', 'attestazioni', 'notifiche', 'rlst', 'rls']],
  ['Tecnici', ['fatture-tecnici', 'doc-tecnici', 'stage']],
  ['Anagrafiche', ['imprese', 'persone', 'nomine']],
  ['Formazione e ufficio', ['corsi', 'presenze', 'comunicazione', 'statistiche']],
];
/* la sezione della maschera di protocollo si chiama view-form */
const GRUPPO_SEZIONE = { form: 'Protocollo' };

function leggi() {
  try { return localStorage.getItem(CHIAVE) === 'ciclo' ? 'ciclo' : 'attuale'; } catch { return 'attuale'; }
}
function salva(v) {
  try { v === 'ciclo' ? localStorage.setItem(CHIAVE, 'ciclo') : localStorage.removeItem(CHIAVE); } catch { /* browser senza memoria: vale per la sessione */ }
}

function assicuraFont() {
  if (document.getElementById('font-veste')) return;
  const l = document.createElement('link');
  l.id = 'font-veste';
  l.rel = 'stylesheet';
  l.href = FONT;
  document.head.append(l);
}

/* ── voci del menu: l'emoji e il conteggio in un loro span ──
   Nella veste attuale si vedono identici a prima; nella Ciclo
   l'emoji lascia il posto al quadratino e il conteggio diventa
   una pastiglia. segnalazioni.js riscrive il testo del pulsante
   col conteggio: l'osservatore lo rimette in forma ogni volta. */
const EMOJI = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic})|\p{Emoji_Modifier})*)\s*/u;

function vestiVoce(b) {
  if (b.querySelector(':scope > .nav-ico, :scope > .nav-testo')) return;
  const testo = b.textContent;
  const m = testo.match(EMOJI);
  let resto = m ? testo.slice(m[0].length) : testo.trim();
  const n = resto.match(/\s*\((\d+)\)\s*$/);
  if (n) resto = resto.slice(0, n.index);
  const parti = [];
  if (m) {
    const ico = document.createElement('span');
    ico.className = 'nav-ico';
    ico.textContent = m[1] + ' ';
    parti.push(ico);
  }
  const t = document.createElement('span');
  t.className = 'nav-testo';
  t.textContent = resto;
  parti.push(t);
  if (n) {
    const c = document.createElement('span');
    c.className = 'nav-n';
    c.textContent = n[1];
    parti.push(c);
  }
  b.replaceChildren(...parti);
}

let nav, ordineOriginale = [];

function raggruppa() {
  if (!nav || nav.querySelector('.nav-gruppo')) return;
  const perVista = new Map([...nav.querySelectorAll('.nav-item')].map((b) => [b.dataset.view, b]));
  const usate = new Set();
  const frammento = document.createDocumentFragment();
  const gruppo = (titolo, pulsanti) => {
    if (!pulsanti.length) return;
    const g = document.createElement('div');
    g.className = 'nav-gruppo';
    const t = document.createElement('div');
    t.className = 'nav-grp';
    t.textContent = titolo;
    g.append(t, ...pulsanti);
    frammento.append(g);
  };
  for (const [titolo, viste] of GRUPPI) {
    gruppo(titolo, viste.filter((v) => perVista.has(v)).map((v) => { usate.add(v); return perVista.get(v); }));
  }
  gruppo('Altro', [...perVista].filter(([v]) => !usate.has(v)).map(([, b]) => b));
  nav.prepend(frammento);
}

function sciogli() {
  if (!nav || !nav.querySelector('.nav-gruppo')) return;
  for (const nodo of ordineOriginale) nav.append(nodo);
  nav.querySelectorAll('.nav-gruppo').forEach((g) => g.remove());
}

/* occhiello dei titoli: il nome del gruppo, passato come variabile CSS
   alla sezione (così vale anche per le teste disegnate dai moduli) */
function occhielli() {
  const titoloDi = new Map(Object.entries(GRUPPO_SEZIONE));
  for (const [titolo, viste] of GRUPPI) viste.forEach((v) => titoloDi.set(v, titolo));
  document.querySelectorAll('section.view[id^="view-"]').forEach((s) => {
    const t = titoloDi.get(s.id.slice(5));
    if (t) s.style.setProperty('--occhiello', JSON.stringify(t));
  });
}

function aggiornaPulsante(v) {
  const btn = document.getElementById('veste-btn');
  if (!btn) return;
  btn.textContent = v === 'ciclo' ? '↩ Torna alla veste attuale' : '🎨 Prova la nuova veste';
  btn.title = v === 'ciclo'
    ? 'Stai provando la veste «Ciclo». Premi per tornare a quella di sempre (la scelta vale solo su questo computer).'
    : 'Prova la veste grafica «Ciclo» su tutta l\'app. Si torna indietro con lo stesso pulsante (la scelta vale solo su questo computer).';
  btn.setAttribute('aria-pressed', v === 'ciclo' ? 'true' : 'false');
}

export function applicaVeste(v) {
  const root = document.documentElement;
  if (v === 'ciclo') {
    assicuraFont();
    root.dataset.veste = 'ciclo';
    raggruppa();
  } else {
    delete root.dataset.veste;
    sciogli();
  }
  aggiornaPulsante(v);
}

function avvia() {
  nav = document.getElementById('sidebar');
  if (nav) {
    ordineOriginale = [...nav.children];
    nav.querySelectorAll('.nav-item').forEach(vestiVoce);
    new MutationObserver(() => nav.querySelectorAll('.nav-item').forEach(vestiVoce))
      .observe(nav, { childList: true, subtree: true });
  }
  occhielli();
  applicaVeste(leggi());
  document.getElementById('veste-btn')?.addEventListener('click', () => {
    const nuova = leggi() === 'ciclo' ? 'attuale' : 'ciclo';
    salva(nuova);
    applicaVeste(nuova);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
else avvia();
