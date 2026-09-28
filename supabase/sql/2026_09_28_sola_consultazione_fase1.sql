-- ============================================================
-- Sola consultazione, fase 1 — 28/09/2026
-- Chiesto dall'utente aprendo il primo account di un consigliere: il limite
-- «vede Mappa e Statistiche» stava solo nelle schermate. Nel database chi è
-- di sola lettura poteva leggere 49 tabelle, comprese le anagrafiche di
-- persone e imprese, la lista CEIV, le check-list, le foto e le firme
-- scansionate dei tecnici.
--
-- Chi riguarda: consiglieri, Presidente e Vicepresidente (ruolo viewer).
-- NON il Direttore, che lavora dalla pagina Direzione e ha bisogno di più.
--
-- Fase 1 = si chiude tutto ciò che Mappa, Statistiche e Presidenza NON
-- leggono. Le app non cambiano. Le funzioni delle Statistiche
-- (dash_macroaree, dash_ver_visite, dash_macroaree_dettaglio) girano con i
-- diritti del proprietario e continuano a contare su tutte le check-list.
--
-- Restano APERTE, perché oggi le Statistiche si calcolano nel browser dalle
-- righe e la Mappa è una vista che gira con i diritti di chi legge:
--   visite, visite_imprese_presenti, cantieri, imprese, tecnici,
--   v_mappa_cantieri, v_master_visite.
-- tecnici_zone è una vista sulle zone: chiuse le tabelle, torna vuota da sola.
-- Si chiudono nella fase 2, quando Mappa e Statistiche per le cariche
-- passeranno da funzioni del server che restituiscono solo gli aggregati.
--
-- Per tornare indietro: 2026_09_28_sola_consultazione_fase1_ANNULLA.sql
-- ============================================================

-- chi sta leggendo è una carica di sola consultazione?
create or replace function public.sola_consultazione()
returns boolean language sql stable security definer
set search_path = public
as $$
  select public.is_viewer() and not public.is_direttore()
$$;
revoke execute on function public.sola_consultazione() from public, anon;
grant execute on function public.sola_consultazione() to authenticated, service_role;

-- ── tabelle che le schermate delle cariche non leggono mai ──
do $$
declare t text;
begin
  foreach t in array array[
    'persone', 'ceiv_lista', 'imprese_cassa_storico', 'committenti',
    'cantiere_imprese_previste', 'imprese_ateco', 'imprese_certificazioni',
    'visite_checklist', 'visite_foto', 'visite_snapshot', 'visite_lavorazioni',
    'zone_aree', 'zone_aree_comuni', 'zone_aree_tecnici',
    'dedup_esclusioni', 'target_visite_mensili', 's_tariffe'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_sola_consultazione', t);
    execute format($f$create policy %I on public.%I as restrictive for all to authenticated
      using (not (select public.sola_consultazione()))
      with check (not (select public.sola_consultazione()))$f$, t || '_sola_consultazione', t);
  end loop;
end $$;

-- ── l'elenco dei ruoli: ognuno vede la propria riga ──
drop policy if exists app_ruoli_sola_consultazione on public.app_ruoli;
create policy app_ruoli_sola_consultazione on public.app_ruoli as restrictive for all to authenticated
  using (not (select public.sola_consultazione())
         or lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', '')))
  with check (not (select public.sola_consultazione()));

-- ── le firme scansionate dei tecnici ──
drop policy if exists firme_tecnici_sola_consultazione on storage.objects;
create policy firme_tecnici_sola_consultazione on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'firme-tecnici' or not (select public.sola_consultazione()))
  with check (bucket_id <> 'firme-tecnici' or not (select public.sola_consultazione()));
