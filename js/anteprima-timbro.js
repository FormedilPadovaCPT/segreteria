/* ============================================================
   Anteprima del timbro: vedere il foglio prima di timbrarlo e
   spostare il timbro dove è bianco.

   Il timbro che si vede e si trascina **è il timbro vero**:
   viene disegnato da pdf-lib su una paginetta grande quanto lui,
   reso con pdf.js e appoggiato sopra all'immagine della pagina.
   Non è un riquadro finto in HTML che gli somiglia — quello
   sarebbe divergente dal risultato al primo ritocco, ed è
   esattamente l'errore che si è già evitato tenendo un solo
   disegno del timbro per browser e riga di comando.

   Il pulsante «trova il bianco» usa lo stesso identico algoritmo
   dello strumento da riga di comando (js/spazio.js), applicato
   ai pixel della pagina appena resa.
   ============================================================ */

/* Da comune.js e non da core.js: l'anteprima non tocca il
   database, e cosi' si puo' provare da sola. */
import { esc, dataIt, codiceProtocollo } from './comune.js';
import { pdfLib, qrGen, pdfJs } from './cdn.js';
import { applicaTimbro, misuraTimbro } from './timbro-disegno.js';
import { mappaDaPixel, cercaLibero } from './spazio.js';

const $ = (sel, root = document) => root.querySelector(sel);

/* «print» e non «display»: con «display» pdf.js scandisce il
   disegno sul ciclo di animazione del browser, che in una scheda
   non in primo piano non scatta — l'anteprima resta a mezzo finche'
   non si torna sulla scheda. Con «print» il disegno va avanti da
   solo. Per un documento d'ufficio le due rese coincidono: la
   differenza sta nelle annotazioni interattive, che qui non ci
   sono, e il timbro finisce comunque su un foglio da stampare o
   archiviare. */
const RESA = 'print';

/* ⚠️ Senza questo pdf.js NON DISEGNA IL TESTO scritto con i font
   standard del PDF (Helvetica, Times, Courier): li deve scaricare,
   e se non sa da dove li salta. Il foglio verrebbe fuori quasi
   vuoto, e — peggio — la ricerca dello spazio bianco crederebbe
   bianca una pagina scritta, mettendo il timbro sopra al testo.
   Scoperto provando: una pagina con sedici righe risultava
   «occupata allo 0,1%». */
const FONT_STANDARD = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/standard_fonts/';

const apri = (pdfjs, dati) => pdfjs.getDocument({
  data: dati, verbosity: 0, standardFontDataUrl: FONT_STANDARD,
}).promise;

const STILI = [
  { id: 'blocco', nome: 'Blocco', nota: 'riquadro con numero, data, QR e riferimenti' },
  { id: 'minimo', nome: 'Minimo', nota: 'solo numero, data e QR — quando c\'è poco spazio' },
  { id: 'striscia', nome: 'Striscia', nota: 'fascia sul bordo di tutte le pagine' },
];

/* Mostra l'anteprima e restituisce {stile, posizione} oppure null
   se si annulla. `byte` sono i byte del PDF da timbrare.        */
export async function scegliTimbro(protocollo, byte) {
  const [{ PDFDocument, rgb, degrees, StandardFonts }, qrcode, pdfjs] =
    await Promise.all([pdfLib(), qrGen(), pdfJs()]);
  const DEPS = { rgb, degrees, StandardFonts, qrcode };

  /* la pagina da timbrare, disegnata una volta sola */
  const doc = await apri(pdfjs, byte.slice(0));
  const pagina = await doc.getPage(1);
  const naturale = pagina.getViewport({ scale: 1 });
  const SCALA = Math.min(1.6, 620 / naturale.width);
  const vista = pagina.getViewport({ scale: SCALA });

  const tela = document.createElement('canvas');
  tela.width = Math.ceil(vista.width);
  tela.height = Math.ceil(vista.height);
  tela.className = 'ant-pagina';
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tela.width, tela.height);
  await pagina.render({ canvasContext: ctx, viewport: vista, intent: RESA }).promise;

  /* mappa dell'inchiostro, per il pulsante «trova il bianco» */
  const px = ctx.getImageData(0, 0, tela.width, tela.height).data;
  const mappa = mappaDaPixel(px, tela.width, tela.height, {
    larghezzaPt: naturale.width, altezzaPt: naturale.height, cella: 4,
  });

  /* ── il timbro, disegnato davvero e reso in immagine ─────── */
  const ORLO = 2;
  async function immagineTimbro(stile) {
    const { larghezza: W, altezza: H } = misuraTimbro(protocollo, stile);
    const d = await PDFDocument.create();
    d.addPage([W + ORLO * 2, H + ORLO * 2]);
    await applicaTimbro(d, protocollo, stile, DEPS, { x: ORLO, y: ORLO });
    const doc2 = await apri(pdfjs, await d.save());
    const p2 = await doc2.getPage(1);
    const v2 = p2.getViewport({ scale: SCALA });
    const t2 = document.createElement('canvas');
    t2.width = Math.ceil(v2.width);
    t2.height = Math.ceil(v2.height);
    await p2.render({ canvasContext: t2.getContext('2d'), viewport: v2, intent: RESA }).promise;
    return { url: t2.toDataURL('image/png'), W, H };
  }

  /* ── finestra ─────────────────────────────────────────────── */
  const bg = document.createElement('div');
  bg.className = 'drawer-bg ant-bg';
  bg.innerHTML = `
    <div class="ant-box">
      <div class="ant-testa">
        <div>
          <h3>Dove metto il timbro?</h3>
          <p>Protocollo <strong>${esc(codiceProtocollo(protocollo))}</strong> del ${dataIt(protocollo.data_prot)}
             — trascina il timbro dove vuoi, o lascia che trovi lui uno spazio bianco.</p>
        </div>
        <div class="seg" id="ant-stili">
          ${STILI.map((s, i) => `<button class="seg-btn ${i === 0 ? 'is-active' : ''}" data-s="${s.id}" title="${esc(s.nota)}">${s.nome}</button>`).join('')}
        </div>
      </div>

      <div class="ant-foglio" id="ant-foglio"></div>

      <div class="ant-piede">
        <span class="hint" id="ant-nota"></span>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" id="ant-auto">Trova il bianco</button>
        <button class="btn btn-ghost" id="ant-annulla">Annulla</button>
        <button class="btn btn-primary" id="ant-ok">Applica il timbro</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const foglio = $('#ant-foglio', bg);
  foglio.appendChild(tela);
  const timbro = document.createElement('img');
  timbro.className = 'ant-timbro';
  timbro.draggable = false;
  foglio.appendChild(timbro);

  let stile = 'blocco';
  let mis = { larghezza: 0, altezza: 0 };
  let pos = { x: 26, y: naturale.height - 26 };   // provvisorio: sistemato da mostra()

  const nota = (t) => { $('#ant-nota', bg).textContent = t; };

  /* da punti PDF a pixel sullo schermo, e ritorno */
  const aSchermo = () => {
    /* la tela e' centrata dentro un contenitore con del margine:
       le coordinate del timbro partono da dove sta la tela, non
       dall'angolo del contenitore */
    timbro.style.left = `${tela.offsetLeft + (pos.x - ORLO) * SCALA}px`;
    timbro.style.top = `${tela.offsetTop + (naturale.height - pos.y - mis.altezza - ORLO) * SCALA}px`;
  };
  const dentro = (p) => ({
    x: Math.max(2, Math.min(p.x, naturale.width - mis.larghezza - 2)),
    y: Math.max(2, Math.min(p.y, naturale.height - mis.altezza - 2)),
  });

  async function mostra(nuovoStile, cerca = true) {
    stile = nuovoStile;
    const { url, W, H } = await immagineTimbro(stile);
    mis = { larghezza: W, altezza: H };
    timbro.src = url;
    timbro.style.width = `${(W + ORLO * 2) * SCALA}px`;

    if (stile === 'striscia') {
      /* la striscia sta sul bordo per definizione: non si sposta */
      timbro.style.display = 'none';
      foglio.classList.add('ant-striscia');
      nota('La striscia occupa il bordo sinistro di tutte le pagine: non si sposta.');
      return;
    }
    timbro.style.display = '';
    foglio.classList.remove('ant-striscia');
    if (cerca) trovaBianco(); else { pos = dentro(pos); aSchermo(); }
  }

  function trovaBianco() {
    const e = cercaLibero(mappa, mis.larghezza, mis.altezza);
    if (!e.trovato) { nota('Il timbro non ci sta in questa pagina.'); return; }
    pos = dentro({ x: e.x, y: e.y });
    aSchermo();
    nota(e.libero
      ? `Spazio bianco trovato. La pagina è occupata al ${mappa.percentualeSporca}%.`
      : `Nessuno spazio del tutto libero: questo è il meno peggio, ma copre qualcosa. `
        + `Pagina occupata al ${mappa.percentualeSporca}%. Spostalo a mano se non va.`);
  }

  /* ── trascinamento ────────────────────────────────────────── */
  let preso = null;
  timbro.addEventListener('pointerdown', (ev) => {
    if (stile === 'striscia') return;
    preso = { dx: ev.clientX - timbro.offsetLeft, dy: ev.clientY - timbro.offsetTop };
    timbro.setPointerCapture(ev.pointerId);
    timbro.classList.add('is-preso');
  });
  timbro.addEventListener('pointermove', (ev) => {
    if (!preso) return;
    const sx = ev.clientX - preso.dx - tela.offsetLeft;
    const sy = ev.clientY - preso.dy - tela.offsetTop;
    pos = dentro({
      x: sx / SCALA + ORLO,
      y: naturale.height - sy / SCALA - mis.altezza - ORLO,
    });
    aSchermo();
    nota(`Spostato a mano: x=${Math.round(pos.x)} y=${Math.round(pos.y)} punti.`);
  });
  const molla = () => { preso = null; timbro.classList.remove('is-preso'); };
  timbro.addEventListener('pointerup', molla);
  timbro.addEventListener('pointercancel', molla);

  /* ── comandi ──────────────────────────────────────────────── */
  $('#ant-stili', bg).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-s]');
    if (!b) return;
    [...bg.querySelectorAll('#ant-stili .seg-btn')].forEach((x) => x.classList.toggle('is-active', x === b));
    mostra(b.dataset.s);
  });
  $('#ant-auto', bg).addEventListener('click', trovaBianco);

  await mostra('blocco');

  return new Promise((risolvi) => {
    const chiudi = (esito) => { bg.remove(); risolvi(esito); };
    $('#ant-annulla', bg).addEventListener('click', () => chiudi(null));
    bg.addEventListener('click', (ev) => { if (ev.target === bg) chiudi(null); });
    $('#ant-ok', bg).addEventListener('click', () => chiudi({
      stile,
      posizione: stile === 'striscia' ? null : { x: Math.round(pos.x), y: Math.round(pos.y) },
    }));
  });
}
