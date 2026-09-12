// Supabase Edge Function – portale-richieste
//
// LA STRADA DIRETTA DEL PORTALE SERVIZI (12/09/2026).
//
// Fino a oggi ogni modulo del portale pubblico faceva quattro passaggi:
// portale → Apps Script → foglio Google → import delle 6:30 → tabelle. Il
// foglio non aggiungeva niente ed era il punto piu' fragile: ad agosto il
// deployment Apps Script e' rimasto morto cinque settimane, la cartella Drive
// configurata non esisteva dal 1/07, un'autorizzazione mancante faceva fallire
// in silenzio la chiamata a Supabase. Deciso dall'utente: le richieste vengono
// qui, un modulo alla volta. Moduli che passano di qui (MODULI, sotto):
//   seg — Segnalazione Cantiere  → s_segnalazioni       (12/09/2026)
//   not — Notifica Cantiere      → s_notifiche_cantiere (12/09/2026)
// Per aggiungerne uno: la tabella con submission_id e portale_esito, la voce
// in MODULI con la mappa dei campi (la stessa dell'import delle 6:30), e il
// prefisso in MODULI_DIRETTI del portale.
//
// Che cosa fa, in quest'ordine (si scrive prima e si elabora dopo):
//  1. SCATOLA NERA  — il payload (senza base64) in s_portale_ricezioni,
//                     prima di qualunque altra cosa
//  2. PRATICA       — subito nella tabella del modulo, col numero di ricevuta
//                     (progressivo) e la proposta del tecnico di zona
//  3. FOTO          — solo la segnalazione: su Drive in SERVIZI/PDF_ricevuti
//  4. FOGLIO        — la copia della riga nella scheda del modulo. ⚠️ Non e'
//                     un vezzo: prenota il numero. L'import salta le righe il
//                     cui progressivo e' gia' nel database, e una richiesta
//                     arrivata dalla vecchia strada (pagina aperta da prima
//                     dell'aggiornamento) prenderebbe lo stesso numero e
//                     sparirebbe in silenzio.
//  5. MAIL          — scheda pratica alla segreteria, conferma a chi scrive
//                     (grafica v4.6 di Apps Script, vedi mail.ts)
//
// Il reinvio e' sicuro: lo stesso submission_id ritrova la pratica e fa solo
// quel che manca (portale_esito dice che cosa e' gia' fatto). Se le foto non
// si salvano si risponde «riprovabile» dicendo il numero gia' assegnato: il
// telefono tiene la richiesta in coda e riprova.
//
// ⚠️ UNA LAVORAZIONE ALLA VOLTA PER OGNI INVIO (12/09/2026, dalla prima prova).
// Lo stesso invio puo' arrivare due volte INSIEME: il portale svuota la coda
// quattro secondi dopo l'apertura, e una richiesta appena salvata in coda e'
// partita sia dal modulo sia dalla coda, a 83 millesimi l'una dall'altra.
// Senza prenotazione tutte e due le lavorazioni hanno letto una pratica
// «senza foto e senza mail» e hanno fatto tutto: due foto su Drive, due mail
// alla segreteria, due conferme. Il numero di ricevuta invece era uno solo,
// perche' lo teneva il vincolo del database — ed e' la stessa idea che serve
// qui: la prenotazione si prende con un UPDATE condizionato
// (s_portale_ricezioni.lavorazione_dal), che Postgres esegue una riga alla
// volta. Chi arriva secondo aspetta che il primo finisca e risponde col suo
// numero; se il primo muore, la prenotazione scade dopo 2 minuti.
//
// Risposta (letta dal portale, stessa forma di Apps Script):
//   { status:'ok', progressivo, submission_id, duplicato, email }
//   { status:'error', riprovabile:true|false, message }
//
// BATTITO: { battito:true } + intestazione X-Token (s_config.portale_battito_token)
//   verifica davvero database, cartella delle foto, la scheda del foglio di
//   ogni modulo e la delega Gmail, e solo se tutto risponde scrive
//   s_config.portale_diretto_battito_al.
//   Lo chiama pg_cron alle 05:20 UTC (job battito-portale-diretto).
//
// verify_jwt = false, di proposito: il portale e' pubblico e anonimo, come
// l'endpoint Apps Script che sostituisce. Nessuna chiave viaggia nel sito.
// In cambio: solo POST, tipi noti, submission_id obbligatorio, tetto orario.
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

const MAX_CARATTERI = 24 * 1024 * 1024   // tre foto da 4 MB in base64 ci stanno larghe
const MAX_ORA = 60                        // non e' una difesa, e' un freno a un errore che si ripete
const MAX_FOTO = 3
const MAX_FOTO_BYTE = 6 * 1024 * 1024
const MAX_TESTO = 4000
const MAX_ELENCO = 30                     // figure professionali / imprese di una notifica
const EMAIL_VALIDA = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[A-Za-z]{2,}$/

type Dati = Record<string, unknown>
type SB = ReturnType<typeof createClient>
type Pratica = { id: number; progressivo: number; portale_esito: Dati | null }
type Foglio = { sheetId: string; titolo: string; testata: string[] }
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
const dataFoglio = (v: unknown) => { const d = dataIso(v); return d ? d.split('-').reverse().join('/') : cella(v, 40) }

/* Figure professionali e imprese della notifica: elenchi JSON dal portale.
   Si tengono solo oggetti con testi brevi; un elenco illeggibile non blocca
   la notifica, si perde solo l'elenco (come nell'import delle 6:30). */
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
/* «12/09/2026 14:30:05»: la forma che l'import legge nella colonna TIMESTAMP */
const adessoFoglio = () => { const r = partiRoma(); return `${r.g}/${r.m}/${r.a} ${r.h}:${r.mi}:${r.s}` }
const stampino = () => { const r = partiRoma(); return `${r.a}${r.m}${r.g}_${r.h}${r.mi}` }
const sanitize = (v: unknown) => (String(v || '').replace(/[^a-zA-Z0-9]/g, '_') || 'cantiere').substring(0, 40)

/* ── tecnico di zona: la stessa regola di import-rlst ──────────────────────
   Vince la zona PIU' SPECIFICA (i quartieri di Padova battono «PADOVA»);
   con due candidati alla pari non si sceglie. */
function normComune(v: string): string {
  return String(v || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim()
}
async function propostaTecnico(sb: SB, comune: string | null): Promise<string | null> {
  const c = normComune(comune || '')
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

/* ── controllo CEIV sulla P.IVA: la stessa regola di import-rlst ───────────
   Impresa non in anagrafica → da_verificare, MAI non_iscritta: l'assenza
   non e' una prova. */
function pivaNorm(v: unknown): string | null {
  const t = String(v || '')
  const m = t.match(/\d{10,11}/)
  if (m) return m[0].padStart(11, '0')
  const cifre = t.replace(/\D/g, '')
  if (cifre.length >= 8 && cifre.length <= 11) return cifre.padStart(11, '0')
  return null
}
async function esitoCeiv(sb: SB, piva: string | null): Promise<Dati> {
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

/* ══ I MODULI CHE PASSANO DI QUI ═════════════════════════════════════════
   riga   → le colonne della pratica (progressivo, submission_id,
            portale_esito e fonte li mette la lavorazione)
   foglio → i valori per INTESTAZIONE di colonna, come li legge l'import:
            la copia si scrive allineata alla testata vera della scheda,
            non per posizione */
type Modulo = {
  tabella: string
  scheda: { gid?: string; titolo?: string }     // chiavi di s_config
  intestazioni: string[]                        // HEADERS di Apps Script, se la scheda e' vuota
  foto: boolean
  chi: (d: Dati) => string | null               // per la scatola nera
  riga: (sb: SB, d: Dati) => Promise<Dati>
  foglio: (d: Dati, prog: number, fotoUrls: string[]) => Record<string, string | number>
}

const MODULI: Record<string, Modulo> = {
  seg: {
    tabella: 's_segnalazioni',
    scheda: { gid: 'segn_sheet_gid' },
    intestazioni: ['TIMESTAMP', 'PROGRESSIVO', 'NOTIFICANTE', 'TELEFONO', 'E-MAIL', 'IND. CANTIERE', 'COMUNE CANTIERE',
      'MOTIVO', 'STATO LAVORI', 'IMPRESE PRESENTI', 'NOTE', 'FOTO URL', 'PRIVACY'],
    foto: true,
    chi: (d) => testo(d.notifica, 200),
    riga: async (sb, d) => {
      const comune = testo(d.comune_cantiere, 200)
      return {
        notificante: testo(d.notifica, 200),
        telefono: testo(d.telefono, 60),
        email: testo(d.email, 200),
        ind_cantiere: testo(d.indirizzo_cantiere, 300),
        comune_cantiere: comune,
        motivo: testo(d.motivo),
        stato_lavori: testo(d.stato_lavori),
        imprese_presenti: testo(d.imprese_presenti),
        note_modulo: testo(d.note),
        privacy: testo(d.privacy, 200),
        tecnico_proposto: await propostaTecnico(sb, comune),
      }
    },
    foglio: (d, prog, fotoUrls) => ({
      'TIMESTAMP': adessoFoglio(), 'PROGRESSIVO': prog,
      'NOTIFICANTE': cella(d.notifica, 200), 'TELEFONO': cella(d.telefono, 60), 'E-MAIL': cella(d.email, 200),
      'IND. CANTIERE': cella(d.indirizzo_cantiere, 300), 'COMUNE CANTIERE': cella(d.comune_cantiere, 200),
      'MOTIVO': cella(d.motivo), 'STATO LAVORI': cella(d.stato_lavori), 'IMPRESE PRESENTI': cella(d.imprese_presenti),
      'NOTE': cella(d.note), 'FOTO URL': fotoUrls.join('\n'), 'PRIVACY': cella(d.privacy, 200),
    }),
  },

  /* NOTIFICA CANTIERE: stessa mappa della scheda «Notifica» in import-rlst.
     Qui «rl_» e' il RESPONSABILE DEI LAVORI, non il legale rappresentante;
     l'aggancio all'anagrafica si tenta sulla P.IVA del committente. */
  not: {
    tabella: 's_notifiche_cantiere',
    scheda: { titolo: 'notif_sheet_titolo' },
    intestazioni: ['TIMESTAMP', 'PROGRESSIVO', 'DATA COM.', 'RAGIONE SOC.', 'TITOLO', 'COGNOME', 'NOME', 'CF', 'E-MAIL',
      'TELEFONO', 'IND. CANTIERE', 'COMUNE CANTIERE', 'DATA INIZIO', 'DATA FINE', 'IMPORTO', 'DURATA GG', 'MAX LAV.',
      'N. IMPRESE', 'N. AUTONOMI', 'NOTE CANTIERE', 'COMM. TIPO', 'COMM. RAG. SOC.', 'COMM. PIVA', 'COMM. CF',
      'COMM. IND.', 'COMM. TEL', 'COMM. EMAIL', 'COMM. TITOLO', 'COMM. COGNOME', 'COMM. NOME', 'COMM. CF2',
      'COMM. IND2', 'COMM. COM2', 'COMM. TEL2', 'RL TITOLO', 'RL NOME', 'RL COGNOME', 'RL CF', 'RL IND.', 'RL COMUNE',
      'RL NOTE', 'PRIVACY', 'FIGURE JSON', 'IMPRESE JSON'],
    foto: false,
    chi: (d) => testo(d.ragione_sociale, 200) ||
      testo([d.cognome, d.nome].map((x) => String(x ?? '').trim()).filter(Boolean).join(' '), 200),
    riga: async (sb, d) => {
      const comune = testo(d.comune_cantiere, 200)
      const piva = pivaNorm(d.committente_piva)
      return {
        data_com: dataIso(d.data_comunicazione),
        ragione_sociale: testo(d.ragione_sociale, 200),
        seg_titolo: testo(d.titolo, 60),
        seg_cognome: testo(d.cognome, 120),
        seg_nome: testo(d.nome, 120),
        seg_cf: maiuscolo(d.codice_fiscale),
        email: testo(d.email, 200),
        telefono: testo(d.telefono, 60),
        ind_cantiere: testo(d.indirizzo_cantiere, 300),
        comune_cantiere: comune,
        data_inizio: dataIso(d.data_inizio),
        data_fine: dataIso(d.data_fine),
        importo: testo(d.importo_lavori, 60),
        durata_gg: testo(d.durata_giorni, 30),
        max_lavoratori: testo(d.max_lavoratori, 30),
        n_imprese: testo(d.num_imprese, 30),
        n_autonomi: testo(d.num_autonomi, 30),
        note_cantiere: testo(d.note_cantiere),
        comm_tipo: testo(d.committente_tipo, 60),
        comm_ragione_sociale: testo(d.committente_ragione_sociale, 200),
        comm_piva: piva || testo(d.committente_piva, 30),
        comm_cf: maiuscolo(d.committente_cf),
        comm_indirizzo: testo(d.committente_indirizzo, 300),
        comm_tel: testo(d.committente_telefono, 60),
        comm_email: testo(d.committente_email, 200),
        comm_titolo: testo(d.committente_titolo, 60),
        comm_cognome: testo(d.committente_cognome, 120),
        comm_nome: testo(d.committente_nome, 120),
        comm_cf2: maiuscolo(d.committente_cf_persona),
        comm_ind2: testo(d.committente_indirizzo_persona, 300),
        comm_com2: testo(d.committente_comune_persona, 200),
        comm_tel2: testo(d.committente_telefono_persona, 60),
        rl_titolo: testo(d.rl_titolo, 60),
        rl_nome: testo(d.rl_nome, 120),
        rl_cognome: testo(d.rl_cognome, 120),
        rl_cf: maiuscolo(d.rl_cf),
        rl_indirizzo: testo(d.rl_indirizzo, 300),
        rl_comune: testo(d.rl_comune, 200),
        rl_note: testo(d.rl_note),
        figure: elenco(d.figure_json),
        imprese: elenco(d.imprese_json),
        privacy: testo(d.privacy, 200),
        ...(await esitoCeiv(sb, piva)),
        tecnico_proposto: await propostaTecnico(sb, comune),
      }
    },
    foglio: (d, prog) => {
      const fig = elenco(d.figure_json)
      const imp = elenco(d.imprese_json)
      return {
        'TIMESTAMP': adessoFoglio(), 'PROGRESSIVO': prog, 'DATA COM.': dataFoglio(d.data_comunicazione),
        'RAGIONE SOC.': cella(d.ragione_sociale, 200), 'TITOLO': cella(d.titolo, 60), 'COGNOME': cella(d.cognome, 120),
        'NOME': cella(d.nome, 120), 'CF': maiuscolo(d.codice_fiscale) || '', 'E-MAIL': cella(d.email, 200),
        'TELEFONO': cella(d.telefono, 60), 'IND. CANTIERE': cella(d.indirizzo_cantiere, 300),
        'COMUNE CANTIERE': cella(d.comune_cantiere, 200), 'DATA INIZIO': dataFoglio(d.data_inizio),
        'DATA FINE': dataFoglio(d.data_fine), 'IMPORTO': cella(d.importo_lavori, 60), 'DURATA GG': cella(d.durata_giorni, 30),
        'MAX LAV.': cella(d.max_lavoratori, 30), 'N. IMPRESE': cella(d.num_imprese, 30), 'N. AUTONOMI': cella(d.num_autonomi, 30),
        'NOTE CANTIERE': cella(d.note_cantiere), 'COMM. TIPO': cella(d.committente_tipo, 60),
        'COMM. RAG. SOC.': cella(d.committente_ragione_sociale, 200), 'COMM. PIVA': cella(d.committente_piva, 30),
        'COMM. CF': maiuscolo(d.committente_cf) || '', 'COMM. IND.': cella(d.committente_indirizzo, 300),
        'COMM. TEL': cella(d.committente_telefono, 60), 'COMM. EMAIL': cella(d.committente_email, 200),
        'COMM. TITOLO': cella(d.committente_titolo, 60), 'COMM. COGNOME': cella(d.committente_cognome, 120),
        'COMM. NOME': cella(d.committente_nome, 120), 'COMM. CF2': maiuscolo(d.committente_cf_persona) || '',
        'COMM. IND2': cella(d.committente_indirizzo_persona, 300), 'COMM. COM2': cella(d.committente_comune_persona, 200),
        'COMM. TEL2': cella(d.committente_telefono_persona, 60), 'RL TITOLO': cella(d.rl_titolo, 60),
        'RL NOME': cella(d.rl_nome, 120), 'RL COGNOME': cella(d.rl_cognome, 120), 'RL CF': maiuscolo(d.rl_cf) || '',
        'RL IND.': cella(d.rl_indirizzo, 300), 'RL COMUNE': cella(d.rl_comune, 200), 'RL NOTE': cella(d.rl_note),
        'PRIVACY': cella(d.privacy, 200),
        'FIGURE JSON': fig ? JSON.stringify(fig) : '', 'IMPRESE JSON': imp ? JSON.stringify(imp) : '',
      }
    },
  },
}

/* ── Drive: la cartella delle foto ─────────────────────────────────────────
   Si trova DENTRO la cartella SERVIZI indicata per id in s_config, mai con
   una ricerca per nome su tutto Drive: un ripiego che regge in silenzio e'
   un guasto che aspetta (lezione del 04/09/2026 sul backend Apps Script). */
let cartellaFotoId: string | null = null
async function cartellaFoto(sb: SB, token: string): Promise<string> {
  if (cartellaFotoId) return cartellaFotoId
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
  return (cartellaFotoId = d.files[0].id as string)
}

/* Le foto arrivano come elenco JSON di { name, data: 'data:image/...;base64,...' }
   gia' ridotte dal portale. Lettura deterministica: una foto illeggibile si
   scarta con il motivo (riprovare non la renderebbe leggibile). */
function leggiFoto(campo: unknown): { foto: Foto[]; scartate: string[] } {
  const foto: Foto[] = []
  const scartate: string[] = []
  if (!campo) return { foto, scartate }
  let elenco: unknown
  try { elenco = typeof campo === 'string' ? JSON.parse(campo) : campo } catch { return { foto, scartate: ['elenco delle foto illeggibile'] } }
  if (!Array.isArray(elenco)) return { foto, scartate: ['elenco delle foto illeggibile'] }
  if (elenco.length > MAX_FOTO) scartate.push(`arrivate ${elenco.length} foto, tenute le prime ${MAX_FOTO}`)
  elenco.slice(0, MAX_FOTO).forEach((f, i) => {
    /* qualunque image/*, come Apps Script: una foto piccola (AVIF, BMP…) il
       portale la manda com'e', e scartarla vorrebbe dire perderla in silenzio */
    const m = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String((f as Dati)?.data || ''))
    if (!m) { scartate.push(`foto ${i + 1}: non e' un'immagine in formato data URL`); return }
    let byte: Uint8Array
    try { byte = Uint8Array.from(atob(m[2].replace(/\s/g, '')), (c) => c.charCodeAt(0)) } catch {
      scartate.push(`foto ${i + 1}: contenuto non decodificabile`); return
    }
    if (byte.length > MAX_FOTO_BYTE) { scartate.push(`foto ${i + 1}: oltre ${MAX_FOTO_BYTE / 1048576} MB`); return }
    const t = m[1].toLowerCase()
    const ext = t === 'png' ? 'png' : (t === 'jpeg' || t === 'jpg') ? 'jpg' : (t.replace(/[^a-z0-9].*$/, '') || 'img')
    foto.push({ nome: String((f as Dati)?.name || ''), mime: `image/${t === 'jpg' ? 'jpeg' : t}`, ext, byte })
  })
  return { foto, scartate }
}

async function caricaFoto(token: string, cartella: string, f: Foto, indirizzo: unknown, n: number): Promise<string> {
  const nome = `Segnalazione_${sanitize(indirizzo)}_${n}_${stampino()}.${f.ext}`
  const boundary = '-------FotoSegnalazione' + crypto.randomUUID()
  const enc = new TextEncoder()
  const testa = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: nome, parents: [cartella] }) +
    `\r\n--${boundary}\r\nContent-Type: ${f.mime}\r\n\r\n`)
  const coda = enc.encode(`\r\n--${boundary}--`)
  const corpo = new Uint8Array(testa.length + f.byte.length + coda.length)
  corpo.set(testa, 0); corpo.set(f.byte, testa.length); corpo.set(coda, testa.length + f.byte.length)
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: corpo,
  })
  const up = await r.json()
  if (!up.id) throw new Error('caricamento della foto su Drive fallito: ' + JSON.stringify(up).slice(0, 300))
  /* Stesso permesso che dava Apps Script: chi ha il link vede. La mail
     interna va a cpt@formedilpadova.it, che non e' una casella Google e
     senza questo i link delle foto non si aprirebbero. */
  const perm = await fetch(`https://www.googleapis.com/drive/v3/files/${up.id}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  if (!perm.ok) console.warn('portale-richieste: permesso «chi ha il link» non dato a', up.id, (await perm.text()).slice(0, 200))
  return (up.webViewLink as string) || `https://drive.google.com/file/d/${up.id}/view`
}

/* ── foglio: la scheda del modulo ──────────────────────────────────────────
   La scheda si trova per gid (segnalazione) o per titolo (notifica), come
   nell'import delle 6:30; con la scheda si legge la riga di testata. */
const norma = (h: unknown) => String(h ?? '').trim().toUpperCase()
async function schedaFoglio(sb: SB, token: string, m: Modulo): Promise<Foglio> {
  const chiave = m.scheda.gid || m.scheda.titolo || ''
  const { data } = await sb.from('s_config').select('chiave, valore').in('chiave', ['rlst_sheet_id', chiave])
  const c = Object.fromEntries((data || []).map((r) => [r.chiave, r.valore]))
  if (!c.rlst_sheet_id || !c[chiave]) throw new Error(`rlst_sheet_id o ${chiave} mancanti in s_config`)
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${c.rlst_sheet_id}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } })
  const meta = await r.json()
  if (meta.error) throw new Error('foglio non leggibile: ' + JSON.stringify(meta.error).slice(0, 300))
  const schede = (meta.sheets || []).map((x: { properties: { sheetId: number; title: string } }) => x.properties)
  /* per titolo: la PRIMA scheda il cui titolo contiene la chiave, cioe' la
     stessa lettura di gidPerTitolo in import-rlst. Deve essere identica,
     altrimenti la copia prenoterebbe il numero su una scheda che l'import non
     legge (trovato in revisione). Cercare il titolo esatto ha fatto fallire
     la prima prova (12/09/2026): «Notifica» contro «Notifica Cantiere». */
  const cercato = String(c[chiave]).toUpperCase()
  const p = m.scheda.gid
    ? schede.find((x: { sheetId: number }) => x.sheetId === Number(c[chiave]))
    : schede.find((x: { title: string }) => String(x.title).toUpperCase().includes(cercato))
  if (!p) throw new Error(`nessuna scheda ${m.scheda.gid ? 'con gid' : 'intitolata'} «${c[chiave]}» nel foglio`)
  const f: Foglio = { sheetId: c.rlst_sheet_id as string, titolo: p.title as string, testata: [] }
  const t = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${f.sheetId}/values/${intervallo(f, '1:1')}`,
    { headers: { Authorization: `Bearer ${token}` } })
  const td = await t.json()
  if (td.error) throw new Error('testata della scheda non leggibile: ' + JSON.stringify(td.error).slice(0, 300))
  f.testata = ((td.values?.[0] || []) as unknown[]).map((h) => String(h ?? ''))
  return f
}
const intervallo = (f: Foglio, a1: string) => encodeURIComponent(`'${f.titolo.replace(/'/g, "''")}'!${a1}`)
const lettera = (i: number): string => (i < 26 ? '' : lettera(Math.floor(i / 26) - 1)) + String.fromCharCode(65 + (i % 26))

async function maxProgressivoFoglio(token: string, f: Foglio): Promise<number> {
  if (!f.testata.length) return 0                     // scheda vuota: nessun numero ancora
  const i = f.testata.findIndex((h) => norma(h) === 'PROGRESSIVO')
  if (i < 0) throw new Error(`nessuna colonna PROGRESSIVO nella scheda ${f.titolo}`)
  const col = lettera(i)
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${f.sheetId}/values/${intervallo(f, `${col}2:${col}`)}`,
    { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('colonna PROGRESSIVO non leggibile: ' + JSON.stringify(d.error).slice(0, 300))
  return Math.max(0, ...((d.values || []) as unknown[][]).map((row) => Number(row?.[0]) || 0))
}

/* La riga si allinea alla testata VERA della scheda: prima le intestazioni
   identiche, poi quelle che le contengono (la stessa lettura dell'import).
   Restituisce i valori non vuoti che non hanno trovato una colonna: la
   pratica li ha comunque, qui si annota soltanto. */
async function appendiFoglio(token: string, f: Foglio, valori: Record<string, string | number>, intestazioni: string[]): Promise<string[]> {
  const testata = f.testata.length ? f.testata : intestazioni
  const posto = new Map<string, number>()
  const presi = new Set<number>()
  for (const k of Object.keys(valori)) {
    const i = testata.findIndex((h, j) => !presi.has(j) && norma(h) === k)
    if (i >= 0) { posto.set(k, i); presi.add(i) }
  }
  for (const k of Object.keys(valori)) {
    if (posto.has(k)) continue
    const i = testata.findIndex((h, j) => !presi.has(j) && norma(h).includes(k))
    if (i >= 0) { posto.set(k, i); presi.add(i) }
  }
  const riga: (string | number)[] = testata.map(() => '')
  for (const [k, i] of posto) riga[i] = valori[k]
  const senzaColonna = Object.keys(valori).filter((k) => !posto.has(k) && valori[k] !== '')
  /* RAW: quel che scrive chi compila resta testo. Con USER_ENTERED un campo
     che comincia con «=» diventerebbe una formula. Una scheda vuota prende
     prima la testata, altrimenti l'import non la saprebbe leggere. */
  const righe = f.testata.length ? [riga] : [intestazioni, riga]
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${f.sheetId}/values/${intervallo(f, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: righe }),
  })
  const d = await r.json()
  if (!r.ok || d.error) throw new Error('riga non aggiunta al foglio: ' + JSON.stringify(d.error || d).slice(0, 300))
  if (!f.testata.length) f.testata = [...intestazioni]
  return senzaColonna
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

/* ══ UNA RICHIESTA DAL PORTALE ═══════════════════════════════════════════ */
async function richiesta(sb: SB, sa: Dati, d: Dati): Promise<Response> {
  const tipo = String(d.tipo_modulo || '').toLowerCase()
  const m = Object.hasOwn(MODULI, tipo) ? MODULI[tipo] : null
  if (!m) return rifiuto(`il modulo «${tipo}» non passa ancora da questa strada`)
  const subId = String(d.submission_id || '').trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(subId)) return rifiuto('submission_id mancante o non valido')
  if (!testo(d.indirizzo_cantiere) || !testo(d.comune_cantiere)) return rifiuto('indirizzo e comune del cantiere sono obbligatori')

  const daUnOra = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await sb.from('s_portale_ricezioni').select('id', { count: 'exact', head: true })
    .eq('origine', 'portale-diretto').gte('ricevuto_at', daUnOra)
  if ((count || 0) > MAX_ORA) return intoppo('troppe richieste nell\'ultima ora: riprova più tardi', 429)

  /* 1. SCATOLA NERA — prima di tutto. Niente base64, e niente testi enormi:
        la scatola nera e' per ritrovare la richiesta, non per custodire
        quel che non sarebbe comunque entrato nella pratica */
  const snello: Dati = {}
  for (const [k, v] of Object.entries(d)) {
    snello[k] = /base64$/.test(k) ? `[${typeof v === 'string' ? v.length : 0} caratteri base64, non copiati]`
      : typeof v === 'string' && v.length > 20000 ? v.slice(0, 20000) + ` […tagliato, ${v.length} caratteri]` : v
  }
  const { error: errRic } = await sb.from('s_portale_ricezioni').upsert({
    submission_id: subId, tipo, timestamp_modulo: istante(d.timestamp),
    ragione_sociale: m.chi(d), email: testo(d.email, 200),
    payload: snello, origine: 'portale-diretto',
  }, { onConflict: 'submission_id', ignoreDuplicates: true })
  if (errRic) throw new Error('scatola nera non scritta: ' + errRic.message)

  /* 1b. UNA LAVORAZIONE ALLA VOLTA — chi arriva secondo aspetta il primo */
  let presa = await prendiLavorazione(sb, subId)
  for (let i = 0; !presa && i < 20; i++) {
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
    /* 1c. GIA' CONSEGNATA DALLA VECCHIA STRADA — una richiesta partita prima
       dell'aggiornamento puo' essere arrivata ad Apps Script (riga sul foglio,
       mail, conferma allo specchio) senza che il telefono lo sapesse, ed
       essere rimasta in coda: e' il 404 in lettura del 04/09/2026. Se la
       scatola nera dice che il foglio l'ha gia' registrata col suo numero, si
       risponde con quel numero e non si rifa' niente: la pratica la crea
       l'import delle 6:30 da quella riga. (Trovato in revisione.) */
    const { data: ric } = await sb.from('s_portale_ricezioni')
      .select('origine, sul_foglio, progressivo, pratica_id').eq('submission_id', subId).maybeSingle()
    if (ric && ric.origine !== 'portale-diretto' && ric.sul_foglio === true && ric.progressivo && !ric.pratica_id) {
      return json({ status: 'ok', progressivo: ric.progressivo, submission_id: subId, duplicato: true, email: 'ok', strada: 'apps-script' })
    }
    return await lavora(sb, sa, d, tipo, m, subId)
  } finally {
    await sb.from('s_portale_ricezioni').update({ lavorazione_dal: null })
      .eq('submission_id', subId).eq('lavorazione_dal', presa)
  }
}

/* ══ 2-5: LA LAVORAZIONE, con la prenotazione in mano ═════════════════════ */
async function lavora(sb: SB, sa: Dati, d: Dati, tipo: string, m: Modulo, subId: string): Promise<Response> {
  let tokDrive: string | null = null
  const drive = async () => (tokDrive ||= await getToken(sa as Record<string, string>, SCOPE_DRIVE))
  let foglio: Foglio | null = null

  /* 2. PRATICA — esiste gia' (reinvio) o nasce adesso */
  let pratica = await praticaPer(sb, m, subId)
  const duplicato = !!pratica
  if (!pratica) {
    const esitoIniziale: Dati = { strada: 'portale-richieste', arrivata_il: new Date().toISOString() }
    /* Il numero parte dal piu' alto fra database e foglio: sul foglio ci sono
       ancora le righe scritte da Apps Script. */
    let maxFoglio = 0
    try {
      foglio = await schedaFoglio(sb, await drive(), m)
      maxFoglio = await maxProgressivoFoglio(await drive(), foglio)
    } catch (e) {
      /* ⚠️ Senza il foglio il numero sarebbe solo quello del database, che non
         conosce le righe scritte da Apps Script e non ancora importate: una di
         quelle col numero uguale sparirebbe all'import delle 6:30. Trovato in
         revisione il 12/09/2026, dopo che la prima prova della notifica era
         passata proprio di qui (scheda cercata col titolo sbagliato). Meglio
         non dare il numero: la richiesta e' nella scatola nera e nella coda
         del telefono, e senza riscontro dopo 15 minuti accende l'allarme. */
      await sb.from('s_portale_ricezioni').update({ nota: 'numero non assegnato, foglio non leggibile: ' + errMsg(e) })
        .eq('submission_id', subId)
      return intoppo(`richiesta ricevuta ma non ancora registrata: il foglio dei numeri non si legge (${errMsg(e)}). Riprovando si completa`)
    }
    const { data: ult } = await sb.from(m.tabella).select('progressivo')
      .not('progressivo', 'is', null).order('progressivo', { ascending: false }).limit(1)
    let prog = Math.max(maxFoglio, Number(ult?.[0]?.progressivo) || 0) + 1
    const riga = {
      fonte: 'modulo',
      submission_id: subId,
      timestamp_modulo: istante(d.timestamp),
      ...(await m.riga(sb, d)),
      portale_esito: esitoIniziale,
    }
    for (let t = 0; t < 6 && !pratica; t++) {
      const { data, error } = await sb.from(m.tabella).insert({ ...riga, progressivo: prog }).select('id, progressivo, portale_esito').single()
      if (!error) { pratica = data as Pratica; break }
      if (error.code === '23505' && /submission_id/.test(error.message)) { pratica = await praticaPer(sb, m, subId); break }
      if (error.code === '23505') { prog++; continue }        // numero preso nel frattempo: il successivo
      throw new Error('pratica non inserita: ' + error.message)
    }
    if (!pratica) throw new Error('numero di ricevuta non assegnabile dopo sei tentativi')
    await sb.from('s_portale_ricezioni').update({ pratica_id: pratica.id, progressivo: pratica.progressivo })
      .eq('submission_id', subId)
  }

  const p = pratica
  const esito: Dati = { ...(p.portale_esito || {}) }
  const salva = async (campi: Dati = {}) => {
    const { error } = await sb.from(m.tabella).update({ portale_esito: esito, ...campi }).eq('id', p.id)
    if (error) console.error('portale-richieste: esito non salvato sulla pratica', m.tabella, p.id, error.message)
  }
  const adesso = () => new Date().toISOString()

  /* 3. FOTO — una per volta, e ognuna salvata appena caricata: un reinvio
        riparte da quelle che mancano, senza doppioni su Drive */
  const fotoUrls: string[] = Array.isArray(esito.foto_caricate) ? [...(esito.foto_caricate as string[])] : []
  if (m.foto) {
    const { foto, scartate } = leggiFoto(d.seg_photo_base64)
    if (scartate.length) esito.foto_scartate = scartate
    if (foto.length > fotoUrls.length) {
      try {
        const tok = await drive()
        const cartella = await cartellaFoto(sb, tok)
        for (let i = fotoUrls.length; i < foto.length; i++) {
          fotoUrls.push(await caricaFoto(tok, cartella, foto[i], d.indirizzo_cantiere, i + 1))
          esito.foto_caricate = [...fotoUrls]
          await salva({ foto_urls: fotoUrls.join('; ') })
        }
        delete esito.foto_errore
      } catch (e) {
        esito.foto_errore = errMsg(e)
        await salva()
        await sb.from('s_portale_ricezioni').update({ nota: 'foto non salvate: ' + errMsg(e) }).eq('submission_id', subId)
        return intoppo(`la richiesta è registrata con il n° ${p.progressivo}, ma le foto non sono state salvate (${errMsg(e)}): riprovando si completano, senza creare una seconda richiesta`)
      }
    }
  }

  /* 4. FOGLIO — la copia della riga, che prenota il numero */
  if (!esito.foglio_il) {
    try {
      const tok = await drive()
      foglio ||= await schedaFoglio(sb, tok, m)
      const senzaColonna = await appendiFoglio(tok, foglio, m.foglio(d, p.progressivo, fotoUrls), m.intestazioni)
      esito.foglio_il = adesso()
      if (senzaColonna.length) esito.foglio_senza_colonna = senzaColonna
      delete esito.foglio_errore
      await sb.from('s_portale_ricezioni').update({ sul_foglio: true, controllato_il: adesso() }).eq('submission_id', subId)
    } catch (e) {
      esito.foglio_errore = errMsg(e)
      await sb.from('s_portale_ricezioni').update({ sul_foglio: false, nota: 'copia sul foglio non scritta: ' + errMsg(e) })
        .eq('submission_id', subId)
    }
    await salva()
  }

  /* 5. MAIL — una volta sola ciascuna; un errore non fa fallire la risposta:
        la pratica c'e', e dire «non riuscito» farebbe reinviare per niente */
  let email = 'ok'
  const emailCompilante = testo(d.email, 200)
  const emailValida = !!emailCompilante && EMAIL_VALIDA.test(emailCompilante)
  if (!esito.mail_interna_il) {
    try {
      const { data: cfg } = await sb.from('s_config').select('valore').eq('chiave', 'portale_mail_segreteria').maybeSingle()
      const mi = mailInterna(tipo, d, p.progressivo, { praticaId: p.id, fotoUrls })
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
  await salva()
  /* la nota della scatola nera dice lo stato di adesso: un intoppo superato
     da un reinvio non deve restare scritto come se ci fosse ancora */
  await sb.from('s_portale_ricezioni').update({
    elaborata_at: adesso(),
    nota: esito.foglio_errore ? 'copia sul foglio non scritta: ' + esito.foglio_errore : null,
  }).eq('submission_id', subId)

  return json({ status: 'ok', progressivo: p.progressivo, submission_id: subId, duplicato, email })
}

/* ══ BATTITO ═════════════════════════════════════════════════════════════ */
async function battito(req: Request, sb: SB, sa: Dati): Promise<Response> {
  const { data: t } = await sb.from('s_config').select('valore').eq('chiave', 'portale_battito_token').maybeSingle()
  if (!t?.valore || req.headers.get('x-token') !== t.valore) {
    return json({ status: 'error', message: 'token del battito non valido' }, 401)
  }
  const verifiche: Record<string, string> = {}
  let tutto = true
  const prova = async (nome: string, fn: () => Promise<string>) => {
    try { verifiche[nome] = 'ok ' + await fn() } catch (e) { verifiche[nome] = 'ERRORE: ' + errMsg(e); tutto = false }
  }
  let tok = ''
  const drive = async () => (tok ||= await getToken(sa as Record<string, string>, SCOPE_DRIVE))
  await prova('database', async () => {
    const conti: string[] = []
    for (const m of Object.values(MODULI)) {
      const { count, error } = await sb.from(m.tabella).select('id', { count: 'exact', head: true })
      if (error) throw new Error(`${m.tabella}: ${error.message}`)
      conti.push(`${m.tabella} ${count}`)
    }
    return `(${conti.join(', ')})`
  })
  if (Object.values(MODULI).some((m) => m.foto)) {
    await prova('drive', async () => `(PDF_ricevuti ${await cartellaFoto(sb, await drive())})`)
  }
  for (const [tipo, m] of Object.entries(MODULI)) {
    await prova('foglio_' + tipo, async () => {
      const f = await schedaFoglio(sb, await drive(), m)
      return `(${f.titolo}, ultimo n° ${await maxProgressivoFoglio(tok, f)})`
    })
  }
  await prova('gmail', async () => {
    await getToken(sa as Record<string, string>, SCOPE_GMAIL)
    return '(delega attiva)'
  })
  if (tutto) {
    const nota = Object.entries(verifiche).map(([k, v]) => `${k}: ${v}`).join(' | ')
    await sb.from('s_config').update({
      valore: new Date().toISOString(), updated_by: 'portale-richieste',
      descrizione: 'Ultimo battito della strada diretta del portale (funzione portale-richieste). ' + nota,
    }).eq('chiave', 'portale_diretto_battito_al')
  }
  return json({ status: tutto ? 'ok' : 'error', verifiche }, tutto ? 200 : 500)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return rifiuto('solo POST')

  const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  const SUPA = Deno.env.get('SUPABASE_URL')
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SA_JSON || !SUPA || !SRV) return intoppo('configurazione della funzione incompleta', 500)
  const sb = createClient(SUPA, SRV, { auth: { persistSession: false } })

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
    return await richiesta(sb, sa, d)
  } catch (e) {
    console.error('portale-richieste:', e)
    return intoppo(errMsg(e))
  }
})
