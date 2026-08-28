// Supabase Edge Function – send-protocollo
// Le due mail che partono da un protocollo.
//
// ⚠️ DI NORMA NON SPEDISCE: prepara il messaggio e lo restituisce come
// .eml con «X-Unsent: 1», che Outlook apre nella finestra di
// composizione, allegato compreso. Si sceglie l'account e si preme
// Invia a mano. È quel che faceva la macro Access, che finiva con
// .Display e non con .Send — e lo stesso confine del timbro: la roba
// che esce dall'ufficio la manda una persona.
//   azione: 'bozza' (predefinito) → torna il .eml
//   azione: 'invia'               → spedisce davvero, via Gmail API
//
//   modo: 'avviso'   → al MITTENTE, per dirgli che la sua comunicazione
//                      è stata protocollata. Testo ripreso dalla vecchia
//                      maschera Access «Protocollo in ENTRATA».
//   modo: 'inoltra'  → a chi in ufficio deve vederlo (il Direttore, il
//                      coordinatore, altri), col documento allegato, il
//                      corpo della mail ricevuta e il testo aggiunto.
//
// ⚠️ L'allegato si legge da GOOGLE DRIVE (drive_file_id), non dal bucket
// Supabase: i documenti del protocollo non stanno più lì.
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON
// Scope della delega: gmail.send + drive
// (drive PIENO e non drive.readonly: la delega di dominio autorizza
//  stringhe esatte, e quella configurata per allegati-ass e' `drive`.
//  Chiedere un ambito non delegato fa fallire il token.)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// La casella che il service account impersona: l'invio diretto puo'
// partire solo da qui, altrimenti Gmail lo rifiuta.
const MITTENTE = 'cptpd@did.formedilpadova.it'
// L'indirizzo ISTITUZIONALE con cui l'ente scrive, e l'account
// configurato in Outlook: e' quello che va sulla bozza.
const MITTENTE_UFFICIALE = 'cpt@formedilpadova.it'

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
function wrap(b64: string, w = 76): string {
  const out: string[] = []
  for (let i = 0; i < b64.length; i += w) out.push(b64.slice(i, i + w))
  return out.join('\r\n')
}
const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dataIt = (iso?: string | null) => {
  if (!iso) return ''
  const [a, m, g] = String(iso).slice(0, 10).split('-')
  return g ? `${g}/${m}/${a}` : String(iso)
}
const codiceDi = (p: Record<string, unknown>) => (p.codice as string)
  || (p.esercizio ? `Prot_${p.esercizio}_${String(p.numero).padStart(4, '0')}` : `${p.numero}`)

/* ── il piede istituzionale, uguale a quello della maschera Access ── */
const PIEDE = `
<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000">
  LA SEGRETERIA<br>AREA SICUREZZA E SALUTE<br>Renato Squizzato<br>
  <i style="font-size:11px">Tel. 049-761168 int.4</i>
</p>
<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#4D6582;line-height:1.55">
  <b>FORMEDIL PADOVA</b><br>
  ENTE UNICO PER LA FORMAZIONE E LA SICUREZZA PER IL SETTORE DELL'EDILIZIA ED AFFINI DELLA PROVINCIA DI PADOVA<br>
  <i>Via Basilicata, 10 — 35127 Padova (PD)<br>
  Tel. +39 049761168<br>
  <a href="mailto:cpt@formedilpadova.it" style="color:#4D6582">cpt@formedilpadova.it</a></i>
</p>
<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#4D6582;line-height:1.6">
  <b>Orari uff. AREA SICUREZZA E SALUTE</b><br>
  <i style="color:#8E8E9C">
  Lunedì dalle 09:00 alle 13:00 e dalle 14:00 alle 16:00<br>
  Martedì dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00<br>
  Mercoledì dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00<br>
  Giovedì dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00</i>
</p>
<p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#2A2A2E;line-height:1.5;font-style:italic">
  NOTE SULLA PRIVACY ai sensi del Regolamento europeo sulla Protezione dei dati personali n. 679/2016 («GDPR»).
  Ai sensi degli artt. 13 e 14 Le comunichiamo che il Suo indirizzo si trova nella mailing list di FORMEDIL PADOVA.
  Sperando che le nostre comunicazioni siano gradite, Le assicuriamo che i Suoi dati saranno trattati con estrema
  riservatezza, senza essere divulgati in alcun modo. Ha il diritto di richiedere la modifica o la cancellazione dei
  Suoi dati inviando richiesta a cpt@formedilpadova.it; riceverà una mail di conferma cancellazione.
</p>`

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
function htmlInoltra(p: Record<string, unknown>, messaggio: string, allegatoNome: string): string {
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

    ${p.note ? `<p style="font-size:12.5px;color:#6b7280;margin:0 0 4px">Testo della comunicazione ricevuta:</p>
      <p style="font-size:12.5px;line-height:1.6;background:#f7f8fa;padding:10px 14px;margin:0 0 16px;white-space:pre-line">${esc(p.note)}</p>` : ''}
    ${allegatoNome ? `<p style="font-size:13px;color:#6b7280;margin:0 0 8px">In allegato: <b>${esc(allegatoNome)}</b></p>` : ''}
    ${p.drive_url ? `<p style="font-size:13px;margin:0 0 8px"><a href="${esc(p.drive_url)}" style="color:#e7500f">Apri il documento nell'archivio</a></p>` : ''}
    ${PIEDE}
  </td></tr>
</table></td></tr></table></body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    const sa = JSON.parse(SA_JSON)

    const { protocolloId, modo, azione, to, cc, oggetto, messaggio, driveFileId } = await req.json()
    if (!protocolloId) throw new Error('protocolloId mancante')
    const quale = modo === 'avviso' ? 'avviso' : 'inoltra'
    const bozza = azione !== 'invia'
    const toList: string[] = Array.isArray(to) ? to : (to ? [to] : [])
    if (!toList.length) throw new Error('Nessun destinatario')

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: p, error } = await sb.from('s_protocollo').select('*').eq('id', protocolloId).single()
    if (error || !p) throw new Error('Protocollo non trovato: ' + (error?.message || ''))

    /* allegato: da Drive, non dal bucket */
    let allegatoB64 = ''
    let allegatoNome = ''
    let allegatoMime = 'application/pdf'
    if (driveFileId) {
      const tokDrive = await getToken(sa, 'https://www.googleapis.com/auth/drive')
      const meta = await (await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=name,mimeType`,
        { headers: { Authorization: `Bearer ${tokDrive}` } })).json()
      if (meta.error) throw new Error('Allegato non leggibile su Drive: ' + JSON.stringify(meta.error))
      allegatoNome = meta.name || 'documento.pdf'
      allegatoMime = meta.mimeType || 'application/pdf'
      const bin = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
        { headers: { Authorization: `Bearer ${tokDrive}` } })
      if (!bin.ok) throw new Error('Allegato non scaricabile: ' + (await bin.text()).slice(0, 200))
      allegatoB64 = uint8ToBase64(new Uint8Array(await bin.arrayBuffer()))
    }

    const cod = codiceDi(p)
    const soggetto = oggetto || (quale === 'avviso'
      ? `FORMEDIL PADOVA -AREA SICUREZZA E SALUTE- Notifica avvenuta registrazione protocollo - Prot. ${cod} del ${dataIt(p.data_prot)}`
      : `FORMEDIL PADOVA -AREA SICUREZZA E SALUTE- Prot. ${cod} del ${dataIt(p.data_prot)} - ${p.oggetto || ''}`)

    const html = quale === 'avviso'
      ? htmlAvviso(p, messaggio || '')
      : htmlInoltra(p, messaggio || '', allegatoNome)

    const boundary = `----=_P_${Date.now()}`
    const da = bozza ? MITTENTE_UFFICIALE : MITTENTE
    const parti = [
      'MIME-Version: 1.0',
      // e' questa riga che fa aprire il file come bozza, non come
      // messaggio ricevuto
      ...(bozza ? ['X-Unsent: 1'] : []),
      `From: Formedil Padova - Area Sicurezza e Salute <${da}>`,
      `To: ${toList.join(', ')}`,
      ...(cc?.length ? [`Cc: ${(Array.isArray(cc) ? cc : [cc]).join(', ')}`] : []),
      `Subject: =?UTF-8?B?${toB64Url(utf8ToBase64(soggetto))}?=`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(utf8ToBase64(html)),
      '',
    ]
    if (allegatoB64) {
      parti.push(
        `--${boundary}`,
        `Content-Type: ${allegatoMime}`,
        `Content-Disposition: attachment; filename="${allegatoNome}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap(allegatoB64),
        '',
      )
    }
    parti.push(`--${boundary}--`)

    const mime = parti.join('\r\n')

    /* La strada normale: non si spedisce, si consegna il messaggio
       pronto. Outlook lo apre in composizione, con l'allegato gia'
       dentro; l'account e il momento dell'invio li sceglie chi manda. */
    if (bozza) {
      const nomeFile = `Prot_${cod}_${quale}.eml`.replace(/[\\/:*?"<>|]/g, '-')
      return new Response(JSON.stringify({
        ok: true, bozza: true, eml: utf8ToBase64(mime), nomeFile,
        da, a: toList.join(', '), oggetto: soggetto,
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

    /* Si segna solo l'avviso al mittente: e' quello che «chiude» il
       protocollo verso l'esterno. Gli inoltri interni sono un'altra cosa
       e non devono far credere che il mittente sia stato avvisato. */
    if (quale === 'avviso') {
      await sb.from('s_protocollo').update({
        mail_inviata_at: new Date().toISOString(),
        mail_destinatari: toList.join(', '),
      }).eq('id', protocolloId)
    }

    return new Response(JSON.stringify({ ok: true, messageId: out.id, modo: quale }),
      { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('send-protocollo:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } })
  }
})
