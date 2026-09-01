/* ============================================================
   CRUSCOTTO — la prima pagina dell'app (chiesto dall'utente il
   01/09/2026): non si apre più sul registro protocollo ma su un
   quadro di controllo che dice che cosa c'è da fare.

   Regola del vault «una lista di task non è lo stato del mondo»:
   il cruscotto NON dichiara verità sue — conta le righe delle
   tabelle vere e ci porta sopra con un click. Dove il giudizio
   richiede la logica della sua pagina (es. il rinnovo tacito dei
   documenti tecnici) si dice «da controllare», non «scaduto».
   ============================================================ */

import { sb, $, esc, dataIt, oggiIso, mostraVista, codiceProtocollo } from './core.js';

const SERVIZI = [
  { tab: 's_segnalazioni', vista: 'segnalazioni', nome: 'Segnalazione', icona: '🚨', chi: (p) => p.notificante },
  { tab: 's_consulenze', vista: 'consulenze', nome: 'Consulenza', icona: '💬', chi: (p) => p.ragione_sociale },
  { tab: 's_visite_richieste', vista: 'visite', nome: 'Richiesta visita', icona: '🏗️', chi: (p) => p.ragione_sociale },
  { tab: 's_conferenze_cantiere', vista: 'conferenze', nome: 'Conferenza', icona: '🎓', chi: (p) => p.ragione_sociale },
  { tab: 's_attestazioni_dm132', vista: 'attestazioni', nome: 'Attestazione DM 132', icona: '🪪', chi: (p) => p.ragione_sociale },
];
const CHIUSE = ['chiusa', 'scartata', 'annullata', 'rilasciata'];

const apriPratica = (vista, id) =>
  document.dispatchEvent(new CustomEvent('apri-pratica', { detail: { vista, id } }));

export async function render() {
  const host = $('#home-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';

  const oggi = oggiIso();
  const fra60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [servizi, { data: rlst }, { data: docTecTutti }, { data: corsi }, { data: prot }, { data: tecAttivi }] = await Promise.all([
    Promise.all(SERVIZI.map(async (s) => {
      const { data } = await sb.from(s.tab).select('*').order('id', { ascending: false }).limit(400);
      return { ...s, righe: (data || []).filter((p) => !CHIUSE.includes(p.stato)) };
    })),
    sb.from('s_rlst_pratiche').select('id, progressivo, ragione_sociale, stato, timestamp_modulo').neq('stato', 'chiusa'),
    sb.from('s_doc_tecnico').select('id, tecnico_id, persona_txt, descrizione, data_fine, senza_scadenza, disdetto_il')
      .eq('senza_scadenza', false).not('data_fine', 'is', null).lte('data_fine', fra60),
    sb.from('s_corsi').select('id, titolo, tipo, stato, data_inizio').not('stato', 'in', '("chiuso","annullato")'),
    sb.from('s_protocollo').select('*').order('id', { ascending: false }).limit(6),
    sb.from('tecnici').select('tecnico_id').eq('attivo', true),
  ]);
  /* contano solo i documenti dei tecnici ATTIVI: gli altri sono storia */
  const attivi = new Set((tecAttivi || []).map((t) => t.tecnico_id));
  const docTec = (docTecTutti || []).filter((d) => attivi.has(d.tecnico_id));

  /* ── i tre mucchi che contano ── */
  const daAutorizzare = [];
  const daEseguire = [];
  for (const s of servizi) {
    for (const p of s.righe) {
      const riga = {
        vista: s.vista, id: p.id, icona: s.icona, nome: s.nome,
        chi: s.chi(p) || '?', quando: p.timestamp_modulo ? p.timestamp_modulo.slice(0, 10) : null,
        n: p.progressivo ?? `m${p.id}`,
      };
      if (['da_richiedere', 'richiesta'].includes(p.aut_stato)) daAutorizzare.push(riga);
      else if (p.aut_stato === 'approvata' && !['svolta'].includes(p.stato)) daEseguire.push(riga);
    }
  }
  daAutorizzare.sort((a, b) => String(a.quando || '').localeCompare(String(b.quando || '')));

  /* segnalazioni aperte: hanno anche il loro riquadro, oltre ai mucchi
     autorizzativi comuni (chiesto dall'utente il 01/09) */
  const segnalazioni = servizi.find((s) => s.vista === 'segnalazioni').righe;

  /* consulenze in corsia immediata: il giro segreteria→coordinatore→impresa */
  const cons = servizi.find((s) => s.vista === 'consulenze').righe;
  const consDaGirare = cons.filter((p) => p.corsia !== 'uscita' && !p.girata_il && !p.risposta);
  const consInAttesa = cons.filter((p) => p.girata_il && !p.risposta);
  const consDaTrasmettere = cons.filter((p) => p.risposta && !p.trasmessa_il);

  const docScaduti = (docTec || []).filter((d) => !d.disdetto_il && d.data_fine < oggi);
  const docInScadenza = (docTec || []).filter((d) => !d.disdetto_il && d.data_fine >= oggi);

  const rigaPratica = (r) => `
    <div class="hm-riga" data-vista="${r.vista}" data-id="${r.id}">
      <span>${r.icona}</span>
      <span><strong>${esc(r.nome)} n° ${esc(String(r.n))}</strong> — ${esc(r.chi)}</span>
      <span class="hint">${r.quando ? dataIt(r.quando) : ''}</span>
    </div>`;

  const card = (titolo, conteggio, corpo, azione = '') => `
    <div class="hm-card ${conteggio ? '' : 'hm-vuota'}">
      <div class="hm-testa"><h3>${titolo}</h3><span class="hm-n ${conteggio ? 'hm-n-attivo' : ''}">${conteggio}</span></div>
      ${corpo}${azione}
    </div>`;

  const vai = (vista, etichetta) => `<button class="btn btn-ghost btn-sm hm-vai" data-goto="${vista}">${etichetta} →</button>`;

  host.innerHTML = `
    <div class="hm-griglia">

      ${card('⏳ In attesa del Direttore', daAutorizzare.length,
        daAutorizzare.length
          ? daAutorizzare.slice(0, 8).map(rigaPratica).join('') + (daAutorizzare.length > 8 ? `<p class="hint">…e altre ${daAutorizzare.length - 8}.</p>` : '')
          : '<p class="hint">Nessuna pratica da autorizzare.</p>')}

      ${card('✅ Autorizzate — da eseguire', daEseguire.length,
        daEseguire.length
          ? daEseguire.slice(0, 8).map(rigaPratica).join('') + (daEseguire.length > 8 ? `<p class="hint">…e altre ${daEseguire.length - 8}.</p>` : '')
          : '<p class="hint">Niente in coda: le autorizzate sono state svolte.</p>')}

      ${card('💬 Consulenze — corsia immediata', consDaGirare.length + consInAttesa.length + consDaTrasmettere.length, `
        <div class="hm-riga" data-goto="consulenze"><span>📨</span><span>Da girare al coordinatore</span><span class="hm-mini">${consDaGirare.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>⏱</span><span>In attesa della risposta del coordinatore</span><span class="hm-mini">${consInAttesa.length}</span></div>
        <div class="hm-riga" data-goto="consulenze"><span>📤</span><span>Risposta pronta, da trasmettere all'impresa</span><span class="hm-mini">${consDaTrasmettere.length}</span></div>`,
        vai('consulenze', 'Apri le consulenze'))}

      ${card('🚨 Segnalazioni cantiere', segnalazioni.length,
        segnalazioni.length
          ? segnalazioni.slice(0, 6).map((p) => `
            <div class="hm-riga" data-vista="segnalazioni" data-id="${p.id}"><span>🚨</span>
              <span><strong>n° ${esc(String(p.progressivo ?? `m${p.id}`))}</strong> — ${esc(p.notificante || '?')}${p.comune_cantiere ? ` · ${esc(p.comune_cantiere)}` : ''}</span>
              <span class="hint">${esc(p.stato)}${['da_richiedere', 'richiesta'].includes(p.aut_stato) ? ' · dal Direttore' : ''}</span></div>`).join('')
          : '<p class="hint">Nessuna segnalazione aperta.</p>',
        vai('segnalazioni', 'Apri le segnalazioni'))}

      ${card('🦺 Pratiche RLST aperte', (rlst || []).length,
        (rlst || []).length
          ? (rlst || []).slice(0, 6).map((p) => `
            <div class="hm-riga" data-goto="rlst"><span>🦺</span>
              <span><strong>n° ${esc(String(p.progressivo ?? p.id))}</strong> — ${esc(p.ragione_sociale || '?')}</span>
              <span class="hint">${esc(p.stato)}</span></div>`).join('')
          : '<p class="hint">Nessuna pratica aperta.</p>',
        vai('rlst', 'Apri le pratiche RLST'))}

      ${card('🗂️ Documenti dei tecnici', docScaduti.length + docInScadenza.length, `
        <p class="hint" style="margin:0 0 6px">Con data di fine passata o entro 60 giorni — <strong>fa fede la pagina</strong>
        (lì si vede anche il rinnovo tacito):</p>
        ${docScaduti.slice(0, 4).map((d) => `
          <div class="hm-riga" data-goto="doc-tecnici"><span>⛔</span>
            <span>${esc(d.persona_txt || '?')} — ${esc(d.descrizione || '')}</span>
            <span class="hint">${dataIt(d.data_fine)}</span></div>`).join('')}
        ${docInScadenza.slice(0, 4).map((d) => `
          <div class="hm-riga" data-goto="doc-tecnici"><span>⚠️</span>
            <span>${esc(d.persona_txt || '?')} — ${esc(d.descrizione || '')}</span>
            <span class="hint">${dataIt(d.data_fine)}</span></div>`).join('')}`,
        vai('doc-tecnici', 'Apri i documenti tecnici'))}

      ${card('📖 Formazione in corso', (corsi || []).length,
        (corsi || []).length
          ? (corsi || []).slice(0, 6).map((c) => `
            <div class="hm-riga" data-vista-corso="${c.id}"><span>📖</span>
              <span><strong>n° ${c.id}</strong> — ${esc((c.titolo || '').slice(0, 55))}</span>
              <span class="hint">${esc(c.stato)}${c.data_inizio ? ` · ${dataIt(c.data_inizio)}` : ''}</span></div>`).join('')
          : '<p class="hint">Nessun corso aperto.</p>',
        vai('corsi', 'Apri i corsi'))}

      ${card('📚 Ultimi protocolli', '', `
        ${(prot || []).map((r) => `
          <div class="hm-riga" data-goto="registro"><span>${r.direzione === 'IN' ? '📥' : '📤'}</span>
            <span><strong>${esc(codiceProtocollo(r))}</strong> — ${esc((r.oggetto || '').slice(0, 60))}</span>
            <span class="hint">${dataIt(r.data_prot)}</span></div>`).join('')}`,
        vai('registro', 'Apri il registro'))}
    </div>
    <p class="hint" style="margin-top:12px">Il cruscotto conta le righe delle tabelle, non tiene una lista sua:
      un click porta sempre sulla pratica vera. Le pratiche chiuse e scartate non compaiono.</p>`;

  host.querySelectorAll('.hm-riga[data-vista]').forEach((r) =>
    r.addEventListener('click', () => apriPratica(r.dataset.vista, Number(r.dataset.id))));
  host.querySelectorAll('[data-vista-corso]').forEach((r) =>
    r.addEventListener('click', async () => {
      document.dispatchEvent(new CustomEvent('apri-pratica', { detail: { vista: 'corsi', id: Number(r.dataset.vistaCorso) } }));
    }));
}
