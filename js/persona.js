/* ============================================================
   Maschera Persone (l'erede della «Dipendenti» di Access).

   Differenza voluta rispetto ad Access: la persona NON porta
   addosso l'impresa. Una persona cambia ditta — gli operai
   spesso — e sono le NOMINE (s_nomine: persona + ruolo +
   impresa + dal/al) ad agganciarla: così degli spostamenti
   resta traccia invece di sovrascriverli. Qui le nomine si
   vedono; la maschera per gestirle arriverà a parte, come i
   corsi frequentati.

   Doppio clic su un campo email → bozza .eml già strutturata
   (come il doppio clic di Access): oggetto con data e nome,
   cc alla Direzione, saluti e firma della Segreteria. La
   rileggi in Outlook, la completi e la mandi tu.

   Dati personali comuni, GDPR normale: si mostrano a chi è
   abilitato, non si arricchiscono senza motivo.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, mostraVista } from './core.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';

let corrente = null;   // persona aperta (null = ricerca)

/* I campi della tabella persone, raggruppati come nella maschera
   Access. Quelli d'impresa (ruolo, mansione, assunzione...) NON
   sono qui: stanno nelle nomine. */
const GRUPPI = [
  ['Identità', [
    ['titolo', 'Titolo'], ['cognome', 'Cognome'], ['nome', 'Nome'],
    ['sesso', 'Sesso'], ['cf', 'Codice fiscale'], ['piva', 'P.IVA'],
  ]],
  ['Nascita e cittadinanza', [
    ['data_nascita', 'Nato il', 'date'], ['comune_nascita', 'Comune di nascita'],
    ['cittadinanza', 'Cittadinanza'],
  ]],
  ['Residenza', [
    ['indirizzo', 'Indirizzo'], ['comune_res', 'Comune'], ['prov_res', 'Prov.'],
    ['cap_res', 'CAP'], ['stato_res', 'Stato'],
  ]],
  ['Contatti', [
    ['email', 'Email', 'email'], ['email2', 'Email 2', 'email'], ['email3', 'Email 3', 'email'],
    ['telefono', 'Telefono'], ['telefono2', 'Telefono 2'],
  ]],
  ['Codici', [
    ['qualifica', 'Qualifica'], ['cod_socrate', 'Codice Socrate'],
    ['cassa_previdenza', 'Cassa di previdenza'],
  ]],
];
const TUTTI = GRUPPI.flatMap(([, campi]) => campi.map(([k]) => k));

const nomePersona = (p) => [p.nome, p.titolo, p.cognome].filter(Boolean).join(' ');

/* ── vista principale: ricerca o scheda ───────────────────── */
export async function render() {
  const host = $('#persone-host');
  if (corrente) return scheda(host);
  host.innerHTML = `
    <div class="dt-barra">
      <input id="pe-cerca" class="inp" type="search" style="max-width:420px"
             placeholder="Cerca per cognome, nome o codice fiscale (almeno 3 lettere)…">
      <button class="btn btn-primary btn-sm" id="pe-nuova">+ Nuova persona</button>
    </div>
    <div id="pe-esiti"><p class="hint">L'anagrafica conta migliaia di persone: si parte cercando.</p></div>`;

  $('#pe-cerca').addEventListener('input', (e) => {
    clearTimeout(render._t);
    render._t = setTimeout(() => cerca(e.target.value), 350);
  });
  $('#pe-cerca').focus();
  $('#pe-nuova').addEventListener('click', () => { corrente = { persona_id: null }; render(); });
}

async function cerca(testo) {
  const t = testo.trim();
  const box = $('#pe-esiti');
  if (t.length < 3) { box.innerHTML = '<p class="hint">Almeno 3 lettere.</p>'; return; }
  const { data, error } = await sb.from('persone')
    .select('persona_id, titolo, cognome, nome, cf, email, telefono, comune_res')
    .or(`cognome.ilike.%${t}%,nome.ilike.%${t}%,cf.ilike.%${t}%`)
    .order('cognome').limit(60);
  if (error) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; }
  box.innerHTML = data.length ? `
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Nominativo</th><th style="width:160px">Codice fiscale</th><th>Email</th><th style="width:130px">Telefono</th><th style="width:150px">Comune</th></tr></thead>
      <tbody>${data.map((p) => `
        <tr data-id="${p.persona_id}">
          <td><strong>${esc([p.titolo, p.cognome, p.nome].filter(Boolean).join(' '))}</strong></td>
          <td style="font-size:12px">${esc(p.cf || '')}</td>
          <td style="font-size:12px">${esc(p.email || '')}</td>
          <td>${esc(p.telefono || '')}</td>
          <td>${esc(p.comune_res || '')}</td>
        </tr>`).join('')}
      </tbody></table></div>
    <p class="hint" style="margin-top:6px">${data.length} risultati (massimo 60).</p>`
    : '<p class="empty">Nessuna persona trovata.</p>';
  box.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => apriPersona(tr.dataset.id)));
}

/* Apre la scheda (anche da altri moduli: RLS, imprese). */
export async function apriPersona(personaId) {
  const { data, error } = await sb.from('persone').select('*').eq('persona_id', personaId).single();
  if (error || !data) return toast('Persona non trovata: ' + (error?.message || personaId), 'err');
  corrente = data;
  mostraVista('persone');
  render();
}

/* ── la scheda ────────────────────────────────────────────── */
async function scheda(host) {
  const p = corrente;
  const nuova = !p.persona_id;

  /* le nomine della persona: sono LORO ad agganciarla alle imprese */
  let nomine = [];
  if (!nuova) {
    const { data } = await sb.from('s_nomine')
      .select('access_id, data_reg, impresa_txt, impresa_id, ruolo_txt, mansione, data_inizio, data_fine, note, email_ruolo')
      .eq('persona_id', p.persona_id)
      .order('data_inizio', { ascending: false, nullsFirst: false });
    nomine = data || [];
  }
  let rls = [];
  if (!nuova && p.cf) {
    const { data } = await sb.from('s_rls_anagrafe')
      .select('id, ragione_sociale, decorrenza, fine_nomina, tipo_elezione')
      .eq('rls_cf', p.cf).order('decorrenza', { ascending: false, nullsFirst: false });
    rls = data || [];
  }
  const inCorso = (n) => !n.data_fine || n.data_fine >= oggiIso();

  host.innerHTML = `
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
      <button class="btn btn-ghost btn-sm" id="pe-indietro">‹ Torna alla ricerca</button>
      <h3 style="margin:0">${nuova ? 'Nuova persona' : esc([p.titolo, p.cognome, p.nome].filter(Boolean).join(' '))}</h3>
    </div>

    ${GRUPPI.map(([titolo, campi]) => `
      <div class="sez">
        <h3>${titolo}</h3>
        <div class="grid-3">
          ${campi.map(([k, l, tipo]) => `
            <div class="field"><label for="pe-${k}">${l}</label>
              <input type="${tipo === 'date' ? 'date' : 'text'}" id="pe-${k}" data-campo="${k}"
                     ${tipo === 'email' ? 'data-mail="1" title="Doppio clic per scrivere una mail"' : ''}
                     value="${esc(p[k] ?? '')}"></div>`).join('')}
        </div>
      </div>`).join('')}

    <div class="sez">
      <h3>Note</h3>
      <textarea id="pe-note" style="min-height:90px">${esc(p.note ?? '')}</textarea>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin:12px 0">
      <button class="btn btn-primary" id="pe-salva">${nuova ? 'Crea la persona' : 'Salva le modifiche'}</button>
    </div>

    ${nuova ? '' : `
    <div class="sez">
      <h3>Nomine e rapporti — ${nomine.length}</h3>
      <p class="hint" style="margin:0 0 8px">
        Sono le nomine ad agganciare la persona alle imprese: quando cambia ditta se ne
        aggiunge una nuova e la vecchia si chiude con la data — degli spostamenti resta traccia.
        La maschera per gestirle arriverà a parte.
      </p>
      ${nomine.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr>
          <th style="width:100px">Dal</th><th style="width:100px">Al</th>
          <th>Impresa</th><th style="width:180px">Ruolo</th>
          <th style="width:150px">Mansione</th><th>Note</th>
        </tr></thead>
        <tbody>${nomine.map((n) => `
          <tr ${n.impresa_id ? `data-imp="${esc(n.impresa_id)}" style="cursor:pointer" title="Apri la scheda impresa"` : ''}
              class="${inCorso(n) ? '' : 'dt-riga-storico'}">
            <td>${dataIt(n.data_inizio)}</td>
            <td>${n.data_fine ? dataIt(n.data_fine) : '<span class="pill pill-prima">in corso</span>'}</td>
            <td><strong>${esc(n.impresa_txt || n.impresa_id || '—')}</strong></td>
            <td>${esc(n.ruolo_txt || '')}</td>
            <td>${esc(n.mansione || '')}</td>
            <td style="font-size:12px">${esc(n.note || '')}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Nessuna nomina registrata.</p>'}
    </div>

    ${rls.length ? `
    <div class="sez">
      <h3>Comunicazioni RLS — ${rls.length}</h3>
      ${rls.map((r) => `
        <div class="dt-doc-riga">RLS per <strong>${esc(r.ragione_sociale || '?')}</strong>
          ${r.tipo_elezione ? ` (${esc(r.tipo_elezione)})` : ''}
          ${r.decorrenza ? ` · dal ${dataIt(r.decorrenza)}` : ''}${r.fine_nomina ? ` al ${dataIt(r.fine_nomina)}` : ''}</div>`).join('')}
    </div>` : ''}`}
  `;

  $('#pe-indietro').addEventListener('click', () => { corrente = null; render(); });

  /* doppio clic su una mail → bozza Outlook già strutturata,
     come il doppio clic della maschera Access */
  host.querySelectorAll('input[data-mail]').forEach((inp) =>
    inp.addEventListener('dblclick', () => {
      const a = inp.value.trim();
      if (!a) return toast('Campo email vuoto.', 'err');
      bozzaMailPersona(p, a);
    }));

  host.querySelectorAll('tr[data-imp]').forEach((tr) =>
    tr.addEventListener('click', async () => {
      const mod = await import('./imprese.js');
      mod.apriScheda(tr.dataset.imp);
    }));

  $('#pe-salva').addEventListener('click', async (ev) => {
    const agg = {};
    for (const k of TUTTI) agg[k] = $(`#pe-${k}`).value.trim() || null;
    agg.note = $('#pe-note').value.trim() || null;
    if (agg.cf) agg.cf = agg.cf.toUpperCase();
    if (!agg.cognome && !agg.nome) return toast('Serve almeno il cognome o il nome.', 'err');
    attendi(ev.currentTarget, true);
    let error;
    if (nuova) {
      /* mai duplicare: il CF è la chiave che non sbaglia */
      if (agg.cf) {
        const { data: gia } = await sb.from('persone').select('persona_id').eq('cf', agg.cf).limit(1);
        if (gia?.length) {
          attendi(ev.currentTarget, false);
          toast('Esiste già una persona con questo codice fiscale: la apro.', 'err');
          return apriPersona(gia[0].persona_id);
        }
      }
      const { data, error: e2 } = await sb.from('persone')
        .insert({ ...agg, updated_by: state.email }).select('persona_id').single();
      error = e2;
      if (!error) { corrente = null; attendi(ev.currentTarget, false); toast('Persona creata.', 'ok'); return apriPersona(data.persona_id); }
    } else {
      ({ error } = await sb.from('persone')
        .update({ ...agg, updated_by: state.email, updated_at: new Date().toISOString() })
        .eq('persona_id', p.persona_id));
    }
    attendi(ev.currentTarget, false);
    if (error) return toast('Salvataggio non riuscito: ' + error.message, 'err');
    toast('Modifiche salvate.', 'ok');
    Object.assign(corrente, agg);
    render();
  });
}

/* La mail «da doppio clic», ricalcata su quella che generava Access:
   oggetto con data e ora, cc alla Direzione, corpo da completare. */
function bozzaMailPersona(p, indirizzo) {
  const chi = nomePersona(p) || indirizzo;
  const ora = new Date();
  const zeri = (n) => String(n).padStart(2, '0');
  const quando = `${zeri(ora.getDate())}/${zeri(ora.getMonth() + 1)}/${ora.getFullYear()} ${zeri(ora.getHours())}:${zeri(ora.getMinutes())}:${zeri(ora.getSeconds())}`;
  scaricaEml({
    to: indirizzo,
    cc: ['direzione@formedilpadova.it'],
    oggetto: `FORMEDIL PADOVA - Area Sicurezza e Salute - Invio - del ${quando} - ${chi}.`,
    corpo: `Gent.le ${chi},
buongiorno,



Distinti saluti.

${FIRMA_SEGRETERIA}`,
    nomeFile: `mail-${(p.cognome || 'persona').toLowerCase()}.eml`,
  });
  toast(`Bozza per ${indirizzo} scaricata: completala in Outlook e premi Invia.`, 'ok');
}

/* Crea una persona coi dati già noti e restituisce il suo id.
   Prima si ricontrolla il CF: mai duplicare. */
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
