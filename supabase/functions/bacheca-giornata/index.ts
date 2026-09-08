// Supabase Edge Function – bacheca-giornata
// «Posta e agenda» nel cruscotto della segreteria (08/09/2026, chiesto dall'utente).
//
// Ogni mattina (cron pg_cron, lunedì-giovedì alle 8) legge con il service
// account dell'ente — delega domain-wide, scope gmail.readonly aggiunto dallo
// stesso utente l'08/09 e calendar.readonly del 07/09 — le caselle e i
// calendari elencati in s_config, e scrive due tabelle che il cruscotto mostra:
//   s_bacheca_mail    → le mail arrivate nelle ultime N ore, con un PUNTEGGIO di
//                       importanza calcolato da regole leggibili (mittenti noti,
//                       parole nell'oggetto, allegati, non letta). Solo intestazioni
//                       e l'anteprima che Gmail stesso mostra in elenco: MAI il corpo.
//   s_bacheca_eventi  → gli eventi dei prossimi 7 giorni.
// Nessun input della richiesta viene onorato tranne ?dryRun=1: caselle,
// calendari e regole stanno in s_config, così la funzione può girare dal cron
// con la sola chiave anon senza che nessuno possa farle leggere altro.
// La funzione LEGGE e SEGNALA: non risponde, non archivia, non sposta niente.
// Chi decide resta la persona, e la mail si apre in Gmail dal collegamento.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE } from '../_shared/google.ts'

const SCOPE_GMAIL_RO = 'https://www.googleapis.com/auth/gmail.readonly'
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 2), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Regole = {
  soglia: number
  mittenti: { match: string; peso: number; etichetta?: string }[]
  parole: { match: string; peso: number }[]
  ignora: string[]
  peso_allegato: number
  peso_non_letta: number
  peso_tecnico: number
}
const REGOLE_DEFAULT: Regole = {
  soglia: 3,
  mittenti: [
    { match: 'formedil.it', peso: 3, etichetta: 'FORMEDIL' }, { match: 'ceiv.it', peso: 3, etichetta: 'CEIV' },
    { match: 'aulss6', peso: 3, etichetta: 'SPISAL/AULSS6' }, { match: 'inail.it', peso: 3, etichetta: 'INAIL' },
    { match: 'ancepadova', peso: 2, etichetta: 'ANCE' }, { match: 'regione.veneto', peso: 2, etichetta: 'Regione' },
    { match: 'direzione@formedilpadova.it', peso: 3, etichetta: 'Direzione' }, { match: 'amministrazione@formedilpadova.it', peso: 2, etichetta: 'Amministrazione' },
    { match: 'pec.', peso: 2, etichetta: 'PEC' },
  ],
  parole: [
    { match: 'scadenz', peso: 2 }, { match: 'urgent', peso: 2 }, { match: 'sollecit', peso: 2 }, { match: 'convocaz', peso: 2 },
    { match: 'entro il', peso: 2 }, { match: 'termine', peso: 1 }, { match: 'fattur', peso: 1 }, { match: 'protocol', peso: 1 },
    { match: 'asseveraz', peso: 2 }, { match: 'verbale', peso: 1 }, { match: 'cantiere', peso: 1 }, { match: 'circolare', peso: 1 },
    { match: 'infortun', peso: 3 }, { match: 'ispezion', peso: 2 }, { match: 'richiesta', peso: 1 },
  ],
  ignora: ['noreply', 'no-reply', 'newsletter', 'notifications@', 'mailer-daemon', 'unsubscribe', 'linkedin.com', 'facebook', 'googlealerts'],
  peso_allegato: 1, peso_non_letta: 1, peso_tecnico: 3,
}

function leggiHeader(h: { name: string; value: string }[] | undefined, nome: string): string {
  return (h || []).find((x) => x.name.toLowerCase() === nome.toLowerCase())?.value || ''
}
function scomponiMittente(from: string): { nome: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { nome: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() }
  return { nome: from.trim(), email: from.trim().toLowerCase() }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
    const saRaw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!saRaw) return json({ error: 'secret GOOGLE_SERVICE_ACCOUNT_JSON assente' }, 500)
    const sa = JSON.parse(saRaw)

    /* ── configurazione: tutto da s_config, niente dalla richiesta ── */
    const { data: cfgRows } = await admin.from('s_config').select('chiave, valore')
      .in('chiave', ['bacheca_caselle', 'bacheca_calendari', 'bacheca_regole', 'bacheca_ore_mail', 'bacheca_giorni_eventi'])
    const cfg: Record<string, string> = {}
    for (const r of cfgRows || []) cfg[r.chiave] = r.valore || ''
    const caselle = (cfg.bacheca_caselle || SOGGETTO_ENTE).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const calendari = (cfg.bacheca_calendari || 'primary').split(',').map((s) => s.trim()).filter(Boolean)
    let regole: Regole = REGOLE_DEFAULT
    try { if (cfg.bacheca_regole) regole = { ...REGOLE_DEFAULT, ...JSON.parse(cfg.bacheca_regole) } } catch { /* regole malformate: valgono le predefinite */ }
    // il lunedì si guarda anche il fine settimana
    const giornoSett = new Date().getDay()
    const oreMail = Number(cfg.bacheca_ore_mail) || (giornoSett === 1 ? 80 : 30)
    const giorniEventi = Number(cfg.bacheca_giorni_eventi) || 7
    // i tecnici sono mittenti da guardare; le caselle dell'ufficio stesse no (stanno in tecnici per l'app visite)
    const { data: tec } = await admin.from('tecnici').select('email').eq('attivo', true)
    const emailTecnici = new Set((tec || []).map((t) => String(t.email || '').toLowerCase()).filter((e) => e && !caselle.includes(e)))

    const esito: Record<string, unknown> = { dryRun, caselle, calendari, oreMail, giorniEventi, mail: {}, eventi: {}, errori: [] as string[] }
    const righeMail: Record<string, unknown>[] = []
    const righeEventi: Record<string, unknown>[] = []
    const adesso = new Date().toISOString()

    /* ── posta ─────────────────────────────────────────────────── */
    for (const casella of caselle) {
      try {
        const token = await getToken(sa, SCOPE_GMAIL_RO, casella)
        const dopo = Math.floor((Date.now() - oreMail * 3600e3) / 1000)
        // -in:sent: le mail che l'ufficio manda (anche quelle che l'app fa partire da questa casella,
        // come i link di accesso) non sono posta da guardare — prima prova a vuoto: erano le sole 4 righe
        const base = `after:${dopo} -in:sent -in:spam -in:trash -category:promotions -category:social -category:forums`
        const lista = async (q: string) => {
          const ids: string[] = []
          let pageToken = ''
          for (let i = 0; i < 3; i++) {
            const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? '&pageToken=' + pageToken : ''}`
            const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
            const d = await r.json().catch(() => ({}))
            if (!r.ok || d.error) throw new Error(d.error?.message || `HTTP ${r.status}`)
            for (const m of d.messages || []) ids.push(m.id)
            pageToken = d.nextPageToken || ''
            if (!pageToken) break
          }
          return ids
        }
        const ids = await lista(base)
        const conAllegati = new Set(await lista(base + ' has:attachment'))
        let importanti = 0
        for (const id of ids) {
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${token}` } })
          const m = await r.json().catch(() => ({}))
          if (!r.ok || m.error) { (esito.errori as string[]).push(`${casella} ${id}: ${m.error?.message || r.status}`); continue }
          const headers = m.payload?.headers
          const mitt = scomponiMittente(leggiHeader(headers, 'From'))
          if (caselle.includes(mitt.email)) continue // scritta da una casella dell'ufficio: non è posta in arrivo
          const oggetto = leggiHeader(headers, 'Subject') || '(senza oggetto)'
          const labels: string[] = m.labelIds || []
          const nonLetta = labels.includes('UNREAD')
          const allegati = conAllegati.has(id)
          const testo = (mitt.email + ' ' + mitt.nome).toLowerCase()
          const ogg = oggetto.toLowerCase()
          let punteggio = 0
          const motivi: string[] = []
          if (regole.ignora.some((x) => testo.includes(x.toLowerCase()))) { punteggio -= 3; motivi.push('mittente automatico') }
          if (emailTecnici.has(mitt.email)) { punteggio += regole.peso_tecnico; motivi.push('tecnico') }
          for (const mr of regole.mittenti) if (testo.includes(mr.match.toLowerCase())) { punteggio += mr.peso; motivi.push(mr.etichetta || mr.match) }
          let paroleTot = 0
          for (const pr of regole.parole) if (ogg.includes(pr.match.toLowerCase())) { paroleTot += pr.peso; motivi.push('«' + pr.match + '»') }
          punteggio += Math.min(4, paroleTot)
          if (allegati) { punteggio += regole.peso_allegato; motivi.push('allegati') }
          if (nonLetta) { punteggio += regole.peso_non_letta; motivi.push('non letta') }
          const importante = punteggio >= regole.soglia
          if (importante) importanti++
          righeMail.push({
            casella, gmail_id: id, thread_id: m.threadId || null,
            mittente: mitt.nome.slice(0, 200), mittente_email: mitt.email.slice(0, 200), oggetto: oggetto.slice(0, 300),
            data: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : adesso,
            letta: !nonLetta, ha_allegati: allegati, anteprima: String(m.snippet || '').slice(0, 160),
            punteggio, motivi, importante, visto_il: adesso,
          })
        }
        ;(esito.mail as Record<string, unknown>)[casella] = { lette: ids.length, importanti }
      } catch (e) {
        (esito.errori as string[]).push(`posta ${casella}: ${String((e as Error)?.message || e)}`)
      }
    }

    /* ── agenda ────────────────────────────────────────────────── */
    const tMin = new Date(); tMin.setHours(0, 0, 0, 0)
    const tMax = new Date(tMin.getTime() + giorniEventi * 864e5)
    const leggiCalendario = async (token: string, calId: string, casella: string | null) => {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime&timeMin=${tMin.toISOString()}&timeMax=${tMax.toISOString()}&maxResults=60`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error?.message || `HTTP ${r.status}`)
      let n = 0
      for (const e of d.items || []) {
        if (e.status === 'cancelled') continue
        n++
        righeEventi.push({
          calendario_id: calId === 'primary' ? `primary:${casella}` : calId, calendario: d.summary || calId, casella,
          evento_id: e.id, titolo: e.summary || '(senza titolo)',
          inizio: e.start?.dateTime || e.start?.date || null, fine: e.end?.dateTime || e.end?.date || null,
          tutto_il_giorno: !!e.start?.date, luogo: e.location || null,
          link: e.htmlLink || null, visto_il: adesso,
        })
      }
      return { calendario: d.summary || calId, eventi: n }
    }
    for (const calId of calendari) {
      if (calId === 'primary') {
        for (const casella of caselle) {
          try { const token = await getToken(sa, SCOPE_CALENDAR, casella); (esito.eventi as Record<string, unknown>)[`primary:${casella}`] = await leggiCalendario(token, 'primary', casella) }
          catch (e) { (esito.errori as string[]).push(`agenda ${casella}: ${String((e as Error)?.message || e)}`) }
        }
      } else {
        try { const token = await getToken(sa, SCOPE_CALENDAR); (esito.eventi as Record<string, unknown>)[calId] = await leggiCalendario(token, calId, null) }
        catch (e) { (esito.errori as string[]).push(`calendario ${calId}: ${String((e as Error)?.message || e)}`) }
      }
    }

    if (dryRun) {
      esito.esempio_mail = righeMail.filter((r) => r.importante).slice(0, 8).map((r) => ({ casella: r.casella, da: r.mittente, oggetto: r.oggetto, punteggio: r.punteggio, motivi: r.motivi }))
      esito.esempio_eventi = righeEventi.slice(0, 8).map((r) => ({ calendario: r.calendario, titolo: r.titolo, inizio: r.inizio }))
      return json({ ok: true, ...esito })
    }

    /* ── scrittura: upsert, poi pulizia di ciò che è vecchio ──── */
    if (righeMail.length) {
      for (let i = 0; i < righeMail.length; i += 200) {
        const { error } = await admin.from('s_bacheca_mail').upsert(righeMail.slice(i, i + 200), { onConflict: 'casella,gmail_id' })
        if (error) (esito.errori as string[]).push('scrittura mail: ' + error.message)
      }
    }
    if (righeEventi.length) {
      const { error } = await admin.from('s_bacheca_eventi').upsert(righeEventi, { onConflict: 'calendario_id,evento_id' })
      if (error) (esito.errori as string[]).push('scrittura eventi: ' + error.message)
    }
    await admin.from('s_bacheca_mail').delete().lt('data', new Date(Date.now() - 10 * 864e5).toISOString())
    await admin.from('s_bacheca_eventi').delete().lt('fine', new Date(Date.now() - 2 * 864e5).toISOString())
    await admin.from('s_config').upsert([
      { chiave: 'bacheca_al', valore: adesso, descrizione: 'Ultimo giro di bacheca-giornata (posta e agenda nel cruscotto)' },
      { chiave: 'bacheca_esito', valore: JSON.stringify({ mail: esito.mail, eventi: esito.eventi, errori: esito.errori }).slice(0, 4000), descrizione: 'Esito dell\'ultimo giro di bacheca-giornata' },
    ], { onConflict: 'chiave' })
    return json({ ok: true, ...esito, scritte_mail: righeMail.length, scritti_eventi: righeEventi.length })
  } catch (e) {
    console.error('bacheca-giornata:', e)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
