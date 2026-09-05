// Supabase Edge Function – allegati-protocollo
// I documenti del protocollo vivono su GOOGLE DRIVE, dentro al vault.
//
// ⚠️ IL PROTOCOLLO NON È UN CONTENITORE, È UNA MAPPA.
// I documenti protocollati non restano in una cartella del protocollo:
// vengono smistati dove devono stare, come tutto il resto del second
// brain — il preventivo firmato nell'asseverazione di quell'impresa, la
// circolare in 3_RISORSE. Il protocollo serve a sapere DOVE sono finiti.
//
// ⚠️ IL FILE TIMBRATO NASCE ACCANTO ALL'ORIGINALE.
// Se si timbra un documento già archiviato, il timbrato si crea nella
// STESSA cartella dell'originale (si passa `parent_id`) e non si sposta
// niente: il documento sta dove le regole di smistamento hanno deciso,
// e il timbro non è una ragione per spostarlo.
// Solo ciò che non è ancora stato processato finisce in
// 00_INBOX/_protocollo, che è una zona d'attesa da svuotare.
//
// Funziona perché spostando un file dentro Drive **l'id non cambia**:
// lo smistamento non rompe nessun link.
//
// Azioni (POST JSON):
//   { action:'upload',   codice, filename, mime_type, base64, parent_id? }
//   { action:'download', drive_file_id }
//   { action:'dove',     drive_file_id }
//   { action:'sfoglia',  parent_id? , cerca? }   → naviga le cartelle
//   { action:'cartella', percorso }               → risolve '2_AREE/Enti/...' in un id
//   { action:'agganci',  codice }                 → i file che portano il protocollo nel nome
//   { action:'delete',   drive_file_id }          → cestino, non cancella
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (lo stesso di allegati-ass)
//         DRIVE_PROTOCOLLO_FOLDER_ID facoltativo

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

import { getAccessToken } from '../_shared/google.ts'
// (audit 05/09/2026: il token Google viene dal modulo condiviso, non piu' copiato qui)

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const pulito = (s: string) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim()

async function findFolder(token: string, name: string, parentId: string | null): Promise<string | null> {
  let q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  if (parentId) q += ` and '${parentId}' in parents`
  const u = 'https://www.googleapis.com/drive/v3/files?' +
    new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5' })
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (d.error) throw new Error('Ricerca cartella fallita: ' + JSON.stringify(d.error))
  return d.files?.[0]?.id ?? null
}

async function createFolder(token: string, name: string, parentId: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  const d = await r.json()
  if (!d.id) throw new Error('Creazione cartella fallita: ' + JSON.stringify(d))
  return d.id
}

const cache = new Map<string, string>()

/* La zona d'attesa: 00_INBOX/_protocollo. Non e' l'archivio, e il nome
   lo dice. Ci finisce SOLO cio' che non e' ancora stato processato. */
async function zonaAttesa(token: string): Promise<string> {
  const envId = Deno.env.get('DRIVE_PROTOCOLLO_FOLDER_ID')
  if (envId) return envId
  const c = cache.get('__attesa')
  if (c) return c
  const inbox = await findFolder(token, '00_INBOX', null)
  if (!inbox) throw new Error('Cartella 00_INBOX non trovata su Drive')
  let id = await findFolder(token, '_protocollo', inbox)
  if (!id) id = await createFolder(token, '_protocollo', inbox)
  cache.set('__attesa', id)
  return id
}

/* In che cartella si trova adesso un file, risalendo fino alla radice.
   Rende il protocollo una mappa, e dice anche in quale cartella far
   nascere il timbrato. */
async function percorso(token: string, fileId: string) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents,trashed,webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } })
  const f = await r.json()
  if (f.error) throw new Error('File non leggibile: ' + JSON.stringify(f.error))

  const pezzi: string[] = []
  let padre = f.parents?.[0]
  const primoPadre = padre ?? null
  let giri = 0
  while (padre && giri++ < 12) {
    let nome = cache.get('nome:' + padre)
    let nonno: string | undefined = cache.get('padre:' + padre)
    if (!nome) {
      const rr = await fetch(
        `https://www.googleapis.com/drive/v3/files/${padre}?fields=id,name,parents`,
        { headers: { Authorization: `Bearer ${token}` } })
      const d = await rr.json()
      if (d.error) break
      nome = d.name
      nonno = d.parents?.[0]
      cache.set('nome:' + padre, nome!)
      if (nonno) cache.set('padre:' + padre, nonno)
    }
    pezzi.unshift(nome!)
    padre = nonno
  }
  return {
    nome: f.name,
    cestinato: !!f.trashed,
    cartella: pezzi.join(' / '),
    parent_id: primoPadre,
    drive_url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
  }
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    const token = await getAccessToken(JSON.parse(SA_JSON))

    const body = await req.json()
    const action = body.action as string

    if (action === 'upload') {
      const { codice, filename, mime_type, base64, parent_id } = body
      if (!base64 || !filename) throw new Error('filename/base64 mancanti')

      /* Se chi chiama sa gia' dove va (il timbrato accanto al suo
         originale), si usa quella cartella. Altrimenti zona d'attesa. */
      const folderId = parent_id || await zonaAttesa(token)
      const inAttesa = !parent_id

      /* Il codice del protocollo entra nel NOME, non nella cartella:
         cosi' il file resta riconoscibile ovunque venga smistato. */
      const nudo = pulito(filename)
      const cod = pulito(codice)
      const safeName = cod && !nudo.includes(cod) ? `${cod}_${nudo}` : nudo
      const fileBytes = b64ToBytes(base64)
      const boundary = '-------DocumentoProtocollo'
      const metadata = JSON.stringify({ name: safeName, parents: [folderId] })
      const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
      const dataPart = `--${boundary}\r\nContent-Type: ${mime_type || 'application/octet-stream'}\r\n\r\n`
      const endPart = `\r\n--${boundary}--`
      const metaBytes = new TextEncoder().encode(metaPart)
      const headBytes = new TextEncoder().encode(dataPart)
      const endBytes = new TextEncoder().encode(endPart)
      const payload = new Uint8Array(metaBytes.length + headBytes.length + fileBytes.length + endBytes.length)
      let off = 0
      payload.set(metaBytes, off); off += metaBytes.length
      payload.set(headBytes, off); off += headBytes.length
      payload.set(fileBytes, off); off += fileBytes.length
      payload.set(endBytes, off)

      const upRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload })
      const upData = await upRes.json()
      if (!upData.id) throw new Error('Caricamento su Drive fallito: ' + JSON.stringify(upData))

      return new Response(JSON.stringify({
        ok: true,
        drive_file_id: upData.id,
        drive_url: upData.webViewLink || `https://drive.google.com/file/d/${upData.id}/view`,
        file_name: safeName,
        in_attesa: inAttesa,
        cartella: inAttesa ? '00_INBOX / _protocollo' : undefined,
        dimensione: fileBytes.length,
      }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    /* Sfogliare le cartelle del vault, per scegliere un documento
       senza dover andare a cercarne il link su Drive a mano.
       Senza parent_id parte dalla radice; con `cerca` cerca per nome
       dappertutto, che su un archivio grande e' spesso piu' rapido. */
    if (action === 'sfoglia') {
      const { parent_id, cerca } = body
      const q = cerca
        ? `name contains '${esc(String(cerca))}' and trashed = false`
        : `'${parent_id || 'root'}' in parents and trashed = false`
      const u = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
        q, pageSize: '200', orderBy: 'folder,name',
        fields: 'files(id,name,mimeType,size,modifiedTime)',
      })
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      if (d.error) throw new Error('Non riesco a leggere la cartella: ' + JSON.stringify(d.error))
      const voci = (d.files || []).map((f: Record<string, string>) => ({
        id: f.id,
        nome: f.name,
        cartella: f.mimeType === 'application/vnd.google-apps.folder',
        mime: f.mimeType,
        dimensione: f.size ? Number(f.size) : null,
        modificato: f.modifiedTime,
      }))
      return new Response(JSON.stringify({ ok: true, voci }),
        { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    /* Da un percorso del vault ('2_AREE/Enti/FORMEDIL Italia') all'id
       della cartella, scendendo un segmento alla volta. Serve perche' il
       protocollo sa gia' dove il documento e' stato archiviato: quando si
       collega un file, tanto vale partire di li' invece che dalla radice.
       Restituisce anche la pila dei nomi, per le briciole di pane.       */
    if (action === 'cartella') {
      const percorsoTesto = String(body.percorso || '').trim()
      if (!percorsoTesto) throw new Error('percorso mancante')
      const segmenti = percorsoTesto.split(/[\\/]+/).map((x: string) => x.trim()).filter(Boolean)
      const pila: { id: string; nome: string }[] = []
      let padre: string | null = null
      let mancante: string | null = null
      for (const seg of segmenti) {
        /* Il primo segmento si cerca dentro la radice; se li' non c'e',
           lo si cerca dappertutto (e' quel che fa gia' zonaAttesa per
           00_INBOX, che nella radice condivisa non sempre si vede). */
        let id = await findFolder(token, seg, padre ?? 'root')
        if (!id && !padre) id = await findFolder(token, seg, null)
        if (!id) { mancante = seg; break }
        pila.push({ id, nome: seg })
        padre = id
      }
      return new Response(JSON.stringify({
        ok: true,
        id: pila.at(-1)?.id ?? null,
        pila,
        /* Se un pezzo del percorso non esiste su Drive si dice quale, e chi
           chiama apre la cartella piu' profonda che ha trovato invece di
           fallire: meglio partire vicini che ripartire dalla radice. */
        mancante,
      }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    /* I documenti che portano gia' il codice del protocollo nel NOME.
       E' la regola dell'ufficio ribaltata a favore della macchina: il
       numero si scrive nel nome del file perche' l'umano lo ritrovi
       sfogliando Drive, e allora puo' ritrovarlo anche l'app — senza
       che nessuno vada a ripescare i link a mano.                      */
    if (action === 'agganci') {
      const codice = String(body.codice || '').trim()
      if (!codice) throw new Error('codice mancante')
      const u = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
        q: `name contains '${esc(codice)}' and trashed = false`,
        pageSize: '100', fields: 'files(id,name,mimeType,size,modifiedTime)',
      })
      const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      if (d.error) throw new Error('Ricerca su Drive fallita: ' + JSON.stringify(d.error))

      /* `name contains` e' una sottostringa qualunque, e la sola
         delimitazione non basta: '2012-in' pesca anche
         «ELEN_visite-cantiere-per-tecnico-2012-in-poi.xlsx», dove
         quel numero non e' un protocollo ma un anno (successo alla
         prima prova, 29/08/2026). Perche' sia un protocollo il codice
         deve essere annunciato come tale: preceduto da «Prot», oppure
         in testa al nome — che e' la forma con cui l'app battezza i
         file che carica lei. */
      const codiceEsc = codice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const fine = '([^0-9A-Za-z]|$)'
      const dentro = /^prot/i.test(codice)
        /* la serie unica dal 1/10/2026 ha gia' «Prot_» dentro al codice */
        ? new RegExp('(^|[^0-9A-Za-z])' + codiceEsc + fine, 'i')
        : new RegExp('(^' + codiceEsc + fine + ')'
          + '|((^|[^0-9A-Za-z])prot[._ -]*' + codiceEsc + fine + ')', 'i')

      const trovati = []
      for (const f of (d.files || [])) {
        if (f.mimeType === 'application/vnd.google-apps.folder') continue
        if (!dentro.test(f.name)) continue
        let cartella = ''
        try { cartella = (await percorso(token, f.id)).cartella } catch { /* si mostra lo stesso */ }
        trovati.push({
          id: f.id, nome: f.name, mime: f.mimeType, cartella,
          dimensione: f.size ? Number(f.size) : null,
          modificato: f.modifiedTime,
          drive_url: `https://drive.google.com/file/d/${f.id}/view`,
        })
      }
      trovati.sort((a, b) => a.nome.localeCompare(b.nome, 'it'))
      return new Response(JSON.stringify({ ok: true, voci: trovati }),
        { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (action === 'dove') {
      const { drive_file_id } = body
      if (!drive_file_id) throw new Error('drive_file_id mancante')
      return new Response(JSON.stringify({ ok: true, ...(await percorso(token, drive_file_id)) }),
        { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (action === 'download') {
      const { drive_file_id } = body
      if (!drive_file_id) throw new Error('drive_file_id mancante')
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!r.ok) throw new Error('Lettura da Drive fallita: ' + (await r.text()).slice(0, 300))
      const bytes = new Uint8Array(await r.arrayBuffer())
      return new Response(JSON.stringify({
        ok: true,
        base64: bytesToB64(bytes),
        mime_type: r.headers.get('Content-Type') || 'application/octet-stream',
      }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    if (action === 'delete') {
      const { drive_file_id } = body
      if (!drive_file_id) throw new Error('drive_file_id mancante')
      // Nel cestino, non cancellato per sempre: il vault non cancella (regola d'oro 4).
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${drive_file_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      })
      if (!r.ok && r.status !== 404) throw new Error('Spostamento nel cestino fallito: ' + (await r.text()).slice(0, 300))
      return new Response(JSON.stringify({ ok: true, cestinato: true }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    throw new Error('azione non riconosciuta: ' + action)
  } catch (e) {
    console.error('allegati-protocollo:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
