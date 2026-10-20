-- ============================================================
-- IGIENE DALL'ADVISOR DI SICUREZZA (20/10/2026, confermata dall'utente;
-- dettaglio in manutenzione/sicurezza/check_2026-10-19.md e check_2026-10-20.md)
--
-- 1. fascicolo_firmato: SECURITY DEFINER aperta a PUBLIC e anon. Senza login
--    diceva se un documento è firmato, quando e con quale nome file. La usa
--    solo corso_fascicolo, che è SECURITY DEFINER e gira come proprietario:
--    toglierla ad anon non rompe niente.
-- 2. I quattro trigger trg_firme_*: aperti a PUBLIC. I trigger scattano lo
--    stesso, perché il permesso EXECUTE si controlla solo quando si crea il
--    trigger.
-- 3. search_path fissato su cinque funzioni pure di testo: usano solo
--    funzioni di sistema, quindi il risultato non cambia.
-- Il permesso arriva da PUBLIC (=X/postgres): togliere solo anon non basta.
-- ============================================================

revoke execute on function public.fascicolo_firmato(text, text) from public, anon;
grant  execute on function public.fascicolo_firmato(text, text) to authenticated, service_role;

revoke execute on function public.trg_firme_accettazione_incarico() from public, anon, authenticated;
revoke execute on function public.trg_firme_incarico_inviato()      from public, anon, authenticated;
revoke execute on function public.trg_firme_presenza_applica()      from public, anon, authenticated;
revoke execute on function public.trg_firme_presenza_doppione()     from public, anon, authenticated;

alter function archivio.chiave_nome_2026_10_01(text) set search_path = public;
alter function public.pres_decidi(date, time, time, time, time, timestamptz) set search_path = public;
alter function public.s_riaggancio_chiave(text) set search_path = public;
alter function public.decisioni_pagina(text) set search_path = public;
alter function public.decisioni_vista(text) set search_path = public;
