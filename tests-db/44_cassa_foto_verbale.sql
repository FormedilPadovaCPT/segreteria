-- Test della foto dello stato in Cassa nel verbale (gestionale visite, 20/10/2026):
--   · una bozza non si fotografa; quando diventa definitiva il database scrive una riga per impresa presente;
--   · lo stato è quello della lista valida alla DATA DELLA VISITA; chi non è in lista è «Non in lista», non C.E.I.V.;
--   · la foto non si riscrive e non si cancella (regola d'oro 7); si sposta solo impresa_id (unioni);
--   · risalvando un definitivo le imprese già fotografate restano com'erano, quella aggiunta prende la sua foto;
--   · prima della prima lista conservata non si scrive niente (si potrà riempire caricando le liste vecchie);
--   · un tecnico la legge ma non la scrive e non chiama le funzioni;
--   · fra due posizioni C.E.I.V. della stessa impresa (unione di schede) vale la migliore;
--   · eliminando il verbale la foto va via con lui.
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

do $$
declare
  tid text; cid text; i_att text; i_non text; i_ses text; ok boolean; n int; t0 timestamptz; f record; c record;
begin
  select tecnico_id into tid from public.tecnici where lower(email) = 'franco.caon@did.formedilpadova.it';
  select cantiere_id into cid from public.cantieri order by cantiere_id limit 1;
  -- un'impresa con una sola riga di storico, Attiva in lista; una Sospesa; una mai stata in lista
  select s.impresa_id into i_att from public.imprese_cassa_storico s
   where s.attuale and s.fonte = 'lista' and s.stato = 'Attiva'
     and (select count(*) from public.imprese_cassa_storico z where z.impresa_id = s.impresa_id) = 1
   order by s.impresa_id limit 1;
  select s.impresa_id into i_ses from public.imprese_cassa_storico s
   where s.attuale and s.fonte = 'lista' and s.stato = 'Sospesa'
     and (select count(*) from public.imprese_cassa_storico z where z.impresa_id = s.impresa_id) = 1
   order by s.impresa_id limit 1;
  select m.impresa_id into i_non from public.imprese m
   where not exists (select 1 from public.imprese_cassa_storico s where s.impresa_id = m.impresa_id)
     and not exists (select 1 from public.ceiv_lista x where x.cf = m.impresa_id or x.piva = m.impresa_id)
     and (nullif(btrim(m.piva), '') is null or not exists (select 1 from public.ceiv_lista x where x.piva = m.piva))
     and (nullif(btrim(m.impresa_cf), '') is null or not exists (select 1 from public.ceiv_lista x where x.cf = m.impresa_cf))
   order by m.impresa_id limit 1;
  assert tid is not null and cid is not null and i_att is not null and i_ses is not null and i_non is not null, 'mancano i dati di prova';

  insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato)
  values ('TEST-CF-1', 'TEST/CF/1', current_date, tid, cid, i_att, 'bozza');
  perform public.salva_figli_verbale('TEST-CF-1', '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('impresa_id', i_att, 'is_principale', true, 'ordine', 0),
                      jsonb_build_object('impresa_id', i_non, 'ordine', 1)));

  -- 1. la bozza non si fotografa
  assert public.cassa_foto_verbale('TEST-CF-1') = 0, 'una bozza non va fotografata';
  assert not exists (select 1 from public.visite_cassa_foto where visita_id = 'TEST-CF-1'), 'foto scritta su una bozza';

  -- 2. diventa definitivo: una riga per impresa presente, scritta dal database
  update public.visite set stato = 'definitivo' where visita_id = 'TEST-CF-1';
  select * into f from public.visite_cassa_foto where visita_id = 'TEST-CF-1' and impresa_id = i_att;
  assert found and f.stato = 'Attiva' and f.iscritta_ceiv and f.fonte = 'lista' and f.modo = 'chiusura'
         and f.lista_del is not null and f.data_visita = current_date,
    'impresa attiva in lista: foto sbagliata ' || coalesce(row_to_json(f)::text, 'assente');
  select * into f from public.visite_cassa_foto where visita_id = 'TEST-CF-1' and impresa_id = i_non;
  assert found and f.stato = 'Non in lista' and not f.iscritta_ceiv and f.fonte = 'anagrafica',
    'impresa non in lista: deve essere «Non in lista», non C.E.I.V. ' || coalesce(row_to_json(f)::text, 'assente');

  -- 3. la foto non si riscrive e non si cancella
  ok := false;
  begin update public.visite_cassa_foto set stato = 'Sospesa' where visita_id = 'TEST-CF-1' and impresa_id = i_att;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'la foto si è lasciata riscrivere';
  ok := false;
  begin delete from public.visite_cassa_foto where visita_id = 'TEST-CF-1';
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'la foto si è lasciata cancellare';
  -- l'impresa sì: è ciò che fanno unioni e cambio di chiave
  update public.visite_cassa_foto set impresa_id = 'TEST-SPOSTATA' where visita_id = 'TEST-CF-1' and impresa_id = i_non;
  update public.visite_cassa_foto set impresa_id = i_non where visita_id = 'TEST-CF-1' and impresa_id = 'TEST-SPOSTATA';

  -- 4. risalvando il definitivo con un'impresa in più: le vecchie foto restano, la nuova arriva
  select fotografato_il into t0 from public.visite_cassa_foto where visita_id = 'TEST-CF-1' and impresa_id = i_att;
  perform public.salva_figli_verbale('TEST-CF-1', '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('impresa_id', i_att, 'is_principale', true, 'ordine', 0),
                      jsonb_build_object('impresa_id', i_non, 'ordine', 1),
                      jsonb_build_object('impresa_id', i_ses, 'ordine', 2)));
  select count(*) into n from public.visite_cassa_foto where visita_id = 'TEST-CF-1';
  assert n = 3, 'dopo il nuovo salvataggio le foto dovevano essere 3, sono ' || n;
  assert (select fotografato_il from public.visite_cassa_foto where visita_id = 'TEST-CF-1' and impresa_id = i_att) = t0,
    'la foto di un''impresa già fotografata è stata riscritta';
  select * into f from public.visite_cassa_foto where visita_id = 'TEST-CF-1' and impresa_id = i_ses;
  assert f.stato = 'Sospesa' and f.iscritta_ceiv, 'sospesa in lista = iscritta: ' || row_to_json(f)::text;

  -- 5. la vista per le statistiche: categoria dalla foto
  assert (select categoria from public.v_visite_cassa where visita_id = 'TEST-CF-1' and impresa_id = i_att) = 'attiva', 'vista: attiva';
  assert (select categoria from public.v_visite_cassa where visita_id = 'TEST-CF-1' and impresa_id = i_ses) = 'sospesa', 'vista: sospesa';
  assert (select categoria from public.v_visite_cassa where visita_id = 'TEST-CF-1' and impresa_id = i_non) = 'non_ceiv', 'vista: non in lista';
  assert (select bool_and(da_foto) from public.v_visite_cassa where visita_id = 'TEST-CF-1'), 'vista: da_foto';

  -- 6. prima della prima lista conservata: nessuna riga
  insert into public.visite (visita_id, nr_verbale, data_visita, tecnico_id, cantiere_id, impresa_id, stato)
  values ('TEST-CF-2', 'TEST/CF/2', date '2020-01-15', tid, cid, i_att, 'bozza');
  perform public.salva_figli_verbale('TEST-CF-2', '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('impresa_id', i_att, 'is_principale', true, 'ordine', 0)));
  update public.visite set stato = 'definitivo' where visita_id = 'TEST-CF-2';
  assert not exists (select 1 from public.visite_cassa_foto where visita_id = 'TEST-CF-2'), 'foto scritta per una visita prima della prima lista';
  select * into c from public.cassa_stato_al(i_att, date '2020-01-15');
  assert c.fonte = 'nessuna' and c.stato is null and c.nota like '%non ricostruibile%', 'prima della lista: ' || row_to_json(c)::text;
  assert (select da_foto from public.v_visite_cassa where visita_id = 'TEST-CF-2') = false, 'vista: senza foto vale lo stato di oggi';

  -- 7. due posizioni C.E.I.V. della stessa impresa (unione dell'08/10/2026): vale la migliore
  if exists (select 1 from public.imprese_cassa_storico where impresa_id = '01835800267' and stato = 'Cessata')
     and exists (select 1 from public.imprese_cassa_storico where impresa_id = '01835800267' and stato = 'Attiva' and attuale) then
    select * into c from public.cassa_stato_al('01835800267', date '2026-10-06');
    assert c.stato = 'Attiva', 'unione: fra Attiva e Cessata doveva valere Attiva, è ' || coalesce(c.stato, 'vuoto');
  end if;

  -- 8. eliminando il verbale la foto va via con lui
  delete from public.visite where visita_id = 'TEST-CF-2';
  delete from public.visite_imprese_presenti where visita_id = 'TEST-CF-1';
  delete from public.visite where visita_id = 'TEST-CF-1';
  assert not exists (select 1 from public.visite_cassa_foto where visita_id = 'TEST-CF-1'), 'la foto è rimasta dopo l''eliminazione del verbale';
end $$;

-- 9. un tecnico la legge ma non la scrive e non chiama le funzioni
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare ok boolean; n int;
begin
  select count(*) into n from public.visite_cassa_foto;  -- la lettura è permessa
  ok := false;
  begin insert into public.visite_cassa_foto (visita_id, impresa_id, impresa_id_foto, fonte, iscritta_ceiv, modo)
        values ('X', 'X', 'X', 'lista', true, 'chiusura');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un tecnico ha potuto scrivere una foto';
  ok := false;
  begin perform public.cassa_foto_recupera(date '2026-08-30');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un tecnico ha potuto lanciare il recupero';
  ok := false;
  begin perform public.cassa_stato_al('X', current_date);
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un tecnico ha potuto chiamare cassa_stato_al';
end $$;

rollback;
