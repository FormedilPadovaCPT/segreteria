-- Test del registro dei cantieri critici (17/09/2026): s_cantieri_critici +
-- s_cantieri_critici_eventi + trigger sulle visite + vista di compatibilita'.
-- Tutto dentro una transazione che viene annullata: non resta niente.
begin;

do $$
declare v_tec text; v_altro text; v_id bigint; v_id2 bigint; v_vis text; n bigint; ok boolean;
begin
  select lower(email) into v_tec from public.tecnici
   where attivo and email is not null and lower(email) not like 'cptpd%' order by tecnico_cognome limit 1;
  select tecnico_id into v_altro from public.tecnici where attivo and lower(email) <> v_tec limit 1;
  assert v_tec is not null, 'serve un tecnico attivo con la mail';

  -- ===== il tecnico =====
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_tec)::text, true);
  perform set_config('role', 'authenticated', true);

  -- dalla vista di compatibilita' (la strada dell'app online prima del 17/09)
  insert into public.s_dinieghi_accesso (data_diniego, impresa_nome, cantiere_desc, note)
  values (current_date, 'TEST srl', 'via Test 1', 'test') returning id into v_id;
  assert (select origine = 'accesso_negato' and segnalato_da = v_tec and tecnico_nome is not null and stato = 'nuovo'
            from public.s_cantieri_critici where id = v_id), 'la vista scrive un accesso negato a nome del tecnico';

  -- non puo' spacciarsi per un altro, ne' aprire un caso che non sia un accesso negato
  insert into public.s_cantieri_critici (origine, tecnico_id, data_evento, impresa_nome, cantiere_desc, note, motivo, presente_cognome)
  values ('manuale', v_altro, current_date, 'TEST2', 'c', 'n', 'rifiutato', 'Rossi') returning id into v_id2;
  assert (select origine = 'accesso_negato' and segnalato_da = v_tec and presente_cognome = 'Rossi'
            from public.s_cantieri_critici where id = v_id2), 'origine e tecnico non si scelgono';

  -- non gestisce e non scrive in cronologia; legge solo gli eventi visibili dei suoi casi
  update public.s_cantieri_critici set stato = 'in_gestione' where id = v_id;
  get diagnostics n = row_count;
  assert n = 0, 'il tecnico non gestisce';
  ok := false;
  begin insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo) values (v_id, 'nota', 'x');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'il tecnico non scrive in cronologia';
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id) = 1, 'il tecnico vede l''apertura';

  ok := false;
  begin insert into public.s_cantieri_critici (data_evento, impresa_nome, cantiere_desc, note) values (current_date + 1, 'x', 'y', 'z');
  exception when raise_exception then ok := true; end;
  assert ok, 'la data non puo'' essere nel futuro';

  -- ===== la segreteria =====
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_segreteria(), 'cptpd@ e'' la segreteria';

  ok := false;
  begin update public.s_cantieri_critici set stato = 'chiuso' where id = v_id;
  exception when raise_exception then ok := true; end;
  assert ok, 'non si chiude senza scrivere com''e'' stato gestito';

  update public.s_cantieri_critici set stato = 'attesa_impresa', termine_il = current_date + 15,
         note = 'riscritta', presente_cognome = 'Cambiato' where id = v_id;
  assert (select note = 'test' and presente_cognome is null and termine_il = current_date + 15 and gestito_da is not null
            from public.s_cantieri_critici where id = v_id), 'quello che ha scritto il tecnico non si riscrive';
  insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo, autore) values (v_id, 'nota', 'riservata', 'qualcun@ltro');
  assert (select autore = 'cptpd@did.formedilpadova.it' from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'nota'),
    'l''autore di un evento non si sceglie';
  update public.s_cantieri_critici set stato = 'chiuso', esito = 'risolta_altro', gestione_note = 'ha richiamato' where id = v_id;
  assert (select termine_il is null and esito = 'risolta_altro' from public.s_cantieri_critici where id = v_id), 'chiudendo il termine decade';
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'stato') = 2, 'ogni cambio di stato resta in cronologia';

  -- ===== il tecnico non vede la nota riservata =====
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_tec)::text, true);
  perform set_config('role', 'authenticated', true);
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'nota') = 0, 'la nota d''ufficio resta dell''ufficio';

  -- ===== la spunta nel verbale apre il caso, una volta sola =====
  perform set_config('role', 'postgres', true);
  select visita_id into v_vis from public.visite
   where coalesce(elimina, 0) = 0 and not coalesce(segnalazione, false) and cantiere_id is not null
     and not exists (select 1 from public.s_cantieri_critici c where c.visita_id = visite.visita_id)
   order by data_visita desc limit 1;
  update public.visite set segnalazione = true where visita_id = v_vis;
  update public.visite set segnalazione = true where visita_id = v_vis;
  assert (select count(*) from public.s_cantieri_critici where visita_id = v_vis and origine = 'proposta_segnalazione' and tecnico_nome is not null) = 1,
    'una proposta per verbale, col tecnico del verbale';
  assert (select count(*) from public.s_dinieghi_accesso where id in (select id from public.s_cantieri_critici where visita_id = v_vis)) = 0,
    'la vista di compatibilita'' mostra solo gli accessi negati';

  -- ===== niente per anon =====
  assert not has_table_privilege('anon', 'public.s_cantieri_critici', 'select'), 'anon non legge il registro';
  assert not has_table_privilege('anon', 'public.s_cantieri_critici_eventi', 'select'), 'anon non legge la cronologia';
  assert not has_function_privilege('anon', 'public.s_cantieri_critici_da_visita()', 'execute'), 'funzioni di trigger chiuse ad anon';

  raise notice 'OK cantieri critici';
end $$;

rollback;
