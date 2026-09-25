/* ============================================================
   CANTIERI CRITICI — il registro unico (17/09/2026, deciso dall'utente)

   Due porte d'ingresso, una gestione sola:
   · ACCESSO NEGATO: il tecnico lo segnala dal gestionale visite
     (bottone in dashboard, gestionale-visite/diniego-accesso.js) con
     data, impresa, cantiere, motivo, persona presente e note;
   · PROPOSTA DI SEGNALAZIONE A SPISAL / ITL: il tecnico la spunta nel
     verbale; il caso nasce da solo (trigger sulle visite). Fin qui la
     spunta restava dentro il verbale e non avvisava nessuno;
   · in più la segreteria può aprire un caso a mano.

   Le strade d'uscita sono le stesse: ulteriore visita, proposta di
   conferenza di cantiere all'impresa (che non è obbligata), Presidenza
   e Commissione Sicurezza — sono loro a decidere se segnalare agli
   organi di vigilanza, il Direttore conferma — e la segnalazione.

   Tabelle s_cantieri_critici e s_cantieri_critici_eventi (SQL in
   supabase/sql/2026_09_17_cantieri_critici.sql). Quello che ha scritto
   il tecnico non si riscrive (lo impedisce il database). La cronologia
   si aggiunge e non si corregge. Un caso non si cancella: si chiude,
   con l'esito e la nota su com'è stato gestito. «Risposta dell'ufficio»
   è il campo che il tecnico legge nel gestionale.

   Sostituisce js/dinieghi.js del 16/09/2026.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { TIPO_DOC_ACCESSO_NEGATO, CARTELLA_VAULT, oggettoLettera, paragrafiAccessoNegato, paragrafiSollecito,
  corpoMail, corpoRichiestaPec, nomeFileLettera, TIPO_DOC_SEGNALAZIONE, TIPO_DOC_CONFERENZA, SEGNAPOSTO_MERITO, DESTINAZIONI,
  destinatariSegnalazione, oggettoSegnalazione, scheletroSegnalazione, corpoUlterioreVisita, corpoPropostaConferenza,
  corpoDemanda, corpoRichiestaConferma } from './cantieri-critici-doc.js';
import { APP_URL, GESTIONALE_URL } from './config.js';

export const GIORNI_TERMINE = 15;   /* quanto si aspetta che l'impresa ricontatti (deciso dall'utente) */

export const STATI = {
  nuovo: ['dt-scaduto', 'nuovo'],
  in_gestione: ['dt-senzadata', 'in gestione'],
  attesa_impresa: ['dt-scade', 'in attesa dell\'impresa'],
  attesa_decisione: ['dt-scade', 'in attesa di decisione'],
  chiuso: ['dt-ok', 'chiuso'],
  annullato: ['dt-mancante', 'annullato'],   /* aperto per errore o per prova: non si cancella, ma non conta */
};
const FERMI = ['chiuso', 'annullato'];
export const ORIGINI = {
  accesso_negato: ['🚫', 'Accesso negato'],
  proposta_segnalazione: ['⚠️', 'Proposta di segnalazione SPISAL / ITL'],
  manuale: ['📝', 'Aperto dall\'ufficio'],
};
const MOTIVI = { rifiutato: 'una persona ha negato l\'accesso', nessuno_presente: 'cantiere chiuso o nessuno presente', altro: 'altro' };
export const ESITI = {
  risolta_visita: 'Risolta: la visita è stata fatta',
  risolta_altro: 'Risolta in altro modo',
  segnalata_organi: 'Segnalata agli organi di vigilanza',
  non_risolta: 'Non risolta',
  nessuna_azione: 'Nessuna azione',
  non_registrato: 'Chiuso, esito non registrato (storico)',
};
const EVENTI = {
  apertura: 'Apertura', stato: 'Stato', nota: 'Nota',
  lettera_impresa: 'Comunicazione all\'impresa', sollecito: 'Sollecito', pec_richiesta: 'Invio PEC chiesto all\'Amministrazione',
  contatto_impresa: 'L\'impresa ha ricontattato', visita_riprogrammata: 'Visita riprogrammata', visita_successiva: 'Verbale successivo',
  decisione: 'Decisione', risposta_tecnico: 'Risposta al tecnico', conferenza_proposta: 'Proposta di conferenza di cantiere',
  demandata: 'Demandata a Presidenza / Commissione Sicurezza', decisione_organo: 'Decisione di Presidenza / Commissione',
  autorizzazione_direttore: 'Conferma del Direttore', segnalazione_organi: 'Segnalazione a SPISAL / ITL', riscontro_organo: 'Riscontro dell\'organo di vigilanza',
};
/* quelli che si aggiungono a mano; true = di norma li vede anche il tecnico */
const EVENTI_A_MANO = {
  nota: false, contatto_impresa: true, visita_riprogrammata: true, decisione: true, risposta_tecnico: true,
  conferenza_proposta: true, demandata: false, decisione_organo: false, riscontro_organo: false,
};

const oggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const fra = (giorni) => { const d = new Date(oggi() + 'T12:00:00'); d.setDate(d.getDate() + giorni); return d.toISOString().slice(0, 10); };
const oraIt = (ts) => (ts ? new Date(ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const pill = (stato) => {
  const [c, l] = STATI[stato] || ['', stato];
  return `<span class="dt-cella ${c}" style="padding:1px 7px">${esc(l)}</span>`;
};
export const scaduto = (r) => r.stato === 'attesa_impresa' && r.termine_il && r.termine_il < oggi();
/* elenco, caso e maschere stanno larghi: tabella, cronologia e testo della
   lettera nel pannello stretto andavano a capo a ogni parola */
function apriLargo(titolo, direzione, html) {
  apriDrawer(titolo, direzione, html);
  $('#drawer').classList.add('drawer-xl');
}
/* «De Marco Arch. Nicola» → «De Marco»: il cognome è quello che sta prima del
   titolo; senza titolo («Canova Mirco») è tutto tranne l'ultima parola */
export function cognomeDi(n) {
  const t = String(n || '').trim();
  const m = t.match(/^(.*?)\s+(?:Arch|Ing|Geom|Dott|Dr|Sig|Avv|Prof|Rag|P\.I|Per\.Ind)\.?(?:ssa)?\.?\s/i);
  if (m && m[1]) return m[1];
  const parti = t.split(/\s+/);
  return parti.length > 1 ? parti.slice(0, -1).join(' ') : t;
}
const presente = (d) => [d.presente_titolo, d.presente_nome, d.presente_cognome].filter(Boolean).join(' ');

/* i casi ancora aperti, per il cruscotto: prima i nuovi e i termini scaduti */
export async function aperti() {
  const { data, error } = await sb.from('s_cantieri_critici')
    .select('id, created_at, origine, data_evento, tecnico_nome, impresa_nome, cantiere_desc, note, stato, termine_il, priorita')
    .not('stato', 'in', '(chiuso,annullato)').order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  const peso = (r) => (r.stato === 'nuovo' ? 0 : scaduto(r) ? 1 : r.priorita === 'alta' ? 2 : 3);
  return (data || []).sort((a, b) => peso(a) - peso(b));
}

export async function dettaglio(id, dopo = null) {
  const [{ data: d, error }, { data: eventi }] = await Promise.all([
    sb.from('s_cantieri_critici').select('*').eq('id', id).maybeSingle(),
    sb.from('s_cantieri_critici_eventi').select('*').eq('critico_id', id).order('created_at'),
  ]);
  if (error || !d) return toast('Caso non trovato' + (error ? ': ' + error.message : '.'), 'err');
  const [ico, orig] = ORIGINI[d.origine] || ['', d.origine];
  const successiva = [...(eventi || [])].reverse().find((e) => e.tipo === 'visita_successiva');
  const ultimaCom = [...(eventi || [])].reverse().find((e) => e.tipo === 'lettera_impresa' || e.tipo === 'sollecito');
  const riapri = () => dettaglio(id, dopo);

  apriLargo(`${ico} Cantiere critico n° ${d.id} — ${orig}`, '', `
    <div class="dt-doc-riga"><strong>Stato:</strong> ${pill(d.stato)}
      ${d.stato === 'attesa_impresa' && d.termine_il ? `<span class="hint" ${scaduto(d) ? 'style="color:#a01f00;font-weight:600"' : ''}>termine ${dataIt(d.termine_il)}${scaduto(d) ? ' — scaduto: nessun contatto registrato' : ''}</span>` : ''}
      ${d.esito ? `<span class="hint">${esc(ESITI[d.esito] || d.esito)}</span>` : ''}
      ${d.gestito_il ? `<span class="hint">ultima gestione ${oraIt(d.gestito_il)} (${esc(d.gestito_da || '')})</span>` : ''}</div>
    <div class="dt-doc-riga"><strong>${d.origine === 'proposta_segnalazione' ? 'Data della visita' : 'Data'}:</strong> ${dataIt(d.data_evento)}
      · <strong>tecnico:</strong> ${esc(d.tecnico_nome || d.segnalato_da || '—')} <span class="hint">registrato il ${oraIt(d.created_at)}</span></div>
    <div class="dt-doc-riga"><strong>Impresa:</strong> ${esc(d.impresa_nome)}
      ${d.impresa_id ? `<a href="#" id="cc-impresa" class="hint">apri la scheda</a>` : '<span class="hint">(scritta a mano)</span>'}</div>
    <div class="dt-doc-riga"><strong>Cantiere:</strong> ${esc(d.cantiere_desc)}
      ${d.cantiere_id ? `<span class="hint">(dall'anagrafica cantieri: ${esc(d.cantiere_id)})</span>` : '<span class="hint">(scritto a mano)</span>'}</div>
    ${d.motivo ? `<div class="dt-doc-riga"><strong>Che cosa è successo:</strong> ${esc(MOTIVI[d.motivo] || d.motivo)}</div>` : ''}
    ${presente(d) || d.presente_qualifica || d.presente_tel ? `<div class="dt-doc-riga"><strong>Persona presente:</strong> ${esc(presente(d) || '(nome non indicato)')}
      ${d.presente_qualifica ? ` — ${esc(d.presente_qualifica)}` : ''}${d.presente_tel ? ` · tel. ${esc(d.presente_tel)}` : ''}</div>` : ''}
    <div class="dt-doc-riga" style="white-space:pre-wrap"><strong>Note del tecnico:</strong>\n${esc(d.note)}</div>

    ${d.origine !== 'proposta_segnalazione' ? `<div class="dt-doc-riga" style="background:#fff4ee;border-radius:6px;padding:6px 8px">
      ${ultimaCom ? `📄 <strong>${ultimaCom.tipo === 'sollecito' ? 'Sollecitata' : 'Comunicata'} all'impresa</strong> il ${dataIt(ultimaCom.created_at.slice(0, 10))}
          <span class="hint">${esc(ultimaCom.dati?.sigla ? 'Prot. ' + ultimaCom.dati.sigla : '')}${ultimaCom.dati?.a ? ' · a ' + esc(ultimaCom.dati.a) : ''}</span>`
        : "📄 All'impresa non è ancora stato comunicato niente."}
      ${!FERMI.includes(d.stato) ? `<button class="btn btn-ghost btn-sm" id="cc-com">${ultimaCom ? '🔁 Sollecita…' : "📄 Comunicazione all'impresa…"}</button>` : ''}</div>` : ''}

    ${d.testo_merito ? `<div class="dt-doc-riga" style="white-space:pre-wrap;background:#f3f0fa;border-radius:6px;padding:6px 8px"><strong>Testo di merito della segnalazione</strong>
      <span class="hint">scritto dal coordinatore nel gestionale — ${esc(d.merito_da || '')}, ${oraIt(d.merito_il)}</span>\n${esc(d.testo_merito)}</div>` : ''}
    ${d.storico_rif ? `<div class="dt-doc-riga"><span class="hint">Dallo storico Access: ${esc(d.storico_rif)}${(d.storico?.soggetti || []).length ? ' — soggetti: ' + esc(d.storico.soggetti.map((x) => `${x.nome} (${x.ruolo})`).join('; ')) : ''}</span></div>` : ''}
    ${!FERMI.includes(d.stato) ? `<div class="dt-doc-riga" style="background:#f3f0fa;border-radius:6px;padding:6px 8px">
      <strong>Che cosa si fa:</strong>
      <button class="btn btn-ghost btn-sm" id="cc-d-visita">↩️ Ulteriore visita</button>
      <button class="btn btn-ghost btn-sm" id="cc-d-conf">🎓 Proponi conferenza di cantiere</button>
      <button class="btn btn-ghost btn-sm" id="cc-d-demanda">🏛 Demanda a Presidenza / Commissione</button>
      <button class="btn btn-ghost btn-sm" id="cc-d-organo">✍️ Registra decisione o conferma</button>
      <button class="btn btn-ghost btn-sm" id="cc-d-dir">🖊 Chiedi conferma al Direttore</button>
      <button class="btn btn-ghost btn-sm" id="cc-d-segnala">📨 Segnala a SPISAL / ITL</button>
      <br><span class="hint">Se segnalare lo decidono la Presidenza e la Commissione Sicurezza, il Direttore conferma. La conferenza è una proposta: l'impresa non è obbligata.</span></div>` : ''}

    ${successiva && !FERMI.includes(d.stato) ? `<div class="dt-doc-riga" style="background:#eef8f0;border-radius:6px;padding:6px 8px">
      ✅ ${esc(successiva.testo || 'Sul cantiere è entrato un verbale successivo.')}
      <button class="btn btn-ghost btn-sm" id="cc-risolta">Chiudi come risolta con questo verbale</button></div>` : ''}

    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 170px"><label>Stato</label>
        <select id="cc-stato">${Object.entries(STATI).map(([v, [, l]]) => `<option value="${v}" ${d.stato === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field" style="flex:0 0 120px"><label>Priorità</label>
        <select id="cc-priorita"><option value="normale" ${d.priorita !== 'alta' ? 'selected' : ''}>normale</option><option value="alta" ${d.priorita === 'alta' ? 'selected' : ''}>alta</option></select></div>
      <div class="field" id="cc-termine-box" style="flex:0 0 160px"><label>Termine per l'impresa</label>
        <input type="date" id="cc-termine" value="${esc(d.termine_il || '')}"></div>
      <div class="field" id="cc-esito-box" style="flex:1 1 220px"><label>Esito *</label>
        <select id="cc-esito"><option value="">– com'è finita –</option>${Object.entries(ESITI).map(([v, l]) => `<option value="${v}" ${d.esito === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Risposta dell'ufficio <span class="hint">(la legge anche il tecnico nel gestionale)</span></label>
      <textarea id="cc-gest" rows="3" style="width:100%" placeholder="Che cosa si è deciso e fatto: impresa contattata, ulteriore visita, proposta di conferenza di cantiere, demandato alla Presidenza…">${esc(d.gestione_note || '')}</textarea></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
      ${d.stato === 'nuovo' ? '<button class="btn btn-ghost btn-sm" id="cc-incarico">📨 Prendi in gestione</button>' : ''}
      <button class="btn btn-primary btn-sm" id="cc-salva">💾 Salva</button>
    </div>

    <hr style="margin:12px 0 8px;border:0;border-top:1px solid var(--bordo)">
    <div style="font-weight:600;margin-bottom:4px">Cronologia</div>
    <div id="cc-crono">${(eventi || []).map((e) => `
      <div class="dt-doc-riga" style="white-space:pre-wrap;font-size:12.5px"><span class="hint">${oraIt(e.created_at)}</span>
        <strong>${esc(EVENTI[e.tipo] || e.tipo)}</strong>${e.visibile_tecnico ? '' : ' <span class="hint" title="Non lo vede il tecnico">🔒</span>'}
        ${e.testo ? `— ${esc(e.testo)}` : ''} <span class="hint">${esc(e.autore || '')}</span></div>`).join('') || '<p class="hint">Ancora niente.</p>'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px">
      <div class="field" style="flex:0 0 230px"><label>Aggiungi alla cronologia</label>
        <select id="cc-ev-tipo">${Object.keys(EVENTI_A_MANO).map((t) => `<option value="${t}">${esc(EVENTI[t])}</option>`).join('')}</select></div>
      <div class="field" style="flex:1 1 240px"><label>Che cosa</label><input type="text" id="cc-ev-testo" maxlength="1000" placeholder="chi ha chiamato, che cosa si è detto, che cosa si è deciso…"></div>
      <label class="hint" style="display:flex;align-items:center;gap:4px;margin-bottom:8px"><input type="checkbox" id="cc-ev-vis"> lo vede il tecnico</label>
      <button class="btn btn-ghost btn-sm" id="cc-ev-add" style="margin-bottom:6px">➕ Aggiungi</button>
    </div>
    <p class="hint" style="margin-top:8px">Quello che ha scritto il tecnico non si modifica, la cronologia non si corregge: si aggiunge. Per chiudere servono l'esito e la risposta dell'ufficio.
      Se l'impresa non si fa sentire si scrive «nessun contatto registrato», non «non ha risposto»: il silenzio dice della nostra attesa, non dell'impresa.</p>`);

  const campi = () => {
    const st = $('#cc-stato').value;
    $('#cc-termine-box').style.display = st === 'attesa_impresa' ? '' : 'none';
    $('#cc-esito-box').style.display = st === 'chiuso' ? '' : 'none';
    if (st === 'attesa_impresa' && !$('#cc-termine').value) $('#cc-termine').value = fra(GIORNI_TERMINE);
  };
  $('#cc-stato').addEventListener('change', campi);
  campi();
  const visDefault = () => { $('#cc-ev-vis').checked = !!EVENTI_A_MANO[$('#cc-ev-tipo').value]; };
  $('#cc-ev-tipo').addEventListener('change', visDefault);
  visDefault();

  const salva = async (btn, forza = {}) => {
    const stato = forza.stato || $('#cc-stato').value;
    const gestione = (forza.gestione_note ?? $('#cc-gest').value).trim();
    const esito = forza.esito || $('#cc-esito').value || null;
    if (stato === 'chiuso' && !gestione) return toast('Per chiudere scrivi com\'è stato gestito.', 'err');
    if (stato === 'annullato' && !gestione) return toast('Per annullare scrivi perché (errore, prova, doppione…).', 'err');
    if (stato === 'chiuso' && !esito) return toast('Per chiudere indica l\'esito.', 'err');
    attendi(btn, true, 'Salvo…');
    const { error: e } = await sb.from('s_cantieri_critici').update({
      stato, gestione_note: gestione || null, priorita: $('#cc-priorita').value,
      termine_il: stato === 'attesa_impresa' ? ($('#cc-termine').value || fra(GIORNI_TERMINE)) : null,
      esito: stato === 'chiuso' ? esito : null,
      esito_visita_id: stato === 'chiuso' ? (forza.esito_visita_id || d.esito_visita_id || null) : null,
    }).eq('id', d.id);
    attendi(btn, false);
    if (e) return toast('Salvataggio non riuscito: ' + e.message, 'err');
    toast('Caso aggiornato.', 'ok');
    if (dopo) dopo();
    if (FERMI.includes(stato)) chiudiDrawer(); else riapri();
  };
  $('#cc-salva').addEventListener('click', (ev) => salva(ev.currentTarget));
  $('#cc-incarico')?.addEventListener('click', (ev) => salva(ev.currentTarget, { stato: 'in_gestione' }));
  $('#cc-risolta')?.addEventListener('click', (ev) => {
    const v = successiva.dati || {};
    salva(ev.currentTarget, {
      stato: 'chiuso', esito: 'risolta_visita', esito_visita_id: v.visita_id || null,
      gestione_note: $('#cc-gest').value.trim() || `Visita effettuata: verbale ${v.nr_verbale || ''} del ${dataIt(v.data_visita)}.`,
    });
  });
  $('#cc-com')?.addEventListener('click', () => preparaComunicazione(d, ultimaCom, dopo));
  $('#cc-d-visita')?.addEventListener('click', () => decidiVisita(d, dopo));
  $('#cc-d-conf')?.addEventListener('click', () => proponiConferenza(d, dopo));
  $('#cc-d-demanda')?.addEventListener('click', () => demanda(d, eventi || [], dopo));
  $('#cc-d-organo')?.addEventListener('click', () => registraDecisione(d, dopo));
  $('#cc-d-dir')?.addEventListener('click', () => chiediConfermaDirettore(d, eventi || [], dopo));
  $('#cc-d-segnala')?.addEventListener('click', () => segnalaOrgani(d, eventi || [], dopo));
  $('#cc-ev-add').addEventListener('click', async (ev) => {
    const testo = $('#cc-ev-testo').value.trim();
    if (!testo) return toast('Scrivi che cosa è successo.', 'err');
    attendi(ev.currentTarget, true, '…');
    const { error: e } = await sb.from('s_cantieri_critici_eventi')
      .insert({ critico_id: d.id, tipo: $('#cc-ev-tipo').value, testo, visibile_tecnico: $('#cc-ev-vis').checked });
    attendi(ev.currentTarget, false);
    if (e) return toast('Non aggiunto: ' + e.message, 'err');
    riapri();
  });
  $('#cc-impresa')?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    chiudiDrawer();
    const mod = await import('./imprese.js');
    mod.apriScheda(d.impresa_id);   /* cambia vista da sé, come da persona.js e rls.js */
  });
}

/* tutti, anche i chiusi: per ritrovare quello che è già stato gestito */
export async function elenco(dopo = null) {
  const { data, error } = await sb.from('s_cantieri_critici')
    .select('id, created_at, origine, data_evento, tecnico_nome, impresa_nome, cantiere_desc, stato, esito, termine_il, storico_rif')
    .neq('stato', 'annullato').order('data_evento', { ascending: false }).limit(300);
  if (error) return toast(error.message, 'err');
  apriLargo('Cantieri critici — tutti i casi', '', `
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn btn-primary btn-sm" id="cc-nuovo">➕ Nuovo caso</button></div>
    <div class="table-wrap"><table class="tbl" style="min-width:0">
      <thead><tr><th>N°</th><th></th><th>Data</th><th>Tecnico</th><th>Impresa</th><th>Cantiere</th><th>Stato</th></tr></thead>
      <tbody>${(data || []).map((r) => `<tr data-cc="${r.id}" style="cursor:pointer"><td style="white-space:nowrap">${r.id}${r.storico_rif ? '<br><span class="hint" title="' + esc(r.storico_rif) + '">storico</span>' : ''}</td>
        <td title="${esc((ORIGINI[r.origine] || [])[1] || '')}">${(ORIGINI[r.origine] || [''])[0]}</td><td style="white-space:nowrap">${dataIt(r.data_evento)}</td>
        <td style="white-space:nowrap">${esc(cognomeDi(r.tecnico_nome))}</td><td>${esc(r.impresa_nome)}</td><td>${esc(r.cantiere_desc)}</td>
        <td>${pill(r.stato)}${scaduto(r) ? '<br><span class="hint" style="color:#a01f00">termine scaduto</span>' : ''}${r.esito ? `<br><span class="hint">${esc(ESITI[r.esito] || r.esito)}</span>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nessun caso.</td></tr>'}</tbody></table></div>`);
  $('#drawer-body').querySelectorAll('tr[data-cc]').forEach((tr) =>
    tr.addEventListener('click', () => dettaglio(Number(tr.dataset.cc), dopo)));
  $('#cc-nuovo').addEventListener('click', () => nuovo(dopo));
}

/* il caso aperto a mano dalla segreteria: una telefonata del tecnico, una
   segnalazione arrivata per altra via. Il tecnico indicato lo ritrova nel
   proprio elenco del gestionale. */
export async function nuovo(dopo = null) {
  const { data: tecnici } = await sb.from('tecnici').select('tecnico_id, tecnico_nome, tecnico_cognome, attivo')
    .eq('attivo', true).order('tecnico_cognome');
  apriLargo('Cantiere critico — nuovo caso', '', `
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 220px"><label>Che cos'è *</label>
        <select id="cn-origine"><option value="accesso_negato">🚫 Accesso negato (riferito dal tecnico)</option><option value="manuale">📝 Altra criticità</option></select></div>
      <div class="field" style="flex:0 0 160px"><label>Data *</label><input type="date" id="cn-data" value="${oggi()}" max="${oggi()}"></div>
      <div class="field" style="flex:1 1 200px"><label>Tecnico *</label>
        <select id="cn-tecnico"><option value="">– scegli –</option>${(tecnici || []).map((t) => `<option value="${esc(t.tecnico_id)}">${esc(t.tecnico_cognome + ' ' + t.tecnico_nome)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Impresa *</label><input type="text" id="cn-impresa" maxlength="200" placeholder="Ragione sociale"></div>
    <div class="field"><label>Cantiere *</label><input type="text" id="cn-cantiere" maxlength="300" placeholder="Indirizzo, comune"></div>
    <div class="field" id="cn-motivo-box"><label>Che cosa è successo</label>
      <select id="cn-motivo"><option value="">–</option>${Object.entries(MOTIVI).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 200px"><label>Persona presente</label><input type="text" id="cn-pp" maxlength="120" placeholder="Cognome e nome, se si sa"></div>
      <div class="field" style="flex:1 1 160px"><label>In qualità di</label><input type="text" id="cn-pp-qual" maxlength="80"></div>
      <div class="field" style="flex:0 0 150px"><label>Telefono</label><input type="tel" id="cn-pp-tel" maxlength="40"></div>
    </div>
    <div class="field"><label>Note *</label><textarea id="cn-note" rows="4" style="width:100%" placeholder="Che cosa è stato riferito, da chi e come"></textarea></div>
    <div style="display:flex;gap:6px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" id="cn-annulla">Annulla</button>
      <button class="btn btn-primary btn-sm" id="cn-salva">💾 Apri il caso</button></div>`);
  $('#cn-origine').addEventListener('change', () => { $('#cn-motivo-box').style.display = $('#cn-origine').value === 'accesso_negato' ? '' : 'none'; });
  $('#cn-annulla').addEventListener('click', () => elenco(dopo));
  $('#cn-salva').addEventListener('click', async (ev) => {
    const v = (id) => $(id).value.trim();
    if (!v('#cn-data') || !v('#cn-tecnico') || !v('#cn-impresa') || !v('#cn-cantiere') || !v('#cn-note')) return toast('Servono data, tecnico, impresa, cantiere e note.', 'err');
    attendi(ev.currentTarget, true, 'Apro…');
    const accesso = v('#cn-origine') === 'accesso_negato';
    const { data: r, error } = await sb.from('s_cantieri_critici').insert({
      origine: v('#cn-origine'), data_evento: v('#cn-data'), tecnico_id: v('#cn-tecnico'),
      impresa_nome: v('#cn-impresa'), cantiere_desc: v('#cn-cantiere'), note: v('#cn-note'),
      motivo: accesso ? (v('#cn-motivo') || null) : null,
      presente_cognome: v('#cn-pp') || null, presente_qualifica: v('#cn-pp-qual') || null, presente_tel: v('#cn-pp-tel') || null,
    }).select('id').single();
    attendi(ev.currentTarget, false);
    if (error) return toast('Caso non aperto: ' + error.message, 'err');
    toast(`Caso n° ${r.id} aperto.`, 'ok');
    if (dopo) dopo();
    dettaglio(r.id, dopo);
  });
}

/* ── LA COMUNICAZIONE ALL'IMPRESA (e il sollecito) ─────────────
   Erede della lettera Access «Com_ins» (serie NNN/aaaaINS, firmata dal
   Presidente). Decisioni dell'utente, 17/09/2026: la firma la SEGRETERIA;
   esce per MAIL ORDINARIA con un protocollo OUT del registro; nei casi più
   critici in più l'Amministrazione la inoltra dalla PEC aziendale, e qui si
   prepara la richiesta per lei. Lo storico dice che il destinatario non è
   sempre l'impresa (spesso il «soggetto notificatore», a volte più
   soggetti): «A» e «Cc» sono liberi.
   L'app PREPARA: le bozze .eml le manda una persona da Outlook.
   `prec` = l'evento della comunicazione precedente: se c'è, è un sollecito. */
async function preparaComunicazione(d, prec, dopo) {
  const sollecito = !!prec;
  const [{ data: imp }, { data: tec }, { data: cant }, { data: conf }] = await Promise.all([
    d.impresa_id ? sb.from('imprese').select('impresa_nome, indirizzo, cap, comune, prov, piva, cod_ceiv, pec, impresa_email_ref, impresa_email2, impresa_telefono')
      .eq('impresa_id', d.impresa_id).maybeSingle() : Promise.resolve({ data: null }),
    d.tecnico_id ? sb.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome').eq('tecnico_id', d.tecnico_id).maybeSingle() : Promise.resolve({ data: null }),
    d.cantiere_id ? sb.from('cantieri').select('cantiere_indirizzo, cantiere_civico, comune_nome').eq('cantiere_id', d.cantiere_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'coordinatore_email', 'amministrazione_email']),
  ]);
  const c = Object.fromEntries((conf || []).map((r) => [r.chiave, r.valore]));
  const tecnicoNome = tec ? [tec.titolo, tec.tecnico_nome, tec.tecnico_cognome].filter(Boolean).join(' ') : '';
  const cantiereBreve = cant
    ? [[cant.cantiere_indirizzo, cant.cantiere_civico].filter(Boolean).join(' '), cant.comune_nome].filter(Boolean).join(', ')
    : d.cantiere_desc;
  const chiaveTel = `cc-tel-tecnico-${d.tecnico_id || ''}`;
  let telRicordato = '';
  try { telRicordato = localStorage.getItem(chiaveTel) || ''; } catch { /* senza memoria si riscrive */ }

  apriLargo(`${sollecito ? '🔁 Sollecito' : "📄 Comunicazione all'impresa"} — caso n° ${d.id}`, '', `
    <p class="hint">${sollecito
      ? `Sollecito della comunicazione ${esc(prec.dati?.sigla ? 'Prot. ' + prec.dati.sigla : '')} del ${dataIt(prec.created_at.slice(0, 10))}: è una lettera nuova, con un numero di protocollo suo.`
      : 'Lettera su carta Formedil firmata dalla Segreteria, protocollata in uscita, depositata nel vault e allegata alla bozza mail. La mail la mandi tu da Outlook.'}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 260px"><label>A *</label><input type="text" id="cm-a" value="${esc(prec?.dati?.a || imp?.impresa_email_ref || imp?.impresa_email2 || '')}" placeholder="mail dell'impresa (o del soggetto notificatore)"></div>
      <div class="field" style="flex:1 1 260px"><label>Alla c.a.</label><input type="text" id="cm-ca" value="${esc(prec?.dati?.alla_ca || '')}" placeholder="es. Rossi Sig. Mario"></div>
    </div>
    <div class="field"><label>Cc <span class="hint">(altri soggetti: committente, studio, ente — separati da virgola)</span></label><input type="text" id="cm-cc" value="${esc(prec?.dati?.cc_altri || '')}"></div>
    <div class="hint" style="display:flex;gap:14px;flex-wrap:wrap;margin:-2px 0 8px">
      <label><input type="checkbox" id="cm-cc-dir" checked> cc Direzione (${esc(c.direttore_email || 'direzione@formedilpadova.it')})</label>
      <label><input type="checkbox" id="cm-cc-coo" checked> cc coordinatore (${esc(c.coordinatore_email || '—')})</label></div>
    <div class="field"><label>Cantiere, come va scritto nella lettera *</label><input type="text" id="cm-cant" value="${esc(cantiereBreve)}"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 220px"><label>Tecnico</label><input type="text" id="cm-tec" value="${esc(tecnicoNome)}"></div>
      <div class="field" style="flex:0 0 170px"><label>Telefono del tecnico</label><input type="tel" id="cm-tel" value="${esc(telRicordato)}" placeholder="facoltativo"></div>
      <div class="field" style="flex:0 0 170px"><label>Ricontattare entro *</label><input type="date" id="cm-termine" value="${fra(GIORNI_TERMINE)}" min="${oggi()}"></div>
    </div>
    <div class="dt-doc-riga" style="background:#fdf6d8;border-radius:6px;padding:6px 8px">
      <label><input type="checkbox" id="cm-pec" ${d.priorita === 'alta' ? 'checked' : ''}> <strong>Caso critico</strong>: prepara anche la richiesta all'Amministrazione di inoltrarla dalla PEC aziendale</label>
      <div class="field" style="margin-top:4px"><label>PEC dell'impresa</label><input type="text" id="cm-pec-a" value="${esc(imp?.pec || '')}" placeholder="se manca in anagrafica, scrivila qui"></div>
    </div>
    <div id="cm-testo" class="dt-doc-riga" style="white-space:pre-wrap;font-size:12.5px;border:1px solid var(--bordo);border-radius:6px;padding:8px;margin-top:8px"></div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px">
      <button class="btn btn-ghost btn-sm" id="cm-indietro">← Torna al caso</button>
      <button class="btn btn-ghost btn-sm" id="cm-anteprima">👁 Anteprima PDF (senza protocollo)</button>
      <button class="btn btn-primary btn-sm" id="cm-vai">📄 Protocolla e prepara le bozze</button>
    </div>`);

  const opz = () => ({ tecnico: $('#cm-tec').value.trim(), tecnicoTel: $('#cm-tel').value.trim(), termine: $('#cm-termine').value,
    saluto: $('#cm-ca').value.trim() ? `Egr. ${$('#cm-ca').value.trim()}` : `Spett.le ${d.impresa_nome}` });
  const caso = () => ({ ...d, cantiere_breve: $('#cm-cant').value.trim() || d.cantiere_desc });
  const paragrafi = () => (sollecito
    ? paragrafiSollecito(caso(), { sigla: prec.dati?.sigla || '—', data_prot: prec.dati?.data_prot || prec.created_at.slice(0, 10) }, opz())
    : paragrafiAccessoNegato(caso(), opz()));
  const mostraTesto = () => { $('#cm-testo').textContent = `${oggettoLettera(caso())}\n\n${paragrafi().join('\n\n')}`; };
  ['#cm-cant', '#cm-tec', '#cm-tel', '#cm-termine'].forEach((q) => $(q).addEventListener('input', mostraTesto));
  mostraTesto();

  const destinatarioPdf = () => ({
    ragione_sociale: imp?.impresa_nome || d.impresa_nome,
    ind_sede_legale: imp?.indirizzo || '',
    comune_legale: imp ? [imp.cap, imp.comune, imp.prov ? `(${imp.prov})` : ''].filter(Boolean).join(' ') : '',
    email: $('#cm-a').value.trim(), telefono: imp?.impresa_telefono || '',
    partita_iva: imp?.piva || '', codice_ceiv_dich: imp?.cod_ceiv || '',
    alla_ca_riga: $('#cm-ca').value.trim() ? `Alla c.a. ${$('#cm-ca').value.trim()}` : '',
  });

  $('#cm-indietro').addEventListener('click', () => dettaglio(d.id, dopo));
  $('#cm-anteprima').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Genero…');
    try {
      const { generaLetteraPdf } = await import('./rlst-lettera.js');
      const byte = await generaLetteraPdf(destinatarioPdf(), { codice: 'BOZZA-SENZA-PROTOCOLLO', data_prot: oggiIso() }, paragrafi(), oggettoLettera(caso()));
      (await import('./corsi-doc.js')).scaricaPdf(byte, `anteprima-accesso-negato-n${d.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); } finally { attendi(ev.currentTarget, false); }
  });

  $('#cm-vai').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const a = $('#cm-a').value.trim();
    if (!a) return toast("Indica a chi va la mail: senza destinatario la lettera non può uscire.", 'err');
    if (!$('#cm-termine').value) return toast('Indica entro quando ricontattare.', 'err');
    const vuolePec = $('#cm-pec').checked;
    if (!confirm(`Protocollo in uscita ${sollecito ? 'il sollecito' : 'la comunicazione'} per ${d.impresa_nome} e preparo le bozze mail. Procedo?`)) return;
    attendi(btn, true, 'Preparo…');
    try {
      const { generaLetteraPdf } = await import('./rlst-lettera.js');
      const { risolviCartella, caricaByte } = await import('./drive.js');
      const par = paragrafi();
      const oggettoRiga = oggettoLettera(caso());
      /* prova a vuoto PRIMA di chiedere il numero: se la lettera non si
         genera, il registro non consuma niente */
      await generaLetteraPdf(destinatarioPdf(), { codice: 'BOZZA', data_prot: oggiIso() }, par, oggettoRiga);

      const cart = await risolviCartella(CARTELLA_VAULT);
      if (!cart.id || cart.mancante) throw new Error(`Cartella «${CARTELLA_VAULT}» non trovata su Drive`);
      const cartId = cart.id;

      const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
        direzione: 'OUT', data_prot: oggiIso(), data_doc: oggiIso(),
        impresa_nome: imp?.impresa_nome || d.impresa_nome, impresa_id: d.impresa_id || null,
        persona: $('#cm-ca').value.trim() || null,
        oggetto: `${sollecito ? 'Sollecito — ' : ''}${oggettoRiga.replace(/\.$/, '')}`,
        note: par.join('\n\n'),
        sintesi: `${sollecito ? 'Sollecito della comunicazione' : 'Comunicazione'} di mancato accesso al cantiere — caso n° ${d.id} del registro cantieri critici (tecnico ${d.tecnico_nome || '—'}).`,
        scadenze: `L'impresa ricontatta entro il ${dataIt($('#cm-termine').value)}`,
        ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail',
        tipo_doc_id: TIPO_DOC_ACCESSO_NEGATO, cartella: CARTELLA_VAULT,
      } });
      if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

      const pdfByte = await generaLetteraPdf(destinatarioPdf(), nuovo, par, oggettoRiga);
      const nomeFile = nomeFileLettera(d, oggiIso(), sollecito, cant?.comune_nome || '');
      const su = await caricaByte(nuovo, nomeFile, pdfByte, 'application/pdf', cartId);
      await sb.from('s_prot_allegati').insert({
        protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
        dimensione: pdfByte.length, principale: true, created_by: state.email,
        drive_file_id: su.drive_file_id, drive_url: su.drive_url,
      });
      await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

      const sigla = siglaProtocollo(nuovo);
      const ccAltri = $('#cm-cc').value.trim();
      const { error: errEv } = await sb.from('s_cantieri_critici_eventi').insert({
        critico_id: d.id, tipo: sollecito ? 'sollecito' : 'lettera_impresa', visibile_tecnico: true, protocollo_id: nuovo.id,
        testo: `${sollecito ? 'Sollecito' : "Comunicazione all'impresa"} ${codiceProtocollo(nuovo)}: ricontattare entro il ${dataIt($('#cm-termine').value)}.`,
        dati: { sigla, data_prot: nuovo.data_prot, a, alla_ca: $('#cm-ca').value.trim(), cc_altri: ccAltri, termine: $('#cm-termine').value, drive_url: su.drive_url },
      });
      if (errEv) throw new Error('Lettera protocollata ma cronologia non aggiornata: ' + errEv.message);
      const { error: errSt } = await sb.from('s_cantieri_critici').update({
        stato: 'attesa_impresa', termine_il: $('#cm-termine').value, priorita: vuolePec ? 'alta' : d.priorita,
        gestione_note: d.gestione_note || null,
      }).eq('id', d.id);
      if (errSt) throw new Error('Lettera protocollata ma caso non aggiornato: ' + errSt.message);
      try { if ($('#cm-tel').value.trim()) localStorage.setItem(chiaveTel, $('#cm-tel').value.trim()); } catch { /* pazienza */ }

      const { scaricaEml } = await import('./eml.js');
      const allegati = [{ nome: su.file_name || nomeFile, byte: pdfByte }];
      const cc = [...ccAltri.split(/[,;]/).map((x) => x.trim()).filter(Boolean),
        $('#cm-cc-dir').checked ? (c.direttore_email || 'direzione@formedilpadova.it') : null,
        $('#cm-cc-coo').checked ? c.coordinatore_email : null].filter((m) => m && m.toLowerCase() !== a.toLowerCase());
      scaricaEml({
        to: a, cc,
        oggetto: `${sollecito ? 'Sollecito — ' : ''}${oggettoRiga.replace(/\.$/, '')} - Prot. ${sigla}`,
        corpo: `${corpoMail(caso(), opz(), sollecito)}\n\nDistinti saluti.`,
        allegati, nomeFile: `${sollecito ? 'sollecito-' : ''}accesso-negato-n${d.id}.eml`,
      });
      if (vuolePec) {
        scaricaEml({
          to: c.amministrazione_email || 'amministrazione@formedilpadova.it',
          oggetto: `Da inoltrare via PEC — ${oggettoRiga.replace(/\.$/, '')} - Prot. ${sigla}`,
          corpo: corpoRichiestaPec(caso(), `Prot. ${sigla}`, $('#cm-pec-a').value.trim()),
          allegati, nomeFile: `richiesta-pec-accesso-negato-n${d.id}.eml`,
        });
        await sb.from('s_cantieri_critici_eventi').insert({
          critico_id: d.id, tipo: 'pec_richiesta', protocollo_id: nuovo.id,
          testo: `Chiesto all'Amministrazione l'inoltro dalla PEC aziendale${$('#cm-pec-a').value.trim() ? ' a ' + $('#cm-pec-a').value.trim() : ' (PEC dell\'impresa da rilevare)'}. Agli atti va la ricevuta di consegna.`,
        });
      }
      toast(`${sollecito ? 'Sollecito' : 'Comunicazione'} protocollata (${codiceProtocollo(nuovo)}) e depositata. Bozze scaricate: impresa${vuolePec ? " e richiesta PEC all'Amministrazione" : ''}. Ricordati di segnare il protocollo come inviato quando parte.`, 'ok');
      if (dopo) dopo();
      dettaglio(d.id, dopo);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      attendi(btn, false);
    }
  });
}

/* ── LE DECISIONI (tappa 3) ────────────────────────────────────
   Ogni decisione lascia una riga in cronologia (chi, quando, che cosa) e,
   quando serve, prepara la bozza della mail: la manda una persona. */

async function contesto(d) {
  const [{ data: imp }, { data: tec }, { data: cant }, { data: conf }, { data: verbali }] = await Promise.all([
    d.impresa_id ? sb.from('imprese').select('impresa_nome, impresa_email_ref, impresa_email2').eq('impresa_id', d.impresa_id).maybeSingle() : Promise.resolve({ data: null }),
    d.tecnico_id ? sb.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome, email').eq('tecnico_id', d.tecnico_id).maybeSingle() : Promise.resolve({ data: null }),
    d.cantiere_id ? sb.from('cantieri').select('cantiere_indirizzo, cantiere_civico, comune_nome').eq('cantiere_id', d.cantiere_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('s_config').select('chiave, valore').in('chiave', ['direttore_email', 'coordinatore_email', 'presidente_email', 'vicepresidente_email', 'organi_vigilanza_contatti']),
    d.cantiere_id ? sb.from('visite').select('visita_id, nr_verbale, data_visita, ipc, segnalazione, elimina').eq('cantiere_id', d.cantiere_id).order('data_visita') : Promise.resolve({ data: [] }),
  ]);
  const c = Object.fromEntries((conf || []).map((r) => [r.chiave, r.valore]));
  let contatti = {};
  try { contatti = JSON.parse(c.organi_vigilanza_contatti || '{}'); } catch { /* configurazione da sistemare */ }
  return {
    imp, tec, c, contatti,
    verbali: (verbali || []).filter((v) => !v.elimina),
    caso: { ...d, cantiere_breve: cant ? [[cant.cantiere_indirizzo, cant.cantiere_civico].filter(Boolean).join(' '), cant.comune_nome].filter(Boolean).join(', ') : d.cantiere_desc },
  };
}

const evento = (d, tipo, testo, extra = {}) => sb.from('s_cantieri_critici_eventi')
  .insert({ critico_id: d.id, tipo, testo, visibile_tecnico: true, ...extra });

/* una maschera piccola dentro al drawer: campi, Annulla, Conferma */
function maschera(d, dopo, titolo, html, etichetta, onOk) {
  apriLargo(`${titolo} — caso n° ${d.id}`, '', `${html}
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-ghost btn-sm" id="mk-indietro">← Torna al caso</button>
      <button class="btn btn-primary btn-sm" id="mk-ok">${etichetta}</button></div>`);
  $('#mk-indietro').addEventListener('click', () => dettaglio(d.id, dopo));
  $('#mk-ok').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Preparo…');
    try {
      if (await onOk() !== false) { if (dopo) dopo(); dettaglio(d.id, dopo); }
    } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
  });
}

async function decidiVisita(d, dopo) {
  const k = await contesto(d);
  maschera(d, dopo, '↩️ Ulteriore visita', `
    <p class="hint">Si scrive in cronologia (la legge anche il tecnico) e si prepara la bozza della mail al tecnico, con il coordinatore in copia. È una visita ordinaria: niente autorizzazione del Direttore.</p>
    <div class="field"><label>A</label><input type="text" id="mk-a" value="${esc(k.tec?.email || d.segnalato_da || '')}"></div>
    <div class="field"><label>Indicazioni per il tecnico</label><textarea id="mk-testo" rows="4" style="width:100%" placeholder="Quando, con chi prendere contatto, a che cosa fare attenzione…"></textarea></div>`,
  '📨 Registra e prepara la mail', async () => {
    const ind = $('#mk-testo').value.trim();
    const { error } = await evento(d, 'decisione', `Ulteriore visita.${ind ? ' ' + ind : ''}`);
    if (error) throw new Error(error.message);
    const { scaricaEml } = await import('./eml.js');
    scaricaEml({
      to: $('#mk-a').value.trim(), cc: [k.c.coordinatore_email].filter(Boolean),
      oggetto: `Ulteriore visita — ${k.caso.cantiere_breve} — ${d.impresa_nome}`,
      corpo: corpoUlterioreVisita(k.caso, k.tec?.tecnico_nome, ind), nomeFile: `ulteriore-visita-caso-${d.id}.eml`,
    });
    toast('Decisione registrata e bozza per il tecnico scaricata.', 'ok');
  });
}

async function proponiConferenza(d, dopo) {
  const k = await contesto(d);
  maschera(d, dopo, '🎓 Proposta di conferenza di cantiere', `
    <p class="hint">È una proposta: l'impresa non è obbligata. La mail esce dall'ufficio, quindi prende un protocollo in uscita; il caso passa «in attesa dell'impresa». Se l'impresa aderisce, la conferenza si apre dalla vista «Conferenze cantiere» (lì passa dal Direttore, perché è una spesa).</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 260px"><label>A *</label><input type="text" id="mk-a" value="${esc(k.imp?.impresa_email_ref || k.imp?.impresa_email2 || '')}"></div>
      <div class="field" style="flex:1 1 220px"><label>Alla c.a.</label><input type="text" id="mk-ca"></div>
      <div class="field" style="flex:0 0 170px"><label>Risposta entro</label><input type="date" id="mk-termine" value="${fra(GIORNI_TERMINE)}"></div>
    </div>`,
  '📄 Protocolla e prepara la mail', async () => {
    const a = $('#mk-a').value.trim();
    if (!a) { toast("Indica a chi va la proposta.", 'err'); return false; }
    const o = { termine: $('#mk-termine').value, saluto: $('#mk-ca').value.trim() ? `Egr. ${$('#mk-ca').value.trim()}` : `Spett.le ${d.impresa_nome}` };
    const corpo = corpoPropostaConferenza(k.caso, o);
    const oggetto = `Proposta di conferenza di cantiere — ${k.caso.cantiere_breve}`;
    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT', data_prot: oggiIso(), data_doc: oggiIso(), impresa_nome: k.imp?.impresa_nome || d.impresa_nome, impresa_id: d.impresa_id || null,
      persona: $('#mk-ca').value.trim() || null, oggetto, note: corpo,
      sintesi: `Proposta di conferenza di cantiere all'impresa — caso n° ${d.id} del registro cantieri critici. È una proposta: l'impresa non è obbligata.`,
      scadenze: o.termine ? `Risposta dell'impresa entro il ${dataIt(o.termine)}` : null,
      ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail', tipo_doc_id: TIPO_DOC_CONFERENZA,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);
    const { error } = await evento(d, 'conferenza_proposta', `Proposta all'impresa una conferenza di cantiere (${codiceProtocollo(nuovo)}).`, { protocollo_id: nuovo.id, dati: { sigla: siglaProtocollo(nuovo), a } });
    if (error) throw new Error(error.message);
    await sb.from('s_cantieri_critici').update({ stato: 'attesa_impresa', termine_il: o.termine || fra(GIORNI_TERMINE), gestione_note: d.gestione_note || null }).eq('id', d.id);
    const { scaricaEml } = await import('./eml.js');
    scaricaEml({ to: a, cc: [k.c.coordinatore_email].filter(Boolean), oggetto: `${oggetto} - Prot. ${siglaProtocollo(nuovo)}`, corpo, nomeFile: `proposta-conferenza-caso-${d.id}.eml` });
    toast(`Proposta protocollata (${codiceProtocollo(nuovo)}) e bozza scaricata.`, 'ok');
  });
}

async function demanda(d, eventi, dopo) {
  const k = await contesto(d);
  maschera(d, dopo, '🏛 Demanda a Presidenza / Commissione Sicurezza', `
    <p class="hint">Comunicazione interna: niente protocollo. Il caso passa «in attesa di decisione».
      Per la <strong>Presidenza</strong> (Presidente e Vicepresidente) è un passo vero: entrano nel gestionale con il link della mail e rispondono da lì, come già fa il Direttore — non serve più aspettare che qualcuno lo scriva a mano dopo.
      Per la <strong>Commissione Sicurezza</strong> resta solo la mail, come oggi: chi ha la nomina non ha un accesso proprio.</p>
    <div class="field"><label>A chi</label>
      <select id="mk-chi"><option value="presidenza">Presidenza</option><option value="commissione">Commissione Sicurezza (chi ha oggi la nomina)</option></select></div>
    <div class="field"><label>Due righe tue, in testa <span class="hint">(facoltative)</span></label><textarea id="mk-testo" rows="3" style="width:100%"></textarea></div>`,
  '📨 Registra e prepara la mail', async () => {
    const chi = $('#mk-chi').value;
    const premessa = $('#mk-testo').value.trim();
    let to = [];
    if (chi === 'presidenza') {
      const { error } = await sb.rpc('s_critico_coinvolgi_presidenza', { p_id: d.id, p_nota: premessa || null });
      if (error) throw new Error(error.message);
      to = [k.c.presidente_email || 'presidente@formedilpadova.it', k.c.vicepresidente_email || 'vicepresidente@formedilpadova.it'].filter(Boolean);
    } else {
      const { data: membri, error } = await sb.rpc('s_gruppo_destinatari', { p_codice: 'commissione_sicurezza' });
      if (error) throw new Error('Commissione Sicurezza non letta: ' + error.message);
      to = (membri || []).map((m) => m.email).filter(Boolean);
      if (!to.length) { toast('Nessun membro della Commissione con un indirizzo: controlla le nomine.', 'err'); return false; }
      const { error: e2 } = await sb.from('s_cantieri_critici_eventi').insert({ critico_id: d.id, tipo: 'demandata', visibile_tecnico: true,
        testo: 'Demandato alla Commissione Sicurezza.', dati: { chi: 'commissione', a: to } });
      if (e2) throw new Error(e2.message);
      await sb.from('s_cantieri_critici').update({ stato: 'attesa_decisione', gestione_note: d.gestione_note || null }).eq('id', d.id);
    }
    const link = `${GESTIONALE_URL}#critico-${d.id}`;
    const { scaricaEml } = await import('./eml.js');
    scaricaEml({
      to: to.join(', '), cc: [k.c.direttore_email || 'direzione@formedilpadova.it', k.c.coordinatore_email].filter(Boolean),
      oggetto: `Cantiere critico da valutare — ${k.caso.cantiere_breve} — ${d.impresa_nome}`,
      corpo: `${premessa ? premessa + '\n\n' : ''}${corpoDemanda(k.caso, eventi, k.verbali, chi)}${chi === 'presidenza' ? `\n\nApri il caso e rispondi da qui: ${link}` : ''}`,
      nomeFile: `demanda-caso-${d.id}.eml`,
    });
    toast(chi === 'presidenza' ? 'Coinvolta la Presidenza: hanno ricevuto un avviso nell\'app, e trovi qui la bozza della mail.' : 'Registrato: caso in attesa di decisione, bozza scaricata.', 'ok');
  });
}

async function registraDecisione(d, dopo) {
  maschera(d, dopo, '✍️ Decisione o conferma', `
    <p class="hint">Qui si scrive che cosa hanno deciso la Presidenza o la Commissione Sicurezza, e la conferma del Direttore. Resta in cronologia con la tua firma: scrivi come l'hai saputo (mail, verbale della Commissione, a voce).</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 220px"><label>Chi</label>
        <select id="mk-chi"><option value="Presidenza">Presidenza</option><option value="Commissione Sicurezza">Commissione Sicurezza</option><option value="Direttore">Direttore (conferma)</option></select></div>
      <div class="field" style="flex:1 1 220px"><label>Che cosa</label>
        <select id="mk-cosa"><option value="segnalare">segnalare agli organi di vigilanza</option><option value="non_segnalare">non segnalare</option><option value="altro">altro (scrivilo sotto)</option></select></div>
      <div class="field" style="flex:0 0 160px"><label>Il</label><input type="date" id="mk-data" value="${oggi()}" max="${oggi()}"></div>
    </div>
    <div class="field"><label>Come risulta, e le indicazioni date *</label><textarea id="mk-testo" rows="3" style="width:100%"></textarea></div>`,
  '💾 Registra', async () => {
    const testo = $('#mk-testo').value.trim();
    if (!testo) { toast('Scrivi come risulta la decisione.', 'err'); return false; }
    const chi = $('#mk-chi').value, cosa = $('#mk-cosa').value;
    const frase = { segnalare: 'segnalare agli organi di vigilanza', non_segnalare: 'non segnalare', altro: 'altro' }[cosa];
    const { error } = await sb.from('s_cantieri_critici_eventi').insert({
      critico_id: d.id, tipo: chi === 'Direttore' ? 'autorizzazione_direttore' : 'decisione_organo', visibile_tecnico: true,
      testo: `${chi}, ${dataIt($('#mk-data').value)}: ${frase}. ${testo}`, dati: { chi, cosa, data: $('#mk-data').value },
    });
    if (error) throw new Error(error.message);
    toast('Registrato in cronologia.', 'ok');
  });
}

/* La segnalazione riguarda un CANTIERE, non un verbale: si scelgono i verbali
   del cantiere e si cercano i PDF su Drive per nome (Verbale_NNNN_…), lasciando
   a chi firma la scelta del file giusto. Il merito lo scrive il coordinatore:
   finché c'è il segnaposto la mail non esce. */
async function segnalaOrgani(d, eventi, dopo) {
  const k = await contesto(d);
  const deciso = eventi.some((e) => e.tipo === 'decisione_organo' && e.dati?.cosa === 'segnalare');
  const confermato = eventi.some((e) => e.tipo === 'autorizzazione_direttore' && e.dati?.cosa === 'segnalare');
  const dest0 = destinatariSegnalazione('spisal_pc_itl', k.contatti);
  maschera(d, dopo, '📨 Segnalazione a SPISAL / ITL', `
    ${deciso && confermato ? '<p class="hint">✅ In cronologia risultano la decisione di segnalare e la conferma del Direttore.</p>'
      : `<div class="dt-doc-riga" style="background:#ffdcd6;border-radius:6px;padding:6px 8px">⚠️ In cronologia ${!deciso ? '<strong>non risulta la decisione</strong> di Presidenza / Commissione Sicurezza di segnalare' : ''}${!deciso && !confermato ? ' e ' : ''}${!confermato ? '<strong>non risulta la conferma del Direttore</strong>' : ''}. Registrale prima («Registra decisione o conferma», oppure «Chiedi conferma al Direttore», che la dà dall'app): qui ti verrà chiesto di confermare due volte.</div>`}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <div class="field" style="flex:1 1 260px"><label>A chi</label>
        <select id="sg-dest">${Object.entries(DESTINAZIONI).map(([v, [l]]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
      <label class="hint" style="align-self:flex-end;margin-bottom:10px"><input type="checkbox" id="sg-ceiv" checked> Cassa Edile in copia (${esc(k.contatti?.ceiv?.a || '—')})</label>
      <label class="hint" style="align-self:flex-end;margin-bottom:10px"><input type="checkbox" id="sg-int" checked> Direzione e coordinatore in copia</label>
    </div>
    <div class="hint" id="sg-chi"></div>
    <div class="field" style="margin-top:6px"><label>Verbali del cantiere da allegare</label>
      <div id="sg-verbali">${k.verbali.length ? k.verbali.map((v) => `<label style="display:block;font-weight:400"><input type="checkbox" class="sg-v" value="${esc(v.visita_id)}" ${v.segnalazione || v.visita_id === d.visita_id ? 'checked' : ''}>
        ${esc(v.nr_verbale)} del ${dataIt(v.data_visita)}${v.ipc ? ` — IPC ${esc(v.ipc)}` : ''}${v.segnalazione ? ' — <strong>propone la segnalazione</strong>' : ''}</label>`).join('')
        : '<span class="hint">Il caso non è agganciato a un cantiere dell\'anagrafica: i verbali si allegano a mano alla bozza.</span>'}</div>
      <button class="btn btn-ghost btn-sm" id="sg-cerca" ${k.verbali.length ? '' : 'disabled'}>🔎 Cerca i PDF su Drive</button>
      <div id="sg-file" class="hint" style="margin-top:4px"></div></div>
    <div class="field"><label>Testo <span class="hint">— lo scheletro è dell'app; ${d.testo_merito
          ? `il merito è quello scritto dal coordinatore nel gestionale (${esc(d.merito_da || '')}, ${oraIt(d.merito_il)})`
          : 'il merito lo scrive il coordinatore dal gestionale visite (riquadro «Cantieri critici»): finché manca resta il segnaposto'}</span></label>
      <textarea id="sg-testo" rows="14" style="width:100%"></textarea></div>`,
  '📄 Protocolla e prepara la bozza', async () => {
    const testo = $('#sg-testo').value.trim();
    if (testo.includes(SEGNAPOSTO_MERITO.slice(0, 14))) { toast('Nel testo c\'è ancora il segnaposto: il merito della segnalazione va scritto prima di protocollare.', 'err'); return false; }
    const dest = destinatariSegnalazione($('#sg-dest').value, k.contatti, $('#sg-ceiv').checked);
    if (!dest.a.length) { toast('Manca l\'indirizzo del destinatario: controlla s_config.organi_vigilanza_contatti.', 'err'); return false; }
    if ((!deciso || !confermato) && !confirm('In cronologia non risultano decisione e conferma. Una segnalazione agli organi di vigilanza la decidono Presidenza e Commissione Sicurezza, e la conferma il Direttore. Vuoi procedere lo stesso?')) return false;
    if (!confirm(`Protocollo in uscita la segnalazione per il cantiere di ${k.caso.cantiere_breve} e preparo la bozza per ${dest.a.join(', ')}. Procedo?`)) return false;

    const scelti = [...document.querySelectorAll('.sg-f:checked')].map((x) => ({ id: x.value, nome: x.dataset.nome }));
    const { leggiByte } = await import('./drive.js');
    const allegati = [];
    for (const f of scelti) allegati.push({ nome: f.nome, byte: await leggiByte(f.id) });

    const oggetto = oggettoSegnalazione(k.caso);
    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT', data_prot: oggiIso(), data_doc: oggiIso(), impresa_nome: d.impresa_nome, impresa_id: d.impresa_id || null,
      persona: dest.allaCa || null, oggetto: oggetto.replace(/^Invio /, ''), note: testo,
      sintesi: `Segnalazione agli organi di vigilanza — caso n° ${d.id} del registro cantieri critici. A: ${dest.a.join(', ')}; cc: ${dest.cc.join(', ') || '—'}. Allegati: ${scelti.map((f) => f.nome).join('; ') || 'nessuno dall\'app (da allegare a mano)'}.`,
      ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail', tipo_doc_id: TIPO_DOC_SEGNALAZIONE,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);
    for (const f of scelti) {
      await sb.from('s_prot_allegati').insert({ protocollo_id: nuovo.id, nome: f.nome, mime: 'application/pdf', principale: false,
        created_by: state.email, drive_file_id: f.id, drive_url: `https://drive.google.com/file/d/${f.id}/view` });
    }
    const { error } = await sb.from('s_cantieri_critici_eventi').insert({
      critico_id: d.id, tipo: 'segnalazione_organi', visibile_tecnico: true, protocollo_id: nuovo.id,
      testo: `Segnalazione agli organi di vigilanza ${codiceProtocollo(nuovo)} — a ${dest.a.join(', ')}${dest.cc.length ? '; per conoscenza ' + dest.cc.join(', ') : ''}.`,
      dati: { sigla: siglaProtocollo(nuovo), a: dest.a, cc: dest.cc, verbali: scelti.map((f) => f.nome) },
    });
    if (error) throw new Error('Segnalazione protocollata ma cronologia non aggiornata: ' + error.message);

    const interni = $('#sg-int').checked ? [k.c.direttore_email || 'direzione@formedilpadova.it', k.c.coordinatore_email] : [];
    const { scaricaEml } = await import('./eml.js');
    scaricaEml({
      to: dest.a.join(', '), cc: [...dest.cc, ...interni].filter(Boolean),
      oggetto: `${oggetto} Prot. ${siglaProtocollo(nuovo)}${dest.allaCa ? ` - alla c.a. ${dest.allaCa}` : ''}`,
      corpo: `Protocollo N° ${siglaProtocollo(nuovo)} del ${dataIt(nuovo.data_prot)} — Segreteria Area Sicurezza e Salute\n\n${testo}`,
      allegati, nomeFile: `segnalazione-organi-caso-${d.id}.eml`,
    });
    toast(`Segnalazione protocollata (${codiceProtocollo(nuovo)}). Bozza scaricata con ${allegati.length} allegati: rileggila e mandala da Outlook. Quando arriva un riscontro, aggiungilo in cronologia; poi chiudi il caso con l'esito «segnalata».`, 'ok');
  });

  const verbaliScelti = () => k.verbali.filter((v) => [...document.querySelectorAll('.sg-v:checked')].some((x) => x.value === v.visita_id));
  const rifai = () => {
    const dest = destinatariSegnalazione($('#sg-dest').value, k.contatti, $('#sg-ceiv').checked);
    $('#sg-chi').textContent = `A: ${dest.a.join(', ') || '—'} · Cc: ${dest.cc.join(', ') || '—'}`;
    const t = $('#sg-testo');
    if (!t.dataset.toccato) t.value = scheletroSegnalazione(k.caso, verbaliScelti(), dest.intestazione, d.testo_merito);
  };
  $('#sg-testo').addEventListener('input', () => { $('#sg-testo').dataset.toccato = '1'; });
  ['#sg-dest', '#sg-ceiv'].forEach((q) => $(q).addEventListener('change', rifai));
  document.querySelectorAll('.sg-v').forEach((x) => x.addEventListener('change', rifai));
  rifai();
  $('#sg-chi').textContent = `A: ${dest0.a.join(', ') || '—'} · Cc: ${dest0.cc.join(', ') || '—'}`;

  $('#sg-cerca').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Cerco…');
    try {
      const { sfoglia } = await import('./drive.js');
      const righe = [];
      for (const v of verbaliScelti()) {
        const num = String(v.nr_verbale || '').split('/').pop().replace(/\D/g, '').padStart(4, '0');
        const { voci } = await sfoglia({ cerca: `Verbale_${num}_` });
        const pdf = (voci || []).filter((f) => !f.cartella && /\.pdf$/i.test(f.nome || ''));
        /* lo stesso numero torna ogni esercizio: si propone spuntato solo il file che porta l'anno della visita */
        const anno = String(v.data_visita).slice(0, 4);
        righe.push(`<div><strong>${esc(v.nr_verbale)}</strong> del ${dataIt(v.data_visita)}: ${pdf.length ? pdf.map((f) =>
          `<label style="display:block;font-weight:400;margin-left:12px"><input type="checkbox" class="sg-f" value="${esc(f.id)}" data-nome="${esc(f.nome)}" ${f.nome.includes(`_${anno} `) ? 'checked' : ''}> ${esc(f.nome)}</label>`).join('')
          : '<em>nessun PDF trovato col nome «Verbale_' + num + '_…»: allegalo a mano alla bozza</em>'}</div>`);
      }
      $('#sg-file').innerHTML = righe.join('') || 'Spunta almeno un verbale.';
    } catch (e) { toast(e.message, 'err'); } finally { attendi(btn, false); }
  });
}

/* ── LA CONFERMA DEL DIRETTORE, DALL'APP (17/09/2026) ──────────
   Stesso disegno di «Autorizza dall'app» dei servizi: la segreteria prepara
   la mail col link #critico-<id>; il Direttore entra col suo accesso (vede il
   caso, non può gestirlo) e conferma o no. La riga in cronologia la scrive la
   funzione s_critico_conferma_direttore, che accetta solo lui. Resta la strada
   a mano («Registra decisione o conferma») per una conferma arrivata a voce o
   per mail. */
async function chiediConfermaDirettore(d, eventi, dopo) {
  const k = await contesto(d);
  const link = `${GESTIONALE_URL}#critico-${d.id}`;
  maschera(d, dopo, '🖊 Conferma del Direttore', `
    <p class="hint">Comunicazione interna: niente protocollo. Si prepara la bozza per il Direttore con il link che apre il caso nell'app; il caso passa «in attesa di decisione». ${eventi.some((e) => e.tipo === 'decisione_organo') ? '' : '<strong>In cronologia non c\'è ancora la decisione di Presidenza / Commissione Sicurezza</strong>: la mail lo dirà.'}</p>
    <div class="field"><label>A</label><input type="text" id="mk-a" value="${esc(k.c.direttore_email || 'direzione@formedilpadova.it')}"></div>
    <div class="field"><label>Due righe tue, in testa <span class="hint">(facoltative)</span></label><textarea id="mk-testo" rows="3" style="width:100%"></textarea></div>`,
  '📨 Registra e prepara la mail', async () => {
    const { error } = await sb.from('s_cantieri_critici_eventi').insert({ critico_id: d.id, tipo: 'demandata', visibile_tecnico: false,
      testo: 'Chiesta al Direttore la conferma della segnalazione agli organi di vigilanza.', dati: { chi: 'direttore', a: $('#mk-a').value.trim() } });
    if (error) throw new Error(error.message);
    await sb.from('s_cantieri_critici').update({ stato: 'attesa_decisione', gestione_note: d.gestione_note || null }).eq('id', d.id);
    const premessa = $('#mk-testo').value.trim();
    const { scaricaEml } = await import('./eml.js');
    scaricaEml({
      to: $('#mk-a').value.trim(), cc: [k.c.coordinatore_email].filter(Boolean),
      oggetto: `Richiesta di conferma — segnalazione agli organi di vigilanza — ${k.caso.cantiere_breve} — ${d.impresa_nome}`,
      corpo: `${premessa ? premessa + '\n\n' : ''}${corpoRichiestaConferma(k.caso, eventi, k.verbali, link)}`, nomeFile: `richiesta-conferma-direttore-caso-${d.id}.eml`,
    });
    toast('Registrato: caso in attesa di decisione, bozza per il Direttore scaricata.', 'ok');
  });
}

/* i casi su cui è stata chiesta la conferma e il Direttore non ha ancora risposto */
export async function inAttesaDelDirettore() {
  const { data: casi } = await sb.from('s_cantieri_critici').select('id, data_evento, impresa_nome, cantiere_desc, stato').not('stato', 'in', '(chiuso,annullato)');
  if (!casi?.length) return [];
  const { data: ev } = await sb.from('s_cantieri_critici_eventi').select('critico_id, tipo, created_at, dati')
    .in('critico_id', casi.map((c) => c.id)).in('tipo', ['demandata', 'autorizzazione_direttore']).order('created_at');
  return casi.filter((c) => {
    const miei = (ev || []).filter((e) => e.critico_id === c.id);
    const chiesta = miei.filter((e) => e.tipo === 'demandata' && e.dati?.chi === 'direttore').at(-1);
    return chiesta && !miei.some((e) => e.tipo === 'autorizzazione_direttore' && e.created_at > chiesta.created_at);
  });
}

/* dal link della mail (#critico-<id>): la segreteria apre il caso, il Direttore la sua maschera */
export async function apriDaLink(id) {
  return state.soloDirettore ? confermaDirettore(id) : dettaglio(id);
}

/* l'ingresso del Direttore: i casi che aspettano lui */
export async function elencoDirettore() {
  const casi = await inAttesaDelDirettore();
  if (!casi.length) return false;
  apriLargo('Cantieri critici — conferme richieste', '', `
    <p class="hint">Segnalazioni agli organi di vigilanza su cui è stata chiesta la tua conferma.</p>
    ${casi.map((c) => `<div class="hm-riga" data-cd="${c.id}" style="cursor:pointer"><span>⚠️</span>
      <span><strong>${esc(c.impresa_nome)}</strong> — ${esc(c.cantiere_desc)}</span><span class="hint">${dataIt(c.data_evento)}</span></div>`).join('')}`);
  $('#drawer-body').querySelectorAll('[data-cd]').forEach((r) => r.addEventListener('click', () => confermaDirettore(Number(r.dataset.cd))));
  return true;
}

export async function confermaDirettore(id) {
  const [{ data: d, error }, { data: eventi }] = await Promise.all([
    sb.from('s_cantieri_critici').select('*').eq('id', id).maybeSingle(),
    sb.from('s_cantieri_critici_eventi').select('*').eq('critico_id', id).order('created_at'),
  ]);
  if (error || !d) return toast('Caso non trovato' + (error ? ': ' + error.message : '.'), 'err');
  let verbali = [];
  if (d.cantiere_id) {
    const r = await sb.from('visite').select('nr_verbale, data_visita, ipc, segnalazione, elimina').eq('cantiere_id', d.cantiere_id).order('data_visita');
    verbali = (r.data || []).filter((v) => !v.elimina);
  }
  const fermo = FERMI.includes(d.stato);
  const gia = [...(eventi || [])].reverse().find((e) => e.tipo === 'autorizzazione_direttore');
  apriLargo(`⚠️ Cantiere critico n° ${d.id} — conferma della segnalazione`, '', `
    <div class="dt-doc-riga"><strong>Cantiere:</strong> ${esc(d.cantiere_desc)}</div>
    <div class="dt-doc-riga"><strong>Impresa:</strong> ${esc(d.impresa_nome)}</div>
    <div class="dt-doc-riga"><strong>Origine:</strong> ${esc((ORIGINI[d.origine] || [])[1] || d.origine)} — ${dataIt(d.data_evento)} · <strong>tecnico:</strong> ${esc(d.tecnico_nome || '—')}</div>
    <div class="dt-doc-riga" style="white-space:pre-wrap"><strong>Note del tecnico:</strong>\n${esc(d.note)}</div>
    ${verbali.length ? `<div class="dt-doc-riga"><strong>Verbali sul cantiere:</strong><br>${verbali.map((v) =>
      `${esc(v.nr_verbale)} del ${dataIt(v.data_visita)}${v.ipc ? ` — IPC ${esc(v.ipc)}` : ''}${v.segnalazione ? ' — <strong>il tecnico propone la segnalazione</strong>' : ''}`).join('<br>')}</div>` : ''}
    <div style="font-weight:600;margin:8px 0 4px">Cronologia</div>
    ${(eventi || []).filter((e) => e.tipo !== 'stato').map((e) => `<div class="dt-doc-riga" style="white-space:pre-wrap;font-size:12.5px"><span class="hint">${oraIt(e.created_at)}</span>
      <strong>${esc(EVENTI[e.tipo] || e.tipo)}</strong> ${e.testo ? `— ${esc(e.testo)}` : ''}</div>`).join('') || '<p class="hint">Ancora niente.</p>'}
    <hr style="margin:10px 0;border:0;border-top:1px solid var(--bordo)">
    ${fermo ? `<p class="hint">Il caso è ${esc((STATI[d.stato] || [])[1] || d.stato)}: non c'è niente da confermare.</p>` : `
      ${gia ? `<p class="hint">Hai già risposto: ${esc(gia.testo || '')} Puoi rispondere di nuovo: vale l'ultima.</p>` : ''}
      <p class="hint">Se segnalare lo decidono la Presidenza e la Commissione Sicurezza; qui dai la tua conferma. Resta in cronologia col tuo nome, data e ora. La segnalazione la prepara poi la segreteria.</p>
      <div class="field"><label>Una nota <span class="hint">(facoltativa)</span></label><textarea id="cd-nota" rows="3" style="width:100%"></textarea></div>
      <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="cd-no">⛔ Non confermo</button>
        <button class="btn btn-primary btn-sm" id="cd-si">✅ Confermo la segnalazione</button></div>`}`);
  const rispondi = async (btn, cosa) => {
    if (!confirm(cosa === 'segnalare' ? 'CONFERMI la segnalazione agli organi di vigilanza per questo cantiere?' : 'NON confermi la segnalazione?')) return;
    attendi(btn, true, 'Registro…');
    const { error: e } = await sb.rpc('s_critico_conferma_direttore', { p_id: d.id, p_cosa: cosa, p_nota: $('#cd-nota').value.trim() || null });
    attendi(btn, false);
    if (e) return toast('Non registrato: ' + e.message, 'err');
    toast('Registrato in cronologia. La segreteria lo vede nel caso.', 'ok');
    confermaDirettore(id);
  };
  $('#cd-si')?.addEventListener('click', (ev) => rispondi(ev.currentTarget, 'segnalare'));
  $('#cd-no')?.addEventListener('click', (ev) => rispondi(ev.currentTarget, 'non_segnalare'));
}
