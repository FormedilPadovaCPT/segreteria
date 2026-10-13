-- 40 — La pagina del docente (14/10/2026, lotto 5 del fascicolo corso digitale).
-- Eseguita sul database il 14/10/2026 dentro una transazione annullata: tutti gli assert passano. Dati INVENTATI.
-- (A) la segreteria prepara corso, giornata, iscritti, un docente esterno con accesso (app_ruoli + persona);
-- (B) il docente: vede il SUO corso (policy e RPC), aggiunge un allievo (persona nuova, mansione obbligatoria,
--     codice subito), segna presenze, il registro non è pronto finché c'è una firma dal QR da guardare;
-- (C) il docente non vede un corso che non è suo; la firma dell'accettazione scrive l'incarico.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare v_corso bigint; v_altro bigint; v_g bigint; v_i1 bigint; v_pdoc uuid; v_inc bigint; v_iv bigint; d date := (now() at time zone 'Europe/Rome')::date;
begin
  insert into public.persone (nome, cognome, cf, ruoli) values ('Docente', 'Diprova', 'DPRDCN70A01H501X', array['docente']) returning persona_id into v_pdoc;
  insert into public.app_ruoli (email, ruolo, stato, nome, persona_id) values ('docente.prova@example.invalid', 'docente', 'attivo', 'Docente Diprova', v_pdoc);
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, durata_ore, perc_freq_min, sede, modalita)
  values ('Corso di prova lotto 5', 'corso', 'aperto', d, 8, 90, 'Padova', 'aula') returning id into v_corso;
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, durata_ore, sede, modalita)
  values ('Altro corso non suo', 'corso', 'aperto', d, 4, 'Padova', 'aula') returning id into v_altro;
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle, dalle2, alle2) values (v_corso, d, '08:30', '13:30', '14:30', '17:30') returning id into v_g;
  insert into public.s_corsi_interventi (corso_id, giornata_id, qualita, nominativo, persona_id, materia) values (v_corso, v_g, 'docente', 'Docente Diprova', v_pdoc, 'Antincendio') returning id into v_iv;
  insert into public.s_corsi_incarichi (corso_id, persona_id, nominativo, qualita, ore) values (v_corso, v_pdoc, 'Docente Diprova', 'docente', 8) returning id into v_inc;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'ROSSI MARIO', 'RSSMRA80A01H501U', 'Impresa Uno', 'operaio', 'in_attesa') returning id into v_i1;
  perform set_config('t40.corso', v_corso::text, true); perform set_config('t40.altro', v_altro::text, true); perform set_config('t40.g', v_g::text, true);
  perform set_config('t40.i1', v_i1::text, true); perform set_config('t40.inc', v_inc::text, true); perform set_config('t40.iv', v_iv::text, true);
  raise notice 'A ok';
end $$;

-- (B) il docente
select set_config('request.jwt.claims', '{"role":"authenticated","email":"docente.prova@example.invalid","sub":"00000000-0000-0000-0000-000000000040"}', true);
do $$
declare v_corso bigint := current_setting('t40.corso')::bigint; v_altro bigint := current_setting('t40.altro')::bigint; v_g bigint := current_setting('t40.g')::bigint;
        v_i1 bigint := current_setting('t40.i1')::bigint; v_iv bigint := current_setting('t40.iv')::bigint; r jsonb; n int; v_i2 bigint; p jsonb; v_f bigint;
begin
  assert public.is_docente_del_corso(v_corso), 'è docente del suo corso';
  assert not public.is_docente_del_corso(v_altro), 'non dell''altro';
  /* le policy nuove: vede il suo corso e non l''altro */
  select count(*) into n from public.s_corsi where id in (v_corso, v_altro);
  assert n = 1, 'policy s_corsi: vede 1 corso, trovati ' || n;
  select count(*) into n from public.s_corsi_iscritti where corso_id = v_corso;
  assert n = 1, 'policy iscritti';

  r := public.corso_docente_corsi();
  assert jsonb_array_length(r) = 1 and (r -> 0 ->> 'id')::bigint = v_corso and (r -> 0 ->> 'mio')::boolean, 'i miei corsi: ' || r::text;
  assert (r -> 0 -> 'incarico' ->> 'accettato_il') is null and jsonb_typeof(r -> 0 -> 'incarico' -> 'lettera') = 'null', 'incarico non accettato, lettera non ancora preparata';
  assert jsonb_array_length(r -> 0 -> 'giornate') = 1 and (r -> 0 -> 'giornate' -> 0 -> 'interventi' -> 0 ->> 'mio')::boolean, 'la giornata col mio intervento';

  /* aggiungere un allievo: senza mansione no */
  begin
    perform public.corso_docente_aggiungi_allievo(v_corso, '{"cf":"BNCLCU85B02H501Z","nome":"Luca","cognome":"Bianchi"}'::jsonb); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: senza mansione rifiutato (%)', sqlerrm;
  end;
  r := public.corso_docente_aggiungi_allievo(v_corso, '{"cf":"bncl cu85b02h501z","nome":"Luca","cognome":"Bianchi","mansione":"carpentiere","impresa_txt":"Impresa Due"}'::jsonb);
  assert (r ->> 'persona_nuova')::boolean and r ->> 'nominativo' = 'BIANCHI LUCA' and r ->> 'codice' ~ '^[A-Z2-9]{5}$', 'allievo nuovo con codice: ' || r::text;
  assert not (r ->> 'firme_aperte')::boolean, 'firme dal QR non aperte su questo corso';
  v_i2 := (r ->> 'iscritto_id')::bigint;
  assert (select aggiunto_in_aula_da from public.s_corsi_iscritti where id = v_i2) = 'docente.prova@example.invalid', 'chi l''ha aggiunto';
  begin
    perform public.corso_docente_aggiungi_allievo(v_corso, '{"cf":"BNCLCU85B02H501Z","mansione":"x"}'::jsonb); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: doppione rifiutato (%)', sqlerrm;
  end;
  r := public.corso_docente_cerca_persona(v_corso, 'bianc');
  assert jsonb_array_length(r) >= 1 and (select bool_or((x ->> 'gia_iscritto')::boolean) from jsonb_array_elements(r) x where x ->> 'cf' = 'BNCLCU85B02H501Z'), 'la ricerca lo trova e lo dice già iscritto';
  assert r::text !~ 'email' and r::text !~ 'telefono', 'niente recapiti nella ricerca';
  r := public.corso_docente_cerca_impresa('impresa');
  assert jsonb_typeof(r) = 'array', 'ricerca imprese: ' || jsonb_typeof(r);
  begin
    perform public.corso_docente_aggiungi_allievo(v_altro, '{"cf":"VRDGPP90C03H501K","nome":"G","cognome":"V","mansione":"x"}'::jsonb); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: corso non suo rifiutato (%)', sqlerrm;
  end;

  /* argomenti del mio intervento */
  perform public.corso_docente_argomenti(v_iv, 'triangolo del fuoco, estintori');
  assert (select argomenti from public.s_corsi_interventi where id = v_iv) = 'triangolo del fuoco, estintori', 'argomenti scritti';

  /* presenze: il registro non è pronto finché manca qualcosa */
  r := public.corso_docente_registro_pronto(v_g);
  assert not (r ->> 'ok')::boolean and (r ->> 'senza_presenza')::int = 2, 'non pronto: 2 senza presenza: ' || r::text;
  perform public.corso_docente_presenza(v_i1, v_g, 'carta');
  r := (select to_jsonb(p0) from public.s_corsi_presenze p0 where iscritto_id = v_i1 and giornata_id = v_g);
  assert (r ->> 'presente')::boolean and (r ->> 'ingresso1') = '08:30:00' and (r ->> 'ore')::numeric = 8, 'su carta: orari della giornata e 8 ore: ' || r::text;
  /* una firma dal QR ricevuta blocca il registro */
  /* una firma dal QR la scrive portale-richieste (service_role): il docente NON può inserirla (RLS) — qui la segreteria */
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
  insert into public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, fuori_orario)
  values (v_corso, v_g, v_i2, 'BIANCHI LUCA', 'entrata', 1, (current_date + time '08:29') at time zone 'Europe/Rome', false) returning id into v_f;
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"docente.prova@example.invalid","sub":"00000000-0000-0000-0000-000000000040"}', true);
  r := public.corso_docente_registro_pronto(v_g);
  assert not (r ->> 'ok')::boolean and (r ->> 'da_guardare')::int = 1, 'una firma da guardare';
  n := public.pres_conferma_allievo(v_i2, v_g);
  assert n = 1, 'confermata per allievo';
  r := (select to_jsonb(p0) from public.s_corsi_presenze p0 where iscritto_id = v_i2 and giornata_id = v_g);
  assert (r ->> 'ingresso1') = '08:29:00' and (r ->> 'presente')::boolean, 'la conferma ha scritto l''entrata: ' || r::text;
  r := public.corso_docente_registro_pronto(v_g);
  assert (r ->> 'ok')::boolean, 'ora il registro si può firmare: ' || r::text;
  begin
    perform public.corso_docente_presenza(v_i2, v_g, 'togli'); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: non si toglie con una firma confermata (%)', sqlerrm;
  end;
  r := public.corso_docente_giornata(v_g);
  assert jsonb_array_length(r -> 'iscritti') = 2 and (select count(*) from jsonb_array_elements(r -> 'iscritti') x where (x -> 'presenza') is not null and jsonb_typeof(x -> 'presenza') = 'object') = 2, 'la giornata: 2 iscritti con presenza';
  raise notice 'B ok';
end $$;

-- (C) la firma dell'accettazione la scrive firma-documenti (service_role: su s_firme nessuno scrive dall'app):
--     il trigger segna l'incarico; poi la segreteria vede l'allievo aggiunto in aula da verificare
reset role;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare v_inc bigint := current_setting('t40.inc')::bigint; v_corso bigint := current_setting('t40.corso')::bigint; v_f bigint;
begin
  insert into public.s_firme (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, firmatario_email, firmatario_ruolo, corso_id, ordine, stato, richiesta_da)
  values ('accettazione_incarico', 'incarico:' || v_inc, 'Accettazione', 'x.pdf', 'originali/x.pdf', 'abc', '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'docente.prova@example.invalid', 'docente', v_corso, 1, 'in_attesa', 'docente.prova@example.invalid')
  returning id into v_f;
  update public.s_firme set stato = 'firmata', firmata_il = now(), firmata_da = 'docente.prova@example.invalid', file_firmato = 'firmate/x.pdf' where id = v_f;
  assert (select accettazione_firma_id from public.s_corsi_incarichi where id = v_inc) = v_f and (select accettato_il from public.s_corsi_incarichi where id = v_inc) is not null, 'trigger: incarico accettato';
  assert (select count(*) from public.s_corsi_iscritti where corso_id = v_corso and aggiunto_in_aula_il is not null and verificato_da_segreteria_il is null) = 1, 'un allievo aggiunto in aula da verificare';
  /* la persona nuova la vede la segreteria (il docente non legge l'anagrafica: policy persone_sel) */
  assert exists (select 1 from public.persone where upper(cf) = 'BNCLCU85B02H501Z' and 'allievo' = any(ruoli) and data_nascita = '1985-02-02'), 'persona creata, CF decodificato dal trigger';
  assert (select count(*) from public.s_flussi_uso() where codice in ('allievo_in_aula', 'incarico_accettato', 'registro_giornata_firmato')) = 3, 'i tre flussi nel cruscotto';
  raise notice 'C ok';
end $$;
rollback;
