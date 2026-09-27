-- ============================================================
-- Per tornare indietro dalla fase A delle zone (27/09/2026).
-- Non va eseguito salvo problemi. Rimette la tabella tecnici_zone di prima
-- (conservata in archivio) e toglie aree, storico e stradario.
-- Attenzione: le modifiche alle zone fatte DOPO il 27/09 dalla scheda della
-- segreteria andrebbero perse: in quel caso prima si confronta la vista con
-- la tabella in archivio.
-- ============================================================
drop view if exists public.tecnici_zone;
alter table archivio.bk_2026_09_27_tecnici_zone rename to tecnici_zone;
alter table archivio.tecnici_zone set schema public;

drop function if exists public.quartiere_padova(text);
drop table if exists public.stradario_padova;
drop table if exists public.zone_aree_comuni;
drop table if exists public.zone_aree_tecnici;
drop table if exists public.zone_aree;
