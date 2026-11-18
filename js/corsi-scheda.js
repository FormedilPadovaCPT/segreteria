/* ══════════════════════════════════════════════════════════════════════════
   LA SCHEDA DEL CORSO A TUTTA PAGINA, A LINGUETTE               (18/11/2026)
   Proposta A, scelta dall'utente il 18/11/2026: «è stretta per tutte le
   cose che contiene, e quando arrivano le firme di presenza non si notano».

   - La scheda occupa quasi tutto lo schermo (classe drawer-pieno).
   - In alto la BARRA DEI NUMERI che contano (iscritti, firme da guardare,
     firme confermate, questionari, test, attestati): ogni numero porta alla
     sua linguetta.
   - Sotto, le LINGUETTE: si vede una parte alla volta. Tutte le parti sono
     comunque nel documento (solo nascoste), così i pulsanti di ogni modulo
     restano collegati come prima: cambia la disposizione, non il lavoro.
   - Aprendo un corso che ha firme da guardare si parte da «Firme dal QR»;
     ricaricando la scheda dopo un'azione si resta sulla linguetta di prima.
   - Mentre la scheda è aperta le firme si RILEGGONO da sole ogni 30 secondi
     (solo lettura): una firma nuova accende una striscia arancione e il
     pallino sulla linguetta. Se si sta già guardando le firme e non si sta
     scrivendo in un campo, la scheda si rinfresca da sola.
   - Un errore di lettura si dice, non si tace: «firme non rilette».

   Qui niente import da core.js: le dipendenze arrivano come parametri, così
   le funzioni pure si provano in Node (test/corsi-scheda.test.mjs).
   ══════════════════════════════════════════════════════════════════════════ */

export const SCHEDE = [
  ['riepilogo', 'Riepilogo'],
  ['docenti', 'Docenti e compensi'],
  ['iscritti', 'Iscritti'],
  ['iscrizioni', 'Iscrizioni'],
  ['firme', 'Firme dal QR'],
  ['quest', 'Questionario e test'],
  ['documenti', 'Documenti e attestati'],
];
const CHIAVI = new Set(SCHEDE.map(([k]) => k));
export const OGNI_MS = 30000;

const fuori = (i) => ['annullato', 'sostituito'].includes(i?.esito || '');

/* ── conteggi delle firme: stessi criteri della sezione «Firme dal QR» ── */
export function contaFirme(firme) {
  const n = { totale: 0, ricevute: 0, inOrario: 0, fuoriOrario: 0, ignote: 0, confermate: 0, respinte: 0, guardare: 0 };
  for (const f of firme || []) {
    n.totale++;
    if (f.stato === 'confermata') n.confermate++;
    if (f.stato === 'respinta') n.respinte++;
    if (f.stato === 'ricevuta') {
      n.ricevute++;
      if (!f.iscritto_id) n.ignote++;
      else if (f.fuori_orario) n.fuoriOrario++;
      else n.inOrario++;
    }
  }
  n.guardare = n.ricevute;
  return n;
}

/* l'impronta dice se qualcosa è cambiato: firme nuove o stati cambiati */
export function impronta(firme) {
  return (firme || []).map((f) => `${f.id}:${f.stato}`).sort().join('|');
}

/* le firme che non c'erano alla lettura precedente */
export function firmeNuove(primaIds, firme) {
  const prima = new Set(primaIds || []);
  return (firme || []).filter((f) => !prima.has(f.id));
}

/* da quale linguetta si parte */
export function schedaIniziale({ ricordata, apertura, guardare }) {
  if (!apertura && CHIAVI.has(ricordata)) return ricordata;
  if (guardare > 0) return 'firme';
  return 'riepilogo';
}

/* i numeri della barra, calcolati da quello che la scheda ha già letto */
export function numeriScheda({ c, iscritti, firme, coda, prove }) {
  const ammessi = (iscritti || []).filter((i) => !fuori(i));
  const f = contaFirme(firme);
  const testAttivo = !!(c?.test_previsto || c?.test_codice);
  const consegnate = (prove || []).filter((p) => p.esito !== 'annullata');
  return {
    iscritti: ammessi.length,
    izDaGuardare: (coda || []).filter((r) => r.stato === 'nuova' || r.stato === 'in_attesa').length,
    presAperte: !!c?.pres_codice,
    firme: f,
    quest: c?.quest_codice ? ammessi.filter((i) => i.quest_compilato).length : null,
    test: testAttivo ? consegnate.length : null,
    testSuperati: consegnate.filter((p) => p.esito === 'superato').length,
    attestati: c?.rilascio_attestato === false ? null : ammessi.filter((i) => i.attestato_numero).length,
  };
}

const plur = (n, uno, tanti) => `${n} ${n === 1 ? uno : tanti}`;

export function htmlBarra(n) {
  const casella = (id, vai, et, v, sotto, cls = '') => `<button type="button" class="cs-num ${cls}" id="${id}" data-cs-vai="${vai}">
      <span class="cs-et">${et}</span><span class="cs-v">${v}</span><span class="cs-sotto">${sotto}</span></button>`;
  const su = (x) => `<span class="num">${x}</span><small>/${n.iscritti}</small>`;
  const f = n.firme;
  const firme = !n.presAperte
    ? casella('cs-n-firme', 'firme', 'Firme da guardare', '<span class="num">—</span>', 'firme dal QR non aperte')
    : casella('cs-n-firme', 'firme', 'Firme da guardare',
      `${f.guardare ? '<span class="cs-pallino"></span>' : ''}<span class="num">${f.guardare}</span>`,
      f.guardare
        ? [f.inOrario && `${f.inOrario} in orario`, f.fuoriOrario && `${f.fuoriOrario} fuori orario`, f.ignote && `${f.ignote} non riconosciut${f.ignote === 1 ? 'a' : 'e'}`].filter(Boolean).join(' · ')
        : (f.totale ? 'tutte guardate' : 'nessuna firma arrivata'),
      f.guardare ? 'cs-acceso' : (f.totale ? 'cs-bene' : ''));
  return `<div class="cs-numeri" role="group" aria-label="I numeri del corso">
    ${casella('cs-n-iscritti', 'iscritti', 'Iscritti', `<span class="num">${n.iscritti}</span>`,
      n.izDaGuardare ? plur(n.izDaGuardare, 'iscrizione da guardare', 'iscrizioni da guardare') : 'annullati e sostituiti esclusi')}
    ${firme}
    ${casella('cs-n-conf', 'firme', 'Firme confermate', n.presAperte ? `<span class="num">${f.confermate}</span>` : '<span class="num">—</span>',
      n.presAperte ? 'scrivono le presenze' : 'presenze dal registro')}
    ${casella('cs-n-quest', 'quest', 'Questionari', n.quest == null ? '<span class="num">—</span>' : su(n.quest),
      n.quest == null ? 'non aperto' : 'compilati')}
    ${casella('cs-n-test', 'quest', 'Test', n.test == null ? '<span class="num">—</span>' : su(n.test),
      n.test == null ? 'non previsto' : `${n.testSuperati} superat${n.testSuperati === 1 ? 'o' : 'i'}`)}
    ${casella('cs-n-att', 'documenti', 'Attestati', n.attestati == null ? '<span class="num">—</span>' : su(n.attestati),
      n.attestati == null ? 'non previsti' : 'emessi')}
  </div>`;
}

export function htmlLinguette(attiva, n) {
  const cont = {
    iscritti: `<span class="cs-cont">${n.iscritti}</span>`,
    iscrizioni: n.izDaGuardare ? `<span class="cs-cont cs-caldo">${n.izDaGuardare}</span>` : '',
    firme: n.firme.guardare ? `<span class="cs-pallino"></span><span class="cs-cont cs-caldo">${n.firme.guardare}</span>` : '',
  };
  return `<div class="cs-linguette" role="tablist" aria-label="Parti della scheda">
    ${SCHEDE.map(([k, l]) => `<button type="button" role="tab" class="cs-ling${k === attiva ? ' on' : ''}" id="cs-l-${k}"
      data-cs-ling="${k}" aria-selected="${k === attiva}">${l}${cont[k] || ''}</button>`).join('')}
    <span class="cs-riletto" id="cs-riletto" aria-live="polite"></span>
  </div>`;
}

/* la striscia della firma nuova: nomi e ore vengono dal database, si scappano */
export function htmlAvviso(nuove, esc) {
  if (!nuove.length) return '';
  const u = nuove[nuove.length - 1];
  const chi = esc(u.nominativo || 'codice non riconosciuto');
  const cosa = u.tipo ? esc(u.tipo) : 'firma';
  return `<span class="cs-pallino cs-bianco"></span>
    <span>${nuove.length === 1 ? 'Firma nuova' : `${nuove.length} firme nuove`}: ${chi}${u.ora ? `, ${cosa} alle ${esc(u.ora)}` : ''}</span>
    <button type="button" class="btn btn-sm" id="cs-avviso-vai">Vai alle firme</button>
    <button type="button" class="cs-avviso-x" id="cs-avviso-chiudi" aria-label="Chiudi l'avviso">✕</button>`;
}

/* ── stato fra una ricarica e l'altra della stessa scheda ── */
const memoria = { corsoId: null, scheda: null, noteIds: null, nuoveIds: new Set(), timer: null };

/* una ricarica chiesta su una linguetta precisa (es. «Vai alle firme») */
export function ricordaScheda(k) { if (CHIAVI.has(k)) memoria.scheda = k; }

/* da chiamare PRIMA di apriDrawer: la scheda era già aperta su questo corso? */
export function eraAperta(corsoId, drawerNascosto) {
  return !drawerNascosto && memoria.corsoId === corsoId;
}

/* il contenitore della scheda: barra, avviso, linguette e le parti */
export function htmlScheda({ corsoId, apertura, numeri, parti }) {
  const attiva = schedaIniziale({ ricordata: memoria.scheda, apertura, guardare: numeri.presAperte ? numeri.firme.guardare : 0 });
  if (apertura) { memoria.noteIds = null; memoria.nuoveIds = new Set(); }
  memoria.corsoId = corsoId;
  memoria.scheda = attiva;
  return `<div class="cs-scheda" data-cs-corso="${corsoId}">
    <div class="cs-testa">
      <div class="cs-avviso hidden" id="cs-avviso" role="status"></div>
      <div id="cs-barra">${htmlBarra(numeri)}</div>
      <div id="cs-ling">${htmlLinguette(attiva, numeri)}</div>
    </div>
    ${SCHEDE.map(([k]) => `<section class="cs-pann${k === attiva ? '' : ' hidden'}" data-cs-pann="${k}" role="tabpanel" aria-labelledby="cs-l-${k}">${parti[k] || ''}</section>`).join('')}
  </div>`;
}

/* ── i comportamenti: linguette, numeri, rilettura delle firme ──
   dip = { sb, esc, oraRoma, ricarica(scheda), corso, numeri, firme } */
export function collegaScheda(body, dip) {
  const { sb, esc, oraRoma, ricarica, corso, numeri } = dip;
  if (!body) return;
  let n = numeri;
  let firme = dip.firme || [];
  if (memoria.noteIds == null) memoria.noteIds = firme.map((f) => f.id);
  let impr = impronta(firme);

  const mostra = (k) => {
    if (!CHIAVI.has(k)) return;
    memoria.scheda = k;
    body.querySelectorAll('[data-cs-pann]').forEach((s) => s.classList.toggle('hidden', s.dataset.csPann !== k));
    body.querySelectorAll('[data-cs-ling]').forEach((b) => {
      const on = b.dataset.csLing === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (k === 'firme') vistaFirme();
    const testa = body.querySelector('.cs-testa');
    if (testa && body.scrollTop > testa.offsetTop) body.scrollTop = testa.offsetTop;
  };
  /* guardando le firme, quelle nuove si evidenziano una volta e poi sono «viste» */
  const vistaFirme = () => {
    for (const id of memoria.nuoveIds) body.querySelector(`[data-pq-riga="${id}"]`)?.classList.add('pq-nuova');
    memoria.nuoveIds = new Set();
    nascondiAvviso();
  };
  const nascondiAvviso = () => body.querySelector('#cs-avviso')?.classList.add('hidden');

  /* ⚠️ l'ascolto va sulla scheda, che rinasce a ogni ricarica, NON su #drawer-body,
     che resta: lì ogni ricarica ne aggiungerebbe un altro, e «Vai alle firme»
     ricaricherebbe la scheda una volta per ogni giro fatto */
  const radice = body.querySelector('.cs-scheda');
  radice?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cs-ling],[data-cs-vai],#cs-avviso-vai,#cs-avviso-chiudi');
    if (!t || !radice.contains(t)) return;
    if (t.id === 'cs-avviso-chiudi') return nascondiAvviso();
    if (t.id === 'cs-avviso-vai') return ricarica('firme');   /* rilegge tutto: la tabella delle firme è quella vecchia */
    mostra(t.dataset.csLing || t.dataset.csVai);
  });

  const segnaOra = (testo, errore) => {
    const el = body.querySelector('#cs-riletto');
    if (!el) return;
    el.textContent = testo;
    el.classList.toggle('cs-errore', !!errore);
  };
  if (corso.pres_codice) segnaOra(`⟳ firme rilette alle ${oraRoma(new Date().toISOString())}`);

  /* se le firme lette con la scheda contengono firme nuove rispetto al giro prima
     (ricarica dopo un'azione), restano evidenziate finché non si guardano */
  if (memoria.scheda === 'firme') vistaFirme();

  clearInterval(memoria.timer);
  if (!corso.pres_codice) return;
  memoria.timer = setInterval(async () => {
    /* la scheda è stata chiusa o sostituita: il giro si ferma */
    if (!body.isConnected || body.closest('.hidden') || !body.querySelector(`[data-cs-corso="${corso.id}"]`)) {
      clearInterval(memoria.timer);
      return;
    }
    if (document.hidden) return;
    const { data, error } = await sb.from('s_corsi_firme_presenza')
      .select('id, stato, nominativo, tipo, turno, ora_server, iscritto_id, fuori_orario').eq('corso_id', corso.id).order('ora_server');
    if (!body.querySelector(`[data-cs-corso="${corso.id}"]`)) return;
    if (error) { segnaOra(`⚠ firme non rilette: ${error.message}`, true); return; }
    segnaOra(`⟳ firme rilette alle ${oraRoma(new Date().toISOString())}`);
    const ora = impronta(data);
    if (ora === impr) return;
    impr = ora;
    const nuove = firmeNuove(memoria.noteIds, data);
    memoria.noteIds = (data || []).map((f) => f.id);
    for (const f of nuove) memoria.nuoveIds.add(f.id);
    firme = data || [];
    n = { ...n, firme: contaFirme(firme) };
    body.querySelector('#cs-barra').innerHTML = htmlBarra(n);
    body.querySelector('#cs-ling').innerHTML = htmlLinguette(memoria.scheda, n);
    segnaOra(`⟳ firme rilette alle ${oraRoma(new Date().toISOString())}`);
    if (nuove.length) {
      const av = body.querySelector('#cs-avviso');
      av.innerHTML = htmlAvviso(nuove.map((f) => ({ ...f, ora: oraRoma(f.ora_server) })), esc);
      av.classList.remove('hidden');
    }
    /* si sta guardando le firme e non si sta scrivendo: la tabella si rinfresca da sola */
    const att = document.activeElement;
    const scrive = att && body.contains(att) && /^(INPUT|TEXTAREA|SELECT)$/.test(att.tagName);
    if (memoria.scheda === 'firme' && !scrive) ricarica('firme');
  }, OGNI_MS);
}

/* per i test: lo stato fra le ricariche */
export function _memoria() { return memoria; }
