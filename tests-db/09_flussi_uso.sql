-- Test del riquadro «Flussi mai usati» (17/09/2026): s_flussi_uso risponde
-- solo alla segreteria, dà una riga per flusso (anche a zero casi) e non
-- conta i protocolli annullati. Transazione annullata: non resta niente.
begin;

do $$
declare n_righe int; n_codici int; ok boolean; prima int; dopo int; r public.s_protocollo;
begin
  assert not has_function_privilege('anon', 'public.s_flussi_uso()', 'execute'), 'chiusa ad anon';

  -- un tecnico non la legge
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'nicola.demarco@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  ok := false;
  begin perform * from public.s_flussi_uso();
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'riservata alla segreteria';

  -- la segreteria sì: una riga per ogni flusso, nessun codice doppio
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'cptpd@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*), count(distinct codice) into n_righe, n_codici from public.s_flussi_uso();
  assert n_righe = 29 and n_codici = 29, format('attese 29 righe e 29 codici, trovate %s e %s', n_righe, n_codici);
  assert (select casi from public.s_flussi_uso() where codice = 'dm132') >= 0, 'i flussi mai usati compaiono con zero';

  -- un protocollo annullato non conta
  perform set_config('role', 'postgres', true);
  select casi into prima from public.s_flussi_uso() where codice = 'critico_organi';
  r := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'data_prot', current_date, 'oggetto', 'TEST automatico', 'tipo_doc_id', 68));
  update public.s_protocollo set annullato = true, annullato_motivo = 'TEST automatico' where id = r.id;
  select casi into dopo from public.s_flussi_uso() where codice = 'critico_organi';
  assert prima = dopo, 'un protocollo annullato non è un uso';
end
$$;

rollback;
