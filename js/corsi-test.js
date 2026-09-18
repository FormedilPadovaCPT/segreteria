/* ============================================================================
   IL TEST DI VERIFICA FINALE — nella scheda del corso        (18/09/2026)

   L'OPPOSTO DEL QUESTIONARIO, e le due sezioni non si devono somigliare:

   · il questionario è ANONIMO e misura il gradimento;
   · il test è NOMINATIVO, perché l'esito vale per l'attestato. Ogni iscritto
     ha un CODICE PERSONALE, stampato accanto al suo nome sul registro: è così
     che in aula ciascuno dice chi è, senza scegliere da un elenco di nomi da
     cui chiunque potrebbe prendere il posto di un altro.

   IL CORRETTORE SPARISCE: la risposta giusta si segna scrivendo la domanda, e
   il punteggio lo calcola l'app. Fino a ieri erano due file Word gemelli — il
   test e il test con le risposte segnate — da tenere allineati a mano.

   ⚠️ Ma l'app CORREGGE, non decide: il testo libero lo valuta una persona, e
   l'esito lo convalida il docente o il coordinatore. Senza convalida
   l'attestato non esce.
   ============================================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer } from './core.js';
import { scaricaPdf, pdfFoglioTest } from './corsi-doc.js';

const TIPI_DOM = { scelta: 'una sola risposta', multipla: 'più risposte', testo: 'testo libero' };
const ESITI = { da_correggere: 'da correggere', superato: 'superato', non_superato: 'non superato', annullata: 'annullata' };

function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dataIt(d.toISOString().slice(0, 10))} alle ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
const chiuso = (iso) => !!iso && new Date(iso) <= new Date();

export async function datiTest(c) {
  const [{ data: domande }, { data: prove }, { data: riep }, { data: link }] = await Promise.all([
    sb.from('s_test_domande').select('*').eq('corso_id', c.id).order('ordine').order('id'),
    sb.from('s_test_prove').select('*').eq('corso_id', c.id).order('id'),
    sb.rpc('test_riepilogo', { p_corso_id: c.id }),
    c.test_codice ? sb.rpc('quest_link', { p_corso_id: c.id }) : Promise.resolve({ data: null }),
  ]);
  /* il link col QR lo dà il database già composto e firmato: la firma è del
     servizio e non si calcola qui */
  return { domande: domande || [], prove: prove || [], riep: riep || {}, link: link?.test_link || '' };
}

export function sezioneTest(c, t, iscritti) {
  if (!c.test_previsto && !c.test_codice) {
    return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📝 Test di verifica finale</h4>
    <p class="hint" style="margin:0 0 8px">Questo corso non prevede un test. Se serve, si attiva dai dati del corso
      («test previsto») e da lì si scrivono le domande.</p>`;
  }

  const ammessi = (iscritti || []).filter((i) => !['annullato', 'sostituito'].includes(i.esito || ''));
  if (!c.test_codice) {
    return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📝 Test di verifica finale</h4>
    <p class="hint" style="margin:0 0 8px">Aprendolo nascono il <strong>codice del test</strong> e un
      <strong>codice personale per ciascun iscritto</strong>, che finisce stampato accanto al suo nome sul registro:
      è così che in aula ognuno dice chi è. Le domande le scrivi qui, con la risposta giusta segnata: il punteggio
      lo calcola l'app, il testo libero e la convalida restano a una persona.</p>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="margin:0;width:120px"><label>Soglia %</label>
        <input type="number" id="tz-soglia" min="0" max="100" step="1" value="${c.test_soglia ?? 70}"></div>
      <div class="field" style="margin:0;width:120px"><label>Minuti</label>
        <input type="number" id="tz-minuti" min="1" max="600" step="1" value="${c.test_minuti ?? 15}"></div>
      <button class="btn btn-primary btn-sm" id="tz-apri">📝 Apri il test (${ammessi.length} codici)</button>
    </div>`;
  }

  const r = t.riep || {};
  const eChiuso = chiuso(c.test_chiuso_il);
  const pubblicato = !!c.test_pubblicato_il;
  const senzaCorrette = t.domande.filter((d) => d.tipo !== 'testo' && !(d.corrette || []).length).length;

  const rigaDom = (d) => `<tr>
    <td>${esc(d.testo)}</td>
    <td>${esc(TIPI_DOM[d.tipo] || d.tipo)}
      ${(d.opzioni || []).length ? `<br><span class="hint">${(d.opzioni || []).map((o) =>
        (d.corrette || []).includes(o) ? `<strong style="color:var(--in)">✓ ${esc(o)}</strong>` : esc(o)).join(' · ')}</span>` : ''}</td>
    <td class="num">${d.punti}</td>
    <td style="white-space:nowrap"><a href="#" data-tz-moddom="${d.id}">modifica</a> · <a href="#" data-tz-deldom="${d.id}">elimina</a></td>
  </tr>`;

  const rigaProva = (p) => `<tr>
    <td><strong>${esc(p.nominativo || '—')}</strong>${p.riferimento_esito && p.riferimento_esito !== 'riconosciuta'
      ? `<br><span class="dt-cella dt-scaduto" style="padding:1px 6px">${esc(p.riferimento_esito)}</span>` : ''}</td>
    <td class="num">${p.punteggio ?? '—'} / ${p.punteggio_max ?? '—'}</td>
    <td class="num">${p.percentuale != null ? `${p.percentuale}%` : '—'}</td>
    <td><span class="dt-cella ${p.esito === 'superato' ? 'dt-ok' : p.esito === 'non_superato' ? 'dt-scaduto' : ''}"
      style="padding:1px 6px">${esc(ESITI[p.esito] || p.esito)}</span>
      ${p.da_correggere ? `<br><span class="hint">${p.da_correggere} da valutare a mano</span>` : ''}</td>
    <td>${p.convalidato_il ? `${dataIt(p.convalidato_il.slice(0, 10))}<br><span class="hint">${esc(p.convalidato_da || '')}</span>` : '<span class="hint">no</span>'}</td>
    <td style="white-space:nowrap"><a href="#" data-tz-prova="${p.id}">${p.convalidato_il ? 'rivedi' : '✔ convalida'}</a></td>
  </tr>`;

  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📝 Test di verifica finale
      <span class="hint" style="font-weight:400">— nominativo</span></h4>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span class="dt-cella" style="padding:2px 8px"><strong class="num">${esc(c.test_codice)}</strong></span>
      <span class="dt-cella ${eChiuso ? 'dt-scaduto' : 'dt-ok'}" style="padding:2px 8px">
        ${eChiuso ? 'chiuso il' : 'aperto fino al'} ${quando(c.test_chiuso_il)}</span>
      <span class="dt-cella" style="padding:2px 8px">soglia ${Math.round(c.test_soglia ?? 70)}% · ${c.test_minuti ?? 15} min</span>
      <span class="dt-cella ${pubblicato ? 'dt-ok' : 'dt-scaduto'}" style="padding:2px 8px"
        title="${esc(c.test_pubblica_esito || '')}">${pubblicato ? 'sul portale' : 'non ancora sul portale'}</span>
    </div>

    ${senzaCorrette ? `<div class="dt-doc-riga" style="border-left:3px solid var(--out);margin-bottom:8px">
      ⚠️ ${senzaCorrette} domanda${senzaCorrette > 1 ? 'e' : ''} senza la risposta giusta segnata: così non si può correggere.</div>` : ''}

    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Ammessi</th><th>Consegnate</th><th>Da valutare</th><th>Da convalidare</th><th>Superate</th><th>Non superate</th><th>Media</th></tr></thead>
      <tbody><tr>
        <td class="num">${r.ammessi ?? ammessi.length}</td>
        <td class="num"><strong>${r.consegnate ?? 0}</strong></td>
        <td class="num">${r.da_correggere ?? 0}</td>
        <td class="num" style="color:${(r.da_convalidare ?? 0) > 0 ? 'var(--arancio)' : 'inherit'}">${r.da_convalidare ?? 0}</td>
        <td class="num">${r.superate ?? 0}</td>
        <td class="num">${r.non_superate ?? 0}</td>
        <td class="num">${r.media != null ? `${r.media}%` : '—'}</td>
      </tr></tbody>
    </table></div>
    <p class="hint" style="margin:6px 0 10px">L'app corregge le domande chiuse; il <strong>testo libero</strong> lo valuti tu,
      e l'esito va <strong>convalidato</strong> — è l'equivalente della firma sul foglio corretto. Senza convalida
      l'attestato non esce.</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="tz-foglio">📄 Foglio col QR del test</button>
      <button class="btn btn-ghost btn-sm" id="tz-pubblica">${pubblicato ? '↻ Ripubblica sul portale' : '🌐 Pubblica sul portale'}</button>
      <button class="btn btn-ghost btn-sm" id="tz-codici">🔑 Vedi i codici personali</button>
    </div>

    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Domande <span class="hint">(✓ = la risposta giusta)</span></th><th>Tipo e risposte</th><th>Punti</th><th></th></tr></thead>
      <tbody>${t.domande.map(rigaDom).join('') || '<tr><td colspan="4" class="empty">Nessuna domanda: il test non si può fare.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" id="tz-adddom" style="margin-top:6px">+ Domanda del test</button>

    ${t.prove.length ? `<h4 style="margin:14px 0 6px">Prove consegnate</h4>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Chi</th><th>Punti</th><th>%</th><th>Esito</th><th>Convalidata</th><th></th></tr></thead>
      <tbody>${t.prove.map(rigaProva).join('')}</tbody>
    </table></div>` : ''}`;
}

export function collegaTest(c, t, iscritti, ricarica) {
  const body = $('#drawer-body');

  body.querySelector('#tz-apri')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.rpc('test_apri', {
      p_corso_id: c.id,
      p_soglia: Number($('#tz-soglia').value) || 70,
      p_minuti: Number($('#tz-minuti').value) || 15,
      p_ore: 48,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    const r = Array.isArray(data) ? data[0] : data;
    toast(`Test aperto: ${r?.codice}, ${r?.codici_personali} codici personali.`, 'ok');
    await pubblica(c, true);
    ricarica();
  });

  body.querySelector('#tz-pubblica')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    await pubblica(c, false);
    attendi(ev.currentTarget, false);
    ricarica();
  });

  body.querySelector('#tz-foglio')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const byte = await pdfFoglioTest(c, { codice: c.test_codice, link: t.link, domande: t.domande });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_test-QR_corso-${c.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    attendi(ev.currentTarget, false);
  });

  body.querySelector('#tz-codici')?.addEventListener('click', () => {
    const righe = (iscritti || []).filter((i) => i.test_codice)
      .map((i) => `<tr><td>${esc(i.nominativo)}</td><td class="num"><strong>${esc(i.test_codice)}</strong></td></tr>`).join('');
    apriDrawer(`Codici personali — corso n° ${c.id}`, '', `
      <p class="hint" style="margin:0 0 10px">Ogni codice sta già stampato accanto al nome sul registro: questa è solo
        una copia da consultare. <strong>Non vanno mandati per mail insieme al nome</strong> — chi li avesse tutti
        potrebbe fare il test al posto di chiunque.</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Partecipante</th><th>Codice</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="2" class="empty">Nessun codice: apri il test.</td></tr>'}</tbody>
      </table></div>`);
  });

  body.querySelector('#tz-adddom')?.addEventListener('click', () => formDomanda(c, t, null, ricarica));

  body.querySelectorAll('[data-tz-moddom]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formDomanda(c, t, t.domande.find((d) => d.id === Number(a.dataset.tzModdom)), ricarica);
  }));

  body.querySelectorAll('[data-tz-deldom]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Elimino la domanda? Le prove già consegnate restano come sono.')) return;
    const { error } = await sb.from('s_test_domande').delete().eq('id', Number(a.dataset.tzDeldom));
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  }));

  body.querySelectorAll('[data-tz-prova]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    formConvalida(c, t, t.prove.find((p) => p.id === Number(a.dataset.tzProva)), ricarica);
  }));
}

async function pubblica(c, silenziosa) {
  const { data, error } = await sb.functions.invoke('questionari-pubblica', { body: { corso_id: c.id, cosa: 'test' } });
  if (error || data?.status !== 'ok') {
    const m = data?.esito || data?.saltati?.[0]?.motivo || error?.message || 'non pubblicato';
    toast(`Il test NON è sul portale: ${m}`, 'err');
    return false;
  }
  if (!silenziosa) toast('Test pubblicato sul portale.', 'ok');
  return true;
}

/* ── la domanda, con la risposta giusta ── */
function formDomanda(c, t, d, ricarica) {
  const opz = (d?.opzioni || []).join('\n');
  apriDrawer(d ? 'Domanda del test' : `Nuova domanda — corso n° ${c.id}`, '', `
    <div class="field"><label>La domanda *</label>
      <textarea id="td-testo" rows="2" maxlength="600">${esc(d?.testo || '')}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 120px;gap:10px">
      <div class="field"><label>Tipo</label>
        <select id="td-tipo">${Object.entries(TIPI_DOM).map(([k, l]) =>
          `<option value="${k}" ${d?.tipo === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Punti</label>
        <input type="number" id="td-punti" min="0.5" max="100" step="0.5" value="${d?.punti ?? 1}"></div>
    </div>
    <div id="td-box-opz">
      <div class="field"><label>Risposte proposte — una per riga (da 2 a 8)</label>
        <textarea id="td-opzioni" rows="4">${esc(opz)}</textarea></div>
      <div class="field"><label>Quali sono giuste? <span class="hint">— si spuntano qui sotto</span></label>
        <div id="td-corrette" class="dt-doc-riga" style="border-left:3px solid var(--in)">
          <span class="hint">Scrivi le risposte qui sopra e poi spunta quelle giuste.</span></div></div>
    </div>
    <p class="hint">⚠️ La risposta giusta resta nel Gestionale: al portale arrivano solo le domande.
      Una domanda a scelta senza la risposta segnata non si può correggere.</p>
    <button class="btn btn-primary" id="td-salva" style="margin-top:10px">${d ? 'Salva' : 'Aggiungi'}</button>`);

  const box = $('#td-box-opz');
  const disegnaCorrette = () => {
    const tipo = $('#td-tipo').value;
    const opzioni = $('#td-opzioni').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const gia = d?.corrette || [];
    const cont = $('#td-corrette');
    if (!opzioni.length) { cont.innerHTML = '<span class="hint">Scrivi le risposte qui sopra e poi spunta quelle giuste.</span>'; return; }
    cont.innerHTML = opzioni.map((o, k) => `<label style="display:block;margin:4px 0;cursor:pointer">
      <input type="${tipo === 'multipla' ? 'checkbox' : 'radio'}" name="td-ok" value="${esc(o)}"
        ${gia.includes(o) ? 'checked' : ''} style="margin-right:8px">${esc(o)}</label>`).join('');
  };
  const aggiornaTipo = () => {
    box.style.display = $('#td-tipo').value === 'testo' ? 'none' : '';
    disegnaCorrette();
  };
  $('#td-tipo').addEventListener('change', aggiornaTipo);
  $('#td-opzioni').addEventListener('input', disegnaCorrette);
  aggiornaTipo();

  $('#td-salva').addEventListener('click', async (ev) => {
    const testo = $('#td-testo').value.trim();
    const tipo = $('#td-tipo').value;
    const punti = Number($('#td-punti').value) || 1;
    const opzioni = tipo === 'testo' ? [] : $('#td-opzioni').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const corrette = tipo === 'testo' ? []
      : [...$('#td-corrette').querySelectorAll('input:checked')].map((x) => x.value);
    if (!testo) return toast('Serve il testo della domanda.', 'err');
    if (tipo !== 'testo' && (opzioni.length < 2 || opzioni.length > 8)) return toast('Da 2 a 8 risposte proposte.', 'err');
    if (tipo !== 'testo' && !corrette.length) return toast('Spunta quale risposta è giusta: senza, non si corregge.', 'err');
    attendi(ev.currentTarget, true);
    const dati = { testo, tipo, punti, opzioni, corrette };
    const { error } = d
      ? await sb.from('s_test_domande').update(dati).eq('id', d.id)
      : await sb.from('s_test_domande').insert({ ...dati, corso_id: c.id, ordine: (t.domande.length || 0) + 1 });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  });
}

/* ── la convalida: quello che oggi è la firma sul foglio corretto ── */
function formConvalida(c, t, p, ricarica) {
  if (!p) return;
  const dom = (id) => t.domande.find((d) => String(d.id) === String(id));
  const righe = Object.entries(p.risposte || {}).map(([id, v]) => {
    const d = dom(id);
    const data = Array.isArray(v) ? v.join(' · ') : String(v);
    const giusta = d && d.tipo !== 'testo'
      ? (JSON.stringify([...(Array.isArray(v) ? v : [v])].sort()) === JSON.stringify([...(d.corrette || [])].sort()))
      : null;
    return `<tr>
      <td>${esc(d?.testo || `domanda ${id}`)}</td>
      <td>${esc(data)}</td>
      <td>${giusta === null ? '<span class="hint">da valutare</span>'
        : giusta ? '<span class="dt-cella dt-ok" style="padding:1px 6px">giusta</span>'
                 : `<span class="dt-cella dt-scaduto" style="padding:1px 6px">errata</span>
                    <br><span class="hint">${esc((d.corrette || []).join(' · '))}</span>`}</td>
      <td class="num">${d?.punti ?? '—'}</td>
    </tr>`;
  }).join('');

  apriDrawer(`Prova di ${p.nominativo || '—'}`, '', `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span class="dt-cella" style="padding:2px 8px">${p.punteggio ?? '—'} / ${p.punteggio_max ?? '—'} punti</span>
      <span class="dt-cella" style="padding:2px 8px">${p.percentuale != null ? `${p.percentuale}%` : '—'}</span>
      <span class="dt-cella" style="padding:2px 8px">soglia ${Math.round(c.test_soglia ?? 70)}%</span>
      ${p.da_correggere ? `<span class="dt-cella dt-scaduto" style="padding:2px 8px">${p.da_correggere} da valutare</span>` : ''}
    </div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Domanda</th><th>Ha risposto</th><th>Esito</th><th>Punti</th></tr></thead>
      <tbody>${righe || '<tr><td colspan="4" class="empty">Nessuna risposta.</td></tr>'}</tbody>
    </table></div>
    <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-top:12px">
      <div class="field"><label>Punteggio finale</label>
        <input type="number" id="tc-punti" step="0.5" min="0" max="${p.punteggio_max ?? 100}" value="${p.punteggio ?? 0}"></div>
      <div class="field"><label>Esito</label>
        <select id="tc-esito">
          <option value="">— lo calcola dalla soglia —</option>
          <option value="superato" ${p.esito === 'superato' ? 'selected' : ''}>superato</option>
          <option value="non_superato" ${p.esito === 'non_superato' ? 'selected' : ''}>non superato</option>
          <option value="annullata" ${p.esito === 'annullata' ? 'selected' : ''}>annullata</option>
        </select></div>
    </div>
    <div class="field"><label>Note</label><textarea id="tc-note" rows="2">${esc(p.note || '')}</textarea></div>
    <p class="hint">⚠️ Convalidando metti la tua firma su questo esito: è quello che finisce sulla riga
      dell'iscritto e apre la strada all'attestato. Il testo libero lo valuti tu — l'app non lo corregge.</p>
    <button class="btn btn-primary" id="tc-salva" style="margin-top:6px">✔ Convalida</button>`);

  $('#tc-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('test_convalida', {
      p_prova_id: p.id,
      p_esito: $('#tc-esito').value || null,
      p_punteggio: Number($('#tc-punti').value),
      p_note: $('#tc-note').value.trim() || null,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Esito convalidato.', 'ok');
    ricarica();
  });
}
