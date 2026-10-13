-- 37 — Tipologie di corso e scheda formativa (13/10/2026, lotto 2 del fascicolo corso digitale)
-- Eseguita sul database il 13/10/2026 dentro una transazione annullata: tutti gli assert passano.
-- Dati INVENTATI.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);
do $$
declare t public.s_corsi_tipologie; s public.s_corsi_schede_formative; s2 public.s_corsi_schede_formative;
begin
  t := public.tipologia_salva('{"codice":"PROVA-L2","titolo":"Prova antincendio livello 2","ore_minime":8,"validita_anni":5,"aggiornamento_ore":5,"aggiornamento_anni":5,"vale_anche_come":["aggiornamento preposto"]}'::jsonb);
  assert t.id is not null and t.perc_freq_min = 90 and t.accordo_2025, 'tipologia creata coi predefiniti';
  t := public.tipologia_salva(jsonb_build_object('id', t.id, 'note', 'solo le note'));
  assert t.ore_minime = 8 and t.note = 'solo le note', 'aprire e salvare non cambia niente: solo le chiavi presenti';
  s := public.scheda_salva(jsonb_build_object('tipologia_id', t.id, 'traguardi', 'Gestire la sicurezza antincendio'));
  assert s.versione = 1 and s.stato = 'bozza', 'prima versione in bozza';
  begin
    perform public.scheda_stato(s.id, 'pronta'); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: senza contenuti non e'' pronta (%)', sqlerrm;
  end;
  s := public.scheda_salva(jsonb_build_object('id', s.id, 'contenuti', '[{"unita":"Incendio e prevenzione","argomenti":"combustione","ore":2}]'::jsonb));
  s := public.scheda_stato(s.id, 'pronta');
  assert s.stato = 'pronta', 'pronta';
  s := public.scheda_stato(s.id, 'in_firma');
  assert s.stato = 'in_firma', 'in firma';
  s2 := public.scheda_salva(jsonb_build_object('tipologia_id', t.id));
  assert s2.versione = 2 and s2.traguardi = 'Gestire la sicurezza antincendio' and jsonb_array_length(s2.contenuti) = 1, 'la versione 2 parte dalla 1';
  raise notice 'OK: tipologia, scheda, stati, versione nuova';
end $$;

-- un docente delegato scrive la sua scheda, non le altre, e non si cambia la delega
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into public.app_ruoli (email, ruolo, stato, nome) values ('docente.prova@esempio.test', 'docente', 'attivo', 'Docente Di Prova');
update public.s_corsi_schede_formative set delegata_a = 'docente.prova@esempio.test' where versione = 2 and tipologia_id = (select id from public.s_corsi_tipologie where codice = 'PROVA-L2');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"docente.prova@esempio.test","sub":"00000000-0000-0000-0000-000000000036"}', true);
do $$
declare n bigint; s public.s_corsi_schede_formative; v_altra bigint;
begin
  select count(*) into n from public.s_corsi_schede_formative; assert n = 1, 'il docente vede la sola scheda delegata (' || n || ')';
  select id into s.id from public.s_corsi_schede_formative limit 1;
  s := public.scheda_salva(jsonb_build_object('id', s.id, 'abilita', 'scritta dal delegato', 'delegata_a', 'altro@esempio.test'));
  assert s.abilita = 'scritta dal delegato' and s.delegata_a = 'docente.prova@esempio.test', 'il delegato scrive i campi ma non si cambia la delega';
  begin
    perform public.scheda_salva(jsonb_build_object('tipologia_id', s.tipologia_id)); raise exception 'ATTESO_FALLIMENTO';
  exception when others then
    if sqlerrm = 'ATTESO_FALLIMENTO' then raise; end if;
    raise notice 'OK: il delegato non apre versioni nuove (%)', sqlerrm;
  end;
  raise notice 'OK: delegato';
end $$;

-- il registro delle firme chiude il giro: ultima firma → scheda firmata e vigente
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare v_s bigint; v_t bigint; v_f bigint; st text; vig bigint;
begin
  select id, tipologia_id into v_s, v_t from public.s_corsi_schede_formative where stato = 'in_firma' order by id desc limit 1;
  insert into public.s_firme (tipo, rif, titolo, nome_file, file_originale, sha256_originale, riquadro, richiesta_da, firmatario_email, firmatario_ruolo, ordine, stato)
  values ('scheda_formativa', 'scheda:' || v_s, 'Scheda prova', 'scheda.pdf', 'originali/x.pdf', repeat('c', 64), '{"pagina":0,"x":1,"y":1,"w":10,"h":10}', 'test', 'rpf.prova@esempio.test', 'rpf', 1, 'in_attesa')
  returning id into v_f;
  update public.s_firme set stato = 'firmata', firmata_il = now(), file_firmato = 'firmate/x.pdf', sha256_firmato = repeat('d', 64) where id = v_f;
  select stato into st from public.s_corsi_schede_formative where id = v_s;
  select scheda_vigente_id into vig from public.s_corsi_tipologie where id = v_t;
  assert st = 'firmata', 'la scheda e'' firmata dopo l''ultima firma (' || st || ')';
  assert vig = v_s, 'la tipologia ha la scheda vigente';
  raise notice 'OK: il registro delle firme chiude il giro';
end $$;

-- anon a zero
reset role;
set local role anon;
do $$
declare n bigint;
begin
  select count(*) into n from pg_proc p where p.proname in ('tipologia_salva', 'scheda_salva', 'scheda_stato', 'scheda_posso_scrivere', 's_firme_dopo_scheda')
     and p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert n = 0, n || ' funzioni delle schede eseguibili da anon';
  raise notice 'OK: anon a zero sulle schede';
end $$;
rollback;
