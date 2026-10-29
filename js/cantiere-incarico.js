/* ============================================================
   IL CANTIERE DELL'INCARICO (29/10/2026, deciso dall'utente).
   «L'incarico è sempre puntuale»: una richiesta è per un cantiere,
   e la segreteria, quando apre l'incarico, sceglie dall'anagrafica
   il cantiere e — se è un complesso a lotti — un lotto solo oppure
   tutti i lotti (i cantieri del tram, dove i lotti si spostano: la
   serie si chiude comunque alla decima visita). La scelta sta sulla
   pratica e passa all'incarico; nel gestionale il tecnico sceglie il
   cantiere e l'incarico si aggancia da solo. Senza cantiere l'incarico
   di una richiesta di visita non si crea.
   Il complesso è quello di lotti_del_cantiere (la stessa funzione del
   gestionale), quindi «tutti i lotti» vale anche per i lotti creati
   dopo. La regola vive nel database: incarico_vale_per_cantiere.
   ============================================================ */

import { sb, state, $, esc, toast, attendi } from './core.js';
import { comuneAnagrafica, testoRicerca, separaCivico, etichettaCantiere, sceltaDaSalvare } from './cantiere-incarico-regole.js';

const COLONNE = 'cantiere_id, cantiere_etichetta, cantiere_indirizzo, cantiere_civico, comune_nome, lotto, lotto_di, cantiere_cnce, cantiere_chiuso';

/* il riquadro nella scheda della pratica */
export function sezioneHtml() {
  return `
    <div id="ci-box" style="border:1px solid var(--bordo);border-radius:8px;padding:10px 12px;margin:12px 0">
      <h4 style="margin:0 0 6px">Cantiere dell'incarico</h4>
      <div id="ci-attuale" class="hint">Un istante…</div>
      <div id="ci-scelta" style="display:none;margin-top:8px">
        <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:6px;align-items:end">
          <div class="field" style="margin:0"><label>Indirizzo, etichetta o CNCE</label><input id="ci-q"></div>
          <div class="field" style="margin:0"><label>Comune</label><input id="ci-com"></div>
          <button class="btn btn-ghost" id="ci-cerca" data-aiuto="Cerca il cantiere nell'anagrafica del gestionale.">🔎 Cerca</button>
        </div>
        <div id="ci-esiti" style="margin-top:8px"></div>
        <div id="ci-lotti" style="margin-top:8px"></div>
        <div id="ci-nuovo" style="margin-top:8px"></div>
      </div>
    </div>`;
}

/* collega il riquadro: p = la pratica, tabella = dove sta la pratica, dopo = che cosa rifare dopo il salvataggio */
export async function collega(p, { tabella = 's_visite_richieste', dopo } = {}) {
  const cc = Array.isArray(p.cantieri) ? p.cantieri : [];
  const modulo = cc[0] || {};
  let cercato = null;   // il cantiere scelto dall'elenco
  let lotti = [];       // il suo complesso

  const apriScelta = () => {
    $('#ci-scelta').style.display = '';
    if (!$('#ci-q').value) $('#ci-q').value = separaCivico(modulo.indirizzo).indirizzo.replace(/^(VIA|VIALE|PIAZZA|CORSO|LARGO|STRADA)\s+/i, '');
    if (!$('#ci-com').value) $('#ci-com').value = comuneAnagrafica(modulo.comune);
  };

  /* che cosa è scelto adesso */
  if (p.cantiere_id) {
    const [{ data: c, error }, { data: ll }] = await Promise.all([
      sb.from('cantieri').select(COLONNE).eq('cantiere_id', p.cantiere_id).maybeSingle(),
      sb.rpc('lotti_del_cantiere', { p_cantiere_id: p.cantiere_id }),
    ]);
    if (error) $('#ci-attuale').innerHTML = `<span style="color:#c0392b">Non sono riuscito a leggere il cantiere scelto (${esc(error.message)}).</span>`;
    else $('#ci-attuale').innerHTML = `<span class="dt-cella dt-ok" style="padding:2px 8px">✓</span> <strong>${esc(etichettaCantiere(c) || p.cantiere_id)}</strong>`
      + (p.tutti_i_lotti ? ` — <strong>tutti i lotti del complesso</strong> (${(ll || []).length} oggi, e quelli che si aggiungeranno)` : (ll || []).length > 1 ? ' — solo questo lotto' : '')
      + (c?.cantiere_chiuso ? ' <span style="color:#c0392b">— il cantiere risulta chiuso</span>' : '')
      + ' <button class="btn btn-ghost btn-sm" id="ci-cambia">Cambia</button>';
    $('#ci-cambia')?.addEventListener('click', apriScelta);
  } else {
    $('#ci-attuale').innerHTML = '<span style="color:#c0392b;font-weight:600">Non ancora scelto.</span> '
      + 'Senza il cantiere l\'incarico non si crea: il tecnico lo ritrova scegliendo il cantiere nel verbale.';
    apriScelta();
  }

  const cerca = async () => {
    const t = testoRicerca($('#ci-q').value);
    const com = testoRicerca($('#ci-com').value);
    if (!t && !com) { toast('Scrivi almeno due lettere dell\'indirizzo o del comune.', 'err'); return; }
    $('#ci-esiti').innerHTML = '<p class="hint">Un istante…</p>';
    $('#ci-lotti').innerHTML = '';
    let q = sb.from('cantieri').select(COLONNE).or('elimina.is.null,elimina.eq.0').limit(40);
    if (t) {
      const pat = '*' + t.split(' ').join('*') + '*';
      q = q.or(`cantiere_indirizzo.ilike.${pat},cantiere_etichetta.ilike.${pat},cantiere_cnce.ilike.${pat}`);
    }
    if (com) q = q.ilike('comune_nome', `%${com}%`);
    const { data, error } = await q.order('cantiere_indirizzo');
    if (error) { $('#ci-esiti').innerHTML = `<p style="color:#c0392b">Non sono riuscito a leggere l'anagrafica dei cantieri: ${esc(error.message)}</p>`; return; }
    const righe = data || [];
    $('#ci-esiti').innerHTML = (righe.length
      ? `<div class="hint" style="margin-bottom:4px">${righe.length === 40 ? 'Primi 40 risultati: restringi la ricerca se non lo vedi.' : `${righe.length} cantieri trovati.`}</div>`
        + righe.map((c) => `<label style="display:block;padding:3px 0;cursor:pointer">
            <input type="radio" name="ci-c" value="${esc(c.cantiere_id)}"> ${esc(etichettaCantiere(c))}
            ${c.cantiere_cnce ? `<span class="hint">${esc(c.cantiere_cnce)}</span>` : ''}${c.cantiere_chiuso ? ' <span class="hint">(chiuso)</span>' : ''}</label>`).join('')
      : '<p class="hint">Nessun cantiere trovato con questi dati.</p>')
      + '<button class="btn btn-ghost btn-sm" id="ci-crea-apri" style="margin-top:6px" data-aiuto="Crea la scheda del cantiere con indirizzo, civico e comune: il resto lo completa il tecnico nel verbale.">➕ Non c\'è: crea la scheda</button>';
    $('#ci-esiti').querySelectorAll('input[name=ci-c]').forEach((r) => r.addEventListener('change', () => scegli(r.value)));
    $('#ci-crea-apri').addEventListener('click', formNuovo);
  };

  /* scelto un cantiere: se fa parte di un complesso a lotti, si sceglie un lotto o tutti */
  const scegli = async (id) => {
    cercato = id;
    $('#ci-lotti').innerHTML = '<p class="hint">Un istante…</p>';
    const { data, error } = await sb.rpc('lotti_del_cantiere', { p_cantiere_id: id });
    if (error) { $('#ci-lotti').innerHTML = `<p style="color:#c0392b">Non sono riuscito a leggere i lotti: ${esc(error.message)}</p>`; return; }
    lotti = data || [];
    const conLotti = lotti.length > 1;
    $('#ci-lotti').innerHTML = (conLotti ? `
      <div class="hint" style="margin-bottom:4px">Questo cantiere fa parte di un complesso di ${lotti.length} schede: scegli il lotto della richiesta, oppure tutti.</div>
      ${lotti.map((l) => `<label style="display:block;padding:3px 0;cursor:pointer">
        <input type="radio" name="ci-l" value="${esc(l.cantiere_id)}" ${l.cantiere_id === id ? 'checked' : ''}>
        ${esc(etichettaCantiere(l))} <span class="hint">— ${l.visite || 0} visite${l.ultima_impresa ? `, ultima: ${esc(l.ultima_impresa)}` : ''}</span></label>`).join('')}
      <label style="display:block;padding:3px 0;cursor:pointer;font-weight:600">
        <input type="radio" name="ci-l" value="tutti"> Tutti i lotti del complesso
        <span class="hint" style="font-weight:400">— anche quelli che si aggiungeranno; la serie si chiude comunque alle visite previste</span></label>`
      : '<div class="hint" style="margin-bottom:4px">Cantiere senza lotti.</div>') + `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        <button class="btn btn-primary btn-sm" id="ci-usa">✔ Usa per l'incarico</button>
        <button class="btn btn-ghost btn-sm" id="ci-lotto-nuovo" data-aiuto="Aggiunge un lotto a questo complesso, come «🧩 Ha più lotti» nel verbale: la scheda nuova è una copia di quella scelta.">🧩 Nuovo lotto</button>
      </div>`;
    $('#ci-usa').addEventListener('click', (ev) => salva(ev.currentTarget));
    $('#ci-lotto-nuovo').addEventListener('click', nuovoLotto);
  };

  const salva = async (btn) => {
    const scelta = $('#ci-lotti').querySelector('input[name=ci-l]:checked')?.value || cercato;
    const v = sceltaDaSalvare({ cercato, lotti, scelta });
    if (!v) { toast('Scegli prima il cantiere.', 'err'); return; }
    attendi(btn, true);
    const { error } = await sb.from(tabella).update({ ...v, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) { attendi(btn, false); toast('Cantiere non salvato sulla pratica: ' + error.message, 'err'); return; }
    if (p.incarico_id) {
      const { error: e2 } = await sb.from('incarichi').update(v).eq('id', p.incarico_id);
      if (e2) { attendi(btn, false); toast(`Salvato sulla pratica, ma NON sull'incarico n° ${p.incarico_id}: ${e2.message}`, 'err'); return; }
    }
    attendi(btn, false);
    Object.assign(p, v);
    toast(p.incarico_id ? `Cantiere salvato sulla pratica e sull'incarico n° ${p.incarico_id}.` : 'Cantiere salvato: passerà all\'incarico quando si crea.', 'ok');
    if (dopo) await dopo();
  };

  const nuovoLotto = async () => {
    const base = lotti.find((l) => l.cantiere_id === ($('#ci-lotti').querySelector('input[name=ci-l]:checked')?.value)) || lotti.find((l) => l.cantiere_id === cercato);
    let qui = null;
    if (!base?.lotto) {
      qui = prompt('La scheda scelta non ha ancora un lotto. Come si chiama il suo lotto? (per esempio 1)', '1');
      if (qui == null) return;
    }
    const nuovo = prompt('Nome del lotto nuovo (per esempio 2, B, Palazzina C):');
    if (!nuovo) return;
    const { data, error } = await sb.rpc('crea_lotto_cantiere', { p_cantiere_id: base?.cantiere_id || cercato, p_lotto_qui: qui, p_lotto_nuovo: nuovo });
    if (error) { toast('Lotto non creato: ' + error.message, 'err'); return; }
    toast(`Lotto «${nuovo}» creato.`, 'ok');
    await scegli(data?.cantiere_id || cercato);
  };

  const formNuovo = () => {
    const s = separaCivico(modulo.indirizzo);
    $('#ci-nuovo').innerHTML = `
      <div style="display:grid;grid-template-columns:2fr 1fr 1.5fr;gap:6px">
        <div class="field" style="margin:0"><label>Indirizzo *</label><input id="ci-n-ind" value="${esc(s.indirizzo)}"></div>
        <div class="field" style="margin:0"><label>Civico * (SNC se manca)</label><input id="ci-n-civ" value="${esc(s.civico)}"></div>
        <div class="field" style="margin:0"><label>Comune *</label><input id="ci-n-com" value="${esc(comuneAnagrafica(modulo.comune))}"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="ci-n-salva" style="margin-top:6px">Crea la scheda e usala</button>`;
    $('#ci-n-salva').addEventListener('click', async (ev) => {
      const ind = $('#ci-n-ind').value.trim().toUpperCase();
      const civ = $('#ci-n-civ').value.trim().toUpperCase() || 'SNC';
      const com = comuneAnagrafica($('#ci-n-com').value);
      if (ind.length < 2 || !com) { toast('Servono indirizzo e comune.', 'err'); return; }
      /* prima di crearne uno si guarda se c'è già, a maiuscole e spazi ignorati */
      const { data: gia, error: eG } = await sb.from('cantieri').select(COLONNE)
        .ilike('cantiere_indirizzo', ind).ilike('cantiere_civico', civ).ilike('comune_nome', com)
        .or('elimina.is.null,elimina.eq.0').limit(5);
      if (eG) { toast('Non sono riuscito a controllare i doppioni: ' + eG.message, 'err'); return; }
      if ((gia || []).length) {
        toast('Questo cantiere c\'è già nell\'anagrafica: lo scelgo invece di crearne un doppione.', 'ok');
        $('#ci-nuovo').innerHTML = '';
        await scegli(gia[0].cantiere_id);
        return;
      }
      const btn = ev.currentTarget;
      attendi(btn, true);
      const id = crypto.randomUUID();
      const { error } = await sb.from('cantieri').insert({ cantiere_id: id, cantiere_indirizzo: ind, cantiere_civico: civ, comune_nome: com, elimina: 0 });
      attendi(btn, false);
      if (error) { toast('Scheda non creata: ' + error.message, 'err'); return; }
      toast('Scheda del cantiere creata: il tecnico la completa nel verbale.', 'ok');
      $('#ci-nuovo').innerHTML = '';
      await scegli(id);
    });
  };

  $('#ci-cerca').addEventListener('click', cerca);
  $('#ci-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') cerca(); });
  $('#ci-com').addEventListener('keydown', (e) => { if (e.key === 'Enter') cerca(); });
}
