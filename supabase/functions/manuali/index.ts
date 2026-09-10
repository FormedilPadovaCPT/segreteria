// Supabase Edge Function – manuali
// I manuali d'uso delle app, SEMPRE NELL'ULTIMA VERSIONE PUBBLICATA.
//
// Perche' esiste (10/09/2026): un manuale che gira per mail resta indietro
// rispetto alle versioni. Il 07/09/2026 nella cartella del gestionale c'era
// ancora una copia del manuale tecnici alla v1.5 di luglio, mentre quella
// buona era la v1.12: chi riceve un PDF per posta non ha modo di saperlo.
// Qui l'app chiede e riceve l'ultima, e non serve piu' mandare niente.
//
// DOVE STANNO: su Drive, nel vault, come tutti i documenti dell'ente
// (lo storage Supabase resta vuoto per scelta):
//   9_APPLICATIVI/Gestionale_Visite_APP/Manuali_pubblicati/
//   aaaa_mm_gg_GUIDA_Formedil-Padova_<manuale>_v<N.N>.pdf
// PUBBLICARE una versione = mettere il PDF in quella cartella con quel nome.
// Lo fa da solo ogni generatore di manuale (concludiManuale in
// pubblica_manuale.mjs), che elimina anche la versione precedente: regola
// dell'utente del 10/09/2026, le versioni vecchie «generano solo confusione».
// Non c'e' una tabella da tenere allineata a mano; se per errore restano
// piu' versioni, qui vince comunque la piu' alta.
//
// Azioni (POST JSON, utente autenticato):
//   { azione:'elenco' }            → i manuali che l'utente puo' leggere, ultima versione
//   { azione:'scarica', codice }   → il PDF dell'ultima versione (application/octet-stream)
//
// Chi legge che cosa:
//   tecnici, asseverazione → tutto il personale        (is_personale)
//   segreteria             → segreteria, coordinatore, Direttore
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken } from '../_shared/google.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'content-disposition, x-manuale-versione, x-manuale-nome',
}

type Chi = 'personale' | 'ufficio'
const CATALOGO: Record<string, { titolo: string; slug: string; app: string; chi: Chi }> = {
  tecnici: {
    titolo: 'Manuale dei tecnici', slug: 'manuale-tecnici-gestionale-visite',
    app: 'Gestionale Visite', chi: 'personale',
  },
  asseverazione: {
    titolo: 'Manuale d’uso dell’app Asseverazione', slug: 'manuale-asseverazione-mog',
    app: 'Asseverazione MOG', chi: 'personale',
  },
  segreteria: {
    titolo: 'Manuale della segreteria', slug: 'manuale-segreteria',
    app: 'Segreteria e Gestionale Visite', chi: 'ufficio',
  },
}

const PERCORSO = ['9_APPLICATIVI', 'Gestionale_Visite_APP', 'Manuali_pubblicati']
const NOME = /^(\d{4})_(\d{2})_(\d{2})_GUIDA_Formedil-Padova_([a-z0-9-]+)_v(\d+(?:\.\d+)*)\.pdf$/i

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function findFolder(token: string, name: string, parentId: string | null): Promise<string | null> {
  let q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  if (parentId) q += ` and '${parentId}' in parents`
  const r = await fetch('https://www.googleapis.com/drive/v3/files?' +
    new URLSearchParams({ q, fields: 'files(id)', pageSize: '5' }), { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('Ricerca cartella fallita: ' + JSON.stringify(d.error))
  return d.files?.[0]?.id ?? null
}

let cartellaId: string | null = null
async function cartella(token: string): Promise<string> {
  if (cartellaId) return cartellaId
  let padre: string | null = null
  for (const seg of PERCORSO) {
    /* il primo segmento si cerca nella radice, e se li' non si vede
       dappertutto: stessa strada di allegati-protocollo */
    let id = await findFolder(token, seg, padre ?? 'root')
    if (!id && !padre) id = await findFolder(token, seg, null)
    if (!id) throw new Error(`Cartella dei manuali non trovata su Drive (manca «${seg}»)`)
    padre = id
  }
  cartellaId = padre
  return padre!
}

const confronta = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

type Versione = { codice: string; versione: string; data: string; id: string; nome_file: string; dimensione: number | null }

/* Tutte le versioni presenti nella cartella, raggruppate per manuale e
   ordinate dalla piu' recente. Un file col nome fuori convenzione non
   si pubblica: si ignora, e il perche' e' scritto nel _LEGGIMI della cartella. */
async function versioni(token: string): Promise<Record<string, Versione[]>> {
  const q = `'${await cartella(token)}' in parents and trashed = false`
  const r = await fetch('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q, pageSize: '200', fields: 'files(id,name,size)',
  }), { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('Non riesco a leggere la cartella dei manuali: ' + JSON.stringify(d.error))
  const perSlug = Object.fromEntries(Object.entries(CATALOGO).map(([k, v]) => [v.slug.toLowerCase(), k]))
  const out: Record<string, Versione[]> = {}
  for (const f of d.files || []) {
    const m = NOME.exec(f.name)
    if (!m) continue
    const codice = perSlug[m[4].toLowerCase()]
    if (!codice) continue
    ;(out[codice] ||= []).push({
      codice, versione: m[5], data: `${m[1]}-${m[2]}-${m[3]}`,
      id: f.id, nome_file: f.name, dimensione: f.size ? Number(f.size) : null,
    })
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => confronta(b.versione, a.versione) || b.data.localeCompare(a.data))
  }
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    /* Chi chiama: le funzioni di ruolo del database, eseguite COME
       l'utente (col suo token). Con la sola chiave anon rispondono errore,
       e l'errore vale «no». */
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    })
    const ruolo = async (f: string) => { const { data, error } = await sb.rpc(f); return !error && data === true }
    const [personale, segreteria, coordinatore, direttore] = await Promise.all(
      ['is_personale', 'is_segreteria', 'is_coordinatore', 'is_direttore'].map(ruolo))
    const puo = (chi: Chi) => chi === 'personale'
      ? personale || segreteria || coordinatore || direttore
      : segreteria || coordinatore || direttore
    if (!puo('personale')) return json({ error: 'Utente non abilitato ai manuali delle app' }, 403)

    const body = await req.json().catch(() => ({}))
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    const token = await getAccessToken(JSON.parse(SA_JSON))
    const tutte = await versioni(token)

    if (body.azione === 'elenco') {
      const manuali = Object.entries(CATALOGO)
        .filter(([codice, c]) => puo(c.chi) && tutte[codice]?.length)
        .map(([codice, c]) => {
          const [ultima, ...prima] = tutte[codice]
          return {
            codice, titolo: c.titolo, app: c.app,
            versione: ultima.versione, data: ultima.data,
            nome_file: ultima.nome_file, dimensione: ultima.dimensione,
            versioni_precedenti: prima.map((v) => ({ versione: v.versione, data: v.data })),
          }
        })
      return json({ ok: true, manuali })
    }

    if (body.azione === 'scarica') {
      const codice = String(body.codice || '')
      const c = CATALOGO[codice]
      if (!c) return json({ error: 'Manuale sconosciuto: ' + codice }, 400)
      if (!puo(c.chi)) return json({ error: 'Questo manuale non è fra quelli che il tuo utente può leggere' }, 403)
      const ultima = tutte[codice]?.[0]
      if (!ultima) return json({ error: 'Nessuna versione pubblicata di questo manuale' }, 404)
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${ultima.id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error('Lettura da Drive fallita: ' + (await r.text()).slice(0, 300))
      /* il PDF passa in streaming: il manuale dell'asseverazione pesa 10 MB */
      return new Response(r.body, {
        headers: {
          ...CORS,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${ultima.nome_file}"`,
          'X-Manuale-Versione': ultima.versione,
          'X-Manuale-Nome': ultima.nome_file,
          ...(ultima.dimensione ? { 'Content-Length': String(ultima.dimensione) } : {}),
        },
      })
    }

    return json({ error: 'azione non riconosciuta: ' + body.azione }, 400)
  } catch (e) {
    console.error('manuali:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
