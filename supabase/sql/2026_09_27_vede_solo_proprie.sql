-- ============================================================
-- Fase E delle zone — 27/09/2026: «vede solo le sue visite»
-- Impostazione per singolo tecnico, decisa dalla segreteria (spenta per tutti).
-- Per chi ce l'ha, le visite visibili sono (decisione dell'utente):
--   1. quelle in cui è tecnico principale O in affiancamento — sempre, anche
--      senza nessun comune assegnato;
--   2. in più quelle dei cantieri della sua zona che hanno una pratica aperta
--      (così vede il verbale di chi c'era prima e deve chiudere);
--   3. in più quelle dei cantieri dei suoi incarichi.
-- Nient'altro. Vale nel database (regola di sicurezza sulle tabelle), non solo
-- nelle schermate: anche statistiche, conteggi della mappa e riepilogo impresa
-- prima della visita si calcolano sulle sole visite che può vedere.
-- L'anagrafe di imprese e cantieri resta condivisa. Il numero del verbale lo dà
-- il server (fase B), quindi non si rompe.
-- Per tornare indietro: 2026_09_27_vede_solo_proprie_ANNULLA.sql
-- ============================================================

alter table public.tecnici add column if not exists vede_solo_proprie boolean not null default false;
comment on column public.tecnici.vede_solo_proprie is 'Se vero il tecnico vede solo le sue visite (principale o affiancamento), più quelle dei cantieri della sua zona con pratica aperta e dei suoi incarichi. La imposta la segreteria (tecnico_imposta_visibilita). Dal 27/09/2026.';

-- chi sta leggendo è un tecnico con la visibilità ristretta?
create or replace function public.solo_proprie()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.tecnici t
                  where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                    and t.vede_solo_proprie)
     and not public.is_segreteria()
$$;

create or replace function public.mio_tecnico_id()
returns text language sql stable security definer
set search_path = public
as $$
  select t.tecnico_id from public.tecnici t
   where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
   order by coalesce(t.attivo, false) desc limit 1
$$;

-- cantieri in più che vede chi ha la visibilità ristretta (voci 2 e 3);
-- per tutti gli altri esce subito vuoto, così non costa niente
create or replace function public.cantieri_extra_miei()
returns text[] language plpgsql stable security definer
set search_path = public
as $$
declare me text; em text; r text[];
begin
  if not public.solo_proprie() then return '{}'; end if;
  me := public.mio_tecnico_id();
  em := lower(coalesce(auth.jwt() ->> 'email', ''));
  with z as (
    select case when comune_nome like 'PADOVA - Q%' then 'PADOVA' else comune_nome end as comune,
           case when comune_nome like 'PADOVA - Q%' then substring(comune_nome from 'Q(\d)')::smallint end as q
      from public.tecnici_zone where lower(email) = em
  )
  select coalesce(array_agg(distinct c), '{}') into r from (
    select p.cantiere_id as c from public.pendenze_aperte_dettaglio() p
     where p.titolare = me
        or exists (select 1 from z where z.comune = p.comune and coalesce(z.q, 0) = coalesce(p.quartiere, 0))
    union
    select i.cantiere_id from public.incarichi i
     where lower(coalesce(i.tecnico_email, '')) = em and i.cantiere_id is not null
  ) x;
  return r;
end $$;

-- la stessa regola come funzione, per le funzioni che leggono le visite da sé
create or replace function public.visita_permessa(p_t1 text, p_t2 text, p_cantiere text)
returns boolean language plpgsql stable security definer
set search_path = public
as $$
declare me text;
begin
  if not public.solo_proprie() then return true; end if;
  me := public.mio_tecnico_id();
  return p_t1 = me or p_t2 = me or p_cantiere = any (public.cantieri_extra_miei());
end $$;

do $$
declare f text;
begin
  foreach f in array array['solo_proprie()','mio_tecnico_id()','cantieri_extra_miei()','visita_permessa(text,text,text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ── la regola sulle tabelle ──
create policy visite_solo_proprie on public.visite as restrictive for all to authenticated
  using (not (select public.solo_proprie())
         or tecnico_id  = (select public.mio_tecnico_id())
         or tecnico2_id = (select public.mio_tecnico_id())
         or cantiere_id = any ((select public.cantieri_extra_miei())::text[]))
  with check (not (select public.solo_proprie())
         or tecnico_id  = (select public.mio_tecnico_id())
         or tecnico2_id = (select public.mio_tecnico_id())
         or cantiere_id = any ((select public.cantieri_extra_miei())::text[]));

do $$
declare t text;
begin
  foreach t in array array['visite_checklist','visite_foto','visite_imprese_presenti','visite_lavorazioni','visite_snapshot','verbali'] loop
    execute format($f$create policy %I on public.%I as restrictive for all to authenticated
      using (not (select public.solo_proprie()) or exists (select 1 from public.visite v where v.visita_id = %I.visita_id))
      with check (not (select public.solo_proprie()) or exists (select 1 from public.visite v where v.visita_id = %I.visita_id))$f$,
      t || '_solo_proprie', t, t, t);
  end loop;
end $$;

-- ── la segreteria imposta la visibilità ──
create or replace function public.tecnico_imposta_visibilita(p_tecnico text, p_solo_proprie boolean)
returns json language plpgsql security definer
set search_path = public
as $$
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  update public.tecnici set vede_solo_proprie = coalesce(p_solo_proprie, false) where tecnico_id = p_tecnico;
  if not found then raise exception 'Tecnico inesistente'; end if;
  return json_build_object('tecnico', p_tecnico, 'vede_solo_proprie', coalesce(p_solo_proprie, false));
end $$;
revoke execute on function public.tecnico_imposta_visibilita(text, boolean) from public, anon;
grant execute on function public.tecnico_imposta_visibilita(text, boolean) to authenticated, service_role;

-- ── le funzioni che leggono le visite da sé: stessa regola ──
create or replace function public.visite_count_map()
returns jsonb language sql stable security definer
set search_path to 'public'
as $function$
  with vis as materialized (select public.solo_proprie() s, public.mio_tecnico_id() me, public.cantieri_extra_miei() cx)
  select coalesce(jsonb_object_agg(cantiere_id, n),'{}'::jsonb) from (
    select v.cantiere_id, count(*)::int n from visite v cross join vis
    where (select public.is_personale()) and coalesce(v.elimina,0)=0 and v.cantiere_id is not null
      and (not vis.s or v.tecnico_id = vis.me or v.tecnico2_id = vis.me or v.cantiere_id = any(vis.cx))
    group by v.cantiere_id
  ) t;
$function$;

create or replace function public.dash_macroaree(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text)
returns table(zona integer, nc_plus bigint, nc_minus bigint, oss bigint, ver bigint)
language sql stable security definer
set search_path to 'public'
as $function$
  with vis as materialized (select public.solo_proprie() s, public.mio_tecnico_id() me, public.cantieri_extra_miei() cx)
  select cv.zona_osserv::int as zona,
    count(*) filter (where vc.valore = 'NC+') as nc_plus,
    count(*) filter (where vc.valore = 'NC-') as nc_minus,
    count(*) filter (where vc.valore = 'OSS') as oss,
    count(*) filter (where vc.valore = 'VER') as ver
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  cross join vis
  where (select public.is_personale()) and v.elimina is distinct from 1
    and (not vis.s or v.tecnico_id = vis.me or v.tecnico2_id = vis.me or v.cantiere_id = any(vis.cx))
    and cv.zona_osserv between 1 and 10
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by cv.zona_osserv
  order by cv.zona_osserv;
$function$;

create or replace function public.dash_macroaree_dettaglio(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text, p_zona integer DEFAULT NULL::integer, p_esito text DEFAULT NULL::text)
returns table(visita_id text, data_visita date, nr_verbale text, comune text, cantiere_label text, impresa text, tecnico text, acc text, ipc text, n_rilievi bigint)
language sql stable security definer
set search_path to 'public'
as $function$
  with vis as materialized (select public.solo_proprie() s, public.mio_tecnico_id() me, public.cantieri_extra_miei() cx)
  select v.visita_id, v.data_visita, v.nr_verbale,
    c.comune_nome as comune,
    coalesce(nullif(btrim(concat_ws(' ', c.cantiere_indirizzo, c.cantiere_civico)),''), c.cantiere_etichetta, c.comune_nome) as cantiere_label,
    ip.impresa_nome as impresa,
    btrim(concat_ws(' ', t.tecnico_cognome, t.tecnico_nome)) as tecnico,
    v.acc_cant as acc,
    (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) as ipc,
    count(*) as n_rilievi
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  cross join vis
  left join cantieri c on c.cantiere_id = v.cantiere_id
  left join tecnici t on t.tecnico_id = v.tecnico_id
  left join lateral (
    select i.impresa_nome
    from visite_imprese_presenti vip
    join imprese i on i.impresa_id = vip.impresa_id
    where vip.visita_id = v.visita_id
    order by vip.is_principale desc nulls last
    limit 1
  ) ip on true
  where (select public.is_personale()) and v.elimina is distinct from 1
    and (not vis.s or v.tecnico_id = vis.me or v.tecnico2_id = vis.me or v.cantiere_id = any(vis.cx))
    and cv.zona_osserv = p_zona
    and vc.valore = p_esito
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by v.visita_id, v.data_visita, v.nr_verbale, c.comune_nome,
    c.cantiere_indirizzo, c.cantiere_civico, c.cantiere_etichetta, ip.impresa_nome,
    t.tecnico_cognome, t.tecnico_nome, v.acc_cant, v.ipc
  order by count(*) desc, v.data_visita desc;
$function$;

create or replace function public.dash_ver_visite(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text)
returns table(visita_id text, ver bigint)
language sql stable security definer
set search_path to 'public'
as $function$
  with vis as materialized (select public.solo_proprie() s, public.mio_tecnico_id() me, public.cantieri_extra_miei() cx)
  select v.visita_id, count(*) filter (where vc.valore='VER') as ver
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  cross join vis
  where (select public.is_personale()) and v.elimina is distinct from 1
    and (not vis.s or v.tecnico_id = vis.me or v.tecnico2_id = vis.me or v.cantiere_id = any(vis.cx))
    and cv.zona_osserv between 1 and 10
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by v.visita_id;
$function$;

create or replace function public.impresa_previsita(p_impresa_id text)
returns jsonb language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
  v_s boolean := public.solo_proprie();
  v_me text := public.mio_tecnico_id();
  v_cx text[] := public.cantieri_extra_miei();
begin
  if not (select public.is_personale()) then
    raise exception 'Riservato al personale';
  end if;
  if p_impresa_id is null or btrim(p_impresa_id) = '' then
    return null;
  end if;

  select jsonb_build_object(
    'impresa', (
      select jsonb_build_object(
        'id', i.impresa_id,
        'nome', i.impresa_nome,
        'comune', i.comune,
        'prov', i.prov,
        'stato_cassa', i.stato_cassa,
        'cod_ceiv', i.cod_ceiv,
        'lista_al', i.data_agg_access,
        'ccnl', coalesce(nullif(i.contratto_ccnl, ''), i.ccnl),
        'dipendenti_ce', i.numero_dip_isc_ce_pd,
        'rspp', i.rspp
      )
      from imprese i where i.impresa_id = p_impresa_id
    ),
    'visite', (
      select coalesce(jsonb_agg(x order by x->>'data' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'verbale', v.nr_verbale,
          'data', v.data_visita,
          'ipc', v.ipc,
          'nc_piu', coalesce(v.ipc_nc_plus, 0),
          'nc_meno', coalesce(v.ipc_nc_minus, 0),
          'oss', coalesce(v.ipc_oss, 0),
          'ritorno', v.data_ritorno,
          'cantiere', coalesce(nullif(c.cantiere_descrizione, ''),
                               nullif(trim(coalesce(c.cantiere_indirizzo, '') || ' ' || coalesce(c.cantiere_civico, '')), ''),
                               c.cantiere_etichetta),
          'comune', c.comune_nome,
          'tecnico', trim(coalesce(t.tecnico_nome, '') || ' ' || coalesce(t.tecnico_cognome, ''))
        ) as x
        from visite v
        left join cantieri c on c.cantiere_id = v.cantiere_id
        left join tecnici t on t.tecnico_id = v.tecnico_id
        where coalesce(v.elimina, 0) = 0
          and (not v_s or v.tecnico_id = v_me or v.tecnico2_id = v_me or v.cantiere_id = any(v_cx))
          and (v.impresa_id = p_impresa_id
               or exists (select 1 from visite_imprese_presenti ip
                          where ip.visita_id = v.visita_id and ip.impresa_id = p_impresa_id))
        order by v.data_visita desc nulls last, v.nr_verbale desc
        limit 5
      ) s
    ),
    'rientri', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'verbale', u.nr_verbale, 'data', u.data_visita, 'ritorno', u.data_ritorno,
               'ipc', u.ipc, 'cantiere', u.cantiere, 'comune', u.comune) order by u.data_ritorno), '[]'::jsonb)
      from (
        select distinct on (v.cantiere_id)
               v.nr_verbale, v.data_visita, v.data_ritorno, v.ipc,
               coalesce(nullif(c.cantiere_descrizione, ''),
                        nullif(trim(coalesce(c.cantiere_indirizzo, '') || ' ' || coalesce(c.cantiere_civico, '')), ''),
                        c.cantiere_etichetta) as cantiere,
               c.comune_nome as comune
        from visite v
        left join cantieri c on c.cantiere_id = v.cantiere_id
        where coalesce(v.elimina, 0) = 0
          and coalesce(c.cantiere_chiuso, false) = false
          and (not v_s or v.tecnico_id = v_me or v.tecnico2_id = v_me or v.cantiere_id = any(v_cx))
          and (v.impresa_id = p_impresa_id
               or exists (select 1 from visite_imprese_presenti ip
                          where ip.visita_id = v.visita_id and ip.impresa_id = p_impresa_id))
        order by v.cantiere_id, v.data_visita desc nulls last, v.nr_verbale desc
      ) u
      where u.data_ritorno is not null
    ),
    'critici', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'data', k.data_evento, 'stato', k.stato, 'origine', k.origine,
               'motivo', k.motivo, 'cantiere', k.cantiere_desc, 'priorita', k.priorita
             ) order by k.data_evento desc), '[]'::jsonb)
      from s_cantieri_critici k
      where k.impresa_id = p_impresa_id
        and k.stato not in ('chiuso', 'annullato')
    ),
    'asseverazione', (
      select jsonb_build_object(
        'numero', a.numero_protocollo,
        'tipo', a.tipo,
        'stato', a.stato,
        'scadenza_attestato', a.data_scadenza_attestato_emesso,
        'protocollo_nazionale', a.protocollo_nazionale,
        'data_delibera', a.data_delibera
      )
      from a_pratica a
      where a.impresa_id = p_impresa_id
      order by coalesce(a.data_delibera, a.data_richiesta) desc nulls last, a.id desc
      limit 1
    ),
    'rlst', (
      select jsonb_build_object(
        'richiesta_il', coalesce(r.data_comp, r.timestamp_modulo::date),
        'progressivo', r.progressivo
      )
      from s_rlst_pratiche r
      where r.impresa_id = p_impresa_id
      order by coalesce(r.data_comp, r.timestamp_modulo::date) desc nulls last, r.id desc
      limit 1
    )
  ) into v_out;

  return v_out;
end;
$function$;
