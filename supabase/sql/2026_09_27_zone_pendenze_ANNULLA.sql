-- Per tornare indietro dalla fase C (27/09/2026). Toglie i passaggi di pratica:
-- le pratiche aperte tornano a chi ha fatto l'ultima visita. Lo spostamento dei
-- comuni in zone_aree_comuni NON si annulla da qui (è storia: si sposta di nuovo).
drop function if exists public.pendenze_da_assegnare();
drop function if exists public.pendenza_assegna(text, text, text);
drop function if exists public.zone_passa_area(integer, text);
drop function if exists public.zone_sposta(text, smallint, integer);
drop function if exists public.zone_anteprima_sposta(text, smallint, integer);
drop function if exists public.zone_chiudi_riga_comune(bigint);
drop function if exists public.zone_tecnici_area(integer);
-- ricontrolli_pendenti: rimettere la versione di 2026_09_08_ricontrolli_pendenti_allineata.sql PRIMA di togliere la vista
drop function if exists public.pendenze_aperte_dettaglio();
drop view if exists public.v_pendenze_titolari;
drop table if exists public.pendenze_riassegnate;
