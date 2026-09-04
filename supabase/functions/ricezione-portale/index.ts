// Supabase Edge Function – ricezione-portale
//
// SECONDO CANALE DEL PORTALE SERVIZI (04/09/2026).
//
// Il portale pubblico (formedilpadovacpt.github.io/servizi) manda qui una
// copia di ogni richiesta, in parallelo alla scrittura sul foglio Google.
// Due strade su due fornitori diversi: se una cade, l'altra regge, e le
// righe rimaste senza conferma dicono quale richiesta e' andata persa.
// Nasce dall'incidente di agosto 2026 (deployment Apps Script morto dal
// ~27/07: cinque settimane di moduli persi in silenzio).
//
// ⚠️ Questa NON e' la fonte dei dati: la fonte resta il foglio, e da li' le
// tabelle di pratica. Serve ad ACCORGERSI, non a lavorare.
//
// Tre azioni, riconosciute dal corpo della richiesta:
//
//  1. SPECCHIO  (il portale, subito prima di inviare al foglio)
//     { tipo_modulo, submission_id, ...campi }  ->  riga in s_portale_ricezioni
//
//  2. CONFERMA  (il backend Apps Script, a riga scritta sul foglio)
//     { conferma: '<submission_id>', progressivo: N }  ->  sul_foglio = true
//     Non serve nessun segreto: si puo' confermare solo un submission_id
//     GIA' presente in tabella, e quel valore e' un uuid casuale che
//     conoscono soltanto chi ha inviato e chi ha ricevuto. Chi non lo sa
//     non puo' nascondere una perdita, e chi lo sa e' il mittente stesso.
//     Una richiesta che resta senza conferma per piu' di un quarto d'ora
//     e' arrivata qui ma NON al foglio: e' la perdita che si vuole vedere.
//
//  3. BATTITO   (il backend Apps Script, dal ping giornaliero)
//     { battito: true, foglio, drive } + intestazione X-Token
//     -> aggiorna s_config.portale_battito_al
//     Qui il segreto serve: un battito falsificabile NASCONDEREBBE un
//     guasto, che e' il danno peggiore. Il token sta in s_config
//     (portale_battito_token) e, dal lato Apps Script, nelle Proprieta'
//     dello script — mai nel sito pubblico.
//
// verify_jwt = false, di proposito: il portale e' pubblico e anonimo, come
// lo e' l'endpoint Apps Script che gia' riceve le stesse richieste. Nessuna
// chiave viaggia nel sito. In cambio la porta e' stretta: solo POST, JSON,
// corpo <= 64 KB, tipo_modulo fra quelli noti, niente allegati (i base64
// sono scartati: i file stanno su Drive) e un tetto orario.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TIPI = ['rlst', 'rls', 'conf', 'vis', 'cons', 'att', 'not', 'seg', 'qst']
const MAX_BYTE = 64 * 1024
const MAX_ORA = 300

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const rispondi = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  try {
    if (req.method !== 'POST') return rispondi({ error: 'solo POST' }, 405)

    const SUPA = Deno.env.get('SUPABASE_URL')
    const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPA || !SRV) throw new Error('Chiavi Supabase non disponibili nella funzione')

    const db = async (rotta: string, init?: RequestInit) =>
      await fetch(`${SUPA}/rest/v1/${rotta}`, {
        ...init,
        headers: {
          apikey: SRV,
          Authorization: `Bearer ${SRV}`,
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      })

    const testo = await req.text()
    if (!testo) return rispondi({ error: 'corpo vuoto' }, 400)
    if (testo.length > MAX_BYTE) return rispondi({ error: 'corpo troppo grande' }, 413)

    let d: Record<string, unknown>
    try {
      d = JSON.parse(testo)
    } catch {
      return rispondi({ error: 'JSON illeggibile' }, 400)
    }

    // ── 2. CONFERMA dal backend: la riga è arrivata anche sul foglio ─────────
    if (d.conferma) {
      const id = String(d.conferma)
      const r = await db(`s_portale_ricezioni?submission_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sul_foglio: true,
          progressivo: Number(d.progressivo) || null,
          controllato_il: new Date().toISOString(),
        }),
        headers: { Prefer: 'return=representation' },
      })
      const righe = (await r.json()) as unknown[]
      // niente riga = l'invio non era passato dallo specchio (o è vecchio):
      // non è un errore, è solo una conferma che non trova nulla da segnare
      return rispondi({ ok: true, confermate: Array.isArray(righe) ? righe.length : 0 })
    }

    // ── 3. BATTITO dal backend: il canale è vivo ─────────────────────────────
    if (d.battito) {
      const atteso = await db('s_config?chiave=eq.portale_battito_token&select=valore')
      const cfg = (await atteso.json()) as { valore: string }[]
      const token = cfg && cfg[0] ? cfg[0].valore : ''
      if (!token || req.headers.get('x-token') !== token) {
        return rispondi({ error: 'token del battito non valido' }, 401)
      }
      const nota = `foglio: ${d.foglio || '?'} | drive: ${d.drive || '?'}`
      await db('s_config?chiave=eq.portale_battito_al', {
        method: 'PATCH',
        body: JSON.stringify({
          valore: new Date().toISOString(),
          updated_by: 'apps-script',
          descrizione: 'Ultimo battito del canale portale servizi. ' + nota,
        }),
      })
      return rispondi({ ok: true, battito: new Date().toISOString() })
    }

    // ── 1. SPECCHIO di un invio dal portale ─────────────────────────────────
    const tipo = String(d.tipo_modulo || '').toLowerCase()
    if (!TIPI.includes(tipo)) return rispondi({ error: 'tipo_modulo non riconosciuto' }, 400)
    const submissionId = String(d.submission_id || '')
    if (!submissionId) return rispondi({ error: 'submission_id mancante' }, 400)

    /* tetto orario: non e' una difesa dai malintenzionati (nessuna lo
       sarebbe su una porta pubblica) ma evita che un errore o uno script
       impazzito riempia la tabella prima che qualcuno se ne accorga */
    const daUnOra = new Date(Date.now() - 3600_000).toISOString()
    const conta = await db(
      `s_portale_ricezioni?select=id&ricevuto_at=gte.${daUnOra}&limit=${MAX_ORA + 1}`,
    )
    const righeUltimaOra = ((await conta.json()) as unknown[]).length
    if (righeUltimaOra > MAX_ORA) {
      return rispondi({ error: 'troppe ricezioni nell ultima ora, specchio sospeso' }, 429)
    }

    /* gli allegati non si specchiano: il file vero sta su Drive, qui
       basta sapere che c'era e quanto pesava */
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(d)) {
      if (/base64$/.test(k)) {
        payload[k] = `[${typeof v === 'string' ? v.length : 0} caratteri base64, non copiati]`
      } else {
        payload[k] = v
      }
    }

    const riga = {
      submission_id: submissionId,
      tipo,
      timestamp_modulo: d.timestamp ? String(d.timestamp) : null,
      ragione_sociale: (d.ragione_sociale as string) || (d.notifica as string) || null,
      email: (d.email as string) || null,
      payload,
      origine: 'portale',
    }

    /* ignore-duplicates: il portale ritenta con lo stesso submission_id
       finche' non ha conferma, ed e' giusto che lo specchio non protesti */
    const ins = await db('s_portale_ricezioni', {
      method: 'POST',
      body: JSON.stringify(riga),
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    })
    if (!ins.ok && ins.status !== 409) {
      const t = await ins.text()
      throw new Error(`insert fallito (${ins.status}): ${t}`)
    }

    return rispondi({ ok: true, submission_id: submissionId })
  } catch (e) {
    console.error('ricezione-portale:', e)
    return rispondi({ error: (e as Error).message }, 400)
  }
})
