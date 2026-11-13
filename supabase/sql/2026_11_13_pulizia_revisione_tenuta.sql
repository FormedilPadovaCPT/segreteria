-- 13/11/2026 — APPLICATA lo stesso giorno (migrazione pulizia_revisione_tenuta_2026_11_13).
-- Pulizia dopo la revisione di tenuta (manutenzione/2026_11_13_REL_revisione-di-tenuta-database-e-app.md,
-- tabella A, voce 11). Niente viene cancellato. ⚠️ Non rieseguire il punto 1: le tabelle
-- non stanno più in public e gli «alter» darebbero errore.

-- 1. le 16 tabelle di lavoro delle correzioni di settembre-ottobre escono da public
--    (nessuna funzione, vista, chiave esterna, prova o riga di codice le usa: verificato prima)
alter table public._cant2909      set schema archivio;
alter table public._capo_piano    set schema archivio;
alter table public._ceiv2610_prep set schema archivio;
alter table public._ceiv2610_raw  set schema archivio;
alter table public._ceiv2909_agg  set schema archivio;
alter table public._ceiv2909_comm set schema archivio;
alter table public._ceiv2909_fut  set schema archivio;
alter table public._ceiv2909_imp  set schema archivio;
alter table public._ceiv2909_prep set schema archivio;
alter table public._chiusura2909  set schema archivio;
alter table public._fix0310       set schema archivio;
alter table public._fix2909       set schema archivio;
alter table public._fix2909_ipc   set schema archivio;
alter table public._nrlav_piano   set schema archivio;
alter table public._storico_imp   set schema archivio;
alter table public._storico_raw   set schema archivio;

-- 2. tre indici che ripetono esattamente un altro indice della stessa tabella.
--    L'advisor ne segnalava cinque: s_corsi_schede_tipologia e s_corsi_verbali_corso
--    NON sono doppi (hanno «versione DESC» e sono usati) e restano.
drop index if exists public.idx_snapshot_visita;      -- = visite_snapshot_visita_id_key
drop index if exists public.idx_comuni_istat_norm;    -- = comuni_istat_nome_norm_idx
drop index if exists public.idx_a_delibera_pratica;   -- = a_delibera_cptc_pratica_id_key

-- 3. indice a corredo delle 10 chiavi esterne che non ne avevano
create index if not exists idx_fk_s_corsi_promemoria_iscritto_id_fkey on public.s_corsi_promemoria (iscritto_id);
create index if not exists idx_fk_visite_covid_codice_fkey on public.visite_covid (codice);
create index if not exists idx_fk_visite_covid_imprese_impresa_id_fkey on public.visite_covid_imprese (impresa_id);
create index if not exists idx_fk_mail_correzioni_respinta_id_fkey on public.mail_correzioni (respinta_id);
create index if not exists idx_fk_aree_territorio_comuni_area_id_fkey on public.aree_territorio_comuni (area_id);
create index if not exists idx_fk_s_corsi_firme_presenza_giornata_id_fkey on public.s_corsi_firme_presenza (giornata_id);
create index if not exists idx_fk_s_corsi_fascicolo_file_firma_id_fkey on public.s_corsi_fascicolo_file (firma_id);
create index if not exists idx_fk_s_mail_risposte_verbali_questionario_id_fkey on public.s_mail_risposte_verbali (questionario_id);
create index if not exists idx_fk_chat_membri_tecnico_id_fkey on public.chat_membri (tecnico_id);
create index if not exists idx_fk_a_cantiere_scheda_cantiere_id_fkey on public.a_cantiere_scheda (cantiere_id);

-- 4. statistiche aggiornate su tutte le tabelle (30 non erano mai state analizzate)
analyze;

-- 5. registro dei giri automatici tenuto 14 giorni invece di 30 (era a 44 MB)
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'purge-cron-details'),
  command := $c$delete from cron.job_run_details where start_time < now() - interval '14 days'$c$);
