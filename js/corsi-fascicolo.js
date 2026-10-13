/* ══════════════════════════════════════════════════════════════════════════
   IL FASCICOLO DEL CORSO SU DRIVE                                (14/10/2026)
   Lotto 6 del fascicolo corso digitale (Accordo CSR 59/2025, conservazione
   10 anni).

   Lo stato dei pezzi NON si memorizza: lo calcola `corso_fascicolo` dal
   database (scheda firmata? progetto firmato? registro di ogni giornata?
   verbale? attestati?), come una vista Bases del vault — una lista di
   controllo calcolata non resta indietro. Qui la segreteria:
     · DEPOSITA i documenti firmati nella cartella del corso su Drive
       (2_AREE/Formazione/edizioni_corsi/<data>_Corso-<id>_<titolo>, creata
       al primo deposito, idempotente); ogni deposito resta scritto in
       s_corsi_fascicolo_file, quindi si rifà solo ciò che manca o che ha
       una firma nuova;
     · CHIUDE il fascicolo quando è completo: nasce la nota `_indice.md`
       della cartella (frontmatter e campi della regola «nota di riepilogo
       per eventi con formazione» del CLAUDE.md) e il corso passa a chiuso.
   I PDF firmati stanno nel bucket delle firme: si scaricano da lì (la
   segreteria li legge) e si caricano su Drive con la funzione
   allegati-protocollo (drive.js), senza codice di protocollo nel nome.
   ══════════════════════════════════════════════════════════════════════════ */
import { sb, $, esc, dataIt, oggiIso, toast, attendi } from './core.js';
import { risolviCartella, creaCartella, caricaByte } from './drive.js';

const BUCKET = 'firme-presidente';
const BASE = '2_AREE/Formazione/edizioni_corsi';

export const slug = (s, max = 40) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '') || 'corso';
export const nomeCartella = (c) => `${(c.data_inizio || oggiIso()).replace(/-/g, '_')}_Corso-${c.id}_${slug(c.titolo)}`;

export async function datiFascicolo(c) {
  const { data, error } = await sb.rpc('corso_fascicolo', { p_corso: c.id });
  /* un errore di lettura si dice: una lista vuota non è «niente da fare» */
  return { f: data || null, errore: error?.message || null };
}

/* i pezzi firmati da depositare, nell'ordine del fascicolo */
export function pezziDaDepositare(c, f) {
  if (!f) return [];
  const out = [];
  const ok = (x) => x && typeof x === 'object' && x.file;
  if (f.scheda && ok(f.scheda.firmato)) out.push({ pezzo: 'scheda', rif: `scheda:${f.scheda.id}`, firma: f.scheda.firmato, titolo: `Scheda formativa v${f.scheda.versione}` });
  if (f.progetto && ok(f.progetto.firmato)) out.push({ pezzo: 'progetto', rif: `progetto:${c.id}`, firma: f.progetto.firmato, titolo: 'Progetto formativo (Allegato 3)' });
  for (const g of f.giornate || []) if (ok(g.registro)) out.push({ pezzo: 'registro_giornata', rif: `giornata:${g.id}`, firma: g.registro, titolo: `Registro della giornata del ${dataIt(g.data)}` });
  if (f.verbale && ok(f.verbale.firmato)) out.push({ pezzo: 'verbale', rif: `verbale:${f.verbale.id}`, firma: f.verbale.firmato, titolo: `Verbale di verifica v${f.verbale.versione}` });
  for (const k of f.incarichi || []) if (ok(k.accettazione)) out.push({ pezzo: 'accettazione', rif: `incarico:${k.id}`, firma: k.accettazione, titolo: `Accettazione dell'incarico — ${k.nominativo}` });
  const dep = f.depositati || [];
  return out.map((p) => ({ ...p, depositato: dep.find((d) => d.pezzo === p.pezzo && d.rif === p.rif) || null }))
    .map((p) => ({ ...p, daFare: !p.depositato || (p.firma.firma_id && p.depositato.firma_id !== p.firma.firma_id) }));
}

export function sezioneFascicoloDrive(c, d) {
  if (d.errore) return `<p class="hint" style="color:#a01f00;margin:8px 0 0">Non sono riuscito a leggere lo stato del fascicolo: ${esc(d.errore)}</p>`;
  const f = d.f;
  if (!f) return '';
  const pezzi = pezziDaDepositare(c, f);
  const daFare = pezzi.filter((p) => p.daFare);
  const spunta = (okk, testo, dettaglio) => `<div class="dt-doc-riga" style="display:flex;gap:8px;align-items:center"><span>${okk === true ? '✅' : okk === 'parz' ? '⏳' : '—'}</span><span style="flex:1"><strong>${testo}</strong>${dettaglio ? `<br><span class="hint">${dettaglio}</span>` : ''}</span></div>`;
  const firmatoTxt = (x) => (x && x.file ? `firmato il ${dataIt(x.firmata_il)}` : '');
  const registri = (f.giornate || []).map((g) => spunta(g.registro && g.registro.file ? true : g.in_firma ? 'parz' : (g.presenze > 0 ? 'parz' : false),
    `Registro del ${dataIt(g.data)}`, g.registro && g.registro.file ? firmatoTxt(g.registro) + (g.firme_qr ? ` · ${g.firme_qr} firme dal QR confermate` : '') : g.in_firma ? 'in firma al docente' : g.presenze ? `${g.presenze} presenze segnate, registro non firmato nell'app (vale quello di carta)` : 'nessuna presenza e nessuna firma')).join('');
  const dep = f.depositati || [];
  const indice = dep.find((x) => x.pezzo === 'indice');
  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📂 Fascicolo su Drive <span class="hint" style="font-weight:400">— ${f.accordo ? 'corso dell\'Accordo: fascicolo pieno' : 'fuori Accordo: bastano i registri'}${f.chiuso_il ? ` · <strong>chiuso il ${dataIt(f.chiuso_il)}</strong>` : ''}</span></h4>
    ${f.accordo ? spunta(f.scheda && f.scheda.firmato && f.scheda.firmato.file ? true : f.scheda ? 'parz' : false, 'Scheda formativa della tipologia', f.scheda ? (firmatoTxt(f.scheda.firmato) || `v${f.scheda.versione} ${f.scheda.stato}`) : 'nessuna versione congelata') : ''}
    ${f.accordo ? spunta(f.progetto.firmato && f.progetto.firmato.file ? true : f.progetto.stato !== 'da_fare' ? 'parz' : false, 'Progetto formativo dell\'edizione', firmatoTxt(f.progetto.firmato) || f.progetto.stato) : ''}
    ${registri || spunta(false, 'Registri delle giornate', 'nessuna giornata')}
    ${f.accordo ? spunta(f.verbale && f.verbale.firmato && f.verbale.firmato.file ? true : f.verbale ? 'parz' : false, 'Verbale di verifica finale', f.verbale ? (firmatoTxt(f.verbale.firmato) || `v${f.verbale.versione} ${f.verbale.stato}`) : 'non preparato') : ''}
    ${f.attestati.previsti ? spunta(f.attestati.emessi > 0, 'Attestati', `${f.attestati.emessi} emessi su ${f.iscritti.ammessi} ammessi — stanno in attestati_emessi/<anno>`) : ''}
    ${(f.incarichi || []).length ? spunta((f.incarichi || []).every((k) => k.accettato_il), 'Incarichi di docenza', (f.incarichi || []).map((k) => `${esc(k.nominativo)}: ${k.lettera && k.lettera.file ? 'lettera firmata' : 'lettera non firmata'}${k.accettato_il ? ', accettato' : ''}`).join(' · ')) : ''}
    ${f.test.codice || f.questionario.codice ? spunta('parz', 'Prove e gradimento', `${f.test.codice ? `test: ${f.test.prove} prove, ${f.test.convalidate} convalidate` : ''}${f.test.codice && f.questionario.codice ? ' · ' : ''}${f.questionario.codice ? `questionario: ${f.questionario.risposte} risposte` : ''} — restano nel database`) : ''}
    ${(f.mancanti || []).length ? `<p class="hint" style="margin:6px 0 0;color:#a01f00">Per chiudere manca: ${f.mancanti.map(esc).join(', ')}.</p>` : '<p class="hint" style="margin:6px 0 0;color:#2d7d1f">✓ Fascicolo completo.</p>'}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px">
      ${f.cartella.drive_url ? `<a href="${esc(f.cartella.drive_url)}" target="_blank" rel="noopener">📁 cartella su Drive</a> <span class="hint">(${dep.filter((x) => x.pezzo !== 'indice').length} depositati${indice ? ', con _indice.md' : ''})</span>` : `<span class="hint">cartella non ancora creata: <code>${esc(BASE)}/${esc(nomeCartella(c))}</code></span>`}
      ${!f.chiuso_il ? `<button class="btn btn-ghost btn-sm" id="fs-dep" ${daFare.length || !f.cartella.drive_id ? '' : 'disabled'}>📁 Deposita su Drive${daFare.length ? ` (${daFare.length})` : ''}</button>` : ''}
      ${!f.chiuso_il && f.completo ? '<button class="btn btn-primary btn-sm" id="fs-chiudi">🔒 Chiudi il fascicolo</button>' : ''}
      ${f.chiuso_il ? '<button class="btn btn-ghost btn-sm" id="fs-riapri">↩ Riapri il fascicolo</button>' : ''}
    </div>`;
}

async function cartellaDelCorso(c, f) {
  if (f.cartella.drive_id) return f.cartella.drive_id;
  const base = await risolviCartella(BASE);
  if (!base.id || base.mancante) throw new Error(`Su Drive non trovo ${BASE}${base.mancante ? ` (manca «${base.mancante}»)` : ''}: creala e riprova.`);
  const k = await creaCartella(base.id, nomeCartella(c));
  const url = `https://drive.google.com/drive/folders/${k.id}`;
  const { error } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { cartella_id: k.id, cartella_url: url } });
  if (error) throw new Error('cartella creata ma non registrata: ' + error.message);
  return k.id;
}

async function scaricaFirmato(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`non riesco a leggere ${path}: ${error?.message || ''}`);
  return new Uint8Array(await data.arrayBuffer());
}

/* deposita i firmati che mancano (o che hanno una firma nuova) */
export async function deposita(c, f, avanza) {
  const cartella = await cartellaDelCorso(c, f);
  const pezzi = pezziDaDepositare(c, f).filter((p) => p.daFare);
  let n = 0;
  for (const p of pezzi) {
    if (avanza) avanza(`${n + 1}/${pezzi.length} ${p.titolo}`);
    const byte = await scaricaFirmato(p.firma.file);
    const nome = p.firma.nome_file ? p.firma.nome_file.replace(/\.pdf$/i, '') + '_firmato.pdf' : `${p.pezzo}_${p.rif.replace(':', '-')}_firmato.pdf`;
    const up = await caricaByte(null, nome, byte, 'application/pdf', cartella);
    const { error } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { pezzo: p.pezzo, rif: p.rif, firma_id: p.firma.firma_id, nome: up.file_name || nome, drive_id: up.drive_file_id, drive_url: up.drive_url } });
    if (error) throw new Error(`${p.titolo} caricato ma non registrato: ${error.message}`);
    n += 1;
  }
  return { cartella, depositati: n };
}

/* la nota della cartella: la regola «nota di riepilogo per eventi con formazione» del CLAUDE.md */
export function indiceMd(c, f, ctx) {
  const giornate = ctx.giornate || [], interventi = ctx.interventi || [], iscritti = (ctx.iscritti || []).filter((i) => !['annullato', 'sostituito'].includes(i.esito || ''));
  const docenti = [...new Set(interventi.filter((x) => ['docente', 'codocente', 'relatore'].includes(x.qualita || 'docente')).map((x) => x.nominativo).filter(Boolean))];
  const presenti = iscritti.filter((i) => ['presente', 'presente_online'].includes(i.esito));
  const imprese = [...new Set(iscritti.map((i) => i.impresa_txt).filter(Boolean))];
  const argomenti = [...new Set(interventi.map((x) => [x.materia, x.argomenti].filter(Boolean).join(': ')).filter(Boolean))];
  const periodo = c.data_fine && c.data_fine !== c.data_inizio ? `${c.data_inizio} → ${c.data_fine}` : (c.data_inizio || 'non documentato');
  const attestati = iscritti.filter((i) => i.attestato_numero && !i.attestato_revocato_il);
  const anno = (c.data_fine || c.data_inizio || oggiIso()).slice(0, 4);
  const q = (s) => JSON.stringify(String(s ?? ''));
  const lista = (a) => (a.length ? a.map((x) => `  - ${q(x)}`).join('\n') : '  []');
  return [
    '---',
    `titolo: ${q(c.titolo)}`,
    'tipo: evento',
    `data: ${c.data_inizio || oggiIso()}`,
    'area: Formazione',
    `stato: ${f.chiuso_il ? 'concluso' : 'attivo'}`,
    'fonte: app segreteria (fascicolo corso digitale)',
    `corso_id: ${c.id}`,
    `codice_socrate: ${q(c.codice_socrate || '')}`,
    `tipologia: ${q(f.tipologia ? f.tipologia.titolo : '')}`,
    `accordo_2025: ${f.accordo ? 'true' : 'false'}`,
    `argomenti:\n${lista(argomenti.length ? argomenti : ['da confermare'])}`,
    `data_svolgimento: ${q(periodo)}`,
    `docenti:\n${lista(docenti.length ? docenti : ['da confermare'])}`,
    `partecipanti_effettivi: ${presenti.length}`,
    `enti_partecipanti:\n${lista(imprese)}`,
    `crediti: ${q(c.validita_txt || 'non documentato')}`,
    `attestati_rilasciati: ${attestati.length}`,
    `attestati_collegati: ${q(`2_AREE/Formazione/attestati_emessi/${anno}`)}`,
    'tags:',
    '  - evento/corso',
    '  - formazione',
    '---',
    '',
    `# ${c.titolo}`,
    '',
    `Corso n. ${c.id}${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''}${f.tipologia ? ` · tipologia «${f.tipologia.titolo}»` : ''} · ${f.accordo ? 'corso dell\'Accordo Stato-Regioni 17/04/2025 (fascicolo pieno)' : 'fuori Accordo (solo registri)'}.`,
    `Periodo: ${periodo} · sede: ${c.sede || 'non documentata'} · durata: ${c.durata_ore ? c.durata_ore + ' ore' : 'non documentata'}.`,
    '',
    '## Il fascicolo',
    ...(f.depositati || []).filter((d) => d.pezzo !== 'indice').map((d) => `- ${d.nome} — ${d.drive_url ? `[apri](${d.drive_url})` : d.drive_id} (depositato il ${dataIt(d.depositato_il)})`),
    ...(f.attestati.previsti ? [`- Attestati: ${attestati.length} emessi (${attestati.map((i) => i.attestato_numero).join(', ') || 'nessuno'}), in attestati_emessi/${anno}.`] : []),
    `- Prove del test: ${f.test.prove} (${f.test.convalidate} convalidate) · questionario di gradimento: ${f.questionario.risposte} risposte — nel database dell'app.`,
    '',
    '## Partecipanti effettivi',
    ...(presenti.length ? presenti.map((i) => `- ${i.nominativo}${i.impresa_txt ? ` (${i.impresa_txt})` : ''}${i.mansione ? ` — ${i.mansione}` : ''}`) : ['- non documentati']),
    '',
    '## Docenti',
    ...(docenti.length ? docenti.map((d) => `- ${d}`) : ['- da confermare']),
    '',
    `Nota generata dall'app segreteria il ${dataIt(oggiIso())}${f.chiuso_il ? ` alla chiusura del fascicolo (${dataIt(f.chiuso_il)})` : ''}. I codici fiscali restano nei documenti del fascicolo e nel database.`,
    '',
  ].join('\n');
}

export function collegaFascicoloDrive(c, d, ricarica, ctx) {
  const body = $('#drawer-body');
  if (!body || !d.f) return;
  const f = d.f;
  body.querySelector('#fs-dep')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Deposito…');
    try {
      const r = await deposita(c, f, (t) => { btn.textContent = `Deposito… ${t}`; });
      toast(r.depositati ? `${r.depositati} documenti depositati nella cartella del corso.` : 'Cartella pronta: niente di nuovo da depositare.', 'ok');
    } catch (e) { toast('Deposito fermato: ' + e.message, 'err'); }
    attendi(btn, false);
    ricarica();
  });
  body.querySelector('#fs-chiudi')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!confirm('Chiudo il fascicolo del corso? Deposito i firmati che mancano, scrivo la nota _indice.md nella cartella e il corso passa a «chiuso». Si può riaprire.')) return;
    attendi(btn, true, 'Chiudo…');
    try {
      await deposita(c, f, (t) => { btn.textContent = `Deposito… ${t}`; });
      const { data: f2, error: e2 } = await sb.rpc('corso_fascicolo', { p_corso: c.id });
      if (e2) throw new Error(e2.message);
      if (!(f2.depositati || []).some((x) => x.pezzo === 'indice')) {
        const md = indiceMd(c, { ...f2, chiuso_il: new Date().toISOString() }, ctx);
        const up = await caricaByte(null, '_indice.md', new TextEncoder().encode(md), 'text/markdown', f2.cartella.drive_id);
        const { error } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { pezzo: 'indice', rif: '', nome: up.file_name || '_indice.md', drive_id: up.drive_file_id, drive_url: up.drive_url } });
        if (error) throw new Error('_indice.md caricato ma non registrato: ' + error.message);
      }
      const { error } = await sb.rpc('corso_fascicolo_chiudi', { p_corso: c.id });
      if (error) throw new Error(error.message);
      toast('Fascicolo chiuso e depositato su Drive.', 'ok');
    } catch (e) { toast('Non chiuso: ' + e.message, 'err'); }
    attendi(btn, false);
    ricarica();
  });
  body.querySelector('#fs-riapri')?.addEventListener('click', async () => {
    const { error } = await sb.rpc('corso_fascicolo_chiudi', { p_corso: c.id, p_riapri: true });
    if (error) return toast(error.message, 'err');
    toast('Fascicolo riaperto.', 'ok');
    ricarica();
  });
}
