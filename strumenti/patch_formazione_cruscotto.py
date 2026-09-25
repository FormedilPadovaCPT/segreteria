# -*- coding: utf-8 -*-
"""25/09/2026 - Cruscotto della segreteria: la card «Formazione mancante segnalata
all'ufficio corsi» (con l'esito del contatto da registrare) e l'avviso
«aggiorna la programmazione corsi» quando il calendario sta per finire.
"""
import io
P = 'js/home.js'
s = io.open(P, encoding='utf-8', newline='').read(); NL = '\r\n' if '\r\n' in s else '\n'
def sost(v, n, nome):
    global s
    v = v.replace('\n', NL); n = n.replace('\n', NL)
    assert s.count(v) == 1, '%s: %d occorrenze' % (nome, s.count(v))
    s = s.replace(v, n)

# 1. lettura: segnalazioni aperte + stato della programmazione
sost("""  /* ── stato del canale del portale servizi (04/09/2026, rifatto il 13/09/2026) ──""",
"""  /* ── formazione mancante dai verbali (25/09/2026): le segnalazioni partite
     all'ufficio corsi di cui non si è ancora registrato l'esito, e lo stato
     del calendario corsi (se sta per finire, la segreteria deve importare la
     programmazione nuova: senza date la mail all'impresa non propone niente) ── */
  let formSegn = [], formStato = null, formErr = null;
  try {
    const [{ data: fs, error: e1 }, { data: st, error: e2 }] = await Promise.all([
      sb.from('s_formazione_segnalazioni').select('id, created_at, impresa_nome, partita_iva, ceiv, tipi, nota, stato, tecnico_nome, nr_verbale, email, telefono, referente, mail_esito').in('stato', ['inviata', 'contattata']).order('created_at', { ascending: false }).limit(40),
      sb.rpc('formazione_programmazione_stato'),
    ]);
    if (e1) formErr = e1.message; else formSegn = fs || [];
    if (!e2) formStato = st;
  } catch (e) { formErr = e?.message || String(e); }

  /* ── stato del canale del portale servizi (04/09/2026, rifatto il 13/09/2026) ──""", 'lettura')

# 2. il banner e la card, prima del cruscotto
sost("""  host.innerHTML = `
    ${bannerCanale}""", """  /* l'avviso sulla programmazione corsi: compare solo quando serve */
  const bannerFormazione = (() => {
    if (!formStato) return '';
    const giorni = Number(formStato.avviso_giorni || 45);
    const ultima = formStato.ultima_data ? new Date(formStato.ultima_data) : null;
    const limite = new Date(Date.now() + giorni * 864e5);
    if (ultima && ultima > limite && Number(formStato.edizioni_future || 0) > 0) return '';
    const testo = !ultima ? 'nel calendario corsi non c\\'è nessuna edizione'
      : ultima < new Date() ? `il calendario corsi è finito: l'ultima edizione era il ${dataIt(String(formStato.ultima_data))}`
      : `il calendario corsi finisce il ${dataIt(String(formStato.ultima_data))}, fra meno di ${giorni} giorni`;
    return `<div class="hm-banner" style="background:#fff3e0;border-left:4px solid #b35c00;padding:10px 14px;border-radius:8px;margin:0 0 12px;font-size:13px">
      <strong>🎓 Aggiorna la programmazione corsi:</strong> ${testo} (fonte «${esc(formStato.fonte || '—')}»). Senza date in calendario la mail del verbale non può proporre i corsi all'impresa. Chiedi all'ufficio corsi la programmazione nuova e importala con <code>_SISTEMA/scripts/importa_programmazione_corsi.py</code>.</div>`;
  })();
  const TIPI_ETI = { base: 'Base lavoratori', preposto: 'Preposto', primo_soccorso: 'Primo soccorso', antincendio: 'Antincendio', quota: 'Lavori in quota / DPI', ponteggi: 'Ponteggi', attrezzature: 'Macchine e attrezzature', confinati: 'Ambienti confinati', datore: 'Datore di lavoro / RSPP', rls: 'RLS' };
  const cardFormazione = card('🎓 Formazione mancante segnalata all\\'ufficio corsi', formSegn.length, formErr
    ? `<p class="hint" style="color:#a01f00">Non sono riuscito a leggere le segnalazioni: ${esc(formErr)}</p>`
    : (formSegn.length ? formSegn.slice(0, 8).map((r) => `
      <div class="hm-riga" data-fseg="${r.id}">
        <span>${r.stato === 'contattata' ? '📞' : '📨'}</span>
        <span><strong>${esc(r.impresa_nome || '?')}</strong>${r.ceiv === 'si' ? ' <span class="hm-mini">CEIV</span>' : r.ceiv === 'no' ? ' <span class="hm-mini" style="color:#a01f00">non CEIV</span>' : ''}
          <span class="hint" style="display:block;white-space:normal">${esc((r.tipi || []).map((t) => TIPI_ETI[t] || t).join(', ') || '—')}${r.nota ? ` · «${esc(String(r.nota).slice(0, 80))}${String(r.nota).length > 80 ? '…' : ''}»` : ''}<br>${r.nr_verbale ? `verbale ${esc(r.nr_verbale)} · ` : ''}${esc(r.tecnico_nome || '')}${r.email ? ` · ${esc(r.email)}` : ''}${r.telefono ? ` · ${esc(r.telefono)}` : ''}</span></span>
        <span class="hint" style="text-align:right">${dataIt(String(r.created_at).slice(0, 10))}<br>
          <select data-fseg-stato="${r.id}" style="font-size:11px;padding:2px 4px" title="Registra com'è andata: lo dice l'ufficio corsi, tu lo scrivi qui">
            <option value="inviata" ${r.stato === 'inviata' ? 'selected' : ''}>inviata</option><option value="contattata" ${r.stato === 'contattata' ? 'selected' : ''}>contattata</option>
            <option value="iscritta">iscritta</option><option value="non_interessata">non interessata</option><option value="chiusa">chiusa</option></select></span>
      </div>`).join('') + (formSegn.length > 8 ? `<p class="hint">…e altre ${formSegn.length - 8}.</p>` : '')
      + '<p class="hint" style="margin-top:6px">Partono da sole quando il tecnico manda un verbale con «contattare l\\'ufficio corsi». L\\'ufficio corsi (corsi@formedilpadova.it) chiama l\\'impresa: l\\'esito lo registri tu dalla tendina, così fra tre mesi si sa che cosa ne è uscito.</p>'
      : '<p class="hint">Nessuna segnalazione in attesa di esito.</p>'));

  host.innerHTML = `
    ${bannerCanale}${bannerFormazione}""", 'banner e card')

# 3. la card nel cruscotto, sotto i cantieri critici
sost("""      ${card('🚧 Cantieri critici', critici.length,""", """      ${cardFormazione}

      ${card('🚧 Cantieri critici', critici.length,""", 'posizione card')

# 4. il gestore della tendina
sost("""  $('#hm-respinte-cerca')?.addEventListener('click', async (ev) => {""", """  /* formazione: l'esito del contatto (25/09/2026) */
  host.querySelectorAll('[data-fseg-stato]').forEach((sel) => sel.addEventListener('change', async () => {
    const id = Number(sel.dataset.fsegStato);
    const nuovo = sel.value;
    const nota = ['iscritta', 'non_interessata', 'chiusa'].includes(nuovo) ? prompt('Due parole sull\\'esito (facoltative):') : null;
    if (nota === null && ['iscritta', 'non_interessata', 'chiusa'].includes(nuovo)) { render(); return; }
    const { error } = await sb.from('s_formazione_segnalazioni').update({ stato: nuovo, esito_note: nota || null }).eq('id', id);
    if (error) { toast('Esito non registrato: ' + error.message, 'err'); return; }
    toast('Esito registrato.', 'ok'); render();
  }));

  $('#hm-respinte-cerca')?.addEventListener('click', async (ev) => {""", 'gestore')

io.open(P, 'w', encoding='utf-8', newline='').write(s); print('home.js ok')

# aiuto
P2 = 'js/aiuto.js'; a = io.open(P2, encoding='utf-8', newline='').read(); N2 = '\r\n' if '\r\n' in a else '\n'
v = "  'cn-gira':"
assert a.count(v) == 1
a = a.replace(v, "  'p:🎓 formazione mancante segnalata': 'Le segnalazioni partite da sole all\\'ufficio corsi dai verbali con «contattare l\\'ufficio corsi». Dalla tendina registri com\\'è andata (contattata, iscritta, non interessata).',\n".replace('\n', N2) + v)
io.open(P2, 'w', encoding='utf-8', newline='').write(a); print('aiuto ok')
