// Token OAuth2 per le API Google con il service account dell'ente
// (delega domain-wide: il token agisce come l'utente `subject`).
//
// UN SOLO POSTO per una cosa che era copiata in dieci edge function
// (audit 05/09/2026). Chi ha bisogno di Drive, Sheets o Gmail importa da qui:
//
//   import { getToken, getAccessToken } from '../_shared/google.ts'
//
// - getToken(sa, scope)   → token per lo scope chiesto (gmail.send, drive, spreadsheets…)
// - getAccessToken(sa)    → token per Drive (lo scope che usano le funzioni di archivio)
//
// `sa` e' il JSON del service account letto dal secret GOOGLE_SERVICE_ACCOUNT_JSON.

export const SOGGETTO_ENTE = 'cptpd@did.formedilpadova.it'
export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive'
export const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.send'
export const SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets.readonly'

type ServiceAccount = { client_email: string; private_key: string }

const b64url = (s: string) => btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

export async function getToken(
  sa: ServiceAccount | Record<string, string>,
  scope: string,
  subject: string = SOGGETTO_ENTE,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: sa.client_email, sub: subject, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const signingInput = `${header}.${payload}`
  const pem = String(sa.private_key)
    .replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '')
  const key = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)))
  let bin = ''
  for (let i = 0; i < sig.length; i++) bin += String.fromCharCode(sig[i])
  const jwt = `${signingInput}.${b64url(bin)}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Token Google non ottenuto: ' + JSON.stringify(d))
  return d.access_token as string
}

export function getAccessToken(sa: ServiceAccount | Record<string, string>): Promise<string> {
  return getToken(sa, SCOPE_DRIVE)
}
