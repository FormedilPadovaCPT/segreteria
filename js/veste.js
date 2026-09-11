/* ============================================================
   Veste grafica dell'app — PROVA delle proposte (11/09/2026).

   L'utente ha visto quattro proposte di veste (Ciclo, Sito nuovo,
   Scrivania, Comandi) e vuole provarle su tutta l'app PRIMA di
   sceglierne una, potendo sempre tornare a quella attuale. Quindi:
   - la veste attuale resta la predefinita;
   - il selettore «Veste» in alto la cambia, e la scelta resta
     salvata su QUESTO browser (localStorage): gli altri non vedono
     niente finché non la cambiano anche loro;
   - lo stile di ogni veste sta nel suo file css/veste-<nome>.css,
     tutto sotto :root[data-veste="<nome>"]; le parti comuni
     (ricerca rapida, menu a gruppi) in css/vesti-comune.css.

   Modulo a sé, senza import: non deve dipendere da core.js né
   da app.js (che ha un await di primo livello).
   ============================================================ */

const CHIAVE = 'segreteria.veste';
const VESTI = [
  ['attuale', 'Attuale'],
  ['ciclo', 'Ciclo'],
  ['sito', 'Sito nuovo'],
  ['scrivania', 'Scrivania'],
  ['comandi', 'Comandi'],
];
const FONT = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&family=JetBrains+Mono:wght@500;600&display=swap';

/* I gruppi del menu nelle vesti nuove. Le voci sono i data-view
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

/* sigle della barra stretta della veste Comandi */
const SIGLE = {
  home: 'CR', registro: 'PR', 'nuovo-in': 'IN', 'nuovo-out': 'OU',
  segnalazioni: 'SG', visite: 'VI', consulenze: 'CO', conferenze: 'CF', attestazioni: 'DM',
  notifiche: 'CN', rlst: 'RL', rls: 'RS',
  'fatture-tecnici': 'FT', 'doc-tecnici': 'DT', stage: 'ST',
  imprese: 'IM', persone: 'PE', nomine: 'NO',
  corsi: 'CS', presenze: 'PF', comunicazione: 'CM', statistiche: 'SS',
};

const valida = (v) => VESTI.some(([id]) => id === v) ? v : 'attuale';
function leggi() {
  try { return valida(localStorage.getItem(CHIAVE)); } catch { return 'attuale'; }
}
function salva(v) {
  try { v === 'attuale' ? localStorage.removeItem(CHIAVE) : localStorage.setItem(CHIAVE, v); } catch { /* browser senza memoria: vale per la sessione */ }
}
const vesteOra = () => document.documentElement.dataset.veste || 'attuale';

function assicuraFont() {
  if (document.getElementById('font-veste')) return;
  const l = document.createElement('link');
  l.id = 'font-veste';
  l.rel = 'stylesheet';
  l.href = FONT;
  document.head.append(l);
}

/* ── voci del menu: l'emoji e il conteggio in un loro span ──
   Nella veste attuale si vedono identici a prima; nelle altre
   l'emoji lascia il posto al segno della veste e il conteggio
   diventa una pastiglia. segnalazioni.js riscrive il testo del
   pulsante col conteggio: l'osservatore lo rimette in forma. */
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
  const v = b.dataset.view;
  b.dataset.sigla = SIGLE[v] || resto.replace(/[^A-Za-zÀ-ÿ]/g, '').slice(0, 2).toUpperCase();
  b.dataset.etichetta = resto;
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
    const voci = document.createElement('div');
    voci.className = 'nav-voci';
    voci.append(...pulsanti);
    g.append(t, voci);
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

/* iniziali dell'utente (veste Sito nuovo): l'indirizzo arriva dopo l'accesso */
function iniziali() {
  const el = document.getElementById('user-email');
  if (!el) return;
  const metti = () => {
    const nome = (el.textContent || '').split('@')[0];
    const parti = nome.split(/[._-]+/).filter(Boolean);
    const sigla = (parti.length > 1 ? parti[0][0] + parti[1][0] : nome.slice(0, 2)).toUpperCase();
    if (sigla) el.dataset.iniziali = sigla; else delete el.dataset.iniziali;
  };
  metti();
  new MutationObserver(metti).observe(el, { childList: true, characterData: true, subtree: true });
}

/* contatori del registro in una riga sola (barra di stato della Scrivania):
   protocollo.js li scrive su tre righe con <br>, qui se ne fa una copia piana */
function contatori() {
  const c = document.getElementById('nav-counts');
  const piede = c?.closest('.nav-foot');
  if (!c || !piede) return;
  const metti = () => {
    const righe = [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean);
    piede.dataset.riga = righe.length ? `${righe[0]} ${righe.slice(1).join(' · ')}` : '';
  };
  metti();
  new MutationObserver(metti).observe(c, { childList: true, characterData: true, subtree: true });
}

/* ── ricerca rapida (Ctrl+K) ────────────────────────────────
   C'è solo nelle vesti nuove: apre una pagina del menu, cerca un
   numero o un testo nel registro, cerca un'impresa. Non fa
   niente che non si possa già fare dal menu: ci arriva prima. */
let pal, palIn, palLista, palSel = 0, palVoci = [];

function voceVisibile(b) { return b && b.style.display !== 'none'; }
function pulsanteVista(v) { return document.querySelector(`.nav-item[data-view="${v}"]`); }

function attendiElemento(sel, ms = 4000) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const giro = () => {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return ok(el);
      if (Date.now() - t0 > ms) return ok(null);
      setTimeout(giro, 80);
    };
    giro();
  });
}

async function cercaNelRegistro(testo) {
  const b = pulsanteVista('registro');
  if (!voceVisibile(b)) return;
  b.click();
  const inp = await attendiElemento('#f-testo');
  if (!inp) return;
  inp.value = testo;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.focus();
}
async function cercaImpresa(testo) {
  const b = pulsanteVista('imprese');
  if (!voceVisibile(b)) return;
  b.click();
  const inp = await attendiElemento('#imp-cerca');
  if (!inp) return;
  inp.value = testo;
  document.getElementById('imp-vai')?.click();
}

function proposte(q) {
  const testo = q.trim();
  const basso = testo.toLowerCase();
  const out = [];
  const num = testo.match(/^(?:prot\.?\s*)?(\d{1,5})(?:\s*-?\s*(in|out))?$/i);
  if (num && voceVisibile(pulsanteVista('registro'))) {
    out.push({ titolo: `Cerca il protocollo ${num[1]}${num[2] ? '-' + num[2].toLowerCase() : ''} nel registro`, nota: 'registro', fai: () => cercaNelRegistro(num[1]) });
  }
  document.querySelectorAll('.nav-item').forEach((b) => {
    if (!voceVisibile(b)) return;
    const et = b.dataset.etichetta || b.textContent.trim();
    const gruppo = b.closest('.nav-gruppo')?.querySelector('.nav-grp')?.textContent || '';
    if (!basso || et.toLowerCase().includes(basso) || gruppo.toLowerCase().includes(basso)) {
      out.push({ titolo: et, nota: gruppo ? `apri · ${gruppo}` : 'apri', fai: () => b.click() });
    }
  });
  if (testo.length >= 3 && !num) {
    if (voceVisibile(pulsanteVista('registro'))) out.push({ titolo: `Cerca «${testo}» nel registro protocollo`, nota: 'registro', fai: () => cercaNelRegistro(testo) });
    if (voceVisibile(pulsanteVista('imprese'))) out.push({ titolo: `Cerca «${testo}» fra le imprese`, nota: 'imprese', fai: () => cercaImpresa(testo) });
  }
  return out.slice(0, 12);
}

function disegnaProposte() {
  palVoci = proposte(palIn.value);
  palSel = Math.min(palSel, Math.max(palVoci.length - 1, 0));
  palLista.replaceChildren(...palVoci.map((p, i) => {
    const li = document.createElement('li');
    li.className = 'vp-voce' + (i === palSel ? ' is-sel' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === palSel ? 'true' : 'false');
    const t = document.createElement('span');
    t.textContent = p.titolo;
    const n = document.createElement('small');
    n.textContent = p.nota;
    li.append(t, n);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); esegui(i); });
    return li;
  }));
  if (!palVoci.length) {
    const li = document.createElement('li');
    li.className = 'vp-vuoto';
    li.textContent = 'Nessuna pagina con questo nome. Scrivi un numero di protocollo o almeno tre lettere per cercare.';
    palLista.append(li);
  }
}

function esegui(i) {
  const p = palVoci[i];
  chiudiPalette();
  if (p) p.fai();
}

function creaPalette() {
  pal = document.createElement('div');
  pal.className = 'vp-bg';
  pal.hidden = true;
  pal.innerHTML = `<div class="vp" role="dialog" aria-label="Ricerca rapida">
      <div class="vp-in"><span class="vp-segno">›</span>
        <input type="text" autocomplete="off" spellcheck="false" aria-label="Pagina, numero di protocollo o testo da cercare"
          placeholder="Scrivi una pagina, un numero di protocollo o un nome"><kbd>Esc</kbd></div>
      <ul class="vp-lista" role="listbox"></ul>
    </div>`;
  document.body.append(pal);
  palIn = pal.querySelector('input');
  palLista = pal.querySelector('.vp-lista');
  palIn.addEventListener('input', () => { palSel = 0; disegnaProposte(); });
  palIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palVoci.length - 1); disegnaProposte(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); disegnaProposte(); }
    else if (e.key === 'Enter') { e.preventDefault(); esegui(palSel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudiPalette(); }
  });
  pal.addEventListener('mousedown', (e) => { if (e.target === pal) chiudiPalette(); });
}

function apriPalette() {
  if (vesteOra() === 'attuale' || document.getElementById('app')?.classList.contains('hidden')) return;
  if (!pal) creaPalette();
  pal.hidden = false;
  palIn.value = '';
  palSel = 0;
  disegnaProposte();
  palIn.focus();
}
function chiudiPalette() { if (pal) pal.hidden = true; }

/* ── applicazione della veste ───────────────────────────── */
export function applicaVeste(v) {
  v = valida(v);
  const root = document.documentElement;
  if (v === 'attuale') {
    delete root.dataset.veste;
    sciogli();
    chiudiPalette();
  } else {
    assicuraFont();
    root.dataset.veste = v;
    raggruppa();
  }
  const sel = document.getElementById('veste-sel');
  if (sel) sel.value = v;
}

function avvia() {
  nav = document.getElementById('sidebar');
  if (nav) {
    ordineOriginale = [...nav.children];
    nav.querySelectorAll('.nav-item').forEach(vestiVoce);
    new MutationObserver(() => nav.querySelectorAll('.nav-item').forEach(vestiVoce))
      .observe(nav, { childList: true, subtree: true });
    /* Scrivania: il nome del gruppo è una scheda, e apre la sua prima pagina */
    nav.addEventListener('click', (e) => {
      const t = e.target.closest('.nav-grp');
      if (!t || vesteOra() !== 'scrivania') return;
      const prima = [...t.parentElement.querySelectorAll('.nav-item')].find(voceVisibile);
      prima?.click();
    });
  }
  occhielli();
  iniziali();
  contatori();

  const sel = document.getElementById('veste-sel');
  if (sel) {
    sel.replaceChildren(...VESTI.map(([id, nome]) => new Option(nome, id)));
    sel.addEventListener('change', () => { salva(sel.value); applicaVeste(sel.value); sel.blur(); });
  }
  document.getElementById('veste-cerca')?.addEventListener('click', apriPalette);

  document.addEventListener('keydown', (e) => {
    const v = vesteOra();
    if (v === 'attuale') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      apriPalette();
      return;
    }
    /* Scrivania: F2 nuovo protocollo in entrata, F3 in uscita */
    if (v === 'scrivania' && (e.key === 'F2' || e.key === 'F3') && !e.ctrlKey && !e.altKey) {
      const b = pulsanteVista(e.key === 'F2' ? 'nuovo-in' : 'nuovo-out');
      if (voceVisibile(b) && !document.getElementById('app')?.classList.contains('hidden')) {
        e.preventDefault();
        b.click();
      }
    }
  });

  applicaVeste(leggi());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
else avvia();
