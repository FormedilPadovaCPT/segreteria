/* ============================================================
   LETTERA DI AFFIANCAMENTO dei tecnici nuovi (21/10/2026)

   Chiesta dall'utente dopo la mail del Direttore del 20/10/2026
   («Formazione e affiancamenti nuovi tecnici»): le visite in
   affiancamento di un tecnico nuovo si coprono con una lettera
   dell'ente, firmata dal Direttore e controfirmata dal tecnico.
   I contratti si fanno dopo, quando il tecnico parte da solo.

   Il giro, nella pagina «🗂️ Documenti tecnici»:
     1. «✍️ Lettera di affiancamento»: tecnico affiancato, tecnici che
        lo affiancano, periodo;
     2. il numero lo dà il registro unico (s_crea_protocollo, OUT): la
        lettera varca la porta, va al tecnico. Rigenerandola si tiene
        lo stesso numero;
     3. il PDF esce sulla carta intestata Formedil (la stessa delle
        nomine) e va in firma a catena: prima il Direttore, nella
        pagina Direzione del gestionale, poi il tecnico per
        accettazione, in «Le mie firme» della pagina Formazione;
     4. a catena completa «📁 Deposita e prepara la mail»: il PDF
        firmato va nella cartella del tecnico in Team_Tecnici, si
        collega al protocollo, e la bozza .eml al tecnico la manda
        una persona (l'app prepara, la persona manda).
   Il testo, il nome del file e la cartella stanno in
   lettera-affiancamento-regole.js, coi test.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer, chiudiDrawer, codiceProtocollo } from './core.js';
import { siglaProtocollo } from './comune.js';
import { risolviCartella, caricaByte } from './drive.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { chiediFirma, firmeDi, scaricaFirmata, apriPdf, etichettaFirma, esitoAvvisi } from './firme.js';
import {
  tecnicoVero, nominativo, periodo, testoLettera, testoPerProtocollo, nomeFile, cartellaTecnico,
  rifAffiancamento, RIF_PREFISSO,
} from './lettera-affiancamento-regole.js';

const TIPO = 'documento';

async function tecniciInServizio() {
  const { data, error } = await sb.from('tecnici')
    .select('tecnico_id, titolo, tecnico_nome, tecnico_cognome, email, attivo, persona_id')
    .eq('attivo', true).order('tecnico_cognome');
  if (error) throw new Error('Non sono riuscito a leggere i tecnici: ' + error.message);
  return (data || []).filter(tecnicoVero);
}

/* ── la maschera ──────────────────────────────────────────── */
export async function apriLettera(dopo) {
  let tecnici;
  try { tecnici = await tecniciInServizio(); } catch (e) { return toast(e.message, 'err'); }
  const opz = tecnici.map((t) => `<option value="${esc(t.tecnico_id)}">${esc(nominativo(t))}</option>`).join('');
  apriDrawer('Lettera di affiancamento', 'Visite in cantiere a fini di formazione: firma il Direttore, poi il tecnico per accettazione', `
    <div class="field"><label>Tecnico affiancato *</label>
      <select id="la-tec"><option value="">—</option>${opz}</select></div>
    <div class="field"><label>Tecnici che lo affiancano *</label>
      <div id="la-tutori" style="display:flex;flex-wrap:wrap;gap:4px 14px"></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div class="field"><label>Dal *</label><input type="date" id="la-dal"></div>
      <div class="field"><label>Al (vuoto = fino a nuova comunicazione)</label><input type="date" id="la-al"></div>
      <div class="field"><label>Data della lettera</label><input type="date" id="la-data" value="${oggiIso()}"></div>
    </div>
    <div class="field" style="margin-top:6px"><label>Anteprima del testo</label>
      <div id="la-anteprima" class="hint" style="white-space:pre-wrap;border:1px solid var(--bordo,#ddd);padding:8px;border-radius:6px;max-height:220px;overflow:auto"></div></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-primary" id="la-manda">✍️ Protocolla, genera e manda in firma</button>
    </div>
    <p class="hint" style="margin-top:8px">Il numero lo dà il registro unico, in uscita. Se il tecnico ha già una lettera non ancora firmata, si rigenera con lo stesso numero.</p>`);

  const tec = () => tecnici.find((t) => t.tecnico_id === $('#la-tec').value) || null;
  const tutoriScelti = () => [...document.querySelectorAll('#la-tutori input:checked')]
    .map((c) => tecnici.find((t) => t.tecnico_id === c.value)).filter(Boolean);
  const anteprima = () => {
    try {
      const t = testoLettera({ affiancato: tec(), tutori: tutoriScelti(), dal: $('#la-dal').value, al: $('#la-al').value });
      $('#la-anteprima').textContent = testoPerProtocollo(t);
    } catch (e) { $('#la-anteprima').textContent = e.message; }
  };
  const disegnaTutori = () => {
    const io = $('#la-tec').value;
    const prima = new Set(tutoriScelti().map((t) => t.tecnico_id));
    $('#la-tutori').innerHTML = tecnici.filter((t) => t.tecnico_id !== io).map((t) =>
      `<label style="display:inline-flex;align-items:center;gap:5px;text-transform:none;font-weight:400"><input type="checkbox" value="${esc(t.tecnico_id)}" ${prima.has(t.tecnico_id) ? 'checked' : ''} style="width:auto">${esc(nominativo(t))}</label>`).join('');
    $('#la-tutori').querySelectorAll('input').forEach((c) => c.addEventListener('change', anteprima));
    anteprima();
  };
  $('#la-tec').addEventListener('change', disegnaTutori);
  ['#la-dal', '#la-al'].forEach((s) => $(s).addEventListener('change', anteprima));
  disegnaTutori();

  $('#la-manda').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const affiancato = tec();
    const tutori = tutoriScelti();
    const dal = $('#la-dal').value, al = $('#la-al').value;
    const dataLettera = $('#la-data').value || oggiIso();
    if (!affiancato) return toast('Scegli il tecnico affiancato.', 'err');
    if (!tutori.length) return toast('Scegli almeno un tecnico che lo affianca.', 'err');
    if (!dal) return toast('Scrivi da quando partono gli affiancamenti.', 'err');
    if (al && al < dal) return toast('La data di fine viene prima di quella di inizio.', 'err');
    if (!affiancato.email) return toast(`${nominativo(affiancato)} non ha un indirizzo con cui entrare nel gestionale: non può firmare nell'app.`, 'err');
    attendi(btn, true, 'Un istante…');
    try {
      const testo = testoLettera({ affiancato, tutori, dal, al });
      const rif = rifAffiancamento(affiancato.tecnico_id);
      /* c'è già una lettera per questo tecnico? stesso numero, se non è ancora firmata */
      const gia = (await firmeDi(TIPO, [rif])).get(rif);
      if (gia?.stato === 'firmata') {
        throw new Error(`${nominativo(affiancato)} ha già una lettera di affiancamento firmata. Per una nuova, prima la si ritira dal cruscotto («✍️ Firme in attesa»).`);
      }
      let prot = null;
      if (gia?.protocollo_id) {
        const { data, error } = await sb.from('s_protocollo').select('*').eq('id', gia.protocollo_id).maybeSingle();
        if (error) throw new Error('Non sono riuscito a leggere il protocollo della lettera già fatta: ' + error.message);
        prot = data;
      }
      const msg = prot
        ? `La lettera per ${nominativo(affiancato)} ha già il numero ${codiceProtocollo(prot)}: la rigenero con lo stesso numero e la rimando in firma (la richiesta di prima si ritira). Procedo?`
        : `Protocollo in uscita la lettera di affiancamento per ${nominativo(affiancato)}, la genero sulla carta intestata e la mando in firma: prima il Direttore (gli arriva la mail), poi ${nominativo(affiancato)} per accettazione. Procedo?`;
      if (!confirm(msg)) return;
      if (!prot) {
        const { data, error } = await sb.rpc('s_crea_protocollo', { p: {
          direzione: 'OUT', data_prot: oggiIso(), data_doc: dataLettera,
          persona: nominativo(affiancato), mittente_email: null,
          oggetto: `Lettera di affiancamento nelle visite in cantiere a fini di formazione — ${nominativo(affiancato)}`,
          sintesi: `Affiancamento ${periodo(dal, al)} con ${tutori.map(nominativo).join(', ')}. Firma del Direttore, poi del tecnico per accettazione nell'app.`,
          note: testoPerProtocollo(testo),
          ufficio: 'Segreteria Area Sicurezza e Salute', mezzo: 'e-mail',
          tipo_doc_txt: 'Lettera di affiancamento', cartella: cartellaTecnico(affiancato),
        } });
        if (error) throw new Error('Protocollazione non riuscita: ' + error.message);
        prot = data;
      }
      const sigla = siglaProtocollo(prot);
      const { pdfLettera } = await import('./lettera-affiancamento-pdf.js');
      const { byte, riquadroDirettore, riquadroTecnico } = await pdfLettera({ affiancato, testo, sigla, dataLettera });
      const r = await chiediFirma([{
        tipo: TIPO, rif, protocollo_id: prot.id,
        titolo: `Lettera di affiancamento a fini di formazione — ${nominativo(affiancato)}`,
        destinatario: nominativo(affiancato), nome_file: nomeFile(dataLettera, affiancato, sigla), byte,
        firmatari: [
          { ruolo: 'direttore', riquadro: riquadroDirettore },
          { ruolo: 'incaricato', email: String(affiancato.email).toLowerCase(), riquadro: riquadroTecnico },
        ],
      }]);
      toast(...esitoAvvisi(r, `Lettera ${codiceProtocollo(prot)}`));
      chiudiDrawer();
      if (dopo) dopo();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      attendi(btn, false);
    }
  });
}

/* ── l'elenco delle lettere, in cima alla pagina ─────────── */
export async function boxLettere(host, dopo) {
  if (!host) return;
  const { data, error } = await sb.from('s_firme').select('rif').eq('tipo', TIPO).like('rif', `${RIF_PREFISSO}%`);
  if (error) { host.innerHTML = `<p class="hint" style="color:#c0392b">Non sono riuscito a leggere le lettere di affiancamento: ${esc(error.message)}</p>`; return; }
  const rifs = [...new Set((data || []).map((r) => r.rif))];
  let mappa;
  try { mappa = await firmeDi(TIPO, rifs); } catch (e) { host.innerHTML = `<p class="hint" style="color:#c0392b">${esc(e.message)}</p>`; return; }
  const lettere = [...mappa.values()].filter((r) => r && r.stato !== 'ritirata');
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">
      <button class="btn btn-primary btn-sm" id="la-nuova">✍️ Lettera di affiancamento</button>
      ${lettere.length ? `<span class="hint">Lettere: ${lettere.map((r) => `${esc(r.destinatario || '')} ${etichettaFirma(r)}
        ${r.file_firmato || r.file_originale ? `<a href="#" data-la-apri="${r.id}">📄</a>` : ''}
        ${r.stato === 'firmata' && !r.usata_il ? `<a href="#" data-la-deposita="${r.id}">📁 Deposita e prepara la mail</a>` : ''}`).join(' · ')}</span>` : ''}
    </div>`;
  $('#la-nuova').addEventListener('click', () => apriLettera(dopo));
  host.querySelectorAll('[data-la-apri]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const r = lettere.find((x) => String(x.id) === a.dataset.laApri);
    if (r) apriPdf(r.file_firmato || r.file_originale);
  }));
  host.querySelectorAll('[data-la-deposita]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = lettere.find((x) => String(x.id) === a.dataset.laDeposita);
    if (r) await depositaEMail(r, dopo);
  }));
}

/* a catena completa: deposito nella cartella del tecnico, aggancio al
   protocollo, bozza della mail al tecnico (la manda una persona) */
async function depositaEMail(r, dopo) {
  try {
    const tecnicoId = String(r.rif).slice(RIF_PREFISSO.length);
    const [{ data: t, error: eT }, { data: prot, error: eP }] = await Promise.all([
      sb.from('tecnici').select('tecnico_id, titolo, tecnico_nome, tecnico_cognome, email').eq('tecnico_id', tecnicoId).maybeSingle(),
      sb.from('s_protocollo').select('*').eq('id', r.protocollo_id).maybeSingle(),
    ]);
    if (eT || !t) throw new Error('Non trovo il tecnico della lettera: ' + (eT?.message || tecnicoId));
    if (eP || !prot) throw new Error('Non trovo il protocollo della lettera: ' + (eP?.message || r.protocollo_id));
    const byte = await scaricaFirmata(r);
    const sigla = siglaProtocollo(prot);
    const nome = nomeFile(prot.data_doc || oggiIso(), t, sigla, true);
    const cart = await risolviCartella(cartellaTecnico(t));
    if (!cart?.id || cart.mancante) throw new Error(`Non trovo la cartella ${cartellaTecnico(t)} su Drive: creala, poi riprova.`);
    const su = await caricaByte(prot, nome, byte, 'application/pdf', cart.id);
    const { error: eA } = await sb.from('s_prot_allegati').insert({
      protocollo_id: prot.id, nome: su.file_name || nome, mime: 'application/pdf',
      dimensione: byte.length, principale: true, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    if (eA) toast(`Depositata, ma non collegata al protocollo: ${eA.message}`, 'err');
    const { error: eU } = await sb.rpc('s_firma_usata', { p_id: r.id });
    if (eU) console.warn('firma usata non segnata:', eU.message);
    scaricaEml({
      to: t.email || '',
      oggetto: `Lettera di affiancamento nelle visite in cantiere ${codiceProtocollo(prot)}`,
      corpo: `Gentile ${nominativo(t)},

in allegato la lettera di affiancamento nelle visite in cantiere a fini di formazione, firmata dal Direttore e da Lei per accettazione, da conservare.

Cordiali saluti.

${FIRMA_SEGRETERIA}`,
      allegati: [{ nome, byte }],
      nomeFile: `lettera-affiancamento-${String(t.tecnico_cognome || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.eml`,
    });
    toast(`Lettera ${codiceProtocollo(prot)} depositata in ${cartellaTecnico(t)}: bozza mail scaricata.`, 'ok');
    if (dopo) dopo();
  } catch (e) {
    toast(e.message, 'err');
  }
}
