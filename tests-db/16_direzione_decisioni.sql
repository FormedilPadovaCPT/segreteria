-- Test del registro delle questioni in attesa di decisione (25/09/2026):
-- coordinatore e segreteria aprono, il Direttore risponde SOLO con
-- s_decisione_rispondi, la Presidenza vede solo le questioni sue, la
-- segreteria non vede le riservate, nessuno cancella. Transazione annullata.
begin;

do $$
declare v_dir text; v_coord text; v_pres text; v_id bigint; v_id2 bigint; r jsonb; ok boolean; n int;
begin
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  select lower(valore) into v_coord from public.s_config where chiave = 'coordinatore_email';
  select lower(email) into v_pres from public.app_ruoli where carica = 'presidente' and stato = 'attivo' limit 1;
  assert v_dir is not null and v_coord is not null and v_pres is not null, 'servono direttore, coordinatore e presidente';
  assert not has_function_privilege('anon', 'public.s_decisione_rispondi(bigint,text,text,date)', 'execute'), 'chiusa ad anon';
  assert not has_function_privilege('anon', 'public.s_direzione_in_attesa()', 'execute'), 'elenco chiuso ad anon';

  -- il coordinatore apre due questioni: una per il Direttore, una riservata
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_coord)::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.s_decisioni (questione, riguarda, decisore) values ('TEST: si rinnova il contratto?', 'Tecnico di prova', 'direttore') returning id into v_id;
  insert into public.s_decisioni (questione, decisore, riservata) values ('TEST riservata', 'direttore', true) returning id into v_id2;
  assert (select aperta_da = v_coord and stato = 'aperta' from public.s_decisioni where id = v_id), 'chi apre lo mette il database';
  assert (select count(*) from public.s_decisioni_eventi where decisione_id = v_id and tipo = 'apertura') = 1, 'cronologia: apertura';
  -- il coordinatore non decide al posto del Direttore, ne'' a mano ne'' con la funzione
  ok := false;
  begin update public.s_decisioni set stato = 'decisa', decisione = 'x' where id = v_id;
  exception when raise_exception then ok := true; end;
  assert ok, 'la decisione non si scrive a mano';
  ok := false;
  begin perform public.s_decisione_rispondi(v_id, 'decisa', 'x');
  exception when raise_exception then ok := true; end;
  assert ok, 'la risposta spetta al Direttore';
  -- ma puo'' ritirarla, e cancellare no
  ok := false;
  begin delete from public.s_decisioni where id = v_id;
  exception when insufficient_privilege then ok := true; end;
  assert ok or (select count(*) from public.s_decisioni where id = v_id) = 1, 'non si cancella';

  -- la segreteria: vede la prima, non la riservata
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  assert (select count(*) from public.s_decisioni where id in (v_id, v_id2)) = 1, 'la segreteria non vede la riservata';

  -- la Presidenza: non vede le questioni del Direttore
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_pres)::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_presidenza(), 'il presidente e'' presidenza';
  assert (select count(*) from public.s_decisioni where id in (v_id, v_id2)) = 0, 'la presidenza vede solo le sue';
  ok := false;
  begin perform public.s_decisione_rispondi(v_id, 'decisa', 'x');
  exception when raise_exception then ok := true; end;
  assert ok, 'la presidenza non risponde per il Direttore';

  -- il Direttore: vede tutte e due, non scrive a mano, risponde con la funzione
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_direttore(), 'l''indirizzo di s_config e'' il Direttore';
  assert (select count(*) from public.s_decisioni where id in (v_id, v_id2)) = 2, 'il Direttore vede anche la riservata';
  r := public.s_direzione_in_attesa();
  assert r ? 'autorizzazioni' and r ? 'critici' and not (r ? 'non_autorizzato'), 'l''elenco automatico risponde al Direttore';
  ok := false;
  begin insert into public.s_decisioni (questione) values ('x');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'il Direttore non apre questioni';
  ok := false;
  begin perform public.s_decisione_rispondi(v_id, 'rinviata', null, current_date);
  exception when raise_exception then ok := true; end;
  assert ok, 'per rinviare serve una data futura';
  r := public.s_decisione_rispondi(v_id, 'rinviata', 'ne parliamo in CdA', current_date + 7);
  assert (select stato = 'rinviata' and rinviata_al = current_date + 7 and decisa_da_email = v_dir from public.s_decisioni where id = v_id), 'rinvio registrato';
  r := public.s_decisione_rispondi(v_id, 'decisa', 'Si rinnova per un anno.');
  assert (select stato = 'decisa' and decisione = 'Si rinnova per un anno.' and rinviata_al is null and decisa_il is not null from public.s_decisioni where id = v_id), 'decisione registrata';
  assert (select count(*) from public.s_decisioni_eventi where decisione_id = v_id and tipo in ('rinvio', 'decisione')) = 2, 'cronologia: rinvio e decisione';
  ok := false;
  begin perform public.s_decisione_rispondi(v_id2, 'decisa', '');
  exception when raise_exception then ok := true; end;
  assert ok, 'senza testo non si decide';

  -- il coordinatore prende in carico: chiusa, con chi e quando
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_coord)::text, true);
  perform set_config('role', 'authenticated', true);
  update public.s_decisioni set stato = 'chiusa' where id = v_id;
  assert (select stato = 'chiusa' and chiusa_da = v_coord and chiusa_il is not null and decisione = 'Si rinnova per un anno.' from public.s_decisioni where id = v_id), 'presa in carico senza perdere la decisione';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform public.s_decisione_rispondi(v_id, 'decisa', 'di nuovo');
  exception when raise_exception then ok := true; end;
  assert ok, 'una questione chiusa non si ridecide';

  -- obiettivo visite: la regola CEIV fa il conto
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.visite_obiettivo_esercizio (esercizio, contributi_ceiv) values ('TEST-0000', 412500);
  assert (select visite_minime = 825 from public.visite_obiettivo_esercizio where esercizio = 'TEST-0000'), '412.500 euro = 825 visite';

  perform set_config('role', 'postgres', true);
  raise notice 'OK registro decisioni e obiettivo visite';
end $$;

rollback;

-- ── le PROPOSTE dal vault (stesso giorno): le vede solo la segreteria, che le spunta ──
begin;
do $$
declare v_dir text; v_coord text; v_id bigint;
begin
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  select lower(valore) into v_coord from public.s_config where chiave = 'coordinatore_email';
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.s_decisioni (questione, riguarda, stato, origine, origine_rif, aperta_il)
    values ('TEST proposta', '_SISTEMA/scadenze_ufficio.md', 'proposta', 'vault', 'vault:test:0000', '2026-09-01') returning id into v_id;
  assert (select stato = 'proposta' from public.s_decisioni where id = v_id), 'all''insert la proposta resta proposta';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  assert (select count(*) from public.s_decisioni where id = v_id) = 0, 'il Direttore non vede le proposte';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email', v_coord)::text, true);
  perform set_config('role', 'authenticated', true);
  assert (select count(*) from public.s_decisioni where id = v_id) = 0, 'il coordinatore non vede le proposte';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email','cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.s_decisioni set stato = 'aperta' where id = v_id;
  assert (select stato = 'aperta' and pubblicata_da = 'cptpd@did.formedilpadova.it' and aperta_il = '2026-09-01' from public.s_decisioni where id = v_id), 'la spunta registra chi e quando e tiene la data';
  assert (select count(*) from public.s_decisioni_eventi where decisione_id = v_id and tipo = 'pubblicazione') = 1, 'cronologia: pubblicazione';
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  assert (select count(*) from public.s_decisioni where id = v_id) = 1, 'spuntata, il Direttore la vede';
  perform set_config('role', 'postgres', true);
  raise notice 'OK proposte dal vault';
end $$;
rollback;
