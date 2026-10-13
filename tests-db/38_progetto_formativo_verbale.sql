-- 38 — Progetto formativo dell'edizione, verbale di verifica finale, guardiano degli attestati
-- (13/10/2026, lotto 3 del fascicolo corso digitale). Eseguita sul database il 13/10/2026 dentro una
-- transazione annullata: tutti gli assert passano. Dati INVENTATI.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare t public.s_corsi_tipologie; v_corso bigint; v_g bigint; v_i1 bigint; v_i2 bigint; v public.s_corsi_verbali_verifica; ok boolean;
begin
  t := public.tipologia_salva('{"codice":"PROVA-L3","titolo":"Prova lotto 3","ore_minime":8}'::jsonb);
  insert into public.s_corsi (titolo, tipo, stato, data_inizio, durata_ore, perc_freq_min, tipologia_id, sede, modalita)
  values ('Corso di prova lotto 3', 'corso', 'aperto', '2026-10-13', 8, 90, t.id, 'Padova, via Basilicata 10', 'aula') returning id into v_corso;
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle, dalle2, alle2) values (v_corso, '2026-10-13', '08:30', '13:30', '14:30', '17:30') returning id into v_g;
  insert into public.s_corsi_interventi (corso_id, giornata_id, qualita, nominativo) values (v_corso, v_g, 'docente', 'Docente Di Prova');
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, mansione, esito) values (v_corso, 'ROSSI MARIO', 'RSSMRA80A01H501U', 'Impresa Uno', 'operaio', 'presente') returning id into v_i1;
  insert into public.s_corsi_iscritti (corso_id, nominativo, cf, impresa_txt, esito) values (v_corso, 'BIANCHI LUCA', 'BNCLCU85B02H501Z', 'Impresa Due', 'presente') returning id into v_i2;
  insert into public.s_corsi_presenze (iscritto_id, giornata_id, presente, ore) values (v_i1, v_g, true, 8), (v_i2, v_g, true, 6);
  perform public.corso_progetto_stato(v_corso, 'pronto');
  assert (select progetto_stato from public.s_corsi where id = v_corso) = 'pronto', 'progetto pronto';
  v := public.corso_verbale_prepara(v_corso);
  assert jsonb_array_length(v.scrutinio) = 2 and jsonb_array_length(v.esaminatori) = 1 and v.data_verifica = '2026-10-13', 'scrutinio con 2 iscritti e 1 esaminatore';
  select (r ->> 'ammesso')::boolean into ok from jsonb_array_elements(v.scrutinio) r where r ->> 'nominativo' = 'ROSSI MARIO';
  assert ok, 'Rossi con 8 ore su 8 e'' ammesso';
  select (r ->> 'ammesso')::boolean into ok from jsonb_array_elements(v.scrutinio) r where r ->> 'nominativo' = 'BIANCHI LUCA';
  assert not ok, 'Bianchi con 6 ore su 8 (75%) non e'' ammesso';
  begin
    perform public.corso_verbale_stato(v.id, 'pronto'); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: non pronto senza esito della verifica (%)', sqlerrm;
  end;
  v := public.corso_verbale_salva(jsonb_build_object('id', v.id, 'scrutinio',
        (select jsonb_agg(case when r ->> 'nominativo' = 'ROSSI MARIO' then r || '{"verifica":"colloquio"}'::jsonb else r end) from jsonb_array_elements(v.scrutinio) r)));
  begin
    perform public.corso_verbale_stato(v.id, 'pronto'); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: colloquio senza argomenti rifiutato (%)', sqlerrm;
  end;
  v := public.corso_verbale_salva(jsonb_build_object('id', v.id, 'argomenti_colloquio', 'triangolo della combustione, estintori'));
  v := public.corso_verbale_stato(v.id, 'pronto');
  assert v.stato = 'pronto', 'verbale pronto';
  v := public.corso_verbale_stato(v.id, 'in_firma');
  begin
    update public.s_corsi_iscritti set attestato_numero = '99/2026' where id = v_i1; raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: guardiano attestati (%)', sqlerrm;
  end;
  raise notice 'OK lotto 3: progetto, verbale, guardiano';
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_v bigint; v_corso bigint; v_f bigint; st text;
begin
  select id, corso_id into v_v, v_corso from public.s_corsi_verbali_verifica where stato = 'in_firma' order by id desc limit 1;
  insert into public.s_firme (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, richiesta_da, firmatario_email, firmatario_ruolo, ordine, stato)
  values ('verbale_verifica', 'verbale:' || v_v, 'Verbale prova', 'v.pdf', 'originali/v.pdf', repeat('e', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test', 'rpf.prova@esempio.test', 'rpf', 1, 'in_attesa') returning id into v_f;
  update public.s_firme set stato = 'firmata', firmata_il = now(), file_firmato = 'firmate/v.pdf', sha256_firmato = repeat('f', 64) where id = v_f;
  select stato into st from public.s_corsi_verbali_verifica where id = v_v;
  assert st = 'firmato', 'il verbale e'' firmato dopo la firma (' || st || ')';
  update public.s_corsi_iscritti set attestato_numero = '99/2026' where corso_id = v_corso and nominativo = 'ROSSI MARIO';
  raise notice 'OK: dopo il verbale firmato l''attestato passa';
end $$;
rollback;
