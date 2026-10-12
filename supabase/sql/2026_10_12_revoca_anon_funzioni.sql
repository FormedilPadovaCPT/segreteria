-- (12/10/2026) Il test settimanale del database (tests-db/03 e 21, «nessuna funzione di public eseguibile
-- da anon») era rosso: Supabase concede EXECUTE ad anon a ogni funzione nuova, e sei ne erano rimaste
-- aperte. Tre sono i trigger delle notifiche alla segreteria creati oggi
-- (2026_10_12_push_risposte_alla_segreteria.sql), tre vengono dai lavori del 07/10 (lotti del cantiere,
-- assegnazione degli incarichi, storia di s_config). Stesso rimedio del 04/10: revoke from public, anon.
-- etichetta_con_lotto resta eseguibile dagli autenticati: la chiamano altre funzioni del gestionale.
revoke execute on function public.push_aut_decisa() from public, anon;
revoke execute on function public.push_mandato_amministrazione() from public, anon;
revoke execute on function public.push_incarico_risposta() from public, anon;
revoke execute on function public.tg_incarichi_su_assegnazione() from public, anon;
revoke execute on function public.tg_s_config_storia() from public, anon;
revoke execute on function public.etichetta_con_lotto(text, text, text, text) from public, anon;
