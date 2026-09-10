/* ============================================================
   Manuali d'uso — sempre l'ultima versione (10/09/2026)

   «📘 Manuali d'uso» in fondo al menu: elenca i manuali che l'utente può
   leggere e li scarica dalla edge function `manuali`, che li prende da
   Drive (9_APPLICATIVI/Gestionale_Visite_APP/Manuali_pubblicati).
   Stesso meccanismo del pulsante del gestionale visite e dell'app
   asseverazione: un manuale non si manda più per mail a ogni versione.

   Il pallino dice che c'è una versione che SU QUESTO DISPOSITIVO non è
   ancora stata scaricata (localStorage).
   ============================================================ */

import { sb, $, esc, toast, apriDrawer } from './core.js';
import { SB_URL, SB_KEY } from './config.js';

const CHIAVE = 'manuali-scaricati';

const visti = () => { try { return JSON.parse(localStorage.getItem(CHIAVE) || '{}'); } catch { return {}; } };
const segnaVisto = (codice, versione) => {
  try { localStorage.setItem(CHIAVE, JSON.stringify({ ...visti(), [codice]: versione })); } catch { /* niente */ }
};
const dataIt = (iso) => String(iso || '').split('-').reverse().join('/');
const mb = (b) => (b ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : '');

async function chiama(body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Accesso scaduto: rientra nell'app");
  const r = await fetch(`${SB_URL}/functions/v1/manuali`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let m = `errore ${r.status}`;
    try { m = (await r.json()).error || m; } catch { /* risposta non JSON */ }
    throw new Error(m);
  }
  return r;
}

const elenco = async () => (await (await chiama({ azione: 'elenco' })).json()).manuali || [];

function pallino(manuali) {
  const btn = $('#nav-manuali');
  if (!btn) return;
  const v = visti();
  const nuovi = manuali.filter((m) => v[m.codice] !== m.versione).length;
  btn.innerHTML = `📘 Manuali d’uso${nuovi ? ' <span class="man-pallino"></span>' : ''}`;
  btn.title = nuovi
    ? `${nuovi === 1 ? 'Un manuale ha' : `${nuovi} manuali hanno`} una versione che su questo dispositivo non hai ancora scaricato`
    : 'Manuali d’uso — sempre l’ultima versione';
}

async function scarica(m, bottone) {
  const testo = bottone.textContent;
  bottone.disabled = true;
  bottone.textContent = 'Scarico…';
  try {
    const r = await chiama({ azione: 'scarica', codice: m.codice });
    const url = URL.createObjectURL(new Blob([await r.blob()], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: m.nome_file });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    segnaVisto(m.codice, m.versione);
    bottone.closest('[data-manuale]')?.querySelector('.man-nuova')?.remove();
    toast(`Scaricato: ${m.titolo} v${m.versione}`, 'ok');
    elenco().then(pallino).catch(() => {});
  } catch (e) {
    toast(`Manuale non scaricato: ${e.message}`, 'err');
  } finally {
    bottone.disabled = false;
    bottone.textContent = testo;
  }
}

async function apri() {
  apriDrawer('📘 Manuali d’uso', '', '<p class="muted">Carico l’elenco…</p>');
  const corpo = $('#drawer-body');
  try {
    const manuali = await elenco();
    pallino(manuali);
    const v = visti();
    corpo.innerHTML = (manuali.length
      ? manuali.map((m, i) => `
        <div class="man-riga" data-manuale="${i}">
          <div>
            <div class="man-titolo">${esc(m.titolo)}${v[m.codice] !== m.versione ? ' <span class="man-nuova">nuova</span>' : ''}</div>
            <div class="man-dett">${esc(m.app)} · versione <b>${esc(m.versione)}</b> del ${dataIt(m.data)}${m.dimensione ? ` · ${mb(m.dimensione)}` : ''}
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" data-scarica="${i}">⬇ Scarica</button>
        </div>`).join('')
      : '<p class="muted">Nessun manuale pubblicato per il tuo utente.</p>')
      + `<p class="muted man-nota">Qui c’è sempre l’<b>ultima versione</b>: quando un manuale viene rigenerato si ripubblica da solo,
         e la versione precedente viene eliminata. È il posto a cui rimandare i tecnici invece di mandare il PDF per mail.</p>`;
    corpo.querySelectorAll('[data-scarica]').forEach((b) =>
      b.addEventListener('click', () => scarica(manuali[Number(b.dataset.scarica)], b)));
  } catch (e) {
    corpo.innerHTML = `<p class="empty">Elenco non disponibile: ${esc(e.message)}</p>`;
  }
}

/* Da chiamare quando l'app è visibile: collega il pulsante e guarda
   subito se c'è una versione nuova (in silenzio se non risponde). */
export function collegaManuali() {
  const btn = $('#nav-manuali');
  if (!btn || btn.dataset.collegato) return;
  btn.dataset.collegato = '1';
  btn.addEventListener('click', () => { $('#sidebar').classList.remove('is-open'); apri(); });
  elenco().then(pallino).catch(() => {});
}
