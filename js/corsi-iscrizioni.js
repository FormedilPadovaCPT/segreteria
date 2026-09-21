/* ============================================================================
   ISCRIZIONI A UN EVENTO — nella scheda del corso              (18/09/2026)

   Un motore solo per due cose che finora erano separate:
   · l'iscrizione a una lezione di un progetto finanziato (prima un modulo
     Google, vedi «Comunicare la sicurezza», «Sicuri si diventa»);
   · il modulo anagrafiche che si manda all'impresa dopo una conferenza di
     cantiere (formedilpadovacpt.github.io/conferenza-cantiere/, che scriveva
     su un foglio che NESSUNO importava).

   Cambia solo la porta d'ingresso — l'elenco pubblico del portale, oppure un
   link targato — non quello che si chiede.

   ⚠️ QUELLO CHE ARRIVA NON È UN ISCRITTO: È UNA RICHIESTA. È qui che si
   fermano i doppioni di persone e di imprese, ed è la ragione per cui il
   giro esiste (decisione riferita dall'utente il 18/09). L'istruttoria
   propone: codice fiscale = corrispondenza forte, nominativo = somiglianza.
   Conferma la segreteria, e l'anagrafica nuova nasce solo se lo chiede lei.
   ============================================================================ */

import { sb, state, $, esc, dataIt, toast, attendi, apriDrawer } from './core.js';
import { scaricaEml } from './eml.js';

const SEMAFORO = {
  verde: ['🟢', 'persona nuova'],
  giallo: ['🟡', 'forse è già in anagrafica'],
  rosso: ['🔴', 'già iscritta a questo evento'],
};

function quandoChiude(iso) {
  if (!iso) return 'senza scadenza';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'senza scadenza';
  const ora = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dataIt(d.toISOString().slice(0, 10))} alle ${ora}`;
}

/* ── i dati: link, situazione, richieste in coda ── */
export async function datiIscr(c) {
  const [{ data: link }, { data: coda }] = await Promise.all([
    c.iscr_codice ? sb.rpc('iscr_link', { p_corso_id: c.id }) : Promise.resolve({ data: null }),
    sb.from('s_iscrizioni').select('*').eq('corso_id', c.id).order('id', { ascending: false }),
  ]);
  return { link: link || null, coda: coda || [] };
}

/* ── la sezione nella scheda del corso ── */
export function sezioneIscr(c, iz) {
  if (!c.iscr_codice) {
    return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">🎓 Iscrizioni</h4>
    <p class="hint" style="margin:0 0 8px">Non sono aperte. Aprendole nasce il <strong>link</strong> da mandare
      all'impresa; spuntando <em>in vetrina</em> l'evento compare anche nell'elenco pubblico del portale, dove
      chiunque può iscriversi. Chi compila indica <strong>l'anagrafica completa</strong> di chi partecipa: sono
      i dati che finiranno sull'attestato.</p>
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="margin:0;width:110px"><label>Posti</label>
        <input id="iz-posti" type="number" min="1" max="999" placeholder="illimitati"></div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">
        <input type="checkbox" id="iz-vetrina" style="width:15px;height:15px;accent-color:var(--arancio);margin:0">
        in vetrina sul portale</label>
      <button class="btn btn-primary btn-sm" id="iz-apri">🎓 Apri le iscrizioni</button>
    </div>`;
  }

  const l = iz.link || {};
  const nuove = iz.coda.filter((r) => r.stato === 'nuova' || r.stato === 'in_attesa');
  const chiuse = iz.coda.filter((r) => r.stato === 'confermata' || r.stato === 'respinta');
  const scaduto = l.chiuso_il && new Date(l.chiuso_il) <= new Date();

  const riga = (r) => {
    const quante = Array.isArray(r.persone) ? r.persone.length : 0;
    /* chi ha compilato: le imprese dei partecipanti stanno nelle loro righe */
    const chi = `${esc(r.referente || r.ragione_sociale || '—')}${
      r.ragione_sociale && r.referente ? ` <span class="hint">${esc(r.ragione_sociale)}</span>` : ''}`;
    const ceiv = r.esito_ceiv === 'iscritta' ? '<span class="dt-cella dt-ok" style="padding:1px 6px">CEIV</span>'
      : r.esito_ceiv === 'non_iscritta' ? '<span class="dt-cella dt-scaduto" style="padding:1px 6px">non CEIV</span>'
      : r.esito_ceiv ? '<span class="hint">CEIV da verificare</span>' : '';
    const stato = r.stato === 'confermata'
      ? `<span class="dt-cella dt-ok" style="padding:1px 6px">✓ ${r.iscritti_creati} iscritt${r.iscritti_creati === 1 ? 'o' : 'i'}</span>`
      : r.stato === 'respinta' ? '<span class="dt-cella dt-scaduto" style="padding:1px 6px">respinta</span>'
      : `<button class="btn btn-sm" data-iz-apri-ist="${r.id}">Guarda e conferma</button>`;
    return `<tr>
      <td>${dataIt((r.timestamp_modulo || r.creato_il || '').slice(0, 10))}</td>
      <td>${chi}<br>${ceiv}</td>
      <td style="text-align:center">${quante}</td>
      <td>${esc(r.email || '')}</td>
      <td>${stato}</td></tr>`;
  };

  return `
  <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
  <h4 style="margin:0 0 6px">🎓 Iscrizioni ${scaduto ? '<span class="hint">(chiuse)</span>' : ''}</h4>

  <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
    <div><span class="hint">Codice</span><br><strong>${esc(l.codice || '')}</strong></div>
    <div><span class="hint">Iscritti</span><br><strong>${l.iscritti ?? 0}</strong>${
      l.posti ? ` <span class="hint">su ${l.posti}</span>` : ''}</div>
    <div><span class="hint">In attesa</span><br><strong>${l.in_attesa ?? 0}</strong></div>
    <div><span class="hint">Si chiudono</span><br>${quandoChiude(l.chiuso_il)}</div>
    <div><span class="hint">Dove si vede</span><br>${l.pubblico
      ? 'in vetrina + col link' : '<em>solo col link</em>'}</div>
  </div>

  <div class="field" style="margin:0 0 8px"><label>Link da mandare all'impresa</label>
    <input value="${esc(l.link || '')}" readonly onclick="this.select()" style="font-size:12px"></div>
  ${l.pubblica_esito && !String(l.pubblica_esito).startsWith('pubblicato')
    ? `<p class="hint" style="color:var(--rosso)">⚠️ Sul portale non è aggiornato: ${esc(l.pubblica_esito)}</p>` : ''}

  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button class="btn btn-primary btn-sm" id="iz-manda">✉ Manda il modulo al referente</button>
    <button class="btn btn-sm" id="iz-copia">📋 Copia il link</button>
    <button class="btn btn-sm" id="iz-vetrina-cambia">${l.pubblico ? '🙈 Togli dalla vetrina' : '👁 Metti in vetrina'}</button>
    <button class="btn btn-sm" id="iz-ripubblica">↻ Aggiorna sul portale</button>
    <button class="btn btn-sm" id="iz-mano">➕ Registra un'iscrizione arrivata a mano</button>
    ${scaduto ? '' : '<button class="btn btn-sm" id="iz-chiudi">🔒 Chiudi le iscrizioni</button>'}
  </div>

  ${iz.coda.length ? `
  <table class="tab" style="margin-top:6px">
    <thead><tr><th>Arrivata</th><th>Chi ha compilato</th><th>Persone</th><th>E-mail</th><th></th></tr></thead>
    <tbody>${[...nuove, ...chiuse].map(riga).join('')}</tbody>
  </table>
  ${nuove.length ? `<p class="hint" style="margin-top:6px">⚠️ Le richieste in attesa <strong>occupano il posto</strong>
    nel conteggio dei liberi: confermale o respingile, altrimenti l'evento sembra pieno.</p>` : ''}`
  : '<p class="hint">Nessuna iscrizione arrivata.</p>'}`;
}

/* ── i bottoni ── */
export function collegaIscr(c, iz, ricarica) {
  const b = (id, fn) => { const n = $(id); if (n) n.addEventListener('click', fn); };

  b('#iz-apri', async (ev) => {
    const posti = Number($('#iz-posti').value) || null;
    const vetrina = $('#iz-vetrina').checked;
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('iscr_apri', {
      p_corso_id: c.id, p_pubblico: vetrina, p_posti: posti, p_chiuso_il: null,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    await pubblica(c, false);
    ricarica();
  });

  b('#iz-manda', () => mandaModulo(c, iz));

  b('#iz-copia', () => {
    const v = iz.link?.link || '';
    if (!v) return;
    navigator.clipboard.writeText(v).then(() => toast('Link copiato.', 'ok'), () => toast('Copia non riuscita.', 'err'));
  });

  b('#iz-vetrina-cambia', async (ev) => {
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_corsi').update({ iscr_pubblico: !iz.link?.pubblico }).eq('id', c.id);
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    /* ⚠️ Cambiare la vetrina senza ripubblicare non si vedrebbe: il portale
       legge la copia, non il database del gestionale. */
    await pubblica(c, false);
    ricarica();
  });

  b('#iz-ripubblica', async (ev) => { attendi(ev.currentTarget, true); await pubblica(c, false); attendi(ev.currentTarget, false); ricarica(); });

  b('#iz-chiudi', async (ev) => {
    if (!confirm('Chiudo le iscrizioni? Il link smette di accettare richieste e l\'evento sparisce dalla vetrina.')) return;
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('iscr_chiudi', { p_corso_id: c.id });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  });

  b('#iz-mano', () => formAMano(c, ricarica));

  document.querySelectorAll('[data-iz-apri-ist]').forEach((n) => n.addEventListener('click', () => {
    const r = iz.coda.find((x) => String(x.id) === n.dataset.izApriIst);
    if (r) formIstruttoria(c, r, ricarica);
  }));
}

/* ── la mail col modulo da compilare ─────────────────────────────
   È il gesto per cui il giro esiste: dopo una conferenza autorizzata,
   all'impresa si manda il link e l'anagrafica dei partecipanti arriva
   compilata da loro. Il referente e la sua mail il corso li ha già, presi
   dalla pratica di conferenza.
   ⚠️ La bozza si prepara, la manda una persona da Outlook: è il confine di
   sempre per tutto ciò che esce dall'ufficio. */
function mandaModulo(c, iz) {
  const link = iz.link?.link;
  if (!link) return toast('Prima vanno aperte le iscrizioni.', 'err');

  const quando = c.data_inizio ? dataIt(c.data_inizio) : null;
  const dove = c.sede || null;
  const a = c.referente_email || '';
  const chi = c.referente_nome || '';

  const righe = [
    chi ? `Gentile ${chi},` : 'Buongiorno,',
    '',
    `in vista di ${c.titolo}${quando ? ` del ${quando}` : ''}${dove ? `, ${dove}` : ''},`,
    'vi chiediamo di indicare le persone che parteciperanno, compilando il modulo online:',
    '',
    '>>> Compila il modulo di iscrizione (si apre la pagina, senza bisogno di accesso):',
    link,
    '',
    'Servono i dati anagrafici completi di ciascun partecipante — cognome, nome, codice fiscale,',
    'data e comune di nascita — perché sono quelli che finiranno sugli attestati.',
    '',
    'Ogni partecipante può appartenere a un\u2019impresa diversa: i dati dell\u2019impresa si indicano',
    'per ciascuna persona. Se sono molte, dal modulo si scarica un modello Excel da compilare',
    'e ricaricare in un colpo solo.',
    '',
    'Restiamo a disposizione.',
  ];

  scaricaEml({
    to: a,
    oggetto: `Iscrizione partecipanti — ${c.titolo}`,
    corpo: righe.join('\n'),
    nomeFile: `modulo-iscrizione_corso-${c.id}.eml`,
  });

  toast(a ? 'Bozza pronta: rileggila e mandala da Outlook.'
          : 'Bozza pronta, ma il corso non ha la mail del referente: mettila tu.', a ? 'ok' : 'err');
}

/* la copia sul portale: senza, il link non trova niente */
async function pubblica(c, silenziosa) {
  const { data, error } = await sb.functions.invoke('questionari-pubblica', {
    body: { cosa: 'iscrizione', corso_id: c.id },
  });
  if (error || data?.status !== 'ok') {
    const m = data?.esito || data?.saltati?.[0]?.motivo || error?.message || 'non pubblicato';
    toast(`Le iscrizioni NON sono sul portale: ${m}`, 'err');
    return false;
  }
  if (!silenziosa) toast('Aggiornate sul portale.', 'ok');
  return true;
}

/* ══ L'ISTRUTTORIA: il pezzo che ferma i doppioni ═══════════════════════════ */
async function formIstruttoria(c, r, ricarica) {
  const { data: ist, error } = await sb.rpc('iscr_istruttoria', { p_id: r.id });
  if (error) return toast(error.message, 'err');

  const ric = ist.richiedente || {};
  const scheda = (p) => {
    const [ico, spiega] = SEMAFORO[p.semaforo] || SEMAFORO.verde;
    const d = p.dati || {};
    const imp = p.impresa || {};
    const dettagli = [d.cf, d.nato_il ? `nato il ${dataIt(d.nato_il)}` : '', d.comune_nascita,
      d.ruolo, d.mansione, d.email].filter(Boolean).map(esc).join(' · ');

    /* l'impresa di QUESTA riga: candidati dall'anagrafica, e la scelta è per
       persona perché a un corso si iscrivono lavoratori di imprese diverse */
    const candImp = (imp.candidati || []).map((k) => `<option value="${esc(k.impresa_id)}" selected
      >${esc(k.ragione_sociale)}${k.comune ? ' · ' + esc(k.comune) : ''}${
        k.stato_cassa ? ' · ' + esc(k.stato_cassa) : ''}</option>`).join('');

    /* dove la persona risulta a noi ADESSO: se è un'altra impresa, il
       passaggio va visto, non eseguito di nascosto */
    const scelto = (p.candidati || [])[0];
    const rapporti = (scelto?.rapporti || []).filter((x) => x.in_corso);
    const altrove = rapporti.filter((x) => x.impresa_id !== (imp.candidati || [])[0]?.impresa_id);
    const rigaRapporto = !scelto ? '' : `
      <div class="field" style="margin:6px 0 0"><label>Rapporto con l'impresa</label>
        <select data-iz-rapp="${p.i}">
          ${altrove.length ? `
            <option value="sposta">risulta in ${esc(altrove[0].ragione_sociale || altrove[0].impresa_id)}: chiudi quello e apri il nuovo</option>
            <option value="crea">aggiungi il nuovo, lascia aperto anche l'altro</option>
            <option value="niente" selected>non toccare i rapporti</option>`
          : `<option value="crea">registra che lavora qui</option>
             <option value="niente" ${rapporti.length ? 'selected' : ''}>non toccare i rapporti</option>`}
        </select>
        ${rapporti.length ? `<p class="hint" style="margin:4px 0 0">Per noi è in
          <strong>${rapporti.map((x) => esc(x.ragione_sociale || x.impresa_id)).join(', ')}</strong>${
          rapporti[0].dal ? ` dal ${dataIt(rapporti[0].dal)}` : ''}.</p>`
        : '<p class="hint" style="margin:4px 0 0">Per noi non risulta in nessuna impresa.</p>'}
      </div>`;

    return `
    <div style="border:1px solid var(--bordo);padding:10px;margin-bottom:8px" data-iz-p="${p.i}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <strong>${ico} ${esc(p.nominativo)}</strong>
        <span class="hint">${esc(spiega)}</span>
      </div>
      <div class="hint" style="margin:2px 0 8px">${dettagli}</div>
      ${p.semaforo === 'rosso' ? `<p class="hint" style="color:var(--rosso);margin:0 0 6px">
        È già fra gli iscritti di questo evento: iscrivendola di nuovo comparirebbe due volte sul registro.</p>` : ''}

      <div class="field" style="margin:0 0 6px"><label>Che cosa faccio</label>
        <select data-iz-az="${p.i}">
          <option value="iscrivi" ${p.semaforo === 'rosso' ? '' : 'selected'}>iscrivila</option>
          <option value="salta" ${p.semaforo === 'rosso' ? 'selected' : ''}>saltala</option>
        </select></div>

      <div class="field" style="margin:0 0 6px"><label>In anagrafica</label>
        <select data-iz-pid="${p.i}">
          ${(p.candidati || []).map((k) => `<option value="${esc(k.persona_id)}"
            >${esc(k.nominativo)}${k.cf ? ' · ' + esc(k.cf) : ''} (trovata per ${esc(k.come)})</option>`).join('')}
          <option value="">${p.candidati?.length ? '— nessuna di queste' : '— non è in anagrafica'}</option>
          <option value="__nuova">➕ crea l'anagrafica con questi dati</option>
        </select></div>

      <div class="field" style="margin:0"><label>La sua impresa
        <span class="hint">${imp.ereditata ? '(non indicata: vale quella di chi ha compilato)' : ''}</span></label>
        <div class="hint" style="margin:0 0 4px">Sul modulo: <strong>${esc(imp.ragione_sociale || '—')}</strong>${
          imp.piva ? ' · ' + esc(imp.piva) : ''}</div>
        <select data-iz-imp="${p.i}">
          ${candImp}
          <option value="">— nessun aggancio: resta il solo nome scritto</option>
        </select>
        ${!candImp ? `<p class="hint" style="margin:4px 0 0">Non trovata in anagrafica.
          Se è nuova, creala dalla pagina <strong>Imprese</strong> e poi torna qui.</p>` : ''}
      </div>
      ${rigaRapporto}
    </div>`;
  };

  apriDrawer(`Iscrizione n° ${r.id} — corso n° ${c.id}`, '', `
    <p class="hint" style="margin:0 0 10px">Compilata da <strong>${esc(ric.referente || '—')}</strong>${
      ric.ragione_sociale ? ` di ${esc(ric.ragione_sociale)}` : ' (a titolo personale)'},
      il ${dataIt((r.timestamp_modulo || r.creato_il || '').slice(0, 10))}${
      ric.email ? ` · ${esc(ric.email)}` : ''}${ric.telefono ? ` · ${esc(ric.telefono)}` : ''}.</p>
    <p class="hint" style="margin:0 0 10px">⚠️ Ogni partecipante ha <strong>la sua impresa</strong>:
      quella di chi compila serve solo a rispondere.</p>
    ${r.note ? `<p class="hint"><strong>Note di chi ha compilato:</strong> ${esc(r.note)}</p>` : ''}
    <h4 style="margin:14px 0 6px">Chi partecipa</h4>
    ${(ist.persone || []).map(scheda).join('')}
    <div class="field"><label>Nota d'ufficio</label><textarea id="iz-nota" rows="2"></textarea></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn-primary" id="iz-conferma">✓ Conferma le iscrizioni</button>
      <button class="btn" id="iz-respingi">✕ Respingi</button>
    </div>`);

  $('#iz-conferma').addEventListener('click', async (ev) => {
    const scelte = (ist.persone || []).map((p) => {
      const az = $(`[data-iz-az="${p.i}"]`).value;
      const pid = $(`[data-iz-pid="${p.i}"]`).value;
      const impSel = $(`[data-iz-imp="${p.i}"]`);
      const rappSel = $(`[data-iz-rapp="${p.i}"]`);
      return {
        i: p.i, azione: az,
        persona_id: pid === '__nuova' ? null : (pid || null),
        crea_anagrafica: pid === '__nuova',
        impresa_id: impSel ? (impSel.value || null) : null,
        rapporto: rappSel ? rappSel.value : (pid === '__nuova' ? 'crea' : 'niente'),
      };
    });
    if (!scelte.some((s) => s.azione === 'iscrivi')) {
      return toast('Non hai scelto nessuno da iscrivere: se non va iscritto nessuno, respingi la richiesta.', 'err');
    }
    attendi(ev.currentTarget, true);
    const { data, error } = await sb.rpc('iscr_conferma', {
      p_id: r.id, p_scelte: scelte, p_impresa_id: null,
      p_note: $('#iz-nota').value.trim() || null,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast(`Iscritti ${data.iscritti}${data.anagrafiche_nuove ? `, ${data.anagrafiche_nuove} anagrafiche nuove` : ''}${
      data.rapporti_registrati ? `, ${data.rapporti_registrati} rapporti registrati` : ''}.`, 'ok');
    await pubblica(c, true);
    ricarica();
  });

  $('#iz-respingi').addEventListener('click', async (ev) => {
    const motivo = prompt('Perché la respingi? Resta scritto sulla richiesta.');
    if (!motivo || !motivo.trim()) return;
    attendi(ev.currentTarget, true);
    const { error } = await sb.rpc('iscr_respingi', { p_id: r.id, p_motivo: motivo.trim() });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    await pubblica(c, true);
    ricarica();
  });
}

/* ── un'iscrizione arrivata per telefono o per mail ───────────────────────
   Come per le segnalazioni, il canale manuale non è un ripiego: nello storico
   dei servizi è quasi metà del traffico. Entra nella stessa coda e passa
   dalla stessa istruttoria. */
function formAMano(c, ricarica) {
  apriDrawer(`Iscrizione a mano — corso n° ${c.id}`, '', `
    <p class="hint" style="margin:0 0 10px">Per quello che arriva per telefono o per mail. Entra nella coda come
      le altre, e si conferma con la stessa istruttoria: i doppioni si fermano lì.</p>
    <div class="field"><label>Chi si iscrive</label>
      <select id="im-conto"><option value="impresa">un'impresa per i suoi lavoratori</option>
        <option value="persona">una persona per sé</option></select></div>
    <div id="im-box-imp">
      <div class="field"><label>Ragione sociale</label><input id="im-rs" maxlength="200"></div>
      <div class="field"><label>Partita IVA</label><input id="im-piva" maxlength="16"></div>
    </div>
    <div class="field"><label>E-mail</label><input id="im-email" maxlength="160"></div>
    <div class="field"><label>Persone — una per riga: <code>COGNOME Nome; CODICEFISCALE; mansione</code></label>
      <textarea id="im-persone" rows="5" placeholder="ROSSI Mario; RSSMRA80A01G224E; muratore"></textarea></div>
    <div class="field"><label>Nota</label><input id="im-nota" maxlength="300"></div>
    <button class="btn btn-primary" id="im-salva" style="margin-top:8px">Metti in coda</button>`);

  $('#im-conto').addEventListener('change', (e) => {
    $('#im-box-imp').style.display = e.target.value === 'persona' ? 'none' : '';
  });

  $('#im-salva').addEventListener('click', async (ev) => {
    const perConto = $('#im-conto').value;
    const persone = $('#im-persone').value.split('\n').map((r) => r.trim()).filter(Boolean).map((r) => {
      const [nom = '', cf = '', mans = ''] = r.split(';').map((x) => x.trim());
      const parti = nom.split(/\s+/);
      /* il cognome è la prima parola: qui non si indovina, e se è al
         contrario lo raddrizza chi conferma */
      return {
        cognome: parti[0] || '', nome: parti.slice(1).join(' '),
        cf: cf.toUpperCase() || undefined, mansione: mans || undefined,
      };
    }).filter((p) => p.cognome);
    if (!persone.length) return toast('Non hai scritto nessuna persona.', 'err');
    attendi(ev.currentTarget, true);
    const { error } = await sb.from('s_iscrizioni').insert({
      corso_id: c.id, fonte: 'manuale', per_conto: perConto,
      ragione_sociale: perConto === 'impresa' ? ($('#im-rs').value.trim() || null) : null,
      partita_iva: perConto === 'impresa' ? ($('#im-piva').value.trim() || null) : null,
      email: $('#im-email').value.trim() || null,
      persone, note: $('#im-nota').value.trim() || null,
      note_ufficio: `Registrata a mano da ${state.email}`,
    });
    attendi(ev.currentTarget, false);
    if (error) return toast(error.message, 'err');
    toast('Iscrizione messa in coda.', 'ok');
    ricarica();
  });
}
