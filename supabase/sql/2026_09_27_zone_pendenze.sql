-- ============================================================
-- Fase C delle zone — 27/09/2026: le visite APERTE seguono il comune
-- (decisione dell'utente: «sono solo le visite aperte che si dovrebbero
--  spostare a chi riceve il comune»; gli incarichi li riassegna la segreteria)
--
-- Una pratica aperta (cantiere con ritorno da fare) è di chi ha fatto l'ultima
-- visita. Quando un comune o un quartiere passa a un'altra area, le pratiche
-- aperte del tecnico che lo lascia passano al tecnico che lo riceve. Si sposta la
-- PENDENZA, non il verbale: visite.tecnico_id non si tocca. Il passaggio si
-- scrive in pendenze_riassegnate, legato all'ULTIMA visita del cantiere: quando
-- il nuovo tecnico fa la visita successiva, la pratica è sua di diritto e la
-- riga smette di contare da sola.
--
-- Per tornare indietro: 2026_09_27_zone_pendenze_ANNULLA.sql
-- ============================================================

create table public.pendenze_riassegnate (
  id            bigint generated always as identity primary key,
  cantiere_id   text not null references public.cantieri(cantiere_id),
  visita_id     text not null references public.visite(visita_id) on delete cascade,
  da_tecnico_id text references public.tecnici(tecnico_id),
  a_tecnico_id  text not null references public.tecnici(tecnico_id),
  motivo        text not null,
  creato_da     text default (auth.jwt() ->> 'email'),
  created_at    timestamptz not null default now()
);
comment on table public.pendenze_riassegnate is 'Passaggi di una pratica aperta (ultima visita del cantiere) da un tecnico a un altro, senza toccare il verbale. Vale finché la visita resta l''ultima del cantiere. Dal 27/09/2026.';
create index ix_pendenze_riassegnate_cantiere_id   on public.pendenze_riassegnate (cantiere_id);
create index ix_pendenze_riassegnate_visita_id     on public.pendenze_riassegnate (visita_id);
create index ix_pendenze_riassegnate_da_tecnico_id on public.pendenze_riassegnate (da_tecnico_id);
create index ix_pendenze_riassegnate_a_tecnico_id  on public.pendenze_riassegnate (a_tecnico_id);
alter table public.pendenze_riassegnate enable row level security;
create policy pendenze_riassegnate_sel on public.pendenze_riassegnate for select to authenticated using ((select public.is_personale()));
create policy pendenze_riassegnate_ins on public.pendenze_riassegnate for insert to authenticated with check ((select public.is_segreteria()));
create policy pendenze_riassegnate_del on public.pendenze_riassegnate for delete to authenticated using ((select public.is_segreteria()));
revoke all on public.pendenze_riassegnate from anon;
grant select, insert, delete on public.pendenze_riassegnate to authenticated;

-- l'ultimo passaggio per ogni visita: chi deve tornare in cantiere al posto di chi ha fatto il verbale
create view public.v_pendenze_titolari with (security_invoker = true) as
select distinct on (visita_id) visita_id, cantiere_id, a_tecnico_id, da_tecnico_id, motivo, created_at
  from public.pendenze_riassegnate
 order by visita_id, created_at desc, id desc;
comment on view public.v_pendenze_titolari is 'Per ogni visita con un passaggio di pratica: il tecnico che ne ha la pendenza ora. Lo leggono scadenzario del gestionale e lettera mensile della segreteria.';
revoke all on public.v_pendenze_titolari from anon;
grant select on public.v_pendenze_titolari to authenticated, service_role;

-- nome del comune nella forma delle zone (maiuscolo, apostrofi al posto degli accenti)
create or replace function public.norm_comune(p text)
returns text language sql immutable
set search_path = public
as $$
  select case when x in ('VO', 'VO EUGANEO', 'VO'' EUGANEO') then 'VO''' else x end
    from (select replace(replace(replace(replace(replace(replace(upper(trim(coalesce(p, ''))),
                 'À', 'A'''), 'È', 'E'''), 'É', 'E'''), 'Ì', 'I'''), 'Ò', 'O'''), 'Ù', 'U''') as x) s
$$;
grant execute on function public.norm_comune(text) to authenticated, service_role;

-- ricontrolli_pendenti: stessa regola di prima, ma il tecnico è chi ha la pendenza
-- (quello del verbale, salvo un passaggio registrato sull'ultima visita)
create or replace function public.ricontrolli_pendenti(p_giorni_imminenti integer default 7)
returns table(tecnico_id text, tecnico_email text, tecnico_nome text, cantiere_id text, cantiere_label text, nr_verbale text, data_visita date, acc integer, ipc text, data_rientro date, tipo text, giorni_diff integer, categoria text)
language sql stable security definer
set search_path to 'public'
as $function$
  with ultime as (
    select distinct on (v.cantiere_id) v.*
    from public.visite v
    join public.cantieri c on c.cantiere_id = v.cantiere_id
    where coalesce(v.elimina,0)=0
      and coalesce(c.cantiere_chiuso,false)=false
    order by v.cantiere_id, v.data_visita desc, v.nr_verbale desc
  ),
  calc as (
    select coalesce(pt.a_tecnico_id, u.tecnico_id) as tecnico_id, u.cantiere_id, u.nr_verbale, u.data_visita,
      u.data_ritorno as data_ritorno_valida,
      nullif(regexp_replace(coalesce(u.acc_cant::text,''),'\D','','g'),'')::int as acc,
      upper(coalesce(nullif(trim(u.ipc),''),'NR')) as ipc
    from ultime u
    left join public.v_pendenze_titolari pt on pt.visita_id = u.visita_id
  ),
  g as (
    select c.*,
      case
        when c.acc is null or c.acc<=1 then case when c.ipc='ALTO' then 3 when c.ipc in ('MEDIO','BASSO') then 22 end
        when c.acc=2 then case when c.ipc='ALTO' then 3 when c.ipc='MEDIO' then 22 end
        else case when c.ipc='ALTO' then 3 end
      end as giorni,
      case
        when c.acc is null or c.acc<=1 then case when c.ipc='ALTO' then 'urgente' when c.ipc in ('MEDIO','BASSO') then 'ordinaria' end
        when c.acc=2 then case when c.ipc='ALTO' then 'immediata' when c.ipc='MEDIO' then 'ordinaria' end
        else case when c.ipc='ALTO' then 'immediata' end
      end as tipo
    from calc c
  ),
  eff as (
    select g.*,
      case
        when g.giorni is null then null
        when g.data_ritorno_valida is not null then g.data_ritorno_valida
        else g.data_visita + g.giorni
      end as eff_ritorno
    from g
  )
  select e.tecnico_id, t.email,
    trim(coalesce(t.tecnico_cognome,'')||' '||coalesce(t.tecnico_nome,'')),
    e.cantiere_id,
    (case
      when nullif(trim(ca.cantiere_indirizzo),'') is not null
        then trim(concat_ws(' ', ca.cantiere_indirizzo, ca.cantiere_civico))
             || case when nullif(trim(ca.comune_nome),'') is not null then ', '||ca.comune_nome else '' end
      else coalesce(
             nullif(trim(ca.cantiere_etichetta),'')
               || case when nullif(trim(ca.comune_nome),'') is not null then ', '||ca.comune_nome else '' end,
             ca.cantiere_etichetta,
             ca.comune_nome
           )
    end) || case when nullif(trim(ca.lotto),'') is not null then ' – lotto '||trim(ca.lotto) else '' end,
    e.nr_verbale,
    e.data_visita, e.acc, e.ipc,
    e.eff_ritorno, e.tipo,
    (e.eff_ritorno - current_date),
    case
      when e.eff_ritorno <= current_date then 'urgente'
      when e.eff_ritorno <= current_date + p_giorni_imminenti then 'imminente'
      else 'futuro'
    end
  from eff e
  left join public.tecnici t on t.tecnico_id = e.tecnico_id
  left join public.cantieri ca on ca.cantiere_id = e.cantiere_id
  where e.eff_ritorno is not null
$function$;

-- le pratiche aperte con tutto quello che serve per spostarle: ultima visita, chi
-- ha fatto il verbale, chi ha la pendenza, comune e quartiere (dallo stradario)
create or replace function public.pendenze_aperte_dettaglio()
returns table(cantiere_id text, visita_id text, tecnico_verbale text, titolare text, comune text, quartiere smallint,
              cantiere_label text, nr_verbale text, data_visita date, data_rientro date, categoria text)
language sql stable security definer
set search_path = public
as $$
  select r.cantiere_id, u.visita_id, u.tecnico_id, r.tecnico_id,
         public.norm_comune(ca.comune_nome),
         case when public.norm_comune(ca.comune_nome) = 'PADOVA' then public.quartiere_padova(ca.cantiere_indirizzo) end,
         r.cantiere_label, r.nr_verbale, r.data_visita, r.data_rientro, r.categoria
    from public.ricontrolli_pendenti(7) r
    join public.cantieri ca on ca.cantiere_id = r.cantiere_id
    join lateral (
      select v.visita_id, v.tecnico_id from public.visite v
       where v.cantiere_id = r.cantiere_id and coalesce(v.elimina,0) = 0
       order by v.data_visita desc, v.nr_verbale desc limit 1
    ) u on true
   where public.is_personale()
$$;

-- tecnici che oggi hanno un'area
create or replace function public.zone_tecnici_area(p_area integer)
returns text[] language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct tecnico_id), '{}') from public.zone_aree_tecnici
   where area_id = p_area and tecnico_id is not null and dal <= current_date and (al is null or al >= current_date)
$$;

-- chiude la riga aperta (se nata oggi la toglie: non ha storia da tenere)
create or replace function public.zone_chiudi_riga_comune(p_id bigint)
returns void language plpgsql security definer
set search_path = public
as $$
begin
  delete from public.zone_aree_comuni where id = p_id and dal >= current_date;
  update public.zone_aree_comuni set al = current_date - 1 where id = p_id and dal < current_date;
end $$;

-- ANTEPRIMA dello spostamento di un comune (o quartiere di Padova) in un'altra area
create or replace function public.zone_anteprima_sposta(p_comune text, p_quartiere smallint, p_area_nuova integer)
returns json language plpgsql stable security definer
set search_path = public
as $$
declare
  c text := public.norm_comune(p_comune);
  r record; vecchi text[]; nuovi text[];
begin
  if not (select public.is_segreteria()) then raise exception 'Non autorizzato'; end if;
  select * into r from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null;
  vecchi := case when r.id is null then '{}' else public.zone_tecnici_area(r.area_id) end;
  nuovi  := public.zone_tecnici_area(p_area_nuova);
  return json_build_object(
    'comune', c, 'quartiere', p_quartiere,
    'area_vecchia', r.area_id, 'area_nuova', p_area_nuova,
    'tecnici_vecchi', vecchi, 'tecnici_nuovi', nuovi,
    'pendenze', coalesce((select json_agg(json_build_object('cantiere', p.cantiere_label, 'verbale', p.nr_verbale,
                   'data_visita', p.data_visita, 'rientro', p.data_rientro, 'categoria', p.categoria, 'titolare', p.titolare) order by p.data_rientro)
        from public.pendenze_aperte_dettaglio() p
       where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0) and p.titolare = any(vecchi)), '[]'),
    'incarichi_aperti', (select count(*) from public.incarichi i
       where i.stato = 'aperto' and public.norm_comune(split_part(i.comune, ' - ', 1)) = c
         and (p_quartiere is null or i.comune ~* ('Q\s*' || p_quartiere || '\M'))
         and lower(coalesce(i.tecnico_email,'')) in (select lower(t.email) from public.tecnici t where t.tecnico_id = any(vecchi))),
    'si_spostano', array_length(nuovi, 1) = 1
  );
end $$;

-- SPOSTA un comune (o quartiere di Padova) in un'altra area; le sue pratiche
-- aperte del tecnico che lo lascia passano al tecnico dell'area nuova
create or replace function public.zone_sposta(p_comune text, p_quartiere smallint, p_area_nuova integer)
returns json language plpgsql security definer
set search_path = public
as $$
declare
  c text := public.norm_comune(p_comune);
  r record; vecchi text[]; nuovi text[]; n_pend int := 0; n_resta int := 0;
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  if not exists (select 1 from public.zone_aree where area_id = p_area_nuova) then raise exception 'Area % inesistente', p_area_nuova; end if;
  select * into r from public.zone_aree_comuni
   where comune_nome = c and coalesce(quartiere,0) = coalesce(p_quartiere,0) and al is null for update;
  if r.area_id = p_area_nuova then raise exception '% è già nell''area %', c, p_area_nuova; end if;
  vecchi := case when r.id is null then '{}' else public.zone_tecnici_area(r.area_id) end;
  nuovi  := public.zone_tecnici_area(p_area_nuova);
  if r.id is not null then perform public.zone_chiudi_riga_comune(r.id); end if;
  insert into public.zone_aree_comuni (area_id, comune_nome, quartiere, dal, fonte)
  values (p_area_nuova, c, p_quartiere, current_date, 'scheda Tecnici e zone');

  if array_length(nuovi, 1) = 1 then
    insert into public.pendenze_riassegnate (cantiere_id, visita_id, da_tecnico_id, a_tecnico_id, motivo)
    select p.cantiere_id, p.visita_id, p.titolare, nuovi[1],
           c || coalesce(' Q' || p_quartiere, '') || ' passato dall''area ' || coalesce(r.area_id::text, '—') || ' all''area ' || p_area_nuova
      from public.pendenze_aperte_dettaglio() p
     where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0)
       and p.titolare = any(vecchi) and p.titolare <> nuovi[1];
    get diagnostics n_pend = row_count;
  else
    select count(*) into n_resta from public.pendenze_aperte_dettaglio() p
     where p.comune = c and coalesce(p.quartiere,0) = coalesce(p_quartiere,0) and p.titolare = any(vecchi);
  end if;
  return json_build_object('comune', c, 'quartiere', p_quartiere, 'area_vecchia', r.area_id, 'area_nuova', p_area_nuova,
                           'pendenze_spostate', n_pend, 'pendenze_da_assegnare_a_mano', n_resta);
end $$;

-- PASSA un'area intera a un altro tecnico (come da Canova a Bordina); le
-- pratiche aperte del tecnico uscente nei comuni dell'area passano al nuovo
create or replace function public.zone_passa_area(p_area integer, p_tecnico text)
returns json language plpgsql security definer
set search_path = public
as $$
declare vecchi text[]; n_pend int := 0; nm text;
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  select trim(coalesce(tecnico_cognome,'')) into nm from public.tecnici where tecnico_id = p_tecnico;
  if nm is null then raise exception 'Tecnico inesistente'; end if;
  vecchi := public.zone_tecnici_area(p_area);
  delete from public.zone_aree_tecnici where area_id = p_area and al is null and dal >= current_date;
  update public.zone_aree_tecnici set al = current_date - 1 where area_id = p_area and al is null;
  insert into public.zone_aree_tecnici (area_id, tecnico_id, nome, dal, fonte)
  values (p_area, p_tecnico, nm, current_date, 'scheda Tecnici e zone');
  insert into public.pendenze_riassegnate (cantiere_id, visita_id, da_tecnico_id, a_tecnico_id, motivo)
  select p.cantiere_id, p.visita_id, p.titolare, p_tecnico, 'area ' || p_area || ' passata a ' || nm
    from public.pendenze_aperte_dettaglio() p
    join public.zone_aree_comuni zc on zc.area_id = p_area and zc.al is null
     and zc.comune_nome = p.comune and coalesce(zc.quartiere,0) = coalesce(p.quartiere,0)
   where p.titolare = any(vecchi) and p.titolare <> p_tecnico;
  get diagnostics n_pend = row_count;
  return json_build_object('area', p_area, 'tecnico', nm, 'pendenze_spostate', n_pend);
end $$;

-- ASSEGNA a mano una singola pratica aperta (pratiche fuori zona, «PADOVA» senza quartiere…)
create or replace function public.pendenza_assegna(p_cantiere text, p_tecnico text, p_motivo text default null)
returns json language plpgsql security definer
set search_path = public
as $$
declare p record;
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  select * into p from public.pendenze_aperte_dettaglio() d where d.cantiere_id = p_cantiere;
  if p.visita_id is null then raise exception 'Il cantiere non ha una pratica aperta'; end if;
  if p.titolare = p_tecnico then return json_build_object('gia', true); end if;
  insert into public.pendenze_riassegnate (cantiere_id, visita_id, da_tecnico_id, a_tecnico_id, motivo)
  values (p_cantiere, p.visita_id, p.titolare, p_tecnico, coalesce(nullif(trim(p_motivo),''), 'assegnata a mano dalla segreteria'));
  return json_build_object('cantiere', p.cantiere_label, 'da', p.titolare, 'a', p_tecnico);
end $$;

-- pratiche aperte che nessuna zona «copre»: tecnico non più attivo, oppure fuori dalla sua zona di oggi
create or replace function public.pendenze_da_assegnare()
returns table(cantiere_id text, cantiere_label text, nr_verbale text, data_visita date, data_rientro date, categoria text,
              titolare text, titolare_nome text, motivo text, comune text, quartiere smallint, proposto text, proposto_nome text)
language sql stable security definer
set search_path = public
as $$
  with z as (
    select distinct lower(email) email,
           case when comune_nome like 'PADOVA - Q%' then 'PADOVA' else comune_nome end comune,
           case when comune_nome like 'PADOVA - Q%' then substring(comune_nome from 'Q(\d)')::smallint end quartiere
      from public.tecnici_zone
  )
  select p.cantiere_id, p.cantiere_label, p.nr_verbale, p.data_visita, p.data_rientro, p.categoria,
         p.titolare, trim(coalesce(t.tecnico_cognome,'')||' '||coalesce(t.tecnico_nome,'')),
         case when not coalesce(t.attivo, false) or coalesce(t.elimina,0) <> 0 then 'tecnico non più attivo' else 'fuori dalla sua zona' end,
         p.comune, p.quartiere, tp.tecnico_id, trim(coalesce(tp.tecnico_cognome,'')||' '||coalesce(tp.tecnico_nome,''))
    from public.pendenze_aperte_dettaglio() p
    left join public.tecnici t on t.tecnico_id = p.titolare
    left join lateral (
      select tt.* from z join public.tecnici tt on lower(tt.email) = z.email
       where z.comune = p.comune and coalesce(z.quartiere,0) = coalesce(p.quartiere,0)
       order by tt.tecnico_cognome limit 1
    ) tp on true
   where public.is_segreteria()
     and (not coalesce(t.attivo, false) or coalesce(t.elimina,0) <> 0
          or not exists (select 1 from z where z.email = lower(t.email) and z.comune = p.comune
                          and (coalesce(z.quartiere,0) = coalesce(p.quartiere,0) or (p.quartiere is null and p.comune = 'PADOVA'))))
$$;

do $$
declare f text;
begin
  foreach f in array array['pendenze_aperte_dettaglio()','zone_tecnici_area(integer)','zone_chiudi_riga_comune(bigint)',
                           'zone_anteprima_sposta(text,smallint,integer)','zone_sposta(text,smallint,integer)',
                           'zone_passa_area(integer,text)','pendenza_assegna(text,text,text)','pendenze_da_assegnare()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  revoke execute on function public.zone_chiudi_riga_comune(bigint) from authenticated;   -- solo dall'interno
  revoke execute on function public.norm_comune(text) from public, anon;
end $$;
