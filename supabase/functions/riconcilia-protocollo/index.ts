// Supabase Edge Function – riconcilia-protocollo
//
// RIMETTERE INSIEME PROTOCOLLI E DOCUMENTI CHE L'ARCHIVIO AVEVA SEPARATI.
// Il registro ereditato da Access ha 4.563 righe e due soli documenti
// attaccati. I documenti però ci sono, nel vault, e quasi sempre portano
// il numero di protocollo nel nome: qui si cerca a quale riga appartengono.
//
// ⚠️ IL NUMERO DA SOLO NON BASTA, MAI.
// Sui due registri storici 2.011 numeri su 2.554 esistono in ENTRAMBI
// (misurato il 29/08/2026): «_Prot1450» può essere un documento in entrata
// del 2015 o uno in uscita del 2018, e il numero non lo dice. Si aggancia
// solo quando numero E data del nome file portano a un candidato solo.
//
// La distanza fra giusto e sbagliato non è sottile: sulle prime 40 circolari
// di prova il candidato buono distava al massimo 10 giorni e il primo
// scartato 609. Chi non passa non è un caso dubbio: è quasi sempre il
// protocollo DEL MITTENTE finito nel nome del file, e agganciarlo sarebbe
// l'errore peggiore di tutti — una circolare del 2026 legata a un
// protocollo del 2014.
//
// Non tocca nessun file: scrive solo righe in s_prot_allegati, che dicono
// dove il documento sta già. Niente si sposta e niente si rinomina.
//
// { percorso, esegui?, giorni?, token? }
//   esegui  assente o false → non scrive niente, dice solo cosa farebbe
//   token   obbligatorio per scrivere: è il valore di s_config.riconcilia_token.
//           La chiave anon dell'app sta in un repository pubblico, quindi
//           senza questo chiunque potrebbe far scrivere questa funzione.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (lo stesso di allegati-protocollo)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payload = {
    iss: sa.client_email,
    sub: 'cptpd@did.formedilpadova.it',
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='
      + `${signingInput}.${sigB64}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Token Google non ottenuto: ' + JSON.stringify(d))
  return d.access_token
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

async function findFolder(token: string, name: string, parentId: string | null) {
  let q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  if (parentId) q += ` and '${parentId}' in parents`
  const u = 'https://www.googleapis.com/drive/v3/files?'
    + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5' })
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('Ricerca cartella fallita: ' + JSON.stringify(d.error))
  return d.files?.[0]?.id ?? null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    const SUPA = Deno.env.get('SUPABASE_URL')
    const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    if (!SUPA || !SRV) throw new Error('Chiavi Supabase non disponibili nella funzione')

    const body = await req.json()
    const percorsoTesto = String(body.percorso || '').trim()
    if (!percorsoTesto) throw new Error('percorso mancante')
    const esegui = body.esegui === true
    const giorni = Number(body.giorni ?? 60)

    const db = async (rotta: string, init?: RequestInit) => {
      const rr = await fetch(`${SUPA}/rest/v1/${rotta}`, {
        ...init,
        headers: {
          apikey: SRV, Authorization: `Bearer ${SRV}`,
          'Content-Type': 'application/json', Prefer: 'return=representation',
          ...(init?.headers || {}),
        },
      })
      const testo = await rr.text()
      if (!rr.ok) throw new Error('Database: ' + testo.slice(0, 300))
      return testo ? JSON.parse(testo) : []
    }

    /* Per scrivere serve la parola d'ordine: la chiave anon dell'app e'
       pubblica, questa no. In sola prova non serve niente. */
    if (esegui) {
      const cfg = await db('s_config?chiave=eq.riconcilia_token&select=valore') as { valore: string }[]
      if (!cfg.length) throw new Error('La riconciliazione e\' chiusa: manca s_config.riconcilia_token')
      if (String(body.token || '') !== cfg[0].valore) throw new Error('Parola d\'ordine non valida')
    }

    const token = await getAccessToken(JSON.parse(SA_JSON))

    /* la cartella di partenza */
    const segmenti = percorsoTesto.split(/[\\/]+/).map((x: string) => x.trim()).filter(Boolean)
    let radice: string | null = null
    for (const seg of segmenti) {
      let id = await findFolder(token, seg, radice ?? 'root')
      if (!id && !radice) id = await findFolder(token, seg, null)
      if (!id) throw new Error(`Su Drive non trovo «${seg}» dentro «${percorsoTesto}»`)
      radice = id
    }

    /* tutti i file la' sotto, sottocartelle comprese */
    type Voce = { id: string; nome: string; mime: string; dimensione: number | null }
    const file: Voce[] = []
    const daVedere: string[] = [radice!]
    let giri = 0
    while (daVedere.length && giri++ < 500) {
      const c = daVedere.shift()!
      const u = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
        q: `'${c}' in parents and trashed = false`,
        pageSize: '1000', fields: 'files(id,name,mimeType,size)',
      })
      const rr = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
      const dd = await rr.json()
      if (dd.error) throw new Error('Lettura cartella: ' + JSON.stringify(dd.error))
      for (const f of dd.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') daVedere.push(f.id)
        else file.push({
          id: f.id, nome: f.name, mime: f.mimeType,
          dimensione: f.size ? Number(f.size) : null,
        })
      }
    }

    /* numero e data dal NOME: sono i due dati che l'ufficio ci ha messo,
       e sono quelli su cui si decide */
    const rxNum = /[_ .-]prot[._ ]?([0-9]{2,5})(?![0-9A-Za-z-])/i
    const rxData = /(^|[^0-9])([0-9]{4})[_.-]([0-9]{2})[_.-]([0-9]{2})(?![0-9])/

    const esito = {
      esaminati: file.length, da_collegare: 0, gia_collegati: 0,
      senza_numero: 0, senza_data: 0, nessun_candidato: 0, ambigui: 0,
      esempi_collegati: [] as string[], esempi_scartati: [] as string[],
    }
    const daScrivere: Record<string, unknown>[] = []
    const principaleDi = new Map<number, string>()
    const cache = new Map<number, { id: number; direzione: string; data_prot: string | null; data_doc: string | null }[]>()
    const giorniFra = (a: string | null, b: string) => (a
      ? Math.abs((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / 86400000)
      : 1e9)

    for (const f of file) {
      const mn = f.nome.match(rxNum)
      if (!mn) { esito.senza_numero++; continue }
      const md = f.nome.match(rxData)
      if (!md) {
        esito.senza_data++
        if (esito.esempi_scartati.length < 15) esito.esempi_scartati.push(`senza data nel nome — ${f.nome}`)
        continue
      }
      const numero = Number(mn[1])
      const dataFile = `${md[2]}-${md[3]}-${md[4]}`

      if (!cache.has(numero)) {
        cache.set(numero, await db(`s_protocollo?numero=eq.${numero}&esercizio=is.null`
          + '&select=id,direzione,data_prot,data_doc'))
      }
      const vicini = cache.get(numero)!.filter((p) =>
        Math.min(giorniFra(p.data_prot, dataFile), giorniFra(p.data_doc, dataFile)) <= giorni)

      if (!vicini.length) {
        esito.nessun_candidato++
        if (esito.esempi_scartati.length < 15) {
          esito.esempi_scartati.push(`n. ${numero} del ${dataFile}: nessun nostro protocollo li' intorno`
            + ` (di solito e' il numero del mittente) — ${f.nome}`)
        }
        continue
      }
      if (vicini.length > 1) {
        esito.ambigui++
        if (esito.esempi_scartati.length < 15) {
          esito.esempi_scartati.push(`n. ${numero} del ${dataFile}: piu' candidati, lasciato stare — ${f.nome}`)
        }
        continue
      }

      const p = vicini[0]
      const gia = await db(`s_prot_allegati?protocollo_id=eq.${p.id}&drive_file_id=eq.${f.id}&select=id`) as unknown[]
      if (gia.length) { esito.gia_collegati++; continue }

      daScrivere.push({
        protocollo_id: p.id, nome: f.nome, mime: f.mime, dimensione: f.dimensione,
        drive_file_id: f.id, drive_url: `https://drive.google.com/file/d/${f.id}/view`,
        created_by: 'riconciliazione archivio',
      })
      if (/[.]pdf$/i.test(f.nome) && !principaleDi.has(p.id)) principaleDi.set(p.id, f.id)
      esito.da_collegare++
      if (esito.esempi_collegati.length < 15) {
        esito.esempi_collegati.push(`${p.direzione} ${numero} del ${dataFile} → ${f.nome}`)
      }
    }

    if (esegui && daScrivere.length) {
      for (let i = 0; i < daScrivere.length; i += 100) {
        await db('s_prot_allegati', { method: 'POST', body: JSON.stringify(daScrivere.slice(i, i + 100)) })
      }
      /* il documento principale sulla riga del protocollo, cosi' si vede
         dall'elenco senza aprire nulla — ma solo dove non c'era gia' */
      for (const [protId, fileId] of principaleDi) {
        await db(`s_protocollo?id=eq.${protId}&drive_file_id=is.null`, {
          method: 'PATCH',
          body: JSON.stringify({
            drive_file_id: fileId,
            drive_url: `https://drive.google.com/file/d/${fileId}/view`,
          }),
        })
      }
    }

    return new Response(JSON.stringify({
      ok: true, percorso: percorsoTesto, eseguito: esegui, finestra_giorni: giorni, ...esito,
    }), { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('riconcilia-protocollo:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
