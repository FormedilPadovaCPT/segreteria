/* ============================================================
   DOCUMENTO ALLA FIRMA (26/10/2026)

   Un PDF qualsiasi, preparato fuori dall'app (per esempio in Word
   sulla carta intestata), va alla firma del Direttore o del
   Presidente nell'app. Chiesto dall'utente per la dichiarazione
   delle attività svolte per Carron.
     1. la segreteria carica il PDF, sceglie chi firma e dà un titolo;
     2. l'app legge il PDF e mette il riquadro della firma sotto
        l'ultima scritta della carica («Il Direttore», «Il Presidente»):
        se non la trova, o se sotto non c'è spazio, lo dice;
     3. la richiesta parte da firma-documenti come tutte le altre
        (tipo «documento»): il firmatario la trova nella sua pagina del
        gestionale;
     4. firmato, il documento resta nella tessera «✍️ Firme in attesa»
        con «apri firmata» e «✓ fatto»: si protocolla in uscita e si
        manda dal protocollo, come ogni documento che esce.
   Il numero di protocollo NON si chiede qui: il documento lo prende
   quando esce, dopo la firma, col timbro.
   Le regole (riquadro, riferimento, nomi) stanno in
   documento-firma-regole.js, coi test.
   ============================================================ */

import { esc, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { pdfJs } from './cdn.js';
import { chiediFirma, esitoAvvisi } from './firme.js';
import { CARICHE, righeDaTesto, riquadroFirma, rifDocumento, titoloDaFile, nomePulito } from './documento-firma-regole.js';

/* Il testo del PDF con la posizione di ogni pezzo, in punti del PDF */
async function leggiPdf(byte) {
  const pdfjs = await pdfJs();
  const doc = await pdfjs.getDocument({ data: byte.slice(0), isEvalSupported: false }).promise;
  const pezzi = [], pagine = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i);
    const vp = pg.getViewport({ scale: 1 });
    pagine.push({ w: vp.width, h: vp.height });
    const tc = await pg.getTextContent();
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const [, , c, d, x, y] = it.transform;
      pezzi.push({ pagina: i - 1, str: it.str, x, y, w: it.width, h: it.height || Math.hypot(c, d) });
    }
  }
  return { pezzi, pagine };
}

export function apriDocumentoFirma(dopo) {
  apriDrawer('Documento alla firma', 'Un PDF preparato fuori dall\'app, alla firma del Direttore o del Presidente', `
    <div class="field"><label>PDF da firmare *</label><input type="file" id="df-file" accept="application/pdf"></div>
    <div class="field"><label>Chi firma *</label>
      <select id="df-ruolo">${Object.entries(CARICHE).map(([k, v]) => `<option value="${k}">${esc(v.replace(/^Il /, ''))}</option>`).join('')}</select></div>
    <div class="field"><label>Titolo, come lo vede chi firma *</label><input id="df-titolo" maxlength="200"></div>
    <div class="field"><label>Destinatario (facoltativo)</label><input id="df-dest" maxlength="200" placeholder="es. CARRON CAV. ANGELO S.p.A."></div>
    <div id="df-esito" class="hint" style="margin:6px 0"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-primary" id="df-manda" disabled>✍️ Manda in firma</button>
    </div>
    <p class="hint" style="margin-top:8px">La firma va sotto la scritta «Il Direttore» o «Il Presidente», l'ultima del documento. Il numero di protocollo si prende dopo la firma, quando il documento esce.</p>`);

  let letto = null; // { byte, nome, pezzi, pagine }
  const esito = (html, ko = false) => { const el = document.querySelector('#df-esito'); el.innerHTML = html; el.style.color = ko ? '#a01f00' : ''; };
  const calcola = () => {
    const btn = document.querySelector('#df-manda');
    btn.disabled = true;
    if (!letto) return null;
    try {
      const ruolo = document.querySelector('#df-ruolo').value;
      const rq = riquadroFirma(righeDaTesto(letto.pezzi), ruolo, letto.pagine);
      esito(`✅ La firma va a pagina ${rq.pagina + 1} di ${letto.pagine.length}, ${rq.sopraTesto ? `sopra «${esc(CARICHE[ruolo])}», a misura piena: sotto la scritta lo spazio è poco, quindi si appoggia sul testo come un timbro, che resta leggibile` : `sotto «${esc(CARICHE[ruolo])}»`} (riquadro ${Math.round(rq.w)} × ${Math.round(rq.h)} punti).`);
      btn.disabled = false;
      return rq;
    } catch (e) { esito('⚠ ' + esc(e.message), true); return null; }
  };

  document.querySelector('#df-ruolo').addEventListener('change', calcola);
  document.querySelector('#df-file').addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    letto = null;
    if (!file) { calcola(); return; }
    esito('Leggo il PDF…');
    try {
      const byte = new Uint8Array(await file.arrayBuffer());
      const { pezzi, pagine } = await leggiPdf(byte);
      if (!pezzi.length) throw new Error('Il PDF non ha testo (è una scansione?): la scritta della carica non si può cercare.');
      letto = { byte, nome: file.name, pezzi, pagine };
      const t = document.querySelector('#df-titolo');
      if (!t.value.trim()) t.value = titoloDaFile(file.name);
      calcola();
    } catch (e) { esito('⚠ Non riesco a leggere il PDF: ' + esc(e.message), true); }
  });

  document.querySelector('#df-manda').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const rq = calcola();
    if (!letto || !rq) return;
    const ruolo = document.querySelector('#df-ruolo').value;
    const titolo = document.querySelector('#df-titolo').value.trim();
    if (!titolo) return toast('Scrivi il titolo: è quello che vede chi firma.', 'err');
    const destinatario = document.querySelector('#df-dest').value.trim() || null;
    if (!confirm(`Mando «${titolo}» alla firma ${ruolo === 'presidente' ? 'del Presidente' : 'del Direttore'} nell'app?\n\nLo troverà nella sua pagina del gestionale. Il numero di protocollo si prende dopo, quando il documento esce.`)) return;
    attendi(btn, true, 'Un istante…');
    try {
      const nome = nomePulito(letto.nome);
      const r = await chiediFirma([{
        tipo: 'documento', rif: rifDocumento(nome), titolo, destinatario, nome_file: nome, byte: letto.byte,
        firmatari: [{ ruolo, riquadro: rq }],
      }]);
      toast(...esitoAvvisi(r, `«${titolo}»`));
      chiudiDrawer();
      if (dopo) dopo();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      attendi(btn, false);
    }
  });
}
