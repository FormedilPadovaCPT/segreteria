-- ============================================================
-- Per tornare indietro da 2026_09_26_integrita_collegamenti.sql.
-- Non va eseguito salvo problemi. Toglie le 31 chiavi esterne, la colonna
-- visite.incarico_id col suo trigger, e i 64 indici creati quel giorno
-- (riconosciuti confrontandoli con archivio.bk_2026_09_26_indici_prima).
-- ============================================================
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass tab, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.conname in (
       'incarichi_impresa_id_fkey','imprese_ateco_impresa_id_fkey','s_attestazioni_dm132_impresa_id_fkey',
       's_conferenze_cantiere_impresa_id_fkey','s_consulenze_impresa_id_fkey','s_corsi_impresa_id_fkey',
       's_corsi_iscritti_impresa_id_fkey','s_formazione_segnalazioni_impresa_id_fkey','s_nomine_impresa_id_fkey',
       's_notifiche_cantiere_impresa_id_fkey','s_protocollo_impresa_id_fkey','s_rls_anagrafe_impresa_id_fkey',
       's_rlst_pratiche_impresa_id_fkey','s_segnalazioni_impresa_id_fkey','s_visite_richieste_impresa_id_fkey',
       's_attestazioni_dm132_persona_id_fkey','s_conferenze_cantiere_persona_id_fkey','s_consulenze_persona_id_fkey',
       's_rls_anagrafe_persona_id_fkey','s_rlst_pratiche_persona_id_fkey','s_visite_richieste_persona_id_fkey',
       's_notifiche_cantiere_cantiere_id_fkey','s_segnalazioni_cantiere_id_fkey',
       's_conferenze_cantiere_incarico_id_fkey','s_consulenze_incarico_id_fkey','s_segnalazioni_incarico_id_fkey',
       's_visite_richieste_incarico_id_fkey','s_formazione_segnalazioni_visita_id_fkey','s_mail_respinte_visita_id_fkey',
       's_posta_proposte_protocollo_id_fkey','visite_incarico_id_fkey')
  loop
    execute format('alter table %s drop constraint %I', r.tab, r.conname);
  end loop;
end $$;

drop trigger if exists trg_visite_incarico_id on public.visite;
drop function if exists public.tg_visite_incarico_id();
alter table public.visite drop column if exists incarico_id;

do $$
declare r record;
begin
  for r in
    select i.schemaname, i.indexname from pg_indexes i
     where i.schemaname in ('public','planning') and i.indexname like 'ix\_%'
       and not exists (select 1 from archivio.bk_2026_09_26_indici_prima b
                        where b.schemaname = i.schemaname and b.indexname = i.indexname)
  loop
    execute format('drop index if exists %I.%I', r.schemaname, r.indexname);
  end loop;
end $$;
