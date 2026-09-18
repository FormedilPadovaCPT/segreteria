/* ============================================================
   Il RIEPILOGO PDF dei moduli del portale servizi.

   Fino al 12/09/2026 il PDF di riepilogo di RLST, RLS, conferenza,
   visita, consulenza, attestazione e questionario lo generava Apps
   Script dai modelli Google Docs, e arrivava allegato alla mail: la
   segreteria lo allegava a mano al protocollo IN. Con la strada
   diretta (funzione portale-richieste, 13/09/2026) quel PDF non
   esiste piu': lo genera l'app, dai dati della pratica — deciso
   dall'utente, come gia' per segnalazioni e notifiche.

   Stessa impostazione del riepilogo della notifica
   (segnalazioni-doc.js): carta intestata, i campi per soggetto, e
   una riga in fondo che dice da dove vengono. Riporta cio' che e'
   stato comunicato, com'e' stato comunicato: e' un documento
   RICEVUTO, quindi niente firma e niente timbro.

   depositaRiepilogo() lo mette nella cartella del vault della pratica
   col numero di protocollo nel nome e lo collega al protocollo: se
   nella maschera era stato allegato un originale, quello resta il
   principale e il riepilogo si aggiunge come secondo documento.
   ============================================================ */

import { sb, state, toast } from './core.js';
import { risolviCartella, caricaByte } from './drive.js';
import { dataIt, oggiIso } from './comune.js';
import { apriCarta } from './segnalazioni-doc.js';

const nome = (...x) => x.filter(Boolean).join(' ');
const giorno = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? dataIt(String(v).slice(0, 10)) : v || null);
const suDrive = (u) => (u ? `allegato su Drive — ${u}` : null);
const insieme = (...x) => x.filter(Boolean).join(', ') || null;
/* il giorno sul calendario dell'ufficio: il timestamp del modulo e' in UTC,
   e tagliarlo a dieci caratteri dopo le 22 darebbe il giorno prima */
const giornoLocale = (ts) => {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d)) return oggiIso();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const impresa = (p, extra = []) => ['Impresa', [
  ['Ragione sociale', p.ragione_sociale],
  ['Partita IVA', p.partita_iva],
  ['Codice fiscale impresa', p.cf_impresa],
  ['Codice CEIV dichiarato', p.codice_ceiv_dich],
  ...extra,
]];
const legaleRapp = (p) => ['Legale rappresentante', [
  ['Nominativo', nome(p.rl_titolo, p.rl_nome, p.rl_cognome)],
  ['Codice fiscale', p.rl_cf],
]];
const referente = (p) => ['Referente in cantiere', [
  ['Nominativo', nome(p.ref_titolo, p.ref_nome, p.ref_cognome)],
  ['Telefono', p.ref_tel],
]];
const cantieri = (p, titolo = 'Cantieri') => [titolo, (Array.isArray(p.cantieri) ? p.cantieri : []).map((c, i) => [
  `Cantiere ${i + 1}`,
  [insieme(c.indirizzo, c.comune), c.importo ? `importo ${c.importo}` : '', c.committente ? `committente ${c.committente}` : '',
    c.durata ? `durata ${c.durata}` : '', c.qualita ? `in qualità di ${c.qualita}` : ''].filter(Boolean).join(' — '),
])];

/* per ogni modulo: titolo, nome breve, sigla e parte finale del nome file,
   chi compare nel nome file, e le sezioni [titolo, [etichetta, valore][]] */
const MODELLI = {
  cons: {
    titolo: 'Richiesta di consulenza', nome: 'Consulenza', sigla: 'RICH', file: 'richiesta-consulenza',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      impresa(p, [['E-mail', p.email], ['Cellulare', p.cellulare], ['Telefono', p.telefono]]),
      legaleRapp(p),
      ['Richiesta', [['Ruolo RSPP', p.rspp_ruolo], ['Tipo di consulenza', p.tipi_consulenza], ['Quesito / note', p.quesito || p.note_modulo]]],
    ],
  },
  vis: {
    titolo: 'Richiesta di visita in cantiere', nome: 'Richiesta visita', sigla: 'RICH', file: 'richiesta-visita',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      impresa(p, [['Sede legale', p.ind_legale], ['Sede amministrativa', p.ind_amm], ['Telefono', p.telefono],
        ['Cellulare', p.cellulare], ['E-mail', p.email]]),
      legaleRapp(p),
      ['Richiesta', [['Tipo di visita', p.tipo_visita], ['Note', p.note_modulo]]],
      cantieri(p),
      referente(p),
    ],
  },
  conf: {
    titolo: 'Richiesta di conferenza di cantiere', nome: 'Conferenza di cantiere', sigla: 'RICH', file: 'richiesta-conferenza-cantiere',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      impresa(p, [['Sede legale', p.ind_legale], ['Sede amministrativa', p.ind_amm], ['Telefono', p.telefono],
        ['Cellulare', p.cellulare], ['E-mail', p.email]]),
      legaleRapp(p),
      ['Richiesta', [['Ruolo RSPP', p.rspp_ruolo], ['Tipo di richiesta', p.tipo_richiesta], ['Note', p.note_modulo]]],
      ['Cantiere', [['Indirizzo', p.ind_cantiere], ['Comune', p.comune_cantiere]]],
      referente(p),
    ],
  },
  att: {
    titolo: 'Richiesta di attestazione — DM 132/2024', nome: 'Richiesta attestazione', sigla: 'RICH', file: 'richiesta-attestazione-DM132',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      impresa(p, [['Indirizzo', insieme(p.indirizzo, p.comune)], ['Telefono', p.telefono], ['E-mail', p.email],
        ['Cassa Edile (provincia)', p.cassa_edile_prov]]),
      legaleRapp(p),
      cantieri(p, 'Cantieri proposti'),
      ['Dichiarazioni (DPR 445/2000)', [
        ['Regolarità contributiva (INAIL, INPS, Cassa Edile)', p.decl_contributi],
        ['Regolarità D.Lgs. 81/08', p.decl_sicurezza],
        ['Documenti e accesso ai cantieri', p.decl_obblighi],
      ]],
    ],
  },
  rlst: {
    titolo: 'Richiesta di affidamento al servizio RLST', nome: 'Richiesta RLST', sigla: 'RICH', file: 'richiesta-affidamento-RLST',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      ['Richiesta', [['Data di compilazione', giorno(p.data_comp)]]],
      impresa(p, [['N. lavoratori', p.n_lavoratori], ['CCNL', p.ccnl], ['Telefono', p.telefono], ['Cellulare', p.cellulare],
        ['E-mail', p.email], ['Sede legale', insieme(p.ind_sede_legale, p.comune_legale)],
        ['Sede amministrativa', insieme(p.ind_sede_amm, p.comune_amm)]]),
      legaleRapp(p),
      ['RSPP', [['Nominativo', p.rspp_nome], ['Ruolo', p.rspp_ruolo]]],
      ['Riunione con i lavoratori', [['Data del verbale', p.data_verbale], ['Luogo', p.luogo_riunione], ['Verbale', suDrive(p.verbale_url)]]],
      ['Note', [['Note', p.note_modulo]]],
    ],
  },
  rls: {
    titolo: 'Comunicazione del nominativo RLS', nome: 'Comunicazione RLS', sigla: 'COMU', file: 'comunicazione-RLS',
    chi: (p) => p.ragione_sociale,
    sezioni: (p) => [
      impresa(p, [['Sede', p.ind_sede], ['Telefono', p.telefono], ['E-mail', p.email]]),
      ['Legale rappresentante', [['Nominativo', nome(p.lr_titolo, p.lr_nome, p.lr_cognome)], ['Codice fiscale', p.lr_cf]]],
      ['Elezione', [['Tipo', p.tipo_elezione], ['Data del verbale', p.data_verbale], ['Protocollo del verbale', p.protocollo_verbale],
        ['Verbale', suDrive(p.verbale_url)]]],
      ['RLS', [
        ['Nominativo', nome(p.rls_titolo, p.rls_nome, p.rls_cognome)], ['Codice fiscale', p.rls_cf],
        ['Nato a', p.nato_a], ['Nato il', p.nato_il], ['Residenza', insieme(p.residenza, p.comune_res)],
        ['Telefono', p.rls_tel], ['E-mail', p.rls_email], ['Tempo indeterminato', p.indeterminato], ['Nel LUL', p.lul],
        ['Codice CEIV operaio', p.ceiv_operaio], ['Altra Cassa Edile', p.altra_ce], ['Mansione', p.mansione],
        ['Data di assunzione', p.data_assunzione], ['Livello CCNL', p.livello_ccnl],
      ]],
      ['Formazione', [['Ente del corso', p.ente_corso], ['Organismo paritetico (provincia)', p.op_provincia],
        ['Attestato', suDrive(p.formazione_url)]]],
    ],
  },
  qst: {
    titolo: 'Questionario di gradimento del sopralluogo', nome: 'Questionario', sigla: 'QUEST', file: 'questionario-sopralluogo',
    chi: (p) => p.tecnico,
    sezioni: (p) => [
      ['Visita', [['Verbale', p.nr_verbale], ['Tecnico', p.tecnico], ['Data della visita', giorno(p.data_visita)], ['Scopo', p.scopi]]],
      /* il questionario in uso dal 18/09/2026: una domanda sola e il ramo che
         si apre. Le righe vuote il riepilogo le salta da se', quindi le due
         stagioni di domande convivono senza confondersi */
      ['Giudizio sulla visita', [
        ['Quanto è stata utile (1-5)', p.utilita], ['Motivi indicati', p.motivi],
        ['Dopo la visita', p.azione_dopo], ['Ha scritto', p.commento],
      ]],
      ['Valutazione', [
        ['Aspettative soddisfatte (1-5)', p.scala_aspettative], ['Ruolo e obiettivi spiegati', p.ruolo_chiaro],
        ['Professionalità del tecnico (1-5)', p.scala_professionale], ['Suggerimenti pratici', p.suggerimenti_pratici],
        ['Suggerimenti facili da applicare (1-5)', p.scala_facilita], ['Nuovi rischi individuati', p.nuovi_rischi],
        ['Misure adottate', p.misure_sicurezza], ['Aree monitorate', p.aree_monitorate],
      ]],
      ['Conoscenza dei servizi (1-5)', [
        ['Area Sicurezza e Salute', p.scala_serv_area], ['Visite in cantiere', p.scala_serv_visite],
        ['Consulenza', p.scala_serv_consulenza], ['Formazione', p.scala_serv_formazione], ['Corsi e seminari', p.scala_serv_corsi],
      ]],
      ['Miglioramenti e contatti', [['Proposte', p.proposte_miglioramento], ['Vuole aggiornamenti', p.aggiornamenti],
        ['Vuole essere contattato', p.contatto_richiesto], ['Recapito', p.recapito_contatto]]],
    ],
  },
};

export async function pdfRiepilogoModulo(tipo, p) {
  const m = MODELLI[tipo];
  if (!m) throw new Error(`riepilogo non previsto per il modulo «${tipo}»`);
  const c = await apriCarta();
  const n = p.progressivo ?? `m${p.id}`;
  const provenienza = p.fonte === 'modulo' ? 'ricevuta dal portale servizi' : p.fonte ? `arrivata per ${p.fonte}` : '';
  c.scrivi(m.titolo, c.bold, 15, c.nero);
  c.scrivi(`${m.nome} n° ${n}${provenienza ? ` — ${provenienza}` : ''}`, c.font, 9, c.grigio);
  c.stato.y -= 6;

  /* un titolo di sezione non resta mai solo in fondo alla pagina */
  const sezione = (t) => { c.serve(64); c.stato.y -= 4; c.scrivi(t, c.bold, 10.5, c.arancio); c.stato.y -= 2; };
  for (const [titolo, righe] of m.sezioni(p)) {
    const piene = righe.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
    if (!piene.length) continue;
    sezione(titolo);
    for (const [etichetta, valore] of piene) c.campo(etichetta, String(valore));
  }

  c.stato.y -= 10;
  c.serve(30);
  c.scrivi(`Riepilogo generato dall'app Segreteria il ${dataIt(oggiIso())} dai dati ${p.fonte === 'modulo' ? 'ricevuti dal portale servizi' : 'registrati'}${p.timestamp_modulo ? ` il ${dataIt(giornoLocale(p.timestamp_modulo))}` : ''}: riporta la richiesta così com'è stata trasmessa. Documento ricevuto, protocollato in entrata.`, c.font, 7.5, c.grigio);
  return new Uint8Array(await c.doc.save());
}

const slug = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'richiedente';

export function nomeFileRiepilogo(tipo, p) {
  const m = MODELLI[tipo];
  const data = giornoLocale(p.timestamp_modulo).replace(/-/g, '_');
  return `${data}_${m.sigla}_${slug(m.chi(p))}_${m.file}-n${p.progressivo ?? `m${p.id}`}.pdf`;
}

/* scarica il riepilogo senza protocollarlo (per leggerlo o stamparlo) */
export async function scaricaRiepilogo(tipo, p) {
  const byte = await pdfRiepilogoModulo(tipo, p);
  const url = URL.createObjectURL(new Blob([byte], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFileRiepilogo(tipo, p);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* il documento del protocollo IN: nasce nella cartella della pratica, col
   numero di protocollo nel nome (lo aggiunge la funzione di caricamento) —
   regola «il numero deve stare nel nome prima che l'umano lo cerchi» */
export async function depositaRiepilogo(tipo, p, prot, percorso) {
  try {
    const byte = await pdfRiepilogoModulo(tipo, p);
    const cart = await risolviCartella(percorso);
    if (!cart?.id) throw new Error(`Cartella «${percorso}» non trovata su Drive`);
    const nomeFile = nomeFileRiepilogo(tipo, p);
    const su = await caricaByte(prot, nomeFile, byte, 'application/pdf', cart.id);

    /* principale solo se si sa per certo che non c'e' altro: col conteggio in
       errore non si ruba il posto a un documento vero */
    const { count, error: errConta } = await sb.from('s_prot_allegati').select('id', { count: 'exact', head: true }).eq('protocollo_id', prot.id);
    const principale = !errConta && !count;
    const { error } = await sb.from('s_prot_allegati').insert({
      protocollo_id: prot.id, nome: su.file_name || nomeFile, mime: 'application/pdf',
      dimensione: byte.length, principale, created_by: state.email,
      drive_file_id: su.drive_file_id, drive_url: su.drive_url,
    });
    if (error) throw new Error(error.message);
    if (principale) {
      await sb.from('s_protocollo').update({ drive_file_id: su.drive_file_id, drive_url: su.drive_url }).eq('id', prot.id);
    }
    toast(`Riepilogo del modulo depositato nel vault: ${su.file_name || nomeFile}`, 'ok');
  } catch (e) {
    toast('Protocollo collegato, ma il riepilogo PDF non è stato depositato: ' + e.message, 'err');
  }
}
