-- Annulla 2026_09_28_sola_consultazione_fase1.sql
do $$
declare t text;
begin
  foreach t in array array[
    'persone', 'ceiv_lista', 'imprese_cassa_storico', 'committenti',
    'cantiere_imprese_previste', 'imprese_ateco', 'imprese_certificazioni',
    'visite_checklist', 'visite_foto', 'visite_snapshot', 'visite_lavorazioni',
    'zone_aree', 'zone_aree_comuni', 'zone_aree_tecnici',
    'dedup_esclusioni', 'target_visite_mensili', 's_tariffe', 'app_ruoli'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_sola_consultazione', t);
  end loop;
end $$;
drop policy if exists firme_tecnici_sola_consultazione on storage.objects;
drop function if exists public.sola_consultazione();
