-- Test delle attività dei mesi passati mai entrate in un riepilogo (segreteria, 07/10/2026:
-- 2026_10_07_prestazioni_mai_registrate.sql). Con l'accesso della segreteria, in una transazione annullata:
--   · la docenza di De Marco al corso 203 (settembre, mese chiuso) esce chiudendo ottobre, col mese d'origine;
--   · registrata, non esce più;
--   · un mese ancora aperto non si ripropone: si chiude da sé.
begin;
select set_config('request.jwt.claims', json_build_object('email','cptpd@did.formedilpadova.it','role','authenticated',
  'sub',(select id::text from auth.users where email='cptpd@did.formedilpadova.it'))::text, true);

do $$
declare tid text; r jsonb; n int;
begin
  select tecnico_id into tid from public.tecnici where tecnico_cognome ilike 'De Marco%' and attivo limit 1;
  assert tid is not null, 'serve De Marco';

  r := public.s_prestazioni_mai_registrate(tid, 2026, 10);
  assert exists (select 1 from jsonb_array_elements(r) e where (e->>'corso_incarico_id')::bigint = 143
                   and (e->>'origine_anno')::int = 2026 and (e->>'origine_mese')::int = 9), 'la docenza del 19/09 esce chiudendo ottobre';
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'prestazione_id' is not null), 'solo righe mai registrate';
  assert not exists (select 1 from jsonb_array_elements(r) e where (e->>'origine_anno')::int * 100 + (e->>'origine_mese')::int >= 202610), 'solo mesi prima';

  -- un mese ancora aperto si chiude da sé: non si ripropone
  update public.s_incarichi_mensili set stato = 'aperto' where tecnico_id = tid and anno = 2026 and mese = 9;
  r := public.s_prestazioni_mai_registrate(tid, 2026, 10);
  assert not exists (select 1 from jsonb_array_elements(r) e where (e->>'origine_mese')::int = 9 and (e->>'origine_anno')::int = 2026), 'settembre aperto: niente';
  update public.s_incarichi_mensili set stato = 'pagato' where tecnico_id = tid and anno = 2026 and mese = 9;

  -- registrata, non esce più
  insert into public.s_prestazioni (tecnico_id, data, anno, mese, tipo, quantita, importo, corso_incarico_id, origine)
  values (tid, date '2026-09-19', 2026, 9, 'docenza', 3.5, 0, 143, 'prova test 28');
  r := public.s_prestazioni_mai_registrate(tid, 2026, 10);
  assert not exists (select 1 from jsonb_array_elements(r) e where (e->>'corso_incarico_id')::bigint = 143), 'registrata: non esce più';

  raise notice 'OK 28_prestazioni_mai_registrate';
end $$;

-- chi non è segreteria, coordinatore o Direttore non la usa
select set_config('request.jwt.claims', '{"email":"nessuno@example.invalid","role":"authenticated"}', true);
do $$ declare ok boolean := false; begin
  begin perform public.s_prestazioni_mai_registrate('x', 2026, 10); exception when others then ok := sqlerrm like 'Non autorizzato%'; end;
  assert ok, 'riservata';
end $$;

rollback;
