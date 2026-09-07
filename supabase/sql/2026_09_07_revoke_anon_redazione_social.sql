-- 07/09/2026 - Il test 03_rls_personale (workflow «Test database») ha trovato
-- due funzioni di public eseguibili da anon, nate con la migrazione
-- redazione_social_s_post del 06/09:
--
--   s_redazione_materia(int) - security definer, restituisce oggetti e sintesi
--     dei protocolli, corsi e campagne: con la chiave anon (che sta in un
--     repository pubblico) era chiamabile da chiunque via PostgREST.
--   s_post_touch() - funzione di trigger, non va chiamata da nessuno.
--
-- Perche' era sfuggita: la migrazione revocava solo `from public`, ma Supabase
-- concede EXECUTE ad anon anche per DEFAULT PRIVILEGES, e quel grant esplicito
-- resta. Va revocato `from public, anon`, come nella migrazione
-- revoke_anon_funzioni_residue_2026_09_05.
--
-- La routine cloud non ne risente: l'edge function redazione-social chiama
-- s_redazione_materia con il service role, non con anon.
--
-- Applicato al database il 07/09/2026 alle 10:08 UTC come migrazione
-- 20260907100810_revoke_anon_funzioni_redazione_social_2026_09_07.

revoke execute on function public.s_redazione_materia(int) from public, anon;
revoke execute on function public.s_post_touch() from public, anon;

grant execute on function public.s_redazione_materia(int) to authenticated, service_role;
grant execute on function public.s_post_touch() to service_role;
