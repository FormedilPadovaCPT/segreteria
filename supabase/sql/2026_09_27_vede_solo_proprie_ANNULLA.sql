-- Per tornare indietro dalla fase E (27/09/2026).
drop policy if exists visite_solo_proprie on public.visite;
drop policy if exists visite_checklist_solo_proprie on public.visite_checklist;
drop policy if exists visite_foto_solo_proprie on public.visite_foto;
drop policy if exists visite_imprese_presenti_solo_proprie on public.visite_imprese_presenti;
drop policy if exists visite_lavorazioni_solo_proprie on public.visite_lavorazioni;
drop policy if exists visite_snapshot_solo_proprie on public.visite_snapshot;
drop policy if exists verbali_solo_proprie on public.verbali;
-- le funzioni dash_*, visite_count_map e impresa_previsita: rimettere le versioni
-- precedenti (senza la CTE «vis») prima di togliere le funzioni qui sotto
drop function if exists public.tecnico_imposta_visibilita(text, boolean);
drop function if exists public.visita_permessa(text, text, text);
alter table public.tecnici drop column if exists vede_solo_proprie;
