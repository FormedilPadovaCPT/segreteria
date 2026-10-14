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

   (14/10/2026, dalla verifica di legge) Alla chiusura si aggiungono due pezzi
   GENERATI dal database, non firmati: l'ELENCO DEI DOCENTI CON LE FIRME (FAQ
   del Ministero n. 43) e la TRACCIA DELLE FIRME DI PRESENZA dal QR. E nasce il
   PACCHETTO DEL CORSO: un file .zip con tutto — documenti firmati, elenco,
   traccia, attestati, dati in JSON e CSV, la nota, un LEGGIMI e il manifesto
   con l'impronta SHA-256 di ogni file — da tenere su Drive e da copiare sul
   server della scuola. L'impronta del pacchetto resta sul corso nel database.
   ══════════════════════════════════════════════════════════════════════════ */
import { sb, $, esc, dataIt, oggiIso, toast, attendi } from './core.js';
import { risolviCartella, creaCartella, caricaByte, leggiByte, cestina } from './drive.js';
import { pdfDocumento } from './corsi-tipologie.js';
import { creaZip, sha256 } from './zip.js';
import { suffissoNumeroFile } from './attestati-verifica.js';

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
      <button class="btn btn-ghost btn-sm" id="fs-pacchetto">📦 Scarica il pacchetto</button>
      ${f.chiuso_il ? '<button class="btn btn-ghost btn-sm" id="fs-riapri">↩ Riapri il fascicolo</button>' : ''}
    </div>
    ${f.pacchetto && f.pacchetto.sha256 ? `<p class="hint" style="margin:6px 0 0">📦 Pacchetto depositato il ${dataIt(f.pacchetto.il)} · impronta <code>${esc(String(f.pacchetto.sha256).slice(0, 16))}…</code> — la copia sul server della scuola deve avere la stessa.</p>` : ''}`;
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

/* i due pezzi GENERATI (non firmati): rifatti alla chiusura; il file vecchio
   su Drive va nel cestino, così nella cartella ne resta uno solo */
const GENERATI = [
  { azione: 'elenco_docenti', pezzo: 'elenco_docenti', titolo: 'Elenco dei docenti con le firme' },
  { azione: 'traccia_presenze', pezzo: 'traccia_presenze', titolo: 'Traccia delle firme di presenza' },
];
export async function depositaGenerati(c, f, avanza) {
  const cartella = await cartellaDelCorso(c, f);
  const out = [];
  for (const g of GENERATI) {
    if (avanza) avanza(g.titolo);
    const r = await pdfDocumento(g.azione, c.id);
    const up = await caricaByte(null, r.nome_file, r.byte, 'application/pdf', cartella);
    const prima = (f.depositati || []).find((d) => d.pezzo === g.pezzo);
    const { error } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { pezzo: g.pezzo, rif: '', nome: up.file_name || r.nome_file, drive_id: up.drive_file_id, drive_url: up.drive_url, sha256: await sha256(r.byte) } });
    if (error) throw new Error(`${g.titolo} caricato ma non registrato: ${error.message}`);
    if (prima && prima.drive_id && prima.drive_id !== up.drive_file_id) { try { await cestina(prima.drive_id); } catch { /* resta il vecchio: non è un errore del deposito */ } }
    out.push({ ...g, nome: r.nome_file, byte: r.byte });
  }
  return out;
}

/* la traccia in tabella, per chi apre il pacchetto con un foglio di calcolo */
export function tracciaCsv(righe) {
  const q = (v) => { const t = v == null ? '' : String(v); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const col = ['id', 'progressivo', 'giornata', 'nominativo', 'tipo', 'turno', 'ora_server', 'ora_dispositivo', 'fuori_orario', 'anno_corrisponde', 'stato', 'confermata_da', 'confermata_il', 'note', 'riferimento_esito', 'submission_id'];
  return [col.join(';'), ...(righe || []).map((r) => col.map((k) => q(r[k])).join(';'))].join('\r\n') + '\r\n';
}

export function nomeAttestato(i) {
  const data = String(i.attestato_data || '').slice(0, 10) || 'data-non-indicata';
  return `${data}_Attestato_${slug(i.nominativo, 50)}_${String(i.cf || 'CF-non-indicato').toUpperCase()}${suffissoNumeroFile(i.attestato_numero)}.pdf`;
}

export function leggimi(c, info) {
  const periodo = c.data_fine && c.data_fine !== c.data_inizio ? `${dataIt(c.data_inizio)} - ${dataIt(c.data_fine)}` : dataIt(c.data_inizio);
  return [
    'PACCHETTO DEL FASCICOLO DEL CORSO',
    'Formedil Padova - Area Sicurezza e Salute',
    '',
    `Corso n. ${c.id} «${c.titolo}»${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''}`,
    `Periodo: ${periodo || 'non indicato'} - sede: ${c.sede || 'non indicata'}`,
    `Generato dall'app segreteria il ${info.quando}${info.chi ? ` da ${info.chi}` : ''}.`,
    '',
    'CHE COSA CONTIENE',
    '- documenti/  i documenti firmati nell\'app (scheda formativa, progetto formativo,',
    '              accettazioni degli incarichi, registri delle giornate, verbale),',
    '              l\'elenco dei docenti con le firme e la traccia delle firme di presenza.',
    '- attestati/  gli attestati emessi.',
    '- dati/dati-corso.json            tutti i dati del corso nel database: iscritti,',
    '                                  presenze, firme, prove del test, questionario.',
    '- dati/traccia-firme-presenza.csv la traccia delle firme dal QR, in tabella (separatore ;).',
    '- _indice.md                      la nota di riepilogo del corso.',
    '- MANIFESTO-sha256.txt            l\'impronta SHA-256 di ogni file del pacchetto.',
    '',
    'COME SI CONTROLLA CHE NIENTE SIA CAMBIATO',
    '- Linux o Mac, dentro la cartella estratta:  sha256sum -c MANIFESTO-sha256.txt',
    '- Windows PowerShell:  Get-FileHash -Algorithm SHA256 <file>  e confronto con la riga del manifesto.',
    '- L\'impronta del pacchetto intero sta nel database sul corso e nella nota _indice.md',
    '  della cartella del corso su Drive.',
    '',
    'CONSERVAZIONE',
    'Almeno 10 anni (Accordo Stato-Regioni 17/04/2025, parte I punto 7). Gli originali dei',
    'documenti firmati, con le loro impronte, restano anche nel registro delle firme dell\'app.',
    ...(info.mancanti && info.mancanti.length ? ['', 'NON ENTRATI NEL PACCHETTO (da aggiungere a mano)', ...info.mancanti.map((m) => `- ${m}`)] : []),
    '',
  ].join('\r\n');
}

/* tutto il fascicolo in un file: si costruisce nel browser, dai dati di adesso */
export async function costruisciPacchetto(c, f, ctx, avanza, generati = null) {
  const enc = new TextEncoder();
  const file = [];
  const mancanti = [];
  const metti = (nome, byte) => file.push({ nome, byte });
  /* 1. i documenti firmati, tutti (anche quelli già su Drive) */
  for (const p of pezziDaDepositare(c, f)) {
    if (avanza) avanza(p.titolo);
    try {
      const byte = await scaricaFirmato(p.firma.file);
      const nome = p.firma.nome_file ? p.firma.nome_file.replace(/\.pdf$/i, '') + '_firmato.pdf' : `${p.pezzo}_${p.rif.replace(':', '-')}_firmato.pdf`;
      metti(`documenti/${nome}`, byte);
    } catch (e) { mancanti.push(`${p.titolo}: ${e.message}`); }
  }
  /* 2. elenco dei docenti e traccia: quelli appena depositati, o generati ora */
  const gen = generati || [];
  if (!gen.length) {
    for (const g of GENERATI) {
      if (avanza) avanza(g.titolo);
      try { const r = await pdfDocumento(g.azione, c.id); gen.push({ ...g, nome: r.nome_file, byte: r.byte }); }
      catch (e) { mancanti.push(`${g.titolo}: ${e.message}`); }
    }
  }
  for (const g of gen) metti(`documenti/${g.nome}`, g.byte);
  /* 3. gli attestati emessi, letti da Drive */
  for (const i of (ctx.iscritti || []).filter((x) => x.attestato_numero && !x.attestato_revocato_il)) {
    if (!i.attestato_drive_id) { mancanti.push(`attestato ${i.attestato_numero} di ${i.nominativo}: non è su Drive`); continue; }
    if (avanza) avanza(`attestato ${i.attestato_numero}`);
    try { metti(`attestati/${nomeAttestato(i)}`, await leggiByte(i.attestato_drive_id)); }
    catch (e) { mancanti.push(`attestato ${i.attestato_numero} di ${i.nominativo}: ${e.message}`); }
  }
  /* 4. i dati */
  if (avanza) avanza('dati del corso');
  const { data: dati, error: eD } = await sb.rpc('corso_pacchetto_dati', { p_corso: c.id });
  if (eD) throw new Error('Non sono riuscito a leggere i dati del corso: ' + eD.message);
  metti('dati/dati-corso.json', enc.encode(JSON.stringify(dati, null, 2)));
  const { data: tr, error: eT } = await sb.rpc('corso_traccia_presenze', { p_corso: c.id });
  if (eT) throw new Error('Non sono riuscito a leggere la traccia delle firme: ' + eT.message);
  metti('dati/traccia-firme-presenza.csv', enc.encode('\uFEFF' + tracciaCsv(tr)));
  metti('_indice.md', enc.encode(indiceMd(c, f, ctx)));
  const { data: u } = await sb.auth.getUser();
  const quando = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  metti('00_LEGGIMI.txt', enc.encode(leggimi(c, { quando, chi: u?.user?.email || '', mancanti })));
  /* 5. il manifesto: l'impronta di ogni file, nel formato di sha256sum */
  const righe = [];
  for (const x of file) righe.push(`${await sha256(x.byte)}  ${x.nome}`);
  metti('MANIFESTO-sha256.txt', enc.encode(righe.join('\n') + '\n'));
  const zip = creaZip(file);
  const nome = `${(c.data_inizio || oggiIso()).replace(/-/g, '_')}_Corso-${c.id}_${slug(c.titolo)}_pacchetto-fascicolo.zip`;
  return { zip, nome, sha256: await sha256(zip), file: file.length, mancanti };
}

export function scaricaZip(byte, nome) {
  const url = URL.createObjectURL(new Blob([byte], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* la nota della cartella: la regola «nota di riepilogo per eventi con formazione» del CLAUDE.md */
export function indiceMd(c, f, ctx, extra = []) {
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
    ...extra,
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
    if (!confirm('Chiudo il fascicolo del corso? Deposito i firmati che mancano, l\'elenco dei docenti e la traccia delle firme, preparo il pacchetto (lo scarichi anche tu, per il server della scuola), scrivo la nota _indice.md e il corso passa a «chiuso». Si può riaprire.')) return;
    attendi(btn, true, 'Chiudo…');
    try {
      await deposita(c, f, (t) => { btn.textContent = `Deposito… ${t}`; });
      const { data: f1, error: e1 } = await sb.rpc('corso_fascicolo', { p_corso: c.id });
      if (e1) throw new Error(e1.message);
      const generati = await depositaGenerati(c, f1, (t) => { btn.textContent = `Genero… ${t}`; });
      const { data: f2, error: e2 } = await sb.rpc('corso_fascicolo', { p_corso: c.id });
      if (e2) throw new Error(e2.message);
      const chiuso = { ...f2, chiuso_il: new Date().toISOString() };
      /* il pacchetto: costruito, scaricato per il server della scuola, depositato su Drive */
      const pk = await costruisciPacchetto(c, chiuso, ctx, (t) => { btn.textContent = `Pacchetto… ${t}`; }, generati);
      scaricaZip(pk.zip, pk.nome);
      let avvisoPk = '';
      try {
        const up = await caricaByte(null, pk.nome, pk.zip, 'application/zip', f2.cartella.drive_id);
        const prima = (f2.depositati || []).find((d) => d.pezzo === 'pacchetto');
        const { error } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { pezzo: 'pacchetto', rif: '', nome: up.file_name || pk.nome, drive_id: up.drive_file_id, drive_url: up.drive_url, sha256: pk.sha256 } });
        if (error) throw new Error('caricato ma non registrato: ' + error.message);
        if (prima && prima.drive_id && prima.drive_id !== up.drive_file_id) { try { await cestina(prima.drive_id); } catch { /* resta il vecchio */ } }
      } catch (e) { avvisoPk = ` Il pacchetto NON è su Drive (${e.message}): l'hai scaricato, copialo tu nella cartella e sul server della scuola.`; }
      /* la nota della cartella, con l'impronta del pacchetto (quella dentro lo zip non può averla) */
      const md = indiceMd(c, chiuso, ctx, [`- Pacchetto: ${pk.nome} · ${pk.file} file · impronta SHA-256 ${pk.sha256}${avvisoPk ? ' (non depositato su Drive)' : ''}`]);
      const upI = await caricaByte(null, '_indice.md', new TextEncoder().encode(md), 'text/markdown', f2.cartella.drive_id);
      const primaI = (f2.depositati || []).find((d) => d.pezzo === 'indice');
      const { error: eI } = await sb.rpc('corso_fascicolo_deposita', { p_corso: c.id, p: { pezzo: 'indice', rif: '', nome: upI.file_name || '_indice.md', drive_id: upI.drive_file_id, drive_url: upI.drive_url } });
      if (eI) throw new Error('_indice.md caricato ma non registrato: ' + eI.message);
      if (primaI && primaI.drive_id && primaI.drive_id !== upI.drive_file_id) { try { await cestina(primaI.drive_id); } catch { /* resta il vecchio */ } }
      const { error } = await sb.rpc('corso_fascicolo_chiudi', { p_corso: c.id });
      if (error) throw new Error(error.message);
      toast(`Fascicolo chiuso e depositato su Drive; il pacchetto è scaricato.${pk.mancanti.length ? ` ⚠ ${pk.mancanti.length} documenti non entrati: li trovi nel LEGGIMI.` : ''}${avvisoPk}`, avvisoPk || pk.mancanti.length ? 'err' : 'ok');
    } catch (e) { toast('Non chiuso: ' + e.message, 'err'); }
    attendi(btn, false);
    ricarica();
  });
  body.querySelector('#fs-pacchetto')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true, 'Preparo…');
    try {
      const pk = await costruisciPacchetto(c, f, ctx, (t) => { btn.textContent = `Pacchetto… ${t}`; });
      scaricaZip(pk.zip, pk.nome);
      toast(`Pacchetto scaricato: ${pk.file} file, impronta ${pk.sha256.slice(0, 12)}….${pk.mancanti.length ? ` ⚠ ${pk.mancanti.length} documenti non entrati: li trovi nel LEGGIMI.` : ''}`, pk.mancanti.length ? 'err' : 'ok');
    } catch (e) { toast('Pacchetto non preparato: ' + e.message, 'err'); }
    attendi(btn, false);
  });
  body.querySelector('#fs-riapri')?.addEventListener('click', async () => {
    const { error } = await sb.rpc('corso_fascicolo_chiudi', { p_corso: c.id, p_riapri: true });
    if (error) return toast(error.message, 'err');
    toast('Fascicolo riaperto.', 'ok');
    ricarica();
  });
}
