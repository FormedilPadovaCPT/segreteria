/* ============================================================
   POST PER I SOCIAL NEL CRUSCOTTO (17/11/2026, chiesto dall'utente)

   «Nel cruscotto manca un riquadro per vedere le cose mandate al
   Direttore o al Coordinatore per i social: a che punto sono, se sono
   state visualizzate, se sono state approvate, se le rimandano indietro.»

   Tre mucchi, uno per passo:
     · IN ATTESA: mandati e non ancora decisi. Per ognuno, se chi decide
       l'ha aperto (s_post_passaggi.visti, lo scrive s_post_visto quando
       il Direttore o il Coordinatore apre «📣 Comunicazione» nel
       gestionale) e da quanti giorni aspetta. Se la data in programma è
       vicina o passata, lo si dice: il post non può uscire senza
       approvazione.
     · RIMANDATI: il Coordinatore chiede modifiche o il Direttore non
       approva. Restano finché la segreteria non li corregge e li
       rimanda (o li scarta).
     · APPROVATI, da pubblicare: con le indicazioni del Direttore, se ci
       sono. Escono di qui quando sono pubblicati.
   Qui solo la lettura: un clic apre il post nella pagina Comunicazione.
   Le funzioni sono pure (niente database), per i test.
   ============================================================ */

export const IN_ATTESA = ['al_coordinatore', 'al_direttore', 'alla_presidenza'];
export const STATI_CRUSCOTTO = [...IN_ATTESA, 'bozza', 'approvato'];
const CHI = { coordinatore: 'il Coordinatore', direttore: 'il Direttore', presidenza: 'la Presidenza',
  presidente: 'il Presidente', vicepresidente: 'il Vicepresidente' };
const DA = { coordinatore: 'dal Coordinatore', direttore: 'dal Direttore', presidenza: 'dalla Presidenza',
  presidente: 'dal Presidente', vicepresidente: 'dal Vicepresidente' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dIt = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const oraIt = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
};
/* la data di un istante a Roma (aaaa-mm-gg), non in UTC: dopo le 23 sarebbe il giorno dopo */
const giornoRoma = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
};
export const giorniFra = (da, a) => Math.round((new Date(String(a).slice(0, 10)) - new Date(String(da).slice(0, 10))) / 864e5);
const corto = (s, n = 110) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

/* post e passaggi come li legge il cruscotto → i tre mucchi */
export function quadroPost(post, passaggi) {
  const di = new Map();
  for (const x of passaggi || []) {
    if (!di.has(x.post_id)) di.set(x.post_id, []);
    di.get(x.post_id).push(x);
  }
  for (const l of di.values()) l.sort((a, b) => String(a.richiesto_il).localeCompare(String(b.richiesto_il)) || a.id - b.id);
  const attesa = [], rimandati = [], approvati = [];
  for (const p of post || []) {
    const storia = di.get(p.id) || [];
    const ultimo = storia[storia.length - 1] || null;
    if (IN_ATTESA.includes(p.stato)) {
      const x = [...storia].reverse().find((s) => s.stato === 'in_attesa') || null;
      attesa.push({ p, x });
    } else if (p.stato === 'bozza' && ultimo && ['modifiche', 'non_approvato'].includes(ultimo.stato)) {
      rimandati.push({ p, x: ultimo });
    } else if (p.stato === 'approvato') {
      const x = [...storia].reverse().find((s) => ['approvato', 'approvato_indicazioni'].includes(s.stato)) || null;
      approvati.push({ p, x });
    }
  }
  const quando = (r) => String(r.x?.richiesto_il || r.p.created_at || '');
  attesa.sort((a, b) => quando(a).localeCompare(quando(b)));
  rimandati.sort((a, b) => String(a.x.deciso_il || '').localeCompare(String(b.x.deciso_il || '')));
  approvati.sort((a, b) => String(a.p.data_programmata || '9999').localeCompare(String(b.p.data_programmata || '9999')));
  return { attesa, rimandati, approvati };
}

export const quantiPost = (q) => (q ? q.attesa.length + q.rimandati.length + q.approvati.length : 0);

const pastiglia = (tipo, html) => `<span class="hm-passo hm-passo-${tipo}">${html}</span>`;

/* chi fra quelli che decidono l'ha aperto: per la Presidenza ciascuno per sé */
export function passoVisto(x) {
  if (!x) return pastiglia('err', 'non trovo il passaggio in attesa');
  const visti = x.visti || {};
  const verso = x.verso;
  const chiavi = verso === 'presidenza' ? ['presidente', 'vicepresidente'] : [verso];
  return chiavi.map((k) => {
    const v = visti[k];
    if (verso === 'presidenza' && x.decisioni && x.decisioni[k]) {
      return pastiglia('ok', `✔ ${CHI[k]} ha deciso: ${esc(String(x.decisioni[k].esito || '').replace(/_/g, ' '))}`);
    }
    return v && v.il
      ? pastiglia('attesa', `👁 aperto ${DA[k] || k} il ${dIt(giornoRoma(v.il))} alle ${oraIt(v.il)}, non ancora deciso`)
      : pastiglia('fermo', `⏳ ${CHI[k] || k} non l'ha ancora aperto`);
  }).join(' ');
}

/* la data in programma: vicina o passata con il post ancora da approvare o da pubblicare */
export function passoData(p, oggi, daFare) {
  const dp = p.data_programmata;
  if (!dp) return '';
  const g = giorniFra(oggi, dp);
  if (g < 0) return ' ' + pastiglia('err', `📅 doveva uscire il ${dIt(dp)}`);
  if (g <= 2) return ' ' + pastiglia('err', `📅 ${g === 0 ? 'in programma oggi' : g === 1 ? 'in programma domani' : 'in programma il ' + dIt(dp)}${daFare ? ', ' + daFare : ''}`);
  return ` <span class="hint">· in programma il ${dIt(dp)}</span>`;
}

export function righePost(q, oggi) {
  if (!q) return '';
  const riga = (icona, r, sotto, destra) => `
    <div class="hm-riga" data-vista="comunicazione" data-id="${Number(r.p.id)}">
      <span>${icona}</span>
      <span><strong>${esc(corto(r.p.titolo || 'Post senza titolo', 90))}</strong><br>${sotto}</span>
      <span class="hint">${destra}</span>
    </div>`;
  const gg = (da) => {
    if (!da) return '';
    const g = giorniFra(giornoRoma(da), oggi);
    return g >= 0 ? ` <span class="hm-gg${g > 7 ? ' hm-gg-fermo' : ''}">${g} gg</span>` : '';
  };
  return [
    ...q.attesa.map((r) => {
      const verso = r.x?.verso || String(r.p.stato).replace(/^al(la)?_/, '');
      const vc = r.x?.testi?.visto_coordinatore;
      return riga(verso === 'coordinatore' ? '👷' : verso === 'presidenza' ? '🎗️' : '🏛️', r,
        `<span class="hint">${DA[verso] || verso}${vc ? ' · 👍 visto del Coordinatore' : ''}</span> ${passoVisto(r.x)}${passoData(r.p, oggi, 'manca l\'approvazione')}`,
        r.x?.richiesto_il ? `mandato il ${dIt(giornoRoma(r.x.richiesto_il))}${gg(r.x.richiesto_il)}` : '');
    }),
    ...q.rimandati.map((r) => riga('↩', r,
      pastiglia('err', `${r.x.stato === 'modifiche' ? '✏️ il Coordinatore chiede modifiche' : '✋ il Direttore non l\'ha approvato'}${r.x.nota ? ': «' + esc(corto(r.x.nota)) + '»' : ''}`)
        + ' <span class="hint">· da correggere e rimandare, o da scartare</span>',
      r.x.deciso_il ? `il ${dIt(giornoRoma(r.x.deciso_il))}` : '')),
    ...q.approvati.map((r) => riga('✅', r,
      pastiglia('ok', `✅ approvato${r.x?.verso === 'presidenza' ? ' dalla Presidenza' : ' dal Direttore'}`)
        + (r.x?.stato === 'approvato_indicazioni' ? ' ' + pastiglia('fermo', `⚠ con indicazioni da applicare${r.x.nota ? ': «' + esc(corto(r.x.nota)) + '»' : ''}`) : '')
        + ' <span class="hint">· da pubblicare</span>' + passoData(r.p, oggi, ''),
      r.x?.deciso_il ? `il ${dIt(giornoRoma(r.x.deciso_il))}` : '')),
  ].join('');
}
