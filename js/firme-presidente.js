/* ============================================================
   FIRME DEL PRESIDENTE NELL'APP (04/10/2026)

   Chiesto dall'utente: le lettere di incarico — di docenza dei corsi e
   del gruppo di verifica dell'asseverazione — sono a firma del
   Presidente, e il giro di carta «richiede un sacco di tempo». Da oggi:
     1. la segreteria genera e protocolla la lettera, che va al
        Presidente da firmare: il PDF si conserva nel bucket privato
        `firme-presidente` (la fotografia esatta che lui leggerà) e la
        funzione `firma-presidente` registra la richiesta e gli manda
        l'avviso — mail + notifica, testo tutto dal database;
     2. il Presidente, nella sua pagina del gestionale visite, legge e
        preme «Firmo» (o «Rimando» col motivo);
     3. la segreteria trova la versione firmata, la deposita e prepara
        la mail al destinatario, che manda lei, come sempre;
     4. l'originale firmato a mano è facoltativo: se c'è, si segna.
   Qui: le funzioni comuni (chiedere, leggere, scaricare) e la tessera
   del cruscotto «✍️ Firme del Presidente».
   ============================================================ */

import { sb, esc, dataIt, toast } from './core.js';

const BUCKET = 'firme-presidente';

/* Manda in firma uno o più documenti in una chiamata sola (una mail sola).
   docs: [{ tipo, rif, protocollo_id, titolo, destinatario, nome_file,
            byte: Uint8Array, riquadro: {pagina, x, y, w, h} }]
   → { richieste, avviso: { inviata, errore? } } */
export async function chiediFirma(docs) {
  const documenti = [];
  for (const d of docs) {
    if (!d.riquadro) throw new Error(`Non so dove va la firma su «${d.titolo}».`);
    const sicuro = String(d.rif).replace(/[^\w-]+/g, '_');
    const percorso = `originali/${d.tipo}/${sicuro}_${Date.now()}.pdf`;
    const { error } = await sb.storage.from(BUCKET)
      .upload(percorso, new Blob([d.byte], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error('Non riesco a conservare il documento da firmare: ' + error.message);
    documenti.push({
      tipo: d.tipo, rif: d.rif, protocollo_id: d.protocollo_id ?? null, titolo: d.titolo,
      destinatario: d.destinatario ?? null, nome_file: d.nome_file, file_originale: percorso, riquadro: d.riquadro,
    });
  }
  const { data, error } = await sb.functions.invoke('firma-presidente', { body: { azione: 'richiedi', documenti } });
  if (error || data?.error) throw new Error(data?.error || await testoErrore(error));
  return data;
}

/* l'errore di una edge function porta il messaggio vero nel corpo */
async function testoErrore(error) {
  try { const j = await error?.context?.json?.(); if (j?.error) return j.error; } catch { /* niente */ }
  return error?.message || 'richiesta non riuscita';
}

/* L'ultima richiesta di firma per ogni riferimento: Map rif → riga.
   Lancia se non riesce a leggere: chi chiama deve dirlo, non tacere. */
export async function firmeDi(tipo, rifs) {
  const mappa = new Map();
  if (!rifs.length) return mappa;
  const { data, error } = await sb.from('s_firme_presidente').select('*')
    .eq('tipo', tipo).in('rif', rifs).order('richiesta_il', { ascending: false });
  if (error) throw new Error('Non sono riuscito a leggere le firme del Presidente: ' + error.message);
  for (const r of data || []) if (!mappa.has(r.rif)) mappa.set(r.rif, r);
  return mappa;
}

/* I byte della versione firmata */
export async function scaricaFirmata(r) {
  if (!r?.file_firmato) throw new Error('Il documento non è ancora firmato.');
  const { data, error } = await sb.storage.from(BUCKET).download(r.file_firmato);
  if (error || !data) throw new Error('Non trovo il documento firmato.');
  return new Uint8Array(await data.arrayBuffer());
}

/* Apre un PDF del bucket in una scheda nuova (link temporaneo di 10 minuti) */
export async function apriPdf(percorso) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(percorso, 600);
  if (error || !data?.signedUrl) return toast('Non riesco ad aprire il documento: ' + (error?.message || ''), 'err');
  window.open(data.signedUrl, '_blank', 'noopener');
}

/* Una piccola etichetta dello stato, per le tabelle che elencano le lettere */
export function etichettaFirma(r) {
  if (!r) return '';
  if (r.stato === 'firmata') return `<span class="dt-cella dt-ok" style="padding:1px 6px" title="Firmata nell'app il ${dataIt(r.firmata_il)}">✅ firmata</span>`;
  if (r.stato === 'in_attesa') {
    const ko = String(r.avviso_esito || '').startsWith('non inviato');
    return `<span class="dt-cella dt-scaduto" style="padding:1px 6px" title="${esc(r.avviso_esito || '')}">✍ dal Presidente${ko ? ' ⚠' : ''}</span>`;
  }
  if (r.stato === 'rimandata') return `<span class="dt-cella dt-scaduto" style="padding:1px 6px" title="${esc(r.rimandata_motivo || '')}">↩ rimandata</span>`;
  return '';
}

/* ── la tessera del cruscotto ───────────────────────────────── */

export async function datiCruscotto() {
  const { data, error } = await sb.from('s_firme_presidente')
    .select('id, tipo, rif, titolo, stato, richiesta_il, avviso_il, avviso_esito, firmata_il, rimandata_il, rimandata_motivo, autografo_il, usata_il, file_originale, file_firmato')
    .order('richiesta_il', { ascending: false }).limit(300);
  if (error) return { errore: error.message, inAttesa: [], rimandate: [], daUsare: [], senzaAutografo: [] };
  /* conta l'ultima richiesta di ogni documento: una rimandata poi rifatta non resta in lista */
  const ultime = new Map();
  for (const r of data || []) { const k = `${r.tipo}|${r.rif}`; if (!ultime.has(k)) ultime.set(k, r); }
  const tutte = [...ultime.values()];
  return {
    errore: null,
    inAttesa: tutte.filter((r) => r.stato === 'in_attesa'),
    rimandate: tutte.filter((r) => r.stato === 'rimandata'),
    daUsare: tutte.filter((r) => r.stato === 'firmata' && !r.usata_il),
    senzaAutografo: tutte.filter((r) => r.stato === 'firmata' && !r.autografo_il),
  };
}

const giorni = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null;
const dove = (r) => r.tipo === 'incarico_docenza' ? 'dalla scheda del corso' : 'dall\'app asseverazione, «Iter d\'ufficio»';

export function cardFirme(card, f) {
  if (f.errore) return card('✍️ Firme del Presidente', 0, '', '', { k: 'firme', nonLetto: true });
  const n = f.inAttesa.length + f.rimandate.length + f.daUsare.length;
  const riga = (r, testo, azioni) => `
    <div class="hm-riga" style="cursor:default">
      <span>${r.stato === 'firmata' ? '✅' : r.stato === 'rimandata' ? '↩' : '✍'}</span>
      <span><strong>${esc(r.titolo)}</strong><br><span class="hint">${testo}</span></span>
      <span style="white-space:nowrap">${azioni}</span>
    </div>`;
  const apri = (p, t = 'apri') => p ? `<a href="#" data-fp-apri="${esc(p)}">${t}</a>` : '';
  const corpo = [
    ...f.inAttesa.map((r) => riga(r,
      `in firma dal ${dataIt(r.richiesta_il)}${giorni(r.richiesta_il) ? ` (${giorni(r.richiesta_il)} g)` : ''}`
        + (String(r.avviso_esito || '').startsWith('non inviato') ? ' · <span style="color:#a01f00">⚠ la mail al Presidente non è partita</span>' : ''),
      `${apri(r.file_originale)} · <a href="#" data-fp-ritira="${r.id}">ritira</a>`)),
    ...f.rimandate.map((r) => riga(r,
      `rimandata il ${dataIt(r.rimandata_il)}: «${esc(r.rimandata_motivo || '')}» — si rifà ${dove(r)}`,
      apri(r.file_originale))),
    ...f.daUsare.map((r) => riga(r,
      `firmata il ${dataIt(r.firmata_il)} — mail e dossier ${dove(r)}`,
      apri(r.file_firmato, 'apri firmata'))),
  ].join('');
  const azione = `
    ${f.inAttesa.length ? '<button class="btn btn-sm" type="button" id="hm-fp-ricorda">🔔 Ricorda al Presidente</button>' : ''}
    ${f.senzaAutografo.length ? `<details style="margin-top:8px"><summary class="hint">Originali firmati a mano (facoltativi): ${f.senzaAutografo.length} da segnare</summary>
      ${f.senzaAutografo.map((r) => `<div class="hm-riga" style="cursor:default"><span>📝</span><span>${esc(r.titolo)}</span>
        <span><a href="#" data-fp-autografo="${r.id}">segna l'originale</a></span></div>`).join('')}</details>` : ''}`;
  return card('✍️ Firme del Presidente', n, corpo || '<p class="hint">Niente da firmare né da spedire.</p>', azione,
    { k: 'firme', sempre: f.senzaAutografo.length > 0 });
}

export function collegaFirme(host, ricarica) {
  host.querySelectorAll('[data-fp-apri]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault(); apriPdf(a.dataset.fpApri);
  }));
  host.querySelectorAll('[data-fp-ritira]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    if (!confirm('Ritiro la richiesta di firma? Il documento sparisce dall\'elenco del Presidente (per esempio perché la lettera va rifatta).')) return;
    const { data, error } = await sb.functions.invoke('firma-presidente', { body: { azione: 'ritira', id: Number(a.dataset.fpRitira) } });
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    toast('Richiesta ritirata.', 'ok'); ricarica();
  }));
  host.querySelector('#hm-fp-ricorda')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (!confirm('Rimando al Presidente la mail con tutto quello che aspetta la sua firma?')) return;
    b.disabled = true;
    const { data, error } = await sb.functions.invoke('firma-presidente', { body: { azione: 'avvisa' } });
    b.disabled = false;
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    if (!data?.avviso?.inviata) return toast('La mail non è partita: ' + (data?.avviso?.errore || 'motivo sconosciuto'), 'err');
    toast(`Mail mandata al Presidente (${data.avviso.documenti} documenti in attesa).`, 'ok'); ricarica();
  });
  host.querySelectorAll('[data-fp-autografo]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const oggi = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    const d = prompt('Data in cui il Presidente ha firmato a mano l\'originale (gg/mm/aaaa):', oggi);
    if (!d) return;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d.trim());
    if (!m) return toast('Scrivi la data come gg/mm/aaaa.', 'err');
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const { error } = await sb.rpc('s_firma_autografo', { p_id: Number(a.dataset.fpAutografo), p_data: iso });
    if (error) return toast('Non registrato: ' + error.message, 'err');
    toast('Originale segnato.', 'ok'); ricarica();
  }));
}
