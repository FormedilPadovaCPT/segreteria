// Supabase Edge Function – questionari-pubblica (progetto GESTIONALE)
//
// IL QUESTIONARIO DI UN EVENTO VA SUL PORTALE (18/09/2026).
// Copia sul progetto Servizi le domande di un evento, perché la pagina del
// portale possa disegnarle a chi inquadra il QR del foglio in coda al
// registro. Stesso disegno della verifica degli attestati.
//
// Chi può chiamarla:
//   - la segreteria dall'app (quando apre il questionario o ne cambia le
//     domande), col proprio accesso;
//   - un giro pianificato, con X-Questionari-Token = s_config.questionari_token.
//
// Che cosa manda: codice, titolo, genere, data, sede, chiusura e il testo
// delle domande. Della firma parte SOLO l'impronta sha256: il segreto non
// esce da qui nemmeno in copia, e al portale basta l'impronta per
// riconoscere chi arriva col link giusto.
//
// Che cosa NON esce mai: nominativi, risposte, la firma in chiaro. Il
// progetto Servizi rifiuta comunque ogni campo non previsto.
//
// verify_jwt = false: il controllo lo fa la funzione (utente segreteria o
// parola d'ordine). Sorgente in segreteria-app/supabase/functions/questionari-pubblica/.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-questionari-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

function uguali(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

async function sha256(testo: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

type Pubblicazione = {
  codice: string; firma: string; titolo: string | null; genere: string
  quando: string | null; sede: string | null; chiuso_il: string | null
  domande: { id: number; ordine: number; testo: string; tipo: string; opzioni: unknown[]; obbligatoria: boolean; tronco: boolean }[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'solo POST' }, 405)

  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } })

    const { data: cfgRighe, error: eCfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['questionari_token', 'questionari_ricevi_url'])
    if (eCfg) throw new Error('configurazione non leggibile: ' + eCfg.message)
    const cfg = Object.fromEntries((cfgRighe ?? []).map((r) => [r.chiave, r.valore]))
    if (!cfg.questionari_token || !cfg.questionari_ricevi_url) {
      return json({ error: 'manca questionari_token o questionari_ricevi_url in s_config' }, 500)
    }

    /* chi chiama: il giro con la parola d'ordine, oppure un utente della segreteria */
    const tok = req.headers.get('X-Questionari-Token')
    let chi = 'giro'
    if (tok) {
      if (!uguali(tok, cfg.questionari_token)) return json({ error: 'accesso non autorizzato' }, 401)
    } else {
      const auth = req.headers.get('Authorization') || ''
      if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
      const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: auth } }, auth: { persistSession: false },
      })
      const { data: u } = await sbUtente.auth.getUser()
      if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
      const { data: segr, error: eSegr } = await sbUtente.rpc('is_segreteria')
      if (eSegr || segr !== true) return json({ error: 'Il questionario di un evento lo pubblica la segreteria.' }, 403)
      chi = u.user.email
    }

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>
    /* con «test_parte» gli id sono di moduli: si accettano sia parte_id sia
       le forme di sempre, cosi' chi chiama non deve ricordare due nomi */
    const corsi = corpo.parte_id != null ? [corpo.parte_id]
      : Array.isArray(corpo.parti) ? corpo.parti
      : Array.isArray(corpo.corsi) ? corpo.corsi : (corpo.corso_id != null ? [corpo.corso_id] : [])
    const ids = corsi.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50)
    if (!ids.length) return json({ error: 'manca corso_id' }, 400)

    /* tre cose diverse dallo stesso sportello: il questionario (anonimo), il
       TEST (nominativo) e le ISCRIZIONI. Del test escono le domande senza le
       risposte giuste e, delle persone, impronta del codice personale e
       iniziali; delle iscrizioni esce solo che cos'e' l'evento. */
    /* ⚠️ «test_parte» (19/09/2026): la verifica di un MODULO. Gli id qui sono
       di s_test_parti, non di corsi; la tabella di destinazione sul portale e'
       la stessa dei test (il codice della parte e' un altro, quindi
       convivono) e l'esito si scrive sulla parte. */
    const parte = corpo.cosa === 'test_parte'
    const test = corpo.cosa === 'test' || parte
    const iscr = corpo.cosa === 'iscrizione'
    const rpc = iscr ? 'iscr_pubblicazione' : parte ? 'test_pubblicazione_parte'
      : test ? 'test_pubblicazione' : 'quest_pubblicazione'
    const azione = iscr ? 'pubblica_iscr' : test ? 'pubblica_test' : 'pubblica'
    const colonne = iscr
      ? { quando: 'iscr_pubblicato_il', esito: 'iscr_pubblica_esito' }
      : test
      ? { quando: 'test_pubblicato_il', esito: 'test_pubblica_esito' }
      : { quando: 'quest_pubblicato_il', esito: 'quest_pubblica_esito' }

    const righe: Record<string, unknown>[] = []
    const saltati: { corso_id: number; motivo: string }[] = []
    for (const id of ids) {
      const { data, error } = await sb.rpc(rpc, parte ? { p_parte_id: id } : { p_corso_id: id })
      if (error) { saltati.push({ corso_id: id, motivo: error.message }); continue }
      const p = data as Pubblicazione | null
      const nome = iscr ? 'iscrizioni' : parte ? 'la verifica del modulo' : test ? 'test' : 'questionario'
      if (!p || !p.codice) { saltati.push({ corso_id: id, motivo: `${nome}: non aperta` }); continue }
      if (!p.firma) { saltati.push({ corso_id: id, motivo: 'il codice non è firmato' }); continue }
      const comune = {
        codice: p.codice,
        firma_hash: await sha256(p.firma),   // ⚠️ del segreto esce solo l'impronta
        titolo: String(p.titolo ?? 'Evento').slice(0, 300),
        quando: p.quando,
        sede: p.sede ? String(p.sede).slice(0, 200) : null,
        chiuso_il: p.chiuso_il,
        domande: p.domande ?? [],
      }
      if (iscr) {
        /* ⚠️ L'evento aperto alle iscrizioni non condivide la forma degli altri
           due: niente domande, e in più le giornate e i posti liberi. I posti
           liberi sono un numero che invecchia — chi legge il portale vede
           quelli dell'ultima pubblicazione, non quelli di adesso, e per questo
           l'app ripubblica a ogni conferma. */
        const q = p as unknown as Record<string, unknown>
        righe.push({
          codice: p.codice,
          firma_hash: await sha256(p.firma),
          titolo: String(p.titolo ?? 'Evento').slice(0, 300),
          genere: q.genere ?? null,
          descrizione: q.descrizione ?? null,
          progetto: q.progetto ?? null,
          progetto_desc: q.progetto_desc ?? null,
          ente: q.ente ?? null,
          sede: p.sede ? String(p.sede).slice(0, 300) : null,
          modalita: q.modalita ?? null,
          ore: q.ore != null ? Number(q.ore) : null,
          dal: q.dal ?? null,
          al: q.al ?? null,
          giornate: q.giornate ?? [],
          chiuso_il: p.chiuso_il,
          in_elenco: q.in_elenco === true,
          aperte: q.aperte === true,
          liberi: q.liberi != null ? Number(q.liberi) : null,
        })
      } else {
        righe.push(test
          ? { ...comune, minuti: (p as Record<string, unknown>).minuti ?? null,
              soglia: (p as Record<string, unknown>).soglia ?? null,
              persone: (p as Record<string, unknown>).persone ?? [] }
          : { ...comune, genere: p.genere })
      }
    }
    if (!righe.length) return json({ status: 'error', pubblicati: 0, saltati }, 400)

    let esito = ''
    try {
      const r = await fetch(cfg.questionari_ricevi_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Questionari-Token': cfg.questionari_token },
        body: JSON.stringify({ azione, righe }),
      })
      const testo = await r.text()
      esito = r.ok ? 'ok' : `HTTP ${r.status}: ${testo.slice(0, 300)}`
    } catch (e) {
      esito = 'rete: ' + (e instanceof Error ? e.message : String(e))
    }

    /* l'esito resta scritto sull'evento: se la copia non riesce, il
       questionario NON è raggiungibile dal portale e va saputo subito. */
    const adesso = new Date().toISOString()
    for (const id of ids) {
      if (saltati.some((s) => s.corso_id === id)) continue
      if (parte) {
        await sb.from('s_test_parti').update(esito === 'ok'
          ? { pubblicato_il: adesso, pubblica_esito: `pubblicato (${chi})` }
          : { pubblica_esito: `non pubblicato: ${esito}`.slice(0, 300) }).eq('id', id)
        continue
      }
      await sb.from('s_corsi').update(esito === 'ok'
        ? { [colonne.quando]: adesso, [colonne.esito]: `pubblicato (${chi})` }
        : { [colonne.esito]: `non pubblicato: ${esito}`.slice(0, 300) }).eq('id', id)
    }

    return json({ status: esito === 'ok' ? 'ok' : 'error', pubblicati: esito === 'ok' ? righe.length : 0, saltati, esito, chi },
      esito === 'ok' ? 200 : 502)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
