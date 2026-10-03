-- Test del «verbale completo» e dell'esportazione senza ripieghi (gestionale visite, 03/10/2026).
--   · un verbale diventa definitivo SOLO passando da chiudi_verbale: la scrittura diretta di
--     stato = 'definitivo' (una pagina rimasta aperta da prima) viene rifiutata;
--   · chiudi_verbale su una bozza incompleta non chiude e restituisce l'elenco di ciò che manca;
--   · il comune va scritto, il codice ISTAT lo ricava il gestionale: non ferma il tecnico;
--   · osservatorio_controllo conta in modo coerente, e a un estraneo non dice niente.
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare tid text; cid text; iid text; r jsonb; ok boolean; cose text[]; msg text;
begin
  select tecnico_id into tid from public.tecnici where lower(email) = 'franco.caon@did.formedilpadova.it';
  select c.cantiere_id into cid
    from public.cantieri c
    join public.committenti m on m.committente_id = btrim(c.cantiere_committente_id) and m.elimina = 0 and m.committente_tipo in (1, 2)
   where c.cantiere_comune_cod ~ '^[0-9]{6}$' and c.cantiere_tip_int between 1 and 4 and c.cantiere_tip_ope between 1 and 15
     and c.cantiere_durata between 1 and 6 and c.cantiere_importo between 1 and 10
     and length(btrim(c.cantiere_indirizzo)) >= 2 and btrim(c.cantiere_civico) <> ''
   order by c.cantiere_id limit 1;
  select impresa_id into iid from public.imprese order by impresa_id limit 1;
  assert tid is not null, 'non trovo il tecnico di prova';
  assert cid is not null, 'non trovo un cantiere con la scheda completa';
  assert iid is not null, 'non trovo un''impresa';

  -- 1. pagina vecchia: «definitivo» scritto direttamente, in inserimento
  ok := false;
  begin
    insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato)
    values ('TEST-VC-0', 'TEST/VC/0', current_date, tid, cid, iid, 'definitivo');
  exception when others then msg := sqlerrm; ok := msg like '%non è aggiornata%';
  end;
  assert ok, 'l''inserimento diretto di un verbale definitivo doveva essere rifiutato: ' || coalesce(msg, '(nessun errore)');

  -- 2. la bozza si scrive; il passaggio diretto a definitivo no
  insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato)
  values ('TEST-VC-1', 'TEST/VC/1', current_date, tid, cid, iid, 'bozza');
  ok := false; msg := null;
  begin
    update public.visite set stato = 'definitivo' where visita_id = 'TEST-VC-1';
  exception when others then msg := sqlerrm; ok := msg like '%non è aggiornata%';
  end;
  assert ok, 'il passaggio diretto a definitivo doveva essere rifiutato: ' || coalesce(msg, '(nessun errore)');

  -- 3. chiudi_verbale su una bozza incompleta: non chiude, e dice tutto quello che manca
  r := public.chiudi_verbale('TEST-VC-1');
  assert (r->>'ok')::boolean is false, 'una bozza vuota non deve chiudersi: ' || r::text;
  select array_agg(x->>'cosa') into cose from jsonb_array_elements(r->'mancanze') x;
  assert cose @> array['ora-inizio', 'ora-fine', 'tipo-accesso', 'lavorazioni', 'imprese', 'checklist'],
    'l''elenco delle mancanze non è intero: ' || array_to_string(cose, ', ');
  assert not (cose && array['cantiere-indirizzo', 'cantiere-comune', 'cantiere-intervento', 'cantiere-opera', 'cantiere-durata', 'importo', 'committente', 'committente-tipo']),
    'il cantiere scelto è completo e non doveva comparire: ' || array_to_string(cose, ', ');
  assert (select stato from public.visite where visita_id = 'TEST-VC-1') = 'bozza', 'dopo un rifiuto il verbale resta bozza';
  assert public.verbale_mancanze('TEST-VC-1') = r->'mancanze', 'chiudi_verbale e verbale_mancanze devono dire la stessa cosa';

  -- 4. il comune va scritto: è il nome che conta, non il codice (un cantiere fuori provincia non ferma il tecnico)
  assert pg_get_functiondef('public.verbale_mancanze(text)'::regprocedure) like '%if trim(coalesce(c.comune_nome,'''')) = '''' then%',
    'verbale_mancanze deve guardare il nome del comune';
  assert pg_get_functiondef('public.verbale_mancanze(text)'::regprocedure) not like '%if coalesce(c.cantiere_comune_cod,'''') !~%',
    'verbale_mancanze non deve fermare il verbale per il codice ISTAT';

  -- 5. osservatorio_controllo: i conti tornano
  r := public.osservatorio_controllo(date '2025-10-01', date '2026-09-30', true);
  assert (r->>'definitive')::int > 0, 'esercizio 2025-26 senza visite definitive';
  assert (r->>'pronte')::int + (r->>'ferme')::int = (r->>'definitive')::int, 'pronte + ferme deve fare il totale';
  assert jsonb_array_length(r->'visite') = (r->>'ferme')::int, 'l''elenco delle visite ferme deve essere intero';
  assert not exists (select 1 from jsonb_array_elements(r->'visite') v where jsonb_array_length(v->'blocchi') = 0), 'una visita ferma ha almeno un motivo';
  assert not exists (select 1 from jsonb_array_elements(r->'cantieri') c where jsonb_array_length(c->'blocchi') + jsonb_array_length(c->'avvisi') = 0), 'un cantiere in elenco ha almeno un motivo';
  assert (r->>'ferme')::int <= coalesce((select sum((m->>'visite')::int) from jsonb_array_elements(r->'motivi') m where (m->>'blocca')::boolean), 0), 'ogni visita ferma sta in almeno un motivo';
  assert jsonb_array_length(public.osservatorio_controllo(date '2025-10-01', date '2026-09-30', false)->'visite') = 0, 'senza dettaglio gli elenchi restano vuoti';
  -- la bozza di prova è nel periodo di oggi: va contata fra le non definitive
  r := public.osservatorio_controllo(current_date, current_date, false);
  assert (r->>'non_definitive')::int >= 1, 'la bozza di prova doveva risultare fra le non definitive';
  raise notice 'OK: il verbale si chiude solo da chiudi_verbale, e il controllo per l''Osservatorio torna';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"nessuno@esempio.invalid","sub":"00000000-0000-0000-0000-000000000001"}', true);
do $$
declare r jsonb; ok boolean := false;
begin
  r := public.osservatorio_controllo(date '2000-01-01', date '2099-12-31', true);
  assert (r->>'definitive')::int = 0 and (r->>'non_definitive')::int = 0 and jsonb_array_length(r->'visite') = 0,
    'un autenticato senza ruolo non deve sapere niente delle visite: ' || left(r::text, 200);
  -- la bozza di prova c'è, ma un estraneo non la vede: per lui «non trovato»
  begin perform public.verbale_mancanze('TEST-VC-1'); exception when others then ok := sqlerrm like '%non trovato%'; end;
  assert ok, 'verbale_mancanze non deve dire niente di un verbale a chi non lo vede';
  ok := false;
  begin perform public.chiudi_verbale('TEST-VC-1'); exception when others then ok := true; end;
  assert ok, 'chiudi_verbale non deve chiudere un verbale a chi non lo vede';
  raise notice 'OK: estraneo a zero';
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.osservatorio_controllo(date,date,boolean)', 'EXECUTE'), 'anon non deve eseguire osservatorio_controllo';
  assert not has_function_privilege('anon', 'public.chiudi_verbale(text)', 'EXECUTE'), 'anon non deve eseguire chiudi_verbale';
  assert not has_function_privilege('anon', 'public.verbale_mancanze(text)', 'EXECUTE'), 'anon non deve eseguire verbale_mancanze';
  assert not has_function_privilege('anon', 'public.imprese_senza_cf()', 'EXECUTE'), 'anon non deve eseguire imprese_senza_cf';
  assert not has_function_privilege('authenticated', 'public.tg_visite_chiusura_solo_completa()', 'EXECUTE'), 'la funzione del trigger non si chiama a mano';
end $$;

rollback;
