-- 07/10/2026 — UN COMUNE O UN QUARTIERE IN DUE AREE (deciso dall'utente: Padova Q1 lo seguono De Marco e Visentini).
-- Fino a oggi un comune aperto poteva stare in un'area sola (indice zone_aree_comuni_uno_aperto) e zone_sposta leggeva
-- «la» riga aperta. Ora:
--   · l'indice vale per area: lo stesso comune/quartiere al massimo una volta per area, anche in più aree;
--   · zone_condividi(comune, quartiere, area): lo aggiunge a un'altra area SENZA toglierlo alla prima; le visite aperte
--     restano a chi le ha (nessuna pendenza spostata). tecnici_zone lo dà a tutti e due: le proposte automatiche del
--     tecnico di zona (portale, servizi, stage) con due candidati non scelgono, come già succede per «PADOVA»;
--   · zone_sposta e zone_anteprima_sposta trattano tutte le righe aperte: spostare un comune condiviso lo lascia nella
--     sola area scelta (se è una di quelle che già lo hanno, è «toglierlo alle altre») e le visite aperte dei tecnici
--     delle aree che lo perdono passano al tecnico dell'area che resta, se è uno solo.
-- Il resto (pendenze_da_assegnare, vede_solo_proprie, la vista tecnici_zone) legge già per tecnico e funziona così com'è.

begin;

drop index if exists public.zone_aree_comuni_uno_aperto;
create unique index if not exists zone_aree_comuni_uno_aperto_per_area
  on public.zone_aree_comuni (area_id, comune_nome, coalesce(quartiere::integer, 0)) where al is null;

create or replace function public.zone_anteprima_sposta(p_comune text, p_quartiere smallint, p_area_nuova integer)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  c text := public.norm_comune(p_comune);
  aree_v int[]; vecchi text[]; nuovi text[];
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  select coalesce(array_agg(distinct area_id order by area_id), '{}') into aree_v from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null;
  -- i tecnici delle aree che lo perdono (tutte quelle aperte tranne la nuova)
  select coalesce(array_agg(distinct t), '{}') into vecchi
    from unnest(aree_v) a cross join lateral unnest(public.zone_tecnici_area(a)) t where a <> p_area_nuova;
  nuovi := public.zone_tecnici_area(p_area_nuova);
  return json_build_object(
    'comune', c, 'quartiere', p_quartiere,
    'area_vecchia', (select min(a) from unnest(aree_v) a where a <> p_area_nuova),
    'aree_vecchie', aree_v, 'area_nuova', p_area_nuova,
    'tecnici_vecchi', vecchi, 'tecnici_nuovi', nuovi,
    'pendenze', coalesce((select json_agg(json_build_object('cantiere', p.cantiere_label, 'verbale', p.nr_verbale,
                   'data_visita', p.data_visita, 'rientro', p.data_rientro, 'categoria', p.categoria, 'titolare', p.titolare) order by p.data_rientro)
        from public.pendenze_aperte_dettaglio() p
       where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0)
         and p.titolare = any(vecchi) and not (p.titolare = any(nuovi))), '[]'),
    'incarichi_aperti', (select count(*) from public.incarichi i
       where i.stato = 'aperto' and public.norm_comune(split_part(i.comune, ' - ', 1)) = c
         and (p_quartiere is null or i.comune ~* ('Q\s*' || p_quartiere || '\M'))
         and lower(coalesce(i.tecnico_email,'')) in (select lower(t.email) from public.tecnici t where t.tecnico_id = any(vecchi))),
    'si_spostano', array_length(nuovi, 1) = 1
  );
end $function$;

create or replace function public.zone_sposta(p_comune text, p_quartiere smallint, p_area_nuova integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c text := public.norm_comune(p_comune);
  aree_v int[]; vecchi text[]; nuovi text[]; n_pend int := 0; n_resta int := 0; gia boolean; r record;
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  if not exists (select 1 from public.zone_aree where area_id = p_area_nuova) then raise exception 'Area % inesistente', p_area_nuova; end if;
  perform 1 from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null for update;
  select coalesce(array_agg(distinct area_id order by area_id), '{}') into aree_v from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null;
  gia := p_area_nuova = any(aree_v);
  if gia and array_length(aree_v, 1) = 1 then raise exception '% è già nell''area %', c, p_area_nuova; end if;
  select coalesce(array_agg(distinct t), '{}') into vecchi
    from unnest(aree_v) a cross join lateral unnest(public.zone_tecnici_area(a)) t where a <> p_area_nuova;
  nuovi := public.zone_tecnici_area(p_area_nuova);
  for r in select id from public.zone_aree_comuni
            where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null and area_id <> p_area_nuova loop
    perform public.zone_chiudi_riga_comune(r.id);
  end loop;
  if not gia then
    insert into public.zone_aree_comuni (area_id, comune_nome, quartiere, dal, fonte)
    values (p_area_nuova, c, p_quartiere, current_date, 'scheda Tecnici e zone');
  end if;
  if array_length(nuovi, 1) = 1 then
    insert into public.pendenze_riassegnate (cantiere_id, visita_id, da_tecnico_id, a_tecnico_id, motivo)
    select p.cantiere_id, p.visita_id, p.titolare, nuovi[1],
           c || coalesce(' Q' || p_quartiere, '') || ' passato dall''area ' || coalesce(array_to_string(array(select a from unnest(aree_v) a where a <> p_area_nuova), '+'), '—') || ' all''area ' || p_area_nuova
      from public.pendenze_aperte_dettaglio() p
     where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0)
       and p.titolare = any(vecchi) and p.titolare <> nuovi[1];
    get diagnostics n_pend = row_count;
  else
    select count(*) into n_resta from public.pendenze_aperte_dettaglio() p
     where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0) and p.titolare = any(vecchi) and not (p.titolare = any(nuovi));
  end if;
  return json_build_object('comune', c, 'quartiere', p_quartiere,
                           'area_vecchia', (select min(a) from unnest(aree_v) a where a <> p_area_nuova), 'aree_vecchie', aree_v,
                           'area_nuova', p_area_nuova, 'pendenze_spostate', n_pend, 'pendenze_da_assegnare_a_mano', n_resta);
end $function$;

create or replace function public.zone_condividi(p_comune text, p_quartiere smallint, p_area integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c text := public.norm_comune(p_comune);
  altre int[];
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  if not exists (select 1 from public.zone_aree where area_id = p_area) then raise exception 'Area % inesistente', p_area; end if;
  if coalesce(p_quartiere, 0) <> 0 and c <> 'PADOVA' then raise exception 'Il quartiere vale solo per Padova'; end if;
  if exists (select 1 from public.zone_aree_comuni where area_id = p_area and comune_nome = c
               and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null) then
    raise exception '% è già nell''area %', c || coalesce(' Q' || p_quartiere, ''), p_area;
  end if;
  select coalesce(array_agg(distinct area_id order by area_id), '{}') into altre from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null;
  insert into public.zone_aree_comuni (area_id, comune_nome, quartiere, dal, fonte)
  values (p_area, c, p_quartiere, current_date, 'scheda Tecnici e zone (condiviso)');
  return json_build_object('comune', c, 'quartiere', p_quartiere, 'area', p_area, 'condiviso_con', altre);
end $function$;
revoke execute on function public.zone_condividi(text, smallint, integer) from public, anon;
grant execute on function public.zone_condividi(text, smallint, integer) to authenticated;

commit;
