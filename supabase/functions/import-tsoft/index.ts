// Supabase Edge Function – import-tsoft (una tantum)
//
// CARICA LA TABELLA ACCESS «T_Soft» NELLA STAGING stg_tsoft.
//
// T_Soft e' il registro delle prestazioni dei tecnici viste DAL LATO PROGETTO
// finanziato: 591 righe 2022-11 → 2026-01, a ore (50-60 €/h), con il numero
// di fattura ricopiato a mano. E' il quinto «pezzettino» del Ks_Fatt, quello
// che nell'import del 4/09 non era stato censito.
//
// Perche' una funzione e non execute_sql: le note dei tecnici sono lunghe
// (relazioni di visita stage intere) e passandole a mano si alterano. Qui il
// file va dal disco al database senza intermediari, come per import-ceiv.
//
// POST con corpo JSON: un array di oggetti con le colonne di T_Soft.
// Intestazione X-Token: il valore di s_config.import_tsoft_token — la chiave
// anon dell'app sta in un repository pubblico, senza questo chiunque
// potrebbe far scrivere questa funzione. Si crea prima del lotto e si
// cancella subito dopo.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-token',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SUPA = Deno.env.get('SUPABASE_URL')
    const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPA || !SRV) throw new Error('Chiavi Supabase non disponibili nella funzione')

    const db = async (rotta: string, init?: RequestInit) => {
      const rr = await fetch(`${SUPA}/rest/v1/${rotta}`, {
        ...init,
        headers: {
          apikey: SRV, Authorization: `Bearer ${SRV}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
          ...(init?.headers || {}),
        },
      })
      const testo = await rr.text()
      if (!rr.ok) throw new Error('Database: ' + testo.slice(0, 400))
      return testo ? JSON.parse(testo) : []
    }

    const cfg = await db('s_config?chiave=eq.import_tsoft_token&select=valore', {
      headers: { Prefer: 'return=representation' },
    }) as { valore: string }[]
    if (!cfg.length) throw new Error('L\'import e\' chiuso: manca s_config.import_tsoft_token')
    if (String(req.headers.get('x-token') || '') !== cfg[0].valore) {
      throw new Error('Parola d\'ordine non valida')
    }

    const righe = await req.json()
    if (!Array.isArray(righe)) throw new Error('Serve un array di righe')

    // a lotti di 200, altrimenti la richiesta al database e' troppo grossa
    let scritte = 0
    for (let k = 0; k < righe.length; k += 200) {
      const lotto = righe.slice(k, k + 200)
      await db('stg_tsoft?on_conflict=id', {
        method: 'POST',
        body: JSON.stringify(lotto),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      })
      scritte += lotto.length
    }

    return new Response(JSON.stringify({ ok: true, scritte }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, errore: String(e.message || e) }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
