-- Test della PROPOSTA del Direttore sui cantieri critici (17/09/2026; dal
-- 16/11/2026 proposta al Presidente, che decide):
-- s_critico_conferma_direttore accetta SOLO lui, e lui può scrivere in
-- cronologia SOLO quella riga. Transazione annullata: non resta niente.
begin;

do $$
declare v_dir text; v_id bigint; r jsonb; ok boolean;
begin
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  assert v_dir is not null, 'serve direttore_email in s_config';
  assert not has_function_privilege('anon', 'public.s_critico_conferma_direttore(bigint,text,text)', 'execute'), 'chiusa ad anon';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  insert into public.s_cantieri_critici (origine, tecnico_id, data_evento, impresa_nome, cantiere_desc, note)
  values ('manuale', (select tecnico_id from public.tecnici where attivo limit 1), current_date, 'TEST', 'via Test', 'test') returning id into v_id;

  -- la segreteria non conferma al posto del Direttore
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform public.s_critico_conferma_direttore(v_id, 'segnalare', null);
  exception when raise_exception then ok := true; end;
  assert ok, 'la proposta e'' riservata al Direttore';

  -- il Direttore: vede il caso, conferma, e non puo'' fare altro
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_dir)::text, true);
  perform set_config('role', 'authenticated', true);
  assert public.is_direttore(), 'l''indirizzo di s_config e'' il Direttore';
  assert (select count(*) from public.s_cantieri_critici where id = v_id) = 1, 'il Direttore vede il caso';
  ok := false;
  begin perform public.s_critico_conferma_direttore(v_id, 'forse', null);
  exception when raise_exception then ok := true; end;
  assert ok, 'solo segnalare / non_segnalare';
  r := public.s_critico_conferma_direttore(v_id, 'segnalare', 'Procedere.');
  assert (select autore = v_dir and tipo = 'autorizzazione_direttore' and dati ->> 'via' = 'app' and dati ->> 'cosa' = 'segnalare'
            from public.s_cantieri_critici_eventi where id = (r ->> 'evento_id')::bigint), 'la riga porta il suo nome e dice che viene dall''app';
  assert (select testo like '%PROPONE al Presidente di segnalare%' from public.s_cantieri_critici_eventi where id = (r ->> 'evento_id')::bigint), 'la riga dice PROPONE, non conferma';
  assert exists (select 1 from public.s_cantieri_critici_eventi where critico_id = v_id and tipo = 'demandata' and dati ->> 'chi' = 'presidenza'),
    'la proposta porta il caso al Presidente (16/11/2026)';
  ok := false;
  begin insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo) values (v_id, 'nota', 'x');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'il Direttore non scrive altro in cronologia';
  update public.s_cantieri_critici set stato = 'chiuso', gestione_note = 'x', esito = 'nessuna_azione' where id = v_id;
  assert (select stato <> 'chiuso' from public.s_cantieri_critici where id = v_id), 'il Direttore non gestisce il caso';

  raise notice 'OK proposta del Direttore';
end $$;

rollback;
