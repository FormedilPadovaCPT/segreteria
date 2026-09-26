-- ============================================================
-- Per tornare indietro da 2026_09_26_rls_initplan.sql: il testo delle
-- 23 policy com'era il 26/09/2026 prima della modifica (letto da
-- pg_policies subito prima di applicarla). Non va eseguito salvo
-- problemi.
-- ============================================================
alter policy prenot_update on planning.prenotazioni using ((planning.is_attivo() AND ((prenotato_da = auth.uid()) OR (referente_id = auth.uid()) OR (planning.current_ruolo() = ANY (ARRAY['direttore'::text, 'admin'::text, 'coordinatore'::text]))))) with check (((tipo <> 'sindacale'::text) OR (NOT (aula_id IN ( SELECT aule.id    FROM planning.aule   WHERE (aule.codice = 'AM'::text)))) OR (planning.current_ruolo() = ANY (ARRAY['direttore'::text, 'admin'::text]))));
alter policy utenti_self_update on planning.utenti using ((id = auth.uid())) with check (((id = auth.uid()) AND (ruolo = planning.current_ruolo())));
alter policy a_ruolo_self_read on public.a_ruolo_asseveratore using (((lower(email) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text))) OR ( SELECT a_is_coordinator() AS a_is_coordinator)));
alter policy appunti_propri_delete on public.appunti_cantiere using ((autore = auth.uid()));
alter policy appunti_propri_insert on public.appunti_cantiere with check (((autore = auth.uid()) AND is_personale()));
alter policy appunti_propri_select on public.appunti_cantiere using ((autore = auth.uid()));
alter policy appunti_propri_update on public.appunti_cantiere using ((autore = auth.uid())) with check ((autore = auth.uid()));
alter policy appunti_foto_delete on public.appunti_cantiere_foto using ((autore = auth.uid()));
alter policy appunti_foto_insert on public.appunti_cantiere_foto with check (((autore = auth.uid()) AND (EXISTS ( SELECT 1    FROM appunti_cantiere a   WHERE ((a.id = appunti_cantiere_foto.appunto_id) AND (a.autore = auth.uid()))))));
alter policy appunti_foto_select on public.appunti_cantiere_foto using ((autore = auth.uid()));
alter policy avvisi_sel on public.avvisi using (((COALESCE(array_length(destinatari, 1), 0) = 0) OR (( SELECT (auth.jwt() ->> 'email'::text)) = ANY (destinatari)) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore)));
alter policy letture_ins on public.avvisi_letture with check ((email = ( SELECT (auth.jwt() ->> 'email'::text))));
alter policy letture_sel on public.avvisi_letture using (((email = ( SELECT (auth.jwt() ->> 'email'::text))) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore)));
alter policy letture_upd on public.avvisi_letture using ((email = ( SELECT (auth.jwt() ->> 'email'::text))));
alter policy incarichi_sel on public.incarichi using ((is_gestione_incarichi() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text)))));
alter policy incarichi_upd on public.incarichi using ((is_gestione_incarichi() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text))))) with check ((is_gestione_incarichi() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text)))));
alter policy push_iscrizioni_sel on public.push_iscrizioni using (((lower(email) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text))) OR ( SELECT is_segreteria() AS is_segreteria)));
alter policy s_cantieri_critici_sel on public.s_cantieri_critici using (((segnalato_da = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text))) OR ( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore) OR ( SELECT is_direttore() AS is_direttore) OR ( SELECT is_presidenza() AS is_presidenza)));
alter policy s_cantieri_critici_eventi_sel on public.s_cantieri_critici_eventi using ((( SELECT is_segreteria() AS is_segreteria) OR ( SELECT is_coordinatore() AS is_coordinatore) OR ( SELECT is_direttore() AS is_direttore) OR ( SELECT is_presidenza() AS is_presidenza) OR (visibile_tecnico AND (EXISTS ( SELECT 1    FROM s_cantieri_critici c   WHERE ((c.id = s_cantieri_critici_eventi.critico_id) AND (c.segnalato_da = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text)))))))));
alter policy s_mail_respinte_sel on public.s_mail_respinte using ((is_segreteria() OR is_coordinatore() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));
alter policy s_mail_respinte_upd on public.s_mail_respinte using ((is_segreteria() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))))) with check ((is_segreteria() OR (lower(COALESCE(tecnico_email, ''::text)) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));
alter policy segn_upd on public.segnalazioni_cantiere using (((( SELECT (auth.jwt() ->> 'email'::text)) = segnalata_da) OR ( SELECT is_segreteria() AS is_segreteria))) with check (((( SELECT (auth.jwt() ->> 'email'::text)) = segnalata_da) OR ( SELECT is_segreteria() AS is_segreteria)));
alter policy auth_update_tecnici on public.tecnici using ((( SELECT is_segreteria() AS is_segreteria) OR ( SELECT a_is_office_or_coordinator() AS a_is_office_or_coordinator) OR (lower(COALESCE(email, ''::text)) = lower(COALESCE(( SELECT (auth.jwt() ->> 'email'::text)), ''::text)))));
