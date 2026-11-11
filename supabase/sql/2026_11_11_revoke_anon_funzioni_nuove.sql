-- 11/11/2026 — Test del database del 09/11 rosso (03_rls_personale e 21_pgtap_rete_di_sicurezza):
-- sei funzioni nate fra il 06 e il 09/11 erano eseguibili con la chiave pubblica (anon),
-- perché Supabase concede EXECUTE ad anon a ogni funzione nuova e le migrazioni non lo toglievano.
-- Tutte hanno già il loro controllo interno (is_segreteria) o sono trigger: si toglie solo
-- a PUBLIC e ad anon, authenticated e service_role restano come sono.
revoke execute on function public.s_commissione_carica(text)            from public, anon;
revoke execute on function public.s_commissione_situazione()           from public, anon;
revoke execute on function public.s_commissione_chiudi(text, text)     from public, anon;
revoke execute on function public.s_commissione_aggiorna_carica(integer) from public, anon;
revoke execute on function public.s_post_regola()                      from public, anon;   -- trigger dei post
revoke execute on function public.tg_cip_no_truncate()                 from public, anon;   -- trigger del gestionale (imprese previste)
-- Per i due trigger basta service_role (regola del 07/09/2026): tolto anche ad authenticated.
-- Provato: un aggiornamento di s_post fatto dalla segreteria fa scattare s_post_regola lo stesso.
revoke execute on function public.s_post_regola()      from authenticated;
revoke execute on function public.tg_cip_no_truncate() from authenticated;
