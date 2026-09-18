/* ============================================================================
   IL QUESTIONARIO DI GRADIMENTO DI UN EVENTO — nella scheda del corso
                                                              (18/09/2026)

   Un motore solo per corsi, convegni e conferenze di cantiere: un TRONCO di
   domande sempre uguali (è ciò che rende confrontabili gli anni) più le
   domande scritte per quell'evento, fino a cinque.

   LE DUE COSE DA NON CONFONDERE, e la ragione per cui questa scheda è fatta
   così:

   · le RISPOSTE sono anonime. Il sistema non sa e non può sapere chi ha
     compilato: qui si vedono solo i numeri (quante, media, voti bassi).

   · la SPUNTA «ha compilato» sta sull'iscritto e la mette la segreteria —
     in blocco con «Spunta tutti» (il gesto normale di un convegno da 120
     persone) o riga per riga. È una dichiarazione di una persona, non una
     constatazione della macchina, e resta scritto chi l'ha messa e quando.

   ⚠️ I due numeri non coincidono quasi mai: c'è chi compila su carta e la
   segreteria trascrive dopo, e chi è spuntato senza che la sua risposta sia
   distinguibile. Non è un errore da inseguire.
   ============================================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer } from './core.js';
import { scaricaPdf, pdfFoglioQuestionario, pdfQuestionarioCartaceo } from './corsi-doc.js';

export const MODELLI = {
  conferenza: 'Conferenza di cantiere — due domande',
  corso: 'Corso di formazione — tre domande',
  convegno: 'Convegno o progetto — tre domande',
};
const TIPI_DOM = { scala: 'voto da 1 a 5', scelta: 'una sola risposta', multipla: 'più risposte', testo: 'testo libero' };

/* il modello che si propone, dal tipo di evento */
const modelloProposto = (c) => c.quest_modello
  || (c.conferenza_id ? 'conferenza' : c.progetto_id ? 'convegno' : 'corso');

function quandoChiude(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const ora = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dataIt(d.toISOString().slice(0, 10))} alle ${ora}`;
}
const chiuso = (iso) => !!iso && new Date(iso) <= new Date();

/* ── i dati: domande dell'evento, riepilogo, link ── */
export async function datiQuest(c) {
  const [{ data: domande }, { data: riep }, { data: link }] = await Promise.all([
    sb.from('s_quest_domande').select('*').eq('corso_id', c.id).order('ordine').order('id'),
    sb.rpc('quest_riepilogo', { p_corso_id: c.id }),
    c.quest_codice ? sb.rpc('quest_link', { p_corso_id: c.id }) : Promise.resolve({ data: null }),
  ]);
  return { domande: domande || [], riep: riep || {}, link: link || null };
}

/* ── la cella della tabella iscritti: la spunta ── */
export function cellaSpunta(i) {
  if (!i.quest_compilato) {
    return `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--testo-soft);font-size:12px">
      <input type="checkbox" data-qz-spunta="${i.id}" style="width:15px;height:15px;accent-color:var(--arancio);margin:0">
      da spuntare</label>`;
  }
  const come = i.quest_fonte === 'carta' ? 'carta' : i.quest_fonte === 'blocco' ? 'tutti' : 'singolo';
  const cls = i.quest_fonte === 'carta' ? 'dt-scaduto' : 'dt-ok';
  return `<span class="dt-cella ${cls}" style="padding:1px 6px" title="${esc([come,
    i.quest_compilato_da, i.quest_compilato_il ? dataIt(i.quest_compilato_il) : ''].filter(Boolean).join(' · '))}">✓ ${come}</span>
    <a href="#" data-qz-togli="${i.id}" class="hint" style="margin-left:4px" title="Togli la spunta">✕</a>`;
}

/* ── la sezione nella scheda del corso ── */
export function sezioneQuest(c, q, iscritti) {
  const ammessi = (iscritti || []).filter((i) => !['annullato', 'sostituito'].includes(i.esito || ''));
  if (!c.quest_codice) {
    return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">⭐ Questionario di gradimento</h4>
    <p class="hint" style="margin:0 0 8px">Non è ancora aperto. Aprendolo nasce il <strong>codice</strong> da stampare
      sul foglio in coda al registro: le domande sono quelle del modello, più quelle che scrivi per questo evento.
      Risponde per <strong>48 ore dalla fine</strong>, e oltre i presenti più cinque le risposte si conservano ma
      restano fuori dalle medie.</p>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="margin:0;min-width:240px"><label>Modello</label>
        <select id="qz-modello">${Object.entries(MODELLI).map(([k, l]) =>
          `<option value="${k}" ${modelloProposto(c) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="btn btn-primary btn-sm" id="qz-apri">⭐ Apri il questionario</button>
    </div>`;
  }

  const r = q.riep || {};
  const l = q.link || {};
  const fine = l.chiuso_il || c.quest_chiuso_il;
  const eChiuso = chiuso(fine);
  const pubblicato = !!c.quest_pubblicato_il;

  const rigaDom = (d) => `<tr>
    <td>${esc(d.testo)}</td>
    <td>${esc(TIPI_DOM[d.tipo] || d.tipo)}${(d.opzioni || []).length ? `<br><span class="hint">${esc((d.opzioni || []).join(' · '))}</span>` : ''}</td>
    <td style="white-space:nowrap"><a href="#" data-qz-deldom="${d.id}">elimina</a></td>
  </tr>`;

  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">⭐ Questionario di gradimento
      <span class="hint" style="font-weight:400">— anonimo</span></h4>

    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span class="dt-cella" style="padding:2px 8px"><strong class="num">${esc(c.quest_codice)}</strong></span>
      <span class="dt-cella ${eChiuso ? 'dt-scaduto' : 'dt-ok'}" style="padding:2px 8px">
        ${eChiuso ? 'chiuso il' : 'risponde fino al'} ${quandoChiude(fine)}</span>
      <span class="dt-cella" style="padding:2px 8px">tetto ${c.quest_tetto ?? '—'}</span>
      <span class="dt-cella ${pubblicato ? 'dt-ok' : 'dt-scaduto'}" style="padding:2px 8px"
        title="${esc(c.quest_pubblica_esito || '')}">${pubblicato ? 'sul portale' : 'non ancora sul portale'}</span>
    </div>

    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Iscritti</th><th>Spuntati</th><th>Risposte</th><th>di cui su carta</th><th>Utilità</th><th>Voti bassi</th><th>Fuori conteggio</th></tr></thead>
      <tbody><tr>
        <td class="num">${r.iscritti ?? ammessi.length}</td>
        <td class="num">${r.spuntati ?? 0}</td>
        <td class="num"><strong>${r.raccolte ?? 0}</strong></td>
        <td class="num">${r.su_carta ?? 0}</td>
        <td class="num">${r.utilita != null ? r.utilita : '—'}</td>
        <td class="num" style="color:${(r.voti_bassi ?? 0) > 0 ? 'var(--out)' : 'inherit'}">${r.voti_bassi ?? 0}</td>
        <td class="num">${r.fuori ?? 0}</td>
      </tr></tbody>
    </table></div>
    <p class="hint" style="margin:6px 0 10px">Le risposte sono <strong>anonime</strong>: il sistema non sa chi ha
      compilato. La spunta sull'iscritto la metti tu — in blocco o riga per riga — ed è quella che apre la strada
      all'attestato. ⚠️ I due numeri non coincidono quasi mai, e non è un errore: chi compila su carta entra nelle
      risposte solo quando lo trascrivi.</p>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="qz-foglio">📄 Foglio col QR (PDF)</button>
      <button class="btn btn-ghost btn-sm" id="qz-cartaceo">🖨 Questionario da stampare</button>
      <button class="btn btn-ghost btn-sm" id="qz-carta">✍ Registra un cartaceo</button>
      <button class="btn btn-ghost btn-sm" id="qz-pubblica">${pubblicato ? '↻ Ripubblica sul portale' : '🌐 Pubblica sul portale'}</button>
      <button class="btn btn-ghost btn-sm" id="qz-spunta-tutti">✓ Spunta tutti (${ammessi.length})</button>
      <a class="btn btn-ghost btn-sm" href="${esc(l.link || '#')}" target="_blank" rel="noopener">👁 Apri come chi risponde</a>
    </div>

    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Domande di questo evento <span class="hint">(oltre al tronco: ${q.domande.length} su 5)</span></th><th>Tipo</th><th></th></tr></thead>
      <tbody>${q.domande.map(rigaDom).join('') || '<tr><td colspan="3" class="empty">Solo le domande del tronco comune.</td></tr>'}</tbody>
    </table></div>
    <button class="btn btn-ghost btn-sm" id="qz-adddom" style="margin-top:6px"${q.domande.length >= 5 ? ' disabled title="Cinque è il massimo: oltre, nessuno arriva in fondo"' : ''}>+ Domanda di questo evento</button>`;
}

/* ── gli eventi ── */
export function collegaQuest(c, q, iscritti, ricarica) {
  const body = $('#drawer-body');

  const apri = body.querySelector('#qz-apri');
  if (apri) {
    apri.addEventListener('click', async (ev) => {
      attendi(ev.currentTarget, true);
      const { data, error } = await sb.rpc('quest_apri', {
        p_corso_id: c.id, p_modello: $('#qz-modello').value, p_ore: 48, p_tetto: null,
      });
      attendi(ev.currentTarget, false);
      if (error) return toast(error.message, 'err');
      const r = Array.isArray(data) ? data[0] : data;
      toast(`Questionario aperto: codice ${r?.codice}.`, 'ok');
      await pubblica(c, true);
      ricarica();
    });
    return;   // gli altri bottoni non ci sono ancora
  }

  body.querySelector('#qz-pubblica')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    await pubblica(c, false);
    attendi(ev.currentTarget, false);
    ricarica();
  });

  body.querySelector('#qz-foglio')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const byte = await pdfFoglioQuestionario(c, { ...q.link, domande: q.domande });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_questionario-QR_corso-${c.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    attendi(ev.currentTarget, false);
  });

  body.querySelector('#qz-cartaceo')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    try {
      const tronco = await domandeTronco(c);
      const byte = await pdfQuestionarioCartaceo(c, { ...q.link, domande: [...tronco, ...q.domande] });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_questionario-cartaceo_corso-${c.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    attendi(ev.currentTarget, false);
  });

  body.querySelector('#qz-carta')?.addEventListener('click', async () => formCartaceo(c, q, ricarica));

  body.querySelector('#qz-spunta-tutti')?.addEventListener('click', async (ev) => {
    if (!confirm('Spunto tutti gli iscritti ammessi come «questionario compilato»?\n\n'
      + 'È una tua dichiarazione: resta scritto che l\'hai messa tu, oggi. Poi puoi togliere chi manca.')) return;
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.rpc('quest_spunta', { p_corso_id: c.id, p_iscritti: null, p_valore: true, p_fonte: null });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast(`Spuntati ${data}.`, 'ok');
    ricarica();
  });

  body.querySelectorAll('[data-qz-spunta]').forEach((cb) => cb.addEventListener('change', async () => {
    const { error } = await sb.rpc('quest_spunta', {
      p_corso_id: c.id, p_iscritti: [Number(cb.dataset.qzSpunta)], p_valore: true, p_fonte: null });
    if (error) return toast(error.message, 'err');
    ricarica();
  }));

  body.querySelectorAll('[data-qz-togli]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const { error } = await sb.rpc('quest_spunta', {
      p_corso_id: c.id, p_iscritti: [Number(a.dataset.qzTogli)], p_valore: false, p_fonte: null });
    if (error) return toast(error.message, 'err');
    ricarica();
  }));

  body.querySelector('#qz-adddom')?.addEventListener('click', () => formDomanda(c, q, ricarica));

  body.querySelectorAll('[data-qz-deldom]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Elimino la domanda? Le risposte già date restano, e resteranno senza la domanda.')) return;
    const { error } = await sb.from('s_quest_domande').delete().eq('id', Number(a.dataset.qzDeldom));
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  }));
}

/* le domande del tronco, per il foglio cartaceo */
async function domandeTronco(c) {
  const { data } = await sb.from('s_quest_domande').select('*')
    .eq('modello', c.quest_modello || modelloProposto(c)).order('ordine');
  return data || [];
}

/* la copia sul portale: senza, il QR stampato non trova niente */
async function pubblica(c, silenziosa) {
  const { data, error } = await sb.functions.invoke('questionari-pubblica', { body: { corso_id: c.id } });
  if (error || data?.status !== 'ok') {
    const m = data?.esito || data?.saltati?.[0]?.motivo || error?.message || 'non pubblicato';
    toast(`Il questionario NON è sul portale: ${m}`, 'err');
    return false;
  }
  if (!silenziosa) toast('Domande pubblicate sul portale.', 'ok');
  return true;
}

/* ── una domanda di questo evento ── */
function formDomanda(c, q, ricarica) {
  apriDrawer(`Domanda — corso n° ${c.id}`, '', `
    <div class="field"><label>La domanda *</label>
      <input id="qd-testo" maxlength="300" placeholder="Es. La vostra impresa registra già i mancati infortuni?"></div>
    <div class="field"><label>Tipo</label>
      <select id="qd-tipo">${Object.entries(TIPI_DOM).filter(([k]) => k !== 'scala').map(([k, l]) =>
        `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="field" id="qd-box-opz"><label>Risposte proposte — una per riga (da 2 a 8)</label>
      <textarea id="qd-opzioni" rows="4" placeholder="sì&#10;no&#10;non so"></textarea></div>
    <p class="hint">Il voto da 1 a 5 c'è già nel tronco comune e non si ripete.
      Oltre cinque domande proprie nessuno arriva in fondo: le risposte si fermano a metà.</p>
    <button class="btn btn-primary" id="qd-salva" style="margin-top:10px">Aggiungi</button>`);

  const box = $('#qd-box-opz');
  $('#qd-tipo').addEventListener('change', (e) => { box.style.display = e.target.value === 'testo' ? 'none' : ''; });

  $('#qd-salva').addEventListener('click', async (ev) => {
    const testo = $('#qd-testo').value.trim();
    const tipo = $('#qd-tipo').value;
    const opzioni = tipo === 'testo' ? []
      : $('#qd-opzioni').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!testo) return toast('Serve il testo della domanda.', 'err');
    if (tipo !== 'testo' && (opzioni.length < 2 || opzioni.length > 8)) {
      return toast('Una domanda a scelta vuole da 2 a 8 risposte proposte.', 'err');
    }
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_quest_domande').insert({
      corso_id: c.id, ordine: (q.domande.length || 0) + 1, testo, tipo, opzioni,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  });
}

/* ── trascrivere un questionario compilato su carta ── */
async function formCartaceo(c, q, ricarica) {
  const tronco = await domandeTronco(c);
  const tutte = [...tronco, ...q.domande];
  const campo = (d) => {
    if (d.tipo === 'scala') {
      return `<div class="field"><label>${esc(d.testo)}</label>
        <select data-qc="${d.id}"><option value="">—</option>
          ${[1, 2, 3, 4, 5].map((v) => `<option value="${v}">${v}</option>`).join('')}</select></div>`;
    }
    if (d.tipo === 'testo') {
      return `<div class="field"><label>${esc(d.testo)}</label><textarea data-qc="${d.id}" rows="2"></textarea></div>`;
    }
    return `<div class="field"><label>${esc(d.testo)} <span class="hint">${d.tipo === 'multipla' ? '(più risposte, separate da ;)' : ''}</span></label>
      <select data-qc="${d.id}" ${d.tipo === 'multipla' ? 'multiple size="4"' : ''}>
        ${d.tipo === 'multipla' ? '' : '<option value="">—</option>'}
        ${(d.opzioni || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
  };

  apriDrawer(`Questionario su carta — corso n° ${c.id}`, '', `
    <p class="hint" style="margin:0 0 10px">Trascrivi qui il foglio che il docente ha riportato. Entra come
      <strong>risposta su carta</strong> e resta scritto che l'hai inserita tu: nessun nome del compilante,
      come per quelle online.</p>
    ${tutte.map(campo).join('')}
    <button class="btn btn-primary" id="qc-salva" style="margin-top:10px">Registra</button>`);

  $('#qc-salva').addEventListener('click', async (ev) => {
    const risposte = {};
    let utilita = null;
    $('#drawer-body').querySelectorAll('[data-qc]').forEach((el) => {
      const d = tutte.find((x) => String(x.id) === el.dataset.qc);
      let v;
      if (el.multiple) v = [...el.selectedOptions].map((o) => o.value);
      else v = el.value.trim ? el.value.trim() : el.value;
      if (!v || (Array.isArray(v) && !v.length)) return;
      if (d.tipo === 'scala') { utilita = Number(v); risposte[el.dataset.qc] = Number(v); }
      else risposte[el.dataset.qc] = v;
    });
    if (!Object.keys(risposte).length) return toast('Non hai trascritto nessuna risposta.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_quest_risposte').insert({
      corso_id: c.id, fonte: 'carta', utilita, risposte, inserita_da: state.email,
      riferimento_esito: 'trascritto da carta',
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Questionario cartaceo registrato.', 'ok');
    ricarica();
  });
}
