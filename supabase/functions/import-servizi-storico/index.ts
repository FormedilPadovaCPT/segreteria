// Supabase Edge Function – import-servizi-storico
// Carica in s_servizi_storico l'archivio della tabella Access
// VisiteCassaEdile (registro richieste/servizi 2011-2026).
// Idempotente: on conflict (id) do nothing.
//
// Import UNA TANTUM eseguito il 31/08/2026 (1.078 righe). Copiata nel repo il
// 05/09/2026 prima di cancellarla da Supabase: se un giorno servisse di nuovo,
// si ridistribuisce da qui e si crea il token in s_config.import_storico_token.
//
// Scrive SOLO se l'intestazione X-Import-Token combacia con
// s_config.import_storico_token (token usa-e-getta, si crea prima
// del lotto e si cancella subito dopo): la chiave anon dell'app sta
// in un repository pubblico e senza questo controllo chiunque
// potrebbe scrivere nello storico.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-import-token',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: cfg } = await sb.from('s_config').select('valore')
      .eq('chiave', 'import_storico_token').maybeSingle()
    const atteso = (cfg?.valore || '').trim()
    const dato = (req.headers.get('x-import-token') || '').trim()
    if (!atteso || !dato || atteso !== dato) {
      return new Response(JSON.stringify({ error: 'token mancante o non valido' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...CORS } })
    }
    const righe = await req.json()
    if (!Array.isArray(righe)) throw new Error('atteso un array JSON di record')
    const { error, count } = await sb.from('s_servizi_storico')
      .upsert(righe, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' })
    if (error) throw new Error(error.message)
    return new Response(JSON.stringify({ ok: true, ricevute: righe.length, scritte: count }),
      { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('import-servizi-storico:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
