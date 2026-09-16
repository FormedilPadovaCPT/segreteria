// Supabase Edge Function – avviso-pagamento
// L'avviso di AVVENUTO PAGAMENTO al tecnico (16/09/2026, chiesto dall'utente).
//
// ⚠️ QUESTA MAIL PARTE DA SOLA, ed è un'eccezione dichiarata alla regola
// «le mail dell'ufficio le manda una persona». L'ha decisa l'utente: quando
// l'Amministrazione segna nell'app che una fattura è pagata, il tecnico lo
// deve sapere senza che qualcuno se ne ricordi. Per questo la mail non
// porta NIENTE scritto da chi la fa partire: numero, data e importo della
// fattura, mese di riferimento, data del pagamento e indirizzo del tecnico
// si leggono dal database. Chi chiama passa solo gli id delle fatture.
//
// POST { fatture: number[] }  (JWT dell'utente: Amministrazione o segreteria)
//   → { ok, inviati: [{ tecnico, a, fatture }], errori: [...], saltate }
//
// Idempotente, e regge due chiamate insieme: prima di spedire ogni fattura
// si PRENOTA (avviso_pagamento_dal, UPDATE condizionato che riesce a uno
// solo); a invio riuscito si scrive avviso_pagamento_il, a invio fallito si
// scrive il motivo e si libera la prenotazione, così si può ritentare dal
// cruscotto. Una fattura già avvisata non riceve un secondo avviso.
//
// Mittente: cptpd@did.formedilpadova.it (la casella che il service account
// impersona), Reply-To cpt@formedilpadova.it, cc s_config.avviso_pagamento_cc.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delega gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync), firma-logo.js
// è la versione che scarica il logo dal sito — come in send-protocollo.
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, oggettoUfficio, paginaHtml, testoInHtml, LOGO_FIRMA_CID } from './firma.js'
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
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const PRENOTAZIONE_MINUTI = 10

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
  id: number; tecnico_id: string; tecnico_nome: string | null; numero: string | null
  data_fattura: string | null; importo: number | null; pagata_il: string | null
  incarico_mensile_id: number | null; mandato_id: number | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    /* chi chiama: Amministrazione o segreteria, eseguito COME l'utente.
       La chiave anon non ha un utente dietro, e l'errore vale «no». */
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUtente.auth.getUser()
    if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
    const [amm, segr] = await Promise.all(['is_amministrazione', 'is_segreteria'].map(async (f) => {
      const { data, error } = await sbUtente.rpc(f)
      return !error && data === true
    }))
    if (!amm && !segr) return json({ error: "L'avviso di pagamento lo fanno partire l'Amministrazione o la segreteria." }, 403)

    const corpo = await req.json().catch(() => ({}))
    const ids = [...new Set((Array.isArray(corpo?.fatture) ? corpo.fatture : [])
      .map((x: unknown) => Number(x)).filter((x: number) => Number.isInteger(x) && x > 0))].slice(0, 200)
    if (!ids.length) return json({ error: 'Nessuna fattura indicata' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    /* la prenotazione: solo fatture pagate, mai avvisate, e non già prese
       da un'altra chiamata negli ultimi minuti. Lo storico (609 fatture
       chiuse dall'import Access) resta fuori da sé: non ha pagata_il, che
       scrive soltanto s_fatture_segna_pagate. */
    const scaduta = new Date(Date.now() - PRENOTAZIONE_MINUTI * 60_000).toISOString()
    const { data: prese, error: ePren } = await sb.from('s_fatture_tecnici')
      .update({ avviso_pagamento_dal: new Date().toISOString() })
      .in('id', ids)
      .eq('stato', 'pagata')
      .not('pagata_il', 'is', null)
      .is('avviso_pagamento_il', null)
      .or(`avviso_pagamento_dal.is.null,avviso_pagamento_dal.lt.${scaduta}`)
      .select('id, tecnico_id, tecnico_nome, numero, data_fattura, importo, pagata_il, incarico_mensile_id, mandato_id')
    if (ePren) throw new Error('Prenotazione non riuscita: ' + ePren.message)
    const fatture = (prese || []) as Fattura[]
    const saltate = ids.length - fatture.length
    if (!fatture.length) return json({ ok: true, inviati: [], errori: [], saltate })

    const tecIds = [...new Set(fatture.map((f) => f.tecnico_id))]
    const incIds = [...new Set(fatture.map((f) => f.incarico_mensile_id).filter(Boolean))] as number[]
    const manIds = [...new Set(fatture.map((f) => f.mandato_id).filter(Boolean))] as number[]
    const [{ data: tt }, { data: ii }, { data: mm }, { data: cfg }] = await Promise.all([
      sb.from('tecnici').select('tecnico_id, tecnico_nome, tecnico_cognome, titolo, email').in('tecnico_id', tecIds),
      incIds.length ? sb.from('s_incarichi_mensili').select('id, anno, mese').in('id', incIds) : Promise.resolve({ data: [] }),
      manIds.length ? sb.from('s_mandati_pagamento').select('id, data').in('id', manIds) : Promise.resolve({ data: [] }),
      sb.from('s_config').select('chiave, valore').eq('chiave', 'avviso_pagamento_cc'),
    ])
    const tecDi = Object.fromEntries((tt || []).map((t: Record<string, string>) => [t.tecnico_id, t]))
    const incDi = Object.fromEntries((ii || []).map((i: Record<string, number>) => [i.id, i]))
    const manDi = Object.fromEntries((mm || []).map((m: Record<string, string>) => [m.id, m]))
    const cc = String((cfg || [])[0]?.valore || '').split(/[,;]\s*/).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))

    const logo = await caricaLogo()
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    let token = ''

    const inviati: unknown[] = []
    const errori: unknown[] = []
    const perTecnico: Record<string, Fattura[]> = {}
    for (const f of fatture) (perTecnico[f.tecnico_id] = perTecnico[f.tecnico_id] || []).push(f)

    for (const [tecId, ff] of Object.entries(perTecnico)) {
      const t = tecDi[tecId] as Record<string, string> | undefined
      const idsT = ff.map((f) => f.id)
      const email = String(t?.email || '').trim()
      const chi = t ? [t.titolo, t.tecnico_nome, t.tecnico_cognome].filter(Boolean).join(' ') : (ff[0].tecnico_nome || '')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        await sb.from('s_fatture_tecnici').update({ avviso_pagamento_dal: null, avviso_pagamento_esito: 'non inviato: il tecnico non ha un indirizzo e-mail in anagrafica' }).in('id', idsT)
        errori.push({ tecnico: chi, fatture: idsT, errore: 'tecnico senza indirizzo e-mail' })
        continue
      }
      const una = ff.length === 1
      const righe = ff.map((f) => {
        const inc = f.incarico_mensile_id ? incDi[f.incarico_mensile_id] as Record<string, number> | undefined : undefined
        return `- fattura n° ${f.numero || '?'}${f.data_fattura ? ` del ${dataIt(f.data_fattura)}` : ''}` +
          `${inc ? ` (attività di ${MESI[inc.mese - 1]} ${inc.anno})` : ''}: ${euro(f.importo)}, pagata il ${dataIt(f.pagata_il)}`
      })
      const mandati = [...new Set(ff.map((f) => f.mandato_id).filter(Boolean))]
        .map((m) => `n° ${m}${manDi[m as number] ? ` del ${dataIt((manDi[m as number] as Record<string, string>).data)}` : ''}`)
      const testo = [
        `Gentile ${chi},`,
        '',
        `le comunichiamo che l'Amministrazione di Formedil Padova ha effettuato il pagamento ${una ? 'della fattura' : 'delle fatture'}:`,
        righe.join('\n'),
        '',
        mandati.length ? `Il pagamento è riferito al mandato ${mandati.join(', ')}.` : '',
        '',
        'Per qualsiasi chiarimento può rispondere a questa mail.',
        '',
        'Cordiali saluti.',
      ].filter((r, i, a) => !(r === '' && a[i - 1] === '')).join('\n')
      const oggetto = oggettoUfficio(una
        ? `Avvenuto pagamento fattura n° ${ff[0].numero || '?'} - alla c.a. ${chi}`
        : `Avvenuto pagamento fatture n° ${ff.map((f) => f.numero || '?').join(', ')} - alla c.a. ${chi}`)

      try {
        /* se il logo non è arrivato, la firma esce senza immagine: meglio
           che un'immagine vuota (stessa scelta di send-protocollo) */
        const html = logo.ok ? '' : paginaHtml(testoInHtml(testo))
          .replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.@]/g, '\\$&')}[^>]*>`), '')
        const mime = componiEml({
          from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
          to: email, cc, oggetto, corpo: testo, html, unsent: false,
        })
        if (!token) token = await getToken(sa, SCOPE_GMAIL)
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: toB64Url(mime) }),
        })
        const out = await res.json()
        if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
        await sb.from('s_fatture_tecnici').update({
          avviso_pagamento_il: new Date().toISOString(), avviso_pagamento_a: [email, ...cc].join(', '),
          avviso_pagamento_esito: logo.ok ? 'inviato' : `inviato (senza logo: ${logo.motivo})`, avviso_pagamento_dal: null,
        }).in('id', idsT)
        inviati.push({ tecnico: chi, a: email, fatture: idsT })
      } catch (e) {
        const msg = (e as Error).message
        await sb.from('s_fatture_tecnici').update({
          avviso_pagamento_dal: null, avviso_pagamento_esito: `non inviato: ${msg}`.slice(0, 500),
        }).in('id', idsT)
        errori.push({ tecnico: chi, fatture: idsT, errore: msg })
      }
    }
    return json({ ok: !errori.length, inviati, errori, saltate })
  } catch (e) {
    console.error('avviso-pagamento:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
