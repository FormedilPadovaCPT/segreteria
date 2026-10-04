-- ============================================================
-- Controllo settimanale delle tendine (04/10/2026, chiesto dall'utente
-- dopo l'errore di «Modifica impresa»: «mi chiedo quanti altri errori ci
-- possano essere del genere»).
--
-- s_tendine_registro: per ogni tendina che scrive dati, tabella.colonna e
--   voci. Lo riempie tools/tendine-registro.sql del gestionale, generato
--   da tools/tendine.cjs leggendo il codice delle app (mai a mano).
-- s_tendine_valori: i valori che stanno nel database e NON sono fra le
--   voci di nessuna tendina di quella colonna, con quante righe li hanno e
--   da quando si vedono. Le maschere li tengono «(com'è scritto)»; un
--   valore NUOVO vuol dire che qualcuno (un'app, un import) scrive in quella
--   colonna con un vocabolario diverso: è il segnale che il 04/10 mancava.
-- s_tendine_giri: un battito per ogni giro, anche quando non trova niente
--   (il silenzio non è un esito).
-- ============================================================

create table if not exists public.s_tendine_registro (
  id text primary key,
  app text not null,
  dove text,
  tabella text not null,
  colonna text not null,
  voci text[] not null,
  aggiornato_il timestamptz not null default now()
);

create table if not exists public.s_tendine_valori (
  tabella text not null,
  colonna text not null,
  valore text not null,
  righe int not null default 0,
  primo_visto timestamptz not null default now(),
  ultimo_visto timestamptz not null default now(),
  visto_il timestamptz,
  visto_da text,
  primary key (tabella, colonna, valore)
);

create table if not exists public.s_tendine_giri (
  id bigint generated always as identity primary key,
  fatto_il timestamptz not null default now(),
  colonne int not null default 0,
  colonne_ko int not null default 0,
  valori_fuori int not null default 0,
  nuovi int not null default 0,
  errori jsonb not null default '[]'::jsonb
);

alter table public.s_tendine_registro enable row level security;
alter table public.s_tendine_valori enable row level security;
alter table public.s_tendine_giri enable row level security;
drop policy if exists s_tendine_registro_leggi on public.s_tendine_registro;
create policy s_tendine_registro_leggi on public.s_tendine_registro for select to authenticated using (public.is_segreteria());
drop policy if exists s_tendine_valori_leggi on public.s_tendine_valori;
create policy s_tendine_valori_leggi on public.s_tendine_valori for select to authenticated using (public.is_segreteria());
drop policy if exists s_tendine_giri_leggi on public.s_tendine_giri;
create policy s_tendine_giri_leggi on public.s_tendine_giri for select to authenticated using (public.is_segreteria());

create or replace function public.s_controllo_tendine()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  x record;
  inizio timestamptz := clock_timestamp();
  errori jsonb := '[]'::jsonb;
  n_col int := 0; n_ko int := 0; n_fuori int := 0; n_nuovi int := 0;
  filtro text;
begin
  -- dal giro pg_cron (nessun utente) o dalla segreteria
  if auth.uid() is not null and not public.is_segreteria() then
    raise exception 'Non autorizzato';
  end if;

  update s_tendine_valori set righe = 0;

  for r in
    select tabella, colonna, array_agg(distinct v) as voci
      from s_tendine_registro, unnest(voci) v
     group by tabella, colonna
  loop
    n_col := n_col + 1;
    begin
      -- le righe eliminate (elimina = 1) non contano
      select case when exists (select 1 from information_schema.columns
                                where table_schema = 'public' and table_name = r.tabella and column_name = 'elimina')
                  then ' and coalesce(elimina::int, 0) = 0' else '' end
        into filtro;
      for x in execute format(
        'select %1$I::text as valore, count(*)::int as n from public.%2$I
          where %1$I is not null and btrim(%1$I::text) <> %3$L and not (%1$I::text = any($1))%4$s
          group by 1', r.colonna, r.tabella, '', filtro) using r.voci
      loop
        insert into s_tendine_valori (tabella, colonna, valore, righe, primo_visto, ultimo_visto)
        values (r.tabella, r.colonna, x.valore, x.n, inizio, inizio)
        on conflict (tabella, colonna, valore) do update set righe = excluded.righe, ultimo_visto = inizio;
        n_fuori := n_fuori + 1;
      end loop;
    exception when others then
      n_ko := n_ko + 1;
      errori := errori || jsonb_build_object('colonna', r.tabella || '.' || r.colonna, 'errore', sqlerrm);
    end;
  end loop;

  select count(*) into n_nuovi from s_tendine_valori where primo_visto = inizio;
  insert into s_tendine_giri (fatto_il, colonne, colonne_ko, valori_fuori, nuovi, errori)
  values (inizio, n_col, n_ko, n_fuori, n_nuovi, errori);

  return jsonb_build_object('colonne', n_col, 'colonne_ko', n_ko, 'valori_fuori', n_fuori, 'nuovi', n_nuovi, 'errori', errori);
end
$function$;

-- la segreteria segna come visti i valori nuovi che ha guardato
create or replace function public.s_tendine_visti()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  if not public.is_segreteria() then raise exception 'Non autorizzato'; end if;
  update s_tendine_valori set visto_il = now(), visto_da = coalesce(auth.jwt() ->> 'email', 'segreteria')
   where visto_il is null and righe > 0;
  get diagnostics n = row_count;
  return n;
end
$function$;

revoke all on function public.s_controllo_tendine() from public, anon;
revoke all on function public.s_tendine_visti() from public, anon;
grant execute on function public.s_controllo_tendine() to authenticated;
grant execute on function public.s_tendine_visti() to authenticated;

-- il giro: ogni lunedì alle 7:40 italiane (5:40 UTC)
select cron.unschedule('controllo-tendine') where exists (select 1 from cron.job where jobname = 'controllo-tendine');
select cron.schedule('controllo-tendine', '40 5 * * 1', $$select public.s_controllo_tendine()$$);
