# -*- coding: utf-8 -*-
"""25/09/2026 - Consulenze, corsia immediata: il quesito si gira A CHI SI SCEGLIE.

Chiesto dall'utente: il coordinatore ha ricevuto il quesito n. 2 (Cardin) e
chiede di sottoporlo a Balladore e aspettare la risposta da lui. Prima il
pulsante mandava solo al coordinatore. Ora una tendina: coordinatore (primo),
tecnici attivi, rubrica interna, oppure un altro indirizzo; la pratica dice a
chi e' stata girata e da quando, e si puo' girare di nuovo.
"""
import io, re

def leggi(p): return io.open(p, encoding='utf-8', newline='').read()
def scrivi(p, s): io.open(p, 'w', encoding='utf-8', newline='').write(s)

P = 'js/consulenze.js'
s = leggi(P); NL = '\r\n' if '\r\n' in s else '\n'
def sost(v, n, nome, quante=1):
    global s
    v = v.replace('\n', NL); n = n.replace('\n', NL)
    c = s.count(v); assert c == quante, '%s: %d occorrenze (attese %d)' % (nome, c, quante)
    s = s.replace(v, n)

# 1. etichetta dello stato
sost("ricevuta: 'Ricevuta', girata: 'Dal coordinatore', risposta_pronta: 'Risposta pronta',",
     "ricevuta: 'Ricevuta', girata: 'Girata, in attesa di risposta', risposta_pronta: 'Risposta pronta',", 'STATI')

# 2. il nome di chi ha in mano il quesito
sost("""const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;
""", """const coordinatore = () => RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome)) || null;

/* a chi si puo' girare un quesito (25/09/2026): il coordinatore per primo, poi i
   tecnici in servizio, poi la rubrica interna; il nome di chi ce l'ha in mano */
function destinatariQuesito() {
  const c = coordinatore();
  const out = [];
  const visti = new Set();
  const aggiungi = (email, nome) => { const e = (email || '').toLowerCase(); if (!e || visti.has(e)) return; visti.add(e); out.push({ email, nome }); };
  if (c) aggiungi(c.email, c.nome);
  tecnici.slice().sort((a, b) => (a.tecnico_cognome || '').localeCompare(b.tecnico_cognome || '')).forEach((t) => aggiungi(t.email, nomeTecnico(t.email)));
  RUBRICA_INTERNA.forEach((r) => { if (!/segreteria/i.test(r.nome)) aggiungi(r.email, r.nome); });
  return out;
}
const nomeGirata = (email) => {
  if (!email) return '';
  const d = destinatariQuesito().find((x) => x.email.toLowerCase() === email.toLowerCase());
  return d ? d.nome : email;
};
""", 'destinatari')

# 3. nel riquadro: a chi e' girata
sost("""        ? `girato al coordinatore${p.girata_il ? ` il ${dataIt(p.girata_il.slice(0, 10))}` : ''} — in attesa di risposta`""",
     """        ? `girato a <strong>${esc(nomeGirata(p.girata_a) || 'coordinatore')}</strong>${p.girata_il ? ` il ${dataIt(p.girata_il.slice(0, 10))}` : ''} — in attesa di risposta`""", 'quadro')

# 4. contatore e filtro dell'elenco
sost("""📨 ${dalCoord.length} dal coordinatore</span>""", """📨 ${dalCoord.length} girate, in attesa di risposta</span>""", 'contatore')
sost("""['coordinatore', '📨 Dal coordinatore']""", """['coordinatore', '📨 Girate']""", 'filtro')
sost("""      <td>${esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;""", """      <td>${p.stato === 'girata' && p.girata_a ? `Girata a ${esc(nomeGirata(p.girata_a).split(' — ')[0])}` : esc(STATI[p.stato] || p.stato)}</td>
    </tr>`;""", 'cella stato')

# 5. la maschera: tendina + pulsante
sost("""    <h4 style="margin:0 0 6px">Il giro del quesito</h4>
    <p class="hint" style="margin:0 0 10px">Quesito tecnico → coordinatore; la risposta la trasmette la segreteria.
      Se invece serve un sopralluogo, si passa alla corsia con autorizzazione.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost" id="cn-gira">📧 Gira il quesito al coordinatore</button>""",
     """    <h4 style="margin:0 0 6px">Il giro del quesito</h4>
    <p class="hint" style="margin:0 0 10px">Quesito tecnico → a chi lo scegli (di norma il coordinatore; può chiedere di girarlo a un altro tecnico); la risposta la trasmette la segreteria.
      Se invece serve un sopralluogo, si passa alla corsia con autorizzazione.</p>
    ${p.stato === 'girata' && p.girata_a ? `<p class="hint" style="margin:0 0 8px">Adesso è in mano a <strong>${esc(nomeGirata(p.girata_a))}</strong>${p.girata_il ? ` dal ${dataIt(p.girata_il.slice(0, 10))}` : ''}: girandolo a un altro, la pratica passa a lui e la data riparte.</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="cn-gira-a" style="max-width:320px">${destinatariQuesito().map((d) =>
        `<option value="${esc(d.email)}" ${(p.girata_a || coord?.email || '').toLowerCase() === d.email.toLowerCase() ? 'selected' : ''}>${esc(d.nome)}</option>`).join('')}<option value="__altro">Altro indirizzo…</option></select>
      <button class="btn btn-ghost" id="cn-gira">📧 Gira il quesito</button>""", 'maschera')

# 6. il gestore
sost("""  $('#cn-gira')?.addEventListener('click', async () => {
    const quesito = $('#cn-quesito').value.trim() || p.quesito;
    if (!quesito) return toast('Scrivi prima il quesito.', 'err');
    if (!coord) return toast('Coordinatore non trovato nella rubrica interna.', 'err');
    scaricaEml({
      to: coord.email,
      oggetto: `Formedil Padova - Quesito tecnico da ${p.ragione_sociale || 'impresa'} - consulenza n. ${p.progressivo ?? `m${p.id}`}`,
      corpo: `Ciao,

quesito tecnico arrivato ${p.fonte === 'modulo' ? 'dal modulo online' : `per ${p.fonte}`} da ${p.ragione_sociale || '?'}${p.partita_iva ? ` (P.IVA ${p.partita_iva})` : ''}:

${quesito}

>>> Apri la pratica (qui si riporta la risposta al quesito):
${APP_URL}#consulenza-${p.id}

Grazie.

${FIRMA_SEGRETERIA}`,
      nomeFile: `quesito-consulenza-${p.progressivo ?? `m${p.id}`}.eml`,
    });
    await sb.from('s_consulenze').update({
      stato: 'girata', girata_a: coord.email, girata_il: new Date().toISOString(),
      quesito, aggiornato_da: state.email, updated_at: new Date().toISOString(),
    }).eq('id', p.id);
    toast('Bozza per il coordinatore scaricata: aprila da Outlook e premi Invia.', 'ok');
    await render();
  });""",
     """  $('#cn-gira')?.addEventListener('click', async () => {
    const quesito = $('#cn-quesito').value.trim() || p.quesito;
    if (!quesito) return toast('Scrivi prima il quesito.', 'err');
    /* a chi: dalla tendina (25/09/2026), oppure un indirizzo scritto a mano */
    let email = $('#cn-gira-a')?.value || coord?.email || '';
    let nome = nomeGirata(email);
    if (email === '__altro') {
      email = (prompt('Indirizzo e-mail a cui girare il quesito:') || '').trim();
      if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return toast('Indirizzo non valido.', 'err');
      nome = email;
    }
    if (!email) return toast('Scegli a chi girare il quesito.', 'err');
    const precedente = p.stato === 'girata' && p.girata_a && p.girata_a.toLowerCase() !== email.toLowerCase() ? nomeGirata(p.girata_a) : null;
    const eTecnico = tecnici.some((t) => (t.email || '').toLowerCase() === email.toLowerCase());
    scaricaEml({
      to: email,
      cc: precedente && coord && coord.email.toLowerCase() !== email.toLowerCase() ? [coord.email] : [],
      oggetto: `Formedil Padova - Quesito tecnico da ${p.ragione_sociale || 'impresa'} - consulenza n. ${p.progressivo ?? `m${p.id}`}`,
      corpo: `${eTecnico ? 'Ciao' : 'Buongiorno'},

${precedente ? `su indicazione di ${precedente}, ti giro il` : 'quesito tecnico arrivato'} ${p.fonte === 'modulo' ? 'dal modulo online' : `per ${p.fonte}`} da ${p.ragione_sociale || '?'}${p.partita_iva ? ` (P.IVA ${p.partita_iva})` : ''}:

${quesito}

Ti chiedo una risposta scritta, rispondendo a questa mail${eTecnico ? ` oppure riportandola nella pratica:
${APP_URL}#consulenza-${p.id}` : ''}: la trasmette la segreteria all'impresa.

Grazie.

${FIRMA_SEGRETERIA}`,
      nomeFile: `quesito-consulenza-${p.progressivo ?? `m${p.id}`}.eml`,
    });
    const nota = precedente ? `${new Date().toLocaleDateString('it-IT')}: quesito girato a ${nome} su indicazione di ${precedente}.` : null;
    await sb.from('s_consulenze').update({
      stato: 'girata', girata_a: email, girata_il: new Date().toISOString(),
      quesito, aggiornato_da: state.email, updated_at: new Date().toISOString(),
      ...(nota ? { note_ufficio: [p.note_ufficio, nota].filter(Boolean).join('\\n') } : {}),
    }).eq('id', p.id);
    toast(`Bozza per ${nome} scaricata: aprila da Outlook e premi Invia.`, 'ok');
    await render();
  });""", 'gestore')
scrivi(P, s); print('consulenze.js ok')

# 7. aiuto
P = 'js/aiuto.js'; a = leggi(P)
v = "'cn-gira': 'Manda il quesito al coordinatore, che risponde dal gestionale.',"
assert a.count(v) == 1
a = a.replace(v, "'cn-gira': 'Prepara la mail con il quesito per chi hai scelto nella tendina (di norma il coordinatore; un altro tecnico se lui lo chiede). La pratica passa «girata» a quella persona e la data riparte.',\n  'cn-gira-a': 'A chi girare il quesito: coordinatore, tecnici in servizio, rubrica interna o un altro indirizzo.',".replace('\n', '\r\n' if '\r\n' in a else '\n'))
scrivi(P, a); print('aiuto.js ok')
