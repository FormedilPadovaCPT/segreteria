-- 54 — La conferma dell'iscrizione parte dal database (18/11/2026).
-- Quando una richiesta diventa «confermata» il trigger accoda (pg_net) la
-- chiamata a promemoria-corsi; la registrazione in sala no; un'altra modifica
-- non la rimanda. In transazione annullata pg_net non spedisce niente.
-- Eseguita il 18/11/2026: passa.
begin;
do $$
declare v_c bigint; v_i bigint; v_s bigint; n0 int; n1 int; n2 int;
begin
  insert into public.s_corsi (titolo, tipo, stato, data_inizio) values ('Prova aggancio', 'convegno', 'aperto', current_date) returning id into v_c;
  insert into public.s_iscrizioni (corso_id, fonte, stato, per_conto, referente, persone)
  values (v_c, 'portale', 'nuova', 'persona', 'X', '[{"cognome":"X","nome":"Y","cf":"RSSMRA80A01H501U"}]') returning id into v_i;
  insert into public.s_iscrizioni (corso_id, fonte, stato, per_conto, referente, persone)
  values (v_c, 'portale', 'nuova', 'persona', 'Z', '[{"cognome":"Z","nome":"W","cf":"RSSMRA80A01H501U","in_sala":"entrata"}]') returning id into v_s;
  select count(*) into n0 from net.http_request_queue;
  update public.s_iscrizioni set stato = 'confermata' where id = v_i;
  select count(*) into n1 from net.http_request_queue;
  assert n1 = n0 + 1, 'la conferma accoda la chiamata: ' || n0 || ' → ' || n1;
  update public.s_iscrizioni set stato = 'confermata' where id = v_s;
  select count(*) into n2 from net.http_request_queue;
  assert n2 = n1, 'la registrazione in sala non accoda niente';
  update public.s_iscrizioni set note_ufficio = 'x' where id = v_i;
  assert (select count(*) from net.http_request_queue) = n2, 'un''altra modifica non rimanda';
  raise notice 'OK conferma dal database';
end $$;
rollback;
