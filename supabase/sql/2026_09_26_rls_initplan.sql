-- ============================================================
-- Prestazioni, 26/09/2026 — advisor «auth_rls_initplan» (23 policy)
--
-- Stesso significato di prima, calcolato una volta per interrogazione
-- invece che per ogni riga: auth.uid(), auth.jwt() e le funzioni di
-- ruolo senza argomenti vanno dentro (select …). Il guadagno vero è su
-- incarichi e s_mail_respinte, dove is_gestione_incarichi() /
-- is_segreteria() leggevano app_ruoli riga per riga.
-- Generato dal testo esatto delle policy (regexp in SQL) e provato in
-- una transazione annullata: righe visibili identiche prima e dopo.
--
-- NON fatto, per scelta: «multiple_permissive_policies» (14 tabelle da
-- 4 a 109 righe, funzioni già dentro select): spezzare le policy ALL in
-- tre darebbe 42 policy in più per un guadagno nullo.
-- ============================================================
alter policy prenot_update on planning.prenotazioni using (((select planning.is_attivo()) AND ((prenotato_da = (select auth.uid())) OR (referente_id = (select auth.uid())) OR ((select planning.current_ruolo()) = ANY (ARRAY['direttore'::text, 'admin'::text, 'coordinatore'::text]))))) with check (((tipo <> 'sindacale'::text) OR (NOT (aula_id IN ( SELECT aule.id FROM planning.aule WHERE (aule.codice = 'AM'::text)))) OR ((select planning.current_ruolo()) = ANY (ARRAY['direttore'::text, 'admin'::text]))));
alter policy utenti_self_update on planning.utenti using ((id = (select auth.uid()))) with check (((id = (select auth.uid())) AND (ruolo = (select planning.current_ruolo()))));
alter policy a_ruolo_self_read on public.a_ruolo_asseveratore using (((lower(email) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text))) OR ( SELECT a_is_coordinator() AS a_is_coordinator)));
alter policy appunti_propri_delete on public.appunti_cantiere using ((autore = (select auth.uid())));
alter policy appunti_propri_insert on public.appunti_cantiere with check (((autore = (select auth.uid())) AND (select is_personale())));
alter policy appunti_propri_select on public.appunti_cantiere using ((autore = (select auth.uid())));
alter policy appunti_propri_update on public.appunti_cantiere using ((autore = (select auth.uid()))) with check ((autore = (select auth.uid())));
alter policy appunti_foto_delete on public.appunti_cantiere_foto using ((autore = (select auth.uid())));
alter policy appunti_foto_insert on public.appunti_cantiere_foto with check (((autore = (select auth.uid())) AND (EXISTS ( SELECT 1 FROM appunti_cantiere a WHERE ((a.id = appunti_cantiere_foto.appunto_id) AND (a.autore = (select auth.uid())))))));
alter policy appunti_foto_select on public.appunti_cantiere_foto using ((autore = (select auth.uid())));
alter policy avvisi_sel on public.avvisi using (((COALESCE(array_length(destinatari, 1), 0) = 0) OR (((select auth.jwt()) ->> 'email'::text) = ANY (destinatari)) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore)));
alter policy letture_ins on public.avvisi_letture with check ((email = ((select auth.jwt()) ->> 'email'::text)));
alter policy letture_sel on public.avvisi_letture using (((email = ((select auth.jwt()) ->> 'email'::text)) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore)));
alter policy letture_upd on public.avvisi_letture using ((email = ((select auth.jwt()) ->> 'email'::text)));
alter policy incarichi_sel on public.incarichi using (((select is_gestione_incarichi()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
alter policy incarichi_upd on public.incarichi using (((select is_gestione_incarichi()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text))))) with check (((select is_gestione_incarichi()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
alter policy push_iscrizioni_sel on public.push_iscrizioni using (((lower(email) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text))) OR ( SELECT is_segreteria() AS is_segreteria)));
alter policy s_cantieri_critici_sel on public.s_cantieri_critici using (((segnalato_da = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text))) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore) OR ( SELECT is_direttore() AS is_direttore) OR ( SELECT is_presidenza() AS is_presidenza)));
alter policy s_cantieri_critici_eventi_sel on public.s_cantieri_critici_eventi using ((( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore) OR ( SELECT is_direttore() AS is_direttore) OR ( SELECT is_presidenza() AS is_presidenza) OR (visibile_tecnico AND (EXISTS ( SELECT 1 FROM s_cantieri_critici c WHERE ((c.id = s_cantieri_critici_eventi.critico_id) AND (c.segnalato_da = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))))))));
alter policy s_mail_respinte_sel on public.s_mail_respinte using (((select is_segreteria()) OR (select is_coordinatore()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
alter policy s_mail_respinte_upd on public.s_mail_respinte using (((select is_segreteria()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text))))) with check (((select is_segreteria()) OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
alter policy segn_upd on public.segnalazioni_cantiere using (((((select auth.jwt()) ->> 'email'::text) = segnalata_da) OR ( SELECT is_segreteria() AS is_segreteria))) with check (((((select auth.jwt()) ->> 'email'::text) = segnalata_da) OR ( SELECT is_segreteria() AS is_segreteria)));
alter policy auth_update_tecnici on public.tecnici using ((( SELECT is_segreteria() AS is_segreteria) OR ( SELECT a_is_office_or_coordinator() AS a_is_office_or_coordinator) OR (lower(COALESCE(email, ''::text)) = lower(COALESCE(((select auth.jwt()) ->> 'email'::text), ''::text)))));
