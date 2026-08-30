/* ============================================================
   Scheda persona.

   L'anagrafica persone esisteva solo come tabella: da qui la si
   vede e si corregge. Si apre dal dettaglio RLS (e in futuro da
   ovunque compaia una persona). Mostra i dati base, i rapporti
   con le imprese (persone_imprese) e le comunicazioni RLS che
   portano il suo codice fiscale.

   Dati personali comuni, GDPR normale: si mostrano a chi è già
   abilitato all'app, non si arricchiscono senza motivo.
   ============================================================ */

import { sb, state, $, esc, dataIt, toast, attendi, apriDrawer } from './core.js';

const CAMPI = [
  ['titolo', 'Titolo'], ['nome', 'Nome'], ['cognome', 'Cognome'], ['cf', 'Codice fiscale'],
  ['email', 'Email'], ['telefono', 'Telefono'], ['qualifica', 'Qualifica'],
  ['data_nascita', 'Data di nascita', 'date'], ['comune_nascita', 'Comune di nascita'],
  ['indirizzo', 'Indirizzo'], ['comune_res', 'Comune di residenza'],
];

export async function apriPersona(personaId, dopoSalva = null) {
  const { data: p, error } = await sb.from('persone').select('*').eq('persona_id', personaId).single();
  if (error || !p) return toast('Persona non trovata: ' + (error?.message || personaId), 'err');

  const { data: rapporti } = await sb.from('persone_imprese')
    .select('impresa_id, qualifica, mansione, data_assunzione, data_cessazione')
    .eq('persona_id', personaId).order('data_assunzione', { ascending: false, nullsFirst: false });
  let nomi = {};
  if (rapporti?.length) {
    const { data: imp } = await sb.from('imprese').select('impresa_id, impresa_nome')
      .in('impresa_id', [...new Set(rapporti.map((r) => r.impresa_id))]);
    nomi = Object.fromEntries((imp || []).map((i) => [i.impresa_id, i.impresa_nome]));
  }
  let rls = [];
  if (p.cf) {
    const { data } = await sb.from('s_rls_anagrafe')
      .select('id, ragione_sociale, decorrenza, fine_nomina, tipo_elezione')
      .eq('rls_cf', p.cf).order('decorrenza', { ascending: false, nullsFirst: false });
    rls = data || [];
  }

  apriDrawer(`${[p.titolo, p.cognome, p.nome].filter(Boolean).join(' ')}`, '', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${CAMPI.map(([k, l, tipo]) => `
        <div class="field"><label>${l}</label>
          <input type="${tipo || 'text'}" id="pe-${k}" value="${esc(p[k] ?? '')}"></div>`).join('')}
    </div>
    <div class="field" style="margin-top:8px"><label>Note</label>
      <textarea id="pe-note">${esc(p.note || '')}</textarea></div>
    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-primary" id="pe-salva">Salva</button>
    </div>

    ${rapporti?.length ? `
    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 8px">Rapporti con le imprese</h4>
    ${rapporti.map((r) => `
      <div class="dt-doc-riga">
        <strong>${esc(nomi[r.impresa_id] || r.impresa_id)}</strong>
        ${r.qualifica ? ` — ${esc(String(r.qualifica))}` : ''}${r.mansione ? ` (${esc(r.mansione)})` : ''}
        ${r.data_assunzione ? ` · dal ${dataIt(r.data_assunzione)}` : ''}${r.data_cessazione ? ` al ${dataIt(r.data_cessazione)}` : ''}
      </div>`).join('')}` : ''}

    ${rls.length ? `
    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 8px">Comunicazioni RLS</h4>
    ${rls.map((r) => `
      <div class="dt-doc-riga">
        RLS per <strong>${esc(r.ragione_sociale || '?')}</strong>
        ${r.tipo_elezione ? ` (${esc(r.tipo_elezione)})` : ''}
        ${r.decorrenza ? ` · dal ${dataIt(r.decorrenza)}` : ''}${r.fine_nomina ? ` al ${dataIt(r.fine_nomina)}` : ''}
      </div>`).join('')}` : ''}
  `);

  $('#pe-salva').addEventListener('click', async (ev) => {
    const agg = { updated_by: state.email, updated_at: new Date().toISOString() };
    for (const [k] of CAMPI) agg[k] = $(`#pe-${k}`).value.trim() || null;
    agg.note = $('#pe-note').value.trim() || null;
    if (agg.cf) agg.cf = agg.cf.toUpperCase();
    attendi(ev.currentTarget, true);
    const { error: e2 } = await sb.from('persone').update(agg).eq('persona_id', personaId);
    attendi(ev.currentTarget, false);
    if (e2) return toast('Salvataggio non riuscito: ' + e2.message, 'err');
    toast('Persona aggiornata.', 'ok');
    dopoSalva?.();
  });
}

/* Crea una persona in anagrafica coi dati già noti e restituisce
   il suo id. Prima di creare si ricontrolla il CF: mai duplicare. */
export async function creaPersona(prefill) {
  if (prefill.cf) {
    const { data: gia } = await sb.from('persone').select('persona_id').eq('cf', prefill.cf.toUpperCase()).limit(1);
    if (gia?.length) return gia[0].persona_id;
  }
  const { data, error } = await sb.from('persone').insert({
    titolo: prefill.titolo || null,
    nome: prefill.nome || null,
    cognome: prefill.cognome || null,
    cf: prefill.cf ? prefill.cf.toUpperCase() : null,
    email: prefill.email || null,
    telefono: prefill.telefono || null,
    comune_nascita: prefill.comune_nascita || null,
    indirizzo: prefill.indirizzo || null,
    comune_res: prefill.comune_res || null,
    note: prefill.note || null,
    updated_by: state.email,
  }).select('persona_id').single();
  if (error) throw new Error('Creazione persona non riuscita: ' + error.message);
  return data.persona_id;
}
