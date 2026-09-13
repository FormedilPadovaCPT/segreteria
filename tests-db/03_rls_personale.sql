-- Test della rete di sicurezza decisa il 05/09/2026: un utente autenticato SENZA
-- ruolo non vede niente del gestionale; un tecnico attivo e un viewer si'.
-- Se un giorno una tabella nuova nasce con USING (true), questo test la trova.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"nessuno@esempio.invalid","sub":"00000000-0000-0000-0000-000000000001"}', true);
do $$
declare n bigint; t text; ok boolean;
begin
  assert not public.is_personale(), 'un estraneo non e'' personale';
  foreach t in array array['imprese','visite','visite_checklist','visite_foto','persone','cantieri','tecnici',
                           'ceiv_lista','app_ruoli','s_protocollo','a_pratica','incarichi'] loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, 'un autenticato senza ruolo legge ' || n || ' righe da ' || t;
  end loop;
  -- funzioni security definer (13/09/2026): scavalcano la RLS, il controllo lo fanno loro
  select count(*) into n from public.dash_macroaree();   assert n = 0, 'estraneo: dash_macroaree da'' ' || n || ' righe';
  select count(*) into n from public.dash_ver_visite();  assert n = 0, 'estraneo: dash_ver_visite da'' ' || n || ' righe';
  select count(*) into n from public.dash_macroaree_dettaglio(null, null, null, null, null, 1, 'NC+');
  assert n = 0, 'estraneo: dash_macroaree_dettaglio da'' ' || n || ' righe';
  select count(*) into n from public.committenti_lista(); assert n = 0, 'estraneo: committenti_lista da'' ' || n || ' righe';
  assert public.visite_count_map() = '{}'::jsonb,       'estraneo: visite_count_map non vuota';
  assert public.committenti_duplicati() = '[]'::jsonb,  'estraneo: committenti_duplicati non vuota';
  assert public.committenti_simili('x') = '[]'::jsonb,  'estraneo: committenti_simili non vuota';
  ok := false;
  begin perform public.s_redazione_materia(3); exception when raise_exception then ok := true; end;
  assert ok, 'estraneo: s_redazione_materia non rifiutata';
  foreach t in array array['public.ricontrolli_pendenti(integer)', 'public.s_tariffa(text,date,text)',
                           'public.s_regime_tecnico(text,date)', 'public.s_prossimo_numero(text)',
                           'public.incarichi_ricalcola(bigint,text)', 'public.a_gdv_sync_pratica()',
                           'public.s_redazione_materia_interna(integer)'] loop
    assert not has_function_privilege(t, 'EXECUTE'), 'un autenticato puo'' eseguire ' || t;
  end loop;
  -- nessuna policy USING (true) sulle tabelle con dati (restano solo le tabelle di riferimento)
  select string_agg(tablename || '.' || policyname, ', ') into t
    from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')
     and tablename not in ('checklist_voci', 'comuni_istat', 'comuni_catastali', 'ateco_codici',
                           'comuni_cap', 'imprese_certificazioni_tipi');   -- consultazione, dal 08/09/2026
  assert t is null, 'policy USING (true) su tabelle con dati: ' || t;
  raise notice 'OK: estraneo a zero righe';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare n bigint; ok boolean;
begin
  assert public.is_personale(), 'un tecnico attivo e'' personale';
  select count(*) into n from public.visite;   assert n > 0, 'il tecnico deve vedere le visite';
  select count(*) into n from public.imprese;  assert n > 0, 'il tecnico deve vedere le imprese';
  -- le funzioni del cruscotto e dei committenti non devono essersi chiuse al personale
  select count(*) into n from public.dash_macroaree();    assert n > 0, 'il tecnico deve vedere le macroaree del cruscotto';
  select count(*) into n from public.committenti_lista(); assert n > 0, 'il personale deve vedere i committenti';
  assert public.visite_count_map() <> '{}'::jsonb, 'il tecnico deve vedere il conteggio visite per cantiere';
  -- la materia della redazione social e' della sola segreteria
  ok := false;
  begin perform public.s_redazione_materia(3); exception when raise_exception then ok := true; end;
  assert ok, 'un tecnico non deve leggere la materia della redazione social';
  raise notice 'OK: tecnico vede i dati';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
begin
  assert public.is_segreteria(), 'cptpd e'' segreteria';
  assert public.s_redazione_materia(3) ? 'totali', 'la segreteria deve leggere la materia della redazione social';
  raise notice 'OK: segreteria legge la materia';
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  assert public.s_redazione_materia(3) ? 'totali', 'la chiave di servizio (redazione-social) deve leggere la materia';
  assert has_function_privilege('public.ricontrolli_pendenti(integer)', 'EXECUTE'), 'il promemoria del lunedi'' deve poter chiamare ricontrolli_pendenti';
  raise notice 'OK: chiave di servizio';
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
