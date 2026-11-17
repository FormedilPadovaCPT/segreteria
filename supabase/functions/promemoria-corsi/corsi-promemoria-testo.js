/* ============================================================
   PROMEMORIA DELLE LEZIONI E MATERIALI DEL CORSO — le regole, da sole
   (28/09/2026, chiesto dall'utente).

   Un corso si apre anche molto prima della prima lezione: chi si è
   iscritto a luglio, a ottobre non se lo ricorda. N giorni prima di
   OGNI lezione in calendario parte da solo un promemoria agli iscritti.
   A corso concluso, la mail degli attestati porta i link ai materiali,
   con la data entro cui scaricarli.

   Qui stanno solo le regole e i testi, senza database e senza posta:
   si provano con `node --test`. Questo file è tenuto IN COPIA dentro
   supabase/functions/promemoria-corsi/ (npm run firma-sync): per questo
   non importa niente.

   ⚠️ Il promemoria parte da solo: non contiene NIENTE scritto da chi lo
   fa partire. Titolo, data, orario, sede e nomi si leggono dal database.
   Le note della giornata sono appunti dell'ufficio e NON ci entrano.
   ============================================================ */

const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
/* chi non viene più: a loro il promemoria non va */
const ESITI_FUORI = ['annullato', 'sostituito'];
export const GIORNI_PREDEFINITI = 2;

const iso = (d) => String(d || '').slice(0, 10);
const aUtc = (d) => { const [a, m, g] = iso(d).split('-').map(Number); return Date.UTC(a, m - 1, g); };

/** Giorni fra due date (b − a), senza fusi orari di mezzo. */
export function giorniFra(a, b) {
  return Math.round((aUtc(b) - aUtc(a)) / 86_400_000);
}

/** «giovedì 2 ottobre 2026» */
export function dataEstesa(d) {
  const t = new Date(aUtc(d));
  return `${GIORNI[t.getUTCDay()]} ${t.getUTCDate()} ${MESI[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

const ora = (t) => (t ? String(t).slice(0, 5) : '');
const fascia = (dalle, alle) => {
  const a = ora(dalle), b = ora(alle);
  if (a && b) return `dalle ${a} alle ${b}`;
  return a ? `dalle ${a}` : '';
};
/** L'orario di una giornata, coi due turni uniti da «e» solo se ci sono. */
export function orarioEsteso(g) {
  return [fascia(g?.dalle, g?.alle), fascia(g?.dalle2, g?.alle2)].filter(Boolean).join(' e ');
}

/** Il corso manda promemoria? Solo se è aperto e ha i giorni impostati. */
export function corsoRicorda(c) {
  const n = Number(c?.promemoria_giorni);
  return c?.stato === 'aperto' && Number.isInteger(n) && n >= 1;
}

/** Il giorno in cui parte il promemoria di una giornata. */
export function partenza(g, giorni) {
  const t = new Date(aUtc(g.data) - Number(giorni) * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** Le giornate da ricordare OGGI.
 *  Non «esattamente N giorni prima» ma «da N giorni prima fino al giorno
 *  prima»: se il giro salta un giorno, o uno si iscrive tardi, il
 *  promemoria parte lo stesso al giro dopo. Il giorno della lezione no:
 *  alle otto del mattino non è più un promemoria. */
export function giornateDaRicordare(corsi, giornate, oggi) {
  const di = Object.fromEntries((corsi || []).filter(corsoRicorda).map((c) => [c.id, c]));
  return (giornate || []).filter((g) => {
    const c = di[g.corso_id];
    if (!c || !g.data) return false;
    const mancano = giorniFra(oggi, g.data);
    return mancano >= 1 && mancano <= Number(c.promemoria_giorni);
  }).sort((a, b) => iso(a.data).localeCompare(iso(b.data)) || a.id - b.id);
}

/** Chi riceve il promemoria: gli iscritti che vengono ancora. */
export function iscrittiDaAvvisare(iscritti) {
  return (iscritti || []).filter((i) => !ESITI_FUORI.includes(i.esito));
}

/** L'indirizzo a cui scrivere per un iscritto, e da dove viene.
 *  Prima il suo (quello dato iscrivendosi, poi l'anagrafica), in coda
 *  quello dell'impresa: meglio che il promemoria arrivi all'ufficio che
 *  l'ha iscritto piuttosto che a nessuno. */
export function indirizzoDi(i, persona, impresa) {
  const prove = [
    ['iscrizione', i?.email_iscrizione], ['persona', persona?.email],
    ['persona', persona?.email2], ['impresa', impresa?.email],
  ];
  for (const [origine, v] of prove) {
    const e = String(v || '').trim().toLowerCase();
    if (MAIL_RE.test(e)) return { email: e, origine };
  }
  return { email: null, origine: null };
}

/** Una mail per indirizzo: il referente che ha iscritto dieci persone
 *  riceve un elenco solo, non dieci mail uguali.
 *  righe: [{ iscritto_id, nominativo, email, origine }] */
export function raggruppaPerIndirizzo(righe) {
  const gruppi = new Map();
  const senza = [];
  for (const r of righe || []) {
    if (!r.email) { senza.push(r); continue; }
    if (!gruppi.has(r.email)) gruppi.set(r.email, { email: r.email, righe: [] });
    gruppi.get(r.email).righe.push(r);
  }
  return { gruppi: [...gruppi.values()], senza };
}

/* ══════════ la firma di presenza dal QR (17/11/2026) ══════════
   Chiesto dall'utente per il convegno ITL: il codice personale per firmare
   la presenza arriva col promemoria, invece che solo sul biglietto
   consegnato in aula. Si manda solo se il corso ha le firme dal QR aperte
   e il codice è già sul portale (la funzione ripubblica prima di spedire). */

/** Il corso ha le firme dal QR aperte (e non ancora chiuse)? */
export function firmeQrAperte(c, adesso = new Date().toISOString()) {
  return !!c?.pres_codice && (!c.pres_chiuso_il || String(c.pres_chiuso_il) > String(adesso));
}

/* Il codice deve saltare all'occhio (chiesto dall'utente: chi viene ai
   convegni non legge le mail): nella versione grafica sta in un riquadro
   arancione, grande, subito dopo «quando e dove», coi passaggi numerati;
   nella versione in righe fra due righe di «=». Anche l'oggetto lo dice. */
const escH = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ARANCIO_F = '#E7500F';
const FONT_F = 'Arial, Helvetica, sans-serif';

/** I passaggi della firma, uguali per testo e grafica. */
export function passiFirma(giornata, { aPersona = false } = {}) {
  const dueTurni = !!(giornata?.dalle2 || giornata?.alle2);
  const tu = aPersona;
  return [
    `${tu ? 'Arrivato in aula, inquadri' : 'Arrivati in aula, ciascuno inquadra'} con il telefono il QR esposto all'ingresso.`,
    `${tu ? 'Scriva il suo' : 'Scrive il proprio'} CODICE e l'anno di nascita.`,
    `${tu ? 'Prema' : 'Preme'} il pulsante «Firmo»: è la firma di entrata.`,
    `${tu ? 'All\'uscita rifaccia' : 'All\'uscita rifà'} la stessa cosa: è la firma di uscita.${dueTurni ? ' Vale per la mattina e per il pomeriggio.' : ''}`,
  ];
}

/** La firma di presenza: { righe (testo), html (riquadro), conCodice }.
 *  Vuoto se nessuno ha un codice. */
export function firmaPresenza(partecipanti, giornata, { aPersona = false } = {}) {
  const con = (partecipanti || []).filter((p) => p.codice);
  if (!con.length) return { righe: [], html: '', conCodice: 0 };
  const senza = (partecipanti || []).filter((p) => !p.codice);
  const passi = passiFirma(giornata, { aPersona });
  const nota = [
    aPersona ? 'Tenga questa mail sul telefono: il codice le servirà due volte.' : 'Vi preghiamo di girare a ciascuno il SUO codice: serve due volte, all\'arrivo e all\'uscita.',
    'Chi non ha lo smartphone firma sul registro di carta.',
  ];
  const barra = '='.repeat(44);

  const righe = aPersona
    ? ['', barra, `IL SUO CODICE PER LA FIRMA DI PRESENZA:   ${con[0].codice}`, barra,
      ...passi.map((p, i) => `${i + 1}. ${p}`), '', ...nota]
    : ['', barra, 'I CODICI PER LA FIRMA DI PRESENZA', barra,
      ...con.map((p) => `- ${p.nominativo}:   ${p.codice}`),
      ...(senza.length ? [`(${senza.map((p) => p.nominativo).join(', ')}: il codice ${senza.length === 1 ? 'lo riceverà' : 'lo riceveranno'} all'ingresso)`] : []),
      barra, ...passi.map((p, i) => `${i + 1}. ${p}`), '', ...nota];

  const P = (t, st = '') => `<p style="margin:0 0 8px;font-family:${FONT_F};font-size:15px;line-height:22px;color:#1F2933;${st}">${t}</p>`;
  const codiceGrande = (c, px) => `<span style="font-family:'Courier New',Courier,monospace;font-size:${px}px;line-height:${Math.round(px * 1.2)}px;font-weight:700;letter-spacing:${Math.round(px / 6)}px;color:${ARANCIO_F};">${escH(c)}</span>`;
  const elenco = aPersona
    ? `<p style="margin:6px 0 14px;text-align:center;">${codiceGrande(con[0].codice, 40)}</p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:6px 0 12px;">${
      con.map((p) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #F3D2C1;font-family:${FONT_F};font-size:15px;color:#1F2933;">${escH(p.nominativo)}</td><td align="right" style="padding:6px 8px;border-bottom:1px solid #F3D2C1;">${codiceGrande(p.codice, 26)}</td></tr>`).join('')
    }</table>${senza.length ? P(`(${escH(senza.map((p) => p.nominativo).join(', '))}: il codice ${senza.length === 1 ? 'lo riceverà' : 'lo riceveranno'} all'ingresso)`, 'font-size:13px;color:#56606B;') : ''}`;
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:4px 0 18px;">
<tr><td bgcolor="#FFF4EC" style="background:#FFF4EC;border:3px solid ${ARANCIO_F};border-radius:10px;padding:16px 18px;">
<p style="margin:0 0 4px;font-family:${FONT_F};font-size:13px;line-height:18px;font-weight:700;letter-spacing:1px;color:${ARANCIO_F};text-transform:uppercase;">&#128273; ${aPersona ? 'Il suo codice per la firma di presenza' : 'I codici per la firma di presenza'}</p>
${elenco}
<ol style="margin:0 0 10px;padding-left:22px;">${passi.map((p) => `<li style="margin:0 0 4px;font-family:${FONT_F};font-size:15px;line-height:22px;color:#1F2933;">${escH(p).replace('CODICE', '<strong>codice</strong>')}</li>`).join('')}</ol>
${nota.map((t, i) => P(escH(t), i === 0 ? 'font-weight:700;' : 'font-size:13px;color:#56606B;margin:0;')).join('\n')}
</td></tr></table>`;
  return { righe, html, conCodice: con.length };
}

/** Il testo del promemoria.
 *  corso, giornata, giornate (tutte quelle del corso), partecipanti
 *  ([{ nominativo, origine, codice? }]) → { oggetto, corpo }.
 *  codici: true se i codici personali vanno nella mail (firme dal QR aperte
 *  e codici già sul portale).
 *  L'oggetto è senza il prefisso dell'ufficio: lo mette chi spedisce. */
export function testoPromemoria({ corso, giornata, giornate = [], partecipanti = [], oggi = null, contatto = '', codici = false } = {}) {
  const titolo = corso?.titolo ? `«${corso.titolo}»` : 'il corso';
  const tutte = [...giornate].filter((g) => g.data).sort((a, b) => iso(a.data).localeCompare(iso(b.data)) || a.id - b.id);
  const n = tutte.findIndex((g) => g.id === giornata.id) + 1;
  const piu = tutte.length > 1;
  /* alla persona si scrive solo se la mail è SUA: a un indirizzo
     dell'impresa, anche per un iscritto solo, si parla all'ufficio */
  const aPersona = partecipanti.length === 1 && partecipanti[0].origine !== 'impresa';
  const mancano = oggi ? giorniFra(oggi, giornata.data) : null;
  const quando = mancano === 1 ? 'domani, ' : '';

  const apertura = aPersona
    ? [
      partecipanti[0].nominativo ? `Gentile ${partecipanti[0].nominativo},` : 'Buongiorno,',
      '',
      `le ricordiamo la sua iscrizione a ${titolo}.`,
    ]
    : [
      'Buongiorno,',
      '',
      `vi ricordiamo l’iscrizione a ${titolo} ${partecipanti.length === 1 ? 'del partecipante' : 'dei partecipanti'}:`,
      partecipanti.map((p) => `- ${p.nominativo}`).join('\n'),
    ];

  const orario = orarioEsteso(giornata);
  const dove = [giornata.sede || corso?.sede, giornata.aula].filter(Boolean).join(' - ');
  const dettagli = [
    `**${piu ? `Lezione ${n} di ${tutte.length}` : 'Quando'}:** ${quando}${dataEstesa(giornata.data)}${orario ? `, ${orario}` : ''}`,
    dove ? `**Dove:** ${dove}` : '',
    corso?.modalita === 'videoconferenza' ? '**Modalità:** videoconferenza' : '',
  ].filter(Boolean);

  const dopo = tutte.filter((g) => iso(g.data) > iso(giornata.data));
  const prossime = dopo.length
    ? ['', 'Le lezioni successive:', dopo.map((g) => {
      const o = orarioEsteso(g);
      return `- ${dataEstesa(g.data)}${o ? `, ${o}` : ''}`;
    }).join('\n')]
    : [];

  /* la firma di presenza sta SUBITO dopo «quando e dove»: è la cosa da non perdere */
  const firma = codici ? firmaPresenza(partecipanti, giornata, { aPersona }) : { righe: [], html: '', conCodice: 0 };
  const pulisci = (righe) => righe.filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();

  const prima = [...apertura, '', ...dettagli];
  const resto = [
    ...prossime,
    '',
    `Se ${aPersona ? 'non può partecipare, la preghiamo di avvisarci' : 'qualcuno non può partecipare, vi preghiamo di avvisarci'} rispondendo a questa mail${contatto ? ` o scrivendo a ${contatto}` : ''}.`,
    '',
    'Questo promemoria parte in automatico prima di ogni lezione.',
    '',
    'Cordiali saluti.',
  ];
  const corpo = pulisci([...prima, ...firma.righe, ...resto]);

  const oggetto = `Promemoria ${piu ? `lezione ${n} di ${tutte.length}` : 'iscrizione'} - ${corso?.titolo || `corso n° ${corso?.id}`} - ${dataEstesa(giornata.data)}${
    firma.conCodice ? (aPersona ? ' - il suo codice per la firma' : ' - i codici per la firma') : ''}`;
  /* per la versione grafica: il testo prima e dopo il riquadro del codice */
  return { oggetto, corpo, aPersona, firmaHtml: firma.html, corpoPrima: pulisci(prima), corpoDopo: pulisci(resto) };
}

/* ══════════ i materiali del corso ══════════ */

/** I materiali buoni: con un titolo e un link http(s). */
export function materialiValidi(materiali) {
  return (Array.isArray(materiali) ? materiali : [])
    .map((m) => ({ titolo: String(m?.titolo || '').trim(), url: String(m?.url || '').trim() }))
    .filter((m) => m.titolo && /^https?:\/\/\S+$/i.test(m.url));
}

/** Le righe da aggiungere alla mail degli attestati. Vuoto se non c'è
 *  niente da condividere.
 *  ⚠️ La data è un invito a scaricare, non una serratura: l'app non toglie
 *  l'accesso ai file, lo dice soltanto (deciso dall'utente, 28/09/2026). */
export function testoMateriali(materiali, finoAl, { aPersona = false } = {}) {
  const mm = materialiValidi(materiali);
  if (!mm.length) return [];
  const uno = mm.length === 1;
  return [
    '',
    uno ? '**Il materiale del corso**' : '**I materiali del corso**',
    ...mm.map((m) => `- ${m.titolo}: ${m.url}`),
    '',
    finoAl
      ? `${aPersona ? 'Le consigliamo' : 'Vi consigliamo'} di scaricarl${uno ? 'o' : 'i'} il prima possibile: rest${uno ? 'a' : 'ano'} a disposizione fino al ${dataEstesa(finoAl)}.`
      : `${aPersona ? 'Le consigliamo' : 'Vi consigliamo'} di scaricarl${uno ? 'o' : 'i'} il prima possibile.`,
  ];
}
