// Supabase Edge Function – ricezione-portale — RITIRATA il 13/09/2026.
//
// Era il SECONDO CANALE del portale servizi ai tempi di Apps Script (dal
// 04/09/2026): specchio delle richieste inviate dal portale, conferma della
// riga scritta sul foglio da parte del backend Apps Script, battito del backend.
// Lo specchio era gia' spento dalla mattina del 13/09 (revisione di sicurezza).
//
// Con la cassetta delle lettere sul progetto Supabase Servizi il portale non
// usa piu' Apps Script, e foglio Google e script sono stati spenti su decisione
// dell'utente: non c'e' piu' niente da specchiare, confermare o battere.
// Risponde 410 a tutto. Il codice originale e' nella storia del repository
// segreteria-app (ultimo commit con la versione completa: b3a67b9).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(JSON.stringify({ status: 'error', riprovabile: false, message: 'canale ritirato: il portale usa la cassetta delle lettere' }), {
    status: 410, headers: { 'Content-Type': 'application/json', ...CORS },
  })
})
