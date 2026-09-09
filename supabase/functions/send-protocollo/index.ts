// Supabase Edge Function – send-protocollo
// Le mail che partono da un protocollo.
//
// ⚠️ DI NORMA NON SPEDISCE: prepara il messaggio e lo restituisce come
// .eml con «X-Unsent: 1», che Outlook apre nella finestra di
// composizione, allegato compreso. Si sceglie l'account e si preme
// Invia a mano. È quel che faceva la macro Access, che finiva con
// .Display e non con .Send — e lo stesso confine del timbro: la roba
// che esce dall'ufficio la manda una persona.
//   azione: 'bozza' (predefinito) → torna il .eml per Outlook
//   azione: 'bozza-gmail'         → crea la BOZZA nella casella Gmail
//                                   cptpd@did.formedilpadova.it (dal
//                                   09/09/2026 indirizzo istituzionale a
//                                   tutti gli effetti, Reply-To cpt@):
//                                   si apre da Gmail, si ritocca e si
//                                   invia a mano. Non parte niente.
//   azione: 'invia'               → spedisce davvero, via Gmail API.
//                                   L'app NON la usa (scelta dell'utente
//                                   09/09/2026): resta per un uso futuro.
//
//   modo: 'avviso'       → al MITTENTE di un protocollo in ENTRATA, per
//                          dirgli che la sua comunicazione è stata
//                          protocollata. Testo ripreso dalla vecchia
//                          maschera Access «Protocollo in ENTRATA».
//   modo: 'inoltra'      → a chi in ufficio deve vederlo (il Direttore,
//                          il coordinatore, altri), col documento
//                          allegato, il corpo della mail ricevuta e il
//                          testo aggiunto.
//   modo: 'protocollato' → in USCITA: il documento protocollato va
//                          all'impresa e alle persone indicate, con la
//                          «stampa del protocollo» in testa (numero,
//                          data, ufficio — la tabellina della macro
//                          Access «Protocollo in USCITA»), il testo
//                          della comunicazione, gli allegati scelti e
//                          la firma dell'ufficio in piede.
//
// ⚠️ Gli allegati si leggono da GOOGLE DRIVE (drive_file_id), non dal
// bucket Supabase: i documenti del protocollo non stanno più lì.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON
// Scope della delega: gmail.send + gmail.compose (per le bozze) + drive
// (drive PIENO e non drive.readonly: la delega di dominio autorizza
//  stringhe esatte, e quella configurata per allegati-ass e' `drive`.
//  Chiedere un ambito non delegato fa fallire il token.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
// ⚠️ firma.js e' una COPIA di js/firma.js della webapp (Deno non legge
// fuori dalla cartella della funzione al deploy). Non si modifica qui:
// `npm run firma-sync` la rigenera, e strumenti/verifica-firma.mjs
// fallisce se divergono. Da qui arrivano la firma HTML col logo (cid:)
// e la composizione MIME: una firma sola per le bozze dell'app e per le
// mail del protocollo.
// ⚠️ firma-logo.js invece NON e' una copia: qui il logo non e'
// incorporato ma si scarica dal sito e si verifica con lo SHA-256.
// Il perche' e' scritto in quel file: la stringa base64 del logo si e'
// gia' troncata una volta nel passaggio di distribuzione.
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { componiEml, firmaHtml } from './firma.js'
// @ts-ignore modulo JS condiviso con la webapp, senza tipi
import { caricaLogo } from './firma-logo.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// La casella che il service account impersona: l'invio diretto puo'
// partire solo da qui, altrimenti Gmail lo rifiuta.
const MITTENTE = 'cptpd@did.formedilpadova.it'
// L'indirizzo ISTITUZIONALE con cui l'ente scrive, e l'account
// configurato in Outlook: e' quello che va sulla bozza, e il Reply-To
// di quel che parte da Gmail.
const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'
const NOME_MITTENTE = 'Formedil Padova - Area Sicurezza e Salute'

async function getToken(sa: Record<string, string>, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const signingInput = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, sub: MITTENTE, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const binKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', binKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signingInput}.${sigB64}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Token Google non ottenuto: ' + JSON.stringify(d))
  return d.access_token
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}
const utf8ToBase64 = (s: string) => uint8ToBase64(new TextEncoder().encode(s))
const toB64Url = (b: string) => b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dataIt = (iso?: string | null) => {
  if (!iso) return ''
  const [a, m, g] = String(iso).slice(0, 10).split('-')
  return g ? `${g}/${m}/${a}` : String(iso)
}
const codiceDi = (p: Record<string, unknown>) => (p.codice as string)
  || (p.esercizio ? `Prot_${p.esercizio}_${String(p.numero).padStart(4, '0')}` : `${p.numero}`)
/* Il numero come lo si scrive a un'impresa: prima della serie unica il
   solo numero (come faceva Access: «Prot. 2533»), dopo il codice
   intero, perche' li' l'esercizio fa parte del numero. */
const numeroVisibile = (p: Record<string, unknown>) =>
  p.esercizio ? codiceDi(p) : String(p.numero)
/* «email del gg/mm/aaaa hh:mm:ss», nell'ora dell'ufficio: e' il pezzo
   dell'oggetto con cui la macro Access rendeva ogni invio univoco. */
function adessoRoma(): string {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const v = (t: string) => parti.find((x) => x.type === t)?.value || ''
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}:${v('second')}`
}

/* ── il piede: la firma dell'ufficio, la stessa delle bozze dell'app
      (fino al 03/09/2026 era una copia in testo del piede della maschera
      Access, senza logo) ── */
const PIEDE = `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>\n${firmaHtml()}`

/* ── avviso al mittente: la lettera della vecchia maschera ── */
function htmlAvviso(p: Record<string, unknown>, messaggio: string): string {
  const chi = (p.persona as string) || (p.impresa_nome as string) || ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:22px;background:#fff">
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.7;margin:0">
  Gent.le ${esc(chi)},<br>buongiorno,
</p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.7;margin:12px 0 0">
  si avvisa che la comunicazione da Lei inviataci con oggetto
  «${esc(p.oggetto)}» è stata protocollata con
  <b>n° Prot. ${esc(codiceDi(p))} del ${dataIt(p.data_prot as string)}</b>.
</p>
${messaggio ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.7;margin:12px 0 0;white-space:pre-line">${esc(messaggio)}</p>` : ''}
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:16px 0 0">Distinti saluti.</p>
${PIEDE}
</body></html>`
}

/* ── inoltro interno: scheda del protocollo + testo + mail ricevuta ── */
function htmlInoltra(p: Record<string, unknown>, messaggio: string, allegatoNomi: string[]): string {
  const riga = (et: string, v: unknown) => v
    ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${et}</td><td style="padding:4px 0">${esc(v)}</td></tr>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <tr><td style="background:#e7500f;padding:14px 24px">
    <p style="margin:0;color:#fff;font-size:11px;letter-spacing:1px;text-transform:uppercase">Formedil Padova · Area Sicurezza e Salute</p>
  </td></tr>
  <tr><td style="padding:24px 30px 20px">
    <h2 style="color:#e7500f;font-size:16px;margin:0 0 10px;border-bottom:2px solid #e7500f;padding-bottom:6px">
      Documento protocollato in ${p.direzione === 'IN' ? 'entrata' : 'uscita'}
    </h2>
    <p style="font-size:24px;font-weight:bold;color:#e7500f;margin:14px 0 2px">${esc(codiceDi(p))}</p>
    <p style="margin:0 0 16px;color:#6b7280;font-size:13px">del ${dataIt(p.data_prot as string)}</p>

    ${messaggio ? `<p style="line-height:1.7;margin:0 0 16px;white-space:pre-line;background:#fff8f4;border-left:3px solid #e7500f;padding:10px 14px">${esc(messaggio)}</p>` : ''}

    <table cellpadding="0" cellspacing="0" style="font-size:13px;margin:0 0 16px;width:100%">
      ${riga('Oggetto', p.oggetto)}
      ${riga(p.direzione === 'IN' ? 'Mittente' : 'Destinatario', p.impresa_nome || p.persona)}
      ${riga('Tipo documento', p.tipo_doc_txt)}
      ${riga('Data documento', dataIt(p.data_doc as string))}
      ${riga('Loro protocollo', p.vostro_protocollo)}
      ${riga('Mezzo', p.mezzo)}
      ${riga('Assegnato a', p.alla_ca)}
      ${riga('Cartella', p.cartella)}
    </table>

    ${p.note ? `<p style="font-size:12.5px;color:#6b7280;margin:0 0 4px">Testo della comunicazione ${p.direzione === 'IN' ? 'ricevuta' : 'spedita'}:</p>
      <p style="font-size:12.5px;line-height:1.6;background:#f7f8fa;padding:10px 14px;margin:0 0 16px;white-space:pre-line">${esc(p.note)}</p>` : ''}
    ${allegatoNomi.length ? `<p style="font-size:13px;color:#6b7280;margin:0 0 8px">In allegato: <b>${allegatoNomi.map(esc).join('</b>, <b>')}</b></p>` : ''}
    ${p.drive_url ? `<p style="font-size:13px;margin:0 0 8px"><a href="${esc(p.drive_url)}" style="color:#e7500f">Apri il documento nell'archivio</a></p>` : ''}
    ${PIEDE}
  </td></tr>
</table></td></tr></table></body></html>`
}

/* ── in uscita, all'impresa: la «stampa del protocollo» in testa, come
      la tabellina della macro Access «Protocollo in USCITA» (Protocollo
      N° / Del / Ufficio), poi il saluto, il testo della comunicazione,
      «Cordialmente» e la firma dell'ufficio ── */
function htmlProtocollato(p: Record<string, unknown>, messaggio: string): string {
  const chi = (p.persona as string) || (p.alla_ca as string) || (p.impresa_nome as string) || ''
  const th = 'padding:4px 12px;border:1px solid #9aa0a8;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#565c66;text-align:center'
  const td = 'padding:4px 12px;border:1px solid #9aa0a8;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#1f2933;text-align:center'
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:22px;background:#fff">
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
  <tr><td style="${th}">Protocollo N°</td><td style="${th}">Del</td><td style="${th}">Ufficio</td></tr>
  <tr><td style="${td};font-weight:bold;color:#e7500f">${esc(numeroVisibile(p))}</td><td style="${td}">${dataIt(p.data_prot as string)}</td><td style="${td};font-style:italic">${esc(p.ufficio || 'Segreteria Area Sicurezza e Salute')}</td></tr>
</table>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.7;margin:0">
  Gent.le ${esc(chi)},<br>buongiorno,
</p>
${messaggio ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;line-height:1.7;margin:12px 0 0;white-space:pre-line">${esc(messaggio)}</p>` : ''}
<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000;margin:16px 0 0">Cordialmente.</p>
${PIEDE}
</body></html>`
}
/* la stessa lettera in righe, per la parte text/plain */
function testoProtocollato(p: Record<string, unknown>, messaggio: string): string {
  const chi = (p.persona as string) || (p.alla_ca as string) || (p.impresa_nome as string) || ''
  return [
    `Protocollo N° ${numeroVisibile(p)}   Del ${dataIt(p.data_prot as string)}   Ufficio ${p.ufficio || 'Segreteria Area Sicurezza e Salute'}`,
    '',
    `Gent.le ${chi},`,
    'buongiorno,',
    messaggio ? '\n' + messaggio : '',
    '',
    'Cordialmente.',
  ].join('\n')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    const sa = JSON.parse(SA_JSON)

    const { protocolloId, modo, azione, to, cc, oggetto, messaggio, driveFileId, driveFileIds } = await req.json()
    if (!protocolloId) throw new Error('protocolloId mancante')
    const quale: 'avviso' | 'inoltra' | 'protocollato' =
      modo === 'avviso' ? 'avviso' : modo === 'protocollato' ? 'protocollato' : 'inoltra'
    const bozzaGmail = azione === 'bozza-gmail'
    const bozza = azione !== 'invia' && !bozzaGmail
    const toList: string[] = Array.isArray(to) ? to : (to ? [to] : [])
    if (!toList.length) throw new Error('Nessun destinatario')

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: p, error } = await sb.from('s_protocollo').select('*').eq('id', protocolloId).single()
    if (error || !p) throw new Error('Protocollo non trovato: ' + (error?.message || ''))
    if (quale === 'protocollato' && p.direzione !== 'OUT') {
      throw new Error('«Invia protocollato» vale solo per i protocolli in uscita')
    }

    /* allegati: da Drive, non dal bucket. Uno o piu' file. */
    const ids: string[] = [
      ...(Array.isArray(driveFileIds) ? driveFileIds : []),
      ...(driveFileId ? [driveFileId] : []),
    ].filter((x, i, a) => x && a.indexOf(x) === i)
    const allegati: { nome: string; byte: Uint8Array; mime: string }[] = []
    if (ids.length) {
      const tokDrive = await getToken(sa, 'https://www.googleapis.com/auth/drive')
      for (const id of ids) {
        const meta = await (await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType`,
          { headers: { Authorization: `Bearer ${tokDrive}` } })).json()
        if (meta.error) throw new Error('Allegato non leggibile su Drive: ' + JSON.stringify(meta.error))
        const bin = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
          { headers: { Authorization: `Bearer ${tokDrive}` } })
        if (!bin.ok) throw new Error('Allegato non scaricabile: ' + (await bin.text()).slice(0, 200))
        allegati.push({
          nome: meta.name || 'documento.pdf',
          mime: meta.mimeType || 'application/pdf',
          byte: new Uint8Array(await bin.arrayBuffer()),
        })
      }
    }
    const allegatoNomi = allegati.map((a) => a.nome)

    const cod = codiceDi(p)
    const soggetto = oggetto || (
      quale === 'avviso'
        ? `FORMEDIL PADOVA -AREA SICUREZZA E SALUTE- Notifica avvenuta registrazione protocollo - Prot. ${cod} del ${dataIt(p.data_prot)}`
        : quale === 'protocollato'
          /* la forma della macro Access, parola per parola: e' quella che
             imprese ed enti riconoscono da anni */
          ? `FORMEDIL Padova -AREA SICUREZZA E SALUTE- ${p.oggetto || ''} Prot. ${numeroVisibile(p)} - email del ${adessoRoma()} - alla c.a. ${p.persona || p.alla_ca || p.impresa_nome || ''}`
          : `FORMEDIL PADOVA -AREA SICUREZZA E SALUTE- Prot. ${cod} del ${dataIt(p.data_prot)} - ${p.oggetto || ''}`)

    /* Il logo arriva dal sito e si controlla con lo SHA-256 (vedi
       firma-logo.js): se non e' quello giusto si toglie l'immagine
       dalla firma, invece di allegare un'immagine rotta. */
    const logo = await caricaLogo()
    let html = quale === 'avviso'
      ? htmlAvviso(p, messaggio || '')
      : quale === 'protocollato'
        ? htmlProtocollato(p, messaggio || '')
        : htmlInoltra(p, messaggio || '', allegatoNomi)
    if (!logo.ok) {
      console.error('send-protocollo: logo non caricato —', logo.motivo)
      html = html.replace(/<img[^>]*cid:logo-formedil-padova@segreteria[^>]*>/g, '')
    }

    const da = bozza ? MITTENTE_UFFICIALE : MITTENTE
    /* «email del …» nell'oggetto e' l'ora della bozza: chi la invia dopo
       da Gmail puo' correggerla, come si correggeva in Outlook */
    /* Lo stesso compositore delle bozze dell'app: testo + HTML con logo
       inline + allegati. Con azione 'bozza' porta «X-Unsent: 1», che fa
       aprire il file in composizione e non come messaggio ricevuto. */
    const mime: string = componiEml({
      from: `${NOME_MITTENTE} <${da}>`,
      replyTo: bozza ? '' : MITTENTE_UFFICIALE,
      to: toList.join(', '),
      cc: Array.isArray(cc) ? cc : (cc ? [cc] : []),
      oggetto: soggetto,
      /* la versione in righe, per chi non legge l'HTML: la firma la
         accoda componiEml */
      corpo: quale === 'protocollato' ? testoProtocollato(p, messaggio || '') : '',
      html,
      allegati,
      unsent: bozza,
    })

    /* La bozza in Gmail: il messaggio completo, allegati e firma compresi,
       finisce nelle Bozze della casella cptpd@did. Lo scope gmail.compose
       dev'essere delegato al service account, altrimenti il token viene
       rifiutato ("unauthorized_client"). Niente mail_inviata_at: non e'
       partito niente. */
    if (bozzaGmail) {
      const rawB = toB64Url(uint8ToBase64(new TextEncoder().encode(mime)))
      let tokBozza: string
      try {
        tokBozza = await getToken(sa, 'https://www.googleapis.com/auth/gmail.compose')
      } catch (e) {
        throw new Error('Gmail non autorizza la creazione di bozze per il service account (serve lo scope gmail.compose nella delega a livello di dominio): ' + (e as Error).message)
      }
      const resB = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokBozza}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { raw: rawB } }),
      })
      const outB = await resB.json()
      if (!resB.ok || outB.error) throw new Error(outB.error?.message || JSON.stringify(outB))
      return new Response(JSON.stringify({
        ok: true, bozzaGmail: true, draftId: outB.id, messageId: outB.message?.id,
        url: `https://mail.google.com/mail/u/${MITTENTE}/#drafts/${outB.message?.id || ''}`,
        casella: MITTENTE, a: toList.join(', '), oggetto: soggetto, allegati: allegatoNomi,
        logo: logo.ok ? undefined : `senza logo: ${logo.motivo}`,
      }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    /* La strada normale: non si spedisce, si consegna il messaggio
       pronto. Outlook lo apre in composizione, con l'allegato gia'
       dentro; l'account e il momento dell'invio li sceglie chi manda. */
    if (bozza) {
      const nomeFile = `Prot_${cod}_${quale === 'protocollato' ? 'invio' : quale}.eml`.replace(/[\\/:*?"<>|]/g, '-')
      return new Response(JSON.stringify({
        ok: true, bozza: true, eml: utf8ToBase64(mime), nomeFile,
        logo: logo.ok ? undefined : `senza logo: ${logo.motivo}`,
        da, a: toList.join(', '), oggetto: soggetto, allegati: allegatoNomi,
      }), { headers: { 'Content-Type': 'application/json', ...CORS } })
    }

    const raw = toB64Url(uint8ToBase64(new TextEncoder().encode(mime)))
    const tokMail = await getToken(sa, 'https://www.googleapis.com/auth/gmail.send')
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokMail}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    })
    const out = await res.json()
    if (!res.ok || out.error) throw new Error(out.error?.message || JSON.stringify(out))

    /* Si segnano l'avviso al mittente (entrata) e l'invio del
       protocollato (uscita): sono quelli che «chiudono» il protocollo
       verso l'esterno. Gli inoltri interni sono un'altra cosa e non
       devono far credere che fuori sia arrivato qualcosa. */
    if (quale === 'avviso' || quale === 'protocollato') {
      await sb.from('s_protocollo').update({
        mail_inviata_at: new Date().toISOString(),
        mail_destinatari: toList.join(', '),
      }).eq('id', protocolloId)
    }

    return new Response(JSON.stringify({ ok: true, messageId: out.id, modo: quale, da, oggetto: soggetto, allegati: allegatoNomi }),
      { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('send-protocollo:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })
  }
})
