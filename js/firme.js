/* ============================================================
   LE FIRME NELL'APP — il registro generale (13/10/2026)

   Nato il 04/10/2026 come «firme del Presidente» (js/firme-presidente.js,
   che ora è un rimando a questo file): le lettere di incarico a sua firma
   si leggono e si firmano nel gestionale, la segreteria trova la versione
   firmata. Dal 13/10/2026 (lotto 1 del fascicolo corso digitale) lo
   stesso giro vale per TUTTI i firmatari: Presidente, Direttore,
   responsabile del progetto formativo (RPF) e docenti dei corsi.
     1. la segreteria genera il PDF e lo manda in firma: il file va nel
        bucket privato `firme-presidente` (nome storico), la funzione
        `firma-documenti` registra UNA RIGA PER FIRMATARIO in `s_firme`
        e avvisa il primo — mail + notifica, testo tutto dal database;
     2. il firmatario, nella sua pagina del gestionale, legge e preme
        «Firmo» (o «Rimando» col motivo). Documenti a più firme: catena
        ordinata, la seconda firma si appone sul PDF già firmato dalla
        prima;
     3. la segreteria trova la versione firmata (quella dell'ULTIMA riga
        della catena), la deposita e prepara la mail, che manda lei;
     4. l'originale firmato a mano è facoltativo: se c'è, si segna; se
        qualcuno firma SOLO su carta, la scansione prende il posto della
        firma nell'app («autografa») e la catena prosegue.
   Qui: le funzioni comuni (chiedere, leggere, scaricare) e la tessera
   del cruscotto «✍️ Firme in attesa».
   ============================================================ */

import { sb, esc, dataIt, toast } from './core.js';
import { riassuntoCatena } from './firme-regole.js';
export { riassuntoCatena };

const BUCKET = 'firme-presidente';
export const RUOLI_FIRMA = { presidente: 'Presidente', direttore: 'Direttore', rpf: 'resp. progetto formativo', docente: 'docente' };

/* Manda in firma uno o più documenti in una chiamata sola (una mail per
   firmatario).
   docs: [{ tipo, rif, protocollo_id?, corso_id?, titolo, destinatario?,
            nome_file, byte: Uint8Array,
            firmatari: [{ ruolo: 'presidente'|'direttore'|'rpf'|'docente',
                          email?, persona_id?, riquadro: {pagina, x, y, w, h} }],
            riquadro? }]   ← la forma vecchia: solo il Presidente
   → { richieste, avviso: { inviata, errore? }, avvisi } */
export async function chiediFirma(docs) {
  const documenti = [];
  for (const d of docs) {
    const firmatari = Array.isArray(d.firmatari) && d.firmatari.length
      ? d.firmatari : (d.riquadro ? [{ ruolo: 'presidente', riquadro: d.riquadro }] : []);
    if (!firmatari.length) throw new Error(`Non so chi deve firmare «${d.titolo}».`);
    for (const f of firmatari) if (!f.riquadro) throw new Error(`Non so dove va la firma (${RUOLI_FIRMA[f.ruolo] || f.ruolo}) su «${d.titolo}».`);
    const sicuro = String(d.rif).replace(/[^\w-]+/g, '_');
    const percorso = `originali/${d.tipo}/${sicuro}_${Date.now()}.pdf`;
    const { error } = await sb.storage.from(BUCKET)
      .upload(percorso, new Blob([d.byte], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error('Non riesco a conservare il documento da firmare: ' + error.message);
    documenti.push({
      tipo: d.tipo, rif: d.rif, protocollo_id: d.protocollo_id ?? null, corso_id: d.corso_id ?? null, titolo: d.titolo,
      destinatario: d.destinatario ?? null, nome_file: d.nome_file, file_originale: percorso, firmatari,
    });
  }
  const { data, error } = await sb.functions.invoke('firma-documenti', { body: { azione: 'richiedi', documenti } });
  if (error || data?.error) throw new Error(data?.error || await testoErrore(error));
  return data;
}

/* (14/10/2026) Che cosa dire dopo una richiesta di firma. Gli avvisi sono
   di tre specie: mail partita, mail non partita, e «a raccolta» (il
   Presidente: nessuna mail adesso, il riepilogo lo manda la segreteria dal
   cruscotto). → [testo, 'ok'|'err'] */
export function esitoAvvisi(out, cosa) {
  const avvisi = out?.avvisi?.length ? out.avvisi : (out?.avviso ? [out.avviso] : []);
  const inviate = avvisi.filter((x) => x.inviata).map((x) => x.a);
  const raccolti = avvisi.filter((x) => x.raccolto);
  const fallite = avvisi.filter((x) => !x.inviata && !x.raccolto);
  const pezzi = [];
  if (inviate.length) pezzi.push(`mail mandata a ${inviate.join(', ')}`);
  if (raccolti.length) pezzi.push(`${raccolti.some((x) => x.ruolo === 'presidente') ? 'è nello spazio firme del Presidente' : 'è nello spazio firme di chi deve firmare'}: nessuna mail adesso, il riepilogo lo mandi tu dal cruscotto («✉️ Avvisa»)`);
  if (fallite.length) pezzi.push(`la mail non è partita: ${fallite[0].errore || 'motivo sconosciuto'} (riprova da «Ricorda» nel cruscotto)`);
  if (!pezzi.length) pezzi.push('nessun avviso');
  return [`${cosa} in firma: ${pezzi.join('; ')}.`, fallite.length ? 'err' : 'ok'];
}

/* l'errore di una edge function porta il messaggio vero nel corpo */
async function testoErrore(error) {
  try { const j = await error?.context?.json?.(); if (j?.error) return j.error; } catch { /* niente */ }
  return error?.message || 'richiesta non riuscita';
}

/* L'ultima richiesta di firma per ogni riferimento: Map rif → riassunto
   della catena. Lancia se non riesce a leggere: chi chiama deve dirlo. */
export async function firmeDi(tipo, rifs) {
  const mappa = new Map();
  if (!rifs.length) return mappa;
  const { data, error } = await sb.from('s_firme').select('*')
    .eq('tipo', tipo).in('rif', rifs).order('richiesta_il', { ascending: false });
  if (error) throw new Error('Non sono riuscito a leggere le firme: ' + error.message);
  /* per ogni rif vale la catena più recente: le righe della stessa
     richiesta hanno lo stesso richiesta_da e nascono insieme */
  const perRif = new Map();
  for (const r of data || []) {
    if (!perRif.has(r.rif)) perRif.set(r.rif, []);
    perRif.get(r.rif).push(r);
  }
  for (const [rif, righe] of perRif) {
    const vive = righe.filter((r) => ['in_coda', 'in_attesa', 'firmata'].includes(r.stato));
    const scelte = vive.length ? vive : righe.filter((r) => r.stato === righe[0].stato && Math.abs(new Date(r.richiesta_il) - new Date(righe[0].richiesta_il)) < 60000);
    mappa.set(rif, riassuntoCatena(scelte.length ? scelte : [righe[0]]));
  }
  return mappa;
}

/* I byte della versione firmata (quella dell'ultima firma della catena) */
export async function scaricaFirmata(r) {
  if (!r?.file_firmato) throw new Error('Il documento non è ancora firmato da tutti.');
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

/* La scansione di una firma a mano al posto della firma nell'app: carica
   il PDF in autografe/ e lo registra sulla riga in attesa. */
export async function registraAutografa(riga, byte, dataFirma) {
  const percorso = `autografe/${riga.tipo}/${String(riga.rif).replace(/[^\w-]+/g, '_')}_${riga.id}_${Date.now()}.pdf`;
  const { error } = await sb.storage.from(BUCKET)
    .upload(percorso, new Blob([byte], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false });
  if (error) throw new Error('Non riesco a conservare la scansione: ' + error.message);
  const { data, error: e2 } = await sb.functions.invoke('firma-documenti', { body: { azione: 'autografa', id: riga.id, file: percorso, data: dataFirma } });
  if (e2 || data?.error) throw new Error(data?.error || await testoErrore(e2));
  return data;
}

const chi = (r) => {
  const ruolo = RUOLI_FIRMA[r.firmatario_ruolo] || r.firmatario_ruolo || 'Presidente';
  return r.firmatario_ruolo === 'docente' || r.firmatario_ruolo === 'rpf' ? `${ruolo} ${r.firmatario_email || ''}`.trim() : ruolo;
};

/* Una piccola etichetta dello stato, per le tabelle che elencano i documenti */
export function etichettaFirma(r) {
  if (!r) return '';
  if (r.stato === 'firmata') return `<span class="dt-cella dt-ok" style="padding:1px 6px" title="Firmata nell'app il ${dataIt(r.firmata_il)}${r.totale > 1 ? ` (${r.totale} firme)` : ''}">✅ firmata</span>`;
  if (r.stato === 'in_attesa') {
    const ko = String(r.avviso_esito || '').startsWith('non inviato');
    const da = r.prossimo ? (RUOLI_FIRMA[r.prossimo.ruolo] || r.prossimo.ruolo) : 'Presidente';
    const conta = r.totale > 1 ? ` ${r.firmate}/${r.totale}` : '';
    return `<span class="dt-cella dt-scaduto" style="padding:1px 6px" title="${esc(r.avviso_esito || '')}">✍ da ${esc(da)}${conta}${ko ? ' ⚠' : ''}</span>`;
  }
  if (r.stato === 'rimandata') return `<span class="dt-cella dt-scaduto" style="padding:1px 6px" title="${esc(r.rimandata_motivo || '')}">↩ rimandata</span>`;
  return '';
}

/* ── la tessera del cruscotto ───────────────────────────────── */

export async function datiCruscotto() {
  const { data, error } = await sb.from('s_firme')
    .select('id, tipo, rif, titolo, stato, ordine, firmatario_email, firmatario_ruolo, corso_id, richiesta_il, avviso_il, avviso_esito, firmata_il, rimandata_il, rimandata_motivo, autografo_il, usata_il, file_originale, file_firmato')
    .order('richiesta_il', { ascending: false }).limit(400);
  if (error) return { errore: error.message, inAttesa: [], rimandate: [], daUsare: [], senzaAutografo: [], riepiloghi: [] };
  /* i ruoli «a raccolta» (14/10/2026): non si avvisano a ogni richiesta */
  const { data: cfg } = await sb.from('s_config').select('valore').eq('chiave', 'firme_avviso_raccolto_ruoli').maybeSingle();
  const raccolti = new Set(String(cfg ? cfg.valore ?? '' : 'presidente').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean));
  /* una catena per documento: le righe vive, altrimenti l'ultima richiesta */
  const perDoc = new Map();
  for (const r of data || []) { const k = `${r.tipo}|${r.rif}`; if (!perDoc.has(k)) perDoc.set(k, []); perDoc.get(k).push(r); }
  const tutte = [];
  for (const righe of perDoc.values()) {
    const vive = righe.filter((r) => ['in_coda', 'in_attesa', 'firmata'].includes(r.stato));
    tutte.push(riassuntoCatena(vive.length ? vive : righe.filter((r) => r.stato === righe[0].stato)));
  }
  const inAttesa = tutte.filter((r) => r.stato === 'in_attesa');
  /* per ogni firmatario a raccolta: quanti documenti aspettano e quanti
     non gli sono ancora stati segnalati (nessun avviso dopo la richiesta) */
  const perChi = new Map();
  for (const r of inAttesa) {
    if (!r.prossimo || !raccolti.has(String(r.prossimo.ruolo))) continue;
    const k = String(r.prossimo.email || '').toLowerCase();
    if (!perChi.has(k)) perChi.set(k, { email: k, ruolo: r.prossimo.ruolo, n: 0, nuovi: 0, ultimo: null });
    const g = perChi.get(k);
    g.n += 1;
    if (daSegnalare(r)) g.nuovi += 1;
    if (r.avviso_il && (!g.ultimo || r.avviso_il > g.ultimo)) g.ultimo = r.avviso_il;
  }
  return {
    errore: null, raccolti: [...raccolti], riepiloghi: [...perChi.values()],
    inAttesa,
    rimandate: tutte.filter((r) => r.stato === 'rimandata'),
    daUsare: tutte.filter((r) => r.stato === 'firmata' && !r.usata_il),
    /* l'originale a mano è un'opzione del solo Presidente (le lettere di incarico) */
    senzaAutografo: tutte.filter((r) => r.stato === 'firmata' && !r.autografo_il && ['incarico_assev', 'incarico_docenza'].includes(r.tipo)),
  };
}

/* la riga in attesa non è ancora stata segnalata a chi deve firmarla */
export const daSegnalare = (r) => !r.avviso_il || new Date(r.avviso_il) < new Date(r.richiesta_il);
const nomeRuolo = (ruolo) => ruolo === 'presidente' ? 'il Presidente' : ruolo === 'direttore' ? 'il Direttore' : (RUOLI_FIRMA[ruolo] || ruolo);
const giorni = (iso) => iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null;
const dove = (r) => r.tipo === 'incarico_docenza' ? 'dalla scheda del corso'
  : r.tipo === 'incarico_assev' ? 'dall\'app asseverazione, «Iter d\'ufficio»'
  : r.corso_id ? `dalla scheda del corso n° ${r.corso_id}` : 'da dove è stato chiesto';

export function cardFirme(card, f) {
  if (f.errore) return card('✍️ Firme in attesa', 0, '', '', { k: 'firme', nonLetto: true });
  const n = f.inAttesa.length + f.rimandate.length + f.daUsare.length;
  const riga = (r, testo, azioni) => `
    <div class="hm-riga" style="cursor:default">
      <span>${r.stato === 'firmata' ? '✅' : r.stato === 'rimandata' ? '↩' : '✍'}</span>
      <span><strong>${esc(r.titolo)}</strong><br><span class="hint">${testo}</span></span>
      <span style="white-space:nowrap">${azioni}</span>
    </div>`;
  const apri = (p, t = 'apri') => p ? `<a href="#" data-fp-apri="${esc(p)}">${t}</a>` : '';
  const attesaDi = (r) => r.prossimo ? `in firma ${r.prossimo.ruolo === 'presidente' ? 'dal Presidente' : r.prossimo.ruolo === 'direttore' ? 'dal Direttore' : `da ${esc(chi({ firmatario_ruolo: r.prossimo.ruolo, firmatario_email: r.prossimo.email }))}`}` : 'in firma';
  const corpo = [
    ...f.inAttesa.map((r) => riga(r,
      `${attesaDi(r)}${r.totale > 1 ? ` (${r.firmate} di ${r.totale} firme)` : ''} dal ${dataIt(r.richiesta_il)}${giorni(r.richiesta_il) ? ` (${giorni(r.richiesta_il)} g)` : ''}`
        + (r.prossimo && (f.raccolti || []).includes(String(r.prossimo.ruolo))
          ? (daSegnalare(r) ? ' · <span style="color:#8a5a00">✉ non ancora segnalato: parte col riepilogo</span>' : ` · segnalato il ${dataIt(r.avviso_il)}`)
          : (String(r.avviso_esito || '').startsWith('non inviato') ? ' · <span style="color:#a01f00">⚠ la mail di avviso non è partita</span>' : '')),
      `${apri(r.file_originale)} · <a href="#" data-fp-autografa="${r.id}" title="Ha firmato su carta: carica la scansione">📎 a mano</a> · <a href="#" data-fp-ritira="${r.id}">ritira</a>`)),
    ...f.rimandate.map((r) => riga(r,
      `rimandata il ${dataIt(r.rimandata_il)} da ${esc(chi(r))}: «${esc(r.rimandata_motivo || '')}» — si rifà ${dove(r)}`,
      apri(r.file_originale))),
    ...f.daUsare.map((r) => riga(r,
      `firmata il ${dataIt(r.firmata_il)}${r.totale > 1 ? ` (${r.totale} firme)` : ''} — mail e dossier ${dove(r)}`,
      apri(r.file_firmato, 'apri firmata'))),
  ].join('');
  const azione = `
    ${(f.riepiloghi || []).map((g) => `<button class="btn btn-sm${g.nuovi ? ' btn-primary' : ''}" type="button" data-fp-riepilogo="${esc(g.email)}" data-fp-ruolo="${esc(g.ruolo)}" data-fp-n="${g.n}" data-fp-nuovi="${g.nuovi}">✉️ Avvisa ${esc(nomeRuolo(g.ruolo))} (${g.n === 1 ? '1 documento' : `${g.n} documenti`}${g.nuovi && g.nuovi < g.n ? `, ${g.nuovi} nuovi` : ''})</button>
      <span class="hint">${g.nuovi ? `${g.nuovi === g.n ? 'nessuno ancora segnalato' : `${g.nuovi} non ancora segnalati`}` : 'tutti già segnalati'}${g.ultimo ? ` · ultimo avviso ${dataIt(g.ultimo)}` : ''}</span><br>`).join('')}
    ${f.inAttesa.some((r) => r.prossimo && !(f.raccolti || []).includes(String(r.prossimo.ruolo))) ? '<button class="btn btn-sm" type="button" id="hm-fp-ricorda">🔔 Ricorda agli altri firmatari</button>' : ''}
    ${f.senzaAutografo.length ? `<details style="margin-top:8px"><summary class="hint">Originali firmati a mano dal Presidente (facoltativi): ${f.senzaAutografo.length} da segnare</summary>
      ${f.senzaAutografo.map((r) => `<div class="hm-riga" style="cursor:default"><span>📝</span><span>${esc(r.titolo)}</span>
        <span><a href="#" data-fp-autografo="${r.id}">segna l'originale</a></span></div>`).join('')}</details>` : ''}`;
  return card('✍️ Firme in attesa', n, corpo || '<p class="hint">Niente da firmare né da spedire.</p>', azione,
    { k: 'firme', sempre: f.senzaAutografo.length > 0 });
}

const leggiData = (testo) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(testo || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

export function collegaFirme(host, ricarica, firmeDati = null) {
  host.querySelectorAll('[data-fp-apri]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault(); apriPdf(a.dataset.fpApri);
  }));
  host.querySelectorAll('[data-fp-ritira]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    if (!confirm('Ritiro la richiesta di firma? Il documento sparisce dall\'elenco di chi doveva firmarlo (per esempio perché va rifatto). Se aveva più firme, si ritirano tutte.')) return;
    const { data, error } = await sb.functions.invoke('firma-documenti', { body: { azione: 'ritira', id: Number(a.dataset.fpRitira) } });
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    toast('Richiesta ritirata.', 'ok'); ricarica();
  }));
  /* (14/10/2026) il riepilogo per un firmatario a raccolta: UNA mail con
     l'elenco di tutto quello che aspetta la sua firma */
  host.querySelectorAll('[data-fp-riepilogo]').forEach((b) => b.addEventListener('click', async () => {
    const n = Number(b.dataset.fpN), nuovi = Number(b.dataset.fpNuovi), chiE = nomeRuolo(b.dataset.fpRuolo);
    if (!confirm(`Mando a ${chiE} UNA mail con l'elenco ${n === 1 ? 'del documento che aspetta' : `dei ${n} documenti che aspettano`} la sua firma nell'app${nuovi && nuovi < n ? ` (${nuovi} nuovi dall'ultimo avviso, segnati nell'elenco)` : ''}?\n\nSe ha attivato le notifiche, gli arriva anche quella.`)) return;
    b.disabled = true;
    const { data, error } = await sb.functions.invoke('firma-documenti', { body: { azione: 'avvisa', email: b.dataset.fpRiepilogo } });
    b.disabled = false;
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    const av = data?.avvisi?.[0] || data?.avviso;
    if (!av?.inviata) return toast('Mail non partita: ' + (av?.errore || 'motivo sconosciuto'), 'err');
    toast(`Mail mandata a ${chiE} con ${av.documenti === 1 ? '1 documento' : `${av.documenti} documenti`} da firmare.`, 'ok');
    ricarica();
  }));
  host.querySelector('#hm-fp-ricorda')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (!confirm('Rimando la mail a chi ha documenti in attesa della sua firma?\n\nIl Presidente no: a lui va il riepilogo col suo pulsante.')) return;
    b.disabled = true;
    const { data, error } = await sb.functions.invoke('firma-documenti', { body: { azione: 'avvisa' } });
    b.disabled = false;
    if (error || data?.error) return toast('Non riuscito: ' + (data?.error || await testoErrore(error)), 'err');
    const inviate = (data?.avvisi || []).filter((x) => x.inviata);
    const fallite = (data?.avvisi || []).filter((x) => !x.inviata);
    if (!inviate.length) return toast('Nessuna mail partita: ' + (fallite[0]?.errore || 'motivo sconosciuto'), 'err');
    toast(`Mail mandata a ${inviate.map((x) => x.a).join(', ')}${fallite.length ? `; non partita per ${fallite.map((x) => x.a).join(', ')}` : ''}.`, fallite.length ? 'err' : 'ok');
    ricarica();
  });
  host.querySelectorAll('[data-fp-autografo]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const oggi = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    const d = prompt('Data in cui il Presidente ha firmato a mano l\'originale (gg/mm/aaaa):', oggi);
    if (!d) return;
    const iso = leggiData(d);
    if (!iso) return toast('Scrivi la data come gg/mm/aaaa.', 'err');
    const { error } = await sb.rpc('s_firma_autografo', { p_id: Number(a.dataset.fpAutografo), p_data: iso });
    if (error) return toast('Non registrato: ' + error.message, 'err');
    toast('Originale segnato.', 'ok'); ricarica();
  }));
  /* firma SOLO su carta: la scansione prende il posto della firma nell'app */
  host.querySelectorAll('[data-fp-autografa]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const id = Number(a.dataset.fpAutografa);
    const riga = (firmeDati?.inAttesa || []).map((r) => r.catena?.find((x) => x.id === id) || (r.id === id ? r : null)).find(Boolean);
    if (!riga) return toast('Non trovo la richiesta: ricarica la pagina.', 'err');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf';
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      const oggi = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
      const d = prompt(`Scansione di «${riga.titolo}» firmata a mano da ${chi(riga)}.\nData della firma (gg/mm/aaaa):`, oggi);
      if (!d) return;
      const iso = leggiData(d);
      if (!iso) return toast('Scrivi la data come gg/mm/aaaa.', 'err');
      try {
        const byte = new Uint8Array(await file.arrayBuffer());
        const out = await registraAutografa(riga, byte, iso);
        toast(out?.seguente ? 'Scansione registrata: il documento passa alla firma seguente.' : 'Scansione registrata come firma.', 'ok');
        ricarica();
      } catch (e) { toast('Non registrata: ' + e.message, 'err'); }
    });
    input.click();
  }));
}
