-- Rapporti e nomine dalla scheda impresa (24/09/2026).
-- Dentro una transazione che si annulla: registra una persona NUOVA con rapporto e due
-- funzioni, ripete la stessa registrazione (non deve duplicare niente), prova che un
-- ruolo-rapporto non diventa nomina, che senza segreteria si viene respinti, e cessa il
-- rapporto chiudendo le nomine.
begin;

do $$
declare
  imp text; r jsonb; r2 jsonb; pid uuid; rid uuid; n int; errore text;
  seg text;
begin
  select email into seg from app_ruoli where ruolo in ('segreteria','admin') and stato = 'attivo' limit 1;
  if seg is null then raise exception 'nessun account di segreteria per la prova'; end if;
  select impresa_id into imp from imprese where coalesce(elimina,0) = 0 order by impresa_id limit 1;

  -- senza segreteria: respinto
  perform set_config('request.jwt.claims', json_build_object('email','nessuno@example.invalid','role','authenticated')::text, true);
  begin
    perform s_registra_persona_impresa(jsonb_build_object('impresa_id', imp, 'persona', jsonb_build_object('cognome','PROVA')));
    raise exception 'FALLITO: un estraneo ha registrato una persona';
  exception when others then
    if sqlerrm like 'FALLITO%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('email', seg, 'role','authenticated')::text, true);

  -- persona nuova + rapporto + preposto + RSPP
  r := s_registra_persona_impresa(jsonb_build_object(
    'impresa_id', imp,
    'persona', jsonb_build_object('cognome','ZZPROVA','nome','Rapporto','cf','ZZZPRV80A01H501Z'),
    'rapporto', jsonb_build_object('tipo','dipendente','qualifica','operaio','mansione','muratore','data_assunzione','2026-09-01'),
    'nomine', jsonb_build_array(jsonb_build_object('ruolo_id',12,'data_inizio','2026-09-01'), jsonb_build_object('ruolo_id',1))));
  if r->>'persona' <> 'creata' or r->>'rapporto' <> 'creato' or (r->>'nomine_create')::int <> 2 then
    raise exception 'FALLITO prima registrazione: %', r;
  end if;
  pid := (r->>'persona_id')::uuid; rid := (r->>'rapporto_id')::uuid;
  if (select tipo_rapporto from persone_imprese where id = rid) <> 'dipendente'
     or (select qualifica::text from persone_imprese where id = rid) <> 'operaio' then
    raise exception 'FALLITO: rapporto scritto male';
  end if;

  -- stessa registrazione, per CF: niente doppioni
  r2 := s_registra_persona_impresa(jsonb_build_object(
    'impresa_id', imp,
    'persona', jsonb_build_object('cognome','Zzprova','cf','zzzprv80a01h501z'),
    'rapporto', jsonb_build_object('tipo','dipendente'),
    'nomine', jsonb_build_array(jsonb_build_object('ruolo_id',12))));
  if r2->>'persona' <> 'trovata_dal_cf' or (r2->>'persona_id')::uuid <> pid
     or r2->>'rapporto' <> 'gia_in_corso' or (r2->>'nomine_create')::int <> 0 or (r2->>'nomine_gia_in_corso')::int <> 1 then
    raise exception 'FALLITO seconda registrazione (doppioni): %', r2;
  end if;
  if (select count(*) from persone where upper(cf) = 'ZZZPRV80A01H501Z') <> 1 then raise exception 'FALLITO: persona doppia'; end if;
  if (select count(*) from persone_imprese where persona_id = pid) <> 1 then raise exception 'FALLITO: rapporto doppio'; end if;

  -- DIPENDENTE come nomina: rifiutato
  begin
    perform s_registra_persona_impresa(jsonb_build_object('impresa_id', imp, 'persona_id', pid,
      'nomine', jsonb_build_array(jsonb_build_object('ruolo_id',20))));
    raise exception 'FALLITO: DIPENDENTE registrato come nomina';
  exception when others then
    if sqlerrm like 'FALLITO%' then raise; end if;
  end;

  -- tipo sconosciuto: rifiutato
  begin
    perform s_registra_persona_impresa(jsonb_build_object('impresa_id', imp, 'persona_id', pid,
      'rapporto', jsonb_build_object('tipo','rspp')));
    raise exception 'FALLITO: tipo di rapporto «rspp» accettato';
  exception when others then
    if sqlerrm like 'FALLITO%' then raise; end if;
  end;

  -- cessazione prima dell'assunzione: rifiutata
  begin
    perform s_rapporto_cessa(rid, '2026-08-01', true);
    raise exception 'FALLITO: cessazione prima dell''assunzione accettata';
  exception when others then
    if sqlerrm like 'FALLITO%' then raise; end if;
  end;

  -- cessazione con chiusura delle nomine
  r := s_rapporto_cessa(rid, '2026-09-20', true);
  if (r->>'nomine_chiuse')::int <> 2 then raise exception 'FALLITO: nomine chiuse %', r; end if;
  if (select data_cessazione from persone_imprese where id = rid) <> '2026-09-20' then raise exception 'FALLITO: cessazione non scritta'; end if;
  select count(*) into n from s_nomine where persona_id = pid and data_fine is null;
  if n <> 0 then raise exception 'FALLITO: % nomine ancora aperte', n; end if;

  -- a rapporto cessato, una nuova registrazione riapre (nuovo rapporto, non quello vecchio)
  r := s_registra_persona_impresa(jsonb_build_object('impresa_id', imp, 'persona_id', pid,
    'rapporto', jsonb_build_object('tipo','dipendente','data_assunzione','2026-10-01')));
  if r->>'rapporto' <> 'creato' then raise exception 'FALLITO: riassunzione %', r; end if;

  -- la mappa sta nel database
  if (select count(*) from s_ruoli where propone_rapporto) <> 7 then raise exception 'FALLITO: ruoli interni'; end if;
  if (select count(*) from s_tipi_rapporto where ruolo_id is not null) <> 5 then raise exception 'FALLITO: tipi-ruolo'; end if;

  raise notice 'OK rapporti e nomine';
end $$;

rollback;

-- «Titolare» da verbali e iscrizioni diventa RAPPORTO, non nomina (24/09/2026).
begin;

do $$
declare vid text; r record; n_prima int; n_dopo int; pid uuid; imp text; seg text; y jsonb; t text; nn int;
begin
  -- un verbale vero con la persona presente «titolare» agganciata all'anagrafica
  select v.visita_id into vid from visite v
   where coalesce(v.elimina,0) = 0 and lower(trim(v.qual_ppre)) = 'titolare' and v.impresa_id is not null
     and exists (select 1 from s_nomine_da_visita(v.visita_id, false) x where x.figura = 'presente' and x.persona_id is not null)
   order by v.data_visita desc limit 1;
  if vid is null then raise exception 'nessun verbale con un titolare per la prova'; end if;
  select persona_id, impresa_id into pid, imp from s_nomine_da_visita(vid, false) where figura = 'presente';
  update persone_imprese set data_cessazione = '2000-01-01' where persona_id = pid and impresa_id = imp;
  select count(*) into n_prima from s_nomine;
  select * into r from s_nomine_da_visita(vid, true) where figura = 'presente';
  select count(*) into n_dopo from s_nomine;
  if r.azione <> 'rapporto_creato' then raise exception 'FALLITO verbale: %', row_to_json(r); end if;
  if n_dopo <> n_prima then raise exception 'FALLITO: dal verbale e'' nata una nomina TITOLARE'; end if;
  select * into r from s_nomine_da_visita(vid, true) where figura = 'presente';
  if r.azione <> 'gia_presente' then raise exception 'FALLITO: la ripetizione ha fatto %', r.azione; end if;

  select email into seg from app_ruoli where ruolo in ('segreteria','admin') and stato = 'attivo' limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', seg, 'role','authenticated')::text, true);
  insert into persone (cognome, nome) values ('ZZPROVA', 'Iscrizione') returning persona_id into pid;
  perform iscr_registra_rapporto(pid, imp, 'crea', null, 999999, current_date);
  y := iscr_nomina_da_ruolo(pid, imp, 'titolare', 'ZZPROVA Iscrizione', 'prova', 999999, current_date);
  select tipo_rapporto into t from persone_imprese where persona_id = pid and impresa_id = imp;
  if t <> 'titolare' or (y->>'aggiornato')::boolean is not true then raise exception 'FALLITO iscrizione: % / %', t, y; end if;
  select count(*) into nn from s_nomine where persona_id = pid;
  if nn <> 0 then raise exception 'FALLITO: dall''iscrizione e'' nata una nomina TITOLARE'; end if;
  y := iscr_nomina_da_ruolo(pid, imp, 'preposto', 'ZZPROVA Iscrizione', 'prova', 999999, current_date);
  if (y->>'fatto')::boolean is not true then raise exception 'FALLITO: il preposto non e'' diventato nomina: %', y; end if;

  raise notice 'OK titolare come rapporto';
end $$;

rollback;

-- La funzione interna apre il rapporto se manca (trigger trg_nomina_apre_rapporto, 24/09/2026).
begin;

do $$
declare pid uuid; pid2 uuid; imp text; b int; r record;
begin
  select impresa_id into imp from imprese where coalesce(elimina,0)=0 order by impresa_id limit 1;
  insert into persone (cognome, nome) values ('ZZPROVA','Preposto') returning persona_id into pid;
  select max(access_id) into b from s_nomine;

  insert into s_nomine (access_id, data_reg, persona_id, impresa_id, ruolo_id, ruolo_txt) values (b+1, current_date, pid, imp, 1, 'RSPP');
  if (select count(*) from persone_imprese where persona_id=pid) <> 0 then raise exception 'FALLITO: RSPP ha aperto un rapporto'; end if;
  insert into s_nomine (access_id, data_reg, persona_id, impresa_id, ruolo_id, ruolo_txt, data_inizio) values (b+2, current_date, pid, imp, 12, 'PREPOSTO', '2026-03-01');
  select * into r from persone_imprese where persona_id=pid;
  if r.tipo_rapporto <> 'dipendente' or r.data_assunzione <> '2026-03-01' then raise exception 'FALLITO preposto: %', row_to_json(r); end if;
  insert into s_nomine (access_id, data_reg, persona_id, impresa_id, ruolo_id, ruolo_txt) values (b+3, current_date, pid, imp, 21, 'CAPOCANTIERE');
  if (select count(*) from persone_imprese where persona_id=pid) <> 1 then raise exception 'FALLITO: doppione'; end if;

  insert into persone (cognome, nome) values ('ZZPROVA','Cambio') returning persona_id into pid2;
  insert into s_nomine (access_id, data_reg, persona_id, impresa_id, ruolo_id, ruolo_txt) values (b+4, current_date, pid2, imp, 1, 'RSPP');
  update s_nomine set ruolo_id = 12, ruolo_txt = 'PREPOSTO' where access_id = b+4;
  if (select count(*) from persone_imprese where persona_id=pid2) <> 1 then raise exception 'FALLITO: cambio ruolo'; end if;
  -- cambio d'impresa (come in un'unione): nessun rapporto nuovo
  update s_nomine set impresa_id = (select impresa_id from imprese where coalesce(elimina,0)=0 and impresa_id<>imp order by impresa_id limit 1) where access_id = b+4;
  if (select count(*) from persone_imprese where persona_id=pid2) <> 1 then raise exception 'FALLITO: il cambio di impresa ha aperto un rapporto'; end if;

  delete from persone_imprese where persona_id = pid;
  insert into s_nomine (access_id, data_reg, persona_id, impresa_id, ruolo_id, ruolo_txt, data_inizio, data_fine) values (b+5, current_date, pid, imp, 2, 'RLS', '2019-01-01', '2021-12-31');
  select * into r from persone_imprese where persona_id=pid;
  if r.data_cessazione <> '2021-12-31' then raise exception 'FALLITO nomina chiusa: %', row_to_json(r); end if;

  raise notice 'OK funzione interna apre il rapporto';
end $$;

rollback;
