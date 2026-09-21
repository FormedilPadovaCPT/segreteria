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

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';
import { scaricaPdf, pdfFoglioTest } from './corsi-doc.js';
import { scaricaEml } from './eml.js';

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
  const [{ data: domande }, { data: prove }, { data: riep }, { data: link },
    { data: inviti }, { data: parti }, { data: giornate },
    { data: proposte }, { data: incarichi }, { data: interventi }] = await Promise.all([
    sb.from('s_test_domande').select('*').eq('corso_id', c.id).order('ordine').order('id'),
    sb.from('s_test_prove').select('*').eq('corso_id', c.id).order('id'),
    sb.rpc('test_riepilogo', { p_corso_id: c.id }),
    c.test_codice ? sb.rpc('quest_link', { p_corso_id: c.id }) : Promise.resolve({ data: null }),
    /* chi è stato invitato a scriverlo, e che cosa è tornato indietro */
    sb.rpc('dtest_inviti', { p_corso_id: c.id }),
    sb.rpc('test_parti', { p_corso_id: c.id }),
    sb.from('s_corsi_giornate').select('id, data').eq('corso_id', c.id).order('data'),
    sb.from('s_test_proposte').select('*').eq('corso_id', c.id).order('id', { ascending: false }),
    /* i docenti già noti del corso: si propongono, non si riscrivono */
    sb.from('s_corsi_incarichi').select('persona_id, nominativo').eq('corso_id', c.id),
    sb.from('s_corsi_interventi').select('persona_id, nominativo, qualita').eq('corso_id', c.id),
  ]);
  const visti = new Map();
  for (const x of [...(incarichi || []), ...(interventi || [])]) {
    const n = (x.nominativo || '').trim();
    if (n && !visti.has(n.toLowerCase())) visti.set(n.toLowerCase(), { nominativo: n, persona_id: x.persona_id || null });
  }
  /* il link col QR lo dà il database già composto e firmato: la firma è del
     servizio e non si calcola qui */
  return {
    domande: domande || [], prove: prove || [], riep: riep || {}, link: link?.test_link || '',
    inviti: inviti || [], proposte: proposte || [], docenti: [...visti.values()],
    parti: parti || [], giornate: giornate || [],
  };
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

  /* con più docenti le domande vengono da mani diverse: si dice da quale,
     e a quale modulo appartengono (19/09/2026) */
  const parteDi = (id) => (t.parti || []).find((p) => String(p.id) === String(id));
  const rigaDom = (d) => `<tr>
    <td>${esc(d.testo)}
      ${d.parte_id || d.origine ? `<br><span class="hint">${d.parte_id
        ? `📦 ${esc(parteDi(d.parte_id)?.titolo || 'modulo')}` : ''}${d.parte_id && d.origine ? ' · ' : ''}${d.origine
        ? `✍ ${esc(d.origine)}` : ''}</span>` : ''}</td>
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

    ${sezioneModuli(c, t)}

    ${sezioneDocente(c, t)}

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

/* ══ PIÙ VERIFICHE IN UN CORSO, UNA PER MODULO ═════════════════════════════
   Chiesto dall'utente il 19/09/2026: «nei corsi con più docenti o più moduli
   o giornate potrebbe essere che ci sono più test di docenti diversi», e la
   scelta si fa CORSO PER CORSO.

   Un corso normale non vede niente di tutto questo: finché non si crea il
   primo modulo, il test resta quello unico di sempre. Creandone uno il corso
   passa a «per modulo», e ogni modulo ha il SUO codice, il SUO QR, la SUA
   soglia e la SUA finestra — mentre il codice personale del corsista resta
   uno solo, perché il registro si stampa una volta.

   ⚠️ L'attestato non guarda più una prova sola: la valutazione dell'iscritto
   diventa «Superato (3 moduli su 3)» e resta «da completare» finché tutte le
   verifiche previste non sono state fatte (test_valutazione_iscritto). */
function sezioneModuli(c, t) {
  const parti = t.parti || [];
  if (!parti.length && c.test_modo !== 'per_modulo') {
    return `
    <div class="dt-doc-riga" style="border-left:3px solid var(--bordo);margin:12px 0 8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="hint">Verifica <strong>unica</strong> per tutto il corso. Se le giornate o i docenti sono più d'uno,
          si può fare <strong>una verifica per modulo</strong>: ognuna col suo QR.</span>
        <button class="btn btn-ghost btn-sm" id="tp-nuovo">+ Verifica di modulo</button>
      </div>
    </div>`;
  }

  const riga = (p) => `<tr>
    <td><strong>${esc(p.titolo)}</strong>${p.docente ? `<br><span class="hint">✍ ${esc(p.docente)}</span>` : ''}</td>
    <td class="num">${p.domande}${p.senza_risposta
      ? `<br><span class="dt-cella dt-scaduto" style="padding:1px 5px">${p.senza_risposta} senza soluzione</span>` : ''}</td>
    <td class="num">${p.consegnate}${p.da_convalidare
      ? `<br><span class="hint">${p.da_convalidare} da convalidare</span>` : ''}</td>
    <td><span class="dt-cella ${chiuso(p.chiuso_il) ? 'dt-scaduto' : 'dt-ok'}" style="padding:1px 6px">
        ${chiuso(p.chiuso_il) ? 'chiusa il' : 'aperta fino al'} ${quando(p.chiuso_il)}</span>
      <br><span class="dt-cella ${p.pubblicato_il ? 'dt-ok' : 'dt-scaduto'}" style="padding:1px 6px"
        title="${esc(p.pubblica_esito || '')}">${p.pubblicato_il ? 'sul portale' : 'non sul portale'}</span></td>
    <td style="white-space:nowrap">
      <a href="#" data-tp-foglio="${p.id}">📄 QR</a> · <a href="#" data-tp-pubblica="${p.id}">🌐 pubblica</a><br>
      <a href="#" data-tp-domanda="${p.id}">+ domanda</a> · <a href="#" data-tp-mod="${p.id}">modifica</a>
      ${p.consegnate ? '' : ` · <a href="#" data-tp-del="${p.id}">elimina</a>`}</td>
  </tr>`;

  return `
    <div class="dt-doc-riga" style="border-left:3px solid var(--in);margin:12px 0 8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong>📦 Verifiche per modulo</strong>
        <button class="btn btn-ghost btn-sm" id="tp-nuovo">+ Verifica di modulo</button>
      </div>
      <p class="hint" style="margin:6px 0 0">Ogni modulo ha il suo QR e la sua soglia; il <strong>codice personale</strong>
        del corsista resta uno solo, buono per tutte. L'attestato esce quando <strong>tutte</strong> le verifiche previste
        sono superate.</p>
      <div class="table-wrap" style="margin-top:8px"><table class="tbl">
        <thead><tr><th>Modulo</th><th>Domande</th><th>Consegnate</th><th>Stato</th><th></th></tr></thead>
        <tbody>${parti.map(riga).join('')}</tbody>
      </table></div>
    </div>`;
}

/* la maschera del modulo: titolo, docente, giornata, soglia, minuti */
function formModulo(c, t, p, ricarica) {
  const g = t.giornate || [];
  apriDrawer(p ? 'Modulo di verifica' : `Nuova verifica di modulo — corso n° ${c.id}`, '', `
    <p class="hint">Il titolo è quello che il corsista legge in cima alla prova e sul foglio del QR:
      «Modulo 2 — Ponteggi» dice più di «Test 2».</p>
    <div class="field"><label>Titolo <span style="color:var(--out)">*</span></label>
      <input type="text" id="tp-titolo" value="${esc(p?.titolo || '')}" placeholder="Modulo 1 — Rischio caduta"></div>
    <div class="field"><label>Docente <span class="hint">(chi lo ha tenuto)</span></label>
      <input type="text" id="tp-docente" list="tp-docenti" value="${esc(p?.docente || '')}">
      <datalist id="tp-docenti">${(t.docenti || []).map((d) => `<option value="${esc(d.nominativo)}">`).join('')}</datalist></div>
    <div class="field"><label>Giornata <span class="hint">(per calcolare da quando si chiude)</span></label>
      <select id="tp-giornata"><option value="">— l'ultima del corso —</option>
        ${g.map((x) => `<option value="${x.id}" ${String(p?.giornata_id) === String(x.id) ? 'selected' : ''}>${dataIt(x.data)}</option>`).join('')}
      </select></div>
    <div style="display:flex;gap:8px">
      <div class="field" style="width:110px"><label>Soglia %</label>
        <input type="number" id="tp-soglia" min="0" max="100" value="${p?.soglia ?? c.test_soglia ?? 70}"></div>
      <div class="field" style="width:110px"><label>Minuti</label>
        <input type="number" id="tp-minuti" min="1" max="600" value="${p?.minuti ?? c.test_minuti ?? 15}"></div>
      <div class="field" style="width:130px"><label>Resta aperta (ore)</label>
        <input type="number" id="tp-ore" min="1" max="2000" value="48"></div>
    </div>
    <div class="drawer-actions">
      <button class="btn btn-primary" id="tp-ok">${p ? 'Salva' : 'Crea la verifica'}</button>
      <button class="btn btn-ghost" id="tp-no">Annulla</button>
    </div>`);

  const body = $('#drawer-body');
  body.querySelector('#tp-no').addEventListener('click', () => chiudiDrawer());
  body.querySelector('#tp-ok').addEventListener('click', async (ev) => {
    const titolo = body.querySelector('#tp-titolo').value.trim();
    if (!titolo) return toast('Il modulo vuole un titolo.', 'err');
    const gio = body.querySelector('#tp-giornata').value;
    ev.target.disabled = true;
    const { error } = await sb.rpc('test_parte_apri', {
      p_corso_id: c.id, p_titolo: titolo,
      p_docente: body.querySelector('#tp-docente').value.trim() || null,
      p_giornata_id: gio ? Number(gio) : null,
      p_soglia: Number(body.querySelector('#tp-soglia').value) || null,
      p_minuti: Number(body.querySelector('#tp-minuti').value) || null,
      p_ore: Number(body.querySelector('#tp-ore').value) || 48,
      p_parte_id: p?.id || null,
    });
    if (error) { ev.target.disabled = false; return toast(error.message, 'err'); }
    chiudiDrawer();
    toast(p ? 'Modulo aggiornato.' : 'Verifica di modulo creata: ora scrivi le domande o chiedile al docente.', 'ok');
    await ricarica();
  });
}

/* ══ IL TEST LO SCRIVE IL DOCENTE ══════════════════════════════════════════
   Chiesto dall'utente il 19/09/2026: «bisogna che il docente del corso, anche
   tramite la segreteria, possa caricare il test di quello specifico corso o
   lezione o evento». Le domande le poteva scrivere solo chi entra in questa
   applicazione — e un docente, tecnico o esterno, non ci entra.

   ⚠️ Quello che il docente manda NON è il test: è una PROPOSTA. Diventa il
   test solo quando la si porta dentro da qui. È la stessa regola delle
   iscrizioni: una richiesta non è un iscritto, e quello che finisce sul QR
   dei corsisti lo rilegge qualcuno. */
const STATI_INV = {
  in_attesa: 'mandato, in attesa', consegnato: 'ha risposto',
  accettato: 'portato nel test', scartato: 'scartato', revocato: 'revocato',
};

function sezioneDocente(c, t) {
  const inviti = t.inviti || [];
  const nuove = (t.proposte || []).filter((p) => p.stato === 'nuova');
  const viste = (t.proposte || []).filter((p) => p.stato !== 'nuova');

  const rigaInv = (i) => `<tr>
    <td><strong>${esc(i.nominativo)}</strong>${i.email ? `<br><span class="hint">${esc(i.email)}</span>` : ''}
      ${i.parte ? `<br><span class="hint">📦 ${esc(i.parte)}</span>` : ''}</td>
    <td><span class="dt-cella ${i.stato === 'accettato' ? 'dt-ok' : i.scaduto || i.stato === 'revocato' ? 'dt-scaduto' : ''}"
      style="padding:1px 6px">${esc(STATI_INV[i.stato] || i.stato)}</span>
      ${i.scaduto && ['in_attesa', 'consegnato'].includes(i.stato) ? '<br><span class="hint">scaduto</span>' : ''}</td>
    <td class="hint">fino al ${dataIt(i.scadenza)}</td>
    <td style="white-space:nowrap">${i.link
      ? `<a href="#" data-td-copia="${i.id}">copia il link</a> · <a href="#" data-td-mail="${i.id}">✉ bozza mail</a> · <a href="#" data-td-revoca="${i.id}">revoca</a>`
      : `<span class="hint">${i.motivo ? esc(i.motivo) : '—'}</span>`}</td>
  </tr>`;

  /* l'anteprima serve a decidere, non a rileggere tutto: le domande intere si
     vedono aprendo il dettaglio */
  const anteprima = (p) => {
    const dom = Array.isArray(p.domande) ? p.domande : [];
    return `<details><summary class="hint" style="cursor:pointer">${dom.length} domand${dom.length === 1 ? 'a' : 'e'} — guardale</summary>
      <ol style="margin:6px 0 0 18px;padding:0">${dom.map((d) => `<li style="margin-bottom:4px">${esc(d.testo || '')}
        <span class="hint">(${esc(TIPI_DOM[d.tipo] || d.tipo || '')}, ${d.punti ?? 1} p.)</span>
        ${(d.opzioni || []).length ? `<br><span class="hint">${(d.opzioni || []).map((o) =>
          (d.corrette || []).includes(o) ? `<strong style="color:var(--in)">✓ ${esc(o)}</strong>` : esc(o)).join(' · ')}</span>` : ''}</li>`).join('')}</ol></details>`;
  };

  const rigaProp = (p) => `<tr>
    <td><strong>${esc(p.nominativo || '—')}</strong>
      <br><span class="hint">${p.arrivata_il ? quando(p.arrivata_il) : ''}${p.progressivo ? ` · n° ${p.progressivo}` : ''}</span>
      ${p.riferimento_esito && p.riferimento_esito !== 'agganciata'
        ? `<br><span class="dt-cella dt-scaduto" style="padding:1px 6px">${esc(p.riferimento_esito)}</span>` : ''}</td>
    <td>${anteprima(p)}${p.note ? `<br><span class="hint">Note: ${esc(p.note)}</span>` : ''}</td>
    <td style="white-space:nowrap">
      <a href="#" data-td-porta="${p.id}">➜ porta nel test</a><br>
      <a href="#" data-td-accoda="${p.id}">aggiungi in fondo</a> · <a href="#" data-td-scarta="${p.id}">scarta</a></td>
  </tr>`;

  return `
    <div class="dt-doc-riga" style="border-left:3px solid var(--arancio);margin:12px 0 8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong>✍ Il test lo scrive il docente</strong>
        <button class="btn btn-ghost btn-sm" id="td-invita">✉ Chiedi il test a un docente</button>
      </div>
      <p class="hint" style="margin:6px 0 0">Gli si manda un <strong>link</strong>: scrive le domande da lì, senza entrare
        in nessuna applicazione — vale anche per un docente esterno. Quello che manda <strong>non va online</strong>:
        arriva qui, e lo porti nel test tu.</p>

      ${nuove.length ? `<div class="table-wrap" style="margin-top:8px"><table class="tbl">
        <thead><tr><th>Arrivato da</th><th>Che cosa propone</th><th></th></tr></thead>
        <tbody>${nuove.map(rigaProp).join('')}</tbody></table></div>` : ''}

      ${inviti.length ? `<div class="table-wrap" style="margin-top:8px"><table class="tbl">
        <thead><tr><th>Invitato</th><th>Stato</th><th>Scadenza</th><th></th></tr></thead>
        <tbody>${inviti.map(rigaInv).join('')}</tbody></table></div>`
        : '<p class="hint" style="margin:6px 0 0">Nessun invito mandato.</p>'}

      ${viste.length ? `<details style="margin-top:6px"><summary class="hint" style="cursor:pointer">Proposte già viste (${viste.length})</summary>
        <div class="table-wrap" style="margin-top:6px"><table class="tbl">
          <thead><tr><th>Da</th><th>Proposta</th><th>Esito</th></tr></thead>
          <tbody>${viste.map((p) => `<tr><td>${esc(p.nominativo || '—')}<br><span class="hint">${p.arrivata_il ? quando(p.arrivata_il) : ''}</span></td>
            <td>${anteprima(p)}</td>
            <td><span class="dt-cella ${p.stato === 'accettata' ? 'dt-ok' : 'dt-scaduto'}" style="padding:1px 6px">${p.stato === 'accettata'
              ? `portate ${p.domande_portate ?? 0} domande` : 'scartata'}</span>
              ${p.motivo ? `<br><span class="hint">${esc(p.motivo)}</span>` : ''}
              ${p.esaminata_da ? `<br><span class="hint">${esc(p.esaminata_da)}</span>` : ''}</td></tr>`).join('')}</tbody>
        </table></div></details>` : ''}
    </div>`;
}

/* la maschera dell'invito: chi, la mail, per quanti giorni */
function formInvito(c, t, ricarica) {
  const docenti = t.docenti || [];
  apriDrawer('Chiedi il test a un docente', '', `
    <p class="hint">Il docente riceve un link e scrive le domande da lì. Il link <strong>non dà accesso a nient'altro</strong>
      e scade: chi ce l'ha può solo mandare una proposta per <em>questo</em> corso.</p>
    <div class="field"><label>Docente</label>
      <select id="ti-scelta">
        ${docenti.map((d) => `<option value="${esc(d.nominativo)}">${esc(d.nominativo)}</option>`).join('')}
        <option value="__altro">— un altro nominativo —</option>
      </select></div>
    <div class="field" id="ti-box-nome" ${docenti.length ? 'hidden' : ''}><label>Nominativo</label>
      <input type="text" id="ti-nome" placeholder="Rossi Ing. Mario"></div>
    <div class="field"><label>E-mail <span class="hint">(per la bozza della mail)</span></label>
      <input type="email" id="ti-email" placeholder="nome@esempio.it"></div>
    ${(t.parti || []).length ? `<div class="field"><label>Per quale verifica</label>
      <select id="ti-parte">
        ${(t.parti || []).map((p) => `<option value="${p.id}">${esc(p.titolo)}${p.docente ? ` — ${esc(p.docente)}` : ''}</option>`).join('')}
        <option value="">— la verifica del corso —</option>
      </select>
      <span class="hint">Le domande che manderà finiranno in questa verifica.</span></div>` : ''}
    <div class="field" style="width:160px"><label>Vale per (giorni)</label>
      <input type="number" id="ti-giorni" min="1" max="365" value="30"></div>
    <div class="drawer-actions">
      <button class="btn btn-primary" id="ti-ok">Crea l'invito</button>
      <button class="btn btn-ghost" id="ti-no">Annulla</button>
    </div>`);

  const body = $('#drawer-body');
  const scelta = body.querySelector('#ti-scelta');
  const box = body.querySelector('#ti-box-nome');
  if (!docenti.length) scelta.value = '__altro';
  scelta.addEventListener('change', () => { box.hidden = scelta.value !== '__altro'; });
  body.querySelector('#ti-no').addEventListener('click', () => chiudiDrawer());

  body.querySelector('#ti-ok').addEventListener('click', async (ev) => {
    const nome = scelta.value === '__altro' ? body.querySelector('#ti-nome').value.trim() : scelta.value;
    if (!nome) return toast('Senza il nome del docente non si manda un invito.', 'err');
    const email = body.querySelector('#ti-email').value.trim();
    const giorni = Number(body.querySelector('#ti-giorni').value) || 30;
    const persona = (docenti.find((d) => d.nominativo === nome) || {}).persona_id || null;
    ev.target.disabled = true;
    const selParte = body.querySelector('#ti-parte');
    const { data, error } = await sb.rpc('dtest_invita', {
      p_corso_id: c.id, p_nominativo: nome, p_email: email || null,
      p_persona_id: persona, p_giorni: giorni,
      p_parte_id: selParte && selParte.value ? Number(selParte.value) : null,
    });
    if (error) { ev.target.disabled = false; return toast(error.message, 'err'); }
    chiudiDrawer();
    mandaInvito(c, { nominativo: nome, email, link: data?.link, scadenza: data?.scadenza, parte: data?.parte });
    await ricarica();
  });
}

/* la bozza .eml: la manda una persona, come tutto quello che esce */
function mandaInvito(c, inv) {
  const righe = [
    `Gentile ${inv.nominativo},`,
    '',
    inv.parte
      ? `per il corso ${c.titolo}${c.data_inizio ? ` del ${dataIt(c.data_inizio)}` : ''} è prevista una verifica per ogni modulo.`
      : `per il corso ${c.titolo}${c.data_inizio ? ` del ${dataIt(c.data_inizio)}` : ''} è prevista una verifica finale.`,
    inv.parte ? `Le chiediamo di scrivere le domande del modulo «${inv.parte}» da questa pagina:`
              : 'Le chiediamo di scrivere le domande del test da questa pagina:',
    '',
    /* col marcatore «>>> etichetta (nota):» la riga diventa un pulsante
       nella versione HTML della mail (firma.js) e resta leggibile in
       quella in righe. Senza link non si scrive il marcatore, che
       resterebbe una promessa vuota. */
    ...(inv.link ? ['>>> Scrivi le domande del test (si apre la pagina, senza bisogno di accesso):', inv.link] : ['']),
    '',
    'Per ogni domanda a risposta chiusa va segnata la risposta giusta: è così che il punteggio',
    'si calcola da sé, e non serve più il foglio del correttore. Le domande a risposta scritta',
    'restano da valutare a mano.',
    '',
    inv.scadenza ? `Il link vale fino al ${dataIt(inv.scadenza)}.` : '',
    'Quello che invia arriva alla Segreteria, che lo controlla e lo pubblica.',
    '',
    'Grazie e buon lavoro.',
  ].filter((r) => r !== null);

  scaricaEml({
    to: inv.email || '',
    oggetto: `Test di verifica finale — ${c.titolo}`,
    corpo: righe.join('\n'),
    nomeFile: `invito-test_corso-${c.id}.eml`,
  });
  toast(inv.email ? 'Invito creato e bozza pronta: rileggila e mandala da Outlook.'
                  : 'Invito creato. Senza e-mail la bozza è vuota nel destinatario: mettilo tu.',
  inv.email ? 'ok' : 'err');
}

export function collegaTest(c, t, iscritti, ricarica) {
  const body = $('#drawer-body');

  /* ── le verifiche per modulo ── */
  body.querySelector('#tp-nuovo')?.addEventListener('click', () => formModulo(c, t, null, ricarica));

  body.querySelectorAll('[data-tp-mod]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    formModulo(c, t, (t.parti || []).find((p) => String(p.id) === a.dataset.tpMod), ricarica);
  }));

  body.querySelectorAll('[data-tp-pubblica]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const { data, error } = await sb.functions.invoke('questionari-pubblica', {
      body: { cosa: 'test_parte', parte_id: Number(a.dataset.tpPubblica) },
    });
    if (error || data?.status !== 'ok') {
      return toast(`La verifica NON è sul portale: ${data?.saltati?.[0]?.motivo || data?.esito || error?.message || 'non pubblicata'}`, 'err');
    }
    toast('Verifica pubblicata sul portale.', 'ok');
    await ricarica();
  }));

  body.querySelectorAll('[data-tp-foglio]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const p = (t.parti || []).find((x) => String(x.id) === a.dataset.tpFoglio);
    if (!p?.link) return toast('Questa verifica non ha ancora un codice.', 'err');
    try {
      const byte = await pdfFoglioTest(c, { codice: p.codice, link: p.link, titolo: p.titolo,
        domande: t.domande.filter((d) => String(d.parte_id) === String(p.id)) });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_test-QR_corso-${c.id}-modulo-${p.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
  }));

  body.querySelectorAll('[data-tp-del]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const p = (t.parti || []).find((x) => String(x.id) === a.dataset.tpDel);
    if (!p || !window.confirm(`Elimino la verifica «${p.titolo}» e le sue ${p.domande} domande?`)) return;
    const { error } = await sb.rpc('test_parte_elimina', { p_id: p.id });
    if (error) return toast(error.message, 'err');
    toast('Verifica eliminata.', 'ok');
    await ricarica();
  }));

  body.querySelectorAll('[data-tp-domanda]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    formDomanda(c, t, { parte_id: Number(a.dataset.tpDomanda) }, ricarica);
  }));

  /* ── il test scritto dal docente ── */
  body.querySelector('#td-invita')?.addEventListener('click', () => formInvito(c, t, ricarica));

  body.querySelectorAll('[data-td-copia]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const inv = (t.inviti || []).find((x) => String(x.id) === a.dataset.tdCopia);
    if (!inv?.link) return toast('Questo invito non ha più un link.', 'err');
    try { await navigator.clipboard.writeText(inv.link); toast('Link copiato.', 'ok'); }
    catch { window.prompt('Copia il link:', inv.link); }
  }));

  body.querySelectorAll('[data-td-mail]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const inv = (t.inviti || []).find((x) => String(x.id) === a.dataset.tdMail);
    if (inv) mandaInvito(c, inv);
  }));

  body.querySelectorAll('[data-td-revoca]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const inv = (t.inviti || []).find((x) => String(x.id) === a.dataset.tdRevoca);
    if (!inv) return;
    const motivo = window.prompt(`Revocare l'invito a ${inv.nominativo}? Il link smette di funzionare.\nMotivo (facoltativo):`, '');
    if (motivo === null) return;
    const { error } = await sb.rpc('dtest_revoca', { p_id: inv.id, p_motivo: motivo || null });
    if (error) return toast(error.message, 'err');
    toast('Invito revocato.', 'ok');
    await ricarica();
  }));

  /* ⚠️ «porta nel test» SOSTITUISCE le domande: si chiede conferma dicendo
     quante ce n'erano, perché è l'unica azione di qui che cancella qualcosa. */
  const porta = async (id, modo) => {
    const p = (t.proposte || []).find((x) => String(x.id) === String(id));
    if (!p) return;
    const quante = Array.isArray(p.domande) ? p.domande.length : 0;
    const c1 = modo === 'sostituisci' && t.domande.length
      ? window.confirm(`Il test ha già ${t.domande.length} domande: verranno SOSTITUITE dalle ${quante} di ${p.nominativo || 'questa proposta'}.\nProcedo?`)
      : window.confirm(`Porto ${quante} domand${quante === 1 ? 'a' : 'e'} di ${p.nominativo || 'questa proposta'} nel test${modo === 'aggiungi' ? ', in fondo a quelle che ci sono' : ''}?`);
    if (!c1) return;
    const { data, error } = await sb.rpc('dtest_accetta', { p_id: p.id, p_modo: modo });
    if (error) return toast(error.message, 'err');
    toast(`Portate nel test ${data?.domande ?? quante} domande. Ora rileggile e ripubblica sul portale.`, 'ok');
    await ricarica();
  };
  body.querySelectorAll('[data-td-porta]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault(); porta(a.dataset.tdPorta, 'sostituisci');
  }));
  body.querySelectorAll('[data-td-accoda]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault(); porta(a.dataset.tdAccoda, 'aggiungi');
  }));

  body.querySelectorAll('[data-td-scarta]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    /* il motivo è obbligatorio: è quello che si dice al docente */
    const motivo = window.prompt('Perché la scarti? (lo dirai al docente)', '');
    if (motivo === null) return;
    const { error } = await sb.rpc('dtest_scarta', { p_id: Number(a.dataset.tdScarta), p_motivo: motivo });
    if (error) return toast(error.message, 'err');
    toast('Proposta scartata. L\'invito resta valido: il docente può rimandarla corretta.', 'ok');
    await ricarica();
  }));

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
  /* ⚠️ «d» senza id NON è una domanda da modificare: è una domanda nuova che
     nasce dentro un modulo (ci si arriva da «+ domanda» sulla riga del
     modulo), e va inserita lì invece che aggiornare il nulla */
  const esistente = d && d.id ? d : null;
  const parteId = d?.parte_id ?? null;
  const parteDom = (t.parti || []).find((p) => String(p.id) === String(parteId));
  const opz = (d?.opzioni || []).join('\n');
  apriDrawer(esistente ? 'Domanda del test'
    : `Nuova domanda${parteDom ? ` — ${parteDom.titolo}` : ''} — corso n° ${c.id}`, '', `
    <div class="field"><label>La domanda *</label>
      <textarea id="td-testo" rows="2" maxlength="600">${esc(esistente?.testo || '')}</textarea></div>
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
    <button class="btn btn-primary" id="td-salva" style="margin-top:10px">${esistente ? 'Salva' : 'Aggiungi'}</button>`);

  const box = $('#td-box-opz');
  const disegnaCorrette = () => {
    const tipo = $('#td-tipo').value;
    const opzioni = $('#td-opzioni').value.split('\n').map((x) => x.trim()).filter(Boolean);
    const gia = esistente?.corrette || [];
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
    const nellaParte = t.domande.filter((x) => String(x.parte_id ?? '') === String(parteId ?? ''));
    const { error } = esistente
      ? await sb.from('s_test_domande').update(dati).eq('id', esistente.id)
      : await sb.from('s_test_domande').insert({
        ...dati, corso_id: c.id, parte_id: parteId,
        /* l'ordine conta dentro la sua verifica, non su tutto il corso */
        ordine: (nellaParte.length || 0) + 1,
      });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    /* si ripubblica quello che è cambiato: il modulo, o il test del corso */
    const pid = esistente?.parte_id ?? parteId;
    if (pid) {
      await sb.functions.invoke('questionari-pubblica', { body: { cosa: 'test_parte', parte_id: Number(pid) } });
    } else {
      await pubblica(c, true);
    }
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
