/* ============================================================
   CRUSCOTTO — agenda e calendario corsi (12/11/2026, scelti
   dall'utente fra le proposte di quel giorno).

   · Agenda: l'elenco per giorni di sempre, in un riquadro che
     scorre e si apre su oggi.
   · Corsi: l'orario della settimana da oggi in avanti, giorni in
     colonna, mattina e pomeriggio in riga. Prima era un elenco
     di una riga per lezione (44 il 12/11) e allungava tutta la
     pagina.

   Modulo senza database e senza DOM: riceve le righe di
   s_bacheca_eventi e restituisce HTML. Le ore e i giorni si
   calcolano sempre nel fuso di Roma, non in quello del PC.
   ============================================================ */

const FUSO = 'Europe/Rome';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const fmtGiorno = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtOra = new Intl.DateTimeFormat('it-IT', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtEti = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' });

const conOra = (e) => !e.tutto_il_giorno && String(e.inizio || '').length > 10;
/* il giorno dell'evento, aaaa-mm-gg: per gli eventi «tutto il giorno» è la data scritta, per gli altri quella di Roma */
export const giornoEvento = (e) => (conOra(e) ? fmtGiorno.format(new Date(e.inizio)) : String(e.inizio || '').slice(0, 10));
export const oraRoma = (iso) => (iso && String(iso).length > 10 ? fmtOra.format(new Date(iso)) : '');
export const etichettaGiorno = (giorno) => fmtEti.format(new Date(giorno + 'T00:00:00Z'));
const orario = (e) => (conOra(e) ? oraRoma(e.inizio) + (e.fine ? '–' + oraRoma(e.fine) : '') : 'tutto il giorno');

const perGiorno = (eventi) => {
  const m = new Map();
  for (const e of [...eventi].sort((a, b) => String(a.inizio).localeCompare(String(b.inizio)))) {
    const g = giornoEvento(e);
    if (!g) continue;
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(e);
  }
  return new Map([...m].sort((a, b) => a[0].localeCompare(b[0])));
};

const apri = (e) => (e.link ? ` data-apri="${esc(e.link)}"` : '');
const rigaEvento = (e, conCalendario) => `
  <div class="hm-riga"${apri(e)}>
    <span>${conOra(e) ? '🕒' : '📌'}</span>
    <span><strong>${esc(e.titolo || '')}</strong>${e.luogo ? ` <span class="hint">· ${esc(e.luogo)}</span>` : ''}${conCalendario && e.calendario && !/^primary/.test(e.calendario) ? `<span class="hint"> · ${esc(e.calendario)}</span>` : ''}</span>
    <span class="hint">${orario(e)}</span>
  </div>`;

/* ── Agenda: l'elenco per giorni, com'era (l'utente il 12/11/2026 non ha voluto le linguette) ──
   Il titolo del giorno di oggi porta data-oggi: il cruscotto ci fa scorrere il riquadro. */
export function agendaElenco(eventi, oggi) {
  return [...perGiorno(eventi)].map(([g, righe]) => `
    <div class="hint hm-giorno"${g === oggi ? ' data-oggi' : ''}>${esc(etichettaGiorno(g))}${g === oggi ? ' · oggi' : ''}</div>${righe.map((e) => rigaEvento(e, true)).join('')}`).join('');
}

/* ── Corsi ──
   Il titolo che scrive l'import della programmazione è «149 · TITOLO · teorico (giornata 1 di 2)»:
   se la forma è un'altra, il titolo resta intero e il codice vuoto (non si indovina). */
export function leggiCorso(titolo) {
  const parti = String(titolo || '').split(' · ').map((p) => p.trim());
  const codice = parti.length > 1 && /^\d+$/.test(parti[0]) ? parti.shift() : '';
  const fase = parti.length > 1 && /^(teorico|pratico)\b/i.test(parti[parti.length - 1]) ? parti.pop() : '';
  return { codice, nome: parti.join(' · '), fase, pratico: /^pratico/i.test(fase) };
}

/* la mattina finisce alle 13: una lezione che comincia prima è della mattina */
const eMattina = (e) => !conOra(e) || Number(oraRoma(e.inizio).slice(0, 2)) < 13;

/* i giorni da oggi in avanti, ognuno con le lezioni della mattina e del pomeriggio */
export function orarioCorsi(eventi, oggi) {
  const giorni = [...perGiorno(eventi)].filter(([g]) => g >= oggi)
    .map(([giorno, righe]) => ({ giorno, mattina: righe.filter(eMattina), pomeriggio: righe.filter((e) => !eMattina(e)) }));
  return { giorni, lezioni: giorni.reduce((s, g) => s + g.mattina.length + g.pomeriggio.length, 0) };
}

const dettaglioCorso = (e, giorno) => {
  const c = leggiCorso(e.titolo);
  return `<strong>${c.codice ? esc(c.codice) + ' · ' : ''}${esc(c.nome)}</strong>${c.fase ? ' · ' + esc(c.fase) : ''}${e.luogo ? ' · ' + esc(e.luogo) : ''} · ${esc(etichettaGiorno(giorno))} · ${orario(e)}`
    + (e.link ? ` · <a href="${esc(e.link)}" target="_blank" rel="noopener">apri nel calendario</a>` : '');
};

/* la riga del dettaglio sta fuori dal corpo che scorre: la mette il cruscotto sotto la griglia */
export const DETTAGLIO_ORARIO = '<div class="hm-or-det hint"><i class="hm-or-fase"></i>teorico · <i class="hm-or-fase hm-or-pratico"></i>pratico. Premi un corso per leggere titolo intero, sede e orario.</div>';

/* la griglia dell'orario; '' se da oggi in avanti non c'è niente */
export function htmlOrarioCorsi(eventi, oggi) {
  const { giorni } = orarioCorsi(eventi, oggi);
  if (!giorni.length) return '';
  const cella = (g, lista) => `<div>${lista.map((e) => {
    const c = leggiCorso(e.titolo);
    return `<button type="button" class="hm-or-corso" data-or-det="${esc(dettaglioCorso(e, g.giorno))}" title="${esc(e.titolo || '')}"><span><i class="hm-or-fase${c.pratico ? ' hm-or-pratico' : ''}"></i>${c.codice ? `<b>${esc(c.codice)}</b>` : ''}${esc(c.nome)}</span></button>`;
  }).join('')}</div>`;
  return `<div class="hm-or-scorri"><div class="hm-or" style="--col:${giorni.length}">
      <div class="hm-or-testa"></div>${giorni.map((g) => `<div class="hm-or-testa${g.giorno === oggi ? ' hm-or-oggi' : ''}">${esc(etichettaGiorno(g.giorno))}${g.giorno === oggi ? ' · oggi' : ''}</div>`).join('')}
      <div class="hm-or-fascia">Mattina</div>${giorni.map((g) => cella(g, g.mattina)).join('')}
      <div class="hm-or-fascia">Pomeriggio</div>${giorni.map((g) => cella(g, g.pomeriggio)).join('')}
    </div></div>`;
}
