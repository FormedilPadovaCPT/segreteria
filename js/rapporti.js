/* ============================================================
   Rapporti persona-impresa, dalla scheda impresa (24/09/2026).

   RAPPORTO (persone_imprese) = a chi appartiene la persona e da
   quando a quando: dipendente, apprendista, tirocinante, titolare,
   socio. NOMINA (s_nomine) = che funzione svolge per l'impresa:
   RSPP, RLS, preposto, capocantiere...

   Decisioni dell'utente:
     · «Dipendente» e simili sono RAPPORTI, non nomine;
     · le funzioni interne (preposto, capocantiere, RLS, addetti
       alle emergenze...) propongono il rapporto «dipendente» con
       la spunta già messa; RSPP e figure esterne no.
   Quali ruoli sono l'una o l'altra cosa lo dice il database
   (s_tipi_rapporto, s_ruoli.propone_rapporto), non questo file.

   La registrazione è una funzione sola, s_registra_persona_impresa:
   persona (nuova o scelta), rapporto e nomine insieme, tutto o
   niente, senza doppioni (CF, rapporto in corso, nomina in corso).
   ============================================================ */

import { sb, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer } from './core.js';

export const QUALIFICHE = {
  operaio: 'Operaio', impiegato_tecnico: 'Impiegato tecnico',
  impiegato_amministrativo: 'Impiegato amministrativo', dirigente: 'Dirigente',
  apprendista: 'Apprendista', altro: 'Altro',
};

/* Nel riquadro delle funzioni, oltre alle funzioni interne, le tre
   nomine che capita di registrare insieme alla persona. Le altre
   (medico, coordinatori...) restano nella maschera nomine. */
const FUNZIONI_ESTERNE = [1, 47, 46];   // RSPP, ASPP, LEGALE RAPPRESENTANTE

let tipi = [];
let ruoli = [];

export async function caricaTipiERuoli() {
  if (tipi.length && ruoli.length) return { tipi, ruoli };
  const [{ data: t, error: e1 }, { data: r, error: e2 }] = await Promise.all([
    sb.from('s_tipi_rapporto').select('codice, etichetta, ruolo_id, ordine').order('ordine'),
    sb.from('s_ruoli').select('id_ruolo, ruolo, propone_rapporto').order('ruolo'),
  ]);
  if (e1 || e2) throw new Error('Non sono riuscito a leggere tipi di rapporto e ruoli: ' + (e1 || e2).message);
  tipi = t || [];
  ruoli = r || [];
  return { tipi, ruoli };
}

export const etichettaTipo = (codice) =>
  tipi.find((t) => t.codice === codice)?.etichetta || (codice ? String(codice).replace(/_/g, ' ') : '');

const opzioniTipi = (sel) => tipi.map((t) =>
  `<option value="${esc(t.codice)}" ${t.codice === sel ? 'selected' : ''}>${esc(t.etichetta)}</option>`).join('');
const opzioniQualifiche = (sel) => '<option value="">—</option>' + Object.entries(QUALIFICHE).map(([k, l]) =>
  `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');

/* ══════════ aggiungere una persona all'impresa ══════════ */
export async function aggiungiPersona(impresa, dopo) {
  try { await caricaTipiERuoli(); } catch (e) { return toast(e.message, 'err'); }
  const funzioni = [
    ...ruoli.filter((r) => r.propone_rapporto),
    ...FUNZIONI_ESTERNE.map((id) => ruoli.find((r) => r.id_ruolo === id)).filter(Boolean),
  ];

  apriDrawer(`Aggiungi persona — ${impresa.impresa_nome || impresa.impresa_id}`, '', `
    <div class="sez">
      <h3>Persona</h3>
      <div class="field"><label>Cerca in anagrafica</label>
        <input type="text" id="ap-cerca" placeholder="Cognome o codice fiscale (almeno 3 caratteri)…">
        <div id="ap-esiti" style="margin-top:4px"></div>
        <input type="hidden" id="ap-pid"></div>
      <div id="ap-scelta" class="hint" style="margin:4px 0"></div>
      <div id="ap-nuova">
        <p class="hint" style="margin:6px 0 4px">Non c'è? Scrivila qui: con il codice fiscale non si crea mai un doppione.</p>
        <div class="grid-4">
          <div class="field"><label>Titolo</label><input type="text" id="ap-titolo" placeholder="Geom., Ing.…"></div>
          <div class="field"><label>Cognome *</label><input type="text" id="ap-cognome"></div>
          <div class="field"><label>Nome *</label><input type="text" id="ap-nome"></div>
          <div class="field"><label>Codice fiscale</label><input type="text" id="ap-cf" maxlength="16" style="text-transform:uppercase"></div>
          <div class="field span2"><label>Email</label><input type="text" id="ap-email"></div>
          <div class="field span2"><label>Telefono</label><input type="text" id="ap-tel"></div>
        </div>
      </div>
    </div>

    <div class="sez">
      <h3><label style="display:flex;gap:6px;align-items:center;margin:0;cursor:pointer">
        <input type="checkbox" id="ap-con-rapporto" checked> Rapporto con l'impresa</label></h3>
      <div id="ap-rapporto" class="grid-4">
        <div class="field"><label>Tipo</label><select id="ap-tipo">${opzioniTipi('dipendente')}</select></div>
        <div class="field"><label>Qualifica</label><select id="ap-qualifica">${opzioniQualifiche('')}</select></div>
        <div class="field"><label>Mansione</label><input type="text" id="ap-mansione" placeholder="muratore, carpentiere…"></div>
        <div class="field"><label>Dal (assunzione)</label><input type="date" id="ap-dal"></div>
        <div class="field span4" style="grid-column:1/-1"><label>Note</label><input type="text" id="ap-note-rap"
          placeholder="Da dove lo sappiamo: comunicazione dell'impresa, verbale, telefonata…"></div>
      </div>
      <p class="hint" style="margin:4px 0 0">Il rapporto dice <strong>a chi appartiene</strong> la persona e da quando.
        Per una figura esterna (RSPP o consulente di uno studio) scegli «Figura esterna», o togli la spunta.</p>
    </div>

    <div class="sez">
      <h3>Funzioni (diventano nomine)</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 12px">
        ${funzioni.map((r) => `
          <label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer">
            <input type="checkbox" class="ap-fun" value="${r.id_ruolo}" data-interna="${r.propone_rapporto ? 1 : 0}">
            ${esc(r.ruolo)}${r.propone_rapporto ? '' : ' <span class="hint">(anche esterno)</span>'}</label>`).join('')}
      </div>
      <div class="field" style="max-width:200px;margin-top:6px"><label>Nomine dal</label><input type="date" id="ap-nomine-dal"></div>
      <p class="hint" style="margin:4px 0 0">Per altri ruoli (medico competente, coordinatori…) usa «+ Nuova nomina».
        Se la data non è nota lasciala vuota: meglio un campo vuoto che una data indovinata.</p>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-primary" id="ap-salva">Registra</button>
    </div>`);

  const scegli = (p) => {
    $('#ap-pid').value = p ? p.persona_id : '';
    $('#ap-esiti').innerHTML = '';
    $('#ap-nuova').style.display = p ? 'none' : '';
    $('#ap-scelta').innerHTML = p
      ? `Scelta: <strong>${esc([p.cognome, p.titolo, p.nome].filter(Boolean).join(' '))}</strong>${p.cf ? ' · ' + esc(p.cf) : ''}
         <button type="button" class="btn btn-ghost btn-sm" id="ap-annulla" style="margin-left:6px">Cambia</button>`
      : '';
    $('#ap-annulla')?.addEventListener('click', () => { $('#ap-cerca').value = ''; scegli(null); });
  };

  /* ricerca: cognome, nome o codice fiscale */
  $('#ap-cerca').addEventListener('input', (e) => {
    clearTimeout(aggiungiPersona._t);
    aggiungiPersona._t = setTimeout(async () => {
      const t = e.target.value.trim().replace(/[,()]/g, ' ');
      if (t.length < 3) return ($('#ap-esiti').innerHTML = '');
      const { data, error } = await sb.from('persone')
        .select('persona_id, titolo, cognome, nome, cf, data_nascita')
        .eq('elimina', 0)
        .or(`cognome.ilike.%${t}%,nome.ilike.%${t}%,cf.ilike.${t}%`).order('cognome').limit(10);
      if (error) return ($('#ap-esiti').innerHTML = `<span class="hint">Non sono riuscito a leggere l'anagrafica: ${esc(error.message)}</span>`);
      $('#ap-esiti').innerHTML = (data || []).length
        ? data.map((p, i) => `<button type="button" class="chip" data-i="${i}">${esc([p.cognome, p.nome].filter(Boolean).join(' '))}${p.cf ? ' · ' + esc(p.cf) : ''}</button>`).join(' ')
        : '<span class="hint">Nessuno con questo nome: compila i campi qui sotto.</span>';
      $('#ap-esiti').querySelectorAll('[data-i]').forEach((b) =>
        b.addEventListener('click', () => scegli(data[Number(b.dataset.i)])));
    }, 350);
  });

  /* rapporto acceso/spento; una funzione interna lo riaccende (spunta già messa, si toglie) */
  const aggiornaRapporto = () => {
    $('#ap-rapporto').style.opacity = $('#ap-con-rapporto').checked ? '1' : '.45';
    $('#ap-rapporto').querySelectorAll('input,select').forEach((el) => { el.disabled = !$('#ap-con-rapporto').checked; });
  };
  $('#ap-con-rapporto').addEventListener('change', aggiornaRapporto);
  document.querySelectorAll('.ap-fun').forEach((c) => c.addEventListener('change', () => {
    if (c.checked && c.dataset.interna === '1' && !$('#ap-con-rapporto').checked) {
      $('#ap-con-rapporto').checked = true;
      aggiornaRapporto();
      toast('Funzione interna: ho riattivato il rapporto «dipendente». Togli la spunta se non lo è.', '');
    }
  }));

  $('#ap-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const pid = $('#ap-pid').value || null;
    const persona = pid ? null : {
      titolo: $('#ap-titolo').value.trim(), cognome: $('#ap-cognome').value.trim(), nome: $('#ap-nome').value.trim(),
      cf: $('#ap-cf').value.trim().toUpperCase(), email: $('#ap-email').value.trim(), telefono: $('#ap-tel').value.trim(),
    };
    if (!pid && !persona.cognome) return toast('Scegli la persona dall\'anagrafica o scrivi almeno il cognome.', 'err');
    if (persona?.cf && !/^[A-Z0-9]{16}$/.test(persona.cf)) return toast('Il codice fiscale deve avere 16 caratteri.', 'err');
    const conRapporto = $('#ap-con-rapporto').checked;
    const nomine = [...document.querySelectorAll('.ap-fun:checked')].map((c) => ({
      ruolo_id: Number(c.value), data_inizio: $('#ap-nomine-dal').value || null,
    }));
    if (!conRapporto && !nomine.length) return toast('Niente da registrare: serve il rapporto o almeno una funzione.', 'err');

    attendi(btn, true, 'Registro…');
    const { data, error } = await sb.rpc('s_registra_persona_impresa', { p: {
      impresa_id: impresa.impresa_id,
      persona_id: pid, persona,
      rapporto: conRapporto ? {
        tipo: $('#ap-tipo').value, qualifica: $('#ap-qualifica').value || null,
        mansione: $('#ap-mansione').value.trim() || null, data_assunzione: $('#ap-dal').value || null,
        note: $('#ap-note-rap').value.trim() || null,
      } : null,
      nomine,
    } });
    attendi(btn, false);
    if (error) return toast('Registrazione non riuscita: ' + error.message, 'err');

    /* si dice che cosa è successo davvero, contato */
    const parti = [];
    parti.push(data.persona === 'creata' ? 'persona creata'
      : data.persona === 'trovata_dal_cf' ? 'persona già in anagrafica (stesso codice fiscale): usata quella' : 'persona agganciata');
    if (data.rapporto === 'creato') parti.push('rapporto aperto');
    if (data.rapporto === 'gia_in_corso') parti.push('aveva già un rapporto in corso con l\'impresa: non ne ho aperto un secondo');
    if (data.nomine_create) parti.push(`${data.nomine_create} ${data.nomine_create === 1 ? 'nomina registrata' : 'nomine registrate'}`);
    if (data.nomine_gia_in_corso) parti.push(`${data.nomine_gia_in_corso} già in corso`);
    toast(parti.join(' · ') + '.', 'ok');
    chiudiDrawer();
    if (dopo) dopo();
  });
}

/* ══════════ modificare o cessare un rapporto ══════════ */
export async function apriRapporto(r, dopo) {
  try { await caricaTipiERuoli(); } catch (e) { return toast(e.message, 'err'); }
  /* un tipo storico dell'import (es. «rspp») non è fra i tipi: si mostra
     com'è, così chi lo corregge vede da dove parte */
  const storico = r.tipo_rapporto && !tipi.some((t) => t.codice === r.tipo_rapporto);
  const cessato = r.data_cessazione && r.data_cessazione <= oggiIso();

  apriDrawer(`Rapporto — ${[r.titolo, r.nominativo].filter(Boolean).join(' ')}`, '', `
    <div class="grid-4">
      <div class="field"><label>Tipo</label><select id="rp-tipo">
        ${storico ? `<option value="${esc(r.tipo_rapporto)}" selected>${esc(r.tipo_rapporto)} (dall'import Access)</option>` : ''}
        ${opzioniTipi(r.tipo_rapporto)}</select></div>
      <div class="field"><label>Qualifica</label><select id="rp-qualifica">${opzioniQualifiche(r.qualifica || '')}</select></div>
      <div class="field"><label>Mansione</label><input type="text" id="rp-mansione" value="${esc(r.mansione || '')}"></div>
      <div class="field"><label>Dal (assunzione)</label><input type="date" id="rp-dal" value="${r.data_assunzione || ''}"></div>
      <div class="field" style="grid-column:1/-1"><label>Note</label><input type="text" id="rp-note" value="${esc(r.note || '')}"></div>
    </div>
    ${storico ? '<p class="hint" style="margin:6px 0 0">Il tipo viene dall\'import di Access, dove il ruolo finiva qui. Il ruolo vero sta nelle nomine: qui scegli il tipo di rapporto.</p>' : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-primary" id="rp-salva">Salva</button>
    </div>

    <div class="sez" style="margin-top:12px">
      <h3>${cessato ? `Cessato il ${dataIt(r.data_cessazione)}` : 'Cessazione'}</h3>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field"><label>Data di cessazione</label>
          <input type="date" id="rp-al" value="${r.data_cessazione || oggiIso()}"></div>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:6px">
          <input type="checkbox" id="rp-chiudi-nomine" checked> chiudi anche le sue nomine per questa impresa</label>
        <button class="btn btn-ghost" id="rp-cessa">${cessato ? 'Correggi la data' : 'Cessa il rapporto'}</button>
      </div>
      <p class="hint" style="margin:4px 0 0">Il rapporto non si cancella: si chiude con la data, e ne resta la storia.
        Se la persona passa a un'altra impresa, si cessa qui e si aggiunge là.</p>
    </div>`);

  $('#rp-salva').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true);
    const { error } = await sb.from('persone_imprese').update({
      tipo_rapporto: $('#rp-tipo').value,
      qualifica: $('#rp-qualifica').value || null,
      mansione: $('#rp-mansione').value.trim() || null,
      data_assunzione: $('#rp-dal').value || null,
      note: $('#rp-note').value.trim() || null,
    }).eq('id', r.id);
    attendi(btn, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Rapporto aggiornato.', 'ok');
    chiudiDrawer();
    if (dopo) dopo();
  });

  $('#rp-cessa').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const al = $('#rp-al').value;
    if (!al) return toast('Scrivi la data di cessazione.', 'err');
    const chiudi = $('#rp-chiudi-nomine').checked;
    if (!confirm(`Cesso il rapporto al ${dataIt(al)}${chiudi ? ' e chiudo alla stessa data le sue nomine in corso per questa impresa' : ''}?`)) return;
    attendi(btn, true);
    const { data, error } = await sb.rpc('s_rapporto_cessa', { p_id: r.id, p_data: al, p_chiudi_nomine: chiudi });
    attendi(btn, false);
    if (error) return toast('Cessazione non riuscita: ' + error.message, 'err');
    toast(`Rapporto cessato al ${dataIt(al)}${chiudi ? ` · ${data.nomine_chiuse} ${data.nomine_chiuse === 1 ? 'nomina chiusa' : 'nomine chiuse'}` : ''}.`, 'ok');
    chiudiDrawer();
    if (dopo) dopo();
  });
}
