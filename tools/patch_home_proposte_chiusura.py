# -*- coding: utf-8 -*-
"""23/09/2026 - Scrivania: le proposte di chiusura dei cantieri fatte dai tecnici.

Chiesto dall'utente: «le proposte di chiusura dovranno arrivare alla
segreteria che deve gestirle». Nel gestionale le vede gia' l'account della
segreteria in Dashboard; qui arrivano dove la segreteria lavora ogni giorno,
e si gestiscono dalla card: chiudere (chiudi_cantiere, la proposta diventa
accolta da sola) o respingere scrivendo perche'.
"""
import io

CRLF = chr(13) + chr(10)
LF = chr(10)
P = 'js/home.js'
src = io.open(P, encoding='utf-8', newline='').read()
NL = CRLF if CRLF in src else LF

def sost(vecchio, nuovo, nome):
    global src
    vecchio = vecchio.replace(LF, NL); nuovo = nuovo.replace(LF, NL)
    c = src.count(vecchio)
    assert c == 1, '%s: trovate %d occorrenze' % (nome, c)
    src = src.replace(vecchio, nuovo)

# 1. lettura
sost("""  /* la card «Posta e agenda»: gli eventi raggruppati per giorno, poi le mail""",
     """  /* ── proposte di chiusura dei cantieri (23/09/2026) ──
     Il tecnico le fa dal gestionale; decide la segreteria. Un errore di
     lettura non è «nessuna proposta»: si dice nella card. */
  let propChius = [], propChiusErr = null;
  try {
    const { data, error } = await sb.from('cantieri_proposte_chiusura')
      .select('id, cantiere_id, proposta_da, proposta_nome, proposta_il, motivo, cantieri(cantiere_etichetta, cantiere_indirizzo, cantiere_civico, comune_nome)')
      .is('esito', null).order('proposta_il').limit(200);
    if (error) propChiusErr = error.message;
    propChius = data || [];
  } catch (e) { propChiusErr = e.message || String(e); }
  const lblCant = (p) => {
    const c = p.cantieri || {};
    return c.cantiere_etichetta || `${c.cantiere_indirizzo || ''} ${c.cantiere_civico || ''}`.trim() || p.cantiere_id;
  };

  /* la card «Posta e agenda»: gli eventi raggruppati per giorno, poi le mail""", 'lettura')

# 2. card dopo gli incarichi rifiutati
sost("""          : '<p class="hint">Nessun incarico rifiutato.</p>')}
""", """          : '<p class="hint">Nessun incarico rifiutato.</p>')}

      ${card('📨 Cantieri proposti per la chiusura', propChius.length,
        propChiusErr
          ? `<p class="hint" style="color:#b91c1c">Non sono riuscito a leggere le proposte: ${esc(propChiusErr)}</p>`
          : propChius.length
            ? propChius.slice(0, 8).map((p) => `<div class="hm-riga">
                <span>📨</span>
                <span><strong>${esc(lblCant(p))}</strong>${p.cantieri?.comune_nome ? ` <span class="hint">· ${esc(p.cantieri.comune_nome)}</span>` : ''}
                  <span class="hint">(${esc(p.proposta_nome || p.proposta_da || '')}, ${dataIt(String(p.proposta_il).slice(0, 10))})</span>
                  <br><span class="hint">«${esc(p.motivo || '')}»</span></span>
                <span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                  <button class="btn btn-sm" data-pc-chiudi="${p.id}">🔒 Chiudi cantiere</button>
                  <button class="btn btn-ghost btn-sm" data-pc-respingi="${p.id}">✖ Respingi</button></span>
              </div>`).join('') + (propChius.length > 8 ? `<p class="hint">…e altre ${propChius.length - 8}.</p>` : '')
              + '<p class="hint" style="margin-top:6px">Il tecnico dice che il cantiere è finito. Chiudendolo si chiudono anche le sue visite ed esce dalle scadenze; respingendo, il motivo resta scritto per chi l\\'ha proposto.</p>'
            : '<p class="hint">Nessuna proposta da decidere.</p>')}
""", 'card')

# 3. azioni
sost("""  host.querySelectorAll('.hm-riga[data-vista]').forEach((r) =>""",
     """  host.querySelectorAll('[data-pc-chiudi]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const p = propChius.find((x) => x.id === Number(b.dataset.pcChiudi));
    if (!p) return;
    if (!confirm(`Chiudere il cantiere «${lblCant(p)}» per fine lavori?\\nTutte le visite collegate verranno chiuse.\\n\\nProposta di ${p.proposta_nome || p.proposta_da}: «${p.motivo}»`)) return;
    const note = prompt('Note sulla chiusura (facoltative). Annulla per interrompere.', p.motivo || '');
    if (note === null) return;
    const { data, error } = await sb.rpc('chiudi_cantiere', { p_cantiere_id: p.cantiere_id, p_motivo: 'termini_lavori', p_note: note.trim() || null });
    if (error) return toast('Chiusura non riuscita: ' + error.message, 'err');
    toast(`Cantiere chiuso · ${(data && data.visite_chiuse) || 0} visite chiuse. La proposta risulta accolta.`, 'ok');
    render();
  }));
  host.querySelectorAll('[data-pc-respingi]').forEach((b) => b.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const p = propChius.find((x) => x.id === Number(b.dataset.pcRespingi));
    if (!p) return;
    const note = prompt(`Respingere la proposta di chiusura di «${lblCant(p)}»?\\n\\nPerché il cantiere resta aperto? (lo legge chi l'ha proposta)`);
    if (note === null) return;
    if (!note.trim()) return toast('Scrivi il motivo: è la risposta per chi ha proposto.', 'err');
    const { error } = await sb.rpc('respingi_proposta_chiusura', { p_id: p.id, p_note: note.trim() });
    if (error) return toast('Non riuscito: ' + error.message, 'err');
    toast('Proposta respinta: il cantiere resta aperto.', 'ok');
    render();
  }));

  host.querySelectorAll('.hm-riga[data-vista]').forEach((r) =>""", 'azioni')

io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('home.js aggiornato')
