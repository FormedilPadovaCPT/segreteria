-- Test della conferma vera di Presidente/Vicepresidente sui cantieri
-- critici (25/09/2026): s_critico_coinvolgi_presidenza la può chiamare
-- Direttore, coordinatore o segreteria; s_critico_decide_presidenza SOLO
-- chi è Presidenza. Verificato anche che la select su s_cantieri_critici
-- e s_cantieri_critici_eventi ora comprende is_presidenza() (mancava:
-- senza, il Presidente vedeva sempre zero, anche dopo aver risposto).
-- ⚠️ La sparizione del caso dalla coda dopo la decisione (chiesta_il <
-- la decisione) dipende da now(), che in un'unica transazione è
-- costante: verificata a mano fuori da questa transazione (vedi CRONACA),
-- qui si controlla solo che l'evento decisione_organo sia scritto bene.
-- Transazione annullata: non resta niente.
begin;

do $$
declare v_dir text; v_coord text; v_pres text; v_vice text; v_id bigint; v_id2 bigint; r jsonb; ok boolean; d jsonb;
begin
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  select lower(valore) into v_coord from public.s_config where chiave = 'coordinatore_email';
  select lower(valore) into v_pres from public.s_config where chiave = 'presidente_email';
  select lower(valore) into v_vice from public.s_config where chiave = 'vicepresidente_email';
  assert v_pres is not null and v_vice is not null, 'servono presidente_email e vicepresidente_email in s_config';
  assert not has_function_privilege('anon', 'public.s_critico_coinvolgi_presidenza(bigint,text)', 'execute'), 'coinvolgi chiusa ad anon';
  assert not has_function_privilege('anon', 'public.s_critico_decide_presidenza(bigint,text,text)', 'execute'), 'decide chiusa ad anon';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_coord)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.s_cantieri_critici (origine, tecnico_id, data_evento, impresa_nome, cantiere_desc, note)
  values ('manuale', (select tecnico_id from public.tecnici where attivo limit 1), current_date, 'TEST', 'via Test', 'test') returning id into v_id;

  -- il coordinatore coinvolge la presidenza
  r := public.s_critico_coinvolgi_presidenza(v_id, 'nota di prova');
  assert (r ->> 'evento_id') is not null, 'evento coinvolgimento scritto';
  assert (select stato from public.s_cantieri_critici where id = v_id) = 'attesa_decisione', 'stato passato in attesa_decisione';
  assert (select dati ->> 'chi' from public.s_cantieri_critici_eventi where id = (r ->> 'evento_id')::bigint) = 'presidenza', 'il chi tracciato e'' presidenza';

  -- un estraneo non coinvolge né decide per la presidenza
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'nessuno@example.com')::text, true);
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform public.s_critico_coinvolgi_presidenza(v_id, null);
  exception when raise_exception then ok := true; end;
  assert ok, 'un estraneo non coinvolge la presidenza';
  ok := false;
  begin perform public.s_critico_decide_presidenza(v_id, 'segnalare', null);
  exception when raise_exception then ok := true; end;
  assert ok, 'un estraneo non decide per la presidenza';

  -- il presidente vede il caso (prima non vedeva niente: mancava is_presidenza() nelle policy di select)
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_pres)::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_presidenza(), 'il presidente e'' presidenza';
  assert (select count(*) from public.s_cantieri_critici where id = v_id) = 1, 'il presidente legge il caso';
  d := public.s_direzione_in_attesa();
  assert jsonb_array_length(d -> 'critici') = 1 and (d -> 'critici' -> 0 ->> 'id')::bigint = v_id, 'il presidente vede il caso in attesa: ' || d::text;

  -- solo segnalare / non_segnalare, e chi risponde si legge dalla carica
  ok := false;
  begin perform public.s_critico_decide_presidenza(v_id, 'forse', null);
  exception when raise_exception then ok := true; end;
  assert ok, 'solo segnalare / non_segnalare';
  r := public.s_critico_decide_presidenza(v_id, 'segnalare', 'Concordo, procedere.');
  assert (r ->> 'chi') = 'Presidente', 'chi e'' letto da mia_carica(): ' || r::text;
  assert (select autore = v_pres and tipo = 'decisione_organo' and dati ->> 'via' = 'app' and dati ->> 'cosa' = 'segnalare' and dati ->> 'chi' = 'Presidente'
            from public.s_cantieri_critici_eventi where id = (r ->> 'evento_id')::bigint), 'la riga porta la carica giusta e dice che viene dall''app';

  -- il vicepresidente non decide al posto del presidente su un caso non suo, ma il DIRETTORE stesso
  -- può coinvolgere la presidenza su un caso nuovo (segreteria/coordinatore non sono gli unici a poterlo fare)
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_coord)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.s_cantieri_critici (origine, tecnico_id, data_evento, impresa_nome, cantiere_desc, note)
  values ('manuale', (select tecnico_id from public.tecnici where attivo limit 1), current_date, 'TEST2', 'via Test 2', 'test') returning id into v_id2;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  r := public.s_critico_coinvolgi_presidenza(v_id2, null);
  assert (select dati ->> 'da' from public.s_cantieri_critici_eventi where id = (r ->> 'evento_id')::bigint) = 'Direttore', 'anche il Direttore puo'' coinvolgere la presidenza';

  -- ...e il vicepresidente lo vede
  -- (nota: v_id può comparire ancora qui insieme a v_id2 — dentro un'unica
  -- transazione now() è costante, quindi la sua decisione_organo risulta
  -- "non successiva" alla demandata che l'ha preceduta; verificato a mano,
  -- fuori transazione, che sparisce davvero — vedi intestazione del file)
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_vice)::text, true);
  perform set_config('role', 'authenticated', true);
  d := public.s_direzione_in_attesa();
  assert exists (select 1 from jsonb_array_elements(d -> 'critici') e where (e ->> 'id')::bigint = v_id2), 'il vicepresidente vede il caso coinvolto dal Direttore: ' || d::text;

  -- il direttore non vede i casi della presidenza (sono cose distinte)
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  d := public.s_direzione_in_attesa();
  assert jsonb_array_length(d -> 'critici') = 0, 'il Direttore non vede i casi demandati alla presidenza: ' || d::text;

  raise notice 'OK presidenza cantieri critici';
end $$;

rollback;
