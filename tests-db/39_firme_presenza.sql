-- 39 — Firme di presenza dal QR (13/10/2026, lotto 4 del fascicolo corso digitale).
-- Eseguita sul database il 13/10/2026 dentro una transazione annullata: tutti gli assert passano. Dati INVENTATI.
-- Tre blocchi: (A) la segreteria apre le firme e pubblica; (B) il servizio registra una firma come fa
-- portale-richieste; (C) la segreteria conferma e le presenze seguono.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);

-- (A) apertura, codici personali, pubblicazione, la regola entrata/uscita
do $$
declare v_corso bigint; v_g bigint; v_i1 bigint; v_i2 bigint; a record; p jsonb; d date := (now() at time zone 'Europe/Rome')::date; dec jsonb;
begin
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, durata_ore, perc_freq_min, sede, modalita)
  values ('Corso di prova lotto 4', 'corso', 'aperto', d, 8, 90, 'Padova, via Basilicata 10', 'aula') returning id into v_corso;
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle, dalle2, alle2) values (v_corso, d, '08:30', '13:30', '14:30', '17:30') returning id into v_g;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'ROSSI MARIO', 'RSSMRA80A01H501U', 'Impresa Uno', 'operaio', 'in_attesa') returning id into v_i1;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'BIANCHI LUCA', 'BNCLCU85B02H501Z', 'Impresa Due', 'operaio', 'in_attesa') returning id into v_i2;

  select * into a from public.pres_apri(v_corso, 48);
  assert a.codice ~ ('^P' || v_corso || '-[A-Z2-9]{4}$'), 'codice delle firme: ' || a.codice;
  assert position('?presenza=' || a.codice || '.' in a.link) > 0, 'il link porta codice e firma: ' || a.link;
  assert a.codici_personali = 2, 'due codici personali generati';
  assert (select firme_qr from public.s_corsi where id = v_corso), 'firme_qr acceso';
  assert (select count(*) from public.s_corsi_iscritti where corso_id = v_corso and test_codice ~ '^[A-Z2-9]{5}$') = 2, 'codici di 5 lettere';
  /* riaprire non cambia il codice e non rigenera i codici personali */
  select * into a from public.pres_apri(v_corso, 24);
  assert a.codici_personali = 0 and a.codice = (select pres_codice from public.s_corsi where id = v_corso), 'riapertura idempotente';

  p := public.pres_pubblicazione(v_corso);
  assert p ->> 'codice' = a.codice and length(p ->> 'firma') = 12, 'pubblicazione con firma di 12 esadecimali';
  assert jsonb_array_length(p -> 'persone') = 2 and jsonb_array_length(p -> 'giornate') = 1, 'persone e giornate';
  assert (p -> 'persone' -> 0 ->> 'n') ~ '^([A-Z]\.\s?){2}$', 'solo iniziali: ' || (p -> 'persone' -> 0 ->> 'n');
  assert p::text !~ 'ROSSI' and p::text !~ 'RSSMRA', 'nessun nome o CF nella pubblicazione';

  /* la regola, sull'orologio di Roma */
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '07:35') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'entrata' and (dec ->> 'turno')::int = 1 and not (dec ->> 'fuori_orario')::boolean and dec ->> 'ora_turno' = '08:30', '07:35 = entrata 1: ' || dec::text;
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '10:59') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'entrata' and (dec ->> 'turno')::int = 1, '10:59 = ancora entrata 1';
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '11:00') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'uscita' and (dec ->> 'turno')::int = 1 and dec ->> 'ora_turno' = '13:30', '11:00 = uscita 1 (metà turno)';
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '14:29') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'uscita' and (dec ->> 'turno')::int = 1, '14:29 = uscita 1 (fino a 60 min dopo la fine)';
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '14:31') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'entrata' and (dec ->> 'turno')::int = 2, '14:31 = entrata 2';
  dec := public.pres_decidi(d, '08:30', '13:30', '14:30', '17:30', (d + time '19:00') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'uscita' and (dec ->> 'turno')::int = 2 and (dec ->> 'fuori_orario')::boolean, '19:00 = fuori orario, uscita 2 la più vicina';
  dec := public.pres_decidi(d, '08:30', '13:30', null, null, (d + time '06:00') at time zone 'Europe/Rome');
  assert dec ->> 'tipo' = 'entrata' and (dec ->> 'fuori_orario')::boolean, '06:00 = fuori orario, entrata 1';
  dec := public.pres_decidi(d, null, null, null, null, now());
  assert dec ->> 'tipo' is null and (dec ->> 'fuori_orario')::boolean, 'giornata senza orari';

  perform set_config('t39.corso', v_corso::text, true);
  perform set_config('t39.g', v_g::text, true);
  perform set_config('t39.i1', v_i1::text, true);
  perform set_config('t39.i2', v_i2::text, true);
  perform set_config('t39.link', a.link, true);
  raise notice 'A ok: corso %, link %', v_corso, a.link;
end $$;

-- (B) la firma che arriva: come la registra portale-richieste (service_role)
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_corso bigint := current_setting('t39.corso')::bigint; v_g bigint := current_setting('t39.g')::bigint;
        v_i1 bigint := current_setting('t39.i1')::bigint; rif text; cod1 text; r jsonb; atteso jsonb; v_id bigint;
begin
  rif := substr(current_setting('t39.link'), position('?presenza=' in current_setting('t39.link')) + 10);
  select test_codice into cod1 from public.s_corsi_iscritti where id = v_i1;

  r := public.pres_registra(rif, lower(cod1), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'prova-sub-0001');
  assert r ->> 'riferimento_esito' = 'riconosciuta', 'riconosciuta: ' || r::text;
  assert (r ->> 'corso_id')::bigint = v_corso and (r ->> 'giornata_id')::bigint = v_g and (r ->> 'iscritto_id')::bigint = v_i1, 'corso, giornata di oggi e persona';
  assert r ->> 'stato' = 'ricevuta' and r ->> 'fonte' = 'qr', 'nasce ricevuta, dal qr';
  atteso := public.pres_decidi((select data from public.s_corsi_giornate where id = v_g), '08:30', '13:30', '14:30', '17:30', now());
  assert r ->> 'tipo' = atteso ->> 'tipo' and (r ->> 'fuori_orario')::boolean = (atteso ->> 'fuori_orario')::boolean, 'tipo deciso dal server sull''ora di adesso';

  /* la riga come la scrive portale-richieste: campi calcolati + submission_id + progressivo.
     (20/10/2026) il progressivo è unico su tutta la tabella e dal 15/10 ci sono firme vere: il test prende il primo
     libero invece di un 1 fisso, che dal primo uso reale andava in conflitto (giro del 20/10 fallito). */
  insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, ora_dispositivo, fuori_orario, fonte, stato, note, riferimento_esito, submission_id, progressivo, timestamp_modulo, portale_esito)
  values ((r ->> 'corso_id')::bigint, (r ->> 'giornata_id')::bigint, (r ->> 'iscritto_id')::bigint, r ->> 'nominativo', r ->> 'tipo', (r ->> 'turno')::int,
          (r ->> 'ora_server')::timestamptz, (r ->> 'ora_dispositivo')::timestamptz, (r ->> 'fuori_orario')::boolean, r ->> 'fonte', r ->> 'stato', r ->> 'note',
          r ->> 'riferimento_esito', 'prova-sub-0001', (select coalesce(max(progressivo), 0) + 1 from public.s_corsi_firme_presenza), now(), '{"strada":"prova"}'::jsonb)
  returning id into v_id;
  assert (select stato from public.s_corsi_firme_presenza where id = v_id) = 'ricevuta', 'ricevuta';
  assert not exists (select 1 from public.s_corsi_presenze where iscritto_id = v_i1 and giornata_id = v_g), 'una firma ricevuta NON scrive le presenze';

  r := public.pres_registra(rif, 'ZZZZZ', null, 'prova-sub-0002');
  assert r ->> 'riferimento_esito' = 'persona non riconosciuta' and (r ->> 'corso_id')::bigint = v_corso, 'codice personale ignoto: si tiene col corso';
  r := public.pres_registra(replace(rif, substr(rif, length(rif) - 3), 'ffff'), cod1, null, 'prova-sub-0003');
  assert r ->> 'riferimento_esito' = 'firma non valida', 'firma sbagliata';
  r := public.pres_registra('P999999-XXXX.abcdefabcdef', cod1, null, 'prova-sub-0004');
  assert r ->> 'riferimento_esito' = 'firma non valida', 'codice inesistente risponde come la firma sbagliata';
  raise notice 'B ok';
end $$;

-- (C) la conferma scrive le presenze, il rifiuto le toglie, la conferma per allievo
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare v_g bigint := current_setting('t39.g')::bigint; v_i2 bigint := current_setting('t39.i2')::bigint; v_corso bigint := current_setting('t39.corso')::bigint;
        d date; f public.s_corsi_firme_presenza; e_id bigint; u_id bigint; u2_id bigint; pr public.s_corsi_presenze; n int;
begin
  select data into d from public.s_corsi_giornate where id = v_g;
  insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, fuori_orario)
  values (v_corso, v_g, v_i2, 'BIANCHI LUCA', 'entrata', 1, (d + time '08:31') at time zone 'Europe/Rome', false) returning id into e_id;
  insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, fuori_orario)
  values (v_corso, v_g, v_i2, 'BIANCHI LUCA', 'uscita', 1, (d + time '13:29') at time zone 'Europe/Rome', false) returning id into u_id;
  /* una seconda uscita, arrivata dopo: resta ricevuta */
  insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, fuori_orario)
  values (v_corso, v_g, v_i2, 'BIANCHI LUCA', 'uscita', 1, (d + time '13:33') at time zone 'Europe/Rome', false) returning id into u2_id;

  f := public.pres_conferma(e_id, 'confermata', null);
  assert f.stato = 'confermata' and f.confermata_da = 'cptpd@did.formedilpadova.it' and f.confermata_il is not null, 'confermata da chi e quando';
  select * into pr from public.s_corsi_presenze where iscritto_id = v_i2 and giornata_id = v_g;
  assert pr.ingresso1 = time '08:31' and pr.presente and pr.uscita1 is null, 'entrata 1 scritta nelle presenze: ' || coalesce(pr.ingresso1::text, 'null');

  f := public.pres_conferma(u_id, 'confermata', null);
  select * into pr from public.s_corsi_presenze where iscritto_id = v_i2 and giornata_id = v_g;
  assert pr.uscita1 = time '13:29' and pr.ore = 4.97, 'uscita 1 e ore 4.97: ' || coalesce(pr.ore::text, 'null');

  begin
    perform public.pres_conferma(u2_id, 'confermata', null); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: seconda uscita rifiutata (%)', sqlerrm;
  end;

  f := public.pres_conferma(u_id, 'respinta', 'uscito prima, firma di un collega');
  select * into pr from public.s_corsi_presenze where iscritto_id = v_i2 and giornata_id = v_g;
  assert pr.uscita1 is null and pr.ore = 0 and pr.ingresso1 = time '08:31', 'il rifiuto toglie la sua colonna e lascia l''altra';
  assert f.note = 'uscito prima, firma di un collega', 'la parola del rifiuto resta';

  /* per allievo: conferma la ricevuta in orario (u2) e salta ciò che è già confermato o respinto */
  n := public.pres_conferma_allievo(v_i2, v_g);
  assert n = 1, 'una firma confermata per allievo, trovate ' || n;
  select * into pr from public.s_corsi_presenze where iscritto_id = v_i2 and giornata_id = v_g;
  assert pr.uscita1 = time '13:33' and pr.ore = 5.03, 'la seconda uscita ora vale: ' || coalesce(pr.ore::text, 'null');

  assert (select count(*) from public.s_flussi_uso() where codice in ('pres_firma_qr', 'pres_confermata')) = 2, 'i due flussi nel cruscotto';
  raise notice 'C ok';
end $$;
rollback;
