-- Incarichi di docenza correggibili e fatture di soggetti esterni (19/09/2026).
-- Quello che deve reggere:
--   1. la qualità dell'incarico sta in un vocabolario chiuso, e lo storico è «docente»;
--   2. il compenso FORFETTARIO si scrive (ore e tariffa vuote, corrispettivo pieno);
--   3. una fattura di un ESTERNO si registra senza tecnico e, una volta approvata,
--      compare fra quelle che il mandato all'Amministrazione può prendere;
--   4. l'Amministrazione la vede solo quando è in un mandato, e il tecnico non la vede;
--   5. eliminare l'incarico non porta via la fattura.
-- Transazione annullata: non resta niente.
begin;

do $$
declare v_k bigint; v_f bigint; v_m bigint; ok boolean; n int; v_corso bigint;
begin
  -- un corso qualsiasi su cui appoggiare la prova
  select id into v_corso from public.s_corsi order by id desc limit 1;
  assert v_corso is not null, 'serve almeno un corso';

  -- 1. vocabolario chiuso
  ok := false;
  begin
    insert into public.s_corsi_incarichi(corso_id, nominativo, qualita)
      values (v_corso, 'TEST vocabolario', 'relatore-ospite-speciale');
  exception when check_violation then ok := true; end;
  assert ok, 'la qualità deve stare nel vocabolario di s_corsi_interventi';
  assert (select count(*) from public.s_corsi_incarichi where qualita is null) = 0, 'qualita sempre valorizzata';

  -- 2. compenso forfettario: nessun vincolo lo impedisce, ed è la riga dell'ospite
  insert into public.s_corsi_incarichi(corso_id, nominativo, qualita, corrispettivo, note)
    values (v_corso, 'TEST Ospite', 'ospite', 300, 'compenso a intervento')
    returning id into v_k;
  assert (select ore is null and tariffa_oraria is null and corrispettivo = 300
          from public.s_corsi_incarichi where id = v_k), 'forfait: solo il corrispettivo';

  -- 3. la fattura dell'esterno si registra senza tecnico ed è pronta per il mandato
  insert into public.s_fatture_tecnici(tecnico_id, tecnico_nome, esterno, soggetto_email,
      corso_incarico_id, numero, data_fattura, data_ricevimento, importo, stato)
    values (null, 'TEST Ospite', true, 'prova@example.org', v_k, 'TEST 1/2026',
      current_date, current_date, 300, 'approvata')
    returning id into v_f;
  select count(*) into n from public.s_fatture_tecnici where stato = 'approvata' and id = v_f;
  assert n = 1, 'una fattura senza tecnico deve poter essere approvata e finire in mandato';

  -- 4. chi la vede: l'Amministrazione solo dentro un mandato, il tecnico mai
  insert into public.s_mandati_pagamento(data, totale, creato_da)
    values (current_date, 300, 'test') returning id into v_m;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'amministrazione@formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.s_fatture_tecnici where id = v_f;
  assert n = 0, 'senza mandato l''Amministrazione non vede la fattura';
  perform set_config('role', 'postgres', true);
  update public.s_fatture_tecnici set mandato_id = v_m, mandato_data = current_date, stato = 'mandato' where id = v_f;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'amministrazione@formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.s_fatture_tecnici where id = v_f;
  assert n = 1, 'in mandato, l''Amministrazione la vede e la può firmare';

  perform set_config('role', 'postgres', true);
  -- ⚠️ non De Marco: è il coordinatore, e le fatture le vede tutte per approvarle
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'marco.camuffo@did.formedilpadova.it')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from public.s_fatture_tecnici where id = v_f;
  assert n = 0, 'la fattura di un esterno non è di nessun tecnico';

  -- 5. l'incarico si può eliminare senza portarsi via la fattura pagata
  perform set_config('role', 'postgres', true);
  delete from public.s_corsi_incarichi where id = v_k;
  select count(*) into n from public.s_fatture_tecnici where id = v_f and corso_incarico_id is null;
  assert n = 1, 'la fattura resta, senza più il riferimento all''incarico';

  raise notice 'OK incarichi di docenza e fatture di soggetti esterni';
end $$;

rollback;
