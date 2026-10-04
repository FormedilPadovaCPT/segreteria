-- ============================================================
-- Riaggancio con scelta dei dati (04/10/2026, chiesto dall'utente: «certo che
-- deve sommare i dati o si deve aprire un popup con la spunta per ogni dato
-- che si vuole tenere»). Prima il riaggancio spostava visite e collegamenti
-- e archiviava il cantiere provvisorio, ma i suoi dati non passavano mai al
-- cantiere codificato. Ora il gestionale mostra i due cantieri affiancati con
-- una spunta per ogni dato del provvisorio (già spuntati quelli che riempiono
-- un vuoto), e questa funzione fa il riaggancio e copia solo i dati spuntati.
-- Quelli non presi restano scritti nel registro s_unioni_log.
-- ============================================================

create or replace function public.s_riaggancia_cantiere(p_master text, p_dupe text, p_campi text[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ammessi text[] := array['cantiere_indirizzo','cantiere_civico','cantiere_etichetta','cantiere_cap',
    'cantiere_tip_int','cantiere_tip_ope','cantiere_tip_ope_altro','cantiere_durata','cantiere_importo',
    'cantiere_committente_id','data_ult','data_inizio_lavori','prot_int','nodo_id','cantiere_descrizione','lotto','posizione'];
  m jsonb; d jsonb; r jsonb; k text; v text; mv text;
  presi text[] := '{}'; lasciati jsonb := '[]'::jsonb; v_log bigint;
begin
  if not public.s_unioni_autorizzato() then raise exception 'Operazione consentita solo alla segreteria'; end if;
  p_campi := coalesce(p_campi, '{}');
  select k2 into k from unnest(p_campi) k2 where k2 <> all (ammessi) limit 1;
  if k is not null then raise exception 'Dato non riagganciabile: %', k; end if;
  select to_jsonb(c) into m from cantieri c where cantiere_id = p_master;
  select to_jsonb(c) into d from cantieri c where cantiere_id = p_dupe;
  if m is null or d is null then raise exception 'Cantiere inesistente'; end if;
  if nullif(btrim(d->>'cantiere_cnce'), '') is not null then
    raise exception 'Il cantiere da riagganciare ha già un codice CNCE: si usa l''unione, non il riaggancio';
  end if;

  -- visite, segnalazioni, incarichi, critici: tutto sul codificato; il provvisorio archiviato e registrato
  r := public.fondi_cantieri(p_master, array[p_dupe], 'riaggancio');

  foreach k in array ammessi loop
    continue when k = 'posizione';
    v := nullif(btrim(d->>k), ''); continue when v is null;
    mv := nullif(btrim(m->>k), '');
    if k = any(p_campi) then
      if k = 'cantiere_descrizione' and mv is not null and position(lower(v) in lower(mv)) = 0 then
        -- la descrizione si aggiunge, non si sostituisce
        update cantieri set cantiere_descrizione = mv || E'\n' || v where cantiere_id = p_master;
      else
        execute format('update cantieri set %1$I = (jsonb_populate_record(null::cantieri, $1)).%1$I where cantiere_id = $2', k)
          using d, p_master;
      end if;
      presi := array_append(presi, k);
    elsif mv is null or lower(mv) <> lower(v) then
      lasciati := lasciati || jsonb_build_object('da', p_dupe, 'campo', k, 'principale', mv, 'doppione', v);
    end if;
  end loop;

  -- la posizione per ultima: cambiare indirizzo o civico la azzera (trg_reset_geocode)
  if d->>'lat' is not null and d->>'lng' is not null then
    if 'posizione' = any(p_campi) then
      update cantieri set lat = (d->>'lat')::double precision, lng = (d->>'lng')::double precision,
             geocode_status = d->>'geocode_status', geocoded_at = (d->>'geocoded_at')::timestamptz
       where cantiere_id = p_master;
      presi := array_append(presi, 'posizione');
    elsif (m->>'lat') is distinct from (d->>'lat') or (m->>'lng') is distinct from (d->>'lng') then
      lasciati := lasciati || jsonb_build_object('da', p_dupe, 'campo', 'posizione', 'principale', concat_ws(', ', m->>'lat', m->>'lng'),
        'doppione', concat_ws(', ', d->>'lat', d->>'lng') || coalesce(' (' || (d->>'geocode_status') || ')', ''));
    end if;
  end if;
  update cantieri set updated_at = now() where cantiere_id = p_master;

  r := jsonb_set(r, '{note}', coalesce(r->'note', '[]'::jsonb)
         || jsonb_build_array(jsonb_build_object('anagrafica', jsonb_build_object('campi_riempiti', to_jsonb(presi), 'differenze', lasciati))));
  select max(id) into v_log from s_unioni_log where tipo = 'cantiere' and origine = 'riaggancio' and master_id = p_master and p_dupe = any(dupe_ids);
  update s_unioni_log set note = r->'note' where id = v_log;
  return r;
end
$function$;

revoke all on function public.s_riaggancia_cantiere(text, text, text[]) from public, anon;
grant execute on function public.s_riaggancia_cantiere(text, text, text[]) to authenticated;
