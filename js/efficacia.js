/* ══════════════════════════════════════════════════════════════════════════
   LA VERIFICA DI EFFICACIA DELLA FORMAZIONE                     (14/10/2026)
   Lotto 7 del fascicolo corso digitale.

   L'Accordo Stato-Regioni del 17/04/2025 mette in capo al DATORE DI LAVORO
   (con RSPP e preposto) la verifica di efficacia: a 6-12 mesi dal corso,
   guardare se quanto appreso è entrato nei comportamenti di lavoro. Non la
   fa l'ente, ma l'ente la RICORDA: per ogni corso dell'Accordo svolto, una
   riga per impresa dei partecipanti (s_corsi_efficacia, popolata ogni
   primo del mese da efficacia_genera), e nel cruscotto la tessera
   «📬 Verifiche di efficacia da ricordare» da cui la segreteria prepara la
   bozza .eml e segna «inviata». L'app prepara, la persona manda.
   ══════════════════════════════════════════════════════════════════════════ */
import { sb, esc, dataIt, oggiIso, toast } from './core.js';
import { scaricaEml } from './eml.js';

export async function datiEfficacia() {
  const { data, error } = await sb.from('s_corsi_efficacia')
    .select('*, corso:s_corsi(id, titolo, data_inizio, data_fine, durata_ore)')
    .is('inviata_il', null).order('da_mandare_dal').limit(200);
  if (error) return { daMandare: [], prossime: [], errore: error.message };
  const oggi = oggiIso();
  const righe = data || [];
  return { daMandare: righe.filter((r) => r.da_mandare_dal <= oggi), prossime: righe.filter((r) => r.da_mandare_dal > oggi), errore: null };
}

/* il testo della mail: letto dai dati del corso, niente scritto a mano */
export function testoEfficacia(r) {
  const c = r.corso || {};
  return [
    `Gentile ${r.impresa_txt || 'datore di lavoro'},`,
    '',
    `il ${dataIt(c.data_fine || c.data_inizio)} si è concluso il corso «${c.titolo || `n. ${c.id}`}»${c.durata_ore ? ` (${c.durata_ore} ore)` : ''}, frequentato da ${r.partecipanti === 1 ? 'un vostro lavoratore' : `${r.partecipanti} vostri lavoratori`}.`,
    '',
    "L'Accordo Stato-Regioni del 17 aprile 2025 pone in capo al datore di lavoro, con la collaborazione del RSPP e del preposto, la VERIFICA DI EFFICACIA della formazione: distinta dalla verifica finale di apprendimento, misura a distanza di tempo (fra 6 e 12 mesi dal corso) se quanto appreso è entrato nei comportamenti di lavoro e nella cultura della sicurezza in azienda, per esempio con l'osservazione in cantiere, un colloquio o una breve prova.",
    '',
    `Vi ricordiamo quindi di effettuare e documentare la verifica entro il ${dataIt(r.entro)}, conservandone l'esito insieme alla documentazione della formazione.`,
    '',
    'Restiamo a disposizione per ogni chiarimento e per un eventuale affiancamento in cantiere.',
    '',
    'Cordiali saluti.',
  ].join('\n');
}

export function cardEfficacia(card, e) {
  if (!e) return '';
  if (e.errore) return card('📬 Verifiche di efficacia da ricordare', 0, '', '', { k: 'efficacia', nonLetto: true });
  const riga = (r) => `
    <div class="hm-riga" style="cursor:default">
      <span>📬</span>
      <span><strong>${esc(r.impresa_txt || r.impresa_id || '—')}</strong> — ${esc(r.corso?.titolo || `corso n. ${r.corso_id}`)}<br>
        <span class="hint">${r.partecipanti} partecipant${r.partecipanti === 1 ? 'e' : 'i'} · corso finito il ${dataIt(r.corso?.data_fine)} · da ricordare dal ${dataIt(r.da_mandare_dal)}, entro il ${dataIt(r.entro)}${r.email ? '' : ' · <span style="color:#a01f00">senza indirizzo: cercalo in anagrafica</span>'}${r.bozza_preparata_il ? ` · bozza preparata il ${dataIt(r.bozza_preparata_il)}` : ''}</span></span>
      <span style="white-space:nowrap"><a href="#" data-ef-bozza="${r.id}">✉️ bozza</a> · <a href="#" data-ef-inviata="${r.id}">✓ inviata</a></span>
    </div>`;
  const corpo = e.daMandare.slice(0, 10).map(riga).join('') + (e.daMandare.length > 10 ? `<p class="hint">…e altre ${e.daMandare.length - 10}.</p>` : '');
  const azione = e.prossime.length ? `<p class="hint" style="margin-top:6px">${e.prossime.length} promemoria in programma nei prossimi mesi (il primo dal ${dataIt(e.prossime[0].da_mandare_dal)}).</p>` : '';
  return card('📬 Verifiche di efficacia da ricordare', e.daMandare.length, corpo || '<p class="hint">Nessun promemoria da mandare adesso.</p>', azione, { k: 'efficacia', sempre: e.prossime.length > 0 });
}

export function collegaEfficacia(host, ricarica, dati) {
  if (!host) return;
  const di = (id) => (dati?.daMandare || []).concat(dati?.prossime || []).find((r) => r.id === Number(id));
  host.querySelectorAll('[data-ef-bozza]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const r = di(a.dataset.efBozza); if (!r) return;
    const a2 = prompt('Indirizzo del datore di lavoro (la bozza si scarica, la mandi tu da Outlook):', r.email || '');
    if (a2 === null) return;
    if (!a2.trim()) return toast('Serve un indirizzo per la bozza.', 'err');
    scaricaEml({
      to: a2.trim(),
      oggetto: `Verifica di efficacia della formazione — ${r.corso?.titolo || `corso n. ${r.corso_id}`}`,
      corpo: testoEfficacia(r),
      nomeFile: `verifica-efficacia-corso-${r.corso_id}-${r.id}.eml`,
    });
    const { error } = await sb.rpc('efficacia_segna', { p_id: r.id, p_stato: 'preparata', p_note: null });
    if (error) toast('Bozza scaricata, ma non segnata: ' + error.message, 'err');
    else toast('Bozza scaricata: mandala da Outlook, poi «✓ inviata».', 'ok');
    if (!r.email || r.email !== a2.trim()) await sb.from('s_corsi_efficacia').update({ email: a2.trim() }).eq('id', r.id);
    ricarica();
  }));
  host.querySelectorAll('[data-ef-inviata]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const r = di(a.dataset.efInviata); if (!r) return;
    if (!confirm(`Segno inviato il promemoria della verifica di efficacia a ${r.impresa_txt || r.impresa_id || 'questa impresa'}?`)) return;
    const { error } = await sb.rpc('efficacia_segna', { p_id: r.id, p_stato: 'inviata', p_note: null });
    if (error) return toast(error.message, 'err');
    toast('Segnato inviato.', 'ok');
    ricarica();
  }));
}
