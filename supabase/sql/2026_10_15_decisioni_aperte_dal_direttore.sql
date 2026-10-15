-- ============================================================
-- IL DIRETTORE APRE QUESTIONI NEL REGISTRO DELLE DECISIONI
-- (15/10/2026, chiesto dall'utente: «se volessi dare la possibilità al
-- direttore di poter inserire Questioni in attesa di decisione come il
-- coordinatore e la segreteria»; «le decisioni potrebbe farle prendere
-- anche a segreteria o coordinatore oltre che presidenza e commissione»)
--
-- 1. due decisori nuovi: segreteria e coordinatore (rispondono dalla Zona
--    Coordinatore, come per la Commissione);
-- 2. il Direttore può aprire una questione, e gestire quelle che ha aperto
--    lui (priorità, titolo, ritiro, presa in carico della decisione);
-- 3. una questione riservata non va alla segreteria, che le riservate non
--    le vede;
-- 4. le risposte e gli avvisi conoscono i decisori nuovi; chi ha aperto la
--    questione riceve l'avviso sulla sua pagina (Direzione per il Direttore).
-- ============================================================
alter table public.s_decisioni drop constraint if exists s_decisioni_decisore_check;
alter table public.s_decisioni add constraint s_decisioni_decisore_check
  check (decisore in ('direttore', 'presidenza', 'commissione', 'segreteria', 'coordinatore'));
alter table public.s_decisioni drop constraint if exists s_decisioni_riservata_decisore_chk;
alter table public.s_decisioni add constraint s_decisioni_riservata_decisore_chk
  check (not (riservata and decisore = 'segreteria'));

drop policy if exists s_decisioni_ins on public.s_decisioni;
create policy s_decisioni_ins on public.s_decisioni for insert to authenticated
  with check ((select public.is_coordinatore()) or (select public.is_segreteria()) or (select public.is_direttore()));

drop policy if exists s_decisioni_upd on public.s_decisioni;
create policy s_decisioni_upd on public.s_decisioni for update to authenticated
  using (((select public.is_segreteria()) and not riservata)
      or ((select public.is_coordinatore()) and stato <> 'proposta')
      or ((select public.is_direttore()) and stato <> 'proposta'
          and lower(coalesce(aperta_da, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))))
  with check (((select public.is_segreteria()) and not riservata)
      or ((select public.is_coordinatore()) and stato <> 'proposta')
      or ((select public.is_direttore()) and stato <> 'proposta'
          and lower(coalesce(aperta_da, '')) = lower(coalesce((select auth.jwt() ->> 'email'), ''))));

/* chi riceve gli avvisi di un decisore */
create or replace function public.push_destinatari_direzione(p_chi text)
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct x) filter (where coalesce(x, '') <> ''), '{}') from (
    select lower(trim(valore)) as x from s_config
     where (p_chi = 'direttore'    and chiave = 'direttore_email')
        or (p_chi = 'presidenza'   and chiave in ('presidente_email', 'vicepresidente_email'))
        or (p_chi = 'coordinatore' and chiave = 'coordinatore_email')
    union all
    select 'cptpd@did.formedilpadova.it' where p_chi = 'segreteria'
  ) t;
$$;

/* la pagina dove ciascuno trova le questioni (per il testo e il link degli avvisi) */
create or replace function public.decisioni_pagina(p_chi text)
returns text language sql immutable as $$
  select case when p_chi = 'presidenza' then 'Presidenza' when p_chi = 'direttore' then 'Direzione' else 'Zona Coordinatore' end;
$$;
create or replace function public.decisioni_vista(p_chi text)
returns text language sql immutable as $$
  select case when p_chi in ('presidenza', 'direttore') then './?vista=direzione' else './?vista=admin' end;
$$;

create or replace function public.push_da_decisioni()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_e text; v_io text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  begin
    if new.stato = 'aperta' and new.decisore in ('direttore', 'presidenza', 'segreteria', 'coordinatore')
       and (tg_op = 'INSERT' or old.stato is distinct from 'aperta') then
      foreach v_e in array push_destinatari_direzione(new.decisore) loop
        if v_e <> v_io then
          perform push_accoda(v_e, 'decisione_nuova', 'Una questione da decidere',
            'C''è una questione che aspetta la tua decisione nella pagina ' || decisioni_pagina(new.decisore) || '.',
            decisioni_vista(new.decisore), 'decisione-' || new.id);
        end if;
      end loop;
    end if;
  exception when others then raise warning 'push_da_decisioni: %', sqlerrm; end;
  return null;
end $function$;

create or replace function public.push_decisioni_rinviate_oggi()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_e text; n integer := 0;
begin
  for r in select decisore, count(*) as quante from s_decisioni
            where stato = 'rinviata' and rinviata_al = (now() at time zone 'Europe/Rome')::date
              and decisore in ('direttore', 'presidenza', 'segreteria', 'coordinatore')
            group by decisore loop
    foreach v_e in array push_destinatari_direzione(r.decisore) loop
      perform push_accoda(v_e, 'decisione_rinvio',
        case when r.quante = 1 then 'Torna oggi una questione rinviata' else 'Tornano oggi ' || r.quante || ' questioni rinviate' end,
        'La trovi nella pagina ' || decisioni_pagina(r.decisore) || ', fra quelle in attesa.',
        decisioni_vista(r.decisore), 'rinvio-' || r.decisore || '-' || (now() at time zone 'Europe/Rome')::date);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $function$;

create or replace function public.s_decisione_rispondi(p_id bigint, p_esito text, p_testo text default null, p_rinvio_al date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare d record; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_nome text; v_ok boolean := false; v_coord text;
        v_dir text; v_pag text; v_vista text;
begin
  select * into d from s_decisioni where id = p_id;
  if d.id is null then raise exception 'Questione % non trovata', p_id; end if;
  if d.stato in ('chiusa', 'ritirata') then raise exception 'La questione % è già %', p_id, d.stato; end if;
  if p_esito not in ('decisa', 'rinviata', 'incontro') then raise exception 'Esito non valido: %', p_esito; end if;
  if p_esito = 'decisa' and nullif(trim(coalesce(p_testo, '')), '') is null then raise exception 'Scrivi la decisione'; end if;
  if p_esito = 'rinviata' and (p_rinvio_al is null or p_rinvio_al <= current_date) then raise exception 'Per rinviare serve una data futura'; end if;
  if p_esito = 'incontro' and p_rinvio_al is not null and p_rinvio_al < current_date then raise exception 'La data dell''incontro non può essere nel passato'; end if;
  v_ok := case d.decisore
            when 'direttore'    then coalesce(is_direttore(), false)
            when 'presidenza'   then coalesce(is_presidenza(), false)
            when 'commissione'  then coalesce(is_segreteria(), false) or coalesce(is_coordinatore(), false)
            when 'segreteria'   then coalesce(is_segreteria(), false)
            when 'coordinatore' then coalesce(is_coordinatore(), false)
          end;
  if not coalesce(v_ok, false) then raise exception 'La risposta spetta a: %', d.decisore; end if;
  select coalesce(
    (select nome from app_ruoli where lower(email) = v_email and stato = 'attivo' limit 1),
    (select trim(concat_ws(' ', tecnico_nome, tecnico_cognome)) from tecnici where lower(email) = v_email limit 1), v_email) into v_nome;
  perform set_config('app.decisione_via_funzione', 'si', true);
  update s_decisioni set
    stato = p_esito,
    decisione = nullif(trim(coalesce(p_testo, '')), ''),
    rinviata_al = case when p_esito = 'rinviata' then p_rinvio_al else null end,
    incontro_data = case when p_esito = 'incontro' then p_rinvio_al else null end,
    decisa_da = v_nome, decisa_da_email = v_email, decisa_il = now()
  where id = p_id;
  perform set_config('app.decisione_via_funzione', '', true);
  begin
    /* l'avviso a chi ha aperto, sulla SUA pagina: il Direttore in Direzione, gli altri nella Zona Coordinatore */
    select lower(trim(valore)) into v_dir from s_config where chiave = 'direttore_email';
    if d.aperta_da is not null and lower(d.aperta_da) = coalesce(v_dir, '') then
      v_pag := 'nella pagina Direzione'; v_vista := './?vista=direzione';
    else
      v_pag := 'nella Zona Coordinatore'; v_vista := './?vista=admin';
    end if;
    if d.aperta_da is not null and d.aperta_da <> v_email then
      perform push_accoda(d.aperta_da, 'decisione',
        case p_esito when 'decisa' then 'C''è una decisione' when 'incontro' then 'Proposto un incontro' else 'Una questione è stata rinviata' end,
        case p_esito when 'decisa' then 'Una questione che avevi aperto ha avuto risposta: la trovi ' || v_pag || '.'
                     when 'incontro' then 'Per una questione che avevi aperto è stato proposto un incontro: la trovi ' || v_pag || '.'
                     else 'Una questione che avevi aperto è stata rinviata: la data è ' || v_pag || '.' end,
        v_vista, 'decisione-' || p_id);
    end if;
    if p_esito = 'incontro' then
      select lower(valore) into v_coord from s_config where chiave = 'coordinatore_email';
      if coalesce(v_coord, '') <> '' and v_coord <> v_email then
        perform push_accoda(v_coord, 'incontro_proposto', 'Proposto un incontro',
          'Per una questione della Zona Coordinatore è stato proposto un incontro' || coalesce(' per il ' || to_char(p_rinvio_al, 'DD/MM/YYYY'), '') || '.',
          './?vista=admin', 'incontro-' || p_id);
      end if;
      if 'cptpd@did.formedilpadova.it' <> v_email then
        perform push_accoda('cptpd@did.formedilpadova.it', 'incontro_proposto', 'Proposto un incontro',
          'Per una questione della Zona Coordinatore è stato proposto un incontro' || coalesce(' per il ' || to_char(p_rinvio_al, 'DD/MM/YYYY'), '') || '.',
          './?vista=admin', 'incontro-' || p_id);
      end if;
    end if;
  exception when others then raise warning 's_decisione_rispondi avviso: %', sqlerrm; end;
  return jsonb_build_object('id', p_id, 'stato', p_esito, 'decisa_da', v_nome);
end $function$;

revoke execute on function public.decisioni_pagina(text) from public, anon;
revoke execute on function public.decisioni_vista(text) from public, anon;
revoke execute on function public.push_destinatari_direzione(text) from public, anon;
revoke execute on function public.push_da_decisioni() from public, anon;
revoke execute on function public.push_decisioni_rinviate_oggi() from public, anon;
revoke execute on function public.s_decisione_rispondi(bigint, text, text, date) from public, anon;
grant execute on function public.s_decisione_rispondi(bigint, text, text, date) to authenticated;
