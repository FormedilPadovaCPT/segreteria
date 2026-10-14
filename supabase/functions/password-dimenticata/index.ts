// Supabase Edge Function – password-dimenticata
// «PASSWORD DIMENTICATA?» DEL GESTIONALE (14/10/2026, chiesto dall'utente:
// il Presidente non riusciva a entrare per firmare, e nessuno poteva
// rimettersi una password da solo).
//
// ⚠️ QUESTA MAIL PARTE DA SOLA: è l'eccezione 10 alla regola «l'app
// prepara, la persona manda» (CLAUDE.md). Regge per lo stesso motivo delle
// altre: il testo non lo scrive nessuno, e va soltanto a chi l'ha chiesta,
// all'indirizzo del suo account.
//
// POST { email }   (senza accesso: verify_jwt false)
//   → { ok: true, messaggio }   sempre la stessa risposta, che l'indirizzo
//                               esista o no (non si rivela chi ha un account)
//   → { ok: false, messaggio }  troppe richieste, o mail non partita
//
// Come funziona: se l'indirizzo è di un account con un ruolo attivo o di un
// tecnico attivo, e non ha già chiesto tre codici nell'ultima ora
// (recupero_password_ammesso), si chiede a Supabase un codice di recupero
// con admin.generateLink — che NON manda mail: senza un SMTP proprio il
// servizio mail di Supabase consegna solo agli indirizzi del team — e il
// codice di 6 cifre parte dalla casella dell'ente con la firma d'ufficio.
// Nel gestionale l'utente scrive codice e password nuova: verifyOtp
// (type recovery) apre la sessione, updateUser cambia la password.
// Ogni richiesta resta in auth_recupero_richieste col suo esito.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (delega gmail.send)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { getToken, SOGGETTO_ENTE, SCOPE_GMAIL } from '../_shared/google.ts'
// ⚠️ firma.js è una COPIA di js/firma.js (npm run firma-sync), firma-logo.js
// è la versione che scarica il logo dal sito — come in avviso-pagamento.
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
const RISPOSTA = 'Se l\'indirizzo appartiene a un account delle app, fra poco arriva una mail con un codice di 8 cifre. Controlla anche la posta indesiderata.'
const toB64Url = (s: string) => {
  const byte = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function testoMail(codice: string) {
  return [
    'Buongiorno,',
    '',
    'è stato chiesto un codice per scegliere una nuova password per le applicazioni dell\'Area Sicurezza e Salute (gestionale visite).',
    '',
    `Il codice è:  ${codice}`,
    '',
    'Lo scriva nella pagina di accesso, sotto «Password dimenticata?», insieme alla password nuova. Il codice vale una volta sola e scade dopo poco tempo: se è scaduto, ne chieda un altro dalla stessa pagina.',
    '',
    'Se non è stato Lei a chiederlo, ignori questa mail: la Sua password resta quella di prima. Non inoltri il codice a nessuno.',
    '',
    'Cordiali saluti.',
  ].join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, messaggio: 'solo POST' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const corpo = await req.json().catch(() => ({}))
  const email = String(corpo?.email || '').trim().toLowerCase().slice(0, 200)
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 60) || null
  const registra = (esito: string) => sb.rpc('recupero_password_registra', { p_email: email, p_esito: esito, p_ip: ip })
  try {
    const { data: ammesso, error: eA } = await sb.rpc('recupero_password_ammesso', { p_email: email })
    if (eA) throw new Error('controllo non riuscito: ' + eA.message)
    if (ammesso === 'troppe') {
      await registra('troppe')
      return json({ ok: false, messaggio: 'Troppe richieste in poco tempo per questo indirizzo: riprova fra un\'ora, o chiedi alla segreteria.' })
    }
    if (ammesso !== 'ok') {
      await registra('sconosciuto')
      return json({ ok: true, messaggio: RISPOSTA })
    }
    /* il codice: Supabase lo genera e lo conserva, non manda niente */
    const { data: link, error: eL } = await sb.auth.admin.generateLink({ type: 'recovery', email })
    const prop = ((link as { properties?: Record<string, unknown> } | null)?.properties || {}) as Record<string, unknown>
    const codice = String(prop.email_otp || '')
    /* la lunghezza la decide la configurazione di Supabase (6 di norma, fino a 10): si accetta qualunque, purché cifre */
    if (eL || !/^\d{6,10}$/.test(codice)) {
      throw new Error('codice non generato: ' + (eL?.message || `risposta senza codice (campi: ${Object.keys(prop).join(', ') || 'nessuno'}; lunghezza ${codice.length})`))
    }

    const testo = testoMail(codice)
    const logo = await caricaLogo()
    /* se il logo non è arrivato, la firma esce senza immagine (stessa scelta di avviso-pagamento) */
    const html = logo.ok ? '' : paginaHtml(testoInHtml(testo))
      .replace(new RegExp(`<img[^>]*cid:${LOGO_FIRMA_CID.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^>]*>`), '')
    const mime = componiEml({
      from: `${NOME_MITTENTE} <${SOGGETTO_ENTE}>`, replyTo: MITTENTE_UFFICIALE,
      to: email, cc: [], oggetto: oggettoUfficio('Codice per scegliere una nuova password'), corpo: testo, html, unsent: false,
    })
    const sa = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}')
    const token = await getToken(sa, SCOPE_GMAIL)
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: toB64Url(mime) }),
    })
    const out = await res.json()
    if (!res.ok || out.error) throw new Error(out.error?.message || `Gmail ha risposto ${res.status}`)
    await registra(logo.ok ? 'inviato' : `inviato (senza logo: ${logo.motivo})`)
    return json({ ok: true, messaggio: RISPOSTA })
  } catch (e) {
    const msg = (e as Error).message
    console.error('password-dimenticata:', msg)
    await registra(`errore: ${msg}`.slice(0, 300))
    /* dire «non riuscito» per una cosa riuscita è recuperabile; il contrario no (regola del 04/09) */
    return json({ ok: false, messaggio: 'Non sono riuscito a mandare la mail con il codice. Riprova fra qualche minuto, o chiedi alla segreteria.' })
  }
})
