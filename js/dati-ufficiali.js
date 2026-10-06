/* ============================================================
   DATI UFFICIALI NELLA SCHEDA IMPRESA (06/10/2026, chiesto
   dall'utente: «quel controllo da InfoCamere… sarebbe utile anche
   per la segreteria per recuperare dati mancanti»).

   È lo stesso controllo del gestionale visite (dati-ufficiali.js),
   con la stessa funzione dati-impresa-ufficiali: InfoCamere (Registro
   Imprese, solo società, lun-ven 8-18) e VIES (sempre, anche ditte
   individuali, solo nome e indirizzo).

   Due differenze volute, perché qui si lavora su schede già curate:
   - la spunta è messa da sola solo dove la scheda è VUOTA (il dato
     mancante); dove la scheda ha già un valore diverso il dato
     ufficiale si vede, ma per sostituirlo lo si spunta a mano;
   - CAP e provincia hanno il loro campo, e si propongono a parte.
   «Riporta nella scheda» riempie i campi e NON salva: si salva con
   «Salva le modifiche», che scrive solo ciò che è cambiato. La chiave
   (codice fiscale = impresa_id) non si tocca da qui: se il Registro
   dice un altro codice, lo si dice e si rimanda a «Cambia la chiave».

   Modulo senza import: le funzioni pure si provano in Node
   (test/dati-ufficiali.test.mjs); sb e toast li passa imprese.js.
   ============================================================ */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// uguali a meno di maiuscole, accenti, spazi e punteggiatura: «Via Roma, 3» = «VIA ROMA 3»
const chiaveConfronto = (s) => String(s == null ? '' : s).toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
export const uguali = (a, b) => chiaveConfronto(a) === chiaveConfronto(b);

const normCodice = (s) => {
  let x = String(s == null ? '' : s).toUpperCase().replace(/[\s.\-/]/g, '');
  if (/^IT\d{11}$/.test(x)) x = x.slice(2);
  return x;
};
const isPiva = (s) => /^\d{11}$/.test(s);
const isCf16 = (s) => /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(s);

/* Che cosa si manda alla funzione: la P.IVA dal suo campo (o dalla chiave, o dal codice fiscale, se
   sono di 11 cifre), il codice fiscale dal campo del titolare o dalla chiave. null = niente da chiedere. */
export function richiesta({ piva, cf, chiave }) {
  const cand = [piva, chiave, cf].map(normCodice);
  const p = cand.find(isPiva) || '';
  const c = [cf, chiave].map(normCodice).find((x) => isCf16(x) || isPiva(x)) || '';
  return (p || c) ? { piva: p, cf: c } : null;
}

/* Le righe da proporre. attuali = valori dei campi della scheda adesso:
   { impresa_nome, piva, impresa_cf, impresa_id, indirizzo, comune, cap, prov, tipo_impresa }.
   Ogni riga: { campo, etichetta, attuale, ufficiale, fonte, nota, stato: 'uguale'|'mancante'|'diverso'|'bloccato' } */
export function proposte(resp, attuali) {
  const a = attuali || {};
  const ic = resp && resp.infocamere && resp.infocamere.esito === 'ok' ? resp.infocamere.dati : null;
  const vi = resp && resp.vies && resp.vies.esito === 'ok' ? resp.vies.dati : null;
  const pivaVies = resp && resp.vies && resp.vies.esito === 'ok' ? resp.vies.chiave : '';
  const righe = [];
  const aggiungi = (campo, etichetta, ufficiale, fonte, opz = {}) => {
    ufficiale = String(ufficiale || '').trim();
    if (!ufficiale) return;
    const attuale = String(a[campo] == null ? '' : a[campo]).trim();
    let stato;
    if (opz.bloccato) stato = 'bloccato';
    else if (uguali(attuale, ufficiale)) stato = 'uguale';
    else stato = attuale ? 'diverso' : 'mancante';
    righe.push({ campo, etichetta, attuale, ufficiale, fonte, nota: opz.nota || opz.bloccato || '', stato });
  };

  aggiungi('impresa_nome', 'Ragione sociale', (ic && ic.ragione_sociale) || (vi && vi.ragione_sociale), ic && ic.ragione_sociale ? 'InfoCamere' : 'VIES');
  if (pivaVies) aggiungi('piva', 'Partita IVA', pivaVies, 'VIES', { nota: 'attiva secondo VIES' });
  if (ic && ic.cf) {
    aggiungi('impresa_cf', 'Codice fiscale', ic.cf, 'InfoCamere');
    // la chiave dell'impresa: non si cambia da qui
    const chiave = String(a.impresa_id || '').trim();
    if (chiave && !uguali(chiave, ic.cf)) {
      righe.push({ campo: 'impresa_id', etichetta: 'Codice fiscale (chiave)', attuale: chiave, ufficiale: ic.cf, fonte: 'InfoCamere',
        nota: 'È la chiave con cui l\'impresa è collegata a visite, cantieri e protocolli: se va corretta, con «🔑 Cambia la chiave».', stato: 'bloccato' });
    }
  }
  const sede = ic && ic.indirizzo ? { ...ic, fonte: 'InfoCamere' } : (vi && vi.indirizzo ? { ...vi, fonte: 'VIES' } : null);
  if (sede) {
    aggiungi('indirizzo', 'Indirizzo sede', sede.indirizzo, sede.fonte);
    aggiungi('comune', 'Comune', sede.comune, sede.fonte);
    aggiungi('cap', 'CAP', sede.cap, sede.fonte);
    aggiungi('prov', 'Provincia', sede.prov, sede.fonte);
  }
  if (ic && ic.forma_app) {
    aggiungi('tipo_impresa', 'Forma giuridica', ic.forma_app, 'InfoCamere',
      { nota: ic.forma_giuridica && !uguali(ic.forma_giuridica, ic.forma_app) ? ic.forma_giuridica.toLowerCase() : '' });
  }
  return righe;
}

/* Le righe in alto: stato nel Registro, attività, fonti che hanno risposto */
export function intestazione(resp) {
  const ic = (resp && resp.infocamere) || {}, vi = (resp && resp.vies) || {};
  const out = [];
  if (ic.esito === 'ok') {
    const d = ic.dati || {};
    if (/cessat|inattiv|sospes|liquidaz|fallim|scioglim/i.test(d.stato || '')) {
      out.push(`<div class="du-allarme">⚠️ Nel Registro Imprese risulta <b>${esc(d.stato)}</b>. Se è cessata, scrivi «Cessata il (Registro Imprese)» con la data della visura e la fonte.</div>`);
    }
    const info = [
      d.stato ? 'stato: ' + esc(d.stato) : '',
      d.data_registrazione ? 'iscritta dal ' + esc(d.data_registrazione) : '',
      d.nace ? `attività (NACE) <b>${esc(d.nace)}</b> <button type="button" class="btn btn-ghost btn-sm" data-du-ateco="${esc(d.nace)}" title="Mette il codice nella ricerca dei codici ATECO qui sotto: lo aggiungi tu con «+ Aggiungi codice»">usa per l'ATECO</button>` : '',
      d.aggiornato_al ? 'dati del Registro al ' + esc(d.aggiornato_al) : '',
    ].filter(Boolean).join(' · ');
    if (info) out.push(`<div class="du-info">${info}</div>`);
  }
  if (vi.esito === 'non_valida') out.push(`<div class="du-allarme">⚠️ VIES: la partita IVA ${esc(vi.chiave || '')} non risulta attiva.</div>`);
  const fonte = (nome, r) => {
    if (!r || !r.esito || r.esito === 'non_interrogato') return '';
    if (r.esito === 'ok') return `<span class="du-ok">✓ ${nome}</span>`;
    return `<span class="du-ko" title="${esc(r.messaggio || '')}">✗ ${nome}: ${esc(r.messaggio || r.esito)}</span>`;
  };
  out.push(`<div class="du-fonti">${[fonte('InfoCamere', ic), fonte('VIES', vi)].filter(Boolean).join(' &nbsp; ')}</div>`);
  return out.join('');
}

export function tabella(righe) {
  if (!righe.length) return '<div class="du-info">Nessun dato da proporre.</div>';
  const spunta = (r, i) => {
    if (r.stato === 'mancante') return `<input type="checkbox" data-du-riga="${i}" checked title="Nella scheda manca: si riporta">`;
    if (r.stato === 'diverso') return `<input type="checkbox" data-du-riga="${i}" title="Nella scheda c'è un altro valore: spunta per sostituirlo">`;
    if (r.stato === 'uguale') return '✓';
    return '—';
  };
  const legenda = { mancante: 'manca nella scheda', diverso: 'nella scheda è diverso: spunta per sostituirlo', uguale: 'già uguale', bloccato: '' };
  return `<table class="du-tab"><tr><th></th><th>Campo</th><th>Nella scheda</th><th>Dato ufficiale</th></tr>${righe.map((r, i) => `
    <tr class="du-${r.stato}">
      <td>${spunta(r, i)}</td>
      <td>${esc(r.etichetta)}</td>
      <td>${r.attuale ? esc(r.attuale) : '<i style="color:#aaa">vuoto</i>'}</td>
      <td><b>${esc(r.ufficiale)}</b> <span class="du-fonte">${esc(r.fonte)}</span>
        ${legenda[r.stato] ? `<div class="du-nota">${esc(legenda[r.stato])}</div>` : ''}
        ${r.nota ? `<div class="du-nota"${r.stato === 'bloccato' ? ' style="color:#b9770e"' : ''}>${esc(r.nota)}</div>` : ''}</td>
    </tr>`).join('')}</table>`;
}

const CSS = `
  .du-pannello{background:#f7fafc;border:1px solid #d6e4ef;border-radius:8px;padding:8px 10px;margin-top:6px;font-size:12px}
  .du-tab{width:100%;border-collapse:collapse;margin-top:6px}
  .du-tab th{text-align:left;font-size:11px;color:#888;font-weight:600;padding:3px 4px;border-bottom:1px solid #e3e3e3}
  .du-tab td{padding:4px;vertical-align:top;border-bottom:1px solid #f0f0f0}
  .du-tab tr.du-uguale td{color:#999}
  .du-fonte{font-size:10px;color:#fff;background:#7f8c8d;border-radius:8px;padding:0 6px;margin-left:4px}
  .du-nota{font-size:11px;color:#888}
  .du-info{font-size:12px;color:#555;margin:2px 0}
  .du-allarme{background:#fdecea;border-left:3px solid #c0392b;padding:5px 8px;border-radius:4px;color:#7b241c;margin:3px 0;font-size:12px}
  .du-fonti{font-size:11px;margin:3px 0}
  .du-ok{color:#27ae60}.du-ko{color:#b9770e}`;

/* Il riquadro, in testa alla sottoscheda Anagrafica */
export function pannelloHtml() {
  return `<div class="sez" id="du-sez">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost" id="du-cerca" title="Chiede a InfoCamere (Registro Imprese, solo società) e a VIES che cosa risulta per questa P.IVA o codice fiscale. Non salva niente: propone.">🔎 Dati ufficiali (InfoCamere e VIES)</button>
        <span class="hint">recupera i dati mancanti dal Registro Imprese: spunti tu che cosa riportare, poi «Salva le modifiche»</span>
      </div>
      <div id="du-esito"></div>
    </div>`;
}

/* Aggancio. dip = { sb, toast, campo(k) → elemento del campo k, attuali() → valori adesso } */
export function aggancia(dip) {
  const doc = globalThis.document;
  if (!doc) return;
  if (!doc.getElementById('du-css')) {
    const st = doc.createElement('style'); st.id = 'du-css'; st.textContent = CSS; doc.head.appendChild(st);
  }
  const btn = doc.getElementById('du-cerca'), box = doc.getElementById('du-esito');
  if (!btn || !box) return;
  let ultime = [];
  btn.addEventListener('click', async () => {
    const att = dip.attuali();
    const req = richiesta({ piva: att.piva, cf: att.impresa_cf, chiave: att.impresa_id });
    if (!req) { box.innerHTML = '<div class="du-allarme">Serve una partita IVA di 11 cifre o un codice fiscale di 16 caratteri nella scheda.</div>'; return; }
    box.innerHTML = '<div class="du-info">⏳ Chiedo a InfoCamere e VIES…</div>';
    let resp;
    try {
      const { data, error } = await dip.sb.functions.invoke('dati-impresa-ufficiali', { body: req });
      if (error) {
        let msg = error.message || 'errore';
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { /* risposta non JSON */ }
        throw new Error(msg);
      }
      resp = data;
    } catch (e) {
      box.innerHTML = `<div class="du-allarme">Non sono riuscito a leggere i dati ufficiali: ${esc(e.message || e)}. Non vuol dire che non ci siano: riprova più tardi o usa ufficiocamerale.it.</div>`;
      return;
    }
    ultime = proposte(resp, att);
    const nessuna = (!resp.infocamere || resp.infocamere.esito !== 'ok') && (!resp.vies || resp.vies.esito !== 'ok');
    const daRiportare = ultime.some((r) => r.stato === 'mancante' || r.stato === 'diverso');
    box.innerHTML = `<div class="du-pannello">
        ${intestazione(resp)}
        ${nessuna ? '<div class="du-info">Nessuna delle due fonti ha restituito dati (InfoCamere ha solo le società: le ditte individuali le trova VIES, se la P.IVA è attiva).</div>' : tabella(ultime)}
        ${daRiportare ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="btn btn-primary btn-sm" id="du-riporta">⬇️ Riporta nella scheda</button>
          <span class="du-nota">Riempie i campi spuntati e non salva: poi «Salva le modifiche».</span></div>` : ''}
        <div class="du-nota" style="margin-top:6px">Fonti: Registro Imprese – InfoCamere, dati di elevato valore (licenza CC BY 4.0); VIES – Commissione europea.</div>
      </div>`;
  });
  box.addEventListener('click', (e) => {
    const at = e.target.closest('[data-du-ateco]');
    if (at) {
      const inp = doc.getElementById('ia-ateco-cod');
      if (inp) { inp.value = at.dataset.duAteco; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); inp.scrollIntoView({ block: 'center' }); }
      return;
    }
    if (!e.target.closest('#du-riporta')) return;
    const scelte = [...box.querySelectorAll('[data-du-riga]')].filter((c) => c.checked).map((c) => ultime[+c.dataset.duRiga]).filter(Boolean);
    let fatti = 0;
    scelte.forEach((r) => {
      const el = dip.campo(r.campo);
      if (!el || el.readOnly) return;
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === r.ufficiale)) {
        const o = doc.createElement('option'); o.value = r.ufficiale; o.textContent = r.ufficiale; el.appendChild(o);
      }
      el.value = r.ufficiale;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.background = '#fff8e1';
      fatti++;
    });
    dip.toast(fatti ? `Riportati ${fatti} dati: ora «Salva le modifiche»` : 'Nessun dato spuntato', fatti ? 'ok' : '');
  });
}
