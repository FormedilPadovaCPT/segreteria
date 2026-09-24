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
  if (select count(*) from s_ruoli where propone_rapporto) <> 8 then raise exception 'FALLITO: ruoli interni'; end if;
  if (select count(*) from s_tipi_rapporto where ruolo_id is not null) <> 5 then raise exception 'FALLITO: tipi-ruolo'; end if;

  raise notice 'OK rapporti e nomine';
end $$;

rollback;
