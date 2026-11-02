-- Test del contatore dell'ASSEMBLEA SINDACALE (02/11/2026, migrazione 2026_11_02_ferie_assemblea_sindacale.sql).
-- In una transazione annullata:
--   · le 12 ore si contano per anno formativo dal 1° settembre: agosto sta nell'anno prima;
--   · contano le righe «Riunione sindacale» e le partecipazioni comunicate non ancora in righe;
--   · non contano altre causali, né la richiesta esclusa;
--   · oltre le 12 il residuo è zero, non negativo;
--   · chi non è segreteria riceve un errore, non uno zero muto.
begin;

do $$
declare j jsonb; r1 bigint; ok boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.s_presenze_extra(dipendente, data, causale, ore_min, note) values
    ('Prova Test', '2026-08-20', 'Riunione sindacale', 180, 'anno formativo 2025-26'),
    ('Prova Test', '2026-09-15', 'Riunione sindacale', 120, 'prova'),
    ('Prova Test', '2026-10-01', 'Permesso sindacale RSU', 240, 'altro monte'),
    ('Prova Test', '2026-10-02', 'Riunione', 60, 'riunione di lavoro');
  insert into public.s_ferie_richieste(dipendente, tipo, data_inizio, ore, monte, aut_stato, aut_modalita, righe_generate)
    values ('Prova Test', 'riunione_sindacale', '2026-11-10', 3, 'permessi_sindacali', 'approvata', 'assemblea', false)
    returning id into r1;

  j := public.s_assemblea_ore('Prova Test', '2026-11-10');
  assert j->>'anno' = '2026-27', 'anno formativo 2026-27, non ' || (j->>'anno');
  assert (j->>'anno_da')::date = '2026-09-01' and (j->>'anno_a')::date = '2027-08-31', 'dal 1/9 al 31/8';
  assert (j->>'tetto_min')::int = 720, '12 ore';
  assert (j->>'usate_min')::int = 120, 'conta la sola riunione sindacale di settembre: ' || (j->>'usate_min');
  assert (j->>'comunicate_min')::int = 180, 'conta la partecipazione comunicata';
  assert (j->>'residuo_min')::int = 420, 'restano 7 ore';

  j := public.s_assemblea_ore('Prova Test', '2026-11-10', r1);
  assert (j->>'comunicate_min')::int = 0, 'la richiesta esclusa non si conta';

  j := public.s_assemblea_ore('Prova Test', '2026-08-31');
  assert j->>'anno' = '2025-26' and (j->>'usate_min')::int = 180, 'il 31/8 è ancora l''anno prima';

  insert into public.s_presenze_extra(dipendente, data, causale, ore_min) values ('Prova Test', '2026-12-01', 'Riunione sindacale', 600);
  j := public.s_assemblea_ore('Prova Test', '2027-01-10');
  assert (j->>'residuo_min')::int = 0, 'oltre le 12 il residuo è zero';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'nessuno@esempio.it')::text, true);
  ok := false;
  begin perform public.s_assemblea_ore('Prova Test', '2026-11-10'); exception when others then ok := sqlerrm like '%lo legge la segreteria%'; end;
  assert ok, 'chi non è segreteria riceve un errore';
end $$;

rollback;
