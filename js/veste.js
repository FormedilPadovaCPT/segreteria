/* ============================================================
   Veste grafica dell'app: «Scrivania» (scelta dall'utente l'11/09/2026).

   Storia: l'11/09/2026 sono state provate nell'app quattro vesti
   (Ciclo, Sito nuovo, Scrivania, Comandi); l'utente ha scelto la
   Scrivania, che da quel giorno è la PREDEFINITA. Le altre tre sono
   archiviate in proposte_grafiche/2026_09_11_app-segreteria/.

   La veste di prima resta raggiungibile dal selettore «Veste»
   («Precedente»), salvata solo su quel browser: serve a chi deve
   abituarsi, e si toglie quando non serve più (link del foglio,
   selettore e questo modulo restano; basta togliere la voce).

   Lo stile sta in css/veste-scrivania.css, tutto sotto
   :root[data-veste="scrivania"]: senza l'attributo vale app.css.

   Modulo a sé, senza import: non deve dipendere da core.js né
   da app.js (che ha un await di primo livello).
   ============================================================ */

const CHIAVE = 'segreteria.veste';
const PREDEFINITA = 'scrivania';
const VESTI = [
  ['scrivania', 'Scrivania'],
  ['attuale', 'Precedente'],
];

/* I gruppi del menu: le voci sono i data-view dei pulsanti di
   index.html. Il markup del menu non cambia (lo leggono i test),
   si spostano solo i nodi. Una voce nuova non elencata qui finisce
   in «Altro», non sparisce. */
const GRUPPI = [
  ['Protocollo', ['home', 'registro', 'nuovo-in', 'nuovo-out']],
  ['Servizi CPT', ['segnalazioni', 'visite', 'consulenze', 'conferenze', 'attestazioni', 'notifiche', 'rlst', 'rls']],
  ['Tecnici', ['fatture-tecnici', 'doc-tecnici', 'stage']],
  ['Anagrafiche', ['imprese', 'persone', 'nomine']],
  ['Formazione e ufficio', ['corsi', 'presenze', 'comunicazione', 'statistiche']],
];

/* Nel browser si salva solo la scelta di tornare alla veste di prima:
   i valori delle vesti provate e scartate (ciclo, sito, comandi)
   ricadono sulla predefinita. */
const valida = (v) => VESTI.some(([id]) => id === v) ? v : PREDEFINITA;
function leggi() {
  try { return valida(localStorage.getItem(CHIAVE)); } catch { return PREDEFINITA; }
}
function salva(v) {
  try { v === PREDEFINITA ? localStorage.removeItem(CHIAVE) : localStorage.setItem(CHIAVE, v); } catch { /* browser senza memoria: vale per la sessione */ }
}
const vesteOra = () => document.documentElement.dataset.veste || 'attuale';

/* ── voci del menu: l'emoji e il conteggio in un loro span ──
   Nella veste precedente si vedono identici a prima; nella
   Scrivania l'emoji sparisce e il conteggio diventa una pastiglia.
   segnalazioni.js riscrive il testo del pulsante col conteggio:
   l'osservatore lo rimette in forma ogni volta. */
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

/* contatori del registro in una riga sola (barra di stato):
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
   Apre una pagina del menu, cerca un numero o un testo nel
   registro, cerca un'impresa. Non fa niente che non si possa già
   fare dal menu: ci arriva prima. */
let pal, palIn, palLista, palSel = 0, palVoci = [];

function voceVisibile(b) { return b && b.style.display !== 'none'; }
function pulsanteVista(v) { return document.querySelector(`.nav-item[data-view="${v}"]`); }
const appAperta = () => !document.getElementById('app')?.classList.contains('hidden');

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
  const box = document.createElement('div');
  box.className = 'vp';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Ricerca rapida');
  const riga = document.createElement('div');
  riga.className = 'vp-in';
  const segno = document.createElement('span');
  segno.className = 'vp-segno';
  segno.textContent = '›';
  palIn = document.createElement('input');
  palIn.type = 'text';
  palIn.autocomplete = 'off';
  palIn.spellcheck = false;
  palIn.placeholder = 'Scrivi una pagina, un numero di protocollo o un nome';
  palIn.setAttribute('aria-label', 'Pagina, numero di protocollo o testo da cercare');
  const esc = document.createElement('kbd');
  esc.textContent = 'Esc';
  riga.append(segno, palIn, esc);
  palLista = document.createElement('ul');
  palLista.className = 'vp-lista';
  palLista.setAttribute('role', 'listbox');
  box.append(riga, palLista);
  pal.append(box);
  document.body.append(pal);

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
  if (vesteOra() === 'attuale' || !appAperta()) return;
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
    /* il nome del gruppo è una scheda, e apre la sua prima pagina */
    nav.addEventListener('click', (e) => {
      const t = e.target.closest('.nav-grp');
      if (!t || vesteOra() !== 'scrivania') return;
      const prima = [...t.parentElement.querySelectorAll('.nav-item')].find(voceVisibile);
      prima?.click();
    });
  }
  contatori();

  const sel = document.getElementById('veste-sel');
  if (sel) {
    sel.replaceChildren(...VESTI.map(([id, nome]) => new Option(nome, id)));
    sel.addEventListener('change', () => { salva(sel.value); applicaVeste(sel.value); sel.blur(); });
  }
  document.getElementById('veste-cerca')?.addEventListener('click', apriPalette);

  document.addEventListener('keydown', (e) => {
    if (vesteOra() !== 'scrivania') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      apriPalette();
      return;
    }
    /* F2 nuovo protocollo in entrata, F3 in uscita */
    if ((e.key === 'F2' || e.key === 'F3') && !e.ctrlKey && !e.altKey && appAperta()) {
      const b = pulsanteVista(e.key === 'F2' ? 'nuovo-in' : 'nuovo-out');
      if (voceVisibile(b)) {
        e.preventDefault();
        b.click();
      }
    }
  });

  applicaVeste(leggi());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
else avvia();
