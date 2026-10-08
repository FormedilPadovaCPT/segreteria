-- Test delle osservazioni del tecnico obbligatorie (gestionale visite, 08/10/2026, deciso dall'utente).
--   · senza osservazioni del tecnico (visite.oss_tec, quelle del report e del PDF) il verbale non si chiude;
--   · le sole osservazioni INTERNE non bastano, e uno spazio vuoto non conta;
--   · scritte le osservazioni, la voce sparisce dall'elenco.
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare tid text; cid text; iid text; cose text[];
begin
  select tecnico_id into tid from public.tecnici where lower(email) = 'franco.caon@did.formedilpadova.it';
  select cantiere_id into cid from public.cantieri where coalesce(elimina,0) = 0 order by cantiere_id limit 1;
  select impresa_id into iid from public.imprese order by impresa_id limit 1;
  assert tid is not null and cid is not null and iid is not null, 'mancano tecnico, cantiere o impresa di prova';

  insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato, oss_tec_int)
  values ('TEST-OSS-1', 'TEST/OSS/1', current_date, tid, cid, iid, 'bozza', 'solo una nota interna');

  select array_agg(x->>'cosa') into cose from jsonb_array_elements(public.verbale_mancanze('TEST-OSS-1')) x;
  assert 'osservazioni' = any(cose), 'senza osservazioni del tecnico il verbale non deve chiudersi (le interne non bastano)';
  assert exists (select 1 from jsonb_array_elements(public.verbale_mancanze('TEST-OSS-1')) x
                  where x->>'cosa' = 'osservazioni' and x->>'campo' = 'f-oss-tec'), 'la riga deve portare al campo delle osservazioni';

  update public.visite set oss_tec = '   ' where visita_id = 'TEST-OSS-1';
  select array_agg(x->>'cosa') into cose from jsonb_array_elements(public.verbale_mancanze('TEST-OSS-1')) x;
  assert 'osservazioni' = any(cose), 'degli spazi non sono osservazioni';

  update public.visite set oss_tec = 'Ponteggio di facciata completo, parapetti in ordine.' where visita_id = 'TEST-OSS-1';
  select array_agg(x->>'cosa') into cose from jsonb_array_elements(public.verbale_mancanze('TEST-OSS-1')) x;
  assert not ('osservazioni' = any(coalesce(cose, '{}'))), 'scritte le osservazioni, la voce non deve più comparire';

  assert (select (public.chiudi_verbale('TEST-OSS-1')->>'ok')::boolean) is false, 'il resto della bozza è incompleto: non deve chiudersi';
end $$;

reset role;
select 'ok — osservazioni del tecnico obbligatorie alla chiusura' as esito;
rollback;
