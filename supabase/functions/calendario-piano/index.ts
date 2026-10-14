// Supabase Edge Function – calendario-piano
// LE DATE DEL PIANO DI VERIFICA 5.D.4 NEL CALENDARIO «DIREZIONE» (14/10/2026)
//
// Chiesto dall'utente: protocollato e inviato il piano, l'RGV ne compila il
// dettaglio nell'app asseverazione (data, sito, dalle, alle, componenti del
// GdV, funzioni dell'impresa, attività), salva, lo stampa e lo fa firmare
// all'impresa in sede. La segreteria deve vederlo aggiornato e avere le
// date in calendario, con un avviso.
//
//   allinea  (segreteria/coordinatore o tecnico della pratica) { pratica_id }
//            legge il dettaglio del piano e porta il calendario a combaciare:
//            UN EVENTO PER GIORNATA (dalle più presto – alle più tardi, le
//            righe nella descrizione), nel calendario `s_config.piano_calendario_id`
//            (il «Direzione» di cptpd@did), con promemoria il giorno prima e
//            un'ora prima. L'RGV è INVITATO: Google gli manda l'invito, e il
//            ritiro se la giornata sparisce. ⚠️ È la UNDICESIMA eccezione alla
//            regola «l'app prepara, la persona manda», decisa dall'utente il
//            14/10/2026: regge come le altre, il testo si legge tutto dal
//            database.
//
// Gli eventi si ritrovano dalla proprietà privata `pratica_piano` = id della
// pratica e `giorno` = data: le righe del piano si riscrivono a ogni
// salvataggio, un id sulla riga si perderebbe. Un evento uguale a quello che
// dovrebbe essere non si tocca (nessun invito ripetuto).
//
// Serve la delega domain-wide della service account con lo scope
// `calendar.events` (console di Google Workspace). Senza, Google risponde
// «unauthorized_client»: l'esito lo dice e le date restano salvate.
// L'esito va in a_piano_verifica.calendario_il / calendario_esito.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE } from '../_shared/google.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const SCOPE_CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3'
const FUSO = 'Europe/Rome'
const UUID_RE = /^[0-9a-f-]{36}$/i

type Riga = Record<string, any>

const hhmm = (t: unknown) => (t ? String(t).slice(0, 5) : '')
const dIt = (d: string) => d.split('-').reverse().join('/')
const giornoDopo = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let sb: any = null
  let praticaId = ''
  const scriviEsito = async (esito: string) => {
    if (!sb || !praticaId) return
    await sb.from('a_piano_verifica').update({ calendario_il: new Date().toISOString(), calendario_esito: esito.slice(0, 500) })
      .eq('pratica_id', praticaId)
  }
  try {
    /* ── PROVA del permesso, senza toccare il calendario (14/10/2026) ──
       Con l'intestazione X-Calendario-Prova = s_config.calendario_prova_token
       (la chiamata dal database, come i giri automatici): si chiede a Google
       il token con lo scope calendar.events e si legge che diritti ha
       cptpd@did sul calendario del piano. Nessun evento creato. */
    const gettoneProva = req.headers.get('X-Calendario-Prova') || ''
    if (gettoneProva) {
      const sbS = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: cfgP } = await sbS.from('s_config').select('chiave, valore').in('chiave', ['calendario_prova_token', 'piano_calendario_id'])
      const c = Object.fromEntries(((cfgP || []) as Riga[]).map((r) => [r.chiave, r.valore]))
      if (!c.calendario_prova_token || gettoneProva !== c.calendario_prova_token) return json({ error: 'accesso non autorizzato' }, 401)
      const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
      let tok: string
      try { tok = await getToken(sa, SCOPE_CALENDAR_EVENTS, SOGGETTO_ENTE) }
      catch (e) { return json({ ok: false, scope: 'NON concesso', dettaglio: (e as Error).message }) }
      const r = await fetch(`${API}/calendars/${encodeURIComponent(String(c.piano_calendario_id || ''))}/events?maxResults=1`, { headers: { Authorization: `Bearer ${tok}` } })
      const j = await r.json().catch(() => ({}))
      /* i diritti sul calendario si leggono con lo scope di lettura (già concesso per la bacheca) */
      let tokL = ''
      try { tokL = await getToken(sa, `${SCOPE_CALENDAR_EVENTS} https://www.googleapis.com/auth/calendar.readonly`, SOGGETTO_ENTE) } catch { /* resta vuoto */ }
      const rl = tokL ? await fetch(`${API}/users/me/calendarList/${encodeURIComponent(String(c.piano_calendario_id || ''))}`, { headers: { Authorization: `Bearer ${tokL}` } }) : null
      const jl = rl ? await rl.json().catch(() => ({})) : {}
      return json({ ok: r.ok, scope: 'concesso', eventi_leggibili: r.ok, calendario: jl?.summary ?? null, diritti: jl?.accessRole ?? null, errore: r.ok ? null : (j?.error?.message ?? r.status) })
    }

    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUtente.auth.getUser()
    if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)

    const corpo = await req.json().catch(() => ({}))
    praticaId = String(corpo?.pratica_id || '')
    if (!UUID_RE.test(praticaId)) return json({ error: 'Manca la pratica.' }, 400)

    /* chi può: ufficio e coordinatore, o un tecnico della pratica. L'errore di lettura vale «no» */
    const prova = async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await sbUtente.rpc(fn, args)
      return !error && data === true
    }
    if (!(await prova('a_is_office_or_coordinator')) && !(await prova('a_is_tecnico_pratica', { p_pratica_id: praticaId }))) {
      return json({ error: 'Il calendario del piano lo aggiornano la segreteria, il coordinatore o i tecnici della pratica.' }, 403)
    }
    sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    /* ── i dati: pratica, impresa, protocollo del piano, RGV, righe ── */
    const { data: pr, error: eP } = await sb.from('a_pratica')
      .select('numero_protocollo, tipo, impresa:impresa_id(impresa_nome)').eq('id', praticaId).maybeSingle()
    if (eP || !pr) throw new Error('Non trovo la pratica: ' + (eP?.message || praticaId))
    const impresa = String(pr.impresa?.impresa_nome || '').trim()
    const { data: prot } = await sb.from('a_pratica_protocollo').select('codice, numero')
      .eq('pratica_id', praticaId).eq('documento', 'piano').maybeSingle()
    const { data: gdv, error: eG } = await sb.from('a_pratica_gdv')
      .select('rgv, ruolo, ordine, tecnico:tecnico_id(titolo, tecnico_nome, tecnico_cognome, email)').eq('pratica_id', praticaId)
    if (eG) throw new Error('Non riesco a leggere il gruppo di verifica: ' + eG.message)
    const rgvRiga = ((gdv || []) as Riga[]).find((g) => g.rgv)
    const rgvEmail = String(rgvRiga?.tecnico?.email || '').trim().toLowerCase()
    const rgvNome = [rgvRiga?.tecnico?.titolo, rgvRiga?.tecnico?.tecnico_nome, rgvRiga?.tecnico?.tecnico_cognome].filter(Boolean).join(' ')
    const { data: righe, error: eR } = await sb.from('a_piano_riga')
      .select('data_verifica, sito, ora_dalle, ora_alle, componenti, funzioni_impresa, attivita, ordine')
      .eq('pratica_id', praticaId).order('ordine')
    if (eR) throw new Error('Non riesco a leggere il dettaglio del piano: ' + eR.message)
    const { data: cfg } = await sb.from('s_config').select('valore').eq('chiave', 'piano_calendario_id').maybeSingle()
    const calId = String(cfg?.valore || '').trim()
    if (!calId) throw new Error('Manca il calendario: s_config.piano_calendario_id.')

    /* ── le giornate che dovrebbero esserci ── */
    const perGiorno = new Map<string, Riga[]>()
    for (const r of (righe || []) as Riga[]) {
      const d = String(r.data_verifica || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
      if (!perGiorno.has(d)) perGiorno.set(d, [])
      perGiorno.get(d)!.push(r)
    }
    const titolo = `Verifica asseverazione — ${impresa}${pr.numero_protocollo ? ` (${pr.numero_protocollo})` : ''}`
    const attese = new Map<string, Riga>()
    for (const [d, rr] of perGiorno) {
      const dalle = rr.map((r) => hhmm(r.ora_dalle)).filter(Boolean).sort()[0] || ''
      const alle = rr.map((r) => hhmm(r.ora_alle)).filter(Boolean).sort().reverse()[0] || ''
      const siti = [...new Set(rr.map((r) => String(r.sito || '').trim()).filter(Boolean))]
      const descrizione = [
        `Piano di verifica 5.D.4${prot?.codice ? ` ${prot.codice}` : ''} — ${impresa}${pr.numero_protocollo ? `, pratica ${pr.numero_protocollo}` : ''}.`,
        rgvNome ? `RGV: ${rgvNome}.` : '',
        '',
        ...rr.map((r) => [
          `• ${[hhmm(r.ora_dalle), hhmm(r.ora_alle)].filter(Boolean).join('–') || 'orario da definire'}${r.sito ? ` · ${String(r.sito).trim()}` : ''}`,
          r.attivita ? `  Attività: ${String(r.attivita).trim()}` : '',
          r.componenti ? `  GdV: ${String(r.componenti).trim()}` : '',
          r.funzioni_impresa ? `  Impresa: ${String(r.funzioni_impresa).trim()}` : '',
        ].filter(Boolean).join('\n')),
        '',
        'Scritto dall\'app asseverazione dal dettaglio del piano: si corregge lì, non qui.',
      ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n')
      const tempi = dalle && alle && alle > dalle
        ? { start: { dateTime: `${d}T${dalle}:00`, timeZone: FUSO }, end: { dateTime: `${d}T${alle}:00`, timeZone: FUSO } }
        : { start: { date: d }, end: { date: giornoDopo(d) } }
      attese.set(d, {
        summary: titolo,
        location: siti.join(' · ') || undefined,
        description: descrizione,
        ...tempi,
        attendees: rgvEmail ? [{ email: rgvEmail }] : [],
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 60 }] },
        extendedProperties: { private: { pratica_piano: praticaId, giorno: d } },
      })
    }

    /* ── il calendario ── */
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    let token: string
    try {
      token = await getToken(sa, SCOPE_CALENDAR_EVENTS, SOGGETTO_ENTE)
    } catch (e) {
      const msg = `calendario non aggiornato: Google non concede ancora il permesso calendar.events alla service account (${(e as Error).message})`
      await scriviEsito(msg)
      return json({ ok: false, esito: msg, permesso_mancante: true })
    }
    const G = async (metodo: string, path: string, corpoG?: unknown) => {
      const r = await fetch(`${API}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpoG ? JSON.stringify(corpoG) : undefined,
      })
      if (metodo === 'DELETE' && (r.status === 204 || r.status === 410)) return null
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error?.message || `Google Calendar ha risposto ${r.status}`)
      return j
    }
    const cal = encodeURIComponent(calId)
    const esistenti = await G('GET', `/calendars/${cal}/events?privateExtendedProperty=${encodeURIComponent(`pratica_piano=${praticaId}`)}&showDeleted=false&maxResults=250&singleEvents=true`)
    const giaPerGiorno = new Map<string, Riga>()
    const doppioni: Riga[] = []
    for (const ev of (esistenti?.items || []) as Riga[]) {
      const g = String(ev.extendedProperties?.private?.giorno || '')
      if (giaPerGiorno.has(g)) doppioni.push(ev); else giaPerGiorno.set(g, ev)
    }

    const uguale = (ev: Riga, a: Riga) =>
      ev.summary === a.summary && (ev.location || undefined) === a.location && (ev.description || '') === a.description
      && (ev.start?.dateTime ? String(ev.start.dateTime).slice(0, 16) : ev.start?.date) === (a.start.dateTime ? a.start.dateTime.slice(0, 16) : a.start.date)
      && (ev.end?.dateTime ? String(ev.end.dateTime).slice(0, 16) : ev.end?.date) === (a.end.dateTime ? a.end.dateTime.slice(0, 16) : a.end.date)
      && JSON.stringify(((ev.attendees || []) as Riga[]).map((x) => String(x.email).toLowerCase()).sort())
        === JSON.stringify(((a.attendees || []) as Riga[]).map((x) => x.email).sort())

    let creati = 0, aggiornati = 0, tolti = 0, uguali = 0
    for (const [d, a] of attese) {
      const ev = giaPerGiorno.get(d)
      if (!ev) { await G('POST', `/calendars/${cal}/events?sendUpdates=all`, a); creati++ }
      else if (uguale(ev, a)) uguali++
      else { await G('PATCH', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=all`, a); aggiornati++ }
    }
    for (const [g, ev] of giaPerGiorno) {
      if (!attese.has(g)) { await G('DELETE', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=all`); tolti++ }
    }
    for (const ev of doppioni) { await G('DELETE', `/calendars/${cal}/events/${encodeURIComponent(ev.id)}?sendUpdates=all`); tolti++ }

    const giornate = [...attese.keys()].sort().map(dIt)
    const esito = giornate.length
      ? `${giornate.length === 1 ? '1 giornata' : `${giornate.length} giornate`} in calendario (${giornate.join(', ')})`
        + (rgvEmail ? `, invitato ${rgvNome || rgvEmail}` : ', nessun RGV con e-mail da invitare')
        + ` — nuove ${creati}, aggiornate ${aggiornati}, tolte ${tolti}`
      : (tolti ? `nessuna data nel piano: tolte ${tolti} giornate dal calendario` : 'nessuna data nel piano: niente in calendario')
    await scriviEsito(esito)
    return json({ ok: true, esito, creati, aggiornati, tolti, uguali, invitato: rgvEmail || null })
  } catch (e) {
    const msg = (e as Error).message
    console.error('calendario-piano:', e)
    await scriviEsito(`calendario non aggiornato: ${msg}`).catch(() => {})
    return json({ error: msg }, 400)
  }
})
