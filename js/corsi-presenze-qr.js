/* ══════════════════════════════════════════════════════════════════════════
   LE FIRME DI PRESENZA DAL QR DEL CORSO                        (13/10/2026)
   Lotto 4 del fascicolo corso digitale.

   La segreteria APRE le firme del corso: nasce il codice P<corso>-XXXX, un
   codice personale per ogni iscritto che non ce l'ha (lo stesso del test;
   dal 14/10/2026 si consegna su un BIGLIETTO personale, non sta più accanto
   al nome sul registro, e alla firma si chiede anche l'anno di nascita) e il
   link firmato del QR, che va
   in copertina del registro e sul foglio da esporre in aula. Il corso si
   PUBBLICA sul portale (titolo, giornate con gli orari, impronta dei codici
   e iniziali: niente nomi interi, niente CF).

   In aula l'allievo inquadra il QR, scrive il suo codice, vede «sei tu?
   C. L.» e un pulsante solo: «Firmo l'entrata delle 8:30». ENTRATA O USCITA
   LO DECIDE IL SERVER sull'ora di arrivo (pres_decidi), non il telefono.
   Ogni firma nasce «ricevuta»; la CONFERMA (per allievo, deciso dall'utente)
   la dà il docente dalla sua pagina (lotto 5) o la segreteria da qui, e solo
   le confermate scrivono le presenze (ingresso1/uscita1/…: trigger nel DB).
   Una firma fuori orario resta da guardare una per una.

   Qui solo letture dirette e RPC: le scritture passano da pres_apri,
   pres_conferma, pres_conferma_allievo — mai un update sulla tabella.
   ══════════════════════════════════════════════════════════════════════════ */
import { sb, $, esc, dataIt, oggiIso, toast, attendi, apriDrawer } from './core.js';
import { scaricaPdf, pdfFoglioPresenze } from './corsi-doc.js';

const STATI = { ricevuta: 'ricevuta', confermata: 'confermata', respinta: 'respinta' };

export function oraRoma(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
}
function quando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dataIt(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }))} alle ${oraRoma(iso)}`;
}
const chiuso = (iso) => !!iso && new Date(iso) <= new Date();

/* l'etichetta di una firma: «entrata 1 · 08:31», «uscita 2 · 17:28 · fuori orario» */
export function etichettaFirma(f) {
  const base = f.tipo ? `${f.tipo}${f.turno ? ' ' + f.turno : ''}` : 'senza momento';
  return [base, oraRoma(f.ora_server), f.fuori_orario ? 'fuori orario' : ''].filter(Boolean).join(' · ');
}

export async function datiPres(c) {
  if (!c.pres_codice) return { link: null, firme: [], errore: null };
  const [{ data: link, error: e1 }, { data: firme, error: e2 }] = await Promise.all([
    sb.rpc('pres_link', { p_corso_id: c.id }),
    sb.from('s_corsi_firme_presenza').select('*').eq('corso_id', c.id).order('ora_server'),
  ]);
  /* un errore di lettura si dice: «nessuna firma» non è «non sono riuscito a leggerle» */
  return { link: link || null, firme: firme || [], errore: e1?.message || e2?.message || null };
}

export function sezionePres(c, p, iscritti, giornate) {
  const ammessi = (iscritti || []).filter((i) => !['annullato', 'sostituito'].includes(i.esito || ''));
  const senzaCodice = ammessi.filter((i) => !i.test_codice).length;
  if (!c.pres_codice) {
    return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📲 Firme di presenza dal QR</h4>
    <p class="hint" style="margin:0 0 8px">Aprendole nasce il <strong>codice del corso</strong> (uno per tutte le giornate), un
      <strong>codice personale per ciascun iscritto</strong> che non ce l'ha già dal test, e il QR che finisce in copertina del
      registro e sul foglio da esporre in aula. L'allievo inquadra, scrive il suo codice e firma: <strong>entrata o uscita le
      decide il server</strong> sull'ora di arrivo. Le firme le conferma il docente (o tu, da qui); solo le confermate
      scrivono le presenze.${c.firme_qr === false ? ' <strong>Questo corso ha le firme dal QR spente</strong> nei suoi dati: aprendole si accendono.' : ''}</p>
    <button class="btn btn-primary btn-sm" id="pq-apri">📲 Apri le firme dal QR (${ammessi.length} iscritti${senzaCodice ? `, ${senzaCodice} senza codice` : ''})</button>`;
  }

  const link = p.link || {};
  const eChiuso = chiuso(link.chiuso_il || c.pres_chiuso_il);
  const pubblicato = !!(link.pubblicato_il || c.pres_pubblicato_il);
  const firme = p.firme || [];
  const perG = new Map();
  for (const f of firme) {
    const k = f.giornata_id || 0;
    if (!perG.has(k)) perG.set(k, []);
    perG.get(k).push(f);
  }
  const gDi = (id) => (giornate || []).find((g) => g.id === id);
  const n = { ricevute: 0, confermate: 0, respinte: 0, fuori: 0, ignote: 0 };
  for (const f of firme) {
    if (f.stato === 'ricevuta') n.ricevute++;
    if (f.stato === 'confermata') n.confermate++;
    if (f.stato === 'respinta') n.respinte++;
    if (f.fuori_orario && f.stato === 'ricevuta') n.fuori++;
    if (!f.iscritto_id) n.ignote++;
  }
  const badge = (f) => f.stato === 'confermata' ? 'dt-ok' : f.stato === 'respinta' ? 'dt-scaduto' : '';
  const riga = (f) => `<tr${f.fuori_orario && f.stato === 'ricevuta' ? ' style="background:#fff6f2"' : ''}>
    <td class="num">${oraRoma(f.ora_server)}${f.ora_dispositivo && Math.abs(new Date(f.ora_dispositivo) - new Date(f.ora_server)) > 5 * 60000
      ? `<br><span class="hint" title="l'ora del telefono: indicativa, vale quella di arrivo">tel. ${oraRoma(f.ora_dispositivo)}</span>` : ''}</td>
    <td><strong>${esc(f.nominativo || '—')}</strong>${!f.iscritto_id ? `<br><span class="dt-cella dt-scaduto" style="padding:1px 6px">${esc(f.riferimento_esito || 'non riconosciuta')}</span>` : ''}</td>
    <td>${f.tipo ? `${esc(f.tipo)}${f.turno ? ' ' + f.turno : ''}` : '<span class="hint">—</span>'}${f.fuori_orario ? ' <span class="dt-cella dt-scaduto" style="padding:1px 6px">fuori orario</span>' : ''}</td>
    <td><span class="dt-cella ${badge(f)}" style="padding:1px 6px">${esc(STATI[f.stato] || f.stato)}</span>
      ${f.confermata_il ? `<br><span class="hint">${esc(f.confermata_da || '')} · ${quando(f.confermata_il)}</span>` : ''}
      ${f.note ? `<br><span class="hint">${esc(f.note)}</span>` : ''}</td>
    <td style="white-space:nowrap">${f.iscritto_id && f.stato === 'ricevuta'
      ? `<a href="#" data-pq-conf="${f.id}">✓ conferma</a> · <a href="#" data-pq-resp="${f.id}">✗ respingi</a>`
      : f.stato !== 'ricevuta' ? `<a href="#" data-pq-riap="${f.id}" title="torna «ricevuta», e la presenza scritta si toglie">↩</a>` : ''}</td>
  </tr>`;

  const blocchi = [...perG.entries()].sort((a, b) => {
    const da = gDi(a[0])?.data || '', db = gDi(b[0])?.data || '';
    return da.localeCompare(db);
  }).map(([gid, lista]) => {
    const g = gDi(gid);
    const daConfermare = new Set(lista.filter((f) => f.stato === 'ricevuta' && !f.fuori_orario && f.iscritto_id).map((f) => f.iscritto_id));
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:10px 0 4px;flex-wrap:wrap">
        <strong>${g ? dataIt(g.data) : 'giornata non riconosciuta'}</strong>
        <span class="hint">${lista.length} firm${lista.length === 1 ? 'a' : 'e'}</span>
        ${daConfermare.size ? `<button class="btn btn-ghost btn-sm" data-pq-tutte="${gid}" data-pq-iscritti="${[...daConfermare].join(',')}"
          title="Conferma le firme in orario di questa giornata, allievo per allievo; quelle fuori orario restano da guardare">✓ Conferma le ${lista.filter((f) => f.stato === 'ricevuta' && !f.fuori_orario && f.iscritto_id).length} in orario</button>` : ''}
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Ora</th><th>Allievo</th><th>Momento</th><th>Stato</th><th></th></tr></thead>
        <tbody>${lista.map(riga).join('')}</tbody>
      </table></div>`;
  }).join('');

  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📲 Firme di presenza dal QR <span class="hint" style="font-weight:400">— le conferma il docente, o tu</span></h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
      <span class="dt-cella" style="padding:2px 8px"><strong class="num">${esc(c.pres_codice)}</strong></span>
      <span class="dt-cella ${eChiuso ? 'dt-scaduto' : 'dt-ok'}" style="padding:2px 8px">
        ${eChiuso ? 'chiuse il' : 'aperte fino al'} ${quando(link.chiuso_il || c.pres_chiuso_il)}</span>
      <span class="dt-cella ${pubblicato ? 'dt-ok' : 'dt-scaduto'}" style="padding:2px 8px"
        title="${esc(link.pubblica_esito || c.pres_pubblica_esito || '')}">${pubblicato ? 'sul portale' : 'NON sul portale'}</span>
      <span class="hint">${n.confermate} confermate · ${n.ricevute} da guardare${n.fuori ? ` (${n.fuori} fuori orario)` : ''}${n.ignote ? ` · ${n.ignote} non riconosciute` : ''}</span>
    </div>
    ${p.errore ? `<p class="hint" style="color:#a01f00">Non sono riuscito a leggere le firme: ${esc(p.errore)}</p>` : ''}
    ${!pubblicato ? '<p class="hint" style="color:#a01f00;margin:0 0 8px">⚠ Finché il corso non è sul portale il QR non apre niente: premi «Ripubblica».</p>' : ''}
    ${senzaCodice ? `<p class="hint" style="color:#a01f00;margin:0 0 8px">⚠ ${senzaCodice} iscritt${senzaCodice === 1 ? 'o' : 'i'} senza codice personale (aggiunt${senzaCodice === 1 ? 'o' : 'i'} dopo l'apertura): «Ripubblica» glielo assegna e lo manda al portale.</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <button class="btn btn-ghost btn-sm" id="pq-foglio">📄 Foglio QR da esporre</button>
      <button class="btn btn-ghost btn-sm" id="pq-pubblica">🔁 Ripubblica sul portale</button>
      <button class="btn btn-ghost btn-sm" id="pq-codici">🔑 Codici personali</button>
      <button class="btn btn-ghost btn-sm" id="pq-biglietti">🎟 Biglietti dei codici</button>
      <button class="btn btn-ghost btn-sm" id="pq-link" ${link.link ? '' : 'disabled'}>🔗 Copia il link</button>
    </div>
    ${firme.length ? blocchi : '<p class="hint">Nessuna firma arrivata finora.</p>'}`;
}

export async function pubblicaPres(c, silenziosa) {
  /* prima i codici a chi non ce l'ha (iscritto dopo l'apertura), poi la copia sul portale */
  const { data: nuovi, error: eCod } = await sb.rpc('corso_codici_personali', { p_corso_id: c.id });
  if (eCod) { toast('Codici personali non assegnati: ' + eCod.message, 'err'); return false; }
  const { data, error } = await sb.functions.invoke('questionari-pubblica', { body: { corso_id: c.id, cosa: 'presenza' } });
  if (error || data?.status !== 'ok') {
    const m = data?.esito || data?.saltati?.[0]?.motivo || error?.message || 'non pubblicato';
    toast(`Le firme NON sono sul portale: ${m}`, 'err');
    return false;
  }
  if (!silenziosa) toast(`Firme pubblicate sul portale${nuovi ? ` (${nuovi} codici nuovi)` : ''}.`, 'ok');
  return true;
}

export function collegaPres(c, p, iscritti, giornate, ricarica) {
  const body = $('#drawer-body');
  if (!body) return;

  body.querySelector('#pq-apri')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!(giornate || []).length) return toast('Un corso ha sempre almeno una giornata: aggiungila prima di aprire le firme.', 'err');
    if (!confirm('Apro le firme di presenza dal QR per questo corso? Nascono il codice del corso e un codice personale per ogni iscritto; il QR va stampato in copertina del registro (ristampalo se lo avevi già stampato).')) return;
    attendi(btn, true, 'Apro…');
    const { data, error } = await sb.rpc('pres_apri', { p_corso_id: c.id, p_ore: 48 });
    if (error) { attendi(btn, false); return toast(error.message, 'err'); }
    const r = Array.isArray(data) ? data[0] : data;
    await pubblicaPres({ ...c, pres_codice: r?.codice }, true);
    attendi(btn, false);
    toast(`Firme aperte: codice ${r?.codice || '—'}, ${r?.codici_personali ?? 0} codici personali nuovi. Ristampa il registro: il QR è in copertina.`, 'ok');
    ricarica();
  });

  body.querySelector('#pq-foglio')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true);
    try {
      const byte = await pdfFoglioPresenze(c, { codice: c.pres_codice, link: p.link?.link || '' });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_firme-presenza-QR_corso-${c.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    attendi(btn, false);
  });

  body.querySelector('#pq-pubblica')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true);
    await pubblicaPres(c, false);
    attendi(btn, false);
    ricarica();
  });


  body.querySelector('#pq-biglietti')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    attendi(btn, true);
    try {
      const { pdfBigliettiCodici, scaricaPdf } = await import('./corsi-doc.js');
      const byte = await pdfBigliettiCodici(c, iscritti || [], { pres: !!c.pres_codice, test: !!c.test_codice });
      scaricaPdf(byte, `${oggiIso().replace(/-/g, '_')}_MOD_Formedil-Padova_biglietti-codici-personali_corso-${c.id}.pdf`);
    } catch (e) { toast(e.message, 'err'); }
    attendi(btn, false);
  });

  body.querySelector('#pq-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p.link?.link || ''); toast('Link copiato.', 'ok'); }
    catch { toast('Non riesco a copiare: ' + (p.link?.link || ''), 'err'); }
  });

  body.querySelector('#pq-codici')?.addEventListener('click', () => {
    const righe = (iscritti || []).filter((i) => i.test_codice)
      .map((i) => `<tr><td>${esc(i.nominativo)}</td><td class="num"><strong>${esc(i.test_codice)}</strong></td></tr>`).join('');
    apriDrawer(`Codici personali — corso n° ${c.id}`, '', `
      <p class="hint" style="margin:0 0 10px">Ogni allievo riceve il suo codice sul <strong>biglietto personale</strong>
        («🎟 Biglietti dei codici», da ritagliare e dare in mano a ciascuno): questa è solo una copia da consultare,
        per chi l'ha perso. <strong>Non vanno mandati per mail insieme al nome</strong> né stampati su fogli che
        girano in aula — chi li avesse tutti potrebbe firmare (o fare il test) al posto di chiunque.</p>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Partecipante</th><th>Codice</th></tr></thead>
        <tbody>${righe || '<tr><td colspan="2" class="empty">Nessun codice: apri le firme.</td></tr>'}</tbody>
      </table></div>`);
  });

  const cambia = async (id, stato, nota) => {
    const { error } = await sb.rpc('pres_conferma', { p_id: Number(id), p_stato: stato, p_nota: nota || null });
    if (error) return toast(error.message, 'err');
    ricarica();
  };
  body.querySelectorAll('[data-pq-conf]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); cambia(a.dataset.pqConf, 'confermata', null); }));
  body.querySelectorAll('[data-pq-resp]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const nota = prompt('Perché la respingi? (una parola basta: resta scritta sulla firma)');
    if (nota === null) return;
    cambia(a.dataset.pqResp, 'respinta', nota);
  }));
  body.querySelectorAll('[data-pq-riap]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); cambia(a.dataset.pqRiap, 'ricevuta', null); }));

  body.querySelectorAll('[data-pq-tutte]').forEach((b) => b.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const gid = Number(btn.dataset.pqTutte);
    const ids = String(btn.dataset.pqIscritti || '').split(',').map(Number).filter(Boolean);
    attendi(btn, true);
    let tot = 0, err = null;
    for (const iid of ids) {
      const { data, error } = await sb.rpc('pres_conferma_allievo', { p_iscritto_id: iid, p_giornata_id: gid });
      if (error) { err = error.message; break; }
      tot += Number(data) || 0;
    }
    attendi(btn, false);
    if (err) toast('Conferma fermata: ' + err, 'err');
    else toast(`${tot} firme confermate.`, 'ok');
    ricarica();
  }));
}
