// Supabase Edge Function – promemoria-corsi
// Il promemoria della lezione agli iscritti (28/09/2026, chiesto dall'utente).
//
// IL PROBLEMA. Un corso si apre anche mesi prima della prima lezione: chi
// si è iscritto allora, quando arriva il giorno non se lo ricorda. E un
// corso ha più lezioni: serve un promemoria per ciascuna.
//
// COSA FA. Ogni mattina guarda i corsi APERTI che hanno «promemoria N
// giorni prima» e, per ogni lezione che cade nei prossimi N giorni, manda
// agli iscritti una mail con titolo, data, orario e sede. Una mail per
// INDIRIZZO: il referente che ha iscritto dieci persone ne riceve una con
// l'elenco. Chi non ha nessun indirizzo resta scritto nel quaderno come
// «senza indirizzo», e la scheda del corso lo mostra: va avvisato a mano.
//
// ⚠️ QUESTA MAIL PARTE DA SOLA, ed è la quarta eccezione dichiarata alla
// regola «l'app prepara, la persona manda» — la prima verso persone fuori
// dall'ente. L'ha decisa l'utente il 28/09/2026. Regge perché la mail non
// porta NIENTE scritto da chi la fa partire: tutto si legge dal database
// (le note della giornata, che sono appunti dell'ufficio, non ci entrano).
//
// ⚠️ NON MANDA MAI DUE VOLTE. Prima di spedire ogni riga si PRENOTA in
// s_corsi_promemoria (chiave: lezione + iscritto + data della lezione); a
// invio riuscito si scrive `inviato_il`, a invio fallito il motivo, e al
// giro dopo si ritenta finché la lezione è nel futuro. Se la lezione viene
// spostata la data cambia, e parte un promemoria nuovo con la data giusta.
//
// POST, e chi può chiamarla:
//   (a) il giro quotidiano, con X-Promemoria-Corsi = s_config.promemoria_corsi_token;
//   (b) la segreteria dall'app, col suo JWT:
//       { prova: true, corso_id }     → dice che cosa manderebbe, senza
//                                       scrivere e senza spedire (anteprima);
//       { giornata_id }               → manda ADESSO il promemoria di quella
//                                       lezione, anche fuori dalla finestra
//                                       (chi l'ha già ricevuto non lo riceve
//                                       di nuovo).
//
// Mittente: cptpd@did.formedilpadova.it (la casella che il service account
// impersona), Reply-To cpt@formedilpadova.it.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delega gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync)
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, oggettoUfficio, paginaHtml, corpoInHtml, LOGO_FIRMA_CID } from './firma.js'
// @ts-ignore modulo JS senza tipi
import { caricaLogo } from './firma-logo.js'
// ⚠️ anche questo è una COPIA di js/corsi-promemoria-testo.js: le regole
// (quali lezioni, a chi, con che testo) si provano con `node --test`.
// @ts-ignore modulo JS senza tipi
import { corsoRicorda, giornateDaRicordare, giorniFra, iscrittiDaAvvisare, indirizzoDi, raggruppaPerIndirizzo, testoPromemoria, firmeQrAperte, testoConfermaIscrizione } from './corsi-promemoria-testo.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-promemoria-corsi',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const PRENOTAZIONE_MINUTI = 10
const GIRI_DA_TENERE_GIORNI = 120

const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
/* «oggi» è quello dell'ufficio, non quello del server */
const oggiRoma = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())

type Riga = Record<string, unknown>
type Corso = { id: number; titolo: string | null; stato: string; promemoria_giorni: number | null; sede: string | null; modalita: string | null; pres_codice: string | null; pres_chiuso_il: string | null }
type Giornata = { id: number; corso_id: number; data: string; dalle: string | null; alle: string | null; dalle2: string | null; alle2: string | null; sede: string | null; aula: string | null }
type Iscritto = { id: number; corso_id: number; persona_id: string | null; impresa_id: string | null; nominativo: string; email_iscrizione: string | null; esito: string | null; test_codice: string | null }
type Quaderno = { id: number; giornata_id: number; iscritto_id: number; data_lezione: string; prenotato_il: string; inviato_il: string | null; esito: string | null }

/* ══ LA CONFERMA DELL'ISCRIZIONE (18/11/2026, deciso dall'utente) ══════════
   Quando la segreteria preme «Conferma le iscrizioni», agli iscritti nati da
   quella richiesta parte da sola la mail «Iscrizione confermata» col codice
   per firmare (tredicesima eccezione: niente di scritto a mano, tutto dal
   database). Mai prima della conferma, mai a chi si è registrato in sala, mai
   per un evento già passato, mai due volte: ogni iscritto si PRENOTA prima di
   spedire (conferma_mail_prenotata_il) e a invio riuscito prende
   conferma_mail_il. Chi non ha un indirizzo resta segnato «senza indirizzo». */
async function confermaIscrizione(sb: ReturnType<typeof createClient>, iscrizioneId: number) {
  const out = { ok: true, iscrizione_id: iscrizioneId, inviate: 0, non_inviate: 0, senza_indirizzo: [] as string[],
    gia_avvisati: 0, saltata: null as string | null, errori: [] as string[], codici: true }
  const { data: r, error: eR } = await sb.from('s_iscrizioni').select('id, corso_id, stato, in_sala').eq('id', iscrizioneId).maybeSingle()
  if (eR) throw new Error('Non sono riuscito a leggere la richiesta: ' + eR.message)
  if (!r) throw new Error('Richiesta ' + iscrizioneId + ' non trovata')
  if (r.in_sala) { out.saltata = 'registrazione in sala: la presenza la conferma la segreteria, niente mail'; return out }
  if (r.stato !== 'confermata') { out.saltata = 'la richiesta non è confermata'; return out }

  const [{ data: c, error: eC }, { data: gg, error: eG }] = await Promise.all([
    sb.from('s_corsi').select('id, titolo, stato, promemoria_giorni, sede, modalita, pres_codice, pres_chiuso_il').eq('id', r.corso_id).maybeSingle(),
    sb.from('s_corsi_giornate').select('id, corso_id, data, dalle, alle, dalle2, alle2, sede, aula').eq('corso_id', r.corso_id),
  ])
  if (eC || !c) throw new Error('Non sono riuscito a leggere il corso: ' + (eC?.message || 'non trovato'))
  if (eG) throw new Error('Non sono riuscito a leggere le giornate: ' + eG.message)
  const giornate = (gg || []) as Giornata[]
  const oggi = oggiRoma()
  if (!giornate.some((g) => g.data && giorniFra(oggi, g.data) >= 0)) { out.saltata = 'evento già passato: niente mail'; return out }

  /* i codici: a chi non ce l'ha; se le firme dal QR sono aperte, si
     ripubblicano subito, perché un codice che il portale non conosce farebbe
     rifiutare la firma. Se la ripubblicazione non riesce la mail parte lo
     stesso: il codice vale quando le firme si ripubblicano (lo fa anche il
     promemoria del giorno prima), e l'errore resta scritto. */
  const { error: eCod } = await sb.rpc('corso_codici_personali', { p_corso_id: c.id })
  if (eCod) { out.codici = false; out.errori.push('codici personali non assegnati: ' + eCod.message) }
  if (!eCod && firmeQrAperte(c)) {
    try {
      const { data: cfgQ } = await sb.from('s_config').select('valore').eq('chiave', 'questionari_token').maybeSingle()
      if (!cfgQ?.valore) throw new Error('manca questionari_token in s_config')
      const rq = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/questionari-pubblica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'X-Questionari-Token': cfgQ.valore },
        body: JSON.stringify({ cosa: 'presenza', corso_id: c.id }),
      })
      const o = await rq.json().catch(() => ({}))
      if (!rq.ok || o.status !== 'ok') throw new Error(o.esito || o.error || `HTTP ${rq.status}`)
    } catch (e) {
      out.errori.push('firme non ripubblicate sul portale: ' + (e as Error).message)
    }
  }

  const { data: ii, error: eI } = await sb.from('s_corsi_iscritti')
    .select('id, corso_id, persona_id, impresa_id, nominativo, email_iscrizione, esito, test_codice, conferma_mail_il, conferma_mail_prenotata_il, conferma_mail_esito')
    .eq('iscrizione_id', iscrizioneId).order('nominativo')
  if (eI) throw new Error('Non sono riuscito a leggere gli iscritti: ' + eI.message)
  const iscritti = iscrittiDaAvvisare(ii || []) as (Iscritto & Riga)[]
  const pIds = [...new Set(iscritti.map((i) => i.persona_id).filter(Boolean))] as string[]
  const impIds = [...new Set(iscritti.map((i) => i.impresa_id).filter(Boolean))] as string[]
  const [rp, ri] = await Promise.all([
    pIds.length ? sb.from('persone').select('persona_id, email, email2').in('persona_id', pIds) : Promise.resolve({ data: [], error: null }),
    impIds.length ? sb.from('imprese').select('impresa_id, email').in('impresa_id', impIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (rp.error) throw new Error('Non sono riuscito a leggere le persone: ' + rp.error.message)
  if (ri.error) throw new Error('Non sono riuscito a leggere le imprese: ' + ri.error.message)
  const persDi = Object.fromEntries((rp.data || []).map((p: Riga) => [p.persona_id, p]))
  const impDi = Object.fromEntries((ri.data || []).map((p: Riga) => [p.impresa_id, p]))

  const scaduta = new Date(Date.now() - PRENOTAZIONE_MINUTI * 60_000).toISOString()
  const daFare: { iscritto_id: number; nominativo: string; email: string | null; origine: string | null; codice: string | null }[] = []
  for (const i of iscritti) {
    if (i.conferma_mail_il) { out.gia_avvisati++; continue }
    if (i.conferma_mail_prenotata_il && !i.conferma_mail_esito && String(i.conferma_mail_prenotata_il) > scaduta) continue
    const ind = indirizzoDi(i, persDi[i.persona_id || ''] || null, impDi[i.impresa_id || ''] || null)
    daFare.push({ iscritto_id: i.id, nominativo: i.nominativo, email: ind.email, origine: ind.origine, codice: out.codici ? (i.test_codice || null) : null })
  }
  const { gruppi, senza } = raggruppaPerIndirizzo(daFare)
  for (const x of senza) {
    out.senza_indirizzo.push(x.nominativo)
    await sb.from('s_corsi_iscritti').update({ conferma_mail_esito: 'senza indirizzo' }).eq('id', x.iscritto_id)
  }

  const logo = await caricaLogo()
  const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
  let token = ''
  for (const gr of gruppi) {
    /* la prenotazione: si prende solo chi non è partito e non è in partenza */
    const ids = (gr.righe as typeof daFare).map((x) => x.iscritto_id)
    const { data: prese, error: eP } = await sb.from('s_corsi_iscritti')
      .update({ conferma_mail_prenotata_il: new Date().toISOString(), conferma_mail_esito: null, conferma_mail_a: gr.email })
      .in('id', ids).is('conferma_mail_il', null)
      .or(`conferma_mail_prenotata_il.is.null,conferma_mail_esito.not.is.null,conferma_mail_prenotata_il.lt.${scaduta}`)
      .select('id')
    if (eP) { out.errori.push(`${gr.email}: prenotazione non riuscita (${eP.message})`); continue }
    const presi = new Set((prese || []).map((x: Riga) => Number(x.id)))
    const righe = (gr.righe as typeof daFare).filter((x) => presi.has(x.iscritto_id))
    if (!righe.length) continue
    const idsPresi = righe.map((x) => x.iscritto_id)
    try {
      const t = testoConfermaIscrizione({ corso: c, giornate, partecipanti: righe, contatto: MITTENTE_UFFICIALE, promemoria: !!c.promemoria_giorni })
      let html = paginaHtml(t.firmaHtml ? `${corpoInHtml(t.corpoPrima)}\n${t.firmaHtml}\n${corpoInHtml(t.corpoDopo)}` : corpoInHtml(t.corpo))
      if (!logo.ok) html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
      const mime = componiEml({
        from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
        to: gr.email, oggetto: oggettoUfficio(t.oggetto), corpo: t.corpo, html, unsent: false,
      })
      if (!token) token = await getToken(sa, SCOPE_GMAIL)
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: toB64Url(mime) }),
      })
      const o = await res.json()
      if (!res.ok || o.error) throw new Error(o.error?.message || `Gmail ha risposto ${res.status}`)
      const { error: eS } = await sb.from('s_corsi_iscritti').update({
        conferma_mail_il: new Date().toISOString(), conferma_mail_esito: logo.ok ? 'inviata' : `inviata (senza logo: ${logo.motivo})`,
      }).in('id', idsPresi)
      if (eS) out.errori.push(`${gr.email}: inviata, ma non sono riuscito a registrarlo (${eS.message})`)
      out.inviate += idsPresi.length
    } catch (e) {
      const msg = (e as Error).message
      await sb.from('s_corsi_iscritti').update({ conferma_mail_esito: `non inviata: ${msg}`.slice(0, 500) }).in('id', idsPresi)
      out.non_inviate += idsPresi.length
      out.errori.push(`${gr.email}: ${msg}`)
    }
  }
  if (out.errori.length || out.non_inviate) out.ok = out.non_inviate === 0
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let chi = 'giro quotidiano'
  let prova = false
  try {
    const { data: cfg } = await sb.from('s_config').select('chiave, valore').in('chiave', ['promemoria_corsi_token'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))

    /* chi chiama: il giro con la parola d'ordine, oppure la segreteria.
       La chiave anon non basta: sta in un repository pubblico (14/09). */
    const dato = req.headers.get('x-promemoria-corsi') || ''
    const delGiro = !!(conf.promemoria_corsi_token && dato && dato === conf.promemoria_corsi_token)
    if (!delGiro) {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const sbU = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: u } = await sbU.auth.getUser()
      const { data: segr, error: eSegr } = await sbU.rpc('is_segreteria')
      if (!u?.user?.email || eSegr || segr !== true) return json({ error: 'accesso non autorizzato' }, 403)
      chi = u.user.email
    }

    const corpoReq = await req.json().catch(() => ({}))
    /* (18/11/2026) la conferma di un'iscrizione: la chiama l'app segreteria
       subito dopo «Conferma le iscrizioni»; il giro quotidiano non la fa */
    const confId = Number(corpoReq?.conferma_iscrizione)
    if (!delGiro && Number.isInteger(confId) && confId > 0) {
      return json({ chi, ...(await confermaIscrizione(sb, confId)) })
    }
    prova = !delGiro && corpoReq?.prova === true
    const soloCorso = !delGiro && Number.isInteger(Number(corpoReq?.corso_id)) && Number(corpoReq.corso_id) > 0 ? Number(corpoReq.corso_id) : null
    const soloGiornata = !delGiro && Number.isInteger(Number(corpoReq?.giornata_id)) && Number(corpoReq.giornata_id) > 0 ? Number(corpoReq.giornata_id) : null
    if (!delGiro && !prova && !soloGiornata) {
      return json({ error: 'Dall\'app si chiede l\'anteprima (prova) oppure l\'invio di una lezione (giornata_id): il giro completo lo fa il controllo automatico.' }, 400)
    }

    const oggi = oggiRoma()

    /* ── quali lezioni ── */
    let qC = sb.from('s_corsi').select('id, titolo, stato, promemoria_giorni, sede, modalita, pres_codice, pres_chiuso_il').eq('stato', 'aperto')
    if (!soloGiornata) qC = qC.not('promemoria_giorni', 'is', null)
    if (soloCorso) qC = qC.eq('id', soloCorso)
    const { data: cc, error: eC } = await qC
    if (eC) throw new Error('Non sono riuscito a leggere i corsi: ' + eC.message)
    const corsi = (cc || []) as Corso[]
    const corsoDi = Object.fromEntries(corsi.map((c) => [c.id, c]))

    let tutteGiornate: Giornata[] = []
    if (corsi.length) {
      const { data: gg, error: eG } = await sb.from('s_corsi_giornate')
        .select('id, corso_id, data, dalle, alle, dalle2, alle2, sede, aula').in('corso_id', corsi.map((c) => c.id))
      if (eG) throw new Error('Non sono riuscito a leggere le giornate: ' + eG.message)
      tutteGiornate = (gg || []) as Giornata[]
    }

    let lezioni: Giornata[]
    if (soloGiornata) {
      /* «manda adesso»: la decide una persona, quindi la finestra non vale;
         vale che il corso sia aperto e la lezione non sia già passata */
      const g = tutteGiornate.find((x) => x.id === soloGiornata)
      if (!g) return json({ error: 'Lezione non trovata, oppure il corso non è aperto.' }, 400)
      if (giorniFra(oggi, g.data) < 0) return json({ error: 'La lezione è già passata: il promemoria non parte.' }, 400)
      lezioni = [g]
    } else if (prova) {
      /* l'anteprima mostra la prossima lezione del corso, anche se la sua
         finestra non è ancora aperta: serve a vedere che cosa partirà */
      const future = tutteGiornate.filter((g) => g.data && giorniFra(oggi, g.data) >= 1)
        .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id)
      const viste = new Set<number>()
      lezioni = future.filter((g) => (viste.has(g.corso_id) ? false : (viste.add(g.corso_id), true)))
    } else {
      lezioni = giornateDaRicordare(corsi, tutteGiornate, oggi) as Giornata[]
    }

    const esito = {
      ok: true, chi, prova, oggi, lezioni: [] as Riga[],
      inviate: 0, non_inviate: 0, senza_indirizzo: 0, gia_avvisati: 0,
    }

    /* ── i codici della firma di presenza (17/11/2026) ──
       Se il corso ha le firme dal QR aperte, nel promemoria va il codice
       personale di ciascuno. Prima chi non ce l'ha lo riceve, poi le firme
       si RIPUBBLICANO sul portale: un codice che il portale non conosce
       farebbe rifiutare la firma in aula. Se la pubblicazione non riesce, il
       promemoria parte lo stesso ma SENZA codici (restano i biglietti
       all'ingresso), e l'errore resta scritto nel giro. */
    const codiciOk = new Set<number>()
    const erroriCodici: string[] = []
    const conQr = [...new Set(lezioni.map((g) => g.corso_id))].filter((id) => firmeQrAperte(corsoDi[id]))
    if (conQr.length && prova) {
      for (const id of conQr) codiciOk.add(id)   // l'anteprima mostra i codici che ci sono già, senza scrivere niente
    } else if (conQr.length) {
      const { data: cfgQ } = await sb.from('s_config').select('valore').eq('chiave', 'questionari_token').maybeSingle()
      for (const id of conQr) {
        try {
          const { error: eCod } = await sb.rpc('corso_codici_personali', { p_corso_id: id })
          if (eCod) throw new Error('codici personali: ' + eCod.message)
          if (!cfgQ?.valore) throw new Error('manca questionari_token in s_config')
          const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/questionari-pubblica`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'X-Questionari-Token': cfgQ.valore,
            },
            body: JSON.stringify({ cosa: 'presenza', corso_id: id }),
          })
          const out = await r.json().catch(() => ({}))
          if (!r.ok || out.status !== 'ok') throw new Error('firme non ripubblicate sul portale: ' + (out.esito || out.error || `HTTP ${r.status}`))
          codiciOk.add(id)
        } catch (e) {
          erroriCodici.push(`corso ${id}: ${(e as Error).message} — promemoria senza codici`)
        }
      }
    }

    if (lezioni.length) {
      const idsCorsi = [...new Set(lezioni.map((g) => g.corso_id))]
      const { data: ii, error: eI } = await sb.from('s_corsi_iscritti')
        .select('id, corso_id, persona_id, impresa_id, nominativo, email_iscrizione, esito, test_codice').in('corso_id', idsCorsi).order('nominativo')
      if (eI) throw new Error('Non sono riuscito a leggere gli iscritti: ' + eI.message)
      const iscritti = iscrittiDaAvvisare(ii || []) as Iscritto[]

      const pIds = [...new Set(iscritti.map((i) => i.persona_id).filter(Boolean))] as string[]
      const impIds = [...new Set(iscritti.map((i) => i.impresa_id).filter(Boolean))] as string[]
      const [rp, ri, rq] = await Promise.all([
        pIds.length ? sb.from('persone').select('persona_id, email, email2').in('persona_id', pIds) : Promise.resolve({ data: [], error: null }),
        impIds.length ? sb.from('imprese').select('impresa_id, email').in('impresa_id', impIds) : Promise.resolve({ data: [], error: null }),
        sb.from('s_corsi_promemoria').select('id, giornata_id, iscritto_id, data_lezione, prenotato_il, inviato_il, esito')
          .in('giornata_id', lezioni.map((g) => g.id)),
      ])
      /* ⚠️ se l'anagrafica o il quaderno non si leggono NON si va avanti:
         senza il quaderno si rischierebbe di scrivere due volte alla
         stessa persona, e «nessuno» non è «non letto» (regola del 19/09) */
      if (rp.error) throw new Error('Non sono riuscito a leggere le persone: ' + rp.error.message)
      if (ri.error) throw new Error('Non sono riuscito a leggere le imprese: ' + ri.error.message)
      if (rq.error) throw new Error('Non sono riuscito a leggere il quaderno dei promemoria: ' + rq.error.message)
      const persDi = Object.fromEntries((rp.data || []).map((p: Riga) => [p.persona_id, p]))
      const impDi = Object.fromEntries((ri.data || []).map((p: Riga) => [p.impresa_id, p]))
      const quaderno = (rq.data || []) as Quaderno[]

      const scaduta = new Date(Date.now() - PRENOTAZIONE_MINUTI * 60_000).toISOString()
      const logo = prova ? { ok: true, motivo: '' } : await caricaLogo()
      const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
      let token = ''

      for (const g of lezioni) {
        const c = corsoDi[g.corso_id]
        const giornateCorso = tutteGiornate.filter((x) => x.corso_id === g.corso_id)
        const riepilogo: Riga = {
          corso_id: c.id, titolo: c.titolo, giornata_id: g.id, data: g.data,
          inviate: 0, non_inviate: 0, senza_indirizzo: [] as string[], gia_avvisati: 0, errori: [] as string[],
          ...(prova ? { anteprima: [] as Riga[] } : {}),
        }
        esito.lezioni.push(riepilogo)

        /* chi va avvisato, e chi lo è già stato per QUESTA data */
        const daFare: { iscritto_id: number; nominativo: string; email: string | null; origine: string | null; riga: Quaderno | null; codice: string | null }[] = []
        const codici = codiciOk.has(c.id)
        for (const i of iscritti.filter((x) => x.corso_id === g.corso_id)) {
          const riga = quaderno.find((q) => q.giornata_id === g.id && q.iscritto_id === i.id && String(q.data_lezione) === String(g.data)) || null
          if (riga?.inviato_il) { (riepilogo.gia_avvisati as number)++; esito.gia_avvisati++; continue }
          if (riga && !riga.esito && riga.prenotato_il > scaduta) continue   // è in partenza da un'altra chiamata
          const ind = indirizzoDi(i, persDi[i.persona_id || ''] || null, impDi[i.impresa_id || ''] || null)
          daFare.push({ iscritto_id: i.id, nominativo: i.nominativo, email: ind.email, origine: ind.origine, riga, codice: codici ? (i.test_codice || null) : null })
        }

        const { gruppi, senza } = raggruppaPerIndirizzo(daFare)
        ;(riepilogo.senza_indirizzo as string[]).push(...senza.map((r: { nominativo: string }) => r.nominativo))
        esito.senza_indirizzo += senza.length

        if (prova) {
          for (const gr of gruppi) {
            const t = testoPromemoria({ corso: c, giornata: g, giornate: giornateCorso, partecipanti: gr.righe, oggi, contatto: MITTENTE_UFFICIALE, codici })
            ;(riepilogo.anteprima as Riga[]).push({
              a: gr.email, partecipanti: gr.righe.map((r: { nominativo: string }) => r.nominativo),
              oggetto: oggettoUfficio(t.oggetto), corpo: t.corpo,
              ...(t.firmaHtml ? { html: paginaHtml(`${corpoInHtml(t.corpoPrima)}\n${t.firmaHtml}\n${corpoInHtml(t.corpoDopo)}`) } : {}),
            })
          }
          continue
        }

        /* ── la prenotazione ── una riga per iscritto, presa prima di spedire */
        const prenota = async (r: typeof daFare[number]): Promise<number | null> => {
          const dati = { email: r.email, origine_email: r.origine, prenotato_il: new Date().toISOString(), esito: null, inviato_il: null }
          if (r.riga) {
            const { data, error } = await sb.from('s_corsi_promemoria').update(dati).eq('id', r.riga.id)
              .is('inviato_il', null).or(`esito.not.is.null,prenotato_il.lt.${scaduta}`).select('id')
            if (error) throw new Error(error.message)
            return data?.[0]?.id ?? null
          }
          const { data, error } = await sb.from('s_corsi_promemoria')
            .upsert({ corso_id: c.id, giornata_id: g.id, iscritto_id: r.iscritto_id, data_lezione: g.data, ...dati },
              { onConflict: 'giornata_id,iscritto_id,data_lezione', ignoreDuplicates: true }).select('id')
          if (error) throw new Error(error.message)
          return data?.[0]?.id ?? null
        }

        for (const r of senza) {
          try {
            const id = await prenota(r)
            if (id) await sb.from('s_corsi_promemoria').update({ esito: 'senza indirizzo' }).eq('id', id)
          } catch (e) { (riepilogo.errori as string[]).push(`${r.nominativo}: ${(e as Error).message}`) }
        }

        for (const gr of gruppi) {
          const prese: { id: number; r: typeof daFare[number] }[] = []
          try {
            for (const r of gr.righe as typeof daFare) {
              const id = await prenota(r)
              if (id) prese.push({ id, r })
            }
          } catch (e) {
            (riepilogo.errori as string[]).push(`${gr.email}: prenotazione non riuscita (${(e as Error).message})`)
          }
          if (!prese.length) continue
          const ids = prese.map((p) => p.id)
          try {
            const t = testoPromemoria({ corso: c, giornata: g, giornate: giornateCorso, partecipanti: prese.map((p) => p.r), oggi, contatto: MITTENTE_UFFICIALE, codici })
            /* col codice della firma: il riquadro arancione fra «quando e dove» e il resto */
            let html = paginaHtml(t.firmaHtml ? `${corpoInHtml(t.corpoPrima)}\n${t.firmaHtml}\n${corpoInHtml(t.corpoDopo)}` : corpoInHtml(t.corpo))
            if (!logo.ok) {
              html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
            }
            const mime = componiEml({
              from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
              to: gr.email, oggetto: oggettoUfficio(t.oggetto), corpo: t.corpo, html, unsent: false,
            })
            if (!token) token = await getToken(sa, SCOPE_GMAIL)
            const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw: toB64Url(mime) }),
            })
            const out = await res.json()
            if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
            const { error: eS } = await sb.from('s_corsi_promemoria').update({
              inviato_il: new Date().toISOString(), esito: logo.ok ? 'inviato' : `inviato (senza logo: ${logo.motivo})`,
            }).in('id', ids)
            /* la mail è partita ma non risulta scritta: si dice, perché al
               giro dopo partirebbe di nuovo */
            if (eS) (riepilogo.errori as string[]).push(`${gr.email}: inviato, ma non sono riuscito a registrarlo (${eS.message})`)
            riepilogo.inviate = (riepilogo.inviate as number) + ids.length
            esito.inviate += ids.length
          } catch (e) {
            const msg = (e as Error).message
            await sb.from('s_corsi_promemoria').update({ esito: `non inviato: ${msg}`.slice(0, 500) }).in('id', ids)
            riepilogo.non_inviate = (riepilogo.non_inviate as number) + ids.length
            esito.non_inviate += ids.length
            ;(riepilogo.errori as string[]).push(`${gr.email}: ${msg}`)
          }
        }
      }
    }

    if (!prova) {
      const errori = [...erroriCodici, ...esito.lezioni.flatMap((l) => (l.errori as string[]) || [])]
      await sb.from('s_corsi_promemoria_giri').insert({
        chi, lezioni: esito.lezioni.length, inviate: esito.inviate, non_inviate: esito.non_inviate,
        senza_indirizzo: esito.senza_indirizzo, errore: errori.length ? errori.join(' · ').slice(0, 1000) : null,
      })
      await sb.from('s_corsi_promemoria_giri').delete()
        .lt('eseguito_il', new Date(Date.now() - GIRI_DA_TENERE_GIORNI * 86_400_000).toISOString())
    }
    return json(esito)
  } catch (e) {
    console.error('promemoria-corsi:', e)
    const msg = (e as Error).message
    /* anche il giro che si ferma lascia un rigo: il silenzio non è un esito */
    if (!prova) {
      try { await sb.from('s_corsi_promemoria_giri').insert({ chi, errore: msg.slice(0, 1000) }) } catch { /* niente da fare */ }
    }
    return json({ error: msg }, 500)
  }
})
