-- 36 — Il registro delle firme generale, il ruolo docente, l'RPF (13/10/2026)
-- Prova sul database (workflow «Test database»): ruoli finti, niente resta scritto.
-- Dati INVENTATI: indirizzi che non esistono.
begin;

-- un docente esterno finto, col solo ruolo «docente»
insert into public.app_ruoli (email, ruolo, stato, nome)
values ('docente.prova@esempio.test', 'docente', 'attivo', 'Docente Di Prova');

-- ── chi è docente NON è personale, ma legge la propria riga di app_ruoli ──
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"docente.prova@esempio.test","sub":"00000000-0000-0000-0000-000000000036"}', true);
do $$
declare n bigint;
begin
  assert not public.is_personale(), 'il docente non deve essere personale';
  assert public.is_docente(), 'il docente deve risultare docente';
  assert not public.is_rpf(), 'il docente non e'' l''RPF';
  select count(*) into n from public.app_ruoli; assert n = 1, 'il docente legge la SOLA propria riga di app_ruoli (' || n || ')';
  select count(*) into n from public.imprese;  assert n = 0, 'il docente non legge le imprese';
  select count(*) into n from public.visite;   assert n = 0, 'il docente non legge le visite';
  select count(*) into n from public.s_firme;  assert n = 0, 'il docente senza firme in attesa non vede righe';
  raise notice 'OK: docente fuori dal personale, dentro la propria riga';
end $$;

-- ── la vista di compatibilità e le righe di ciascuno ──
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_id bigint;
begin
  -- una riga senza firmatario (come scrive la funzione del 04/10 attraverso la vista): è del Presidente
  insert into public.s_firme_presidente (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, richiesta_da)
  values ('incarico_docenza', 'docenza:999999', 'Prova vista', 'prova.pdf', 'originali/prova.pdf', repeat('a', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test')
  returning id into v_id;
  assert (select firmatario_ruolo from public.s_firme where id = v_id) = 'presidente', 'senza firmatario la riga e'' del Presidente';
  assert (select firmatario_email from public.s_firme where id = v_id) = (select lower(trim(valore)) from public.s_config where chiave = 'presidente_email'), 'l''indirizzo e'' quello di s_config';
  -- una catena per il docente finto: 1ª firma in attesa, 2ª in coda
  insert into public.s_firme (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, richiesta_da, firmatario_email, firmatario_ruolo, ordine, stato)
  values ('scheda_formativa', 'scheda:1', 'Scheda di prova', 'scheda.pdf', 'originali/scheda.pdf', repeat('b', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test', 'docente.prova@esempio.test', 'docente', 1, 'in_attesa'),
         ('scheda_formativa', 'scheda:1', 'Scheda di prova', 'scheda.pdf', 'originali/scheda.pdf', repeat('b', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test', 'rpf.prova@esempio.test', 'rpf', 2, 'in_coda');
  raise notice 'OK: vista e catena scritte';
end $$;

-- lo stesso firmatario non può avere due richieste vive per lo stesso documento
do $$
begin
  begin
    insert into public.s_firme (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, richiesta_da, firmatario_email, firmatario_ruolo, ordine, stato)
    values ('scheda_formativa', 'scheda:1', 'Doppione', 'scheda.pdf', 'originali/scheda.pdf', repeat('b', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test', 'DOCENTE.prova@esempio.test', 'docente', 3, 'in_attesa');
    raise exception 'ATTESO_FALLIMENTO';
  exception
    when unique_violation then raise notice 'OK: una richiesta viva per firmatario e documento';
  end;
end $$;

-- un ruolo non previsto non entra in app_ruoli
do $$
begin
  begin
    insert into public.app_ruoli (email, ruolo, stato, nome) values ('x@esempio.test', 'ospite', 'attivo', 'X');
    raise exception 'ATTESO_FALLIMENTO';
  exception
    when check_violation then raise notice 'OK: ruolo fuori elenco rifiutato';
  end;
end $$;

-- ── il docente vede le SUE righe, non quelle dell'RPF né del Presidente ──
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"docente.prova@esempio.test","sub":"00000000-0000-0000-0000-000000000036"}', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.s_firme; assert n = 1, 'il docente vede la sola riga sua (' || n || ')';
  select count(*) into n from public.s_firme_presidente; assert n = 1, 'anche attraverso la vista (security_invoker)';
  assert (select firmatario_ruolo from public.s_firme limit 1) = 'docente';
  raise notice 'OK: RLS per firmatario';
end $$;

-- ── la segreteria vede tutto ──
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.s_firme where rif in ('docenza:999999', 'scheda:1'); assert n = 3, 'la segreteria vede tutte le righe (' || n || ')';
  assert not public.is_docente(), 'la segreteria non e'' docente';
  raise notice 'OK: segreteria';
end $$;

-- ── anon a zero ──
reset role;
set local role anon;
do $$
declare n bigint;
begin
  select count(*) into n from pg_proc p where p.proname in ('is_docente', 'is_rpf', 'mia_persona_id', 'is_docente_del_corso', 's_firme_default_firmatario')
     and p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert n = 0, n || ' funzioni delle firme eseguibili da anon';
  raise notice 'OK: anon a zero sulle firme';
end $$;

rollback;
