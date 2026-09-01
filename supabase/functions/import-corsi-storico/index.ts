/* ============================================================
   IMPORT UNA TANTUM dello storico corsi (Access -> Supabase).
   Eseguito il 01/09/2026: 17 progetti, 181 corsi, 270 giornate,
   470 interventi, 134 incarichi, 6.528 iscrizioni, 3.362 presenze.
   Stesso disegno di import-servizi-storico: scrive solo se il
   token corrisponde a s_config.import_corsi_token, che si crea
   prima del lotto e SI CANCELLA subito dopo (fatto). Senza token
   la funzione e' inerte.
   POST: corpo = array JSON di righe; header x-tabella; x-token.
   ============================================================ */
import { createClient } from 'npm:@supabase/supabase-js@2'

const AMMESSE = ['s_progetti_formativi', 's_corsi', 's_corsi_giornate', 's_corsi_interventi',
  's_corsi_incarichi', 's_corsi_iscritti', 's_corsi_presenze']

Deno.serve(async (req) => {
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
  try {
    if (req.method !== 'POST') return json({ error: 'POST atteso' }, 405)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = req.headers.get('x-token') || ''
    const { data: cfg } = await sb.from('s_config').select('valore').eq('chiave', 'import_corsi_token').maybeSingle()
    if (!cfg?.valore || cfg.valore !== token) return json({ error: 'token mancante o non valido' }, 403)
    const tabella = req.headers.get('x-tabella') || ''
    if (!AMMESSE.includes(tabella)) return json({ error: 'tabella non ammessa: ' + tabella }, 400)
    const righe = await req.json()
    if (!Array.isArray(righe) || !righe.length) return json({ error: 'atteso un array di righe' }, 400)
    let inserite = 0
    for (let i = 0; i < righe.length; i += 500) {
      const blocco = righe.slice(i, i + 500)
      const { error } = await sb.from(tabella).insert(blocco)
      if (error) return json({ error: error.message, dal_blocco: i, inserite }, 500)
      inserite += blocco.length
    }
    return json({ ok: true, tabella, inserite })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
