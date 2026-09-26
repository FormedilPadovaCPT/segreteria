// Supabase Edge Function – portale-ricevi (progetto SERVIZI, qcvwrgjldbdoxcfdsvkq)
//
// LA CASSETTA DELLE LETTERE DEL PORTALE SERVIZI (13/09/2026).
//
// E' l'unica porta aperta a internet per i moduli del portale pubblico. Deciso
// con l'utente dopo le prove di sicurezza del 13/09/2026: prima i moduli
// arrivavano a una funzione del Gestionale che aveva in mano la chiave completa
// di quel database e la chiave Google dell'ente (Drive, posta). Un errore in quel
// codice, raggiungibile da chiunque, avrebbe avuto a disposizione tutto. Qui non
// c'e' nessuna delle due: questa funzione conosce solo il progetto Servizi.
//
// Che cosa fa, in quest'ordine:
//  1. controlli che non costano niente: tipo di modulo, identificativo, campi
//     obbligatori, dimensione per modulo (gli stessi della v10 del Gestionale);
//  2. se la compilazione e' gia' in cassetta: ritirata → risponde col numero;
//     scartata → rifiuto; arrivata → prosegue senza riscriverla (reinvio);
//  3. TETTO per tutti e per impronta dell'IP, contato e segnato dal database
//     (cassetta_quota), solo per le compilazioni nuove;
//  4. SALVA la riga: i campi del modulo senza allegati, con nomi puliti e testi
//     limitati. Da qui il dato non si perde;
//  5. ALLEGATI nel bucket privato cassetta-allegati, controllati sul contenuto:
//     una «foto» che non e' un'immagine o un «PDF» che non e' un PDF resta fuori,
//     e il motivo viaggia con la richiesta fino alla segreteria;
//  6. CAMPANELLO al Gestionale: la funzione portale-richieste riceve solo
//     l'identificativo, con la parola d'ordine, e viene a prendersi i dati da
//     sola. Se risponde col numero, il telefono lo mostra; se non risponde, la
//     richiesta resta in cassetta e la ritira il giro automatico del Gestionale
//     (ogni 3 minuti): al telefono si dice «ricevuta, il numero arriva con la mail».
//
// Risposta (letta dal portale, stessa forma di prima):
//   { status:'ok', progressivo, submission_id, duplicato, email }
//   { status:'ok', progressivo:null, in_attesa:true, submission_id }
//   { status:'error', riprovabile:true|false, message }
//
// verify_jwt = false, di proposito: il portale e' pubblico e anonimo.
// Sorgente in segreteria-app/supabase/progetto-servizi/functions/portale-ricevi/.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type Dati = Record<string, unknown>
type SB = ReturnType<typeof createClient>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TIPI = ['seg', 'not', 'cons', 'vis', 'conf', 'att', 'rlst', 'rls', 'qst', 'qev', 'tst', 'isc', 'dtst']
/* gli stessi campi obbligatori della tabella MODULI del Gestionale */
const OBBLIGATORI: Record<string, string[]> = {
  seg: ['indirizzo_cantiere', 'comune_cantiere'], not: ['indirizzo_cantiere', 'comune_cantiere'],
  cons: ['ragione_sociale'], vis: ['ragione_sociale'], conf: ['ragione_sociale'], att: ['ragione_sociale'],
  rlst: ['ragione_sociale'], rls: ['ragione_sociale'], qst: [],
  /* qev: il questionario di un evento non chiede niente di obbligatorio qui —
     quali risposte servano lo dice il Gestionale, che conosce le domande */
  qev: [],
  /* tst: la prova del test finale. Il codice personale lo controlla il
     Gestionale, che sa chi c'e' in quel corso: qui non si puo' sapere. */
  tst: [],
  /* isc: iscrizione a un evento. Non si chiede qui nemmeno la ragione sociale:
     puo' iscriversi un'impresa per i suoi lavoratori OPPURE una persona per
     se' (un libero professionista a un convegno). Che cosa serve davvero lo
     controlla il Gestionale, che sa di quale evento si tratta. */
  isc: [],
  /* dtst: il TEST scritto dal DOCENTE (19/09/2026). Qui non si controlla
     niente del contenuto: a dire se l'invito vale e se le domande stanno in
     piedi e' il Gestionale, che conosce corso e invito. */
  dtst: [],
}
const MAX_CARATTERI = 28 * 1024 * 1024
const MAX_CARATTERI_MODULO: Record<string, number> = {
  rls: 28 * 1024 * 1024, rlst: 16 * 1024 * 1024, seg: 20 * 1024 * 1024, not: 768 * 1024,
  /* un questionario sono poche righe: 64 KB sono gia' larghi. La misura sta
     per tipo apposta — una porta pubblica si difende dall'abuso, non solo
     dall'accesso (13/09/2026). */
  qev: 64 * 1024,
  tst: 256 * 1024,
  /* un'iscrizione e' testo: tante anagrafiche, nessun allegato */
  isc: 256 * 1024,
  /* un test: fino a 40 domande con le risposte proposte, nessun allegato */
  dtst: 256 * 1024,
}
const MAX_CARATTERI_ALTRI = 256 * 1024
const MAX_FOTO = 3
const MAX_FOTO_BYTE = 6 * 1024 * 1024
const MAX_ALLEGATO_BYTE = 12 * 1024 * 1024
const PDF_DEL_MODULO: Record<string, [string, string][]> = {
  rlst: [['pdf', 'Verbale di riunione']],
  rls: [['pdf_verbale', 'Verbale di elezione'], ['pdf_formazione', 'Attestato di formazione']],
}
const MAX_CHIAVI = 150
const MAX_TESTO = 20000
const MAX_ELENCO_JSON = 256 * 1024
const MAX_PAYLOAD = 1024 * 1024
const ATTESA_GESTIONALE_MS = 55_000
const BUCKET = 'cassetta-allegati'

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
/* rifiuto = insistere non serve; intoppo = riprovando puo' passare */
const rifiuto = (message: string) => json({ status: 'error', riprovabile: false, message }, 400)
const intoppo = (message: string, status = 503) => json({ status: 'error', riprovabile: true, message }, status)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'errore interno')

async function impostazioni(sb: SB): Promise<Record<string, string>> {
  const { data, error } = await sb.from('cassetta_impostazioni').select('chiave, valore')
  if (error) throw new Error('impostazioni della cassetta non leggibili: ' + error.message)
  return Object.fromEntries((data || []).map((r) => [r.chiave as string, r.valore as string]))
}

/* l'IP serve solo al tetto: se ne tiene un'impronta col sale, mai l'indirizzo */
const indirizzoIp = (req: Request) =>
  (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'sconosciuto'
async function impronta(sale: string, ip: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sale + ':' + ip)))
  return [...h.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* i campi del modulo senza allegati: nomi puliti, testi limitati, al massimo
   un megabyte in tutto. Il Gestionale poi tiene solo le chiavi che il modulo usa. */
function soloTesti(d: Dati): Dati | null {
  const out: Dati = {}
  let chiavi = 0
  let elenchi = 0
  for (const [k, v] of Object.entries(d)) {
    if (/base64$/.test(k) || !/^[a-z][a-z0-9_]{0,39}$/.test(k)) continue
    if (++chiavi > MAX_CHIAVI) break
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') {
      if (/_json$/.test(k)) { if (v.length <= MAX_ELENCO_JSON && ++elenchi <= 4) out[k] = v }
      else out[k] = v.slice(0, MAX_TESTO)
    } else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => String(x ?? '').slice(0, 300))
    else if (v !== null && v !== undefined) out[k] = JSON.stringify(v).slice(0, MAX_TESTO)
  }
  return JSON.stringify(out).length <= MAX_PAYLOAD ? out : null
}

function decodifica(b64: string): Uint8Array | null {
  /* un ciclo semplice: con due PDF da 8 MB una funzione chiamata per ogni
     carattere rischia il limite di CPU della edge function */
  try {
    const bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s/g, ''))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}
/* Il tipo dichiarato non basta: si guarda l'inizio del file. SVG escluso: e'
   testo che puo' contenere script. Il tipo con cui si salva e' quello vero. */
const inizia = (b: Uint8Array, da: number, ...xs: number[]) => xs.every((x, i) => b[da + i] === x)
const MARCHI_HEIF = ['heic', 'heix', 'hevc', 'heif', 'mif1', 'msf1']
function tipoImmagine(b: Uint8Array): { mime: string; ext: string } | null {
  if (inizia(b, 0, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' }
  if (inizia(b, 0, 0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', ext: 'png' }
  if (inizia(b, 0, 0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', ext: 'gif' }
  if (inizia(b, 0, 0x42, 0x4d)) return { mime: 'image/bmp', ext: 'bmp' }
  if (inizia(b, 0, 0x52, 0x49, 0x46, 0x46) && inizia(b, 8, 0x57, 0x45, 0x42, 0x50)) return { mime: 'image/webp', ext: 'webp' }
  if (inizia(b, 4, 0x66, 0x74, 0x79, 0x70)) {
    const marca = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (marca === 'avif') return { mime: 'image/avif', ext: 'avif' }
    if (MARCHI_HEIF.includes(marca)) return { mime: 'image/heic', ext: 'heic' }
  }
  return null
}
/* «%PDF-» nei primi 1024 byte, come ammette la specifica */
const ePdf = (b: Uint8Array) => new TextDecoder('latin1').decode(b.subarray(0, 1024)).includes('%PDF-')

type Allegato = { campo: string; nome: string; mime: string; byte: number; percorso: string }

/* Restituisce null se tutto e' andato, altrimenti il motivo (riprovabile). */
async function salvaAllegati(sb: SB, tipo: string, subId: string, d: Dati): Promise<string | null> {
  const allegati: Allegato[] = []
  const pezzi: Uint8Array[] = []
  const scartati: string[] = []
  if (tipo === 'seg' && d.seg_photo_base64) {
    let lista: unknown = d.seg_photo_base64
    if (typeof lista === 'string') { try { lista = JSON.parse(lista) } catch { lista = null } }
    if (!Array.isArray(lista)) scartati.push('elenco delle foto illeggibile')
    else {
      if (lista.length > MAX_FOTO) scartati.push(`arrivate ${lista.length} foto, tenute le prime ${MAX_FOTO}`)
      lista.slice(0, MAX_FOTO).forEach((f, i) => {
        const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String((f as Dati)?.data || ''))
        if (!m) { scartati.push(`foto ${i + 1}: non e' un'immagine in formato data URL`); return }
        const byte = decodifica(m[1])
        if (!byte || !byte.length) { scartati.push(`foto ${i + 1}: contenuto non decodificabile`); return }
        if (byte.length > MAX_FOTO_BYTE) { scartati.push(`foto ${i + 1}: oltre ${MAX_FOTO_BYTE / 1048576} MB`); return }
        const t = tipoImmagine(byte)
        if (!t) { scartati.push(`foto ${i + 1}: il contenuto non e' un'immagine`); return }
        allegati.push({ campo: 'foto', nome: String((f as Dati)?.name || '').slice(0, 200), mime: t.mime, byte: byte.length, percorso: `${subId}/foto-${i + 1}.${t.ext}` })
        pezzi.push(byte)
      })
    }
  }
  for (const [base, etichetta] of PDF_DEL_MODULO[tipo] || []) {
    const b64 = d[base + '_base64']
    if (typeof b64 !== 'string' || !b64) continue
    const byte = decodifica(b64)
    if (!byte || !byte.length) { scartati.push(`${etichetta}: contenuto non decodificabile`); continue }
    if (byte.length > MAX_ALLEGATO_BYTE) { scartati.push(`${etichetta}: oltre ${MAX_ALLEGATO_BYTE / 1048576} MB`); continue }
    if (!ePdf(byte)) { scartati.push(`${etichetta}: il file non e' un PDF`); continue }
    allegati.push({ campo: base, nome: String(d[base + '_nome'] || '').slice(0, 200), mime: 'application/pdf', byte: byte.length, percorso: `${subId}/${base}.pdf` })
    pezzi.push(byte)
  }
  for (let i = 0; i < allegati.length; i++) {
    const { error } = await sb.storage.from(BUCKET).upload(allegati[i].percorso, pezzi[i], { contentType: allegati[i].mime, upsert: true })
    if (error) return `${allegati[i].campo}: ${error.message}`
  }
  const { error } = await sb.from('cassetta').update({
    allegati, allegati_byte: allegati.reduce((s, a) => s + a.byte, 0), allegati_pronti: true,
    nota: scartati.length ? scartati.join('; ').slice(0, 1000) : null,
  }).eq('submission_id', subId).eq('stato', 'arrivata')
  if (error) return 'elenco degli allegati non salvato: ' + error.message
  return null
}

/* Il campanello: il Gestionale riceve solo l'identificativo e si prende i dati
   da solo. Qualunque cosa vada storta qui, la richiesta e' gia' al sicuro in
   cassetta e il giro automatico la ritira. */
async function campanello(imp: Record<string, string>, subId: string): Promise<Response> {
  try {
    const r = await fetch(imp.gestionale_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cassetta-Token': imp.cassetta_token },
      body: JSON.stringify({ ritira: subId }),
      signal: AbortSignal.timeout(ATTESA_GESTIONALE_MS),
    })
    const t = (await r.json().catch(() => null)) as Dati | null
    if (r.ok && t?.status === 'ok') {
      return json({ status: 'ok', progressivo: t.progressivo ?? null, submission_id: subId, duplicato: !!t.duplicato, email: t.email ?? 'ok' })
    }
    if (r.status === 400 && t?.riprovabile === false) return rifiuto(String(t.message || 'richiesta rifiutata'))
    console.warn('portale-ricevi: il Gestionale non ha completato', subId, r.status, String(t?.message || '').slice(0, 300))
  } catch (e) {
    console.warn('portale-ricevi: il Gestionale non ha risposto', subId, errMsg(e))
  }
  return json({ status: 'ok', progressivo: null, submission_id: subId, in_attesa: true, email: 'in-attesa' })
}

async function ricevi(sb: SB, req: Request, d: Dati, dimensione: number): Promise<Response> {
  const tipo = String(d.tipo_modulo || '').toLowerCase()
  if (!TIPI.includes(tipo)) return rifiuto(`il modulo «${tipo.slice(0, 20)}» non passa da questa strada`)
  if (dimensione > (MAX_CARATTERI_MODULO[tipo] ?? MAX_CARATTERI_ALTRI)) return rifiuto(`richiesta troppo grande per il modulo «${tipo}»`)
  const subId = String(d.submission_id || '').trim()
  if (!/^[A-Za-z0-9-]{8,64}$/.test(subId)) return rifiuto('submission_id mancante o non valido')
  const mancanti = OBBLIGATORI[tipo].filter((k) => !String(d[k] ?? '').trim())
  if (mancanti.length) return rifiuto(`campi obbligatori mancanti: ${mancanti.join(', ')}`)

  const imp = await impostazioni(sb)
  const { data: gia, error: errGia } = await sb.from('cassetta')
    .select('stato, progressivo, esito, allegati_pronti').eq('submission_id', subId).maybeSingle()
  if (errGia) throw new Error('cassetta non leggibile: ' + errGia.message)
  if (gia?.stato === 'ritirata') {
    return json({ status: 'ok', progressivo: gia.progressivo ?? null, submission_id: subId, duplicato: true, email: 'ok' })
  }
  if (gia?.stato === 'scartata') return rifiuto(String((gia.esito as Dati | null)?.motivo || 'richiesta scartata'))

  if (!gia) {
    const payload = soloTesti(d)
    if (!payload) return rifiuto('troppi dati nei campi del modulo')
    const ip = await impronta(imp.ip_sale || '', indirizzoIp(req))
    const { data: ammesso, error: errQuota } = await sb.rpc('cassetta_quota', {
      p_ip: ip, p_max_ora: Number(imp.quota_ora) || 60, p_max_ora_ip: Number(imp.quota_ora_ip) || 15,
    })
    if (errQuota) throw new Error('tetto orario non verificato: ' + errQuota.message)
    if (ammesso !== true) return intoppo('troppe richieste nell\'ultima ora: riprova più tardi', 429)
    const { error: errIns } = await sb.from('cassetta').insert({ submission_id: subId, tipo, ip_hash: ip, payload, dimensione })
    if (errIns && errIns.code !== '23505') throw new Error('richiesta non salvata: ' + errIns.message)
  }

  if (!gia?.allegati_pronti) {
    const problema = await salvaAllegati(sb, tipo, subId, d)
    if (problema) return intoppo(`richiesta salvata, ma gli allegati no (${problema}): riprovando si completano`)
  }

  return await campanello(imp, subId)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return rifiuto('solo POST')
  /* il corpo non si legge nemmeno, se chi manda dichiara piu' del tetto */
  if (Number(req.headers.get('content-length') || 0) > MAX_CARATTERI) return rifiuto('richiesta troppo grande')

  const SUPA = Deno.env.get('SUPABASE_URL')
  const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPA || !SRV) return intoppo('configurazione della funzione incompleta', 500)
  const sb = createClient(SUPA, SRV, { auth: { persistSession: false } })

  let corpo: string
  try { corpo = await req.text() } catch { return intoppo('richiesta non leggibile') }
  if (!corpo) return rifiuto('corpo vuoto')
  if (corpo.length > MAX_CARATTERI) return rifiuto('richiesta troppo grande')
  let d: Dati
  try { d = JSON.parse(corpo) } catch { return rifiuto('JSON illeggibile') }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return rifiuto('la richiesta deve essere un oggetto JSON')

  try {
    return await ricevi(sb, req, d, corpo.length)
  } catch (e) {
    console.error('portale-ricevi:', e)
    return intoppo(errMsg(e))
  }
})
