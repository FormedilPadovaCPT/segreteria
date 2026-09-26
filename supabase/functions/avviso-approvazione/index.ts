// Supabase Edge Function – avviso-approvazione
// «C'è una fattura da approvare»: l'avviso al COORDINATORE (21/09/2026).
//
// ⚠️ QUESTA MAIL PARTE DA SOLA, ed è la seconda eccezione dichiarata alla
// regola «le mail dell'ufficio le manda una persona» (la prima è
// l'avviso di pagamento, 16/09). L'ha decisa l'utente: «tanto è solo
// interna non serve altro, perché rischia che solo con l'app non la
// veda». Regge per lo stesso motivo dell'altra: la mail non porta
// NIENTE scritto da chi la fa partire — tecnico, numero, data e importo
// della fattura, prestazioni collegate e netto si leggono dal database.
// Chi chiama passa solo gli id delle fatture.
//
// Dove porta il pulsante: la Zona Coordinatore del GESTIONALE VISITE
// (?vista=admin), non l'app Segreteria — il coordinatore nell'app
// Segreteria non entra (regola del 17/09/2026). Lì ci sono «Approva» e
// «Stand-by», che passano dalla RPC s_fattura_decisione.
//
// POST { fatture: number[], rimanda?: boolean }   (JWT della segreteria)
//   → { ok, inviata, a, fatture, in_attesa, errore?, saltate }
//
// Idempotente e a prova di due chiamate insieme: prima di spedire le
// fatture si PRENOTANO (avviso_appr_dal, UPDATE condizionato che riesce
// a una sola chiamata); a invio riuscito si scrive avviso_appr_il, a
// invio fallito il motivo, e la prenotazione si libera perché si possa
// ritentare dal cruscotto. Con `rimanda` si avvisa di nuovo una fattura
// già annunciata (la segreteria lo chiede a mano dal dettaglio).
//
// Mittente: cptpd@did.formedilpadova.it (la casella che il service
// account impersona), Reply-To cpt@formedilpadova.it, destinatario
// s_config.coordinatore_email, copie s_config.avviso_approvazione_cc.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delega gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync), firma-logo.js
// è la versione che scarica il logo dal sito — come in avviso-pagamento.
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, oggettoUfficio, paginaHtml, corpoInHtml, LOGO_FIRMA_CID } from './firma.js'
// @ts-ignore modulo JS senza tipi
import { caricaLogo } from './firma-logo.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const ZONA_COORDINATORE = 'https://formedilpadovacpt.github.io/gestionale-visite/?vista=admin'
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const DA_APPROVARE = ['ricevuta', 'verificata', 'standby']
const PRENOTAZIONE_MINUTI = 10
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const dataIt = (iso?: string | null) => {
  if (!iso) return ''
  const [a, m, g] = String(iso).slice(0, 10).split('-')
  return g ? `${g}/${m}/${a}` : String(iso)
}
const euro = (n: unknown) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

type Fattura = {
  id: number; tecnico_nome: string | null; numero: string | null; stato: string
  data_fattura: string | null; data_ricevimento: string | null; importo: number | null
  incarico_mensile_id: number | null; standby_motivo: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    /* chi chiama: la segreteria (o un admin), eseguito COME l'utente.
       La chiave anon non ha un utente dietro, e l'errore vale «no». */
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUtente.auth.getUser()
    if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
    const { data: segr, error: eSegr } = await sbUtente.rpc('is_segreteria')
    if (eSegr || segr !== true) {
      return json({ error: "L'avviso al coordinatore lo fa partire la segreteria." }, 403)
    }

    const corpo = await req.json().catch(() => ({}))
    const rimanda = corpo?.rimanda === true
    const ids = [...new Set((Array.isArray(corpo?.fatture) ? corpo.fatture : [])
      .map((x: unknown) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0))].slice(0, 50)
    if (!ids.length) return json({ error: 'Nessuna fattura indicata' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    /* il destinatario prima di tutto: se il coordinatore non ha un
       indirizzo in s_config non si prenota niente e non si sporca il
       quaderno — non c'è nemmeno un tentativo da registrare */
    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['coordinatore_email', 'coordinatore_nome', 'avviso_approvazione_cc'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))
    const a = String(conf.coordinatore_email || '').trim()
    if (!MAIL_RE.test(a)) {
      return json({ error: "Manca l'indirizzo del coordinatore in s_config.coordinatore_email." }, 400)
    }
    const cc = String(conf.avviso_approvazione_cc || '').split(/[,;]\s*/)
      .map((s) => s.trim()).filter((s) => MAIL_RE.test(s) && s.toLowerCase() !== a.toLowerCase())
    const chi = String(conf.coordinatore_nome || '').trim()

    /* la prenotazione: solo fatture che aspettano davvero l'approvazione,
       mai annunciate (salvo `rimanda`), e non già prese da un'altra
       chiamata negli ultimi minuti. Lo storico Access resta fuori. */
    const scaduta = new Date(Date.now() - PRENOTAZIONE_MINUTI * 60_000).toISOString()
    let pren = sb.from('s_fatture_tecnici')
      .update({ avviso_appr_dal: new Date().toISOString() })
      .in('id', ids)
      .in('stato', DA_APPROVARE)
      .not('importato_da_access', 'is', true)
      .or(`avviso_appr_dal.is.null,avviso_appr_dal.lt.${scaduta}`)
    if (!rimanda) pren = pren.is('avviso_appr_il', null)
    const { data: prese, error: ePren } = await pren
      .select('id, tecnico_nome, numero, stato, data_fattura, data_ricevimento, importo, incarico_mensile_id, standby_motivo')
    if (ePren) throw new Error('Prenotazione non riuscita: ' + ePren.message)
    const fatture = ((prese || []) as Fattura[]).sort((x, y) => x.id - y.id)
    const saltate = ids.length - fatture.length
    if (!fatture.length) return json({ ok: true, inviata: false, fatture: [], saltate })

    const idsF = fatture.map((f) => f.id)
    const incIds = [...new Set(fatture.map((f) => f.incarico_mensile_id).filter(Boolean))] as number[]
    /* quante ne aspettano in tutto: è il numero che il coordinatore vede
       aprendo la Zona Coordinatore, e dirlo evita il viaggio a vuoto */
    const [{ data: ii }, { count: inAttesa }] = await Promise.all([
      incIds.length ? sb.from('s_incarichi_mensili').select('id, anno, mese').in('id', incIds) : Promise.resolve({ data: [] }),
      sb.from('s_fatture_tecnici').select('id', { count: 'exact', head: true })
        .in('stato', DA_APPROVARE).not('importato_da_access', 'is', true),
    ])
    const incDi = Object.fromEntries((ii || []).map((i: Record<string, number>) => [i.id, i]))

    /* prestazioni collegate e netto: lo stesso controllo che la segreteria
       ha sotto gli occhi, così il coordinatore sa che cosa sta approvando */
    const { data: pp } = await sb.from('s_prestazioni').select('fattura_id, importo').in('fattura_id', idsF)
    const prestDi: Record<number, { n: number; netto: number }> = {}
    for (const p of (pp || []) as { fattura_id: number; importo: number }[]) {
      const k = prestDi[p.fattura_id] = prestDi[p.fattura_id] || { n: 0, netto: 0 }
      k.n++; k.netto += Number(p.importo || 0)
    }

    const una = fatture.length === 1
    const righe = fatture.map((f) => {
      const inc = f.incarico_mensile_id ? incDi[f.incarico_mensile_id] as Record<string, number> | undefined : undefined
      const k = prestDi[f.id] || { n: 0, netto: 0 }
      return `- ${f.tecnico_nome || '?'}: fattura n° ${f.numero || '?'}` +
        `${f.data_fattura ? ` del ${dataIt(f.data_fattura)}` : ''}` +
        `${inc ? ` (attività di ${MESI[inc.mese - 1]} ${inc.anno})` : ''}` +
        ` — ${euro(f.importo)}` +
        `${k.n ? `, ${k.n} prestazioni collegate per ${euro(k.netto)} netti` : ', nessuna prestazione collegata'}` +
        `${f.stato === 'standby' ? `\n  (era in stand-by: ${f.standby_motivo || 'motivo non registrato'})` : ''}`
    })
    const testo = [
      chi ? `Gentile ${chi},` : 'Buongiorno,',
      '',
      una
        ? 'la segreteria ha verificato una fattura di un tecnico: aspetta la sua approvazione per andare in mandato di pagamento.'
        : `la segreteria ha verificato ${fatture.length} fatture dei tecnici: aspettano la sua approvazione per andare in mandato di pagamento.`,
      righe.join('\n'),
      '',
      'Si approva solo se tutte le attività del mese sono a posto; altrimenti stand-by con il motivo, e il mandato non parte finché non si risolve col tecnico.',
      '',
      ">>> Approva dall'app (si apre la Zona Coordinatore del gestionale visite):",
      ZONA_COORDINATORE,
      '',
      Number(inAttesa || 0) > fatture.length
        ? `In tutto, nella Zona Coordinatore ci sono ${inAttesa} fatture in attesa.`
        : '',
      '',
      'Cordiali saluti.',
    ].filter((r, i, arr) => !(r === '' && arr[i - 1] === '')).join('\n')

    const oggetto = oggettoUfficio(una
      ? `Fattura da approvare n° ${fatture[0].numero || '?'} - ${fatture[0].tecnico_nome || ''}${chi ? ` - alla c.a. ${chi}` : ''}`
      : `${fatture.length} fatture dei tecnici da approvare${chi ? ` - alla c.a. ${chi}` : ''}`)

    const logo = await caricaLogo()
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    try {
      /* corpoInHtml trasforma la riga «>>> …» nel pulsante arancione
         (21/09/2026); se il logo non è arrivato, la firma esce senza
         immagine invece che con un riquadro vuoto */
      let html = paginaHtml(corpoInHtml(testo))
      if (!logo.ok) {
        html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
      }
      const mime = componiEml({
        from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
        to: a, cc, oggetto, corpo: testo, html, unsent: false,
      })
      const token = await getToken(sa, SCOPE_GMAIL)
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: toB64Url(mime) }),
      })
      const out = await res.json()
      if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
      await sb.from('s_fatture_tecnici').update({
        avviso_appr_il: new Date().toISOString(), avviso_appr_a: [a, ...cc].join(', '),
        avviso_appr_esito: logo.ok ? 'inviato' : `inviato (senza logo: ${logo.motivo})`, avviso_appr_dal: null,
      }).in('id', idsF)
      return json({ ok: true, inviata: true, a, cc, fatture: idsF, in_attesa: inAttesa || 0, saltate })
    } catch (e) {
      const msg = (e as Error).message
      await sb.from('s_fatture_tecnici').update({
        avviso_appr_dal: null, avviso_appr_esito: `non inviato: ${msg}`.slice(0, 500),
      }).in('id', idsF)
      return json({ ok: false, inviata: false, fatture: idsF, saltate, errore: msg })
    }
  } catch (e) {
    console.error('avviso-approvazione:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
