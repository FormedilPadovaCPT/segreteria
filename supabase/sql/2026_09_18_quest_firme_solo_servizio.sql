/* ============================================================================
   LE FIRME DEI LINK SONO DEL SERVIZIO, NON DEGLI UTENTI      (18/09/2026)

   Trovato applicando il questionario di evento, col controllo dei grant:
   su Supabase `revoke execute ... from public, anon` NON toglie il permesso
   che le default privileges danno ad AUTHENTICATED. Risultato: sia
   questionario_firma (questionario del sopralluogo, 18/09) sia quest_firma
   risultavano chiamabili da QUALUNQUE utente dell'app — un tecnico, per dire.
   Chi si può far firmare un codice può fabbricare link validi per visite ed
   eventi altrui, che è precisamente ciò che la firma esiste per impedire.

   È la stessa regola del 07/09/2026 («revoke from public, anon»), estesa:
   per le funzioni che sono un SEGRETO in forma di codice va revocato anche
   authenticated, e resta service_role.

   Le funzioni che le usano (questionario_link, quest_apri,
   quest_pubblicazione) sono security definer: girano come proprietario e
   continuano a funzionare senza che il chiamante abbia il permesso.

   Applicata come migrazione quest_firme_solo_servizio_2026_09_18.
   ============================================================================ */

revoke execute on function public.quest_firma(text)          from authenticated;
revoke execute on function public.quest_codice_nuovo(bigint)  from authenticated;
revoke execute on function public.questionario_firma(text)    from authenticated;

/* le due funzioni di trigger non si chiamano da PostgREST — restituiscono
   trigger — ma non devono comparire fra le funzioni esposte, che il test
   03_rls_personale conta. */
revoke execute on function public.s_quest_domande_limite() from public, anon, authenticated;
revoke execute on function public.s_quest_tronco_fermo()   from public, anon, authenticated;
grant  execute on function public.s_quest_domande_limite() to service_role;
grant  execute on function public.s_quest_tronco_fermo()   to service_role;
