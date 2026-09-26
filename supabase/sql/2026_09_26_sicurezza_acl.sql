-- ============================================================
-- Sicurezza, 26/09/2026 — chiusura degli avvisi dell'advisor Supabase
-- (report manutenzione/sicurezza/check_2026-09-26.md).
--
-- Nessuna di queste funzioni fa uscire dati a chi non è entrato
-- (provato come anon: 0 righe, oppure «Non autorizzato»). Si chiude
-- l'ACL perché la protezione non deve stare in una riga sola di codice.
-- Il permesso arriva dal grant implicito a PUBLIC E da un grant
-- esplicito ad anon: vanno tolti tutti e due.
-- ============================================================

-- A. Rubrica e contatti riservati (commit 5b6d302 del 25/09)
revoke execute on function public.rubrica_imprese_cerca(text, integer)               from public, anon;
revoke execute on function public.rubrica_persone_cerca(text, integer)               from public, anon;
revoke execute on function public.rubrica_impresa_dettaglio(text)                    from public, anon;
revoke execute on function public.rubrica_persona_dettaglio(uuid)                    from public, anon;
revoke execute on function public.s_imposta_contatti_riservati_impresa(text, text[]) from public, anon;
grant  execute on function public.rubrica_imprese_cerca(text, integer)               to authenticated, service_role;
grant  execute on function public.rubrica_persone_cerca(text, integer)               to authenticated, service_role;
grant  execute on function public.rubrica_impresa_dettaglio(text)                    to authenticated, service_role;
grant  execute on function public.rubrica_persona_dettaglio(uuid)                    to authenticated, service_role;
grant  execute on function public.s_imposta_contatti_riservati_impresa(text, text[]) to authenticated, service_role;

-- B. Funzioni trigger aperte a PUBLIC. Il permesso EXECUTE si controlla
--    quando si crea il trigger, non quando scatta: chiuderle non ferma
--    niente (pi_touch e s_protocollo_audit_trg sono già così e lavorano).
revoke execute on function public.s_decisioni_tg()               from public, anon;
revoke execute on function public.s_decisioni_eventi_tg()        from public, anon;
revoke execute on function public.voe_tg()                       from public, anon;
revoke execute on function public.s_formazione_segnalazioni_tg() from public, anon;
revoke execute on function public.appunti_cantiere_aggiornato()  from public, anon;
grant  execute on function public.s_decisioni_tg()               to authenticated, service_role;
grant  execute on function public.s_decisioni_eventi_tg()        to authenticated, service_role;
grant  execute on function public.voe_tg()                       to authenticated, service_role;
grant  execute on function public.s_formazione_segnalazioni_tg() to authenticated, service_role;
grant  execute on function public.appunti_cantiere_aggiornato()  to authenticated, service_role;

-- C. search_path fisso: i due corpi usano solo auth.jwt() (qualificato) e now()
alter function public.voe_tg()                       set search_path = public;
alter function public.s_formazione_segnalazioni_tg() set search_path = public;

-- D. Bucket social-media: la regola SELECT permetteva di ELENCARE i file.
--    Per aprire un'immagine col suo link pubblico non serve (bucket
--    pubblico); caricamento e cancellazione li fa redazione-social con la
--    chiave di servizio, che non passa dalle policy.
drop policy if exists "social_media_lettura_pubblica" on storage.objects;

-- Controllo dopo l'applicazione: nessuna riga deve avere «=X/» o «anon=X/»
-- select p.proname, array_to_string(p.proacl,' | ') from pg_proc p
-- where p.pronamespace = 'public'::regnamespace and p.proname in
-- ('rubrica_imprese_cerca','rubrica_persone_cerca','rubrica_impresa_dettaglio','rubrica_persona_dettaglio',
--  's_imposta_contatti_riservati_impresa','s_decisioni_tg','s_decisioni_eventi_tg','voe_tg',
--  's_formazione_segnalazioni_tg','appunti_cantiere_aggiornato');
