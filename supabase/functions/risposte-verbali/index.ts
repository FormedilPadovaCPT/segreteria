// Supabase Edge Function – risposte-verbali
// «L'impresa ha risposto al verbale»: la risposta va al tecnico
// (12/10/2026, chiesto dall'utente).
//
// IL PROBLEMA. Il verbale parte da cptpd@did.formedilpadova.it (send-verbale)
// senza Reply-To, e quando l'impresa, il CSE o il committente rispondono la
// risposta torna in quella casella, che guarda la segreteria. Il tecnico che
// ha fatto la visita, e che dovrà tornare in cantiere, non la vede. Caso che
// l'ha fatto chiedere: il CSE del cantiere di Limena (verbale CPT/26_27/0029)
// che riferiva le correzioni fatte dopo la visita.
//
// COSA FA. Ogni ora, in orario d'ufficio, legge (in sola lettura) le mail
// arrivate con un numero di verbale nell'oggetto, scarta quelle scritte da
// dentro l'ente e le risposte automatiche (regole in
// risposte-verbali-lettura.js, provate con `node --test`), aggancia la visita
// e il tecnico (o i due tecnici) e gli INOLTRA la mail com'è arrivata, con gli
// allegati, col coordinatore in copia (s_config.coordinatore_email, scelto
// dall'utente). Il «Rispondi» del tecnico va a chi ha scritto. Ogni mail
// esaminata lascia una riga in s_mail_risposte_verbali.
//
// ⚠️ È L'ECCEZIONE 8 alla regola «l'app prepara, la persona manda» (CLAUDE.md):
// interna, verso il tecnico, e l'app non scrive niente al posto di nessuno —
// due righe che dicono che cos'è, poi la mail com'è arrivata.
// ⚠️ NON TOCCA LA CASELLA: non archivia, non segna come letto, non risponde.
// La segreteria la mail la vede comunque.
// ⚠️ Le risposte che vanno SOLO a cpt@formedilpadova.it (Outlook) da qui non
// si vedono: questa legge la casella da cui i verbali partono.
//
// POST, e chi può chiamarla:
//   (a) il giro orario, con X-Risposte-Verbali = s_config.risposte_verbali_token;
//   (b) la segreteria dall'app, col suo JWT.
//   ?dryRun=1 → dice che cosa girerebbe, senza scrivere e senza mandare mail.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (deleghe gmail.readonly e gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js, mail-respinte-lettura.js e risposte-verbali-lettura.js sono
// COPIE dei moduli in js/ (npm run firma-sync)
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, paginaHtml, corpoInHtml, LOGO_FIRMA_CID } from './firma.js'
// @ts-ignore modulo JS senza tipi
import { caricaLogo } from './firma-logo.js'
// @ts-ignore modulo JS senza tipi
import { classifica, mappaIntestazioni, testoDaHtml, allegatiDaTenere, nomeFileSicuro, testoInoltro, dataOraIt } from './risposte-verbali-lettura.js'
// @ts-ignore modulo JS senza tipi
import { decodificaOggetto, inServizio } from './mail-respinte-lettura.js'

const SCOPE_GMAIL_RO = 'https://www.googleapis.com/auth/gmail.readonly'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-risposte-verbali',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
/* il giro è orario, ma da venerdì sera a lunedì mattina passano 62 ore */
const GIORNI_INDIETRO = 4
const MAX_MESSAGGI = 100
/* oltre, gli allegati restano nella casella: la mail parte lo stesso */
const MAX_ALLEGATI_BYTE = 18 * 1024 * 1024
const MAX_TENTATIVI = 3
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const daB64UrlByte = (s: string) => {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const daB64UrlTesto = (s: string) => {
  try { return new TextDecoder().decode(daB64UrlByte(s)) } catch { return '' }
}

type Parte = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Parte[] }
type Allegato = { nome: string; mime: string; dimensione: number; inline: boolean; attachmentId?: string; data?: string }

/* il testo della mail e i suoi allegati, scendendo nelle parti */
function scomponi(p: Parte | undefined, out: { plain: Parte[]; html: Parte[]; allegati: Allegato[] }, liv = 0) {
  if (!p || liv > 10) return
  const tipo = String(p.mimeType || '').toLowerCase()
  const h = mappaIntestazioni(p.headers)
  const disp = String(h['content-disposition'] || '').toLowerCase()
  if (p.filename) {
    out.allegati.push({
      nome: p.filename, mime: p.mimeType || 'application/octet-stream', dimensione: p.body?.size || 0,
      inline: disp.startsWith('inline') || (!!h['content-id'] && !disp.startsWith('attachment')),
      attachmentId: p.body?.attachmentId, data: p.body?.data,
    })
  } else if (tipo === 'text/plain' && !disp.startsWith('attachment')) out.plain.push(p)
  else if (tipo === 'text/html' && !disp.startsWith('attachment')) out.html.push(p)
  for (const f of p.parts || []) scomponi(f, out, liv + 1)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['risposte_verbali_token', 'coordinatore_email'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))

    /* chi chiama: il giro con la parola d'ordine, oppure la segreteria col
       suo accesso. La chiave anon non basta: sta in un repository pubblico. */
    const dato = req.headers.get('x-risposte-verbali') || ''
    let chi = 'giro orario'
    if (!(conf.risposte_verbali_token && dato && dato === conf.risposte_verbali_token)) {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const sbU = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: u } = await sbU.auth.getUser()
      const { data: segr } = await sbU.rpc('is_segreteria')
      if (!u?.user?.email || segr !== true) return json({ error: 'accesso non autorizzato' }, 403)
      chi = u.user.email
    }

    const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const esito: Record<string, unknown> = { chi, dryRun, esaminati: 0, inoltrate: 0, escluse: 0, senza_tecnico: 0, errori: [] as string[], righe: [] as unknown[] }
    const err = esito.errori as string[]
    const coord = String(conf.coordinatore_email || '').trim().toLowerCase()

    /* ── le mail con un numero di verbale nell'oggetto ──
       `subject:CPT` restringe la ricerca; il numero vero lo controlla
       `classifica` sull'oggetto decodificato. */
    const tokenRo = await getToken(sa, SCOPE_GMAIL_RO, SOGGETTO_ENTE)
    const q = `newer_than:${GIORNI_INDIETRO}d subject:CPT -in:sent -in:drafts -in:trash -in:spam -from:me`
    const lista = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_MESSAGGI}&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${tokenRo}` } },
    ).then((r) => r.json()).catch(() => ({}))
    if (lista?.error) throw new Error('Gmail: ' + (lista.error.message || 'lettura non riuscita'))
    const ids: string[] = (lista.messages || []).map((m: { id: string }) => m.id)
    esito.esaminati = ids.length

    /* già trattate: non si riaprono. Un errore si ritenta, fino a tre volte. */
    const { data: gia, error: eGia } = ids.length
      ? await sb.from('s_mail_risposte_verbali').select('gmail_id, esito, tentativi').in('gmail_id', ids)
      : { data: [], error: null }
    if (eGia) throw new Error('registro non letto: ' + eGia.message)
    const precedenti = new Map((gia || []).map((r: { gmail_id: string; esito: string; tentativi: number }) => [r.gmail_id, r]))

    const logo = await caricaLogo()
    let tokenSend = ''

    for (const id of ids) {
      const prima = precedenti.get(id)
      if (prima && (prima.esito !== 'errore' || (prima.tentativi || 0) >= MAX_TENTATIVI)) continue
      const registra = async (riga: Record<string, unknown>) => {
        ;(esito.righe as unknown[]).push(riga)
        if (dryRun) return
        const { error } = await sb.from('s_mail_risposte_verbali')
          .upsert({ ...riga, tentativi: (prima?.tentativi || 0) + (riga.esito === 'errore' ? 1 : 0) }, { onConflict: 'gmail_id' })
        if (error) err.push(`${id}: registro non scritto: ${error.message}`)
      }
      try {
        const m = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${tokenRo}` } },
        ).then((r) => r.json())
        if (m?.error) { err.push(`${id}: ${m.error.message}`); continue }

        const c = classifica(m.payload?.headers)
        if (!c.nr) continue                     /* non c'entra coi verbali: non si registra */
        const h = mappaIntestazioni(m.payload?.headers)
        const ricevuta = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString()
        const base = {
          gmail_id: id, thread_id: m.threadId || null, ricevuta_il: ricevuta,
          mittente: c.da || null, mittente_nome: c.mittente || null,
          oggetto: String(c.oggetto || '').slice(0, 500), nr_verbale: c.nr,
        }
        if (c.escludi) {
          esito.escluse = (esito.escluse as number) + 1
          await registra({ ...base, esito: 'esclusa', motivo: c.escludi })
          continue
        }

        /* la visita e chi l'ha fatta (uno o due tecnici) */
        const { data: vv, error: eV } = await sb.from('visite')
          .select('visita_id, nr_verbale, tecnico_id, tecnico2_id, impresa_id, data_visita, elimina')
          .eq('nr_verbale', c.nr)
        if (eV) throw new Error('visita non letta: ' + eV.message)
        // deno-lint-ignore no-explicit-any
        const visita: any = (vv || []).find((v: { elimina?: number | null }) => Number(v.elimina || 0) !== 1) || (vv || [])[0] || null
        const idTec = [visita?.tecnico_id, visita?.tecnico2_id].filter(Boolean)
        const { data: tt, error: eT } = idTec.length
          ? await sb.from('tecnici').select('tecnico_id, titolo, tecnico_nome, tecnico_cognome, email, attivo, elimina').in('tecnico_id', idTec)
          : { data: [], error: null }
        if (eT) throw new Error('tecnico non letto: ' + eT.message)
        const conMail = (tt || []).filter((t: Record<string, string>) => MAIL_RE.test(String(t.email || '').trim()))
        /* 20/10/2026: un tecnico non in servizio non riceve più l'inoltro; la risposta resta in cptpd@ */
        const tecnici = conMail.filter((t: Record<string, unknown>) => inServizio(t))
        let impresa = ''
        if (visita?.impresa_id) {
          const { data: i } = await sb.from('imprese').select('impresa_nome').eq('impresa_id', visita.impresa_id).maybeSingle()
          impresa = i?.impresa_nome || ''
        }
        const conVisita = { ...base, visita_id: visita?.visita_id || null }
        if (!tecnici.length) {
          esito.senza_tecnico = (esito.senza_tecnico as number) + 1
          await registra({ ...conVisita, esito: 'senza_tecnico',
            motivo: !visita ? 'nessuna visita con questo numero di verbale'
              : conMail.length ? 'il tecnico della visita non è in servizio' : 'la visita non ha un tecnico con indirizzo' })
          continue
        }
        const a = tecnici.map((t: Record<string, string>) => String(t.email).trim().toLowerCase())
        const cc = coord && MAIL_RE.test(coord) && !a.includes(coord) ? [coord] : []
        const nomeTecnico = tecnici.map((t: Record<string, string>) =>
          [t.titolo, t.tecnico_nome, t.tecnico_cognome].filter(Boolean).join(' ')).join(' e ')

        /* testo e allegati */
        const parti = { plain: [] as Parte[], html: [] as Parte[], allegati: [] as Allegato[] }
        scomponi(m.payload, parti)
        const leggiCorpo = async (p: Parte) => {
          if (p.body?.data) return daB64UrlTesto(p.body.data)
          if (p.body?.attachmentId) {
            const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${p.body.attachmentId}`,
              { headers: { Authorization: `Bearer ${tokenRo}` } }).then((x) => x.json())
            return r?.data ? daB64UrlTesto(r.data) : ''
          }
          return ''
        }
        let corpo = parti.plain.length ? await leggiCorpo(parti.plain[0]) : ''
        if (!corpo.trim() && parti.html.length) corpo = testoDaHtml(await leggiCorpo(parti.html[0]))

        const tenere = allegatiDaTenere(parti.allegati) as Allegato[]
        const allegati: { nome: string; mime: string; byte: Uint8Array }[] = []
        const omessi: string[] = []
        let peso = 0
        for (const al of tenere) {
          const nome = nomeFileSicuro(al.nome)
          if (peso + (al.dimensione || 0) > MAX_ALLEGATI_BYTE) { omessi.push(nome); continue }
          let dati = al.data || ''
          if (!dati && al.attachmentId && !dryRun) {
            const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/attachments/${al.attachmentId}`,
              { headers: { Authorization: `Bearer ${tokenRo}` } }).then((x) => x.json())
            if (r?.error) throw new Error(`allegato ${nome}: ${r.error.message}`)
            dati = r?.data || ''
          }
          const byte = dati ? daB64UrlByte(dati) : new Uint8Array()
          peso += byte.length || al.dimensione || 0
          allegati.push({ nome, mime: al.mime, byte })
        }

        const testo = testoInoltro({
          nomeTecnico, nr: c.nr, impresa, dataVisita: visita?.data_visita || '',
          mittente: c.mittente, da: c.da, rispondiA: c.rispondiA, data: dataOraIt(m.internalDate),
          a: decodificaOggetto(h.to || ''), cc: decodificaOggetto(h.cc || ''), oggetto: c.oggetto, corpo,
          allegati: allegati.map((x) => x.nome), omessi, coordinatoreInCopia: cc.length > 0,
        })
        const chiScrive = c.mittente && c.mittente !== c.da ? c.mittente : c.da
        const oggetto = `Risposta al verbale ${c.nr}${impresa ? ` - ${impresa}` : ''} - da ${chiScrive}`
        const riga = { ...conVisita, tecnico_email: a.join(', '), inoltro_a: [...a, ...cc].join(', '),
          allegati: allegati.length, allegati_omessi: omessi.length ? omessi.join(', ') : null }
        if (dryRun) { await registra({ ...riga, esito: 'inoltrata', motivo: '(prova: non inviata)' }); continue }

        try {
          let html = paginaHtml(corpoInHtml(testo))
          if (!logo.ok) {
            html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
          }
          const mime = componiEml({
            from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: c.rispondiA || c.da,
            to: a.join(', '), cc, oggetto, corpo: testo, html, allegati, unsent: false,
          })
          if (!tokenSend) tokenSend = await getToken(sa, SCOPE_GMAIL)
          /* l'invio «media» regge fino a 35 MB, il JSON con `raw` molto meno */
          const res = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenSend}`, 'Content-Type': 'message/rfc822' },
            body: mime,
          })
          const out = await res.json().catch(() => ({}))
          if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
          esito.inoltrate = (esito.inoltrate as number) + 1
          await registra({ ...riga, esito: 'inoltrata', inoltro_il: new Date().toISOString(),
            motivo: logo.ok ? null : `inoltrata senza logo: ${logo.motivo}` })
        } catch (e) {
          const msg = (e as Error).message
          err.push(`${id} → ${a.join(', ')}: ${msg}`)
          await registra({ ...riga, esito: 'errore', motivo: `non inoltrata: ${msg}`.slice(0, 500) })
        }
      } catch (e) { err.push(`${id}: ${(e as Error).message}`) }
    }

    /* il battito: anche un giro che non ha trovato niente lo scrive, così
       «nessuna risposta» non si confonde con «il giro non è partito» */
    if (!dryRun) {
      await sb.from('s_config').update({ valore: JSON.stringify({
        il: new Date().toISOString(), chi, esaminati: esito.esaminati, inoltrate: esito.inoltrate,
        escluse: esito.escluse, senza_tecnico: esito.senza_tecnico, errori: err.length,
      }) }).eq('chiave', 'risposte_verbali_ultimo_giro')
    }

    return json({ ok: !err.length, ...esito })
  } catch (e) {
    console.error('risposte-verbali:', e)
    return json({ error: (e as Error).message }, 500)
  }
})
