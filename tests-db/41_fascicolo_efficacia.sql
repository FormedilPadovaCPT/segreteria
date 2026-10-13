-- 41 — Il fascicolo su Drive e la verifica di efficacia (14/10/2026, lotti 6 e 7 del fascicolo corso digitale).
-- Eseguita sul database il 14/10/2026 dentro una transazione annullata: tutti gli assert passano. Dati INVENTATI.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare t public.s_corsi_tipologie; v_corso bigint; v_g bigint; v_i1 bigint; f jsonb; r jsonb; n int; e public.s_corsi_efficacia;
begin
  t := public.tipologia_salva('{"codice":"PROVA-L6","titolo":"Prova lotti 6-7","ore_minime":8,"accordo_2025":true}'::jsonb);
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, data_fine, durata_ore, perc_freq_min, tipologia_id, sede, modalita, rilascio_attestato)
  values ('Corso di prova lotti 6-7', 'corso', 'svolto', '2026-10-05', '2026-10-05', 8, 90, t.id, 'Padova', 'aula', true) returning id into v_corso;
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle) values (v_corso, '2026-10-05', '08:30', '17:30') returning id into v_g;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'ROSSI MARIO', 'RSSMRA80A01H501U', 'Impresa Uno', 'operaio', 'presente') returning id into v_i1;
  insert into public.s_corsi_presenze (iscritto_id, giornata_id, presente, ore) values (v_i1, v_g, true, 8);

  /* lotto 6: lo stato calcolato */
  f := public.corso_fascicolo(v_corso);
  assert (f ->> 'accordo')::boolean, 'corso dell''Accordo';
  assert not (f ->> 'completo')::boolean, 'non completo';
  assert f -> 'mancanti' ? 'scheda formativa firmata' and f -> 'mancanti' ? 'progetto formativo firmato' and f -> 'mancanti' ? 'verbale di verifica firmato' and f -> 'mancanti' ? 'attestati emessi', 'manca il fascicolo pieno: ' || (f -> 'mancanti')::text;
  assert not (f -> 'mancanti' ? 'registro firmato o presenze per ogni giornata'), 'la giornata ha le presenze: non manca';
  assert (f -> 'iscritti' ->> 'n')::int = 1 and (f -> 'iscritti' ->> 'ammessi')::int = 1, 'iscritti';
  assert jsonb_typeof(f -> 'cartella' -> 'drive_id') = 'null' and jsonb_array_length(f -> 'depositati') = 0, 'niente su Drive';

  begin
    perform public.corso_fascicolo_chiudi(v_corso); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: non si chiude un fascicolo incompleto (%)', sqlerrm;
  end;

  /* il deposito: cartella e un pezzo */
  perform public.corso_fascicolo_deposita(v_corso, '{"cartella_id":"DRIVE-CARTELLA","cartella_url":"https://drive.google.com/drive/folders/DRIVE-CARTELLA"}'::jsonb);
  r := public.corso_fascicolo_deposita(v_corso, jsonb_build_object('pezzo', 'registro_giornata', 'rif', 'giornata:' || v_g, 'nome', 'registro.pdf', 'drive_id', 'DRIVE-FILE-1', 'drive_url', 'https://drive.google.com/file/d/DRIVE-FILE-1/view'));
  assert r ->> 'drive_id' = 'DRIVE-FILE-1' and r ->> 'depositato_da' = 'cptpd@did.formedilpadova.it', 'deposito registrato';
  r := public.corso_fascicolo_deposita(v_corso, jsonb_build_object('pezzo', 'registro_giornata', 'rif', 'giornata:' || v_g, 'nome', 'registro2.pdf', 'drive_id', 'DRIVE-FILE-2', 'drive_url', null));
  assert r ->> 'drive_id' = 'DRIVE-FILE-2', 'stesso pezzo rideposto: una riga sola, aggiornata';
  f := public.corso_fascicolo(v_corso);
  assert f -> 'cartella' ->> 'drive_id' = 'DRIVE-CARTELLA' and jsonb_array_length(f -> 'depositati') = 1, 'cartella e un deposito';

  /* un corso fuori Accordo si chiude coi soli registri */
  update public.s_corsi set tipologia_id = null where id = v_corso;
  f := public.corso_fascicolo(v_corso);
  assert not (f ->> 'accordo')::boolean and (f ->> 'completo')::boolean, 'fuori Accordo: completo coi registri: ' || (f -> 'mancanti')::text;
  r := public.corso_fascicolo_chiudi(v_corso);
  assert (r ->> 'chiuso')::boolean and (select stato from public.s_corsi where id = v_corso) = 'chiuso' and (select fascicolo_chiuso_da from public.s_corsi where id = v_corso) = 'cptpd@did.formedilpadova.it', 'chiuso: il corso passa a chiuso';
  r := public.corso_fascicolo_chiudi(v_corso, true);
  assert not (r ->> 'chiuso')::boolean and (select fascicolo_chiuso_il from public.s_corsi where id = v_corso) is null, 'riaperto';
  update public.s_corsi set tipologia_id = t.id where id = v_corso;

  /* lotto 7: i promemoria nascono dai corsi dell''Accordo svolti, una riga per impresa */
  n := public.efficacia_genera();
  assert n >= 1, 'almeno il promemoria di prova: ' || n;
  select * into e from public.s_corsi_efficacia where corso_id = v_corso;
  assert e.id is not null and e.impresa_txt = 'Impresa Uno' and e.partecipanti = 1 and e.da_mandare_dal = date '2027-04-05' and e.entro = date '2027-10-05', 'promemoria a 6 e 12 mesi: ' || to_jsonb(e)::text;
  n := public.efficacia_genera();
  select count(*) into n from public.s_corsi_efficacia where corso_id = v_corso;
  assert n = 1, 'rigenerare non raddoppia';
  e := public.efficacia_segna(e.id, 'preparata', null);
  assert e.bozza_preparata_il is not null and e.inviata_il is null, 'bozza preparata';
  e := public.efficacia_segna(e.id, 'inviata', 'mandata a mano');
  assert e.inviata_il is not null and e.inviata_da = 'cptpd@did.formedilpadova.it' and e.note = 'mandata a mano', 'inviata';
  /* il giro mensile (cron.job) non si legge da authenticated: lo si controlla a parte, come postgres */
  assert (select count(*) from public.s_flussi_uso() where codice in ('fascicolo_deposito', 'fascicolo_chiuso', 'efficacia_inviata')) = 3, 'i tre flussi';
  raise notice 'lotti 6-7 ok';
end $$;
rollback;
