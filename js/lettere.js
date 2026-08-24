/* ============================================================
   Lettere di incarico — i pulsanti colorati della vecchia
   maschera "Protocollo in USCITA".
   Il flusso è unico: compili i campi, l'app assegna il numero di
   protocollo in uscita, genera il PDF su carta intestata con il
   numero già stampato, lo allega al protocollo e — se vuoi — lo
   spedisce.

   ATTENZIONE: i testi qui sotto sono una prima stesura, scritta
   sul modello delle lettere in uso. Vanno confrontati con i
   modelli Word dell'ufficio prima di andare in produzione.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, mostraVista } from './app.js';
import { BUCKET, ENTE } from './config.js';
import { MODELLI_LETTERA, ETICHETTE_CAMPI } from './lookups.js';
import { pdfLib } from './cdn.js';

const { PDFDocument, rgb, StandardFonts } = await pdfLib();

const ARANCIO = rgb(0.906, 0.314, 0.059);
const GRIGIO = rgb(0.337, 0.361, 0.400);
const NERO = rgb(0.12, 0.12, 0.14);

/* ══════════════ ELENCO MODELLI ══════════════ */
export function render() {
  const host = $('#lettere-host');
  host.innerHTML = `
    <p style="color:var(--testo-soft);max-width:760px;margin:0 0 18px">
      Ogni lettera prende il primo numero libero del protocollo in uscita, viene generata su carta
      intestata con numero e data già stampati e resta allegata al protocollo.
      <br><em>I testi sono una prima stesura: da confrontare con i modelli Word dell'ufficio.</em>
    </p>
    <div class="stat-host">
      ${MODELLI_LETTERA.map((m) => `
        <div class="kpi" style="cursor:pointer" data-mod="${m.id}">
          <div style="font-weight:700;font-size:14px;line-height:1.4">${esc(m.nome)}</div>
          <div class="l" style="margin-top:8px">${esc(m.tipo_doc)}</div>
          ${m.note ? `<div class="hint" style="margin-top:8px;color:var(--out)">${esc(m.note)}</div>` : ''}
        </div>`).join('')}
    </div>`;

  host.querySelectorAll('[data-mod]').forEach((c) =>
    c.addEventListener('click', () => apriCompilazione(c.dataset.mod)));
}

/* ══════════════ COMPILAZIONE ══════════════ */
async function apriCompilazione(idModello) {
  const m = MODELLI_LETTERA.find((x) => x.id === idModello);
  if (!m) return;

  const { data: prossimo } = await sb.rpc('s_prossimo_numero', { p_dir: 'OUT' });

  $('#lettere-host').innerHTML = `
    <div class="form-host dir-OUT">
      <div class="grid" style="margin-bottom:18px">
        <div class="numero-box">
          <span class="lbl">Protocollo in uscita</span>
          <span class="n">${prossimo}</span>
        </div>
        <div class="field">
          <label for="l-data">Data della lettera</label>
          <input type="date" id="l-data" value="${oggiIso()}">
        </div>
      </div>

      <fieldset class="fieldset">
        <legend>${esc(m.nome)}</legend>
        <div class="grid">
          ${m.campi.map((c) => `
            <div class="field ${['cantieri', 'oggetto_incarico', 'date'].includes(c) ? 'full' : ''}">
              <label for="l-${c}">${esc(ETICHETTE_CAMPI[c] || c)}</label>
              ${['cantieri', 'oggetto_incarico'].includes(c)
                ? `<textarea id="l-${c}"></textarea>`
                : `<input type="text" id="l-${c}">`}
            </div>`).join('')}
          <div class="field full">
            <label for="l-oggetto">Oggetto per il registro di protocollo</label>
            <input type="text" id="l-oggetto" value="${esc(m.nome)}">
          </div>
          <div class="field full">
            <label for="l-premessa">Testo aggiuntivo (facoltativo, va dopo il corpo della lettera)</label>
            <textarea id="l-premessa"></textarea>
          </div>
        </div>
      </fieldset>

      <div class="form-actions">
        <button class="btn btn-ghost" id="l-indietro">Torna ai modelli</button>
        <button class="btn btn-ghost" id="l-anteprima">Anteprima PDF</button>
        <button class="btn btn-out" id="l-genera">Protocolla e genera</button>
      </div>
    </div>`;

  $('#l-indietro').addEventListener('click', render);
  $('#l-anteprima').addEventListener('click', async (e) => {
    attendi(e.currentTarget, true, 'Preparo…');
    const bytes = await costruisciPdf(m, raccogli(m), { numero: prossimo, data_prot: $('#l-data').value });
    attendi(e.currentTarget, false);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
  });
  $('#l-genera').addEventListener('click', (e) => generaEProtocolla(m, e.currentTarget));
}

function raccogli(m) {
  const v = {};
  m.campi.forEach((c) => { v[c] = ($(`#l-${c}`)?.value || '').trim(); });
  v._premessa = ($('#l-premessa')?.value || '').trim();
  v._oggetto = ($('#l-oggetto')?.value || '').trim() || m.nome;
  return v;
}

/* ══════════════ GENERAZIONE + PROTOCOLLO ══════════════ */
async function generaEProtocolla(m, btn) {
  const v = raccogli(m);
  if (!v.destinatario) return toast('Manca il destinatario.', 'err');

  attendi(btn, true, 'Protocollo e PDF…');
  const { data: prot, error } = await sb.rpc('s_crea_protocollo', {
    p: {
      direzione: 'OUT',
      data_prot: $('#l-data').value || oggiIso(),
      oggetto: v._oggetto,
      persona: v.destinatario,
      impresa_nome: v.impresa || null,
      tipo_doc_txt: m.tipo_doc,
      cartella: m.cartella || null,
      ufficio: 'Segreteria Area Sicurezza e Salute',
      referente: 'Squizzato Sig. Renato',
      mezzo: 'e-mail',
      note: m.note || null,
    },
  });
  if (error) { attendi(btn, false); return toast('Protocollazione non riuscita: ' + error.message, 'err'); }

  try {
    const bytes = await costruisciPdf(m, v, prot);
    const path = `${String(prot.data_prot).slice(0, 4)}/OUT/${prot.numero}/${Date.now()}_${m.id}.pdf`;
    const { error: errUp } = await sb.storage.from(BUCKET)
      .upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    if (errUp) throw new Error(errUp.message);

    await sb.from('s_prot_allegati').insert({
      protocollo_id: prot.id,
      nome: `${m.id}_prot${prot.numero}.pdf`,
      path, mime: 'application/pdf', dimensione: bytes.length,
      principale: true, timbrato: true, created_by: state.email,
    });

    attendi(btn, false);
    toast(`Lettera protocollata al n° ${prot.numero}.`, 'ok');

    const { apriDettaglio } = await import('./protocollo.js');
    mostraVista('registro');
    apriDettaglio(prot.id);
  } catch (err) {
    attendi(btn, false);
    toast(`Protocollo n° ${prot.numero} creato, ma il PDF non è stato allegato: ${err.message}`, 'err');
  }
}

/* ══════════════ COSTRUZIONE DEL PDF ══════════════ */
async function costruisciPdf(m, v, prot) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const ML = 60, MR = 60;
  let y = height - 50;

  /* logo istituzionale, senza alterazioni */
  try {
    const risp = await fetch('img/logo.png');
    if (risp.ok) {
      const png = await pdf.embedPng(await risp.arrayBuffer());
      const scala = 130 / png.width;
      page.drawImage(png, { x: ML, y: y - png.height * scala, width: 130, height: png.height * scala });
      y -= png.height * scala + 14;
    }
  } catch { /* senza logo la lettera resta valida */ }

  page.drawLine({ start: { x: ML, y }, end: { x: width - MR, y }, thickness: 2, color: ARANCIO });
  y -= 16;

  page.drawText(ENTE.area.toUpperCase(), { x: ML, y, size: 8, font: bold, color: GRIGIO });
  page.drawText(`${ENTE.indirizzo} · tel. ${ENTE.tel} · ${ENTE.email}`,
    { x: ML, y: y - 11, size: 7.5, font, color: GRIGIO });
  y -= 34;

  /* riferimenti di protocollo */
  page.drawText(`Prot. n° ${prot.numero}/OUT`, { x: ML, y, size: 10, font: bold, color: NERO });
  page.drawText(`Padova, ${dataIt(prot.data_prot)}`, { x: width - MR - 150, y, size: 10, font, color: NERO });
  y -= 32;

  /* destinatario */
  page.drawText('Spett.le', { x: width - MR - 210, y, size: 10, font, color: NERO });
  y -= 14;
  righe(v.impresa || v.destinatario, 34).forEach((r) => {
    page.drawText(r, { x: width - MR - 210, y, size: 10, font: bold, color: NERO }); y -= 13;
  });
  if (v.impresa && v.destinatario) {
    page.drawText(`c.a. ${v.destinatario}`.slice(0, 40), { x: width - MR - 210, y, size: 10, font, color: NERO });
    y -= 13;
  }
  y -= 26;

  /* oggetto */
  page.drawText('Oggetto:', { x: ML, y, size: 10, font: bold, color: ARANCIO });
  const testoOgg = righe(v._oggetto, 66);
  testoOgg.forEach((r, i) => page.drawText(r, { x: ML + 52, y: y - i * 13, size: 10, font: bold, color: NERO }));
  y -= testoOgg.length * 13 + 24;

  /* corpo — se serve, prosegue su una pagina nuova */
  let pg = page;
  const corpo = corpoLettera(m, v);
  const larghezza = width - ML - MR;
  corpo.split('\n').forEach((paragrafo) => {
    if (!paragrafo.trim()) { y -= 8; return; }
    spezza(paragrafo, font, 10.5, larghezza).forEach((r) => {
      if (y < 130) { pg = pdf.addPage([595.28, 841.89]); y = height - 70; }
      pg.drawText(r, { x: ML, y, size: 10.5, font, color: NERO });
      y -= 15;
    });
    y -= 7;
  });

  /* firma */
  if (y < 170) { pg = pdf.addPage([595.28, 841.89]); y = height - 70; }
  y -= 20;
  pg.drawText('Distinti saluti.', { x: ML, y, size: 10.5, font, color: NERO });
  y -= 46;
  pg.drawText('FORMEDIL PADOVA', { x: width - MR - 190, y, size: 9, font, color: GRIGIO });
  pg.drawText('Il Presidente', { x: width - MR - 190, y: y - 13, size: 10, font: bold, color: NERO });
  pg.drawLine({
    start: { x: width - MR - 190, y: y - 44 }, end: { x: width - MR - 20, y: y - 44 },
    thickness: 0.6, color: GRIGIO,
  });

  /* piede su ogni pagina */
  pdf.getPages().forEach((p) => p.drawText(`${ENTE.nome} — ${ENTE.sotto} · ${ENTE.web}`,
    { x: ML, y: 40, size: 7.5, font, color: GRIGIO }));

  return pdf.save();
}

/* testi provvisori, da allineare ai modelli Word dell'ufficio */
function corpoLettera(m, v) {
  const comune = 'Padova';
  const testi = {
    incarico_assev_cantieri: `Con la presente siamo a conferirLe l'incarico di asseveratore per il procedimento di asseverazione del modello di organizzazione e gestione della sicurezza dell'impresa ${v.impresa || '……'}, ai sensi della norma UNI 11751-1.

L'incarico comprende l'esame documentale, le verifiche in campo presso i cantieri di seguito indicati e la redazione dei relativi rapporti per il Gruppo di Verifica:
${v.cantieri || '……'}

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge, e sarà liquidato a conclusione delle attività previa presentazione di regolare documento contabile.

Le attività dovranno svolgersi nel periodo ${v.periodo || '……'}.

Nell'espletamento dell'incarico Le chiediamo di attenersi al manuale del procedimento di asseverazione e di garantire riservatezza su ogni informazione acquisita.`,

    incarico_assev_secondo: `Con la presente siamo a conferirLe l'incarico di secondo asseveratore nel procedimento di asseverazione dell'impresa ${v.impresa || '……'}, a supporto dell'asseveratore incaricato e con i medesimi obblighi di riservatezza e imparzialità.

Cantieri interessati dalle verifiche:
${v.cantieri || '……'}

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge.
Le attività dovranno svolgersi nel periodo ${v.periodo || '……'}.`,

    incarico_assev_lup: `Con la presente siamo a conferirLe l'incarico di Lavoratore Unico Presente (LUP) nel procedimento di asseverazione dell'impresa ${v.impresa || '……'}.

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge.
Le attività dovranno svolgersi nel periodo ${v.periodo || '……'}.`,

    fine_assev_marchio: `Con la presente Vi comunichiamo la conclusione con esito positivo del procedimento di asseverazione del modello di organizzazione e gestione della sicurezza della Vostra impresa.

Da oggi e fino al ${v.scadenza || '……'} siete autorizzati all'utilizzo del marchio di asseverazione secondo le condizioni stabilite dal regolamento nazionale: il marchio va riprodotto senza alterazioni, sempre accompagnato dal riferimento all'impresa asseverata, e il suo uso decade in caso di sospensione o revoca dell'asseverazione.

Vi ricordiamo che il mantenimento è subordinato alle verifiche periodiche previste dal programma triennale.`,

    incarico_docenza: `Con la presente siamo a conferirLe l'incarico di docenza nell'ambito del corso ${v.corso || '……'}.

Le lezioni si terranno nelle date ${v.date || '……'}, per complessive ${v.ore || '……'} ore, presso la nostra sede di ${comune}, salvo diversa comunicazione.

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge, e sarà liquidato previa presentazione del registro delle presenze debitamente compilato e sottoscritto.

Le chiediamo di attenersi al programma didattico concordato e di comunicare tempestivamente ogni eventuale impedimento.`,

    incarico_progetti: `Con la presente siamo a conferirLe l'incarico per le attività previste dal progetto ${v.progetto || '……'}.

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge, e sarà liquidato secondo l'avanzamento delle attività rendicontate.

Le attività dovranno svolgersi nel periodo ${v.periodo || '……'}.`,

    incarico_generica: `Con la presente siamo a conferirLe l'incarico avente ad oggetto:
${v.oggetto_incarico || '……'}

Il compenso pattuito è pari a ${v.compenso || '……'}, al lordo delle ritenute di legge.
Le attività dovranno svolgersi nel periodo ${v.periodo || '……'}.`,
  };

  let t = testi[m.id] || '';
  if (v._premessa) t += `\n\n${v._premessa}`;
  return t;
}

/* ── utilità di impaginazione ─────────────────────────────── */
function righe(testo, max) {
  const t = String(testo || '');
  const out = [];
  for (let i = 0; i < t.length; i += max) out.push(t.slice(i, i + max));
  return out.length ? out : [''];
}

function spezza(testo, font, size, larghezza) {
  const parole = String(testo).replace(/\s+/g, ' ').trim().split(' ');
  const out = [];
  let riga = '';
  parole.forEach((w) => {
    const prova = riga ? `${riga} ${w}` : w;
    if (font.widthOfTextAtSize(prova, size) > larghezza) { out.push(riga); riga = w; }
    else riga = prova;
  });
  if (riga) out.push(riga);
  return out;
}
