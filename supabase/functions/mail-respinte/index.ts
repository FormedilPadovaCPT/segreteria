// Supabase Edge Function – mail-respinte
// «Il verbale non è arrivato»: i rimbalzi della posta, una volta al giorno
// (21/09/2026, chiesto dall'utente).
//
// IL PROBLEMA. Il verbale parte da cptpd@did.formedilpadova.it
// (send-verbale) verso committente, responsabile dei lavori, CSP, CSE e
// imprese. Se un indirizzo è sbagliato il messaggio di mancata consegna
// torna in quella casella, che guarda una persona sola — e il cruscotto
// «Posta e agenda» non lo mostra nemmeno, perché `mailer-daemon` sta fra
// i mittenti da ignorare. Risultato: l'indirizzo resta sbagliato per
// sempre e l'impresa non riceve il verbale, senza che il tecnico che ha
// fatto la visita lo sappia mai.
//
// COSA FA. Legge (in sola lettura) i rapporti di mancata consegna degli
// ultimi giorni, ne ricava l'indirizzo che ha fallito, il codice di
// errore e il numero di verbale citato nell'oggetto originale, aggancia
// la visita e il tecnico, e scrive una riga in s_mail_respinte. Se il
// rifiuto è PERMANENTE (5.x.x) manda al tecnico un avviso.
//
// ⚠️ NON CORREGGE NIENTE. Un rimbalzo dice che quella casella non ha
// accettato il messaggio, non quale sia l'indirizzo giusto: a sistemarlo
// è il tecnico, che sa chi ha incontrato in cantiere (regola d'oro 1).
// E non tocca la casella: non archivia, non segna come letto, non
// risponde — legge e riferisce, come bacheca-giornata.
//
// ⚠️ I RITARDI (4.x.x) NON FANNO PARTIRE NIENTE: «non ancora consegnata»
// non è «indirizzo sbagliato», e un avviso per ogni coda di un server
// altrui insegnerebbe a non leggere gli avvisi. Si registrano e basta.
//
// POST, e chi può chiamarla:
//   (a) il giro quotidiano, con X-Mail-Respinte = s_config.mail_respinte_token;
//   (b) la segreteria dall'app (bottone «Cerca adesso»), col suo JWT.
//   ?dryRun=1 → dice che cosa troverebbe, senza scrivere e senza mandare mail.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (deleghe gmail.readonly e gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync)
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, oggettoUfficio, paginaHtml, corpoInHtml, LOGO_FIRMA_CID } from './firma.js'
// @ts-ignore modulo JS senza tipi
import { caricaLogo } from './firma-logo.js'
// ⚠️ anche questo è una COPIA di js/mail-respinte-lettura.js: la lettura di
// un rapporto di mancata consegna si prova con `node --test`, senza Gmail.
// @ts-ignore modulo JS senza tipi
import { falliti, oggettiCandidati, oggettoOriginale, numeroVerbale } from './mail-respinte-lettura.js'

const SCOPE_GMAIL_RO = 'https://www.googleapis.com/auth/gmail.readonly'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mail-respinte',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'
const APP_TECNICI = 'https://formedilpadovacpt.github.io/gestionale-visite/?vista=dashboard'
const GIORNI_INDIETRO = 7          /* il giro è quotidiano: sette giorni coprono un fermo lungo */
const MAX_MESSAGGI = 60
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const dataIt = (iso?: string | null) => {
  if (!iso) return ''
  const [a, m, g] = String(iso).slice(0, 10).split('-')
  return g ? `${g}/${m}/${a}` : String(iso)
}
const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
const daB64Url = (s: string) => {
  try {
    const t = String(s).replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch { return '' }
}

type Parte = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number }; parts?: Parte[] }

/* ── che cosa si legge di un rapporto di mancata consegna ──
   Si scende nelle parti prendendo SOLO quelle piccole e di testo: il
   messaggio originale può portarsi dietro il PDF del verbale, e non
   serve a niente scaricarlo (`body.attachmentId` invece di `body.data`
   significa proprio «è un allegato», e si salta da sé). */
function raccogli(p: Parte | undefined, out: { testi: string[]; intestazioni: string[] }, liv = 0) {
  if (!p || liv > 8) return
  for (const h of p.headers || []) {
    if (/^(subject|x-original-subject)$/i.test(h.name)) out.intestazioni.push(h.value || '')
  }
  const tipo = String(p.mimeType || '').toLowerCase()
  const dato = p.body?.data
  if (dato && (tipo.startsWith('text/') || tipo === 'message/delivery-status' || tipo === 'message/rfc822')) {
    if ((p.body?.size || 0) <= 200_000) out.testi.push(daB64Url(dato))
  }
  for (const f of p.parts || []) raccogli(f, out, liv + 1)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['mail_respinte_token', 'mail_respinte_cc'])
    const conf = Object.fromEntries((cfg || []).map((r: Record<string, string>) => [r.chiave, r.valore]))

    /* chi chiama: il giro quotidiano con la parola d'ordine, oppure la
       segreteria col suo accesso. La chiave anon non basta: sta in un
       repository pubblico (regola del 14/09). */
    const dato = req.headers.get('x-mail-respinte') || ''
    let chi = 'giro quotidiano'
    if (!(conf.mail_respinte_token && dato && dato === conf.mail_respinte_token)) {
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
    const esito: Record<string, unknown> = { chi, dryRun, esaminati: 0, nuovi: 0, avvisati: 0, errori: [] as string[], righe: [] as unknown[] }
    const err = esito.errori as string[]

    /* ── i rapporti nella casella dell'ente ── */
    const tokenRo = await getToken(sa, SCOPE_GMAIL_RO, SOGGETTO_ENTE)
    const q = `newer_than:${GIORNI_INDIETRO}d -in:sent -in:trash (from:mailer-daemon OR from:postmaster`
      + ` OR subject:"Delivery Status Notification" OR subject:"Undelivered Mail Returned to Sender"`
      + ` OR subject:"Mail delivery failed" OR subject:"Delivery has failed")`
    const lista = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX_MESSAGGI}&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${tokenRo}` } },
    ).then((r) => r.json()).catch(() => ({}))
    if (lista?.error) throw new Error('Gmail: ' + (lista.error.message || 'lettura non riuscita'))
    const ids: string[] = (lista.messages || []).map((m: { id: string }) => m.id)
    esito.esaminati = ids.length

    /* quelli già registrati non si riaprono nemmeno */
    const { data: gia } = ids.length
      ? await sb.from('s_mail_respinte').select('gmail_id').in('gmail_id', ids)
      : { data: [] }
    const visti = new Set((gia || []).map((r: { gmail_id: string }) => r.gmail_id))

    const daAvvisare: Record<string, unknown>[] = []
    for (const id of ids) {
      if (visti.has(id)) continue
      try {
        const m = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${tokenRo}` } },
        ).then((r) => r.json())
        if (m?.error) { err.push(`${id}: ${m.error.message}`); continue }

        const racc = { testi: [] as string[], intestazioni: [] as string[] }
        raccogli(m.payload, racc)
        const tutto = racc.testi.join('\n\n')
        const caduti = falliti(tutto)
        if (!caduti.length) continue          /* non era un rapporto di mancata consegna */

        const suoi = oggettiCandidati(racc.intestazioni, tutto)
        const nr = numeroVerbale(suoi, tutto)
        const oggetto = oggettoOriginale(suoi)

        let visita: Record<string, string> | null = null
        let tecnico: Record<string, string> | null = null
        if (nr) {
          const { data: v } = await sb.from('visite')
            .select('visita_id, nr_verbale, tecnico_id, impresa_id, comm_email, rl_email, csp_email, cse_email')
            .eq('nr_verbale', nr).limit(1).maybeSingle()
          visita = v || null
          if (visita?.tecnico_id) {
            const { data: t } = await sb.from('tecnici')
              .select('tecnico_id, tecnico_nome, tecnico_cognome, titolo, email')
              .eq('tecnico_id', visita.tecnico_id).maybeSingle()
            tecnico = t || null
          }
        }
        let impresa: string | null = null
        if (visita?.impresa_id) {
          const { data: i } = await sb.from('imprese').select('impresa_nome').eq('impresa_id', visita.impresa_id).maybeSingle()
          impresa = i?.impresa_nome || null
        }

        for (const c of caduti) {
          /* in quale campo del verbale stava quell'indirizzo: serve al
             tecnico per sapere che cosa andare a correggere */
          const dove: Record<string, string> = {
            comm_email: 'committente', rl_email: 'responsabile dei lavori',
            csp_email: 'CSP', cse_email: 'CSE',
          }
          let ruolo: string | null = null
          for (const [campo, etichetta] of Object.entries(dove)) {
            if (String(visita?.[campo] || '').toLowerCase().trim() === c.destinatario) { ruolo = etichetta; break }
          }
          if (!ruolo && visita) ruolo = 'impresa o altro destinatario'

          const riga = {
            gmail_id: id,
            ricevuta_il: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
            destinatario: c.destinatario,
            codice: c.codice || null,
            permanente: c.codice ? c.codice.startsWith('5') : null,
            motivo: c.motivo || null,
            oggetto_originale: oggetto ? String(oggetto).slice(0, 300) : null,
            nr_verbale: nr, visita_id: visita?.visita_id || null,
            tecnico_id: visita?.tecnico_id || null,
            tecnico_email: tecnico?.email ? String(tecnico.email).toLowerCase() : null,
            ruolo, impresa_nome: impresa,
          }
          ;(esito.righe as unknown[]).push(riga)
          if (dryRun) continue
          const { data: ins, error: eIns } = await sb.from('s_mail_respinte')
            .upsert(riga, { onConflict: 'gmail_id,destinatario', ignoreDuplicates: true })
            .select('*')
          if (eIns) { err.push(`${id} ${c.destinatario}: ${eIns.message}`); continue }
          const nuova = (ins || [])[0]
          if (!nuova) continue                /* era già registrata */
          esito.nuovi = (esito.nuovi as number) + 1
          /* ⚠️ solo i rifiuti definitivi avvisano il tecnico */
          if (nuova.permanente && nuova.tecnico_email) daAvvisare.push({ ...nuova, tecnico })
        }
      } catch (e) { err.push(`${id}: ${(e as Error).message}`) }
    }

    /* ── l'avviso al tecnico ──
       Una mail per tecnico, anche se gli indirizzi caduti sono più d'uno:
       una raffica non si legge. Niente che abbia scritto una persona. */
    if (daAvvisare.length) {
      const cc = String(conf.mail_respinte_cc || '').split(/[,;]\s*/)
        .map((s) => s.trim()).filter((s) => MAIL_RE.test(s))
      const perTecnico: Record<string, Record<string, unknown>[]> = {}
      for (const r of daAvvisare) {
        const k = String(r.tecnico_email)
        ;(perTecnico[k] = perTecnico[k] || []).push(r)
      }
      const logo = await caricaLogo()
      let token = ''
      for (const [email, righe] of Object.entries(perTecnico)) {
        const t = righe[0].tecnico as Record<string, string> | undefined
        const nome = t ? [t.titolo, t.tecnico_nome, t.tecnico_cognome].filter(Boolean).join(' ') : ''
        const una = righe.length === 1
        const elenco = righe.map((r) => `- ${r.destinatario}`
          + `${r.ruolo ? ` (${r.ruolo})` : ''}`
          + `${r.nr_verbale ? ` — verbale ${r.nr_verbale}` : ''}`
          + `${r.impresa_nome ? `, ${r.impresa_nome}` : ''}`
          + `${r.ricevuta_il ? `, respinta il ${dataIt(String(r.ricevuta_il))}` : ''}`
          + `${r.motivo ? `\n  risposta del server: ${r.motivo}` : r.codice ? `\n  codice: ${r.codice}` : ''}`).join('\n')
        const testo = [
          nome ? `Gentile ${nome},` : 'Buongiorno,',
          '',
          una
            ? "la mail con cui è stato trasmesso un verbale di sopralluogo non è arrivata a destinazione: l'indirizzo l'ha rifiutata."
            : `le mail con cui sono stati trasmessi ${righe.length} verbali di sopralluogo non sono arrivate a destinazione: gli indirizzi le hanno rifiutate.`,
          elenco,
          '',
          'È probabile che l’indirizzo sia sbagliato. Se hai modo di verificarlo, correggilo nell’anagrafica del gestionale e ritrasmetti il verbale; se invece era giusto, segnalo come risolto scrivendo che cosa hai visto.',
          '',
          '>>> Apri il gestionale visite (il riquadro è in Dashboard):',
          APP_TECNICI,
          '',
          'Questa mail è automatica: il rapporto di mancata consegna torna alla casella dell’ufficio, e da lì non lo vedrebbe nessun altro.',
          '',
          'Cordiali saluti.',
        ].filter((r, i, a) => !(r === '' && a[i - 1] === '')).join('\n')
        const oggetto = oggettoUfficio(una
          ? `Verbale non consegnato - ${righe[0].nr_verbale || 'indirizzo respinto'} - alla c.a. ${nome || email}`
          : `${righe.length} verbali non consegnati - alla c.a. ${nome || email}`)
        const ids2 = righe.map((r) => r.id as number)
        try {
          let html = paginaHtml(corpoInHtml(testo))
          if (!logo.ok) {
            html = html.replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.@]/g, '\\$&')}[^>]*>`), '')
          }
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
          await sb.from('s_mail_respinte').update({
            stato: 'avvisato', avviso_il: new Date().toISOString(),
            avviso_a: [email, ...cc].join(', '), avviso_esito: logo.ok ? 'inviato' : `inviato (senza logo: ${logo.motivo})`,
          }).in('id', ids2)
          esito.avvisati = (esito.avvisati as number) + ids2.length
        } catch (e) {
          const msg = (e as Error).message
          await sb.from('s_mail_respinte').update({ avviso_esito: `non inviato: ${msg}`.slice(0, 500) }).in('id', ids2)
          err.push(`avviso a ${email}: ${msg}`)
        }
      }
    }

    return json({ ok: !err.length, ...esito })
  } catch (e) {
    console.error('mail-respinte:', e)
    return json({ error: (e as Error).message }, 500)
  }
})
