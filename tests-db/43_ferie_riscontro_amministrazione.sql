-- Test del riscontro delle richieste di ferie/permessi/recupero per l'Amministrazione
-- (19/10/2026, migrazione 2026_10_19_ferie_banca_ore_riscontro.sql).
-- In una transazione annullata:
--   · l'Amministrazione vede le richieste APPROVATE, non quelle in attesa o respinte;
--   · vede la fotografia della banca ore sulla richiesta, ma non le righe di banca ore;
--   · la presa visione la registra solo lei, solo su una richiesta approvata, e una volta sola.
begin;

do $$
declare a bigint; b bigint; n int; ok boolean; v public.s_ferie_richieste; prima timestamptz;
begin
  insert into public.s_ferie_richieste(dipendente, tipo, data_inizio, data_fine, ore, monte, aut_stato, banca_righe, banca_saldo_prima_min)
    values ('Prova Test', 'recupero', current_date, current_date, 2, 'banca_ore', 'approvata',
            '[{"id": 1, "data": "2026-09-07", "ore_min": 120, "note": "prova"}]'::jsonb, 120) returning id into a;
  insert into public.s_ferie_richieste(dipendente, tipo, data_inizio, ore, monte, aut_stato)
    values ('Prova Test', 'ferie', current_date, 8, 'ferie', 'richiesta') returning id into b;

  -- l'Amministrazione
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'amministrazione@formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.s_ferie_richieste where id in (a, b);
  assert n = 1, 'l''Amministrazione vede la sola richiesta approvata';
  select count(*) into n from public.s_ferie_richieste where id = a and (banca_righe -> 0 ->> 'ore_min')::int = 120 and banca_saldo_prima_min = 120;
  assert n = 1, 'e la fotografia della banca ore che porta';
  select count(*) into n from public.s_presenze_extra;
  assert n = 0, 'le righe di banca ore restano della segreteria';

  ok := false; begin perform public.s_ferie_presa_visione(b); exception when others then ok := sqlerrm like '%non trovata o non approvata%'; end;
  assert ok, 'una richiesta non approvata non si prende in visione';
  v := public.s_ferie_presa_visione(a);
  assert v.amm_visto_il is not null and v.amm_visto_da = 'amministrazione@formedilpadova.it', 'presa visione registrata con chi e quando';
  prima := v.amm_visto_il;
  v := public.s_ferie_presa_visione(a);
  assert v.amm_visto_il = prima, 'ripremere non cambia la data della prima presa visione';

  ok := false; begin update public.s_ferie_richieste set aut_stato = 'respinta' where id = a; get diagnostics n = row_count; ok := n = 0; exception when others then ok := true; end;
  assert ok, 'l''Amministrazione non modifica la richiesta';

  -- la segreteria non firma al suo posto
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  ok := false; begin perform public.s_ferie_presa_visione(a); exception when others then ok := sqlerrm like '%la registra l''Amministrazione%'; end;
  assert ok, 'la presa visione la registra solo l''Amministrazione';
  select count(*) into n from public.s_ferie_richieste where id in (a, b);
  assert n = 2, 'la segreteria vede tutte le richieste';

  -- chi non ha nessun ruolo non vede niente
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'nessuno@esempio.it')::text, true);
  select count(*) into n from public.s_ferie_richieste where id in (a, b);
  assert n = 0, 'senza ruolo nessuna richiesta';

  perform set_config('role', 'postgres', true);
  raise notice 'OK riscontro delle richieste per l''Amministrazione';
end $$;

rollback;
