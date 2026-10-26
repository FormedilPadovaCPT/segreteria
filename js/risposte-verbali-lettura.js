/* ============================================================
   LE RISPOSTE AI VERBALI (12/10/2026).

   Il verbale parte da cptpd@did.formedilpadova.it, e quando l'impresa,
   il CSE o il committente rispondono la risposta torna lì, dove la
   vede la segreteria e non il tecnico che ha fatto la visita (caso che
   l'ha fatto chiedere: il CSE del cantiere di Limena, verbale
   CPT/26_27/0029, che riferiva le correzioni fatte in cantiere).
   La edge function `risposte-verbali` gira quelle risposte al tecnico.

   Qui le regole per riconoscerle, provate senza Gmail: il numero del
   verbale nell'oggetto, chi scrive (non noi, non un collega), e le
   risposte automatiche, che al tecnico non dicono niente.

   ⚠️ È un modulo PURO: niente rete, niente database, niente Deno.
   La funzione ne tiene una copia identica, allineata da
   `npm run firma-sync` e controllata da `npm run verifica-firma`.
   ============================================================ */
import { decodificaOggetto, VERBALE_RE } from './mail-respinte-lettura.js';

/* chi scrive da dentro l'ente non è «una risposta al verbale» da girare:
   un collega il tecnico lo sente da sé, e le nostre stesse mail (l'avviso
   dei rimbalzi, questo inoltro) portano il numero del verbale nell'oggetto */
export const INTERNI_RE = /@(?:[a-z0-9-]+\.)*(?:formedilpadova\.it|scuolaedilepadova\.(?:it|net))$/i;
const RAPPORTI_RE = /^(?:mailer-daemon|postmaster)@/i;

/* ── le risposte automatiche ──
   Fuori sede, conferme di lettura, ricevute della PEC: al tecnico non
   servono, e un inoltro per ognuna insegnerebbe a non leggere gli inoltri.
   ⚠️ «POSTA CERTIFICATA: Re: …» invece È una risposta vera, arrivata da
   una PEC: si gira (il messaggio sta nell'allegato postacert.eml). */
const AUTOMATICA_OGGETTO_RE = new RegExp('^\\s*(?:'
  + 'risposta automatica|automatic reply|auto(?:matic)?[- ]?(?:reply|response)|autoreply|out of (?:the )?office|'
  + 'fuori (?:sede|ufficio)|assente\\b|absence|'
  + 'letto\\s*:|non letto\\s*:|read\\s*:|not read\\s*:|'
  + 'accettazione\\s*:|consegna\\s*:|avviso di (?:non accettazione|mancata consegna)|anomalia messaggio\\s*:|'
  + 'presa in carico\\s*:|errore di consegna)', 'i');

/* le intestazioni di Gmail come elenco [{name, value}] → mappa coi nomi minuscoli */
export function mappaIntestazioni(headers) {
  const h = {};
  for (const x of headers || []) {
    const k = String(x?.name || '').toLowerCase();
    if (k && !(k in h)) h[k] = String(x?.value ?? '');
  }
  return h;
}

export function indirizzo(da) {
  const s = String(da || '');
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/) || s.match(/([^\s<>"',;:]+@[^\s<>"',;:]+)/);
  return m ? m[1].toLowerCase() : '';
}

export function nomeMittente(da) {
  const s = decodificaOggetto(String(da || '')).replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
  return s && !s.includes('@') ? s : indirizzo(da);
}

/* perché è automatica, oppure '' se l'ha scritta una persona */
export function automatica(h, oggetto) {
  const auto = String(h['auto-submitted'] || '').trim();
  if (auto && !/^no\b/i.test(auto)) return `Auto-Submitted: ${auto}`;
  if (h['x-autoreply'] || h['x-autorespond']) return 'risposta automatica';
  if (/^(?:auto_reply|bulk|junk|list)$/i.test(String(h.precedence || '').trim())) return `Precedence: ${h.precedence}`;
  if (/multipart\/report/i.test(String(h['content-type'] || ''))) return 'rapporto automatico';
  if (AUTOMATICA_OGGETTO_RE.test(String(oggetto || ''))) return 'risposta automatica';
  return '';
}

/* ── è una risposta a un verbale da girare al tecnico? ──
   { nr, oggetto, da, mittente, escludi }: `nr` null = non c'entra coi
   verbali (non si registra nemmeno); `escludi` valorizzato = c'entra, ma
   non si gira, e il motivo resta scritto nel registro. */
export function classifica(headers) {
  const h = mappaIntestazioni(headers);
  const oggetto = decodificaOggetto(h.subject || '').replace(/\s+/g, ' ').trim();
  const nr = (oggetto.match(VERBALE_RE) || [])[0] || null;
  const da = indirizzo(h.from);
  const mittente = nomeMittente(h.from);
  let escludi = null;
  if (!da) escludi = 'mittente non leggibile';
  else if (RAPPORTI_RE.test(da)) escludi = 'rapporto di mancata consegna (lo guarda mail-respinte)';
  else if (INTERNI_RE.test(da)) escludi = 'scritta da dentro l\'ente';
  else {
    const a = automatica(h, oggetto);
    if (a) escludi = a;
  }
  /* a chi va il «Rispondi» del tecnico: il Reply-To di chi ha scritto, se
     c'è (la PEC scrive da posta-certificata@… e mette lì il mittente vero) */
  const rt = indirizzo(h['reply-to']);
  const rispondiA = rt && !INTERNI_RE.test(rt) ? rt : da;
  return { nr, oggetto, da, mittente, rispondiA, escludi };
}

/* il testo di una mail che ha solo la versione HTML */
export function testoDaHtml(html) {
  return String(html || '')
    .replace(/<(head|style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, '\'')
    .replace(/&#(\d+);/g, (_t, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── quali allegati si girano ──
   Tutti quelli con un nome, tranne le immagini incorporate piccole: sono
   i loghi delle firme, che in un inoltro diventerebbero «allegati» che
   nessuno ha mandato. Una foto incollata nel testo invece pesa, e resta. */
export const SOGLIA_INLINE = 20_000;
export function allegatiDaTenere(parti) {
  return (parti || []).filter((p) => p && p.nome && !(p.inline && (p.dimensione || 0) < SOGLIA_INLINE));
}

/* nell'intestazione MIME il nome va in caratteri semplici */
export function nomeFileSicuro(n) {
  const s = String(n || 'allegato').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\/:*?<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return (s || 'allegato').slice(0, 120);
}

export function dataOraIt(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

const dataIt = (iso) => {
  const [a, m, g] = String(iso || '').slice(0, 10).split('-');
  return g ? `${g}/${m}/${a}` : '';
};

/* ── il testo dell'inoltro ──
   Niente che abbia scritto l'app al posto di qualcuno: due righe che
   dicono che cos'è, poi la mail com'è arrivata. */
export function testoInoltro({ nomeTecnico = '', nr = '', impresa = '', dataVisita = '', mittente = '', da = '',
  rispondiA = '', data = '', a = '', cc = '', oggetto = '', corpo = '', allegati = [], omessi = [], coordinatoreInCopia = false }) {
  const visita = [impresa, dataVisita ? `visita del ${dataIt(dataVisita)}` : ''].filter(Boolean).join(', ');
  const chi = mittente && mittente !== da ? `${mittente} <${da}>` : da;
  return [
    nomeTecnico ? `Gentile ${nomeTecnico},` : 'Buongiorno,',
    '',
    `alla casella dell'ufficio è arrivata una risposta al verbale ${nr}${visita ? ` (${visita})` : ''}. Te la giro com'è arrivata${allegati.length ? ', con gli allegati' : ''}.`,
    `Per rispondere usa «Rispondi»: la risposta va a chi ha scritto (${rispondiA || da}).${coordinatoreInCopia ? ' Il coordinatore è in copia.' : ''}`,
    '',
    '---------- Messaggio inoltrato ----------',
    `Da: ${chi}`,
    data ? `Data: ${data}` : null,
    a ? `A: ${a}` : null,
    cc ? `Cc: ${cc}` : null,
    `Oggetto: ${oggetto}`,
    '',
    String(corpo || '').trim() || '(messaggio senza testo)',
    '',
    allegati.length ? `Allegati: ${allegati.join(', ')}` : null,
    omessi.length ? `Non allegati perché troppo pesanti (sono nella casella dell'ufficio, chiedili alla segreteria): ${omessi.join(', ')}` : null,
    '',
    'Questa mail è automatica: le risposte ai verbali tornano alla casella da cui i verbali partono, e da lì non le vedresti.',
  ].filter((r) => r !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ============================================================
   I RINGRAZIAMENTI DIVENTANO GRADIMENTO (26/10/2026).

   Chiesto dall'utente: a cptpd@did arrivano ringraziamenti per le visite
   («Ringrazio per il prezioso lavoro svolto») da chi non passa dal
   questionario. Fin qui la segreteria apriva il pulsante «Valuta la visita»
   della mail e compilava il questionario al posto dell'impresa, per non
   perdere l'apprezzamento. Ora il giro orario lo registra da solo in
   s_questionari_sopralluogo, fonte 'mail', agganciato alla visita, col testo
   di chi ha scritto e SENZA VOTO: il voto non l'ha dato nessuno, e non si
   inventa. A chi ha scritto non si risponde (decisione dell'utente): la mail
   va comunque al tecnico, come ogni risposta al verbale, e ci pensa lui.

   Nel dubbio si preferisce registrare: un ringraziamento perso non si
   recupera, una riga di troppo la segreteria la segna «Scartato».
   ============================================================ */

/* la parte che ha scritto chi risponde, senza la mail citata sotto */
const CITAZIONE_RE = new RegExp('^\\s*(?:'
  + '>|-{2,}\\s*(?:original|messaggio|forwarded|inoltrato)|_{5,}|'
  + '(?:da|from|inviato|sent|data|date|oggetto|subject)\\s*:|'
  + 'il (?:giorno )?.{0,80}ha scritto\\s*:?\\s*$|on .{0,120}wrote\\s*:?\\s*$|'
  + 'inviato da (?:outlook|il mio|iphone|android|libero|yahoo)|sent from (?:my|outlook))', 'i');
export function testoNuovo(corpo) {
  const righe = String(corpo || '').replace(/\r/g, '').split('\n');
  const fine = righe.findIndex((r) => CITAZIONE_RE.test(r));
  return (fine === -1 ? righe : righe.slice(0, fine)).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const GRAZIE_RE = /\b(?:grazie|ringrazi\w*|apprezz\w*|complimenti|gentilissim\w*)\b/i;
/* chi contesta o segnala un errore nel verbale non sta ringraziando, anche se
   comincia con «grazie». Le richieste invece non escludono: nel dubbio si
   registra, e la segreteria scarta la riga di troppo */
const NON_GRAZIE_RE = /\b(?:errat\w*|sbagliat\w*|errore|errori|contest\w*|reclam\w*|non (?:siamo|sono) d'accordo|rettific\w*|annullare)\b/i;

/* è un ringraziamento da registrare? Il grazie deve stare all'inizio del
   testo nuovo (nei primi 300 caratteri): un «grazie» in fondo a una mail
   lunga è cortesia, non apprezzamento */
export function ringraziamento(corpo) {
  const t = testoNuovo(corpo);
  if (!t) return false;
  const m = GRAZIE_RE.exec(t);
  if (!m || m.index > 300) return false;
  return !NON_GRAZIE_RE.test(t);
}

/* la riga per s_questionari_sopralluogo: niente voto, niente motivi, niente
   azione dopo — solo quello che c'è scritto, e da dove viene */
export function rigaGradimento({ gmailId, ricevutaIl, mittente = '', da = '', corpo = '', nr = '', visita = null, tecnico = '' }) {
  const testo = testoNuovo(corpo).slice(0, 4000);
  const chi = mittente && mittente !== da ? `${mittente} <${da}>` : da;
  return {
    fonte: 'mail',
    submission_id: `mail:${gmailId}`,
    timestamp_modulo: ricevutaIl,
    stato: 'ricevuto',
    visita_id: visita?.visita_id || null,
    nr_verbale: nr || null,
    data_visita: visita?.data_visita || null,
    tecnico: tecnico || null,
    commento: testo || null,
    riferimento_esito: visita?.visita_id ? 'agganciato' : 'verbale non trovato',
    note_ufficio: `Ringraziamento arrivato per mail a cptpd@did${chi ? ` da ${chi}` : ''}, registrato dal giro delle risposte ai verbali. Nessun voto: chi ha scritto non ha compilato il questionario. La mail è stata girata al tecnico; a chi ha scritto non si risponde.`,
    aggiornato_da: 'risposte-verbali',
  };
}
