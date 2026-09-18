-- Test del questionario di gradimento di un evento (18/09/2026):
-- s_quest_modelli + s_quest_domande + s_quest_risposte, il link firmato, la
-- finestra, il tetto e la doppia spunta.
-- Tutto dentro una transazione che viene annullata: non resta niente.
begin;

do $$
declare
  v_sgr text; v_altro text; v_corso bigint; v_isc1 bigint; v_isc2 bigint;
  v_cod text; v_link text; v_fine timestamptz; v_tetto int;
  v_dom bigint; v_pub jsonb; v_rip jsonb; n int; ok boolean; v_rif text;
begin
  select lower(email) into v_sgr from public.app_ruoli
   where ruolo in ('segreteria','admin') and stato = 'attivo' order by email limit 1;
  assert v_sgr is not null, 'serve un account di segreteria attivo';
  select lower(email) into v_altro from public.tecnici
   where attivo and email is not null and lower(email) <> v_sgr order by tecnico_cognome limit 1;

  -- ===== la segreteria apre il questionario =====
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',v_sgr)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.s_corsi (titolo, tipo, data_inizio, data_fine, durata_ore, stato)
  values ('TEST questionario evento', 'corso', current_date, current_date, 6, 'bozza')
  returning id into v_corso;

  insert into public.s_corsi_iscritti (corso_id, nominativo, esito)
  values (v_corso, 'ZZQUESTUNO Alfa', 'in_attesa') returning id into v_isc1;
  insert into public.s_corsi_iscritti (corso_id, nominativo, esito)
  values (v_corso, 'ZZQUESTDUE Beta', 'in_attesa') returning id into v_isc2;
  insert into public.s_corsi_iscritti (corso_id, nominativo, esito)
  values (v_corso, 'ZZQUESTTRE Gamma', 'annullato');

  select codice, link, chiuso_il, tetto into v_cod, v_link, v_fine, v_tetto
    from public.quest_apri(v_corso, 'corso', 48, null);

  assert v_cod like v_corso::text || '-%', 'il codice porta il numero del corso: ' || v_cod;
  -- l'alfabeto ristretto vale per le quattro lettere, non per il numero del corso
  assert split_part(v_cod, '-', 2) !~ '[OIL01]', 'nel codice non ci sono caratteri che si confondono: ' || v_cod;
  assert length(split_part(v_cod, '-', 2)) = 4, 'quattro caratteri dopo il trattino: ' || v_cod;
  assert v_link like '%?evento=%', 'il link porta il riferimento firmato';
  assert v_tetto = 7, 'il tetto è i presenti più cinque, e chi è annullato non conta: ' || v_tetto;
  assert v_fine > now(), 'la finestra è ancora aperta';
  assert v_fine < now() + interval '4 days', 'la finestra sono 48 ore dalla fine, non di più';
  assert (select questionario_previsto from public.s_corsi where id = v_corso), 'il corso risulta col questionario';

  -- riaprire non cambia il codice: i fogli già stampati devono continuare a valere
  declare v_cod2 text;
  begin
    select codice into v_cod2 from public.quest_apri(v_corso, null, 48, null);
    assert v_cod2 = v_cod, 'riaprendo, il codice resta quello stampato';
  end;

  -- ===== le domande =====
  assert (select count(*) from public.s_quest_domande where modello = 'corso' and tronco) = 3,
    'il tronco del corso è di tre domande';

  ok := false;
  begin delete from public.s_quest_domande where modello = 'corso' and tronco and ordine = 1;
  exception when others then ok := true; end;
  assert ok, 'il tronco comune non si cancella';

  insert into public.s_quest_domande (corso_id, ordine, testo, tipo, opzioni)
  values (v_corso, 1, 'Il preposto ha una nomina scritta?', 'scelta', '["sì","no","non so"]'::jsonb)
  returning id into v_dom;

  ok := false;
  begin
    insert into public.s_quest_domande (corso_id, ordine, testo, tipo, opzioni)
    values (v_corso, 2, 'Senza opzioni', 'scelta', '[]'::jsonb);
  exception when check_violation then ok := true; end;
  assert ok, 'una domanda a scelta senza risposte proposte non passa';

  ok := false;
  begin
    insert into public.s_quest_domande (modello, corso_id, ordine, testo, tipo)
    values ('corso', v_corso, 3, 'Di chi sei?', 'testo');
  exception when check_violation then ok := true; end;
  assert ok, 'una domanda o è del modello o è dell''evento, mai tutte e due';

  -- il sesto rifiuto: cinque domande proprie e basta
  insert into public.s_quest_domande (corso_id, ordine, testo, tipo)
  select v_corso, g, 'Domanda ' || g, 'testo' from generate_series(2,5) g;
  ok := false;
  begin
    insert into public.s_quest_domande (corso_id, ordine, testo, tipo)
    values (v_corso, 6, 'Una di troppo', 'testo');
  exception when others then ok := true; end;
  assert ok, 'oltre cinque domande proprie non si va';

  -- ===== che cosa vede il portale =====
  v_pub := public.quest_pubblicazione(v_corso);
  assert v_pub ->> 'codice' = v_cod, 'la pubblicazione porta il codice';
  assert jsonb_array_length(v_pub -> 'domande') = 8, 'tre del tronco più cinque dell''evento';
  assert (v_pub -> 'domande' -> 0 ->> 'tronco')::boolean, 'il tronco viene prima';
  -- ⚠️ i nominativi di prova cominciano con ZZQUEST apposta: cercare «ROSSI»
  -- in un testo italiano lo trova dentro «p-rossi-ma volta» del tronco, e il
  -- controllo diventa un falso allarme (successo davvero, 18/09/2026).
  assert v_pub::text not ilike '%ZZQUEST%', 'nella pubblicazione non finisce nessun nominativo';

  -- ===== la verifica del riferimento =====
  -- il riferimento si prende dal LINK, non rifirmando: quest_firma è del
  -- servizio e un utente non la può chiamare (ed è giusto che sia così).
  v_rif := split_part(v_link, '?evento=', 2);
  assert v_rif like v_cod || '.%', 'il link porta codice e firma: ' || v_rif;
  -- quest_verifica è del SERVIZIO (la chiama chi ritira dalla cassetta): un
  -- utente dell'app non la può chiamare, quindi qui si smette di impersonarlo.
  perform set_config('role', 'none', true);
  assert (select esito from public.quest_verifica(v_rif)) = 'agganciato', 'il riferimento buono aggancia';
  assert (select corso_id from public.quest_verifica(v_rif)) = v_corso, 'e aggancia il corso giusto';
  assert (select aperto from public.quest_verifica(v_rif)), 'la finestra risulta aperta';
  assert not (select oltre_tetto from public.quest_verifica(v_rif)), 'senza risposte non siamo oltre il tetto';
  assert (select esito from public.quest_verifica(v_cod || '.000000000000')) = 'firma non valida',
    'una firma inventata non passa';

  perform set_config('role', 'authenticated', true);

  -- ===== le risposte =====
  insert into public.s_quest_risposte (corso_id, utilita, risposte, submission_id)
  select v_corso, 4, jsonb_build_object(v_dom::text, 'sì'), 'test-' || g from generate_series(1,7) g;

  perform set_config('role', 'none', true);
  assert (select oltre_tetto from public.quest_verifica(v_rif)), 'al settimo si è raggiunto il tetto';
  perform set_config('role', 'authenticated', true);

  ok := false;
  begin
    insert into public.s_quest_risposte (corso_id, utilita, submission_id) values (v_corso, 4, 'test-1');
  exception when unique_violation then ok := true; end;
  assert ok, 'lo stesso invio non entra due volte';

  ok := false;
  begin
    insert into public.s_quest_risposte (corso_id, fonte, utilita) values (v_corso, 'carta', 3);
  exception when check_violation then ok := true; end;
  assert ok, 'un cartaceo deve dire chi lo ha trascritto';

  insert into public.s_quest_risposte (corso_id, fonte, utilita, inserita_da, oltre_tetto)
  values (v_corso, 'carta', 2, v_sgr, false);

  ok := false;
  begin insert into public.s_quest_risposte (corso_id, utilita) values (v_corso, 9);
  exception when check_violation then ok := true; end;
  assert ok, 'la scala va da 1 a 5';

  -- la riga non deve poter dire l'ora: è ciò che tiene anonime le risposte
  assert (select count(*) from information_schema.columns
           where table_name = 's_quest_risposte'
             and data_type like 'timestamp%') = 0,
    'in s_quest_risposte non ci sono istanti, solo la data';

  -- ===== la doppia spunta =====
  n := public.quest_spunta(v_corso);              -- tutti
  assert n = 2, 'in blocco si spuntano i due ammessi, non chi è annullato: ' || n;
  assert (select quest_fonte from public.s_corsi_iscritti where id = v_isc1) = 'blocco', 'fonte blocco';
  assert (select quest_compilato_da from public.s_corsi_iscritti where id = v_isc1) = v_sgr, 'resta chi ha spuntato';
  assert (select quest_compilato_il from public.s_corsi_iscritti where id = v_isc1) = current_date, 'e quando';

  n := public.quest_spunta(v_corso, array[v_isc2], false);   -- e poi si toglie chi manca
  assert n = 1 and not (select quest_compilato from public.s_corsi_iscritti where id = v_isc2),
    'dopo il blocco si toglie la singola';
  assert (select quest_compilato from public.s_corsi_iscritti where id = v_isc1), 'l''altro resta spuntato';

  n := public.quest_spunta(v_corso, array[v_isc2], true, 'carta');
  assert (select quest_fonte from public.s_corsi_iscritti where id = v_isc2) = 'carta', 'il cartaceo si dichiara';

  ok := false;
  begin n := public.quest_spunta(v_corso, null, true, 'inventata');
  exception when others then ok := true; end;
  assert ok, 'una fonte non prevista non passa';

  -- ===== il riepilogo =====
  v_rip := public.quest_riepilogo(v_corso);
  assert (v_rip ->> 'iscritti')::int = 2, 'iscritti ammessi';
  assert (v_rip ->> 'spuntati')::int = 2, 'spuntati';
  assert (v_rip ->> 'raccolte')::int = 8, 'risposte che contano';
  assert (v_rip ->> 'su_carta')::int = 1, 'di cui una su carta';
  assert (v_rip ->> 'voti_bassi')::int = 1, 'un voto basso';

  -- ===== chi non è segreteria non tocca niente =====
  if v_altro is not null then
    perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',v_altro)::text, true);
    ok := false;
    begin perform public.quest_apri(v_corso, null, 48, null);
    exception when others then ok := true; end;
    assert ok, 'un tecnico non apre il questionario di un evento';

    ok := false;
    begin perform public.quest_spunta(v_corso);
    exception when others then ok := true; end;
    assert ok, 'un tecnico non spunta';

    assert public.quest_riepilogo(v_corso) is null, 'un tecnico non legge il riepilogo';
    assert (select count(*) from public.s_quest_risposte where corso_id = v_corso) = 0,
      'un tecnico non vede le risposte';
    assert (select count(*) from public.s_quest_domande where corso_id = v_corso) = 0,
      'un tecnico non vede le domande';
  end if;

  raise notice 'questionario evento: tutto a posto (corso di prova %, codice %)', v_corso, v_cod;
end $$;

rollback;
