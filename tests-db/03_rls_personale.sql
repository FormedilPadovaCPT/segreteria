-- Test della rete di sicurezza decisa il 05/09/2026: un utente autenticato SENZA
-- ruolo non vede niente del gestionale; un tecnico attivo e un viewer si'.
-- Se un giorno una tabella nuova nasce con USING (true), questo test la trova.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"nessuno@esempio.invalid","sub":"00000000-0000-0000-0000-000000000001"}', true);
do $$
declare n bigint; t text;
begin
  assert not public.is_personale(), 'un estraneo non e'' personale';
  foreach t in array array['imprese','visite','visite_checklist','visite_foto','persone','cantieri','tecnici',
                           'ceiv_lista','app_ruoli','s_protocollo','a_pratica','incarichi'] loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, 'un autenticato senza ruolo legge ' || n || ' righe da ' || t;
  end loop;
  -- nessuna policy USING (true) sulle tabelle con dati (restano solo le tabelle di riferimento)
  select string_agg(tablename || '.' || policyname, ', ') into t
    from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')
     and tablename not in ('checklist_voci', 'comuni_istat', 'comuni_catastali', 'ateco_codici');
  assert t is null, 'policy USING (true) su tabelle con dati: ' || t;
  raise notice 'OK: estraneo a zero righe';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare n bigint;
begin
  assert public.is_personale(), 'un tecnico attivo e'' personale';
  select count(*) into n from public.visite;   assert n > 0, 'il tecnico deve vedere le visite';
  select count(*) into n from public.imprese;  assert n > 0, 'il tecnico deve vedere le imprese';
  raise notice 'OK: tecnico vede i dati';
end $$;

reset role;
set local role anon;
do $$
declare n bigint;
begin
  select count(*) into n from public.imprese; assert n = 0, 'anon legge imprese';
  select count(*) into n from public.visite;  assert n = 0, 'anon legge visite';
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  assert n = 0, n || ' funzioni di public eseguibili da anon';
  raise notice 'OK: anon a zero';
end $$;

rollback;
