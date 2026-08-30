/* ============================================================
   Pratiche di affidamento al servizio RLST.

   Le richieste arrivano dal modulo online e finiscono nel foglio
   Google; la funzione import-rlst (schedulata ogni mattina alle
   6:30, o il bottone «Importa adesso») le porta in s_rlst_pratiche
   con la pre-istruttoria già fatta: controllo CEIV sull'anagrafica,
   aggancio impresa per P.IVA, aggancio del legale rappresentante
   per codice fiscale.

   Qui si completa l'istruttoria: si verifica l'esito CEIV (la
   lista si aggiorna mensilmente — la data d'aggiornamento è
   scritta accanto all'esito), si crea l'impresa o la persona se
   mancano, si annota il verbale di non elezione. E si chiude:
   «Protocolla e prepara la risposta» genera la lettera giusta per
   l'esito (affidamento coi contatti RLST, o negativa non iscritta),
   la protocolla in uscita, la deposita nella cartella-pratica su
   Drive e scarica la bozza .eml — l'invio resta a una persona.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo, siglaProtocollo } from './core.js';
import { risolviCartella, sfoglia, creaCartella, caricaByte, leggiByte, idDaLink } from './drive.js';

let pratiche = [];
let filtroStato = 'aperte';

const STATI = {
  ricevuta: 'Ricevuta', istruita: 'Istruita', risposta_protocollata: 'Risposta protocollata',
  inviata: 'Inviata', chiusa: 'Chiusa', scartata: 'Scartata',
};
const ESITI = {
  iscritta: ['dt-ok', 'iscritta CEIV'],
  non_iscritta: ['dt-scaduto', 'NON iscritta'],
  da_verificare: ['dt-senzadata', 'da verificare'],
};

async function carica() {
  const { data } = await sb.from('s_rlst_pratiche').select('*').order('progressivo', { ascending: false });
  pratiche = data || [];
}

export async function render() {
  const host = $('#rlst-host');
  host.innerHTML = '<p class="empty">Un istante…</p>';
  await carica();

  const visibili = pratiche.filter((p) =>
    filtroStato === 'tutte' ? true :
    filtroStato === 'aperte' ? !['chiusa', 'scartata'].includes(p.stato) :
    p.stato === filtroStato);

  const righe = visibili.map((p) => {
    const [cls, lbl] = ESITI[p.esito_ceiv] || ['', p.esito_ceiv || '—'];
    return `<tr data-id="${p.id}">
      <td>${p.progressivo}</td>
      <td>${p.data_comp ? dataIt(p.data_comp) : p.timestamp_modulo ? dataIt(p.timestamp_modulo.slice(0, 10)) : '—'}</td>
      <td><strong>${esc(p.ragione_sociale || '?')}</strong></td>
      <td>${esc(p.partita_iva || '—')}</td>
      <td><span class="dt-cella ${cls}" style="padding:2px 8px">${esc(lbl)}</span></td>
      <td>${p.verbale_url || p.data_verbale ? '✓' : '—'}</td>
      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="dt-barra">
      <div class="seg" id="rlst-f">
        ${['aperte', 'tutte', 'chiusa'].map((s) =>
          `<button class="seg-btn ${filtroStato === s ? 'is-active' : ''}" data-val="${s}">${s === 'aperte' ? 'Da lavorare' : s === 'tutte' ? 'Tutte' : 'Chiuse'}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="rlst-importa">⟳ Importa adesso dal foglio</button>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>N°</th><th>Data</th><th>Impresa</th><th>P.IVA</th><th>CEIV</th><th>Verbale</th><th>Stato</th></tr></thead>
        <tbody>${righe || `<tr><td colspan="7" class="empty">Nessuna pratica ${filtroStato === 'aperte' ? 'da lavorare — quando arriva una richiesta nuova la trovi qui, già istruita' : ''}.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      L'import dal foglio gira da solo ogni mattina alle 6:30. Il PDF di riepilogo che arriva
      per mail resta il documento da protocollare: qui ci sono i dati, già controllati.
    </p>`;

  $('#rlst-f').addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (b) { filtroStato = b.dataset.val; render(); }
  });
  $('#rlst-importa').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true, 'Leggo il foglio…');
    const { data, error } = await sb.functions.invoke('import-rlst', { body: {} });
    attendi(ev.currentTarget, false);
    if (error || data?.error) return toast('Import non riuscito: ' + (data?.error || error.message), 'err');
    toast(data.nuove ? `${data.nuove} richieste nuove importate.` : 'Nessuna richiesta nuova.', 'ok');
    if (data.nuove) render();
  });
  host.querySelectorAll('tbody tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPratica(Number(tr.dataset.id))));
}

/* ── dettaglio e istruttoria ──────────────────────────────── */
async function apriPratica(id) {
  const p = pratiche.find((x) => x.id === id);
  if (!p) return;

  /* controllo CEIV dal vivo, con la data di aggiornamento della lista */
  let imp = null;
  if (p.partita_iva && /^\d{11}$/.test(p.partita_iva)) {
    const { data } = await sb.from('imprese')
      .select('impresa_id, impresa_nome, cod_ceiv, ce, cassa_edile, stato_cassa, data_agg_access, impresa_email_ref')
      .eq('impresa_id', p.partita_iva).maybeSingle();
    imp = data;
  }
  let per = null;
  if (p.rl_cf) {
    const { data } = await sb.from('persone').select('persona_id, cognome, nome, cf').eq('cf', p.rl_cf).limit(1);
    per = data?.[0] || null;
  }

  /* il requisito è «settore edile e iscritta CEIV»: il settore si legge
     dall'ATECO (divisioni 41, 42, 43 = costruzioni), dove registrato */
  let ateco = [];
  if (imp) {
    const { data } = await sb.from('imprese_ateco').select('codice, data_ateco')
      .eq('impresa_id', imp.impresa_id).order('data_ateco', { ascending: false, nullsFirst: false });
    ateco = data || [];
  }
  const edile = ateco.length ? ateco.some((a) => /^4[123]/.test(a.codice)) : null;

  const ceivRiga = imp
    ? `<div class="dt-quadro-riga">
         <span class="dt-dot ${imp.cod_ceiv && /attiv/i.test(imp.stato_cassa || '') ? 'dt-ok' : 'dt-scaduto'}"></span>
         <span class="dt-quadro-req">CEIV</span>
         <span class="dt-quadro-stato">${imp.cod_ceiv
             ? `cod. ${esc(imp.cod_ceiv)} — ${esc(imp.cassa_edile || '')} ${esc(imp.stato_cassa || '')}`
             : 'nessun codice CEIV in anagrafica'}
           ${imp.data_agg_access ? ` · lista al ${dataIt(imp.data_agg_access)}` : ''}</span>
       </div>`
    : `<div class="dt-quadro-riga"><span class="dt-dot dt-senzadata"></span>
         <span class="dt-quadro-req">CEIV</span>
         <span class="dt-quadro-stato">impresa non in anagrafica: da verificare sul portale CEIV
           (dichiarato nel modulo: ${esc(p.codice_ceiv_dich || '—')})</span></div>`;

  const campo = (l, v) => v ? `<div class="dt-doc-riga"><strong>${l}:</strong> ${esc(v)}</div>` : '';

  apriDrawer(`Richiesta n° ${p.progressivo} — ${p.ragione_sociale || ''}`, '', `
    ${ceivRiga}
    <div class="dt-quadro-riga">
      <span class="dt-dot ${imp ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Anagrafica impresa</span>
      <span class="dt-quadro-stato">${imp ? esc(imp.impresa_nome) : 'non censita'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${edile === true ? 'dt-ok' : edile === false ? 'dt-scaduto' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Settore edile (ATECO)</span>
      <span class="dt-quadro-stato">${edile === true
        ? `sì — ${esc(ateco.filter((a) => /^4[123]/.test(a.codice)).map((a) => a.codice).join(', '))}`
        : edile === false
          ? `codici registrati fuori dalle costruzioni: ${esc(ateco.map((a) => a.codice).join(', '))}`
          : 'nessun ATECO registrato: da verificare (visura o CEIV)'}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${per ? 'dt-ok' : 'dt-mancante'}"></span>
      <span class="dt-quadro-req">Legale rappresentante</span>
      <span class="dt-quadro-stato">${per ? esc(`${per.cognome} ${per.nome}`) : esc(`${p.rl_cognome || ''} ${p.rl_nome || ''} — non in anagrafica`)}</span>
    </div>
    <div class="dt-quadro-riga">
      <span class="dt-dot ${p.verbale_url || p.data_verbale ? 'dt-ok' : 'dt-senzadata'}"></span>
      <span class="dt-quadro-req">Verbale non elezione RLS</span>
      <span class="dt-quadro-stato">${p.data_verbale ? esc(`del ${p.data_verbale}${p.luogo_riunione ? ' — ' + p.luogo_riunione : ''}`) : 'non pervenuto: lo controllerà l’RLST alla presa in carico'}
        ${p.verbale_url ? ` · <a href="${esc(p.verbale_url)}" target="_blank" rel="noopener">apri</a>` : ''}</span>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    ${campo('Compilato il', p.data_comp ? dataIt(p.data_comp) : p.timestamp_modulo)}
    ${campo('P.IVA', p.partita_iva)}${campo('CF impresa', p.cf_impresa)}
    ${campo('Lavoratori', p.n_lavoratori)}${campo('CCNL', p.ccnl)}
    ${campo('Sede legale', [p.ind_sede_legale, p.comune_legale].filter(Boolean).join(' — '))}
    ${campo('Sede amm.', [p.ind_sede_amm, p.comune_amm].filter(Boolean).join(' — '))}
    ${campo('Telefono', [p.telefono, p.cellulare].filter(Boolean).join(' / '))}
    ${campo('Email', p.email)}
    ${campo('Legale rappr.', [p.rl_titolo, p.rl_nome, p.rl_cognome, p.rl_cf].filter(Boolean).join(' '))}
    ${campo('RSPP', [p.rspp_nome, p.rspp_ruolo].filter(Boolean).join(' — '))}
    ${campo('Note del modulo', p.note_modulo)}

    <hr style="margin:14px 0;border:0;border-top:1px solid var(--bordo)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label>Stato pratica</label>
        <select id="rl-stato">${Object.entries(STATI).map(([k, l]) =>
          `<option value="${k}" ${p.stato === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Esito CEIV</label>
        <select id="rl-esito">${Object.keys(ESITI).map((k) =>
          `<option value="${k}" ${p.esito_ceiv === k ? 'selected' : ''}>${ESITI[k][1]}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-top:8px"><label>Note dell'ufficio</label>
      <textarea id="rl-note">${esc(p.note_ufficio || '')}</textarea></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
      ${p.partita_iva ? `
        <button class="btn btn-ghost" data-verifica="https://www.ufficiocamerale.it/trova-azienda">🔎 ufficiocamerale.it</button>
        <button class="btn btn-ghost" data-verifica="https://www.registroimprese.it/ricerca-libera-e-acquisto">🔎 registroimprese.it</button>` : ''}
      ${!imp && p.partita_iva ? '<button class="btn btn-ghost" id="rl-crea-imp">+ Crea impresa in anagrafica</button>' : ''}
      <button class="btn btn-ghost" id="rl-prot-in">📥 Protocolla la richiesta (IN)</button>
      <button class="btn btn-primary" id="rl-salva">Salva</button>
    </div>

    ${['ricevuta', 'istruita'].includes(p.stato) ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">Risposta all'impresa</h4>
    <p class="hint" style="margin:0 0 10px">
      ${p.esito_ceiv === 'iscritta'
        ? 'Lettera di <strong>affidamento</strong> coi contatti degli RLST di ASC Veneto.'
        : p.esito_ceiv === 'non_iscritta'
          ? 'Lettera <strong>negativa</strong>: non iscritta CEIV, la richiesta va all&rsquo;organismo paritetico di categoria.'
          : 'Esito CEIV ancora <strong>da verificare</strong>: decidilo qui sopra prima di preparare la risposta.'}
      La lettera nasce già protocollata in uscita, col numero nel nome, nella cartella della pratica su Drive;
      la bozza mail si apre in Outlook e la invii tu.
    </p>
    <button class="btn btn-primary" id="rl-risposta" ${p.esito_ceiv === 'da_verificare' ? 'disabled' : ''}>
      📄 Protocolla e prepara la risposta
    </button>` : ''}

    ${p.protocollo_out_id ? `
    <hr style="margin:16px 0;border:0;border-top:1px solid var(--bordo)">
    <p class="hint">Risposta protocollata${p.lettera_drive_url ? ` — <a href="${esc(p.lettera_drive_url)}" target="_blank" rel="noopener">apri la lettera su Drive</a>` : ''}.</p>
    <button class="btn btn-ghost" id="rl-eml">📧 Scarica di nuovo la bozza mail</button>` : ''}
  `);

  /* controllo manuale sui siti camerali: entrambe le ricerche sono
     POST senza P.IVA nell'indirizzo — si copia e si apre */
  $('#drawer-body').querySelectorAll('[data-verifica]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p.partita_iva); toast(`P.IVA ${p.partita_iva} copiata: incollala nella ricerca.`, 'ok'); }
    catch { toast('Non riesco a copiare la P.IVA: scrivila a mano — ' + p.partita_iva, 'err'); }
    window.open(b.dataset.verifica, '_blank', 'noopener');
  }));

  $('#rl-crea-imp')?.addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('imprese').insert({
      impresa_id: p.partita_iva,
      impresa_nome: p.ragione_sociale,
      indirizzo: p.ind_sede_legale,
      comune: p.comune_legale,
      impresa_email_ref: p.email,
      impresa_telefono: p.telefono,
      cod_ceiv: p.codice_ceiv_dich,
      note_access: `Creata dalla richiesta RLST n° ${p.progressivo} (${state.email})`,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast('Creazione non riuscita: ' + error.message, 'err');
    await sb.from('s_rlst_pratiche').update({ impresa_id: p.partita_iva, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', p.id);
    toast('Impresa creata in anagrafica (codice CEIV come dichiarato nel modulo: verificalo).', 'ok');
    await render();
    apriPratica(id);
  });

  $('#rl-prot-in')?.addEventListener('click', async () => {
    chiudiDrawer();
    const mod = await import('./protocollo.js');
    mod.apriForm('IN', {
      data_prot: oggiIso(),
      data_doc: p.data_comp || (p.timestamp_modulo || '').slice(0, 10) || null,
      impresa_nome: p.ragione_sociale,
      impresa_id: imp?.impresa_id || null,
      persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
      oggetto: 'Richiesta di affidamento al servizio di RLS-T',
      note: `Richiesta n° ${p.progressivo} del modulo online${p.data_comp ? ` del ${dataIt(p.data_comp)}` : ''}. ` +
        `Lavoratori: ${p.n_lavoratori ?? '?'} — Cod. CEIV dichiarato: ${p.codice_ceiv_dich || '—'} — ` +
        `RSPP: ${[p.rspp_nome, p.rspp_ruolo].filter(Boolean).join(', ') || '—'}` +
        `${p.note_modulo ? ` — Note: ${p.note_modulo}` : ''}`,
      tipo_doc_id: 52,
      mezzo: 'e-mail',
      cartella: '2_AREE/Servizi_CPT/RLST',
    }, true);
    toast('Maschera IN precompilata: allega il PDF di riepilogo e salva.', 'ok');
  });

  $('#rl-risposta')?.addEventListener('click', (ev) => preparaRisposta(p, imp, ev.currentTarget));
  $('#rl-eml')?.addEventListener('click', (ev) => bozzaMail(p, ev.currentTarget));

  $('#rl-salva').addEventListener('click', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_rlst_pratiche').update({
      stato: $('#rl-stato').value,
      esito_ceiv: $('#rl-esito').value,
      note_ufficio: $('#rl-note').value.trim() || null,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Pratica aggiornata.', 'ok');
    render();
  });
}

/* ══════════ RISPOSTA: lettera + protocollo OUT + Drive + mail ══════════
   L'ordine è quello delle regole del vault: prima il protocollo (il
   numero lo assegna il database, registro unico), poi la lettera che
   nasce già col numero dentro, poi il deposito nella cartella-pratica
   NN_IMPRESA su Drive, e per ultima la bozza .eml — che la manda una
   persona da Outlook, come sempre. */

const slugImpresa = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(srls?|snc|sas|spa|scarl|s\.r\.l\.s?|s\.n\.c\.|s\.a\.s\.|s\.p\.a\.)\b/gi, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 40);

/* La cartella della pratica in 2_AREE/Servizi_CPT/RLST: NN_IMPRESA,
   dove NN è il progressivo di affidamento. Se esiste la si riusa,
   altrimenti si crea col numero successivo all'ultimo. */
async function cartellaPratica(p) {
  const r = await risolviCartella('2_AREE/Servizi_CPT/RLST');
  if (!r.id) throw new Error('Cartella RLST non trovata su Drive');
  const { voci } = await sfoglia({ parentId: r.id });
  const cartelle = voci.filter((v) => v.cartella);
  const nome = slugImpresa(p.ragione_sociale);
  const trovata = cartelle.find((v) => {
    const m = v.nome.match(/^\d+_(.+)$/);
    return (m && slugImpresa(m[1]) === nome) || slugImpresa(v.nome) === nome;
  });
  if (trovata) return { id: trovata.id, nome: trovata.nome, creata: false };
  const max = Math.max(0, ...cartelle.map((v) => Number((v.nome.match(/^(\d+)_/) || [])[1] || 0)));
  const nuovoNome = `${String(max + 1).padStart(2, '0')}_${nome}`;
  const c = await creaCartella(r.id, nuovoNome);
  return { id: c.id, nome: c.nome, creata: true };
}

function oggettoRisposta(esito) {
  return esito === 'iscritta'
    ? 'Affidamento al servizio di RLS-T'
    : 'Richiesta di affidamento al servizio di RLS-T — impresa non iscritta CEIV';
}

async function preparaRisposta(p, imp, btn) {
  if (!['iscritta', 'non_iscritta'].includes(p.esito_ceiv)) {
    return toast("Decidi prima l'esito CEIV (iscritta / non iscritta).", 'err');
  }
  const esito = p.esito_ceiv;
  if (!confirm(`Preparo la lettera di ${esito === 'iscritta' ? 'AFFIDAMENTO' : 'NON affidamento (non iscritta CEIV)'} per ${p.ragione_sociale}, protocollata in uscita. Procedo?`)) return;

  attendi(btn, true, 'Preparo…');
  try {
    /* configurazione: contatti RLST e nota */
    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['rlst_contatti', 'rlst_nota_url']);
    const conf = Object.fromEntries((cfg || []).map((r) => [r.chiave, r.valore]));
    const contatti = JSON.parse(conf.rlst_contatti || '[]');
    const notaUrl = (conf.rlst_nota_url || '').trim();

    const { corpoAffidamento, corpoNegativa, generaLetteraPdf } = await import('./rlst-lettera.js');
    const paragrafi = esito === 'iscritta' ? corpoAffidamento(p, contatti, notaUrl) : corpoNegativa(p);
    const oggettoRiga = `Vostra richiesta${p.data_comp ? ` del ${dataIt(p.data_comp)}` : ''} per l'affidamento al servizio di Rappresentante dei Lavoratori per la Sicurezza Territoriale.`;

    /* cartella della pratica (prima del protocollo: il suo percorso
       finisce nel campo «cartella» del registro) */
    const cart = await cartellaPratica(p);
    const percorso = `2_AREE/Servizi_CPT/RLST/${cart.nome}`;

    /* protocollo OUT: il numero lo assegna il database */
    const { data: nuovo, error: errProt } = await sb.rpc('s_crea_protocollo', { p: {
      direzione: 'OUT',
      data_prot: oggiIso(),
      data_doc: oggiIso(),
      impresa_nome: p.ragione_sociale,
      impresa_id: imp?.impresa_id || null,
      persona: [p.rl_cognome, p.rl_nome].filter(Boolean).join(' ') || null,
      oggetto: oggettoRisposta(esito),
      note: paragrafi.join('\n\n'),
      sintesi: `Risposta alla richiesta RLST n° ${p.progressivo} del modulo online — esito: ${esito === 'iscritta' ? 'affidamento' : 'non iscritta CEIV'}.`,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      mezzo: 'e-mail',
      tipo_doc_id: 52,
      tipo_doc_txt: 'Affidamento RLST',
      cartella: percorso,
    } });
    if (errProt) throw new Error('Protocollazione non riuscita: ' + errProt.message);

    /* la lettera, col numero già dentro */
    const pdfByte = await generaLetteraPdf(p, nuovo, paragrafi, oggettoRiga);
    const data = oggiIso().replace(/-/g, '_');
    const nomeFile = `${data}_COMU_Formedil-Padova_${esito === 'iscritta'
      ? 'affidamento-servizio-RLST-a' : 'non-affidamento-RLST-a'}-${slugImpresa(p.ragione_sociale)}.pdf`;
    const su = await caricaByte(nuovo, nomeFile, pdfByte, 'application/pdf', cart.id);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: nuovo.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: pdfByte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', nuovo.id);

    await sb.from('s_rlst_pratiche').update({
      stato: 'risposta_protocollata',
      protocollo_out_id: nuovo.id,
      lettera_drive_id: su.drive_file_id,
      lettera_drive_url: su.drive_url,
      impresa_id: imp?.impresa_id || p.impresa_id,
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id);

    await scaricaEmlRisposta(p, nuovo, [{ nome: su.file_name || nomeFile, byte: pdfByte }], esito, contatti);
    toast(`Lettera protocollata (${codiceProtocollo(nuovo)}) e depositata in ${cart.nome}. Bozza mail scaricata: aprila da Outlook e premi Invia.`, 'ok');
    await render();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* Riscaricare la bozza mail di una risposta già protocollata. */
async function bozzaMail(p, btn) {
  attendi(btn, true, 'Rileggo la lettera…');
  try {
    const { data: prot } = await sb.from('s_protocollo').select('*').eq('id', p.protocollo_out_id).single();
    const { data: cfg } = await sb.from('s_config').select('chiave, valore').eq('chiave', 'rlst_contatti');
    const contatti = JSON.parse(cfg?.[0]?.valore || '[]');
    const byte = await leggiByte(p.lettera_drive_id);
    const nome = `${siglaProtocollo(prot)}_lettera.pdf`;
    await scaricaEmlRisposta(p, prot, [{ nome, byte }], p.esito_ceiv, contatti);
    toast('Bozza scaricata: aprila da Outlook e premi Invia.', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    attendi(btn, false);
  }
}

/* La bozza .eml, ricalcata sulla mail vera dell'ufficio (esempio del
   05/05/2026): oggetto col protocollo, copia conoscenza al Direttore
   e — nell'affidamento — all'RLST competente, corpo con «e.p.c.»,
   firma e nota privacy. In allegato la lettera e, se raggiungibile,
   il verbale di non elezione caricato col modulo. X-Unsent la fa
   aprire a Outlook in composizione: l'invio resta a una persona. */
async function scaricaEmlRisposta(p, prot, allegati, esito, contatti) {
  const competente = (contatti || []).find((c) => c.competente);

  /* il verbale di non elezione viaggia insieme alla lettera, come
     nella prassi: si prova a leggerlo da Drive, e se non si riesce
     la bozza parte lo stesso (lo si allega a mano) */
  if (esito === 'iscritta' && p.verbale_url) {
    try {
      const vid = idDaLink(p.verbale_url);
      if (vid) allegati.push({ nome: `verbale-non-elezione-RLS-${slugImpresa(p.ragione_sociale)}.pdf`, byte: await leggiByte(vid) });
    } catch { toast('Verbale non scaricabile da Drive: allegalo a mano alla bozza.', 'err'); }
  }

  const rl = [p.rl_cognome, p.rl_titolo || 'Sig.', p.rl_nome].filter(Boolean).join(' ');
  const corpo = `Prot. n°: ${siglaProtocollo(prot)}

Prevenzione infortuni.

Oggetto: ${oggettoRisposta(esito)}

Spett.le ${(p.ragione_sociale || '').toUpperCase()},
${rl ? `Alla c.a. ${rl}` : ''}${esito === 'iscritta' && competente ? `
e.p.c.
RLST ${competente.nome}` : ''}

Vogliate trovare in allegato la comunicazione in oggetto.

Distinti saluti.

Renato Squizzato
Area Sicurezza e Salute | FORMEDIL PADOVA

Via Basilicata 10
35127 Padova (PD)
email: cpt@formedilpadova.it
Tel. +39 049761168 (int.4) e Fax. +39 049760940
URL: https://www.formedilpadova.it

Organismo Accreditato Regione Veneto
per la formazione L.R. n. 19 del 09.08.02 cod. AO119
per i servizi al lavoro codice L236

__________________________________________________________________________

Ai sensi del Regolamento (UE) 2016/679 (GDPR) relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, la presente e-mail è destinata unicamente alle persone sopra indicate e le informazioni in essa contenute sono da considerarsi strettamente riservate. Se avete ricevuto questo messaggio per errore, siete pregati di rispedirlo al mittente, distruggendo qualunque copia in Vostro possesso, grazie.`;

  const inB64 = (byte) => {
    let s = '';
    const PEZZO = 0x8000;
    for (let i = 0; i < byte.length; i += PEZZO) s += String.fromCharCode(...byte.subarray(i, i + PEZZO));
    return btoa(s).replace(/(.{76})/g, '$1\r\n');
  };

  const cc = ['direzione@formedilpadova.it'];
  if (esito === 'iscritta' && competente?.email) cc.push(competente.email);

  const oggetto = `Formedil Padova - Area Sicurezza e Salute - Invio comunicazione richiesta di affidamento al servizio RLST - ${siglaProtocollo(prot)}`;
  const oggettoCod = /^[\x20-\x7e]*$/.test(oggetto) ? oggetto
    : '=?utf-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(oggetto))) + '?=';
  const B = 'Bozza-RLST-Formedil';
  const eml = [
    'X-Unsent: 1',
    `To: ${p.email || ''}`,
    `Cc: ${cc.join(', ')}`,
    `Subject: ${oggettoCod}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${B}"`,
    '',
    `--${B}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    corpo,
    '',
    ...allegati.flatMap((a) => [
      `--${B}`,
      `Content-Type: application/pdf; name="${a.nome}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.nome}"`,
      '',
      inB64(a.byte),
    ]),
    `--${B}--`,
  ].join('\r\n');

  const bytes = new TextEncoder().encode(eml);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'message/rfc822' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `risposta-rlst-${slugImpresa(p.ragione_sociale)}.eml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
