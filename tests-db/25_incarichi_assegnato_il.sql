-- Test della data di assegnazione degli incarichi (gestionale, 07/10/2026: 2026_10_07_incarichi_assegnato_il.sql).
--   · un incarico nuovo con il tecnico prende assegnato_il; senza tecnico no;
--   · riassegnato a un altro tecnico, la data riparte; tolto il tecnico, si svuota;
--   · un aggiornamento che non tocca il tecnico non la cambia;
--   · chi non gestisce gli incarichi non la cambia (la guardia la rimette com'era);
--   · gli incarichi di prima sono stati riempiti dalla data di risposta o di richiesta.
-- Tutto dentro una transazione annullata. Gli id sono negativi e scritti a mano: il numero dell'incarico è quello
-- che vedono tecnici e segreteria, e un nextval consumato non torna indietro col rollback.
begin;

do $$
declare id1 bigint; id2 bigint; a1 timestamptz; a2 timestamptz; n int;
begin
  perform set_config('app.incarico_sistema', '1', true);   -- come la segreteria

  insert into public.incarichi (id, data_richiesta, tipo_richiesta, tecnico_nome, tecnico_email, stato)
  values (-925001, current_date, 'PROVA test 25', 'Prova A', 'prova.a@example.invalid', 'aperto') returning id, assegnato_il into id1, a1;
  assert a1 is not null and a1 > now() - interval '1 minute', 'nuovo con tecnico: assegnato adesso';

  insert into public.incarichi (id, data_richiesta, tipo_richiesta, stato)
  values (-925002, current_date, 'PROVA test 25', 'aperto') returning id, assegnato_il into id2, a2;
  assert a2 is null, 'nuovo senza tecnico: nessuna data';

  update public.incarichi set assegnato_il = now() - interval '20 days' where id = id1;
  update public.incarichi set note_tecnico = 'nota' where id = id1;
  select assegnato_il into a1 from public.incarichi where id = id1;
  assert a1 < now() - interval '19 days', 'un aggiornamento che non tocca il tecnico non cambia la data';

  update public.incarichi set tecnico_email = 'PROVA.A@example.invalid ' where id = id1;
  select assegnato_il into a1 from public.incarichi where id = id1;
  assert a1 < now() - interval '19 days', 'stessa mail scritta diversa: non è una riassegnazione';

  update public.incarichi set tecnico_email = 'prova.b@example.invalid', tecnico_nome = 'Prova B' where id = id1;
  select assegnato_il into a1 from public.incarichi where id = id1;
  assert a1 > now() - interval '1 minute', 'riassegnato: si riparte da zero';

  update public.incarichi set tecnico_email = 'prova.c@example.invalid' where id = id2;
  select assegnato_il into a2 from public.incarichi where id = id2;
  assert a2 is not null, 'assegnato dopo: prende la data';

  update public.incarichi set tecnico_email = null where id = id2;
  select assegnato_il into a2 from public.incarichi where id = id2;
  assert a2 is null, 'tolto il tecnico: data vuota';

  -- un tecnico (non gestione): la guardia rimette tecnico e data
  perform set_config('app.incarico_sistema', '', true);
  update public.incarichi set assegnato_il = now() - interval '200 days' where id = id1;
  update public.incarichi set tecnico_email = 'altro@example.invalid' where id = id1;
  select assegnato_il into a1 from public.incarichi where id = id1;
  assert a1 > now() - interval '1 minute', 'chi non gestisce gli incarichi non cambia né il tecnico né la data';
  assert (select tecnico_email from public.incarichi where id = id1) = 'prova.b@example.invalid';

  -- lo storico
  select count(*) into n from public.incarichi
   where assegnato_il is null and nullif(btrim(tecnico_email), '') is not null and coalesce(data_risposta, data_richiesta) is not null;
  assert n = 0, n || ' incarichi assegnati senza data di assegnazione';
  assert (select (assegnato_il at time zone 'Europe/Rome')::date from public.incarichi where id = 1081) = date '2026-07-29',
    'il 1081 conta dalla data di risposta (29/07/2026)';

  raise notice 'OK 25_incarichi_assegnato_il';
end $$;

rollback;
