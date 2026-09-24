/* ============================================================
   L'INCARICO AL TECNICO nel gestionale visite (tabella `incarichi`,
   quella della scheda «Incarichi assegnati» coi messaggi).

   Flusso deciso dall'utente il 01/09/2026: quando una pratica dei
   servizi viene AUTORIZZATA e ha il tecnico, l'app segreteria crea
   da sola l'incarico — è così che il tecnico se la trova fra le
   pratiche aperte, «e stop» (niente riquadri in dashboard per lui).

   Il numero prosegue il contatore interno degli incarichi (l'erede
   della serie richieste 95/2014→1082/2026): è un NUMERO DI PRATICA
   interna, non un protocollo — regola del confine. L'id creato si
   scrive sulla pratica (incarico_id): mai due incarichi per la
   stessa pratica.
   ============================================================ */

import { sb, state, toast, dataIt, oggiIso } from './core.js';
import { scaricaEml, FIRMA_SEGRETERIA } from './eml.js';
import { RUBRICA_INTERNA } from './lookups.js';

/* Due campi che si somigliano e non sono la stessa cosa (le due tendine di Access):
   - `tipo`      = che cosa si chiede, lista s_tipo_richiesta («Sopralluogo urgente
                   in Cantiere», «Serie di visite»…). Va in `tipo_richiesta`: e' il
                   campo con cui il gestionale colora l'incarico, lo filtra, conta
                   gli urgenti e riconosce lo stage;
   - `tipologia` = da dove arriva, lista s_tipologia_richiesta col codice CNCPT
                   («Richiesta Visita su segnalazione»…). Va in `tipologia_richiesta`.
   Fino al 10/09/2026 si passava il tipo col nome «tipologia» e finiva nella colonna
   sbagliata: nel gestionale gli incarichi uscivano grigi, senza filtro e mai urgenti.
   Chi passa ancora il solo `tipologia` (vecchia forma) lo vede scritto come tipo. */
export async function creaIncaricoDaPratica({ tabella, pratica, tipo, tipologia, tecnicoEmail, tecnicoNome,
  richiedente, testo, impresa, impresaId, indirizzo, comune, oggetto, referente, cellReferente,
  mezzo, visitePreviste, cantiereId }) {
  if (pratica.incarico_id) return pratica.incarico_id;   /* già creato */
  /* il Direttore approva con un account di sola consultazione: il database gli
     rifiuta gli incarichi, e l'errore lo vedeva solo lui (consulenza n. 1 del
     24/09/2026, prima approvazione dall'app). L'incarico lo crea la segreteria. */
  if (state.soloDirettore) {
    toast('Autorizzazione registrata. L\'incarico al tecnico e la lettera li prepara la segreteria dalla pratica.', 'ok');
    return null;
  }
  if (!tecnicoEmail) { toast('Incarico non creato: manca il tecnico assegnato.', 'err'); return null; }

  /* prosegue il contatore interno (max + 1) guardando ANCHE il
     registro storico: la serie vecchia arriva a numeri che in
     `incarichi` non ci sono (il 1082 di ARIANNA sta solo in
     s_servizi_storico — collisione trovata il 01/09/2026) */
  const [{ data: u1 }, { data: u2 }] = await Promise.all([
    sb.from('incarichi').select('id').order('id', { ascending: false }).limit(1),
    sb.from('s_servizi_storico').select('id').order('id', { ascending: false }).limit(1),
  ]);
  const nuovoId = Math.max((u1?.[0]?.id) || 0, (u2?.[0]?.id) || 0) + 1;

  const { error } = await sb.from('incarichi').insert({
    id: nuovoId,
    data_richiesta: (pratica.timestamp_modulo || new Date().toISOString()).slice(0, 10),
    richiedente: richiedente || null,
    mezzo: mezzo || null,
    testo_richiesta: testo || null,
    tipo_richiesta: tipo || tipologia || null,
    tipologia_richiesta: tipo ? (tipologia || null) : null,
    approvato: true,
    tecnico_nome: tecnicoNome || null,
    tecnico_email: tecnicoEmail,
    impresa: impresa || null,
    impresa_id: impresaId || null,
    indirizzo: indirizzo || null,
    comune: comune || null,
    /* se la pratica sa gia' quale cantiere e' (segnalazioni e notifiche
       hanno cantiere_id), il tecnico non deve ricercarlo: accettando
       l'incarico se lo ritrova nella visita — chiesto il 04/09/2026 */
    cantiere_id: cantiereId || pratica.cantiere_id || null,
    oggetto: oggetto || null,
    referente: referente || null,
    cell_referente: cellReferente || null,
    visite_previste: visitePreviste || null,
    stato: 'aperto',
    note_comunicazione: `Creato dall'app segreteria all'autorizzazione della pratica (${state.email}).`,
  });
  if (error) { toast('Incarico al tecnico NON creato: ' + error.message, 'err'); return null; }

  const { error: errAgg } = await sb.from(tabella).update({ incarico_id: nuovoId }).eq('id', pratica.id);
  if (errAgg) toast(`Incarico n° ${nuovoId} creato ma non agganciato alla pratica: ${errAgg.message}`, 'err');
  else toast(`Incarico n° ${nuovoId} assegnato a ${tecnicoNome || tecnicoEmail} nel gestionale visite.`, 'ok');
  pratica.incarico_id = nuovoId;
  return nuovoId;
}

/* ============================================================
   LETTERA DI INCARICO AL TECNICO per un servizio autorizzato
   (24/09/2026, chiesto dall'utente sulla consulenza n. 1 Noventa:
   «ho risposto all'impresa, mi manca la lettera per il tecnico»).

   Un gesto: se l'incarico nel gestionale non c'è lo crea, poi
   prepara la bozza .eml al tecnico (coordinatore in copia) con la
   scheda dell'attività letta dall'incarico e, in allegato, il
   documento di autorizzazione col visto del Direttore. L'invio lo
   fa una persona da Outlook, come sempre. Nessun protocollo: è la
   stessa comunicazione interna dell'assegnazione in riassegnazione.
   ============================================================ */
export async function letteraIncaricoTecnico({ tabella, pratica, campi, oggettoPratica, spesaTxt = null }) {
  if (state.soloDirettore) { toast('La lettera al tecnico la prepara la segreteria.', 'err'); return null; }
  const id = pratica.incarico_id || await creaIncaricoDaPratica({ tabella, pratica, ...campi });
  if (!id) return null;
  const { data: inc, error } = await sb.from('incarichi').select('*').eq('id', id).maybeSingle();
  if (error || !inc) { toast(`Non sono riuscito a leggere l'incarico n° ${id}: ${error?.message || 'non trovato'}`, 'err'); return null; }
  const to = inc.tecnico_email || campi.tecnicoEmail;
  if (!to) { toast('Manca il tecnico: assegnalo nella pratica e salva.', 'err'); return null; }
  const { data: tec } = await sb.from('tecnici').select('tecnico_nome, tecnico_cognome').eq('email', to).maybeSingle();
  const coord = RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome));
  const cc = coord && coord.email.toLowerCase() !== to.toLowerCase() ? [coord.email] : [];

  const righe = [
    ['Impresa', inc.impresa],
    ['Dove', [inc.indirizzo, inc.comune].filter(Boolean).join(', ')],
    ['Referente', [inc.referente, inc.cell_referente].filter(Boolean).join(' — ')],
    ['Richiesta', inc.testo_richiesta],
    ['Spesa prevista', spesaTxt],
    ['Autorizzata', pratica.data_autorizzazione
      ? `dal Direttore il ${dataIt(pratica.data_autorizzazione)}${pratica.aut_modalita === 'cartacea' ? ' (firma sul modulo)' : ' (dall\'app)'}` : null],
  ].filter(([, v]) => v && String(v).trim());
  const scheda = righe.map(([k, v]) => `${k}: ${v}`).join('\n');

  /* l'autorizzazione col visto, se è su Drive: se non si legge si dice, non si tace */
  const allegati = [];
  let notaAllegato = '';
  if (pratica.aut_drive_id) {
    try {
      const { leggiByte } = await import('./drive.js');
      allegati.push({ nome: `autorizzazione-direttore_incarico-${id}.pdf`, byte: await leggiByte(pratica.aut_drive_id) });
    } catch (e) {
      toast('Non sono riuscito ad allegare l\'autorizzazione: la trovi nel link della mail.', 'err');
      notaAllegato = pratica.aut_drive_url ? `\nL'autorizzazione del Direttore è qui: ${pratica.aut_drive_url}\n` : '';
    }
  }

  scaricaEml({
    to, cc,
    oggetto: `Formedil Padova - Incarico n° ${id} - ${oggettoPratica}`,
    corpo: `Ciao ${[tec?.tecnico_nome, tec?.tecnico_cognome].filter(Boolean).join(' ') || inc.tecnico_nome || ''},

ti affido l'incarico n° ${id}: ${oggettoPratica}.

${scheda}
${allegati.length ? '\nIn allegato l\'autorizzazione del Direttore.\n' : notaAllegato}
Lo trovi nel gestionale visite fra gli incarichi assegnati: prendine visione e accettalo da lì, poi concorda l'appuntamento con il referente. Quando l'attività è fatta avvisami, così chiudo la pratica.

${FIRMA_SEGRETERIA}`,
    allegati,
    nomeFile: `incarico-${id}-lettera-al-tecnico.eml`,
  });
  toast(`Bozza della lettera di incarico n° ${id} scaricata: aprila da Outlook e premi Invia.`, 'ok');
  return id;
}

/* ============================================================
   RIASSEGNARE L'INCARICO A UN ALTRO TECNICO (08/09/2026, chiesto
   dall'utente sul primo caso reale: pratica 1081, tecnico non
   disponibile).

   Un solo gesto, tre effetti:
   1. l'incarico nel gestionale visite passa al nuovo tecnico, con
      azzerati presa visione / accettazione / rifiuto del vecchio
      (il nuovo deve poter decidere da sé — stessa logica della
      riassegnazione dal cruscotto del 04/09);
   2. la pratica dei servizi (se c'è) aggiorna `tecnico_assegnato`
      e scrive in `note_ufficio` la riga di storico: chi, a chi,
      quando, perché — regola d'oro 7, il fatto si aggiunge;
   3. partono DUE bozze .eml: l'avviso al tecnico precedente («non
      è più a tuo carico») e l'assegnazione al nuovo, cc coordinatore.
      L'invio resta a una persona da Outlook, come sempre.

   Il motivo che finisce nelle mail e nello storico è quello
   organizzativo («non disponibile nei tempi»): il merito di
   un'indisponibilità resta fuori dall'app.
   ============================================================ */

const nomeDi = (t) => t ? [t.tecnico_cognome, t.titolo, t.tecnico_nome].filter(Boolean).join(' ') : '';
const cognomeNome = (t) => t ? [t.tecnico_nome, t.tecnico_cognome].filter(Boolean).join(' ') : '';

export async function riassegnaTecnico({ incaricoId, tabella = null, pratica = null, nuovoEmail,
  motivo = null, noteAttuali = null, chiedi = true, avvisa = true }) {
  const id = incaricoId || pratica?.incarico_id;
  if (!id) { toast('Nessun incarico nel gestionale da riassegnare.', 'err'); return false; }
  if (!nuovoEmail) { toast('Manca il nuovo tecnico.', 'err'); return false; }

  const [{ data: inc, error: errInc }, { data: tec }] = await Promise.all([
    sb.from('incarichi').select('*').eq('id', id).maybeSingle(),
    sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo').in('email',
      [nuovoEmail, pratica?.tecnico_assegnato, pratica?.tecnico_proposto].filter(Boolean)),
  ]);
  if (errInc || !inc) { toast(`Incarico n° ${id} non trovato nel gestionale.`, 'err'); return false; }

  const vecchioEmail = inc.tecnico_email || pratica?.tecnico_assegnato || null;
  if (vecchioEmail && vecchioEmail === nuovoEmail) return false;   /* stesso tecnico: niente da fare */

  let tecnici = tec || [];
  if (vecchioEmail && !tecnici.find((t) => t.email === vecchioEmail)) {
    const { data: tv } = await sb.from('tecnici').select('email, tecnico_cognome, tecnico_nome, titolo').eq('email', vecchioEmail);
    tecnici = tecnici.concat(tv || []);
  }
  const tNuovo = tecnici.find((t) => t.email === nuovoEmail);
  const tVecchio = tecnici.find((t) => t.email === vecchioEmail);
  const nomeNuovo = nomeDi(tNuovo) || nuovoEmail;
  const nomeVecchio = nomeDi(tVecchio) || inc.tecnico_nome || vecchioEmail || 'nessuno';

  if (chiedi) {
    if (!confirm(`Il tecnico è cambiato: riassegno l'incarico n° ${id} da ${nomeVecchio} a ${nomeNuovo} nel gestionale visite`
      + (avvisa ? ' e preparo le due bozze mail (avviso al precedente, assegnazione al nuovo)?' : '?'))) return false;
    motivo = (prompt('Motivo della riassegnazione (finisce nelle mail e nello storico; facoltativo):',
      motivo || 'tecnico non disponibile nei tempi richiesti') || '').trim() || null;
  }

  const oggi = oggiIso();
  const riga = `Riassegnato il ${dataIt(oggi)} da ${nomeVecchio} a ${nomeNuovo}${motivo ? ` — ${motivo}` : ''} (${state.email}).`;

  /* 1. l'incarico nel gestionale */
  const { error } = await sb.from('incarichi').update({
    tecnico_email: nuovoEmail, tecnico_nome: cognomeNome(tNuovo) || nomeNuovo,
    rifiutato_il: null, rifiutato_da: null, rifiuto_motivo: null,
    accettato_il: null, accettato_da: null,
    presa_visione_il: null, presa_visione_da: null,
    note_comunicazione: [inc.note_comunicazione, riga].filter(Boolean).join('\n'),
  }).eq('id', id);
  if (error) { toast('Riassegnazione non riuscita: ' + error.message, 'err'); return false; }

  /* 2. la pratica dei servizi, con la riga di storico */
  if (tabella && pratica?.id) {
    const note = noteAttuali !== null ? noteAttuali : (pratica.note_ufficio || null);
    const { error: errPr } = await sb.from(tabella).update({
      tecnico_assegnato: nuovoEmail,
      note_ufficio: [note, riga].filter(Boolean).join('\n'),
      aggiornato_da: state.email,
      updated_at: new Date().toISOString(),
    }).eq('id', pratica.id);
    if (errPr) toast('Incarico riassegnato, ma la pratica non si è aggiornata: ' + errPr.message, 'err');
    else { pratica.tecnico_assegnato = nuovoEmail; pratica.note_ufficio = [note, riga].filter(Boolean).join('\n'); }
  }

  /* 3. le due bozze mail */
  if (avvisa) {
    const coord = RUBRICA_INTERNA.find((x) => /coordinatore/i.test(x.nome));
    const cc = coord ? [coord.email] : [];
    const dove = [inc.indirizzo, inc.comune].filter(Boolean).join(', ') || inc.impresa || '—';
    const scheda = [
      `Incarico n° ${id}${(inc.tipo_richiesta || inc.tipologia_richiesta) ? ` — ${inc.tipo_richiesta || inc.tipologia_richiesta}` : ''}`,
      `Oggetto: ${inc.oggetto || '—'}`,
      `Cantiere: ${dove}`,
      inc.impresa ? `Impresa: ${inc.impresa}` : null,
      inc.richiedente ? `Richiedente: ${inc.richiedente}` : null,
      inc.data_richiesta ? `Richiesta del: ${dataIt(String(inc.data_richiesta).slice(0, 10))}` : null,
      pratica?.data_autorizzazione ? `Autorizzata dal Direttore il: ${dataIt(pratica.data_autorizzazione)}` : null,
      inc.testo_richiesta ? `\n${inc.testo_richiesta}` : null,
    ].filter(Boolean).join('\n');

    if (vecchioEmail) {
      scaricaEml({
        to: vecchioEmail, cc,
        oggetto: `Formedil Padova - Incarico n° ${id} riassegnato - ${dove}`,
        corpo: `Ciao ${cognomeNome(tVecchio) || nomeVecchio},

ti avviso che l'incarico n° ${id} (${inc.oggetto || inc.tipo_richiesta || inc.tipologia_richiesta || 'visita'} — ${dove}) dal ${dataIt(oggi)} non è più a tuo carico: è stato riassegnato a ${cognomeNome(tNuovo) || nomeNuovo}${motivo ? ` (${motivo})` : ''}.

Non devi fare nulla: nel gestionale visite l'incarico non compare più fra i tuoi.

${FIRMA_SEGRETERIA}`,
        nomeFile: `incarico-${id}-riassegnato-avviso-precedente.eml`,
      });
    }
    scaricaEml({
      to: nuovoEmail, cc,
      oggetto: `Formedil Padova - Nuovo incarico n° ${id} - ${dove}`,
      corpo: `Ciao ${cognomeNome(tNuovo) || nomeNuovo},

ti è stato assegnato l'incarico n° ${id}${vecchioEmail ? `, in precedenza a carico di ${cognomeNome(tVecchio) || nomeVecchio}` : ''}${motivo ? ` (${motivo})` : ''}.

${scheda}

Lo trovi nel gestionale visite fra gli incarichi assegnati: prendine visione e accettalo da lì. Quando la visita è fatta avvisami, così chiudo la pratica con il riscontro a chi l'ha chiesta.

${FIRMA_SEGRETERIA}`,
      nomeFile: `incarico-${id}-nuova-assegnazione.eml`,
    });
  }

  toast(`Incarico n° ${id} riassegnato a ${nomeNuovo}.${avvisa ? ' Bozze mail scaricate: avviso al precedente e assegnazione al nuovo.' : ''}`, 'ok');
  return true;
}
