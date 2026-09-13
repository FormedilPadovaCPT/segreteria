// Supabase Edge Function – import-rlst — RITIRATA il 13/09/2026.
//
// Leggeva ogni mattina (pg_cron import-rlst-mattina) le schede del foglio Google
// dei servizi CPT e importava le righe nuove in s_rlst_pratiche, s_rls_anagrafe,
// s_segnalazioni, s_consulenze, s_visite_richieste, s_notifiche_cantiere,
// s_conferenze_cantiere e s_attestazioni_dm132, con la pre-istruttoria (CEIV,
// persona per CF, tecnico di zona). Nell'app segreteria c'era anche il bottone
// «Importa adesso dal foglio».
//
// Dal 13/09/2026 i moduli del portale arrivano alla cassetta delle lettere sul
// progetto Supabase Servizi e la funzione portale-richieste crea la pratica
// subito, con la stessa pre-istruttoria. Foglio Google e Apps Script sono stati
// spenti su decisione dell'utente, dopo un ultimo import (13/09/2026, 09:42 UTC);
// job e bottoni tolti.
// Risponde 410. Il codice completo e' nella storia del repository segreteria-app
// (ultimo commit con la versione completa: b3a67b9).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(JSON.stringify({ error: 'import dal foglio ritirato: le richieste del portale arrivano dalla cassetta delle lettere' }), {
    status: 410, headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
