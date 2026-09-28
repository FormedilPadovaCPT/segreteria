/* ============================================================
   PROMEMORIA DELLE LEZIONI E MATERIALI DEL CORSO — la parte che si
   vede nella scheda del corso (28/09/2026, chiesto dall'utente).

   · Promemoria: N giorni prima di OGNI lezione parte da solo una mail
     agli iscritti (funzione promemoria-corsi, giro del mattino). Qui si
     impostano i giorni, si vede che cosa è partito e a chi no, si
     guarda l'anteprima e — se serve — si manda subito.
   · Materiali: i link da condividere con chi ha partecipato. Finiscono
     nella bozza degli attestati, con la data entro cui scaricarli.

   ⚠️ Il promemoria è una mail che parte DA SOLA (quarta eccezione
   dichiarata alla regola «l'app prepara, la persona manda»): per
   questo la scheda dice sempre chi NON l'ha ricevuto. I materiali
   invece viaggiano nella bozza che manda la segreteria.

   Le regole e i testi stanno in corsi-promemoria-testo.js, che è puro
   e si prova con `node --test`.
   ============================================================ */

import { sb, state, $, esc, dataIt, oggiIso, toast, attendi } from './core.js';
import { sfoglia, idDaLink } from './drive.js';
import { corsoRicorda, partenza, giorniFra, materialiValidi, GIORNI_PREDEFINITI } from './corsi-promemoria-testo.js';

/* ── i dati: il quaderno dei promemoria di questo corso ──
   Se la lettura fallisce lo si dice: «nessun promemoria partito» e
   «non sono riuscito a leggere» non sono la stessa cosa. */
export async function datiProm(c) {
  const { data, error } = await sb.from('s_corsi_promemoria')
    .select('giornata_id, iscritto_id, data_lezione, email, inviato_il, esito').eq('corso_id', c.id);
  return { righe: data || [], nonLetto: error ? error.message : null };
}

const statoLezione = (g, righe, nomeDi) => {
  const rr = righe.filter((r) => r.giornata_id === g.id && String(r.data_lezione) === String(g.data));
  if (!rr.length) return '';
  const inviati = rr.filter((r) => r.inviato_il).length;
  const senza = rr.filter((r) => !r.inviato_il && r.esito === 'senza indirizzo');
  const falliti = rr.filter((r) => !r.inviato_il && r.esito && r.esito !== 'senza indirizzo');
  return [
    inviati ? `<span class="dt-cella dt-ok" style="padding:1px 6px">✓ ${inviati} ${inviati === 1 ? 'avvisato' : 'avvisati'}</span>` : '',
    falliti.length ? `<span class="dt-cella dt-scaduto" style="padding:1px 6px" title="${esc(falliti.map((r) => `${nomeDi[r.iscritto_id] || '?'}: ${r.esito}`).join(' · '))}">⚠ ${falliti.length} non ${falliti.length === 1 ? 'partito' : 'partiti'}</span>` : '',
    senza.length ? `<span class="dt-cella dt-senzadata" style="padding:1px 6px" title="Non hanno nessun indirizzo: vanno avvisati a mano">✉ senza indirizzo: ${esc(senza.map((r) => nomeDi[r.iscritto_id] || '?').join(', '))}</span>` : '',
  ].filter(Boolean).join(' ');
};

/* ── la sezione «Promemoria delle lezioni» ── */
export function sezioneProm(c, giornate, iscritti, dati) {
  const oggi = oggiIso();
  const giorni = c.promemoria_giorni;
  const acceso = Number.isInteger(Number(giorni)) && Number(giorni) >= 1;
  const nomeDi = Object.fromEntries((iscritti || []).map((i) => [i.id, i.nominativo]));
  const future = (giornate || []).filter((g) => g.data && giorniFra(oggi, g.data) >= 0);

  const righe = future.map((g) => {
    const mancano = giorniFra(oggi, g.data);
    const quando = !acceso ? '—'
      : mancano === 0 ? 'oggi è il giorno della lezione'
      : partenza(g, giorni) <= oggi ? 'al prossimo giro del mattino'
      : dataIt(partenza(g, giorni));
    return `<tr>
      <td>${dataIt(g.data)}</td>
      <td>${esc(quando)}</td>
      <td>${dati.nonLetto ? '<span class="hint">non letto</span>' : (statoLezione(g, dati.righe, nomeDi) || '<span class="hint">non ancora partito</span>')}</td>
      <td style="white-space:nowrap">${c.stato === 'aperto' && (iscritti || []).length
        ? `<a href="#" data-prom-ora="${g.id}" data-prom-data="${esc(dataIt(g.data))}">📨 manda adesso</a>` : ''}</td>
    </tr>`;
  }).join('');

  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">🔔 Promemoria delle lezioni</h4>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
      <div class="field" style="margin:0;width:150px"><label>Giorni prima</label>
        <input id="pm-giorni" type="number" min="1" max="30" placeholder="nessun promemoria" value="${acceso ? Number(giorni) : ''}"></div>
      <button class="btn btn-ghost btn-sm" id="pm-salva" style="margin-bottom:2px">Salva</button>
      <button class="btn btn-ghost btn-sm" id="pm-anteprima" style="margin-bottom:2px">👁 Anteprima</button>
    </div>
    <p class="hint" style="margin:6px 0">${acceso
      ? `Agli iscritti parte <strong>da sola</strong> una mail <strong>${Number(giorni)} ${Number(giorni) === 1 ? 'giorno' : 'giorni'} prima di ogni lezione</strong>, al mattino: una per indirizzo, con data, orario e sede. Campo vuoto = nessun promemoria.`
      : 'Nessun promemoria impostato: scrivi quanti giorni prima di ogni lezione deve partire, e salva.'}
      ${acceso && !corsoRicorda(c) ? ' <strong>Parte solo per i corsi in stato «Aperto»</strong>: questo non lo è.' : ''}</p>
    ${dati.nonLetto ? `<p class="hint" style="color:#a01f00">Non sono riuscito a leggere i promemoria già partiti (${esc(dati.nonLetto)}): non vuol dire che non ne siano partiti.</p>` : ''}
    ${future.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Lezione</th><th>Il promemoria parte</th><th>Com'è andata</th><th></th></tr></thead>
      <tbody>${righe}</tbody></table></div>` : '<p class="hint">Nessuna lezione in calendario da oggi in poi.</p>'}
    <div id="pm-anteprima-host"></div>`;
}

/* ── la sezione «Materiali da condividere» ── */
export function sezioneMateriali(c) {
  const mm = materialiValidi(c.materiali);
  return `
    <hr style="margin:12px 0;border:0;border-top:1px solid var(--bordo)">
    <h4 style="margin:0 0 6px">📎 Materiali da condividere con chi ha partecipato</h4>
    ${mm.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Titolo</th><th>Link</th><th></th></tr></thead>
      <tbody>${mm.map((m, n) => `<tr>
        <td><strong>${esc(m.titolo)}</strong></td>
        <td style="word-break:break-all"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a></td>
        <td><a href="#" data-mat-togli="${n}">togli</a></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint" style="margin:0 0 6px">Nessun materiale. Quelli che aggiungi finiscono nella mail degli attestati.</p>'}
    <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:end;margin-top:8px">
      <div class="field" style="margin:0"><label>Titolo</label><input id="mat-titolo" placeholder="es. Slide del corso"></div>
      <div class="field" style="margin:0"><label>Link</label><input id="mat-url" placeholder="https://… (anche un link di Drive)"></div>
      <button class="btn btn-ghost btn-sm" id="mat-aggiungi" style="margin-bottom:2px">+ Aggiungi</button>
    </div>
    <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:8px">
      <div class="field" style="margin:0;flex:1;min-width:220px"><label>Oppure cercalo su Drive per nome</label>
        <input id="mat-cerca" placeholder="una parola del nome del file"></div>
      <button class="btn btn-ghost btn-sm" id="mat-cerca-btn" style="margin-bottom:2px">📁 Cerca su Drive</button>
      <div class="field" style="margin:0;width:170px"><label>Disponibili fino al</label>
        <input id="mat-fino" type="date" value="${esc(c.materiali_fino_al || '')}"></div>
    </div>
    <div id="mat-trovati"></div>
    <p class="hint" style="margin-top:6px">La mail degli attestati elenca questi link e invita a <strong>scaricarli il prima possibile</strong>${c.materiali_fino_al ? `, dicendo che restano a disposizione fino al ${dataIt(c.materiali_fino_al)}` : ''}.
      La data è un invito: <strong>l'app non toglie l'accesso ai file</strong>, a scadenza li togli tu.
      Perché chi riceve possa aprirli, i file su Drive devono essere condivisi con «chiunque abbia il link»: l'app non cambia la condivisione.</p>`;
}

/* ── eventi ── */
export function collegaProm(c, giornate, ricarica) {
  const salva = async (dati, messaggio) => {
    const { error } = await sb.from('s_corsi')
      .update({ ...dati, aggiornato_da: state.email, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { toast('Non salvato: ' + error.message, 'err'); return false; }
    Object.assign(c, dati);   // la scheda rilegge da questa riga
    toast(messaggio, 'ok');
    return true;
  };

  /* ── promemoria ── */
  $('#pm-salva')?.addEventListener('click', async (ev) => {
    const t = $('#pm-giorni').value.trim();
    const n = t === '' ? null : Number(t);
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 30)) return toast('I giorni vanno da 1 a 30; vuoto = nessun promemoria.', 'err');
    const btn = ev.currentTarget;   // dopo un await currentTarget è vuoto
    attendi(btn, true);
    const ok = await salva({ promemoria_giorni: n },
      n ? `Promemoria ${n} ${n === 1 ? 'giorno' : 'giorni'} prima di ogni lezione.` : 'Promemoria spento per questo corso.');
    attendi(btn, false);
    if (ok) ricarica();
  });

  $('#pm-anteprima')?.addEventListener('click', async (ev) => {
    const host = $('#pm-anteprima-host');
    const btn = ev.currentTarget;
    attendi(btn, true, 'Un istante…');
    try {
      const { data, error } = await sb.functions.invoke('promemoria-corsi', { body: { prova: true, corso_id: c.id } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const l = (data?.lezioni || [])[0];
      if (!l) {
        host.innerHTML = `<p class="hint" style="margin-top:8px">Niente da mostrare: ${c.stato !== 'aperto' ? 'il corso non è in stato «Aperto»'
          : !c.promemoria_giorni ? 'il promemoria non è impostato (salva i giorni)' : 'non ci sono lezioni da domani in poi'}.</p>`;
        return;
      }
      host.innerHTML = `
        <div class="dt-doc-riga" style="margin-top:8px">
          <strong>Promemoria della lezione del ${dataIt(l.data)}</strong> — è una prova: non è partito niente.
          ${l.gia_avvisati ? `<br><span class="hint">${l.gia_avvisati} già avvisati per questa lezione: non lo ricevono di nuovo.</span>` : ''}
          ${(l.senza_indirizzo || []).length ? `<br><span style="color:#a01f00">Senza indirizzo, da avvisare a mano: ${esc(l.senza_indirizzo.join(', '))}</span>` : ''}
          ${(l.anteprima || []).length ? '' : '<br><span class="hint">Nessuna mail da mandare.</span>'}
        </div>
        ${(l.anteprima || []).map((a) => `
          <div class="dt-doc-riga" style="margin-top:6px">
            <span class="hint">A:</span> <strong>${esc(a.a)}</strong> <span class="hint">(${esc((a.partecipanti || []).join(', '))})</span><br>
            <span class="hint">Oggetto:</span> ${esc(a.oggetto)}
            <pre style="white-space:pre-wrap;font:inherit;margin:6px 0 0;padding:8px;background:var(--sfondo,#f7f8fa);border-radius:6px">${esc(a.corpo)}</pre>
          </div>`).join('')}`;
    } catch (e) {
      host.innerHTML = `<p class="hint" style="margin-top:8px;color:#a01f00">Anteprima non riuscita: ${esc(e.message)}</p>`;
    } finally { attendi(btn, false); }
  });

  $('#drawer-body').querySelectorAll('[data-prom-ora]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm(`Mando ADESSO il promemoria della lezione del ${a.dataset.promData} a tutti gli iscritti che non l'hanno ancora ricevuto?\n\nLe mail partono subito dall'ufficio: non è una bozza.`)) return;
    a.textContent = 'Invio…';
    try {
      const { data, error } = await sb.functions.invoke('promemoria-corsi', { body: { giornata_id: Number(a.dataset.promOra) } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const l = (data?.lezioni || [])[0] || {};
      const pezzi = [
        `${data.inviate} ${data.inviate === 1 ? 'promemoria partito' : 'promemoria partiti'}`,
        data.non_inviate ? `${data.non_inviate} NON partiti` : '',
        (l.senza_indirizzo || []).length ? `senza indirizzo: ${l.senza_indirizzo.join(', ')}` : '',
        data.gia_avvisati ? `${data.gia_avvisati} già avvisati` : '',
      ].filter(Boolean);
      toast(pezzi.join(' · '), (data.non_inviate || (l.errori || []).length) ? 'err' : 'ok');
    } catch (err) { toast('Promemoria non partito: ' + err.message, 'err'); }
    ricarica();
  }));

  /* ── materiali ── */
  const aggiungi = async (titolo, url) => {
    const t = String(titolo || '').trim(); const u = String(url || '').trim();
    if (!t) return toast('Serve un titolo: è quello che legge chi riceve la mail.', 'err');
    if (!/^https?:\/\/\S+$/i.test(u)) return toast('Il link deve cominciare con http:// o https://', 'err');
    const mm = materialiValidi(c.materiali);
    if (mm.some((m) => m.url === u)) return toast('Questo link c\'è già.', 'err');
    if (await salva({ materiali: [...mm, { titolo: t, url: u }] }, 'Materiale aggiunto.')) ricarica();
  };

  $('#mat-aggiungi')?.addEventListener('click', () => aggiungi($('#mat-titolo').value, $('#mat-url').value));
  $('#mat-url')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mat-aggiungi').click(); });

  $('#drawer-body').querySelectorAll('[data-mat-togli]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const mm = materialiValidi(c.materiali);
    mm.splice(Number(a.dataset.matTogli), 1);
    if (await salva({ materiali: mm }, 'Materiale tolto dall\'elenco (il file resta dov\'è).')) ricarica();
  }));

  $('#mat-fino')?.addEventListener('change', async (e) => {
    const v = e.target.value || null;
    if (await salva({ materiali_fino_al: v }, v ? `Disponibili fino al ${dataIt(v)}.` : 'Data tolta.')) ricarica();
  });

  const cerca = async () => {
    const q = $('#mat-cerca').value.trim();
    const host = $('#mat-trovati');
    /* chi incolla un link di Drive nella ricerca voleva aggiungerlo */
    if (/^https?:\/\//i.test(q) && idDaLink(q)) { $('#mat-url').value = q; $('#mat-titolo').focus(); return toast('È un link: dagli un titolo e premi «Aggiungi».', 'ok'); }
    if (q.length < 3) return toast('Scrivi almeno tre lettere del nome del file.', 'err');
    const btn = $('#mat-cerca-btn');
    attendi(btn, true, 'Cerco…');
    try {
      const { voci } = await sfoglia({ cerca: q });
      const file = (voci || []).filter((v) => !v.cartella).slice(0, 30);
      host.innerHTML = file.length
        ? `<div class="dt-doc-riga" style="margin-top:8px">${file.map((f) => `
            <div style="display:flex;gap:8px;align-items:baseline;padding:2px 0">
              <a href="#" data-mat-drive="${esc(f.id)}" data-mat-nome="${esc(f.nome)}">+ aggiungi</a>
              <span style="flex:1;word-break:break-all">${esc(f.nome)}</span>
              <span class="hint">${f.modificato ? dataIt(String(f.modificato).slice(0, 10)) : ''}</span>
            </div>`).join('')}</div>`
        : '<p class="hint" style="margin-top:8px">Nessun file con questo nome su Drive.</p>';
      host.querySelectorAll('[data-mat-drive]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        const titolo = prompt('Titolo che leggerà chi riceve la mail:', a.dataset.matNome.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' '));
        if (titolo == null) return;
        aggiungi(titolo, `https://drive.google.com/file/d/${a.dataset.matDrive}/view`);
      }));
    } catch (e) {
      host.innerHTML = `<p class="hint" style="margin-top:8px;color:#a01f00">Non sono riuscito a cercare su Drive: ${esc(e.message)}</p>`;
    } finally { attendi(btn, false); }
  };
  $('#mat-cerca-btn')?.addEventListener('click', cerca);
  $('#mat-cerca')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') cerca(); });
}

export { GIORNI_PREDEFINITI };
