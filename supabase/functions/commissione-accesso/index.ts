// Supabase Edge Function – commissione-accesso
// «CREA L'ACCESSO» DELLA PAGINA COMMISSIONE SICUREZZA (09/11/2026, chiesto dall'utente)
//
// La segreteria apre l'accesso al gestionale a un membro della Commissione Sicurezza
// NOMINATO in s_nomine (ruolo «Commissione Sicurezza», nomina attiva). Prima lo faceva
// l'utente a mano dal pannello di Supabase (procedura del 28/09/2026): una pagina web non
// può creare utenti, serve la chiave d'amministrazione, che sta solo qui sul server.
//
// POST { nomina_id, subentro?: boolean }   con l'accesso della segreteria (verify_jwt)
//   → { ok: true, email, nome, carica, evento }
//   → { ok: false, messaggio, chiede_conferma? }
//
// Paletti:
//   · solo la segreteria (is_segreteria sul token di chi chiama, e di nuovo nel database);
//   · solo nominati attivi della Commissione, solo accessi di sola lettura (ruolo viewer):
//     indirizzo, nome, carica e codice fiscale li legge il database dalla nomina e
//     dall'anagrafica, non li manda la pagina;
//   · password provvisoria = codice fiscale in maiuscolo (decisione dell'utente del
//     28/09/2026), con il cambio obbligatorio al primo accesso (app_cambio_password);
//     la password non torna mai alla pagina;
//   · se l'indirizzo di ruolo era di un'altra persona (passaggio di consegne) serve la
//     conferma esplicita: la password del vecchio titolare smette di valere;
//   · ogni apertura resta in s_commissione_eventi.
// Nessuna mail parte da qui: il benvenuto lo prepara la pagina come protocollo in uscita,
// e lo manda una persona.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

/* il carattere di controllo del codice fiscale (persone fisiche) */
const DISPARI: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20,
  O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}
export function cfValido(cf: string): boolean {
  const s = String(cf || '').toUpperCase()
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false
  let somma = 0
  for (let i = 0; i < 15; i++) {
    const c = s[i]
    if (i % 2 === 0) somma += DISPARI[c]
    else somma += /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65
  }
  return String.fromCharCode(65 + (somma % 26)) === s[15]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, messaggio: 'solo POST' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const auth = req.headers.get('Authorization') || ''
  const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: u, error: eu } = await utente.auth.getUser()
  if (eu || !u?.user?.email) return json({ ok: false, messaggio: 'Serve l\'accesso della segreteria' }, 401)
  const { data: segr, error: es } = await utente.rpc('is_segreteria')
  if (es) return json({ ok: false, messaggio: 'Non sono riuscito a verificare chi sei: ' + es.message }, 500)
  if (segr !== true) return json({ ok: false, messaggio: 'Gli accessi della Commissione li apre la segreteria' }, 403)
  const da = u.user.email.toLowerCase()

  const corpo = await req.json().catch(() => ({}))
  const nomina = Number(corpo?.nomina_id)
  if (!Number.isInteger(nomina) || nomina <= 0) return json({ ok: false, messaggio: 'Manca la nomina' }, 400)
  const conferma = corpo?.subentro === true

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p, error: ep } = await admin.rpc('s_commissione_accesso_prepara', { p_nomina: nomina, p_da: da })
  if (ep) return json({ ok: false, messaggio: ep.message }, 409)
  if (!cfValido(p.cf)) return json({ ok: false, messaggio: `Il codice fiscale di ${p.nome} nell'anagrafica non torna (carattere di controllo): correggilo nella scheda persona prima di aprire l'accesso.` }, 409)
  if (p.situazione === 'subentro' && !conferma) {
    return json({ ok: false, chiede_conferma: true,
      messaggio: `L'indirizzo ${p.email} era di ${p.nome_precedente || 'un\'altra persona'}. Passandolo a ${p.nome}, la password di prima smette di valere e ${p.nome} entra con la sua password provvisoria.` }, 409)
  }

  const password = String(p.cf).toUpperCase()
  let userId: string = p.user_id
  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, ban_duration: 'none' })
    if (error) return json({ ok: false, messaggio: 'Account non aggiornato: ' + error.message }, 500)
  } else {
    const { data: c, error } = await admin.auth.admin.createUser({ email: p.email, password, email_confirm: true })
    if (error || !c?.user?.id) return json({ ok: false, messaggio: 'Account non creato: ' + (error?.message || 'risposta vuota') }, 500)
    userId = c.user.id
  }
  const evento = p.situazione === 'nuovo' ? 'accesso_creato' : p.situazione === 'subentro' ? 'subentro' : 'accesso_riaperto'
  const { error: er } = await admin.rpc('s_commissione_accesso_registra', { p_nomina: nomina, p_user_id: userId, p_da: da, p_evento: evento })
  if (er) return json({ ok: false, messaggio: `Account pronto, ma il ruolo nell'app non è stato registrato: ${er.message}. Riprova: la seconda volta riapre lo stesso account.` }, 500)
  return json({ ok: true, email: p.email, nome: p.nome, carica: p.carica, evento })
})
