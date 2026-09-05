-- 05/09/2026 - Audit: policy permissive doppie (159 rilievi multiple_permissive_policies).
-- Una policy ALL piu' una SELECT sulla stessa tabella vengono valutate entrambe a ogni lettura:
-- la ALL si spezza in insert/update/delete, resta una sola SELECT, ruolo authenticated invece di public.
-- Applicato a lotti di una tabella via execute_sql.

-- a_allegato: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_allegato_write on public.a_allegato;
alter policy a_allegato_view on public.a_allegato to authenticated using (((select public.a_is_office_or_coordinator()) or (pratica_id is not null and public.is_assigned_to_pratica(pratica_id))));
create policy a_allegato_ins on public.a_allegato for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or (pratica_id is not null and public.is_assigned_to_pratica(pratica_id))));
create policy a_allegato_upd on public.a_allegato for update to authenticated using (((select public.a_is_office_or_coordinator()) or (pratica_id is not null and public.is_assigned_to_pratica(pratica_id)))) with check (((select public.a_is_office_or_coordinator()) or (pratica_id is not null and public.is_assigned_to_pratica(pratica_id))));
create policy a_allegato_del on public.a_allegato for delete to authenticated using (((select public.a_is_office_or_coordinator()) or (pratica_id is not null and public.is_assigned_to_pratica(pratica_id))));

-- a_allegato_mog_nota: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_allegato_mog_nota_write on public.a_allegato_mog_nota;
alter policy a_allegato_mog_nota_view on public.a_allegato_mog_nota to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_allegato_mog_nota_ins on public.a_allegato_mog_nota for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_allegato_mog_nota_upd on public.a_allegato_mog_nota for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_allegato_mog_nota_del on public.a_allegato_mog_nota for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_appunto: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_appunto_write on public.a_appunto;
alter policy a_appunto_view on public.a_appunto to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_appunto_ins on public.a_appunto for insert to authenticated with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_appunto_upd on public.a_appunto for update to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_appunto_del on public.a_appunto for delete to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_attrezzatura: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_attrezzatura_write on public.a_attrezzatura;
alter policy a_attrezzatura_view on public.a_attrezzatura to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_attrezzatura_ins on public.a_attrezzatura for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_attrezzatura_upd on public.a_attrezzatura for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_attrezzatura_del on public.a_attrezzatura for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_check_item: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_item_write on public.a_check_item;
alter policy a_item_read on public.a_check_item to authenticated using ((select public.a_is_asseveratore()));
create policy a_item_ins on public.a_check_item for insert to authenticated with check ((select public.a_is_coordinator()));
create policy a_item_upd on public.a_check_item for update to authenticated using ((select public.a_is_coordinator())) with check ((select public.a_is_coordinator()));
create policy a_item_del on public.a_check_item for delete to authenticated using ((select public.a_is_coordinator()));

-- a_check_risposta: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_risposta_write on public.a_check_risposta;
alter policy a_risposta_view on public.a_check_risposta to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_risposta_ins on public.a_check_risposta for insert to authenticated with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_risposta_upd on public.a_check_risposta for update to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_risposta_del on public.a_check_risposta for delete to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_check_sezione: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_sezione_write on public.a_check_sezione;
alter policy a_sezione_read on public.a_check_sezione to authenticated using ((select public.a_is_asseveratore()));
create policy a_sezione_ins on public.a_check_sezione for insert to authenticated with check ((select public.a_is_coordinator()));
create policy a_sezione_upd on public.a_check_sezione for update to authenticated using ((select public.a_is_coordinator())) with check ((select public.a_is_coordinator()));
create policy a_sezione_del on public.a_check_sezione for delete to authenticated using ((select public.a_is_coordinator()));

-- a_check_voce_libera: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_voce_libera_write on public.a_check_voce_libera;
alter policy a_voce_libera_view on public.a_check_voce_libera to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_voce_libera_ins on public.a_check_voce_libera for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_voce_libera_upd on public.a_check_voce_libera for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_voce_libera_del on public.a_check_voce_libera for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_checklist: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_checklist_write on public.a_checklist;
alter policy a_checklist_read on public.a_checklist to authenticated using ((select public.a_is_asseveratore()));
create policy a_checklist_ins on public.a_checklist for insert to authenticated with check ((select public.a_is_coordinator()));
create policy a_checklist_upd on public.a_checklist for update to authenticated using ((select public.a_is_coordinator())) with check ((select public.a_is_coordinator()));
create policy a_checklist_del on public.a_checklist for delete to authenticated using ((select public.a_is_coordinator()));

-- a_delibera_cptc: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_delibera_write on public.a_delibera_cptc;
alter policy a_delibera_view on public.a_delibera_cptc to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_delibera_ins on public.a_delibera_cptc for insert to authenticated with check ((select public.a_is_office_or_coordinator()));
create policy a_delibera_upd on public.a_delibera_cptc for update to authenticated using ((select public.a_is_office_or_coordinator())) with check ((select public.a_is_office_or_coordinator()));
create policy a_delibera_del on public.a_delibera_cptc for delete to authenticated using ((select public.a_is_office_or_coordinator()));

-- a_figura_sistema: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_figura_sistema_write on public.a_figura_sistema;
alter policy a_figura_sistema_view on public.a_figura_sistema to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_figura_sistema_ins on public.a_figura_sistema for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_figura_sistema_upd on public.a_figura_sistema for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_figura_sistema_del on public.a_figura_sistema for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_formazione: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_formazione_write on public.a_formazione;
alter policy a_formazione_view on public.a_formazione to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_formazione_ins on public.a_formazione for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_formazione_upd on public.a_formazione for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_formazione_del on public.a_formazione for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_impresa_dati: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_impresa_dati_write on public.a_impresa_dati;
alter policy a_impresa_dati_read on public.a_impresa_dati to authenticated using ((select public.a_is_asseveratore()));
create policy a_impresa_dati_ins on public.a_impresa_dati for insert to authenticated with check ((select public.a_is_office_or_coordinator()));
create policy a_impresa_dati_upd on public.a_impresa_dati for update to authenticated using ((select public.a_is_office_or_coordinator())) with check ((select public.a_is_office_or_coordinator()));
create policy a_impresa_dati_del on public.a_impresa_dati for delete to authenticated using ((select public.a_is_office_or_coordinator()));

-- a_infortunio: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_infortunio_write on public.a_infortunio;
alter policy a_infortunio_view on public.a_infortunio to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_infortunio_ins on public.a_infortunio for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_infortunio_upd on public.a_infortunio for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_infortunio_del on public.a_infortunio for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_intervista: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_intervista_write on public.a_intervista;
alter policy a_intervista_view on public.a_intervista to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_intervista_ins on public.a_intervista for insert to authenticated with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_intervista_upd on public.a_intervista for update to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_intervista_del on public.a_intervista for delete to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_non_conformita: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_nc_write on public.a_non_conformita;
alter policy a_nc_view on public.a_non_conformita to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_nc_ins on public.a_non_conformita for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_nc_upd on public.a_non_conformita for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_nc_del on public.a_non_conformita for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_parere_motivato: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_parere_write on public.a_parere_motivato;
alter policy a_parere_view on public.a_parere_motivato to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_parere_ins on public.a_parere_motivato for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_parere_upd on public.a_parere_motivato for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_parere_del on public.a_parere_motivato for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_preventivo_voce: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_prev_voce_write on public.a_preventivo_voce;
alter policy a_prev_voce_view on public.a_preventivo_voce to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_prev_voce_ins on public.a_preventivo_voce for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_prev_voce_upd on public.a_preventivo_voce for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_prev_voce_del on public.a_preventivo_voce for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));

-- a_rdv_presenza: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_rdv_presenza_write on public.a_rdv_presenza;
alter policy a_rdv_presenza_view on public.a_rdv_presenza to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_rdv_presenza_ins on public.a_rdv_presenza for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_presenza_upd on public.a_rdv_presenza for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_presenza_del on public.a_rdv_presenza for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_rdv_requisito: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_rdv_req_write on public.a_rdv_requisito;
alter policy a_rdv_req_view on public.a_rdv_requisito to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_rdv_req_ins on public.a_rdv_requisito for insert to authenticated with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_req_upd on public.a_rdv_requisito for update to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_req_del on public.a_rdv_requisito for delete to authenticated using (((select public.a_is_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_rdv_rilievo: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_rdv_rilievo_write on public.a_rdv_rilievo;
alter policy a_rdv_rilievo_view on public.a_rdv_rilievo to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_rdv_rilievo_ins on public.a_rdv_rilievo for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_rilievo_upd on public.a_rdv_rilievo for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_rdv_rilievo_del on public.a_rdv_rilievo for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_sede: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_sede_write on public.a_sede;
alter policy a_sede_view on public.a_sede to authenticated using (((select public.a_is_office_or_coordinator()) or public.is_assigned_to_pratica(pratica_id)));
create policy a_sede_ins on public.a_sede for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_sede_upd on public.a_sede for update to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id))) with check (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));
create policy a_sede_del on public.a_sede for delete to authenticated using (((select public.a_is_office_or_coordinator()) or public.a_is_tecnico_pratica(pratica_id)));

-- a_seduta_cptc: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_seduta_write on public.a_seduta_cptc;
alter policy a_seduta_view on public.a_seduta_cptc to authenticated using ((select public.a_is_asseveratore()));
create policy a_seduta_ins on public.a_seduta_cptc for insert to authenticated with check ((select public.a_is_office_or_coordinator()));
create policy a_seduta_upd on public.a_seduta_cptc for update to authenticated using ((select public.a_is_office_or_coordinator())) with check ((select public.a_is_office_or_coordinator()));
create policy a_seduta_del on public.a_seduta_cptc for delete to authenticated using ((select public.a_is_office_or_coordinator()));

-- a_cantiere: la policy ALL si spezza in insert/update/delete (non si somma piu' alla SELECT), solo authenticated
drop policy if exists a_cantiere_write on public.a_cantiere;
alter policy a_cantiere_view on public.a_cantiere to authenticated using (((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = a_cantiere.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario or (select public.a_my_tecnico_id()) = p.osservatore))));
create policy a_cantiere_ins on public.a_cantiere for insert to authenticated with check (((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = a_cantiere.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario))));
create policy a_cantiere_upd on public.a_cantiere for update to authenticated using (((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = a_cantiere.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario)))) with check (((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = a_cantiere.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario))));
create policy a_cantiere_del on public.a_cantiere for delete to authenticated using (((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = a_cantiere.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario))));

-- a_ruolo_asseveratore
drop policy if exists a_ruolo_admin_write on public.a_ruolo_asseveratore;
alter policy a_ruolo_self_read on public.a_ruolo_asseveratore to authenticated using (lower(email) = lower(coalesce((select auth.jwt()->>'email'),'')) or (select public.a_is_coordinator()));
create policy a_ruolo_ins on public.a_ruolo_asseveratore for insert to authenticated with check ((select public.a_is_coordinator()));
create policy a_ruolo_upd on public.a_ruolo_asseveratore for update to authenticated using ((select public.a_is_coordinator())) with check ((select public.a_is_coordinator()));
create policy a_ruolo_del on public.a_ruolo_asseveratore for delete to authenticated using ((select public.a_is_coordinator()));

-- s_fatture_tecnici: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_fatt_all on public.s_fatture_tecnici;
drop policy if exists tec_fatt_sel on public.s_fatture_tecnici;
create policy s_fatture_tecnici_sel on public.s_fatture_tecnici for select to authenticated using ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()) or (select public.is_coordinatore()) or (select public.is_direttore()));
create policy s_fatture_tecnici_ins on public.s_fatture_tecnici for insert to authenticated with check ((select public.is_segreteria()));
create policy s_fatture_tecnici_upd on public.s_fatture_tecnici for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_fatture_tecnici_del on public.s_fatture_tecnici for delete to authenticated using ((select public.is_segreteria()));

-- s_incarichi_mensili: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_incm_all on public.s_incarichi_mensili;
drop policy if exists tec_incm_sel on public.s_incarichi_mensili;
create policy s_incarichi_mensili_sel on public.s_incarichi_mensili for select to authenticated using ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()) or (select public.is_coordinatore()) or (select public.is_direttore()));
create policy s_incarichi_mensili_ins on public.s_incarichi_mensili for insert to authenticated with check ((select public.is_segreteria()));
create policy s_incarichi_mensili_upd on public.s_incarichi_mensili for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_incarichi_mensili_del on public.s_incarichi_mensili for delete to authenticated using ((select public.is_segreteria()));

-- s_mandati_pagamento: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_mandati_all on public.s_mandati_pagamento;
drop policy if exists dir_mandati_sel on public.s_mandati_pagamento;
create policy s_mandati_pagamento_sel on public.s_mandati_pagamento for select to authenticated using ((select public.is_segreteria()) or (select public.is_coordinatore()) or (select public.is_direttore()));
create policy s_mandati_pagamento_ins on public.s_mandati_pagamento for insert to authenticated with check ((select public.is_segreteria()));
create policy s_mandati_pagamento_upd on public.s_mandati_pagamento for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_mandati_pagamento_del on public.s_mandati_pagamento for delete to authenticated using ((select public.is_segreteria()));

-- s_prestazioni: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_prest_all on public.s_prestazioni;
drop policy if exists tec_prest_sel on public.s_prestazioni;
create policy s_prestazioni_sel on public.s_prestazioni for select to authenticated using ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()) or (select public.is_coordinatore()) or (select public.is_direttore()));
create policy s_prestazioni_ins on public.s_prestazioni for insert to authenticated with check ((select public.is_segreteria()));
create policy s_prestazioni_upd on public.s_prestazioni for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_prestazioni_del on public.s_prestazioni for delete to authenticated using ((select public.is_segreteria()));

-- s_tecnici_fiscale: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_fiscale_all on public.s_tecnici_fiscale;
drop policy if exists tec_fiscale_sel on public.s_tecnici_fiscale;
create policy s_tecnici_fiscale_sel on public.s_tecnici_fiscale for select to authenticated using ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()) or (select public.is_coordinatore()));
create policy s_tecnici_fiscale_ins on public.s_tecnici_fiscale for insert to authenticated with check ((select public.is_segreteria()));
create policy s_tecnici_fiscale_upd on public.s_tecnici_fiscale for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_tecnici_fiscale_del on public.s_tecnici_fiscale for delete to authenticated using ((select public.is_segreteria()));

-- s_tariffe: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists sgr_tariffe_all on public.s_tariffe;
create policy s_tariffe_ins on public.s_tariffe for insert to authenticated with check ((select public.is_segreteria()));
create policy s_tariffe_upd on public.s_tariffe for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_tariffe_del on public.s_tariffe for delete to authenticated using ((select public.is_segreteria()));

-- s_oggetto: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists s_oggetto_all on public.s_oggetto;
create policy s_oggetto_ins on public.s_oggetto for insert to authenticated with check ((select public.is_segreteria()));
create policy s_oggetto_upd on public.s_oggetto for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_oggetto_del on public.s_oggetto for delete to authenticated using ((select public.is_segreteria()));

-- s_tipo_richiesta: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists s_tipo_richiesta_all on public.s_tipo_richiesta;
create policy s_tipo_richiesta_ins on public.s_tipo_richiesta for insert to authenticated with check ((select public.is_segreteria()));
create policy s_tipo_richiesta_upd on public.s_tipo_richiesta for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_tipo_richiesta_del on public.s_tipo_richiesta for delete to authenticated using ((select public.is_segreteria()));

-- s_tipologia_richiesta: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists s_tipologia_richiesta_all on public.s_tipologia_richiesta;
create policy s_tipologia_richiesta_ins on public.s_tipologia_richiesta for insert to authenticated with check ((select public.is_segreteria()));
create policy s_tipologia_richiesta_upd on public.s_tipologia_richiesta for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy s_tipologia_richiesta_del on public.s_tipologia_richiesta for delete to authenticated using ((select public.is_segreteria()));

-- imprese_ateco: ALL della segreteria spezzata in ins/upd/del; una sola SELECT
drop policy if exists imprese_ateco_seg on public.imprese_ateco;
create policy imprese_ateco_ins on public.imprese_ateco for insert to authenticated with check ((select public.is_segreteria()));
create policy imprese_ateco_upd on public.imprese_ateco for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy imprese_ateco_del on public.imprese_ateco for delete to authenticated using ((select public.is_segreteria()));

-- persone_imprese: pi_write (ALL) spezzata in ins/upd/del
drop policy if exists pi_write on public.persone_imprese;
create policy pi_ins on public.persone_imprese for insert to authenticated with check ((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = persone_imprese.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario)));
create policy pi_upd on public.persone_imprese for update to authenticated using ((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = persone_imprese.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario))) with check ((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = persone_imprese.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario)));
create policy pi_del on public.persone_imprese for delete to authenticated using ((select public.a_is_office_or_coordinator()) or exists (select 1 from public.a_pratica p where p.impresa_id = persone_imprese.impresa_id and ((select public.a_my_tecnico_id()) = p.tecnico_principale or (select public.a_my_tecnico_id()) = p.tecnico_secondario)));

-- s_visite_stage: una policy per comando, segreteria + tecnico sulla propria
drop policy if exists sgr_vstage_all on public.s_visite_stage;
drop policy if exists tec_vstage_sel on public.s_visite_stage;
drop policy if exists tec_vstage_ins on public.s_visite_stage;
drop policy if exists tec_vstage_upd on public.s_visite_stage;
create policy vstage_sel on public.s_visite_stage for select to authenticated using ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()) or (select public.is_coordinatore()) or (select public.is_direttore()));
create policy vstage_ins on public.s_visite_stage for insert to authenticated with check ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()));
create policy vstage_upd on public.s_visite_stage for update to authenticated using ((select public.is_segreteria()) or (tecnico_id = (select public.s_mio_tecnico_id()) and not exists (select 1 from public.s_prestazioni p where p.visita_stage_id = s_visite_stage.id and p.fattura_id is not null))) with check ((select public.is_segreteria()) or tecnico_id = (select public.s_mio_tecnico_id()));
create policy vstage_del on public.s_visite_stage for delete to authenticated using ((select public.is_segreteria()));

-- visite_snapshot: le tre policy ridondanti con auth_all_visite_snapshot
drop policy if exists auth_insert_visite_snapshot on public.visite_snapshot;
drop policy if exists auth_update_visite_snapshot on public.visite_snapshot;
drop policy if exists auth_select_visite_snapshot on public.visite_snapshot;
