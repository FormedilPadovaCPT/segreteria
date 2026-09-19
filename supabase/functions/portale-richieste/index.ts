// Supabase Edge Function – portale-richieste
//
// LA LAVORAZIONE DEI MODULI DEL PORTALE SERVIZI (12-13/09/2026).
//
// Storia in breve. Fino al 12/09/2026 ogni modulo del portale pubblico faceva
// quattro passaggi: portale → Apps Script → foglio Google → import delle 6:30 →
// tabelle. Il foglio non aggiungeva niente ed era il punto piu' fragile (ad
// agosto il deployment Apps Script e' rimasto morto cinque settimane). Il
// 12-13/09 i moduli sono passati alla «strada diretta» verso questa funzione;
// il 13/09 alla cassetta delle lettere sul progetto Supabase Servizi; lo stesso
// giorno, su decisione dell'utente, FOGLIO GOOGLE E APPS SCRIPT SONO STATI
// SPENTI: il numero di ricevuta lo da' solo il database, e sul foglio non si
// scrive piu' niente.
//
// I nove moduli (tabella MODULI, sotto):
//   seg  Segnalazione Cantiere      → s_segnalazioni             (foto)
//   not  Notifica Cantiere          → s_notifiche_cantiere
//   cons Richiesta Consulenza       → s_consulenze
//   vis  Visita in Cantiere         → s_visite_richieste (tab_origine visita)
//   conf Conferenza di Cantiere     → s_conferenze_cantiere
//   att  Attestazione DM 132/2024   → s_attestazioni_dm132
//   rlst Affidamento RLST           → s_rlst_pratiche            (verbale PDF)
//   rls  Comunicazione RLS          → s_rls_anagrafe             (verbale e formazione PDF)
//   qst  Questionario Sopralluogo   → s_questionari_sopralluogo
// La mappa dei campi di ogni modulo e' quella che usavano l'import delle 6:30
// e Apps Script: e' cambiata la strada, non il dato. I PDF di riepilogo li
// genera l'app segreteria al protocollo (deciso dall'utente).
//
// DA DOVE ARRIVANO LE RICHIESTE. Il portale le manda alla cassetta delle lettere
// sul progetto Servizi (funzione portale-ricevi), che non ha ne' la chiave di
// questo database ne' quella Google: il codice raggiungibile da internet non
// deve avere in mano tutto. Questa funzione va a prendere le richieste, e da
// fuori accetta solo due chiamate con la parola d'ordine
// (X-Cassetta-Token = s_config.cassetta_token):
//   { ritira: <submission_id> }  il campanello della cassetta, a richiesta arrivata
//   { giro: true }               il giro di pg_cron ogni 3 minuti (job ritiro-cassetta)
// I dati si leggono dalla cassetta (cassetta-consegna), mai dal corpo della
// chiamata; a lavorazione finita la cassetta cancella dati e allegati.
// La vecchia porta pubblica di questa funzione e' governata da
// s_config.portale_diretto_pubblico: con «no» (dal 13/09/2026) risponde
// «riprovabile» e la richiesta resta sul telefono, che dopo il ricaricamento
// della pagina la manda alla cassetta.
//
// Che cosa fa, in quest'ordine (si scrive prima e si elabora dopo):
//  1. SCATOLA NERA  — il payload (senza base64) in s_portale_ricezioni,
//                     prima di qualunque altra cosa
//  2. PRATICA       — subito nella tabella del modulo, col numero di ricevuta
//                     (progressivo, dal database) e la pre-istruttoria (CEIV,
//                     persona, tecnico di zona)
//  3. FILE          — foto della segnalazione, PDF di RLST e RLS: su Drive in
//                     SERVIZI/PDF_ricevuti, uno per volta, ognuno salvato
//  4. MAIL          — scheda pratica alla segreteria, conferma a chi scrive
//                     (grafica v4.6 di Apps Script, vedi mail.ts)
//
// Il reinvio e' sicuro: lo stesso submission_id ritrova la pratica e fa solo
// quel che manca (portale_esito dice che cosa e' gia' fatto). Se un file non
// si salva si risponde «riprovabile» dicendo il numero gia' assegnato; la
// cassetta ripresenta la richiesta al giro dopo.
//
// ⚠️ UNA LAVORAZIONE ALLA VOLTA PER OGNI INVIO (12/09/2026, dalla prima prova).
// Lo stesso invio puo' arrivare due volte INSIEME (campanello e giro, o il
// modulo e la coda del telefono): senza prenotazione tutte e due le lavorazioni
// facevano tutto — due foto, due mail alla segreteria, due conferme. La
// prenotazione si prende con un UPDATE condizionato
// (s_portale_ricezioni.lavorazione_dal), che Postgres esegue una riga alla
// volta. Chi arriva secondo aspetta che il primo finisca e risponde col suo
// numero; se il primo muore, la prenotazione scade dopo 2 minuti.
//
// Risposta (letta dalla cassetta, stessa forma di Apps Script):
//   { status:'ok', progressivo, submission_id, duplicato, email }
//   { status:'error', riprovabile:true|false, message }
//
// BATTITO: { battito:true } + intestazione X-Token (s_config.portale_battito_token)
//   verifica davvero database, cartella dei file, delega Gmail e cassetta,
//   e solo se tutto risponde scrive s_config.portale_diretto_battito_al.
//   Lo chiama pg_cron alle 05:20 UTC (job battito-portale-diretto).
//
// verify_jwt = false, di proposito: le chiamate arrivano da un'altra funzione
// e da pg_cron, e la porta la chiudono le parole d'ordine. Difese della
// revisione di sicurezza del 13/09/2026: tetto contato dal database
// (s_portale_quota), dimensione per modulo, solo le chiavi che il modulo usa
// (con i testi tagliati) nella scatola nera e nella mail, foto e PDF
// controllati sul contenuto, conferma a testo fisso e al massimo 3 al giorno
// per indirizzo.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (lo stesso delle altre funzioni)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getToken, SCOPE_DRIVE, SCOPE_GMAIL } from '../_shared/google.ts'
import { EMAIL_UFFICIO, mailConferma, mailInterna, messaggioMime } from './mail.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_CARATTERI = 28 * 1024 * 1024   // tetto assoluto: RLS, due PDF da 8 MB in base64
/* tetto per modulo sul corpo intero: solo chi porta allegati ha bisogno di MB.
   Prima valeva 28 MB per tutti, e 28 MB di dati inventati su un questionario
   finivano nella scatola nera (revisione di sicurezza 13/09/2026) */
const MAX_CARATTERI_MODULO: Record<string, number> = {
  rls: 28 * 1024 * 1024, rlst: 16 * 1024 * 1024, seg: 20 * 1024 * 1024, not: 768 * 1024,
}
const MAX_CARATTERI_ALTRI = 256 * 1024
const MAX_ORA = 60                        // richieste nuove in un'ora, per tutti
const MAX_ORA_IP = 15                     // ...e dallo stesso indirizzo IP
const MAX_CONFERME_GIORNO = 3             // mail di conferma allo stesso indirizzo in 24 ore
const MAX_ORA_CASSETTA = 120              // richieste nuove in un'ora dalla cassetta (difesa in profondita')
const MAX_FOTO = 3
const MAX_FOTO_BYTE = 6 * 1024 * 1024
const MAX_ALLEGATO_BYTE = 12 * 1024 * 1024
const MAX_TESTO = 4000
const MAX_ELENCO = 30                     // figure professionali / imprese di una notifica
const EMAIL_VALIDA = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[A-Za-z]{2,}$/

type Dati = Record<string, unknown>
type SB = ReturnType<typeof createClient>
type Pratica = { id: number; progressivo: number; portale_esito: Dati | null }
type Foto = { nome: string; mime: string; ext: string; byte: Uint8Array }

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
/* rifiuto = insistere non serve; intoppo = riprovando puo' passare */
const rifiuto = (message: string) => json({ status: 'error', riprovabile: false, message }, 400)
const intoppo = (message: string, status = 503) => json({ status: 'error', riprovabile: true, message }, status)

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const testo = (v: unknown, max = MAX_TESTO): string | null => {
  const t = String(v ?? '').trim()
  return t ? t.slice(0, max) : null
}
const maiuscolo = (v: unknown, max = 20) => testo(v, max)?.toUpperCase() ?? null
const cella = (v: unknown, max = MAX_TESTO) => testo(v, max) || ''
const istante = (v: unknown): string => {
  const d = new Date(String(v || ''))
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/* Data del modulo (input type=date → aaaa-mm-gg) per una colonna date. Un
   valore non valido diventa vuoto, non un errore: altrimenti l'inserimento
   fallirebbe a ogni reinvio e la richiesta non entrerebbe mai. Il valore
   com'era arrivato resta nella scatola nera. */
function dataIso(v: unknown): string | null {
  const t = String(v ?? '').trim()
  let a: number, me: number, g: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  const ita = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (iso) { a = +iso[1]; me = +iso[2]; g = +iso[3] } else if (ita) { g = +ita[1]; me = +ita[2]; a = +ita[3] } else return null
  const d = new Date(Date.UTC(a, me - 1, g))
  if (a < 1900 || a > 2100 || d.getUTCFullYear() !== a || d.getUTCMonth() !== me - 1 || d.getUTCDate() !== g) return null
  return `${a}-${String(me).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}
/* «gg/mm/aaaa», la forma testuale che le colonne di testo hanno sempre avuto
   (la scriveva Apps Script sul foglio e l'import la copiava) */
const dataGiorno = (v: unknown) => { const d = dataIso(v); return d ? d.split('-').reverse().join('/') : cella(v, 40) }

/* Figure professionali e imprese della notifica: elenchi JSON dal portale.
   Si tengono solo oggetti con testi brevi; un elenco illeggibile non blocca
   la notifica, si perde solo l'elenco. */
function elenco(v: unknown): Dati[] | null {
  let a: unknown = v
  if (typeof v === 'string') { try { a = JSON.parse(v) } catch { return null } }
  if (!Array.isArray(a)) return null
  const out = a.slice(0, MAX_ELENCO).map((o) => {
    const r: Dati = {}
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      for (const [k, x] of Object.entries(o as Dati).slice(0, 20)) {
        const t = testo(x, 300)
        if (t && /^[a-z_]{1,40}$/.test(k)) r[k] = t
      }
    }
    return r
  }).filter((r) => Object.keys(r).length)
  return out.length ? out : null
}

function partiRoma(d = new Date()) {
  const p = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const v = (t: string) => p.find((x) => x.type === t)?.value || ''
  return { g: v('day'), m: v('month'), a: v('year'), h: v('hour'), mi: v('minute'), s: v('second') }
}
const stampino = () => { const r = partiRoma(); return `${r.a}${r.m}${r.g}_${r.h}${r.mi}` }
const sanitize = (v: unknown, riserva = 'cantiere') => (String(v || '').replace(/[^a-zA-Z0-9]/g, '_') || riserva).substring(0, 40)

/* ══ LA MAPPA DEI CAMPI ═══════════════════════════════════════════════════
   Una «spec» dice da quale campo del portale viene un valore e come va
   letto: «chiave», oppure «tipo:chiave». Piu' chiavi separate da | = la
   prima compilata (il portale manda alcuni dati con due nomi).
     (niente)  testo            data    data vera (colonna date)
     giorno    «gg/mm/aaaa»     cf      codice fiscale valido o vuoto
     maiusc    maiuscolo        intero  solo cifre, come numero
     scala     voto da 1 a 5    elenco  elenco JSON pulito
   Nelle liste «campi» compaiono anche #ts, #prog, #foto, #url:… : erano le
   colonne calcolate del foglio, e soloNote le salta. */
type Spec = string
function parti(spec: Spec): [string, string] {
  const i = spec.indexOf(':')
  return i < 0 ? ['', spec] : [spec.slice(0, i), spec.slice(i + 1)]
}
function leggi(d: Dati, chiavi: string): unknown {
  for (const k of chiavi.split('|')) {
    const v = d[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}
function perDb(d: Dati, spec: Spec): unknown {
  const [tipo, chiavi] = parti(spec)
  const v = leggi(d, chiavi)
  switch (tipo) {
    case 'data': return dataIso(v)
    case 'giorno': return v === undefined ? null : dataGiorno(v) || null
    case 'cf': { const t = maiuscolo(v); return t && /^[A-Z0-9]{16}$/.test(t) ? t : null }
    case 'maiusc': return maiuscolo(v)
    case 'intero': return Number(String(v ?? '').replace(/\D/g, '').slice(0, 9)) || null
    case 'scala': { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null }
    case 'elenco': return elenco(v)
    /* json: arriva come stringa e va in una colonna jsonb. Se non si legge,
       null: una risposta storta non deve far cadere l'intera richiesta. */
    case 'json': {
      if (typeof v !== 'string' || v.length > 20000) return null
      try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : null } catch { return null }
    }
    default: return testo(v)
  }
}

/* ── il questionario e la visita a cui si riferisce ───────────────────────
   Il link «Valuta la visita» della mail del verbale porta un riferimento
   firmato (V2526-0874.<firma>). Il portale non lo verifica — non ha il segreto
   e non lo deve avere — quindi il controllo e' qui, con questionario_verifica.
   ⚠️ Se la firma non torna la risposta NON si butta: si salva senza visita, e
   riferimento_esito dice perche'. Perdere un giudizio e' peggio che tenerne uno
   non agganciato (regola del 04/09 su da che parte sbagliare).
   Quando invece l'aggancio riesce, tecnico e data li scrive la VISITA, non chi
   compila: di quei due campi il database sa piu' di lui. */
async function agganciaVisita(sb: SB, d: Dati): Promise<Dati> {
  const rif = String(d.riferimento ?? '').trim()
  if (!rif) return { riferimento_esito: 'senza invito' }
  const { data, error } = await sb.rpc('questionario_verifica', { p_riferimento: rif.slice(0, 200) })
  if (error) return { riferimento_esito: 'verifica non riuscita: ' + error.message }
  const r = (Array.isArray(data) ? data[0] : data) as Dati | undefined
  if (!r || r.esito !== 'agganciato') return { riferimento_esito: String(r?.esito || 'non agganciato') }
  return {
    visita_id: r.visita_id, nr_verbale: r.nr_verbale, riferimento_esito: 'agganciato',
    ...(r.tecnico ? { tecnico: r.tecnico } : {}),
    ...(r.data_visita ? { data_visita: r.data_visita } : {}),
  }
}

/* ── il questionario di un evento e l'evento a cui si riferisce ───────────
   Il QR del foglio in coda al registro porta un riferimento firmato
   (214-KPQ7.<firma>). Il portale non lo verifica — non ha il segreto e non lo
   deve avere — quindi il controllo e' qui, con quest_verifica.
   ⚠️ Anche qui la risposta non si butta mai: fuori finestra o oltre il tetto
   entra con oltre_tetto = true e resta fuori dalle statistiche; se la firma
   non torna si salva senza evento, e riferimento_esito dice perche'. */
async function agganciaEvento(sb: SB, d: Dati): Promise<Dati> {
  const rif = String(d.riferimento ?? '').trim()
  if (!rif) return { riferimento_esito: 'senza invito' }
  const { data, error } = await sb.rpc('quest_verifica', { p_riferimento: rif.slice(0, 200) })
  if (error) return { riferimento_esito: 'verifica non riuscita: ' + error.message }
  const r = (Array.isArray(data) ? data[0] : data) as Dati | undefined
  if (!r || r.esito !== 'agganciato') return { riferimento_esito: String(r?.esito || 'non agganciato') }
  /* ⚠️ Solo campi che sono COLONNE della tabella: quel che torna di qui
     finisce dritto nella riga. Il titolo dell'evento non serve — la mail
     interna per un modulo anonimo non parte — e come colonna non esiste. */
  return {
    corso_id: r.corso_id,
    oltre_tetto: r.oltre_tetto === true,
    riferimento_esito: r.oltre_tetto === true ? 'agganciato, fuori conteggio' : 'agganciato',
  }
}

/* ── la prova del test finale ──────────────────────────────────────────────
   Il test e' NOMINATIVO: chi risponde si e' riconosciuto col proprio codice
   personale, quello stampato accanto al nome sul registro. Qui si verifica la
   firma del link, si ritrova la persona e si CORREGGE — le risposte giuste
   stanno nel Gestionale e non sono mai uscite.
   ⚠️ Una prova che non si riconosce non si butta: entra senza persona, e
   riferimento_esito dice perche'. Un elaborato perso non si recupera. */
async function agganciaTest(sb: SB, d: Dati): Promise<Dati> {
  const rif = String(d.riferimento ?? '').trim()
  let risposte: unknown = {}
  try { risposte = typeof d.risposte === 'string' ? JSON.parse(d.risposte) : (d.risposte ?? {}) } catch { risposte = {} }
  const { data, error } = await sb.rpc('test_consegna', {
    p_riferimento: rif.slice(0, 200),
    p_codice_personale: String(d.codice_personale ?? '').slice(0, 20),
    p_risposte: risposte,
  })
  if (error) return { riferimento_esito: 'correzione non riuscita: ' + error.message }
  const r = (data ?? {}) as Dati
  if (r.esito !== 'riconosciuta') {
    return { riferimento_esito: String(r.esito ?? 'non riconosciuta'),
      ...(r.corso_id ? { corso_id: r.corso_id } : {}) }
  }
  return {
    corso_id: r.corso_id, iscritto_id: r.iscritto_id, nominativo: r.nominativo,
    punteggio: r.punteggio, punteggio_max: r.punteggio_max, percentuale: r.percentuale,
    da_correggere: r.da_correggere, esito: r.stato, riferimento_esito: 'riconosciuta',
  }
}

/* ── il TEST scritto dal DOCENTE (19/09/2026) ──────────────────────────────
   Chiesto dall'utente: il docente del corso deve poter caricare il test, anche
   passando dalla segreteria. Arriva da un LINK TARGATO, come l'iscrizione;
   quello che manda NON diventa il test — diventa una proposta che la
   segreteria porta dentro con dtest_accetta.
   ⚠️ Se l'invito non e' valido (firma sbagliata, revocato, scaduto) la
   proposta si salva LO STESSO, col motivo scritto: chi ha compilato in buona
   fede non deve perdere il lavoro (regola del 04/09 su da che parte sbagliare).
   ⚠️ L'invito si segna «consegnato» QUI, un attimo prima che la riga venga
   scritta: se l'inserimento fallisse resterebbe un invito consegnato senza
   proposta, che si vede a colpo d'occhio nell'elenco — il contrario (proposta
   arrivata e invito ancora «in attesa») farebbe credere che il docente non
   abbia risposto. */
async function agganciaPropostaTest(sb: SB, d: Dati): Promise<Dati> {
  const rif = String(d.riferimento ?? '').trim()
  const { data, error } = await sb.rpc('dtest_verifica', { p_riferimento: rif.slice(0, 200) })
  if (error) return { riferimento_esito: 'verifica non riuscita: ' + error.message }
  const r = (Array.isArray(data) ? data[0] : data) as Dati | undefined
  if (!r || r.esito !== 'agganciato') {
    /* il corso lo conserviamo lo stesso quando l'invito esiste ma e' chiuso:
       serve alla segreteria per ritrovare la proposta */
    return {
      riferimento_esito: String(r?.esito || 'non agganciata'),
      ...(r?.corso_id ? { corso_id: r.corso_id, invito_id: r.invito_id, nominativo: r.nominativo } : {}),
      ...(r?.parte_id ? { parte_id: r.parte_id } : {}),
    }
  }
  await sb.rpc('dtest_segna_consegnato', { p_invito_id: r.invito_id })
  return {
    corso_id: r.corso_id, invito_id: r.invito_id, nominativo: r.nominativo,
    /* l'invito puo' riguardare un MODULO: la proposta se lo porta dietro, e
       le domande finiranno in quella verifica e non nel mucchio del corso */
    ...(r.parte_id ? { parte_id: r.parte_id } : {}),
    riferimento_esito: 'agganciata',
  }
}

/* ── l'iscrizione a un evento ──────────────────────────────────────────────
   Un motore solo per due porte: l'elenco pubblico dei corsi aperti e il link
   targato che la segreteria manda all'impresa dopo una conferenza. La prova
   di chi puo' iscriversi la fa iscr_verifica nel Gestionale: firma valida,
   oppure evento messo in vetrina.
   ⚠️ Chiuse o piene, l'iscrizione entra lo stesso (oltre_tetto = true) e la
   segreteria decide: perdere chi ha fatto in tempo per un secondo sarebbe il
   modo peggiore di sbagliare. */
async function agganciaIscrizione(sb: SB, d: Dati): Promise<Dati> {
  const rif = String(d.riferimento ?? '').trim()
  const { data, error } = await sb.rpc('iscr_verifica', { p_riferimento: rif.slice(0, 200) })
  if (error) return { riferimento_esito: 'verifica non riuscita: ' + error.message }
  const r = (Array.isArray(data) ? data[0] : data) as Dati | undefined
  if (!r || r.esito !== 'agganciato') return { riferimento_esito: String(r?.esito || 'non agganciato') }

  /* l'impresa si riconosce come in tutti gli altri moduli: P.IVA, poi CEIV.
     Se si iscrive una persona per se', non c'e' impresa da riconoscere. */
  const perConto = String(d.per_conto ?? '').toLowerCase() === 'persona' ? 'persona' : 'impresa'
  const out: Dati = {
    corso_id: r.corso_id,
    per_conto: perConto,
    riferimento_esito: r.aperto === true ? 'agganciato' : 'agganciato, iscrizioni chiuse o al completo',
  }
  if (perConto === 'impresa') {
    const piva = pivaNorm(d.piva) || pivaNorm(d.partita_iva) || pivaNorm(d.cf_impresa)
    const e = await esitoCeiv(sb, piva)
    out.partita_iva = piva || testo(d.piva, 30)
    out.impresa_id = e.impresa_id
    out.esito_ceiv = e.esito_ceiv
    out.ceiv_verificato_il = e.ceiv_verificato_il
  }
  return out
}

/* ── pre-istruttoria: le stesse regole che aveva import-rlst ─────────────── */
function normComune(v: string): string {
  return String(v || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim()
}
/* tecnico di zona: vince la zona PIU' SPECIFICA (i quartieri di Padova
   battono «PADOVA»); con due candidati alla pari non si sceglie */
async function propostaTecnico(sb: SB, comune: unknown): Promise<string | null> {
  const c = normComune(String(comune || ''))
  if (!c) return null
  const { data: zone } = await sb.from('tecnici_zone').select('email, comune_nome')
  const match = (zone || []).filter((z) => {
    const zc = normComune(z.comune_nome as string)
    return zc === c || c.startsWith(zc + ' ') || zc.startsWith(c + ' ')
  })
  if (!match.length) return null
  const maxLen = Math.max(...match.map((z) => normComune(z.comune_nome as string).length))
  const email = [...new Set(match.filter((z) => normComune(z.comune_nome as string).length === maxLen).map((z) => z.email as string))]
  return email.length === 1 ? email[0] : null
}
function pivaNorm(v: unknown): string | null {
  const t = String(v || '')
  const m = t.match(/\d{10,11}/)
  if (m) return m[0].padStart(11, '0')
  const cifre = t.replace(/\D/g, '')
  if (cifre.length >= 8 && cifre.length <= 11) return cifre.padStart(11, '0')
  return null
}
/* CEIV: impresa non in anagrafica → da_verificare, MAI non_iscritta: l'assenza non e' una prova */
async function esitoCeiv(sb: SB, piva: string | null): Promise<{ impresa_id: string | null; esito_ceiv: string; ceiv_verificato_il: string }> {
  let impresaId: string | null = null
  let esito = 'da_verificare'
  if (piva) {
    const { data: imp } = await sb.from('imprese').select('impresa_id, cod_ceiv, stato_cassa').eq('impresa_id', piva).maybeSingle()
    if (imp) {
      impresaId = imp.impresa_id as string
      const ceivOk = !!(imp.cod_ceiv && String(imp.cod_ceiv).trim())
      esito = ceivOk && /attiv/i.test((imp.stato_cassa as string) || '') ? 'iscritta' : 'non_iscritta'
    }
  }
  return { impresa_id: impresaId, esito_ceiv: esito, ceiv_verificato_il: new Date().toISOString() }
}
/* persona per codice fiscale: solo se ce n'e' UNA */
async function personaPerCf(sb: SB, cf: unknown): Promise<string | null> {
  if (!cf) return null
  const { data } = await sb.from('persone').select('persona_id').eq('cf', cf).limit(2)
  return data && data.length === 1 ? (data[0].persona_id as string) : null
}
/* moduli d'impresa: P.IVA (o CF impresa), CEIV, persona dal CF indicato */
const conImpresa = (chiaveCf: string, ceiv = true) => async (sb: SB, d: Dati): Promise<Dati> => {
  const piva = pivaNorm(d.piva) || pivaNorm(d.cf_impresa)
  const e = await esitoCeiv(sb, piva)
  const r: Dati = {
    partita_iva: piva || testo(d.piva, 30),
    impresa_id: e.impresa_id,
    persona_id: await personaPerCf(sb, perDb(d, 'cf:' + chiaveCf)),
  }
  if (ceiv) { r.esito_ceiv = e.esito_ceiv; r.ceiv_verificato_il = e.ceiv_verificato_il }
  return r
}
/* i quattro cantieri dell'attestazione DM 132 */
function cantieriC(d: Dati): Dati[] | null {
  const out: Dati[] = []
  for (const n of [1, 2, 3, 4]) {
    const c: Dati = {}
    for (const k of ['indirizzo', 'comune', 'importo', 'committente', 'durata', 'qualita']) c[k] = testo(d[`c${n}_${k}`], 300)
    if (Object.values(c).some(Boolean)) out.push(c)
  }
  return out.length ? out : null
}
const cantiereC = (n: number): [string, Spec][] => [
  [`C${n} INDIRIZZO`, `c${n}_indirizzo`], [`C${n} COMUNE`, `c${n}_comune`], [`C${n} IMPORTO`, `c${n}_importo`],
  [`C${n} COMMITTENTE`, `c${n}_committente`], [`C${n} DURATA`, `c${n}_durata`], [`C${n} QUALITÀ`, `c${n}_qualita`],
]

/* ══ I MODULI ════════════════════════════════════════════════════════════
   tabella   dove nasce la pratica
   filtro    colonne fisse che distinguono la serie dei numeri (visite)
   colonne   colonna della tabella → spec
   extra     pre-istruttoria e valori calcolati
   campi     [intestazione, spec]: le colonne della vecchia scheda del foglio
             (spento il 13/09/2026). Restano perche' dicono quali campi il
             modulo manda: soloNote li lascia passare interi, e la mail alla
             segreteria li mostra
   foto      la segnalazione porta foto
   file      PDF allegati: <base>_base64 + <base>_nome → colonna della tabella */
type File = { base: string; prefisso: string; colonna: string; etichetta: string }
type Modulo = {
  tabella: string
  filtro?: Record<string, string>
  obbligatori: string[]
  chi: string
  colonne: Record<string, Spec>
  extra?: (sb: SB, d: Dati) => Promise<Dati>
  campi: [string, Spec][]
  foto?: boolean
  file?: File[]
  /* anonimo: la richiesta non deve poter essere ricondotta a chi l'ha
     mandata, nemmeno dall'ORA. Il modulo salta timestamp_modulo, non mette
     istanti in portale_esito e non conserva il contenuto nella scatola nera:
     l'ora di invio, incrociata con l'ordine delle firme sul registro,
     rimetterebbe il nome sopra la risposta (questionario di evento, 18/09/2026). */
  anonimo?: boolean
  /* silenzioso: niente mail alla segreteria per ogni richiesta. Non c'entra
     la riservatezza (quella e' «anonimo»): dopo un test in aula sarebbero
     venti messaggi in dieci minuti, e quel che serve si guarda dalla scheda
     del corso. */
  silenzioso?: boolean
}

const MODULI: Record<string, Modulo> = {
  seg: {
    tabella: 's_segnalazioni',
    obbligatori: ['indirizzo_cantiere', 'comune_cantiere'],
    chi: 'notifica',
    colonne: {
      notificante: 'notifica', telefono: 'telefono', email: 'email', ind_cantiere: 'indirizzo_cantiere',
      comune_cantiere: 'comune_cantiere', motivo: 'motivo', stato_lavori: 'stato_lavori',
      imprese_presenti: 'imprese_presenti', note_modulo: 'note', privacy: 'privacy',
    },
    extra: async (sb, d) => ({ tecnico_proposto: await propostaTecnico(sb, d.comune_cantiere) }),
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['NOTIFICANTE', 'notifica'], ['TELEFONO', 'telefono'],
      ['E-MAIL', 'email'], ['IND. CANTIERE', 'indirizzo_cantiere'], ['COMUNE CANTIERE', 'comune_cantiere'],
      ['MOTIVO', 'motivo'], ['STATO LAVORI', 'stato_lavori'], ['IMPRESE PRESENTI', 'imprese_presenti'],
      ['NOTE', 'note'], ['FOTO URL', '#foto'], ['PRIVACY', 'privacy']],
    foto: true,
  },

  /* notifica: «rl_» e' il RESPONSABILE DEI LAVORI, non il legale
     rappresentante; il CEIV si controlla sulla P.IVA del committente */
  not: {
    tabella: 's_notifiche_cantiere',
    obbligatori: ['indirizzo_cantiere', 'comune_cantiere'],
    chi: 'ragione_sociale|cognome',
    colonne: {
      data_com: 'data:data_comunicazione', ragione_sociale: 'ragione_sociale', seg_titolo: 'titolo',
      seg_cognome: 'cognome', seg_nome: 'nome', seg_cf: 'maiusc:codice_fiscale', email: 'email', telefono: 'telefono',
      ind_cantiere: 'indirizzo_cantiere', comune_cantiere: 'comune_cantiere', data_inizio: 'data:data_inizio',
      data_fine: 'data:data_fine', importo: 'importo_lavori', durata_gg: 'durata_giorni', max_lavoratori: 'max_lavoratori',
      n_imprese: 'num_imprese', n_autonomi: 'num_autonomi', note_cantiere: 'note_cantiere', comm_tipo: 'committente_tipo',
      comm_ragione_sociale: 'committente_ragione_sociale', comm_cf: 'maiusc:committente_cf',
      comm_indirizzo: 'committente_indirizzo', comm_tel: 'committente_telefono', comm_email: 'committente_email',
      comm_titolo: 'committente_titolo', comm_cognome: 'committente_cognome', comm_nome: 'committente_nome',
      comm_cf2: 'maiusc:committente_cf_persona', comm_ind2: 'committente_indirizzo_persona',
      comm_com2: 'committente_comune_persona', comm_tel2: 'committente_telefono_persona', rl_titolo: 'rl_titolo',
      rl_nome: 'rl_nome', rl_cognome: 'rl_cognome', rl_cf: 'maiusc:rl_cf', rl_indirizzo: 'rl_indirizzo',
      rl_comune: 'rl_comune', rl_note: 'rl_note', figure: 'elenco:figure_json', imprese: 'elenco:imprese_json',
      privacy: 'privacy',
    },
    extra: async (sb, d) => {
      const piva = pivaNorm(d.committente_piva)
      return { comm_piva: piva || testo(d.committente_piva, 30), ...(await esitoCeiv(sb, piva)),
        tecnico_proposto: await propostaTecnico(sb, d.comune_cantiere) }
    },
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['DATA COM.', 'data:data_comunicazione'],
      ['RAGIONE SOC.', 'ragione_sociale'], ['TITOLO', 'titolo'], ['COGNOME', 'cognome'], ['NOME', 'nome'],
      ['CF', 'maiusc:codice_fiscale'], ['E-MAIL', 'email'], ['TELEFONO', 'telefono'], ['IND. CANTIERE', 'indirizzo_cantiere'],
      ['COMUNE CANTIERE', 'comune_cantiere'], ['DATA INIZIO', 'data:data_inizio'], ['DATA FINE', 'data:data_fine'],
      ['IMPORTO', 'importo_lavori'], ['DURATA GG', 'durata_giorni'], ['MAX LAV.', 'max_lavoratori'],
      ['N. IMPRESE', 'num_imprese'], ['N. AUTONOMI', 'num_autonomi'], ['NOTE CANTIERE', 'note_cantiere'],
      ['COMM. TIPO', 'committente_tipo'], ['COMM. RAG. SOC.', 'committente_ragione_sociale'],
      ['COMM. PIVA', 'committente_piva'], ['COMM. CF', 'maiusc:committente_cf'], ['COMM. IND.', 'committente_indirizzo'],
      ['COMM. TEL', 'committente_telefono'], ['COMM. EMAIL', 'committente_email'], ['COMM. TITOLO', 'committente_titolo'],
      ['COMM. COGNOME', 'committente_cognome'], ['COMM. NOME', 'committente_nome'],
      ['COMM. CF2', 'maiusc:committente_cf_persona'], ['COMM. IND2', 'committente_indirizzo_persona'],
      ['COMM. COM2', 'committente_comune_persona'], ['COMM. TEL2', 'committente_telefono_persona'],
      ['RL TITOLO', 'rl_titolo'], ['RL NOME', 'rl_nome'], ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'],
      ['RL IND.', 'rl_indirizzo'], ['RL COMUNE', 'rl_comune'], ['RL NOTE', 'rl_note'], ['PRIVACY', 'privacy'],
      ['FIGURE JSON', 'elenco:figure_json'], ['IMPRESE JSON', 'elenco:imprese_json']],
  },

  /* consulenza: la nota del modulo e' anche il quesito */
  cons: {
    tabella: 's_consulenze',
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv', cf_impresa: 'cf_impresa',
      rl_titolo: 'rl_titolo', rl_nome: 'rl_nome', rl_cognome: 'rl_cognome', rl_cf: 'cf:rl_cf', cellulare: 'cellulare',
      email: 'email', rspp_ruolo: 'rspp_ruolo', tipi_consulenza: 'tipi_consulenza', note_modulo: 'note',
      quesito: 'note', privacy: 'privacy',
    },
    extra: conImpresa('rl_cf'),
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['RAGIONE SOCIALE', 'ragione_sociale'],
      ['CODICE CEIV', 'codice_ceiv'], ['PARTITA IVA', 'piva'], ['CF IMPRESA', 'cf_impresa'], ['RL TITOLO', 'rl_titolo'],
      ['RL NOME', 'rl_nome'], ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'], ['CELLULARE', 'cellulare'],
      ['E-MAIL', 'email'], ['RSPP RUOLO', 'rspp_ruolo'], ['TIPI CONSULENZA', 'tipi_consulenza'], ['NOTE', 'note'],
      ['PRIVACY', 'privacy']],
  },

  /* visita: la serie dei numeri e' quella di tab_origine «visita» */
  vis: {
    tabella: 's_visite_richieste',
    filtro: { tab_origine: 'visita' },
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv', cf_impresa: 'cf_impresa',
      ind_legale: 'indirizzo_legale', ind_amm: 'indirizzo_amm', telefono: 'telefono', cellulare: 'cellulare',
      email: 'email', rl_titolo: 'rl_titolo', rl_nome: 'rl_nome', rl_cognome: 'rl_cognome', rl_cf: 'cf:rl_cf',
      rspp_ruolo: 'rspp_ruolo', tipo_visita: 'vis_tipo_visita|tipo_visita', ref_titolo: 'ref_titolo',
      ref_nome: 'ref_nome', ref_cognome: 'ref_cognome', ref_tel: 'ref_telefono|ref_cellulare', note_modulo: 'note',
      privacy: 'privacy',
    },
    extra: async (sb, d) => {
      const c = { indirizzo: testo(d.indirizzo_cantiere, 300), comune: testo(d.comune_cantiere, 200) }
      return { tipo_richiesta: 'visita', cantieri: c.indirizzo || c.comune ? [c] : null,
        ...(await conImpresa('rl_cf')(sb, d)), tecnico_proposto: await propostaTecnico(sb, d.comune_cantiere) }
    },
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['RAGIONE SOCIALE', 'ragione_sociale'],
      ['CODICE CEIV', 'codice_ceiv'], ['PARTITA IVA', 'piva'], ['CF IMPRESA', 'cf_impresa'], ['IND. LEGALE', 'indirizzo_legale'],
      ['IND. AMM.', 'indirizzo_amm'], ['TELEFONO', 'telefono'], ['CELLULARE', 'cellulare'], ['RL TITOLO', 'rl_titolo'],
      ['RL NOME', 'rl_nome'], ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'], ['IND. CANTIERE', 'indirizzo_cantiere'],
      ['COMUNE CANTIERE', 'comune_cantiere'], ['REF TITOLO', 'ref_titolo'], ['REF. NOME', 'ref_nome'],
      ['REF. COGNOME', 'ref_cognome'], ['REF. TEL', 'ref_telefono|ref_cellulare'], ['TIPO VISITA', 'vis_tipo_visita|tipo_visita'],
      ['NOTE', 'note'], ['PRIVACY', 'privacy']],
  },

  conf: {
    tabella: 's_conferenze_cantiere',
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv', cf_impresa: 'cf_impresa',
      ind_legale: 'indirizzo_legale', ind_amm: 'indirizzo_amm', telefono: 'telefono', cellulare: 'cellulare',
      email: 'email', rl_titolo: 'rl_titolo', rl_nome: 'rl_nome', rl_cognome: 'rl_cognome', rl_cf: 'cf:rl_cf',
      rspp_ruolo: 'rspp_ruolo', tipo_richiesta: 'tipo_richiesta', ind_cantiere: 'indirizzo_cantiere',
      comune_cantiere: 'comune_cantiere', ref_titolo: 'ref_titolo', ref_nome: 'ref_nome', ref_cognome: 'ref_cognome',
      ref_tel: 'ref_cellulare|ref_telefono', note_modulo: 'note', privacy: 'privacy',
    },
    extra: async (sb, d) => ({ ...(await conImpresa('rl_cf')(sb, d)), tecnico_proposto: await propostaTecnico(sb, d.comune_cantiere) }),
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['RAGIONE SOCIALE', 'ragione_sociale'],
      ['CODICE CEIV', 'codice_ceiv'], ['PARTITA IVA', 'piva'], ['CF IMPRESA', 'cf_impresa'], ['TELEFONO', 'telefono'],
      ['CELLULARE', 'cellulare'], ['E-MAIL', 'email'], ['IND. LEGALE', 'indirizzo_legale'], ['IND. AMM.', 'indirizzo_amm'],
      ['RL TITOLO', 'rl_titolo'], ['RL NOME', 'rl_nome'], ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'],
      ['RSPP RUOLO', 'rspp_ruolo'], ['TIPO RICHIESTA', 'tipo_richiesta'], ['IND. CANTIERE', 'indirizzo_cantiere'],
      ['COMUNE CANTIERE', 'comune_cantiere'], ['REF TITOLO', 'ref_titolo'], ['REF. COGNOME', 'ref_cognome'],
      ['REF. NOME', 'ref_nome'], ['REF. CELL', 'ref_cellulare|ref_telefono'], ['NOTE', 'note'], ['PRIVACY', 'privacy']],
  },

  att: {
    tabella: 's_attestazioni_dm132',
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv', cassa_edile_prov: 'cassa_edile_provincia',
      cf_impresa: 'cf_impresa', indirizzo: 'indirizzo_impresa', comune: 'comune_impresa', telefono: 'telefono_impresa',
      email: 'email', rl_titolo: 'rl_titolo', rl_nome: 'rl_nome', rl_cognome: 'rl_cognome', rl_cf: 'cf:rl_cf',
      decl_contributi: 'decl_contributi', decl_sicurezza: 'decl_sicurezza', decl_obblighi: 'decl_obblighi',
      privacy: 'privacy',
    },
    extra: async (sb, d) => {
      const cantieri = cantieriC(d)
      return { cantieri, ...(await conImpresa('rl_cf')(sb, d)), tecnico_proposto: await propostaTecnico(sb, cantieri?.[0]?.comune) }
    },
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['RL TITOLO', 'rl_titolo'], ['RL NOME', 'rl_nome'],
      ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'], ['RAGIONE SOCIALE', 'ragione_sociale'], ['PARTITA IVA', 'piva'],
      ['CF IMPRESA', 'cf_impresa'], ['INDIRIZZO', 'indirizzo_impresa'], ['COMUNE', 'comune_impresa'],
      ['TELEFONO', 'telefono_impresa'], ['CODICE CEIV', 'codice_ceiv'], ['CASSA EDILE PROV.', 'cassa_edile_provincia'],
      ...cantiereC(1), ...cantiereC(2), ...cantiereC(3), ...cantiereC(4),
      ['DECL. CONTRIBUTI', 'decl_contributi'], ['DECL. SICUREZZA', 'decl_sicurezza'], ['DECL. OBBLIGHI', 'decl_obblighi'],
      ['PRIVACY', 'privacy']],
  },

  rlst: {
    tabella: 's_rlst_pratiche',
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      data_comp: 'data:data_compilazione', ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv',
      cf_impresa: 'cf_impresa', n_lavoratori: 'intero:num_lavoratori', ccnl: 'ccnl', telefono: 'telefono',
      cellulare: 'cellulare', email: 'email', ind_sede_legale: 'indirizzo_legale', comune_legale: 'comune_legale',
      ind_sede_amm: 'indirizzo_amm', comune_amm: 'comune_amm', rl_titolo: 'rl_titolo', rl_nome: 'rl_nome',
      rl_cognome: 'rl_cognome', rl_cf: 'cf:rl_cf', rspp_nome: 'rspp_nome', rspp_ruolo: 'rspp_ruolo',
      data_verbale: 'giorno:data_verbale', luogo_riunione: 'luogo_riunione', note_modulo: 'note',
    },
    extra: conImpresa('rl_cf'),
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['DATA COMP.', 'data:data_compilazione'],
      ['RAGIONE SOCIALE', 'ragione_sociale'], ['CODICE CEIV', 'codice_ceiv'], ['PARTITA IVA', 'piva'],
      ['CF IMPRESA', 'cf_impresa'], ['N. LAVORATORI', 'num_lavoratori'], ['CCNL', 'ccnl'], ['TELEFONO', 'telefono'],
      ['CELLULARE', 'cellulare'], ['E-MAIL', 'email'], ['IND. SEDE LEGALE', 'indirizzo_legale'],
      ['COMUNE LEGALE', 'comune_legale'], ['IND. SEDE AMM.', 'indirizzo_amm'], ['COMUNE AMM.', 'comune_amm'],
      ['RL TITOLO', 'rl_titolo'], ['RL NOME', 'rl_nome'], ['RL COGNOME', 'rl_cognome'], ['RL CF', 'maiusc:rl_cf'],
      ['RSPP NOME', 'rspp_nome'], ['RSPP RUOLO', 'rspp_ruolo'], ['DATA VERBALE', 'data:data_verbale'],
      ['LUOGO RIUNIONE', 'luogo_riunione'], ['VERBALE URL', '#url:verbale_url'], ['NOTE', 'note'], ['PRIVACY', 'privacy']],
    file: [{ base: 'pdf', prefisso: 'Verbale', colonna: 'verbale_url', etichetta: 'Verbale di riunione' }],
  },

  /* RLS: niente esito CEIV nella tabella; la persona si aggancia sul CF dell'RLS */
  rls: {
    tabella: 's_rls_anagrafe',
    obbligatori: ['ragione_sociale'],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', codice_ceiv_dich: 'codice_ceiv', cf_impresa: 'cf_impresa',
      ind_sede: 'indirizzo_sede', telefono: 'telefono', email: 'email', lr_titolo: 'lr_titolo', lr_nome: 'lr_nome',
      lr_cognome: 'lr_cognome', lr_cf: 'maiusc:lr_cf', tipo_elezione: 'rls_elezione', data_verbale: 'giorno:data_verbale',
      protocollo_verbale: 'protocollo', rls_titolo: 'rls_titolo', rls_nome: 'rls_nome', rls_cognome: 'rls_cognome',
      rls_cf: 'cf:rls_cf', nato_a: 'rls_nato_a', nato_il: 'giorno:rls_nato_il', residenza: 'rls_residenza',
      comune_res: 'rls_comune_residenza', rls_tel: 'rls_telefono', rls_email: 'rls_email',
      indeterminato: 'rls_indeterminato', lul: 'rls_lul', ceiv_operaio: 'rls_ceiv_operaio',
      altra_ce: 'rls_altra_cassa_edile', mansione: 'rls_mansione', data_assunzione: 'giorno:rls_data_assunzione',
      livello_ccnl: 'rls_livello_ccnl', ente_corso: 'rls_ente_corso', op_provincia: 'rls_op_provincia',
      decorrenza: 'data:data_verbale',
    },
    extra: conImpresa('rls_cf', false),
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['RAGIONE SOCIALE', 'ragione_sociale'],
      ['CODICE CEIV', 'codice_ceiv'], ['PARTITA IVA', 'piva'], ['CF IMPRESA', 'cf_impresa'], ['IND. SEDE', 'indirizzo_sede'],
      ['TELEFONO', 'telefono'], ['E-MAIL', 'email'], ['LR TITOLO', 'lr_titolo'], ['LR NOME', 'lr_nome'],
      ['LR COGNOME', 'lr_cognome'], ['LR CF', 'maiusc:lr_cf'], ['DATA VERBALE', 'data:data_verbale'],
      ['PROTOCOLLO', 'protocollo'], ['ELEZIONE', 'rls_elezione'], ['RLS TITOLO', 'rls_titolo'], ['RLS NOME', 'rls_nome'],
      ['RLS COGNOME', 'rls_cognome'], ['RLS CF', 'maiusc:rls_cf'], ['NATO A', 'rls_nato_a'], ['NATO IL', 'data:rls_nato_il'],
      ['RESIDENZA', 'rls_residenza'], ['COMUNE RES.', 'rls_comune_residenza'], ['RLS TEL', 'rls_telefono'],
      ['RLS EMAIL', 'rls_email'], ['INDETERMINATO', 'rls_indeterminato'], ['LUL', 'rls_lul'],
      ['CEIV OPERAIO', 'rls_ceiv_operaio'], ['ALTRA CE', 'rls_altra_cassa_edile'], ['MANSIONE', 'rls_mansione'],
      ['DATA ASSUNZIONE', 'data:rls_data_assunzione'], ['LIVELLO CCNL', 'rls_livello_ccnl'],
      ['ENTE CORSO', 'rls_ente_corso'], ['OP PROVINCIA', 'rls_op_provincia'], ['VERBALE URL', '#url:verbale_url'],
      ['FORMAZIONE URL', '#url:formazione_url'], ['PRIVACY', 'privacy']],
    file: [
      { base: 'pdf_verbale', prefisso: 'Verbale_RLS', colonna: 'verbale_url', etichetta: 'Verbale di elezione' },
      { base: 'pdf_formazione', prefisso: 'Formazione_RLS', colonna: 'formazione_url', etichetta: 'Attestato di formazione' },
    ],
  },

  /* questionario: dal 18/09/2026 e' «una domanda, poi dipende» — una sola
     valutazione (utilita 1-5), le pastiglie del ramo che si apre, che cosa
     l'impresa ha fatto dopo la visita, e il testo libero. Arriva quasi sempre
     dal pulsante «Valuta la visita» della mail del verbale, e allora sa a quale
     visita si riferisce (vedi agganciaVisita).
     Le colonne del questionario vecchio restano mappate: quelle risposte
     dicono quel che dicevano, e il modulo potrebbe ancora arrivare da una
     pagina in cache (regola d'oro 7). */
  qst: {
    tabella: 's_questionari_sopralluogo',
    obbligatori: [],
    chi: 'tecnico',
    colonne: {
      tecnico: 'tecnico', data_visita: 'data:data_visita',
      utilita: 'scala:utilita', motivi: 'motivi', commento: 'commento', azione_dopo: 'azione_dopo',
      contatto_richiesto: 'qst_contatto', recapito_contatto: 'recapito_contatto', privacy: 'privacy',
      /* questionario fino al 18/09/2026 */
      scopi: 'scopi_visita', scala_aspettative: 'scala:scala_aspettative', ruolo_chiaro: 'qst_ruolo_chiaro',
      scala_professionale: 'scala:scala_professionale', suggerimenti_pratici: 'qst_suggerimenti',
      scala_facilita: 'scala:scala_facilita', nuovi_rischi: 'qst_nuovi_rischi', misure_sicurezza: 'qst_misure',
      aree_monitorate: 'aree_monitorate', scala_serv_area: 'scala:scala_serv1|serv_area_sicurezza',
      scala_serv_visite: 'scala:scala_serv2|serv_visite_cantiere', scala_serv_consulenza: 'scala:scala_serv3|serv_consulenza',
      scala_serv_formazione: 'scala:scala_serv4|serv_formazione', scala_serv_corsi: 'scala:scala_serv5|serv_corsi',
      proposte_miglioramento: 'suggerimenti_testo|suggerimenti', aggiornamenti: 'qst_aggiornamenti',
    },
    extra: agganciaVisita,
    campi: [['TIMESTAMP', '#ts'], ['PROGRESSIVO', '#prog'], ['TECNICO', 'tecnico'], ['DATA VISITA', 'data:data_visita'],
      ['UTILITÀ', 'utilita'], ['MOTIVI', 'motivi'], ['AZIONE DOPO', 'azione_dopo'], ['COMMENTO', 'commento'],
      ['CONTATTO RICHIESTO', 'qst_contatto'], ['RECAPITO CONTATTO', 'recapito_contatto'],
      ['SCOPI', 'scopi_visita'], ['SCALA ASPETTATIVE', 'scala_aspettative'], ['RUOLO CHIARO', 'qst_ruolo_chiaro'],
      ['SCALA PROFESSIONALE', 'scala_professionale'], ['SUGGERIMENTI PRATICI', 'qst_suggerimenti'],
      ['SCALA FACILITÀ', 'scala_facilita'], ['NUOVI RISCHI', 'qst_nuovi_rischi'], ['MISURE SICUREZZA', 'qst_misure'],
      ['AREE MONITORATE', 'aree_monitorate'], ['PROPOSTE MIGLIORAMENTO', 'suggerimenti_testo|suggerimenti'],
      ['AGGIORNAMENTI', 'qst_aggiornamenti'], ['PRIVACY', 'privacy']],
  },

  /* questionario di un EVENTO (corso, convegno, conferenza di cantiere),
     18/09/2026. Le domande le disegna il portale leggendole dal progetto
     Servizi; qui arrivano le risposte, per id di domanda.
     ⚠️ E' l'unico modulo ANONIMO: niente istante, niente contenuto nella
     scatola nera. Vedi il campo «anonimo» sul tipo Modulo. */
  /* il TEST finale (18/09/2026): nominativo, perche' l'esito vale per
     l'attestato. Si corregge da se' sulle domande chiuse; il testo libero e la
     convalida restano di una persona. */
  tst: {
    tabella: 's_test_prove',
    obbligatori: [],
    chi: 'codice',
    silenzioso: true,
    colonne: { risposte: 'json:risposte' },
    extra: agganciaTest,
    campi: [['PROGRESSIVO', '#prog'], ['CODICE', 'codice'], ['RISPOSTE', 'risposte'], ['PRIVACY', 'privacy']],
  },

  /* ISCRIZIONE a un evento (18/09/2026): un corso di un progetto finanziato
     dall'elenco pubblico, oppure le anagrafiche che l'impresa manda dopo una
     conferenza di cantiere. ⚠️ Non diventa un iscritto: diventa una RICHIESTA
     che la segreteria guarda, perche' e' li' che si fermano i doppioni di
     persone e di imprese (decisione riferita dall'utente il 18/09). */
  isc: {
    tabella: 's_iscrizioni',
    obbligatori: [],
    chi: 'ragione_sociale',
    colonne: {
      ragione_sociale: 'ragione_sociale', cf_impresa: 'maiusc:cf_impresa',
      ind_impresa: 'ind_impresa', comune_impresa: 'comune_impresa',
      cap_impresa: 'cap_impresa', prov_impresa: 'maiusc:prov_impresa',
      referente: 'referente', email: 'email', telefono: 'telefono',
      /* ⚠️ Le anagrafiche viaggiano in un elenco JSON: il modulo ne manda
         quante ne servono, e il numero non e' noto quando si scrive il codice.
         Il limite di 20.000 caratteri dello spec «json» tiene una trentina di
         persone per invio — per un convegno piu' grande si manda piu' volte. */
      persone: 'json:persone',
      note: 'note', privacy: 'privacy',
    },
    extra: agganciaIscrizione,
    campi: [['PROGRESSIVO', '#prog'], ['PER CONTO', 'per_conto'],
      ['RAGIONE SOCIALE', 'ragione_sociale'], ['PARTITA IVA', 'piva|partita_iva'],
      ['CODICE FISCALE IMPRESA', 'cf_impresa'], ['INDIRIZZO', 'ind_impresa'],
      ['COMUNE', 'comune_impresa'], ['CAP', 'cap_impresa'], ['PROVINCIA', 'prov_impresa'],
      ['REFERENTE', 'referente'], ['EMAIL', 'email'], ['TELEFONO', 'telefono'],
      ['PERSONE', 'persone'], ['NOTE', 'note'], ['PRIVACY', 'privacy']],
  },

  /* il test scritto dal docente: testo puro, nessun allegato. Non e'
     silenzioso — al contrario: la segreteria deve sapere che e' arrivato,
     perche' finche' non lo porta dentro lei il test non esiste. */
  dtst: {
    tabella: 's_test_proposte',
    obbligatori: [],
    chi: 'nominativo',
    colonne: {
      /* il nominativo arriva dal modulo, ma se l'invito e' valido l'extra lo
         sostituisce con quello scritto sull'invito: la fonte buona e' quella */
      nominativo: 'nominativo',
      domande: 'json:domande',
      note: 'note',
    },
    extra: agganciaPropostaTest,
    campi: [['PROGRESSIVO', '#prog'], ['DOCENTE', 'nominativo'], ['DOMANDE', 'domande'], ['NOTE', 'note']],
  },

  qev: {
    tabella: 's_quest_risposte',
    obbligatori: [],
    chi: 'codice',
    anonimo: true,
    colonne: {
      utilita: 'scala:utilita',
      risposte: 'json:risposte',
    },
    extra: agganciaEvento,
    campi: [['PROGRESSIVO', '#prog'], ['CODICE', 'codice'],
      ['UTILITÀ', 'utilita'], ['RISPOSTE', 'risposte'], ['PRIVACY', 'privacy']],
  },
}

/* ── Drive: la cartella dei file ───────────────────────────────────────────
   Si trova DENTRO la cartella SERVIZI indicata per id in s_config, mai con
   una ricerca per nome su tutto Drive: un ripiego che regge in silenzio e'
   un guasto che aspetta (lezione del 04/09/2026 sul backend Apps Script). */
let cartellaFileId: string | null = null
async function cartellaFile(sb: SB, token: string): Promise<string> {
  if (cartellaFileId) return cartellaFileId
  const { data } = await sb.from('s_config').select('valore').eq('chiave', 'portale_drive_servizi_id').maybeSingle()
  const servizi = data?.valore as string | undefined
  if (!servizi) throw new Error('portale_drive_servizi_id mancante in s_config')
  const q = `'${servizi}' in parents and name = 'PDF_ricevuti' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const r = await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q, fields: 'files(id,name)', pageSize: '5', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  }), { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('cartella SERVIZI non leggibile su Drive: ' + JSON.stringify(d.error))
  if (!d.files?.length) throw new Error(`nessuna cartella PDF_ricevuti dentro la cartella SERVIZI (${servizi})`)
  return (cartellaFileId = d.files[0].id as string)
}

/* Le foto arrivano come elenco JSON di { name, data: 'data:image/...;base64,...' }
   gia' ridotte dal portale. Lettura deterministica: una foto illeggibile si
   scarta con il motivo (riprovare non la renderebbe leggibile). */
function leggiFoto(campo: unknown): { foto: Foto[]; scartate: string[] } {
  const foto: Foto[] = []
  const scartate: string[] = []
  if (!campo) return { foto, scartate }
  let lista: unknown
  try { lista = typeof campo === 'string' ? JSON.parse(campo) : campo } catch { return { foto, scartate: ['elenco delle foto illeggibile'] } }
  if (!Array.isArray(lista)) return { foto, scartate: ['elenco delle foto illeggibile'] }
  if (lista.length > MAX_FOTO) scartate.push(`arrivate ${lista.length} foto, tenute le prime ${MAX_FOTO}`)
  lista.slice(0, MAX_FOTO).forEach((f, i) => {
    /* qualunque image/*: una foto piccola (AVIF, BMP…) il portale la manda
       com'e', e scartarla vorrebbe dire perderla in silenzio */
    const m = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String((f as Dati)?.data || ''))
    if (!m) { scartate.push(`foto ${i + 1}: non e' un'immagine in formato data URL`); return }
    const byte = decodifica(m[2])
    if (!byte) { scartate.push(`foto ${i + 1}: contenuto non decodificabile`); return }
    if (byte.length > MAX_FOTO_BYTE) { scartate.push(`foto ${i + 1}: oltre ${MAX_FOTO_BYTE / 1048576} MB`); return }
    if (!eImmagine(byte)) { scartate.push(`foto ${i + 1}: il contenuto non e' un'immagine`); return }
    const t = m[1].toLowerCase()
    const ext = t === 'png' ? 'png' : (t === 'jpeg' || t === 'jpg') ? 'jpg' : (t.replace(/[^a-z0-9].*$/, '') || 'img')
    foto.push({ nome: String((f as Dati)?.name || ''), mime: `image/${t === 'jpg' ? 'jpeg' : t}`, ext, byte })
  })
  return { foto, scartate }
}
function decodifica(b64: string): Uint8Array | null {
  /* un ciclo semplice, non Uint8Array.from(…, fn): con due PDF da 8 MB la
     funzione chiamata per ogni carattere rischiava il limite di CPU della
     edge function (trovato in revisione il 13/09/2026) */
  try {
    const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}
/* Il tipo dichiarato non basta: si guarda l'inizio del file. Un «PDF» o una
   «foto» che non lo sono finirebbero su Drive con un link aperto dalla mail
   della segreteria (revisione di sicurezza 13/09/2026). SVG escluso: e' testo
   che puo' contenere script. */
const inizia = (b: Uint8Array, da: number, ...xs: number[]) => xs.every((x, i) => b[da + i] === x)
const MARCHI_HEIF = ['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1', 'avif']
function eImmagine(b: Uint8Array): boolean {
  return inizia(b, 0, 0xff, 0xd8, 0xff)                                            // JPEG
    || inizia(b, 0, 0x89, 0x50, 0x4e, 0x47)                                        // PNG
    || inizia(b, 0, 0x47, 0x49, 0x46, 0x38)                                        // GIF
    || inizia(b, 0, 0x42, 0x4d)                                                    // BMP
    || (inizia(b, 0, 0x52, 0x49, 0x46, 0x46) && inizia(b, 8, 0x57, 0x45, 0x42, 0x50)) // WEBP
    || (inizia(b, 4, 0x66, 0x74, 0x79, 0x70) && MARCHI_HEIF.includes(String.fromCharCode(b[8], b[9], b[10], b[11])))
}
/* «%PDF-» nei primi 1024 byte, come ammette la specifica */
const ePdf = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-')

async function caricaFile(token: string, cartella: string, nome: string, mime: string, byte: Uint8Array): Promise<string> {
  const boundary = '-------FilePortale' + crypto.randomUUID()
  const enc = new TextEncoder()
  const testa = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: nome, parents: [cartella] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`)
  const coda = enc.encode(`\r\n--${boundary}--`)
  const corpo = new Uint8Array(testa.length + byte.length + coda.length)
  corpo.set(testa, 0); corpo.set(byte, testa.length); corpo.set(coda, testa.length + byte.length)
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: corpo,
  })
  const up = await r.json()
  if (!up.id) throw new Error('caricamento su Drive fallito: ' + JSON.stringify(up).slice(0, 300))
  /* Stesso permesso che dava Apps Script: chi ha il link vede. La mail
     interna va a cpt@formedilpadova.it, che non e' una casella Google e
     senza questo i link non si aprirebbero. */
  const perm = await fetch(`https://www.googleapis.com/drive/v3/files/${up.id}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  if (!perm.ok) console.warn('portale-richieste: permesso «chi ha il link» non dato a', up.id, (await perm.text()).slice(0, 200))
  return (up.webViewLink as string) || `https://drive.google.com/file/d/${up.id}/view`
}

/* ── Gmail ───────────────────────────────────────────────────────────────── */
async function inviaMail(sa: Dati, mime: string) {
  const tok = await getToken(sa as Record<string, string>, SCOPE_GMAIL)
  const bytes = new TextEncoder().encode(mime)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const raw = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  const d = await r.json()
  if (!r.ok || d.error) throw new Error(d.error?.message || JSON.stringify(d).slice(0, 300))
}

async function praticaPer(sb: SB, m: Modulo, subId: string): Promise<Pratica | null> {
  const { data } = await sb.from(m.tabella).select('id, progressivo, portale_esito').eq('submission_id', subId).maybeSingle()
  return (data as Pratica) || null
}

/* La prenotazione della lavorazione: un UPDATE che riesce solo se nessuno la
   tiene (o se chi la teneva e' morto da piu' di LAVORAZIONE_MAX_MS). Due
   UPDATE concorrenti sulla stessa riga non passano entrambi: il secondo
   aspetta il primo e poi ritrova la condizione falsa.
   Restituisce il SEGNO della prenotazione (l'istante scritto), e si rilascia
   solo col proprio segno: una lavorazione rimasta appesa oltre la scadenza
   non deve liberare, finendo, la prenotazione che nel frattempo ha preso
   un'altra (trovato in revisione il 12/09/2026). */
const LAVORAZIONE_MAX_MS = 120_000
const attesa = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
async function prendiLavorazione(sb: SB, subId: string): Promise<string | null> {
  const scaduta = new Date(Date.now() - LAVORAZIONE_MAX_MS).toISOString()
  const segno = new Date().toISOString()
  const { data, error } = await sb.from('s_portale_ricezioni')
    .update({ lavorazione_dal: segno })
    .eq('submission_id', subId)
    .or(`lavorazione_dal.is.null,lavorazione_dal.lt.${scaduta}`)
    .select('id')
  if (error) throw new Error('lavorazione non prenotata: ' + error.message)
  return (data || []).length === 1 ? segno : null
}

/* ══ SOLO QUEL CHE IL MODULO USA ═════════════════════════════════════════
   (revisione di sicurezza 13/09/2026) Le chiavi della mappa del modulo passano
   coi testi tagliati a MAX_TESTO; le altre — il portale ne manda qualcuna che
   la mappa non conserva — passano al massimo in MAX_CHIAVI_EXTRA, corte e con
   un nome pulito. Prima entrava tutto: una chiave inventata finiva nella scheda
   pratica mandata alla segreteria, e 27 MB di dati casuali nel database. */
const CHIAVI_SEMPRE = ['tipo_modulo', 'submission_id', 'timestamp', 'privacy', 'email']
const MAX_CHIAVI_EXTRA = 15
const MAX_TESTO_EXTRA = 300
const MAX_ELENCO_JSON = 256 * 1024
const chiaviCache = new Map<Modulo, Set<string>>()
function chiaviNote(m: Modulo): Set<string> {
  const pronte = chiaviCache.get(m)
  if (pronte) return pronte
  const s = new Set(CHIAVI_SEMPRE)
  const aggiungi = (spec: string) => { if (!spec.startsWith('#')) for (const k of parti(spec)[1].split('|')) s.add(k) }
  Object.values(m.colonne).forEach(aggiungi)
  m.campi.forEach(([, spec]) => aggiungi(spec))
  for (const a of m.file || []) { s.add(a.base + '_base64'); s.add(a.base + '_nome') }
  if (m.foto) s.add('seg_photo_base64')
  chiaviCache.set(m, s)
  return s
}
function soloNote(grezzo: Dati, m: Modulo): Dati {
  const note = chiaviNote(m)
  const d: Dati = {}
  let extra = 0
  for (const [k, v] of Object.entries(grezzo)) {
    const nota = note.has(k)
    if (!nota && (extra >= MAX_CHIAVI_EXTRA || !/^[a-z][a-z0-9_]{0,39}$/.test(k) || /base64$|_json$/.test(k))) continue
    const max = nota ? MAX_TESTO : MAX_TESTO_EXTRA
    let val: unknown
    if (nota && /base64$/.test(k)) val = typeof v === 'string' ? v : undefined
    else if (nota && /_json$/.test(k)) val = typeof v === 'string' && v.length <= MAX_ELENCO_JSON ? v : undefined
    else if (typeof v === 'number' || typeof v === 'boolean') val = v
    else if (typeof v === 'string') val = v.slice(0, max)
    else if (Array.isArray(v)) val = v.map((x) => String(x ?? '')).join(', ').slice(0, max)
    else if (v && typeof v === 'object') val = JSON.stringify(v).slice(0, max)
    if (val === undefined || val === '') continue
    d[k] = val
    if (!nota) extra++
  }
  return d
}
/* la scatola nera: niente base64, e al massimo 64 KB a richiesta */
function scatolaNera(d: Dati): Dati {
  const snello = (max: number) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k,
    /base64$/.test(k) ? `[${typeof v === 'string' ? v.length : 0} caratteri base64, non copiati]`
      : typeof v === 'string' && v.length > max ? v.slice(0, max) + ` […tagliato, ${v.length} caratteri]` : v]))
  const pieno = snello(MAX_TESTO)
  return JSON.stringify(pieno).length <= 64 * 1024 ? pieno : snello(500)
}

/* ══ UNA RICHIESTA ═══════════════════════════════════════════════════════ */
/* cassetta: null se la richiesta arriva dalla vecchia porta pubblica; dalla
   cassetta porta gli avvisi sugli allegati che portale-ricevi ha lasciato fuori */
async function richiesta(sb: SB, sa: Dati, grezzo: Dati, dimensione: number, ipHash: string,
  cassetta: { avvisi: string[] } | null = null): Promise<Response> {
  const tipo = String(grezzo.tipo_modulo || '').toLowerCase()
  const m = Object.hasOwn(MODULI, tipo) ? MODULI[tipo] : null
  if (!m) return rifiuto(`il modulo «${tipo}» non passa da questa strada`)
  if (dimensione > (MAX_CARATTERI_MODULO[tipo] ?? MAX_CARATTERI_ALTRI)) return rifiuto(`richiesta troppo grande per il modulo «${tipo}»`)
  const subId = String(grezzo.submission_id || '').trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(subId)) return rifiuto('submission_id mancante o non valido')
  const d = soloNote(grezzo, m)
  const mancanti = m.obbligatori.filter((k) => !testo(leggi(d, k)))
  if (mancanti.length) return rifiuto(`campi obbligatori mancanti: ${mancanti.join(', ')}`)

  /* TETTO — solo per le richieste nuove (un reinvio non conta), contato e
     segnato in un colpo solo dal database. Dalla cassetta il tetto per IP
     l'ha gia' contato portale-ricevi; qui ne resta uno complessivo piu'
     largo, come difesa in profondita': se il progetto Servizi venisse
     compromesso, da li' non si potrebbero comunque creare pratiche senza
     limite (13/09/2026). Oltre il tetto la richiesta resta in cassetta e la
     riprende il giro successivo. */
  const { data: gia } = await sb.from('s_portale_ricezioni').select('id').eq('submission_id', subId).maybeSingle()
  if (!gia) {
    const quota = cassetta
      ? { p_ip: 'cassetta', p_max_ora: MAX_ORA_CASSETTA, p_max_ora_ip: MAX_ORA_CASSETTA }
      : { p_ip: ipHash, p_max_ora: MAX_ORA, p_max_ora_ip: MAX_ORA_IP }
    const { data: ammesso, error: errQuota } = await sb.rpc('s_portale_quota', quota)
    if (errQuota) throw new Error('tetto orario non verificato: ' + errQuota.message)
    if (ammesso !== true) return intoppo('troppe richieste nell\'ultima ora: riprova più tardi', 429)
  }

  /* 1. SCATOLA NERA — prima di tutto. Niente base64, e niente testi enormi:
        la scatola nera e' per ritrovare la richiesta, non per custodire
        quel che non sarebbe comunque entrato nella pratica */
  /* ⚠️ Per un modulo ANONIMO la scatola nera tiene solo il biglietto: niente
     contenuto e niente ora del modulo. Qui dentro l'ora c'e' comunque
     (ricevuto_at), e insieme alle risposte basterebbe a risalire alla persona
     che ha firmato il registro a quell'ora. */
  const { error: errRic } = await sb.from('s_portale_ricezioni').upsert(m.anonimo
    ? { submission_id: subId, tipo, origine: cassetta ? 'cassetta' : 'portale-diretto',
        /* la colonna non ammette il vuoto: ci si mette il motivo, così chi
           guarda capisce che è vuota di proposito e non per un errore */
        payload: { anonimo: true, nota: 'modulo anonimo: il contenuto non si conserva qui' } }
    : {
      submission_id: subId, tipo, timestamp_modulo: istante(d.timestamp),
      ragione_sociale: testo(leggi(d, m.chi), 200), email: testo(d.email, 200)?.toLowerCase() ?? null,
      payload: scatolaNera(d), origine: cassetta ? 'cassetta' : 'portale-diretto',
    }, { onConflict: 'submission_id', ignoreDuplicates: true })
  if (errRic) throw new Error('scatola nera non scritta: ' + errRic.message)

  /* 1b. UNA LAVORAZIONE ALLA VOLTA — chi arriva secondo aspetta il primo */
  let presa = await prendiLavorazione(sb, subId)
  for (let i = 0; !presa && i < 10; i++) {
    await attesa(1000)
    const { data: r } = await sb.from('s_portale_ricezioni')
      .select('lavorazione_dal, elaborata_at, progressivo').eq('submission_id', subId).maybeSingle()
    if (r && !r.lavorazione_dal && r.elaborata_at && r.progressivo) {
      return json({ status: 'ok', progressivo: r.progressivo, submission_id: subId, duplicato: true, email: 'ok' })
    }
    if (r && !r.lavorazione_dal) presa = await prendiLavorazione(sb, subId)   // il primo e' finito male: tocca a noi
  }
  if (!presa) return intoppo('la stessa richiesta è già in lavorazione: riprova fra qualche secondo', 409)
  try {
    return await lavora(sb, sa, d, tipo, m, subId, cassetta)
  } finally {
    await sb.from('s_portale_ricezioni').update({ lavorazione_dal: null })
      .eq('submission_id', subId).eq('lavorazione_dal', presa)
  }
}

/* ══ 2-4: LA LAVORAZIONE, con la prenotazione in mano ═════════════════════ */
async function lavora(sb: SB, sa: Dati, d: Dati, tipo: string, m: Modulo, subId: string,
  cassetta: { avvisi: string[] } | null = null): Promise<Response> {
  let tokDrive: string | null = null
  const drive = async () => (tokDrive ||= await getToken(sa as Record<string, string>, SCOPE_DRIVE))

  /* 2. PRATICA — esiste gia' (reinvio) o nasce adesso */
  let pratica = await praticaPer(sb, m, subId)
  const duplicato = !!pratica
  if (!pratica) {
    /* Il numero di ricevuta lo da' il database: il piu' alto della serie + 1.
       Fino al 13/09/2026 si guardava anche il foglio Google, perche' Apps
       Script ci scriveva righe che il database vedeva solo con l'import delle
       6:30; foglio e Apps Script sono spenti, e il database e' l'unico registro.
       Due richieste nello stesso istante: il vincolo unique sul numero ne
       ferma una, che prende il successivo. */
    let ultimo = sb.from(m.tabella).select('progressivo').not('progressivo', 'is', null)
    for (const [k, v] of Object.entries(m.filtro || {})) ultimo = ultimo.eq(k, v)
    const { data: ult, error: errUlt } = await ultimo.order('progressivo', { ascending: false }).limit(1)
    if (errUlt) throw new Error('numero di ricevuta non leggibile: ' + errUlt.message)
    let prog = (Number(ult?.[0]?.progressivo) || 0) + 1
    const campi: Dati = {}
    for (const [col, spec] of Object.entries(m.colonne)) campi[col] = perDb(d, spec)
    const calcolati = m.extra ? await m.extra(sb, d) : {}
    /* quello che ha risolto il server entra anche nei dati che vede la MAIL:
       la segreteria deve leggere il numero del verbale, non il token del link */
    for (const [k, v] of Object.entries(calcolati)) if (v !== null && v !== undefined) d[k] = v
    const riga = m.anonimo
      /* anonimo: nessun istante, e «fonte» resta il valore di partenza della
         tabella (online), che dice da dove arriva senza dire quando */
      ? { submission_id: subId, ...campi, ...calcolati, ...(m.filtro || {}),
          portale_esito: { strada: cassetta ? 'cassetta' : 'portale-richieste' } }
      : {
        fonte: 'modulo',
        submission_id: subId,
        timestamp_modulo: istante(d.timestamp),
        ...campi,
        ...calcolati,
        ...(m.filtro || {}),
        portale_esito: { strada: cassetta ? 'cassetta' : 'portale-richieste', arrivata_il: new Date().toISOString() },
      }
    for (let t = 0; t < 6 && !pratica; t++) {
      const { data, error } = await sb.from(m.tabella).insert({ ...riga, progressivo: prog }).select('id, progressivo, portale_esito').single()
      if (!error) { pratica = data as Pratica; break }
      if (error.code === '23505' && /submission_id/.test(error.message)) { pratica = await praticaPer(sb, m, subId); break }
      /* una prova per persona: il secondo invio non e' un intoppo da
         ritentare, e' una cosa da dire */
      if (error.code === '23505' && /s_test_prove_una/.test(error.message)) {
        return rifiuto("Questa prova risulta già consegnata: se è un errore, avvisa la segreteria.")
      }
      if (error.code === '23505') { prog++; continue }        // numero preso nel frattempo: il successivo
      throw new Error('pratica non inserita: ' + error.message)
    }
    if (!pratica) throw new Error('numero di ricevuta non assegnabile dopo sei tentativi')
    /* ⚠️ Per un modulo ANONIMO la scatola nera non punta alla riga: qui dentro
       c'è ricevuto_at, e un puntatore diretto rimetterebbe un'ora sopra una
       risposta che si è tolta l'ora apposta. Resta il submission_id, che serve
       a non lavorare due volte lo stesso invio: chi amministra il database può
       ancora correlare i due, ed è scritto nel commento della tabella invece di
       essere taciuto. */
    await sb.from('s_portale_ricezioni').update(m.anonimo
      ? { progressivo: pratica.progressivo }
      : { pratica_id: pratica.id, progressivo: pratica.progressivo })
      .eq('submission_id', subId)
  }

  const p = pratica
  const esito: Dati = { ...(p.portale_esito || {}) }
  const salva = async (campi: Dati = {}) => {
    const { error } = await sb.from(m.tabella).update({ portale_esito: esito, ...campi }).eq('id', p.id)
    if (error) console.error('portale-richieste: esito non salvato sulla pratica', m.tabella, p.id, error.message)
  }
  const adesso = () => new Date().toISOString()
  const fotoUrls: string[] = Array.isArray(esito.foto_caricate) ? [...(esito.foto_caricate as string[])] : []
  const file: Record<string, string> = { ...((esito.file_caricati as Record<string, string>) || {}) }

  const fallito = async (cosa: string, e: unknown) => {
    esito[cosa + '_errore'] = errMsg(e)
    await salva()
    await sb.from('s_portale_ricezioni').update({ nota: `${cosa} non salvati: ${errMsg(e)}` }).eq('submission_id', subId)
    return intoppo(`la richiesta è registrata con il n° ${p.progressivo}, ma i file allegati non sono stati salvati (${errMsg(e)}): riprovando si completano, senza creare una seconda richiesta`)
  }

  /* 3a. FOTO — una per volta, e ognuna salvata appena caricata: un reinvio
         riparte da quelle che mancano, senza doppioni su Drive */
  if (m.foto) {
    const { foto, scartate } = leggiFoto(d.seg_photo_base64)
    if (scartate.length) esito.foto_scartate = scartate
    if (foto.length > fotoUrls.length) {
      try {
        const tok = await drive()
        const cartella = await cartellaFile(sb, tok)
        for (let i = fotoUrls.length; i < foto.length; i++) {
          const f = foto[i]
          fotoUrls.push(await caricaFile(tok, cartella, `Segnalazione_${sanitize(d.indirizzo_cantiere)}_${i + 1}_${stampino()}.${f.ext}`, f.mime, f.byte))
          esito.foto_caricate = [...fotoUrls]
          await salva({ foto_urls: fotoUrls.join('; ') })
        }
        delete esito.foto_errore
      } catch (e) {
        return await fallito('foto', e)
      }
    }
  }

  /* 3b. PDF ALLEGATI (RLST, RLS) — stesso nome e stesso posto che dava Apps
         Script, la colonna della pratica col link; uno per volta */
  const allegatiMail: [string, string][] = []
  const scartati: string[] = []       // rifatto a ogni giro: un reinvio non ripete il messaggio
  for (const a of m.file || []) {
    if (!file[a.colonna]) {
      const b64 = d[a.base + '_base64']
      if (typeof b64 !== 'string' || !b64) continue
      const byte = decodifica(b64)
      if (!byte || !byte.length) { scartati.push(`${a.etichetta}: contenuto non decodificabile`); continue }
      if (byte.length > MAX_ALLEGATO_BYTE) { scartati.push(`${a.etichetta}: oltre ${MAX_ALLEGATO_BYTE / 1048576} MB`); continue }
      if (!ePdf(byte)) { scartati.push(`${a.etichetta}: il file non e' un PDF`); continue }
      try {
        const tok = await drive()
        const url = await caricaFile(tok, await cartellaFile(sb, tok), `${a.prefisso}_${sanitize(d.ragione_sociale, 'impresa')}_${stampino()}.pdf`, 'application/pdf', byte)
        file[a.colonna] = url
        esito.file_caricati = { ...file }
        delete esito.file_errore
        await salva({ [a.colonna]: url })
      } catch (e) {
        return await fallito('file', e)
      }
    }
    if (file[a.colonna]) allegatiMail.push([a.etichetta, file[a.colonna]])
  }
  if (scartati.length) esito.file_scartati = scartati
  else if ((m.file || []).every((a) => file[a.colonna] || !d[a.base + '_base64'])) delete esito.file_scartati
  /* dalla cassetta foto e PDF non validi non arrivano nemmeno: il motivo si
     conserva sulla pratica e va nella mail alla segreteria */
  if (cassetta?.avvisi.length) esito.allegati_scartati_cassetta = cassetta.avvisi
  const nonAccettati = ['foto_scartate', 'file_scartati', 'allegati_scartati_cassetta']
    .flatMap((k) => (Array.isArray(esito[k]) ? (esito[k] as unknown[]).map(String) : []))

  /* 4. MAIL — una volta sola ciascuna; un errore non fa fallire la risposta:
        la pratica c'e', e dire «non riuscito» farebbe reinviare per niente */
  let email = 'ok'
  const emailCompilante = testo(d.email, 200)
  const emailValida = !!emailCompilante && EMAIL_VALIDA.test(emailCompilante)
  /* ⚠️ Per un modulo ANONIMO la mail interna non parte, per due ragioni che
     valgono insieme: dopo un convegno sarebbero centoventi messaggi, e ognuno
     porterebbe le risposte accanto a un'ora — cioe' fuori dal database
     rinascerebbe il legame che nel database si e' tolto. Il questionario di un
     evento si guarda dalla scheda del corso, a fine evento, non una risposta
     per volta. */
  if (!m.anonimo && !m.silenzioso && !esito.mail_interna_il) {
    try {
      const { data: cfg } = await sb.from('s_config').select('valore').eq('chiave', 'portale_mail_segreteria').maybeSingle()
      const mi = mailInterna(tipo, d, p.progressivo, { praticaId: p.id, fotoUrls, allegati: allegatiMail, scartati: nonAccettati })
      await inviaMail(sa, messaggioMime({
        a: (cfg?.valore as string) || EMAIL_UFFICIO,
        rispondiA: emailValida ? emailCompilante! : undefined,
        oggetto: mi.oggetto, html: mi.html,
      }))
      esito.mail_interna_il = adesso()
      delete esito.mail_interna_errore
    } catch (e) {
      esito.mail_interna_errore = errMsg(e)
      email = 'cpt-non-inviata'
    }
  }
  if (emailCompilante && !emailValida) esito.mail_conferma_errore = 'indirizzo non valido: ' + emailCompilante
  if (emailValida && !esito.mail_conferma_il) {
    /* l'indirizzo lo scrive chiunque: senza un tetto il modulo diventerebbe un
       modo di mandare posta a nome dell'ente a chi si vuole (revisione di
       sicurezza 13/09/2026). Il conteggio comprende la richiesta di adesso. */
    const { count: conferme } = await sb.from('s_portale_ricezioni').select('id', { count: 'exact', head: true })
      .eq('email', emailCompilante!.toLowerCase()).gte('ricevuto_at', new Date(Date.now() - 86400_000).toISOString())
    if ((conferme || 0) > MAX_CONFERME_GIORNO) {
      esito.mail_conferma_errore = `non inviata: piu' di ${MAX_CONFERME_GIORNO} richieste in 24 ore dallo stesso indirizzo`
      email = email === 'ok' ? 'impresa-non-inviata' : 'nessuna-inviata'
    } else {
      try {
        const mc = mailConferma(tipo, d, p.progressivo)
        await inviaMail(sa, messaggioMime({ a: emailCompilante!, rispondiA: EMAIL_UFFICIO, oggetto: mc.oggetto, html: mc.html }))
        esito.mail_conferma_il = adesso()
        delete esito.mail_conferma_errore
      } catch (e) {
        esito.mail_conferma_errore = errMsg(e)
        email = email === 'ok' ? 'impresa-non-inviata' : 'nessuna-inviata'
      }
    }
  }
  await salva()
  /* la nota della scatola nera dice lo stato di adesso: un intoppo superato
     da un reinvio non deve restare scritto come se ci fosse ancora */
  await sb.from('s_portale_ricezioni').update({ elaborata_at: adesso(), nota: null }).eq('submission_id', subId)

  return json({ status: 'ok', progressivo: p.progressivo, submission_id: subId, duplicato, email })
}

/* ══ BATTITO ═════════════════════════════════════════════════════════════ */
async function battito(req: Request, sb: SB, sa: Dati): Promise<Response> {
  const { data: t } = await sb.from('s_config').select('valore').eq('chiave', 'portale_battito_token').maybeSingle()
  if (!t?.valore || !uguali(req.headers.get('x-token') || '', t.valore as string)) {
    return json({ status: 'error', message: 'token del battito non valido' }, 401)
  }
  const verifiche: Record<string, string> = {}
  let tutto = true
  const prova = async (nome: string, fn: () => Promise<string>) => {
    try { verifiche[nome] = 'ok ' + await fn() } catch (e) { verifiche[nome] = 'ERRORE: ' + errMsg(e); tutto = false }
  }
  await prova('database', async () => {
    const conti: string[] = []
    for (const m of Object.values(MODULI)) {
      const { count, error } = await sb.from(m.tabella).select('id', { count: 'exact', head: true })
      if (error) throw new Error(`${m.tabella}: ${error.message}`)
      conti.push(`${m.tabella} ${count}`)
    }
    return `(${conti.join(', ')})`
  })
  await prova('drive', async () => `(PDF_ricevuti ${await cartellaFile(sb, await getToken(sa as Record<string, string>, SCOPE_DRIVE))})`)
  await prova('gmail', async () => {
    await getToken(sa as Record<string, string>, SCOPE_GMAIL)
    return '(delega attiva)'
  })
  /* la cassetta sul progetto Servizi: risponde davvero, non ha richieste ferme,
     e la porta pubblica portale-ricevi e' in piedi */
  await prova('cassetta', async () => {
    const cfg = await configCassetta(sb)
    const b = await consegna(cfg, 'battito')
    if (Number(b.vecchie) > 0) throw new Error(`${b.vecchie} richieste ferme in cassetta da piu' di 15 minuti`)
    const r = await fetch(cfg.cassetta_ricevi_url, { method: 'OPTIONS', signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error('portale-ricevi risponde ' + r.status)
    return `(in attesa ${b.totali}, allegati ${b.bucket}, portale-ricevi raggiungibile)`
  })
  if (tutto) {
    const nota = Object.entries(verifiche).map(([k, v]) => `${k}: ${v}`).join(' | ')
    await sb.from('s_config').update({
      valore: new Date().toISOString(), updated_by: 'portale-richieste',
      descrizione: 'Ultimo battito del portale servizi (funzione portale-richieste). ' + nota,
    }).eq('chiave', 'portale_diretto_battito_al')
  }
  return json({ status: tutto ? 'ok' : 'error', verifiche }, tutto ? 200 : 500)
}

/* ══ LA CASSETTA DELLE LETTERE (progetto Servizi, dal 13/09/2026) ═══════════ */
/* confronto a tempo costante: la durata non deve dire quanti caratteri erano giusti */
function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

async function configCassetta(sb: SB): Promise<Record<string, string>> {
  const { data, error } = await sb.from('s_config').select('chiave, valore')
    .in('chiave', ['cassetta_token', 'cassetta_consegna_url', 'cassetta_ricevi_url'])
  if (error) throw new Error('configurazione della cassetta non leggibile: ' + error.message)
  return Object.fromEntries((data || []).map((r) => [r.chiave as string, r.valore as string]))
}

async function consegna(cfg: Record<string, string>, azione: string, extra: Dati = {}): Promise<Dati> {
  if (!cfg.cassetta_consegna_url || !cfg.cassetta_token) throw new Error('cassetta_consegna_url o cassetta_token mancanti in s_config')
  const r = await fetch(cfg.cassetta_consegna_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cassetta-Token': cfg.cassetta_token },
    body: JSON.stringify({ azione, ...extra }),
    signal: AbortSignal.timeout(60_000),
  })
  const t = (await r.json().catch(() => null)) as Dati | null
  if (!r.ok || !t || t.status !== 'ok') throw new Error(`cassetta, ${azione}: ${(t?.message as string) || 'risposta ' + r.status}`)
  return t
}

/* Il campanello: la richiesta si legge dalla cassetta (mai dal corpo della
   chiamata), si lavora, e alla cassetta si dice com'e' andata: ritirata o
   scartata la cancella, altrimenti la ripresenta al giro dopo. Un reinvio
   ritrova la pratica e non rifa' niente. */
async function ritiraDaCassetta(sb: SB, sa: Dati, cfg: Record<string, string>, subId: string): Promise<Response> {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(subId)) return rifiuto('submission_id mancante o non valido')
  const busta = await consegna(cfg, 'leggi', { submission_id: subId })
  const r = busta.richiesta as Dati | null
  if (!r) return rifiuto('richiesta non trovata nella cassetta')
  if (r.stato === 'ritirata') return json({ status: 'ok', progressivo: r.progressivo ?? null, submission_id: subId, duplicato: true, email: 'ok' })
  if (r.stato === 'scartata') return rifiuto(String(r.motivo || 'richiesta scartata'))
  const grezzo: Dati = { ...((r.payload as Dati) || {}), tipo_modulo: r.tipo, submission_id: subId }
  const avvisi = (Array.isArray(r.avvisi) ? r.avvisi : []).slice(0, 10).map((x) => String(x).slice(0, 300))
  let res: Response
  try { res = await richiesta(sb, sa, grezzo, 0, 'cassetta', { avvisi }) } catch (e) { res = intoppo(errMsg(e)) }
  const esito = (await res.clone().json().catch(() => ({}))) as Dati
  try {
    if (res.ok && esito.status === 'ok') await consegna(cfg, 'ritirata', { submission_id: subId, progressivo: esito.progressivo ?? null, email: esito.email ?? null })
    else if (res.status === 400) await consegna(cfg, 'scartata', { submission_id: subId, motivo: esito.message ?? 'rifiutata' })
    else await consegna(cfg, 'tentativo', { submission_id: subId, errore: esito.message ?? 'risposta ' + res.status })
  } catch (e) {
    /* la pratica c'e' comunque: al giro dopo la cassetta la ripresenta, e la
       lavorazione risponde col numero senza rifare niente */
    console.error('portale-richieste: esito non comunicato alla cassetta', subId, errMsg(e))
  }
  return res
}

/* Il giro (pg_cron ogni 3 minuti): la rete sotto il campanello. Scrive in
   s_config lo stato della cassetta, che il cruscotto della segreteria mostra. */
async function giroCassetta(sb: SB, sa: Dati, cfg: Record<string, string>): Promise<Response> {
  const inizio = Date.now()
  const lista = await consegna(cfg, 'in_attesa')
  const ferme = new Set((lista.vecchie as string[]) || [])
  const lavorate: Dati[] = []
  for (const subId of (lista.submission_ids as string[]) || []) {
    if (Date.now() - inizio > 90_000) break
    let res: Response
    try { res = await ritiraDaCassetta(sb, sa, cfg, subId) } catch (e) { res = intoppo(errMsg(e)) }
    const e = (await res.clone().json().catch(() => ({}))) as Dati
    if (res.ok && e.status === 'ok') ferme.delete(subId)
    lavorate.push({ submission_id: subId, http: res.status, progressivo: e.progressivo ?? null, messaggio: e.message ?? null })
  }
  let pulizia: unknown = 'non in questo giro'
  if (new Date().getUTCMinutes() < 3) {           // una volta l'ora basta
    try { pulizia = await consegna(cfg, 'pulizia') } catch (e) { pulizia = 'ERRORE: ' + errMsg(e) }
  }
  const stato = { totali: lista.totali, ferme_oltre_15_min: ferme.size, piu_vecchia_min: lista.piu_vecchia_min, lavorate: lavorate.length }
  const { error } = await sb.from('s_config').upsert([
    { chiave: 'cassetta_giro_al', valore: new Date().toISOString(), updated_by: 'portale-richieste',
      descrizione: 'Ultimo giro di ritiro dalla cassetta del portale (progetto Servizi), ogni 3 minuti da pg_cron.' },
    { chiave: 'cassetta_in_attesa', valore: JSON.stringify(stato), updated_by: 'portale-richieste',
      descrizione: 'Stato della cassetta del portale all\'ultimo giro: richieste in attesa e ferme da piu\' di 15 minuti (allarme del cruscotto).' },
  ], { onConflict: 'chiave' })
  if (error) console.error('portale-richieste: stato della cassetta non scritto', error.message)
  return json({ status: 'ok', ...stato, dettaglio: lavorate, pulizia })
}

/* ⚠️ PostgREST risponde 504 per qualche secondo quando la funzione parte da
   pg_cron allo scoccare del minuto: il 13/09/2026 l'hanno preso il giro della
   cassetta, il battito delle 05:20 e l'import delle 04:30, sempre alla prima
   lettura, e mai le chiamate a meta' minuto. Nel database non c'era nessuna
   attesa: si ferma PostgREST. Le LETTURE si ritentano, perche' ripeterle non fa
   danni; le scritture no, perche' un 504 non dice se la scrittura e' avvenuta. */
async function fetchRiprova(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const metodo = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (metodo !== 'GET' && metodo !== 'HEAD') return fetch(input, init)
  let r = await fetch(input, init)
  for (const pausa of [1500, 3000, 6000]) {
    if (r.status !== 502 && r.status !== 503 && r.status !== 504) return r
    console.warn('portale-richieste: PostgREST', r.status, '- ritento fra', pausa, 'ms')
    await attesa(pausa)
    r = await fetch(input, init)
  }
  return r
}

/* l'indirizzo IP serve solo al tetto: se ne tiene un'impronta, non l'indirizzo */
const indirizzoIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'sconosciuto'
async function impronta(v: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('portale:' + v)))
  return [...h.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return rifiuto('solo POST')
  /* il corpo non si legge nemmeno, se chi manda dichiara piu' del tetto */
  if (Number(req.headers.get('content-length') || 0) > MAX_CARATTERI) return rifiuto('richiesta troppo grande')

  const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  const SUPA = Deno.env.get('SUPABASE_URL')
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SA_JSON || !SUPA || !SRV) return intoppo('configurazione della funzione incompleta', 500)
  const sb = createClient(SUPA, SRV, { auth: { persistSession: false }, global: { fetch: fetchRiprova } })

  let corpo: string
  try { corpo = await req.text() } catch { return intoppo('richiesta non leggibile') }
  if (!corpo) return rifiuto('corpo vuoto')
  if (corpo.length > MAX_CARATTERI) return rifiuto('richiesta troppo grande')
  let d: Dati
  try { d = JSON.parse(corpo) } catch { return rifiuto('JSON illeggibile') }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return rifiuto('la richiesta deve essere un oggetto JSON')

  try {
    const sa = JSON.parse(SA_JSON)
    if (d.battito) return await battito(req, sb, sa)
    /* la cassetta: campanello e giro, solo con la parola d'ordine */
    const parola = req.headers.get('x-cassetta-token')
    if (parola !== null) {
      const cfg = await configCassetta(sb)
      if (!cfg.cassetta_token || !uguali(parola, cfg.cassetta_token)) return json({ status: 'error', message: 'non autorizzato' }, 401)
      if (typeof d.ritira === 'string') return await ritiraDaCassetta(sb, sa, cfg, d.ritira)
      if (d.giro === true) return await giroCassetta(sb, sa, cfg)
      return rifiuto('azione della cassetta sconosciuta')
    }
    /* la vecchia porta pubblica: chiusa dal 13/09/2026 (s_config.portale_diretto_pubblico = no) */
    const { data: pubblica } = await sb.from('s_config').select('valore').eq('chiave', 'portale_diretto_pubblico').maybeSingle()
    if (pubblica?.valore !== 'si') {
      return intoppo('i moduli ora arrivano da un\'altra strada: ricarica la pagina del portale. La richiesta resta salvata sul telefono e parte da sola', 503)
    }
    return await richiesta(sb, sa, d, corpo.length, await impronta(indirizzoIp(req)))
  } catch (e) {
    console.error('portale-richieste:', e)
    return intoppo(errMsg(e))
  }
})
