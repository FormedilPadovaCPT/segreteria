/* ============================================================
   LA BARRETTA SOPRA I CAMPI DI TESTO DELLE MAIL (25/09/2026)

   Chiesto dall'utente: «il campo testo della mail potrebbe avere una
   formattazione, altrimenti devo risistemare il testo quando apro il
   file della mail». Elenchi, spaziature e a capo: la strada scelta è
   la formattazione LEGGERA, con i segni che si usano ovunque, tradotti
   in HTML vero da testoInHtml (js/firma.js) — la stessa funzione per
   le bozze .eml, la mail protocollata e gli avvisi automatici.

   Qui c'è solo la comodità: quattro pulsanti che mettono i segni al
   posto giusto (grassetto, corsivo, elenco puntato, elenco numerato),
   Ctrl+B e Ctrl+I, e «👁 Anteprima», che mostra il testo come uscirà
   nella mail. Il campo resta una <textarea>: quello che si salva nel
   protocollo è testo, cercabile, con i segni dentro.
   ============================================================ */

import { testoInHtml } from './firma.js';

const RE_VOCE = /^\s*(?:[-•·*]|\d{1,3}[.)])\s+/;

/* mette o toglie il segno d'elenco sulle righe selezionate (o su quella
   dove sta il cursore): se sono già tutte voci di quel tipo, le libera */
function elenco(ta, tipo) {
  const v = ta.value;
  const ini = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let fin = v.indexOf('\n', Math.max(ta.selectionEnd, ta.selectionStart));
  if (fin < 0) fin = v.length;
  const righe = v.slice(ini, fin).split('\n');
  const eGia = (r) => (tipo === 'ul' ? /^\s*[-•·*]\s+/ : /^\s*\d{1,3}[.)]\s+/).test(r);
  const tutte = righe.every((r) => !r.trim() || eGia(r));
  let n = 0;
  const nuove = righe.map((r) => {
    if (!r.trim()) return r;
    const nuda = r.replace(RE_VOCE, '');
    if (tutte) return nuda;
    n += 1;
    return (tipo === 'ul' ? '- ' : `${n}. `) + nuda;
  });
  const blocco = nuove.join('\n');
  ta.value = v.slice(0, ini) + blocco + v.slice(fin);
  ta.setSelectionRange(ini, ini + blocco.length);
}

/* avvolge la selezione (o una parola segnaposto) nel segno scelto */
function avvolgi(ta, segno, segnaposto) {
  const a = ta.selectionStart; const z = ta.selectionEnd; const v = ta.value;
  const dentro = v.slice(a, z) || segnaposto;
  ta.value = v.slice(0, a) + segno + dentro + segno + v.slice(z);
  ta.setSelectionRange(a + segno.length, a + segno.length + dentro.length);
}

/* Attacca la barretta a una <textarea>. `stile` va a testoInHtml per
   l'anteprima (la mail protocollata ha il suo carattere). Si può
   richiamare più volte senza doppiare. */
export function collegaBarraFormato(ta, { stile = {}, anteprima = true } = {}) {
  if (!ta || ta.dataset.barraFormato) return;
  ta.dataset.barraFormato = '1';
  const bar = document.createElement('div');
  bar.className = 'barra-formato';
  bar.innerHTML = `
    <button type="button" data-f="b" data-aiuto="Grassetto: mette **due asterischi** intorno alla selezione. Nella mail esce in grassetto. Anche Ctrl+B."><b>G</b></button>
    <button type="button" data-f="i" data-aiuto="Corsivo: mette _il trattino basso_ intorno alla selezione. Anche Ctrl+I."><i>C</i></button>
    <button type="button" data-f="ul" data-aiuto="Elenco puntato: le righe selezionate cominciano con «- » e nella mail escono come elenco vero. Premuto di nuovo, lo toglie.">• Elenco</button>
    <button type="button" data-f="ol" data-aiuto="Elenco numerato: le righe selezionate cominciano con «1. », «2. »… Premuto di nuovo, lo toglie.">1. Elenco</button>
    ${anteprima ? '<button type="button" data-f="ant" data-aiuto="Mostra qui sotto il testo come uscirà nella mail: paragrafi, elenchi, grassetto. Non cambia niente.">👁 Anteprima</button>' : ''}
    <span class="hint">Riga vuota = nuovo paragrafo · «- » = elenco · **grassetto** · _corsivo_</span>`;
  ta.parentNode.insertBefore(bar, ta);

  let box = null;
  const aggiorna = () => { if (box) box.innerHTML = testoInHtml(ta.value, stile) || '<p class="hint" style="margin:0">(vuoto)</p>'; };
  const segnala = () => ta.dispatchEvent(new Event('input', { bubbles: true }));

  const azione = (f) => {
    if (f === 'ant') {
      if (box) { box.remove(); box = null; bar.querySelector('[data-f="ant"]').classList.remove('attivo'); return; }
      box = document.createElement('div');
      box.className = 'anteprima-mail';
      ta.parentNode.insertBefore(box, ta.nextSibling);
      bar.querySelector('[data-f="ant"]').classList.add('attivo');
      aggiorna();
      return;
    }
    if (f === 'b') avvolgi(ta, '**', 'testo in grassetto');
    else if (f === 'i') avvolgi(ta, '_', 'testo in corsivo');
    else elenco(ta, f);
    ta.focus();
    segnala();
  };

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (b) azione(b.dataset.f);
  });
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); azione('b'); }
    else if (k === 'i') { e.preventDefault(); azione('i'); }
  });
  ta.addEventListener('input', aggiorna);
}
