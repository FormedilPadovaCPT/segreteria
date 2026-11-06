-- Test del promemoria di pubblicazione dei post nel calendario (06/11/2026: 2026_11_06b_post_calendario.sql).
--   · il trigger chiama la funzione calendario-post quando un post diventa approvato, cambia data o titolo
--     da approvato, viene pubblicato o torna indietro;
--   · non la chiama per i cambi che non riguardano il calendario (testi di una bozza, la sola esito del calendario);
--   · la chiamata porta la parola d'ordine di s_config e l'id del post.
-- Tutto dentro una transazione annullata: la coda di pg_net si annulla con lei, nessuna chiamata parte.
begin;

do $$
declare pid bigint; n0 int; n int; v_dir text; r jsonb; pas bigint; v_segr text;
begin
  select lower(email) into v_segr from public.app_ruoli where ruolo in ('segreteria', 'admin') and stato = 'attivo' order by email limit 1;
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  assert exists (select 1 from public.s_config where chiave = 'calendario_post_token' and length(valore) >= 32), 'la parola d''ordine c''è';
  select count(*) into n0 from net.http_request_queue where url like '%/functions/v1/calendario-post';

  insert into public.s_post (titolo, testo_telegram, stato, creato_da, data_programmata) values ('Prova test calendario', 'x', 'bozza', 'test', current_date + 5) returning id into pid;
  update public.s_post set testo_telegram = 'y' where id = pid;
  select count(*) into n from net.http_request_queue where url like '%/functions/v1/calendario-post';
  assert n = n0, 'una bozza che cambia testo non chiama il calendario';

  /* approvato dal Direttore → chiamata */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  r := public.s_post_manda(pid, 'direttore');
  select count(*) into n from net.http_request_queue where url like '%/functions/v1/calendario-post';
  assert n = n0, 'mandarlo al Direttore non chiama il calendario';
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  perform public.s_post_decidi((r ->> 'passaggio')::bigint, 'approvato');
  select count(*) into n from net.http_request_queue where url like '%/functions/v1/calendario-post';
  assert n = n0 + 1, 'approvato: una chiamata, trovate ' || (n - n0);
  assert exists (select 1 from net.http_request_queue where url like '%/functions/v1/calendario-post'
                 and convert_from(body, 'UTF8')::jsonb ->> 'post_id' = pid::text
                 and headers ->> 'X-Calendario-Post' = (select valore from public.s_config where chiave = 'calendario_post_token')),
    'la chiamata porta il post e la parola d''ordine';

  /* la data cambia → chiamata; l'esito del calendario → nessuna */
  update public.s_post set data_programmata = current_date + 7 where id = pid;
  update public.s_post set calendario_esito = 'prova', calendario_il = now() where id = pid;
  select count(*) into n from net.http_request_queue where url like '%/functions/v1/calendario-post';
  assert n = n0 + 2, 'cambio di data: una chiamata; esito del calendario: nessuna. Trovate ' || (n - n0);

  /* pubblicato → chiamata */
  update public.s_post set stato = 'pubblicato', pubblicato_il = now() where id = pid;
  select count(*) into n from net.http_request_queue where url like '%/functions/v1/calendario-post';
  assert n = n0 + 3, 'pubblicato: una chiamata';
end $$;

rollback;
