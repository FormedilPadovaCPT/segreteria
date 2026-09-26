-- ============================================================
-- Sicurezza, 26/09/2026 (sera) — advisor «Signed-In Users Can Execute
-- SECURITY DEFINER Function» (lint 0029), 120 voci sul Gestionale.
-- Report: manutenzione/sicurezza/check_2026-09-26.md, sezione serale.
--
-- Delle 120 funzioni segnalate, 111 sono chiamate dalle app dopo il login
-- e hanno il controllo di ruolo DENTRO il corpo (is_segreteria,
-- is_coordinatore, is_personale, a_is_*, s_unioni_autorizzato…): devono
-- restare chiamabili da authenticated, l'avviso resta e si accetta.
-- Le 9 qui sotto invece non le chiama nessuna app: le chiamano solo
-- trigger o altre funzioni SECURITY DEFINER, che girano come postgres
-- e non hanno bisogno del permesso di authenticated.
-- ============================================================

-- E. Funzioni trigger SECURITY DEFINER. Il permesso EXECUTE si controlla
--    quando si CREA il trigger, non quando scatta: s_protocollo_audit_trg
--    non ha il grant ad authenticated dal 25/08 e ha scritto 22 righe di
--    audit negli ultimi 3 giorni. Il 26/09 mattina il blocco B aveva dato
--    il grant ad authenticated per errore di prudenza: si toglie.
revoke execute on function public.a_tg_giornate_proietta()    from authenticated;
revoke execute on function public.a_tg_pratica_cristallizza() from authenticated;
revoke execute on function public.a_tg_stato_da_figlia()      from authenticated;
revoke execute on function public.s_decisioni_tg()            from authenticated;
revoke execute on function public.s_decisioni_eventi_tg()     from authenticated;

-- F. Funzioni interne, chiamate solo da funzioni SECURITY DEFINER
--    (verificato su pg_proc e con grep sui quattro repo, 26/09/2026):
--    a_giornate_proietta  <- a_tg_giornate_proietta (trigger, secdef)
--    a_stato_ricalcola    <- a_tg_stato_da_figlia    (trigger, secdef)
--    dtest_codice_nuovo   <- dtest_invita            (secdef, is_segreteria)
--    test_valutazione_iscritto <- test_convalida     (secdef, segreteria/coordinatore)
--    Le prime due SCRIVONO su a_pratica senza controllo di ruolo: chiuse
--    non le può più lanciare un utente loggato qualunque.
revoke execute on function public.a_giornate_proietta(uuid)             from authenticated;
revoke execute on function public.a_stato_ricalcola(uuid)               from authenticated;
revoke execute on function public.dtest_codice_nuovo(bigint)            from authenticated;
revoke execute on function public.test_valutazione_iscritto(bigint)     from authenticated;

-- NON si tocca sesso_da_nome: la chiama persone_completa_anagrafica,
-- trigger SECURITY INVOKER, che gira con i permessi di chi inserisce.
-- Restano chiamabili e senza controllo di ruolo, ma innocue (dati di
-- riferimento, nessuna scrittura): comune_cap_prov (imprese.js),
-- formazione_programmazione_stato (home.js), formazione_proposte
-- (send-verbale con il token dell'utente), sesso_da_nome.

-- ANNULLA (se servisse):
-- grant execute on function public.a_tg_giornate_proietta(), public.a_tg_pratica_cristallizza(),
--   public.a_tg_stato_da_figlia(), public.s_decisioni_tg(), public.s_decisioni_eventi_tg(),
--   public.a_giornate_proietta(uuid), public.a_stato_ricalcola(uuid),
--   public.dtest_codice_nuovo(bigint), public.test_valutazione_iscritto(bigint) to authenticated;
