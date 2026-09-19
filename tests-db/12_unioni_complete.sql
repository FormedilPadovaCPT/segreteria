-- Unioni complete di imprese, persone e cantieri (19/09/2026).
-- Unisce schede VERE dentro una transazione che si annulla e controlla che sul doppione
-- non resti niente (tranne cio' che la funzione dichiara di lasciare), che nessuna riga
-- vada persa senza essere contata, che i lotti non si uniscano e che i tempi reggano.
begin;

do $$
declare
  m text; d text; pm uuid; pd uuid; cm text; cd text; l1 text; l2 text;
  r jsonb; rep jsonb := '{}'::jsonb; t0 timestamptz; q record;
  prima bigint; dopo bigint; rimaste bigint; tolte bigint; n int;
begin
  -- ═══ IMPRESE ═══ doppione = l'impresa piu' «ricca» di legami; principale = un'altra con storia in Cassa attuale
  select x.impresa_id into d from (
    select i.impresa_id,
      (select count(*) from persone_imprese p where p.impresa_id = i.impresa_id)
      + (select count(*) from s_nomine s where s.impresa_id = i.impresa_id) * 3
      + (select count(*) from imprese_ateco a where a.impresa_id = i.impresa_id) * 2
      + (select count(*) from a_pratica a where a.impresa_id = i.impresa_id) * 5
      + (select count(*) from visite v where v.impresa_id = i.impresa_id) as peso
    from imprese i where i.elimina = 0
      and exists (select 1 from imprese_cassa_storico s where s.impresa_id = i.impresa_id and s.attuale)
      and exists (select 1 from imprese_ateco a where a.impresa_id = i.impresa_id)
    order by peso desc limit 1) x;
  select i.impresa_id into m from imprese i
   where i.elimina = 0 and i.impresa_id <> d
     and exists (select 1 from imprese_cassa_storico s where s.impresa_id = i.impresa_id and s.attuale)
     and exists (select 1 from a_impresa_dati a where a.impresa_id = i.impresa_id)
   order by (select count(*) from visite v where v.impresa_id = i.impresa_id) desc limit 1;
  if m is null or d is null then raise exception 'imprese di prova non trovate'; end if;
  -- la principale riceve apposta un codice ATECO uguale a uno del doppione: e' il caso del vincolo unico
  insert into imprese_ateco (impresa_id, codice, data_ateco, fonte)
  select m, a.codice, a.data_ateco, 'prova' from imprese_ateco a where a.impresa_id = d
   and not exists (select 1 from imprese_ateco b where b.impresa_id = m and b.codice = a.codice and b.data_ateco is not distinct from a.data_ateco)
   limit 1;

  create temp table _prima on commit drop as
    select c.table_name::text as tab, 0::bigint as righe
      from information_schema.columns c join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'impresa_id'
       and c.table_name not in ('imprese', 's_unioni_log');
  for q in select tab from _prima loop
    execute format('select count(*) from public.%I where impresa_id in ($1,$2)', q.tab) into prima using m, d;
    update _prima set righe = prima where tab = q.tab;
  end loop;

  t0 := clock_timestamp();
  r := fondi_imprese(m, array[d]);
  rep := rep || jsonb_build_object('imprese', jsonb_build_object('principale', m, 'doppione', d,
           'millisecondi', round(extract(epoch from clock_timestamp() - t0) * 1000), 'esito', r));
  if clock_timestamp() - t0 > interval '5 seconds' then raise exception 'fondi_imprese troppo lenta'; end if;

  for q in select tab, righe from _prima loop
    execute format('select count(*) from public.%I where impresa_id = $1', q.tab) into dopo using m;
    execute format('select count(*) from public.%I where impresa_id = $1', q.tab) into rimaste using d;
    select coalesce(sum((x ->> 'righe')::bigint), 0) into tolte from jsonb_array_elements(r -> 'note') x where x ->> 'tolti_doppi' = q.tab;
    if q.tab = 'a_impresa_dati' then
      if rimaste > 1 then raise exception 'a_impresa_dati: sul doppione resta piu'' di una riga (%)', rimaste; end if;
    elsif rimaste <> 0 then
      raise exception 'sul doppione restano % righe in %', rimaste, q.tab;
    end if;
    if dopo + rimaste + tolte <> q.righe then
      raise exception '% : prima % righe, dopo % + rimaste % + tolte % — qualcosa si e'' perso', q.tab, q.righe, dopo, rimaste, tolte;
    end if;
  end loop;
  if (select count(*) from imprese_cassa_storico where impresa_id = m and attuale) <> 1 then
    raise exception 'la principale deve avere UN solo periodo attuale in Cassa';
  end if;
  if not exists (select 1 from imprese_cassa_storico where impresa_id = m and not attuale and nota like '%' || d || '%') then
    raise exception 'i periodi del doppione dovevano passare alla principale, non attuali e con la nota';
  end if;
  if (select elimina from imprese where impresa_id = d) <> 1 then raise exception 'il doppione non e'' archiviato'; end if;
  if not exists (select 1 from s_unioni_log where tipo = 'impresa' and master_id = m and d = any(dupe_ids)) then
    raise exception 'manca la riga nel registro delle unioni';
  end if;
  if exists (select 1 from a_impresa_dati where impresa_id = d)
     and not exists (select 1 from jsonb_array_elements(r -> 'note') x where x ->> 'lasciata_sul_doppione' = 'a_impresa_dati') then
    raise exception 'il registro doveva dire che a_impresa_dati e'' rimasta sul doppione';
  end if;

  -- ═══ PERSONE ═══ doppione con nomine, principale un'altra scheda; codici fiscali non in conflitto
  select p.persona_id into pd from persone p
   where p.elimina = 0 and coalesce(p.cf, '') = ''
     and exists (select 1 from s_nomine s where s.persona_id = p.persona_id)
   order by (select count(*) from persone_imprese x where x.persona_id = p.persona_id) desc limit 1;
  select p.persona_id into pm from persone p
   where p.elimina = 0 and p.persona_id <> pd and coalesce(p.cf, '') <> ''
     and exists (select 1 from s_corsi_iscritti s where s.persona_id = p.persona_id) limit 1;
  if pm is null or pd is null then raise exception 'persone di prova non trovate'; end if;
  select (select count(*) from s_nomine where persona_id in (pm, pd)) + (select count(*) from persone_imprese where persona_id in (pm, pd))
       + (select count(*) from s_corsi_iscritti where persona_id in (pm, pd)) into prima;
  t0 := clock_timestamp();
  r := fondi_persone(pm, array[pd]);
  rep := rep || jsonb_build_object('persone', jsonb_build_object('millisecondi', round(extract(epoch from clock_timestamp() - t0) * 1000), 'esito', r));
  select (select count(*) from s_nomine where persona_id = pm) + (select count(*) from persone_imprese where persona_id = pm)
       + (select count(*) from s_corsi_iscritti where persona_id = pm) into dopo;
  if dopo <> prima then raise exception 'persone: prima % righe, dopo % sulla principale', prima, dopo; end if;
  for q in select c.table_name::text as tab from information_schema.columns c join information_schema.tables t
             on t.table_schema = c.table_schema and t.table_name = c.table_name
            where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'persona_id' and c.table_name <> 'persone' loop
    execute format('select count(*) from public.%I where persona_id = $1', q.tab) into rimaste using pd;
    if rimaste <> 0 then raise exception 'sulla scheda unita restano % righe in %', rimaste, q.tab; end if;
  end loop;
  if (select elimina from persone where persona_id = pd) <> 1 then raise exception 'la scheda unita non e'' nel cestino'; end if;

  -- due codici fiscali diversi: l'unione si deve fermare
  select p.persona_id into pd from persone p where p.elimina = 0 and coalesce(p.cf,'') <> '' and p.cf !~ '\*'
     and upper(p.cf) <> (select upper(cf) from persone where persona_id = pm) limit 1;
  begin
    perform fondi_persone(pm, array[pd]);
    raise exception 'NONFERMATA';
  exception when others then
    if sqlerrm = 'NONFERMATA' then raise exception 'due codici fiscali diversi si sono uniti'; end if;
  end;

  -- ═══ CANTIERI ═══ doppione = il cantiere senza CNCE piu' carico di legami; principale = uno con CNCE
  select c.cantiere_id into cd from cantieri c
   where c.elimina = 0 and coalesce(trim(c.cantiere_cnce), '') = '' and coalesce(trim(c.lotto), '') = ''
   order by (select count(*) from incarichi i where i.cantiere_id = c.cantiere_id) * 5
          + (select count(*) from s_cantieri_critici s where s.cantiere_id = c.cantiere_id) * 5
          + (select count(*) from visite v where v.cantiere_id = c.cantiere_id) desc limit 1;
  select c.cantiere_id into cm from cantieri c
   where c.elimina = 0 and c.cantiere_cnce ilike 'CNCE%' and coalesce(trim(c.lotto), '') = ''
   order by (select count(*) from visite v where v.cantiere_id = c.cantiere_id) desc limit 1;
  select (select count(*) from visite where cantiere_id in (cm, cd)) + (select count(*) from incarichi where cantiere_id in (cm, cd))
       + (select count(*) from s_cantieri_critici where cantiere_id in (cm, cd)) + (select count(*) from segnalazioni_cantiere where cantiere_id in (cm, cd)) into prima;
  t0 := clock_timestamp();
  r := fondi_cantieri(cm, array[cd], 'riaggancio');
  rep := rep || jsonb_build_object('cantieri', jsonb_build_object('millisecondi', round(extract(epoch from clock_timestamp() - t0) * 1000), 'esito', r));
  select (select count(*) from visite where cantiere_id = cm) + (select count(*) from incarichi where cantiere_id = cm)
       + (select count(*) from s_cantieri_critici where cantiere_id = cm) + (select count(*) from segnalazioni_cantiere where cantiere_id = cm) into dopo;
  if dopo <> prima then raise exception 'cantieri: prima % righe, dopo %', prima, dopo; end if;
  if exists (select 1 from visite where cantiere_id = cd) or exists (select 1 from incarichi where cantiere_id = cd)
     or exists (select 1 from s_cantieri_critici where cantiere_id = cd) then
    raise exception 'sul cantiere unito e'' rimasto qualcosa';
  end if;
  if (select elimina from cantieri where cantiere_id = cd) <> 1 then raise exception 'il cantiere unito non e'' archiviato'; end if;
  -- le tabelle dell'asseverazione puntano ad a_cantiere: non devono essere state toccate
  if r -> 'toccate' ? 'a_pratica_cantiere.cantiere_id' or r -> 'toccate' ? 'a_piano_riga.cantiere_id' then
    raise exception 'sono state toccate le tabelle dei cantieri di asseverazione';
  end if;

  -- i lotti non si uniscono
  select a.cantiere_id, b.cantiere_id into l1, l2 from cantieri a join cantieri b
      on upper(a.cantiere_cnce) = upper(b.cantiere_cnce) and a.cantiere_id < b.cantiere_id
   where a.elimina = 0 and b.elimina = 0 and coalesce(trim(a.lotto),'') <> '' and coalesce(trim(b.lotto),'') <> ''
     and lower(trim(a.lotto)) <> lower(trim(b.lotto)) limit 1;
  if l1 is not null then
    begin
      perform fondi_cantieri(l1, array[l2]);
      raise exception 'NONFERMATA';
    exception when others then
      if sqlerrm = 'NONFERMATA' then raise exception 'due lotti diversi si sono uniti'; end if;
    end;
    rep := rep || jsonb_build_object('lotti', 'fermati');
  else
    rep := rep || jsonb_build_object('lotti', 'nessuna coppia di lotti su cui provare');
  end if;

  -- ═══ PRIVILEGI ═══ mai chiamabili da chi non ha fatto l'accesso
  if has_function_privilege('anon', 'public.fondi_imprese(text, text[])', 'execute')
     or has_function_privilege('anon', 'public.fondi_persone(uuid, uuid[])', 'execute')
     or has_function_privilege('anon', 'public.fondi_cantieri(text, text[], text)', 'execute')
     or has_function_privilege('authenticated', 'public.s_unioni_autorizzato()', 'execute') then
    raise exception 'privilegi sbagliati sulle funzioni di unione';
  end if;

  raise notice 'unioni complete: %', rep;
end $$;

rollback;
