-- 42 — Le lacune del fascicolo digitale (14/10/2026): anno di nascita alla firma, elenco dei docenti,
-- traccia delle firme, dati e impronta del pacchetto. Dati INVENTATI. Eseguita sul database il 14/10/2026 dentro una
-- transazione annullata: tutti gli assert passano, nessun residuo.
-- (A) la segreteria prepara il corso e pubblica; (B) il servizio registra tre firme come portale-richieste,
-- con l'anno giusto, sbagliato e mancante; (C) la segreteria conferma in gruppo, legge elenco, traccia e
-- dati, deposita il pacchetto.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);

do $$
declare v_corso bigint; v_g bigint; v_i1 bigint; v_i2 bigint; v_i3 bigint; a record; p jsonb; d date := (now() at time zone 'Europe/Rome')::date; v_p jsonb;
begin
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, durata_ore, perc_freq_min, sede, modalita)
  values ('Corso di prova lacune', 'corso', 'aperto', d, 8, 90, 'Padova', 'aula') returning id into v_corso;
  /* una giornata che copre tutto il giorno: la firma di adesso è sempre «in orario» */
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle) values (v_corso, d, '00:05', '23:55') returning id into v_g;
  insert into public.s_corsi_interventi (corso_id, giornata_id, qualita, nominativo, materia, dalle, alle) values (v_corso, v_g, 'docente', 'Docente Prova', 'Modulo unico', '08:30', '12:30');
  /* tre allievi: CF normale (1980), CF con omocodia (UL = 80), senza CF */
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'ROSSI MARIO', 'RSSMRA80A01H501U', 'Impresa Uno', 'operaio', 'in_attesa') returning id into v_i1;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'VERDI ANNA', 'VRDNNAULA41H501U', 'Impresa Due', 'impiegata', 'in_attesa') returning id into v_i2;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'SENZA CODICEFISCALE', null, 'Impresa Tre', 'operaio', 'in_attesa') returning id into v_i3;

  select * into a from public.pres_apri(v_corso, 48);
  p := public.pres_pubblicazione(v_corso);
  assert jsonb_array_length(p -> 'persone') = 3, 'tre persone';
  assert (select count(*) from jsonb_array_elements(p -> 'persone') x where x ? 'a') = 2, 'impronta dell''anno solo per chi ha l''anno ricavabile';
  assert p::text !~ '1980' and p::text !~ 'RSSMRA', 'niente anno né CF in chiaro';
  select x into v_p from jsonb_array_elements(p -> 'persone') x
   where x ->> 'h' = encode(extensions.digest(convert_to(upper((select test_codice from public.s_corsi_iscritti where id = v_i1)), 'UTF8'), 'sha256'), 'hex');
  assert v_p ->> 'a' = encode(extensions.digest(convert_to(upper((select test_codice from public.s_corsi_iscritti where id = v_i1)) || ':80', 'UTF8'), 'sha256'), 'hex'),
    'l''impronta è quella che il portale ricalcola (codice:anno a due cifre)';

  perform set_config('t42.corso', v_corso::text, true);
  perform set_config('t42.g', v_g::text, true);
  perform set_config('t42.i1', v_i1::text, true);
  perform set_config('t42.i2', v_i2::text, true);
  perform set_config('t42.i3', v_i3::text, true);
  perform set_config('t42.link', a.link, true);
end $$;

-- (B) tre firme come le registra portale-richieste
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_corso bigint := current_setting('t42.corso')::bigint; rif text; r jsonb; i record; v_n int := 0; v_anni text[] := array['1980', '1990', null];
begin
  /* iscritto_yy è chiusa agli utenti (la usano solo le funzioni): si prova qui, come servizio */
  assert public.iscritto_yy(current_setting('t42.i1')::bigint) = 80, 'anno dal CF';
  assert public.iscritto_yy(current_setting('t42.i2')::bigint) = 80, 'omocodia: UL = 80';
  assert public.iscritto_yy(current_setting('t42.i3')::bigint) is null, 'senza CF né persona: non verificabile';
  rif := substr(current_setting('t42.link'), position('?presenza=' in current_setting('t42.link')) + 10);
  for i in select id, test_codice from public.s_corsi_iscritti where id in (current_setting('t42.i1')::bigint, current_setting('t42.i2')::bigint, current_setting('t42.i3')::bigint) order by id loop
    v_n := v_n + 1;
    r := public.pres_registra(rif, i.test_codice, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'prova-42-' || v_n, v_anni[v_n]);
    assert r ->> 'riferimento_esito' = 'riconosciuta', 'riconosciuta: ' || r::text;
    insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, ora_dispositivo, fuori_orario, fonte, stato, note, riferimento_esito, submission_id, anno_dichiarato, anno_corrisponde)
    values ((r ->> 'corso_id')::bigint, (r ->> 'giornata_id')::bigint, (r ->> 'iscritto_id')::bigint, r ->> 'nominativo', r ->> 'tipo', (r ->> 'turno')::int,
            (r ->> 'ora_server')::timestamptz, nullif(r ->> 'ora_dispositivo', '')::timestamptz, (r ->> 'fuori_orario')::boolean, 'qr', 'ricevuta', r ->> 'note', 'riconosciuta', 'prova-42-' || v_n,
            nullif(r ->> 'anno_dichiarato', '')::smallint, (r ->> 'anno_corrisponde')::boolean);
    if v_n = 1 then assert (r ->> 'anno_corrisponde')::boolean is true and (r ->> 'anno_dichiarato')::int = 1980, 'anno giusto: ' || r::text; end if;
    if v_n = 2 then assert (r ->> 'anno_corrisponde')::boolean is false and r ->> 'note' ~ 'anno di nascita non corrispondente \(scritto 1990\)', 'anno sbagliato: segnata, non rifiutata: ' || r::text; end if;
    if v_n = 3 then assert jsonb_typeof(r -> 'anno_corrisponde') = 'null', 'senza anno ricavabile: non verificata'; end if;
  end loop;
  /* la chiamata a 4 argomenti, come fa una versione vecchia della cassetta, funziona ancora */
  r := public.pres_registra(rif, (select test_codice from public.s_corsi_iscritti where id = current_setting('t42.i1')::bigint), null, 'prova-42-vecchia');
  assert r ->> 'riferimento_esito' = 'riconosciuta' and r ->> 'note' ~ 'anno di nascita non scritto', 'senza anno: si registra, con la nota: ' || r::text;
  /* una firma arrivata dopo la chiusura: fino al 14/10/2026 questo ramo mandava in errore la funzione
     («malformed array literal», text[] || 'letterale'), e la firma non si registrava */
  update public.s_corsi set pres_chiuso_il = now() - interval '1 hour' where id = v_corso;
  r := public.pres_registra(rif, (select test_codice from public.s_corsi_iscritti where id = current_setting('t42.i1')::bigint), null, 'prova-42-tardi', '1980');
  assert r ->> 'riferimento_esito' = 'riconosciuta' and r ->> 'note' ~ 'arrivata dopo la chiusura delle firme', 'dopo la chiusura: si registra, con la nota: ' || r::text;
end $$;

-- (C) la segreteria conferma, legge elenco, traccia e dati, deposita il pacchetto
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare v_corso bigint := current_setting('t42.corso')::bigint; v_g bigint := current_setting('t42.g')::bigint; n int; e jsonb; t jsonb; dati jsonb; f jsonb; r jsonb;
begin
  n := public.pres_conferma_allievo(current_setting('t42.i1')::bigint, v_g);
  assert n = 1, 'anno giusto: confermata in gruppo';
  n := public.pres_conferma_allievo(current_setting('t42.i2')::bigint, v_g);
  assert n = 0, 'anno sbagliato: la conferma di gruppo la salta';
  assert (select count(*) from jsonb_array_elements(public.corso_docente_giornata(v_g) -> 'iscritti') i, jsonb_array_elements(i -> 'firme') x where x ->> 'anno_corrisponde' = 'false') = 1,
    'il docente vede il segno';

  e := public.corso_elenco_docenti(v_corso);
  assert jsonb_array_length(e) = 1 and e -> 0 ->> 'nominativo' = 'Docente Prova' and (e -> 0 ->> 'ore')::numeric = 4, 'elenco dei docenti con le ore: ' || e::text;
  assert jsonb_array_length(e -> 0 -> 'interventi') = 1, 'gli interventi';

  t := public.corso_traccia_presenze(v_corso);
  assert jsonb_array_length(t) = 3, 'la traccia ha tutte le firme';
  assert (select count(*) from jsonb_array_elements(t) x where x ->> 'stato' = 'confermata') = 1, 'con lo stato';

  dati := public.corso_pacchetto_dati(v_corso);
  assert dati ? 'corso' and dati ? 'iscritti' and dati ? 'firme_presenza' and dati ? 'firme_documenti' and dati ? 'elenco_docenti' and dati ? 'test_prove', 'le chiavi del pacchetto';
  assert jsonb_array_length(dati -> 'iscritti') = 3 and jsonb_array_length(dati -> 'firme_presenza') = 3, 'righe giuste';
  assert not ((dati -> 'firme_presenza' -> 0) ? 'portale_esito'), 'senza l''esito tecnico della cassetta';

  r := public.corso_fascicolo_deposita(v_corso, jsonb_build_object('pezzo', 'elenco_docenti', 'rif', '', 'nome', 'elenco.pdf', 'drive_id', 'DRIVE-E', 'sha256', repeat('e', 64)));
  assert r ->> 'pezzo' = 'elenco_docenti', 'il pezzo nuovo passa il vincolo';
  r := public.corso_fascicolo_deposita(v_corso, jsonb_build_object('pezzo', 'pacchetto', 'rif', '', 'nome', 'pacchetto.zip', 'drive_id', 'DRIVE-P', 'sha256', repeat('a', 64)));
  assert (select fascicolo_pacchetto_sha256 from public.s_corsi where id = v_corso) = repeat('a', 64), 'l''impronta del pacchetto sul corso';
  f := public.corso_fascicolo(v_corso);
  assert f -> 'pacchetto' ->> 'sha256' = repeat('a', 64) and (f ->> 'firme_qr')::int = 3, 'corso_fascicolo dice del pacchetto: ' || (f -> 'pacchetto')::text;
  assert (select count(*) from public.s_flussi_uso() where codice = 'fascicolo_pacchetto') = 1, 'il flusso nel cruscotto';
  raise notice '42 ok';
end $$;
rollback;
