-- Test di salva_figli_verbale (gestionale visite, 03/10/2026): check-list, lavorazioni e imprese
-- di un verbale si riscrivono in UNA transazione.
--   · scrive le tre liste e dice quante righe ha scritto;
--   · una nota su una voce senza valutazione prende valore «nota» (la colonna è obbligatoria);
--   · un salvataggio sbagliato (un'impresa che non esiste) viene rifiutato e LASCIA TUTTO COM'ERA:
--     è il motivo per cui esiste — prima, con la linea caduta a metà, il verbale restava senza righe;
--   · un verbale che non esiste viene rifiutato; chi non è collegato non può chiamarla.
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare tid text; cid text; iid text; c1 text; c2 text; r jsonb; ok boolean; msg text; n int;
begin
  select tecnico_id into tid from public.tecnici where lower(email) = 'franco.caon@did.formedilpadova.it';
  select cantiere_id into cid from public.cantieri order by cantiere_id limit 1;
  select impresa_id into iid from public.imprese order by impresa_id limit 1;
  select min(codice), max(codice) into c1, c2 from public.checklist_voci where not coalesce(is_nota, false);
  assert tid is not null and cid is not null and iid is not null and c1 is not null and c1 <> c2, 'mancano i dati di prova';

  insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato)
  values ('TEST-SF-1', 'TEST/SF/1', current_date, tid, cid, iid, 'bozza');

  -- 1. scrive le tre liste
  r := public.salva_figli_verbale('TEST-SF-1',
    jsonb_build_array(jsonb_build_object('codice', c1, 'valore', 'NC-', 'nota', 'quadro da sistemare'),
                      jsonb_build_object('codice', c2, 'valore', null, 'nota', 'nota senza valutazione')),
    jsonb_build_array(jsonb_build_object('genere', 'G', 'fase', 'F', 'lavorazione', 'L')),
    jsonb_build_array(jsonb_build_object('impresa_id', iid, 'nr_lav', 2, 'tipo_imp', 1, 'ruolo', 'affidataria', 'is_principale', true, 'ordine', 0)));
  assert (r->>'ok')::boolean and (r->>'checklist')::int = 2 and (r->>'lavorazioni')::int = 1 and (r->>'imprese')::int = 1,
    'la funzione doveva scrivere 2 voci, 1 lavorazione e 1 impresa: ' || r::text;
  assert (select valore from public.visite_checklist where visita_id = 'TEST-SF-1' and codice = c2) = 'nota',
    'una nota senza valutazione deve prendere valore «nota»';
  assert (select nr_lav from public.visite_imprese_presenti where visita_id = 'TEST-SF-1' and impresa_id = iid) = 2, 'i lavoratori dell''impresa non sono stati scritti';

  -- 2. un salvataggio sbagliato non lascia il verbale a metà
  ok := false;
  begin
    perform public.salva_figli_verbale('TEST-SF-1', '[]'::jsonb, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('impresa_id', 'IMPRESA-CHE-NON-ESISTE', 'nr_lav', 1)));
  exception when others then ok := true;
  end;
  assert ok, 'un''impresa che non esiste doveva far fallire il salvataggio';
  select count(*) into n from public.visite_checklist where visita_id = 'TEST-SF-1';
  assert n = 2, 'dopo un salvataggio fallito la check-list doveva restare com''era (2 righe), ne trovo ' || n;
  assert (select count(*) from public.visite_lavorazioni where visita_id = 'TEST-SF-1') = 1
     and (select count(*) from public.visite_imprese_presenti where visita_id = 'TEST-SF-1') = 1,
    'dopo un salvataggio fallito lavorazioni e imprese dovevano restare com''erano';

  -- 3. riscrivere con liste vuote svuota davvero (è una scelta di chi salva, non un errore)
  r := public.salva_figli_verbale('TEST-SF-1', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  assert (r->>'ok')::boolean and (select count(*) from public.visite_checklist where visita_id = 'TEST-SF-1') = 0, 'le liste vuote dovevano svuotare';

  -- 4. un verbale che non esiste
  ok := false;
  begin
    perform public.salva_figli_verbale('TEST-SF-NON-ESISTE', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb);
  exception when others then msg := sqlerrm; ok := msg like '%non trovato%';
  end;
  assert ok, 'un verbale inesistente doveva essere rifiutato: ' || coalesce(msg, '(nessun errore)');
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.salva_figli_verbale(text, jsonb, jsonb, jsonb)', 'execute'),
    'chi non è collegato non deve poter chiamare salva_figli_verbale';
  assert not (select prosecdef from pg_proc where oid = 'public.salva_figli_verbale(text, jsonb, jsonb, jsonb)'::regprocedure),
    'salva_figli_verbale deve girare coi permessi di chi la chiama';
end $$;

rollback;
