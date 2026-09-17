-- Test del coordinatore sui cantieri critici (17/09/2026): lavora dal gestionale
-- visite, non ha il ruolo di segreteria, ma sui casi legge, risponde al tecnico,
-- registra decisioni e scrive il testo di merito della segnalazione. Il tecnico
-- del caso non puo' toccarli e non vede la riga riservata. Transazione annullata.
begin;

do $$
declare v_co text; v_tec text; v_tid text; v_id bigint; n bigint;
begin
  select lower(valore) into v_co from public.s_config where chiave = 'coordinatore_email';
  assert v_co is not null, 'serve coordinatore_email in s_config';
  select tecnico_id, lower(email) into v_tid, v_tec from public.tecnici
   where attivo and email is not null and lower(email) not in (v_co, 'cptpd@did.formedilpadova.it') order by tecnico_cognome limit 1;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  insert into public.s_cantieri_critici (origine, tecnico_id, data_evento, impresa_nome, cantiere_desc, note)
  values ('manuale', v_tid, current_date, 'TEST', 'via Test', 'test') returning id into v_id;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_co)::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_coordinatore() and not public.is_segreteria(), 'il coordinatore non e'' segreteria';
  update public.s_cantieri_critici set testo_merito = '  Ponteggi senza parapetti.  ' where id = v_id;
  update public.s_cantieri_critici set gestione_note = 'Torniamo in cantiere.', stato = 'in_gestione' where id = v_id;
  insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico) values (v_id, 'decisione', 'Coordinatore: Ulteriore visita.', true);
  assert (select testo_merito = 'Ponteggi senza parapetti.' and merito_da = v_co and merito_il is not null and gestito_da = v_co
            from public.s_cantieri_critici where id = v_id), 'merito e risposta portano il suo nome';
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'nota' and not visibile_tecnico and autore = v_co) = 1,
    'la scrittura del merito resta in cronologia, riservata';

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_tec)::text, true);
  perform set_config('role', 'authenticated', true);
  update public.s_cantieri_critici set testo_merito = 'x' where id = v_id;
  get diagnostics n = row_count;
  assert n = 0, 'il tecnico non scrive il merito';
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'nota') = 0, 'il tecnico non vede la riga riservata';
  assert (select count(*) from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'decisione') = 1, 'il tecnico vede la decisione';

  raise notice 'OK coordinatore sui cantieri critici';
end $$;

rollback;
