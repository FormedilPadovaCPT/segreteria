-- Test del visto del Coordinatore e dell'approvazione del Direttore sui post social
-- (06/11/2026: 2026_11_06_post_visto_coordinatore_direttore.sql).
--   · la segreteria manda una bozza al Coordinatore o al Direttore; mentre aspetta il post non si cambia;
--   · «approvato» lo dà solo il Direttore: né la segreteria né l'insert diretto ci arrivano;
--   · il Coordinatore chiede modifiche (nota obbligatoria: torna in bozza) o dà il visto (passa al Direttore,
--     col visto scritto nella fotografia);
--   · il Direttore approva, approva con indicazioni (nota obbligatoria) o non approva (nota obbligatoria);
--   · ognuno decide solo i suoi passaggi, e ognuno legge solo i suoi (RLS);
--   · partono le notifiche del gestionale; la segreteria può ritirare un post che aspetta.
-- Tutto dentro una transazione annullata: non resta nessuna riga (e nessuna notifica parte).
begin;

do $$
declare
  v_segr text; v_coord text; v_dir text; pid bigint; pid2 bigint; r jsonb; pas bigint; pas2 bigint;
  ok boolean; msg text; n int;
begin
  select lower(email) into v_segr from public.app_ruoli where ruolo in ('segreteria', 'admin') and stato = 'attivo' order by email limit 1;
  select lower(valore) into v_coord from public.s_config where chiave = 'coordinatore_email';
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  assert v_segr is not null and v_coord is not null and v_dir is not null, 'servono segreteria, coordinatore e direttore';

  /* un post nuovo nasce bozza */
  ok := false;
  begin insert into public.s_post (titolo, testo_telegram, stato) values ('Prova test', 'x', 'approvato'); exception when others then ok := sqlerrm like 'Un post nuovo nasce come bozza%'; end;
  assert ok, 'un post non nasce già approvato';
  insert into public.s_post (titolo, testo_telegram, testo_app, stato, creato_da) values ('Prova test visto', 'testo **prova**', 'testo prova', 'bozza', 'test') returning id into pid;
  insert into public.s_post (titolo, testo_telegram, stato, creato_da) values ('Prova test ritiro', 'altro', 'bozza', 'test') returning id into pid2;

  /* la segreteria non si approva da sé */
  ok := false;
  begin update public.s_post set stato = 'approvato' where id = pid; exception when others then ok := sqlerrm like 'Un post lo approva il Direttore%'; end;
  assert ok, 'la segreteria non mette «approvato» a mano';
  ok := false;
  begin update public.s_post set stato = 'pubblicato' where id = pid; exception when others then ok := sqlerrm like 'Si pubblica solo un post approvato%'; end;
  assert ok, 'una bozza non diventa «pubblicato»';

  /* chi non è segreteria non manda */
  perform set_config('request.jwt.claims', json_build_object('email', v_coord, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_manda(pid, 'coordinatore'); exception when others then ok := sqlerrm like 'Il post lo manda la segreteria%'; end;
  assert ok, 'il Coordinatore non manda i post';

  /* la segreteria manda al Coordinatore */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  r := public.s_post_manda(pid, 'coordinatore', 'C''è un dato sui ponteggi');
  pas := (r ->> 'passaggio')::bigint;
  assert (select stato from public.s_post where id = pid) = 'al_coordinatore', 'il post aspetta il Coordinatore';
  assert (select testi ->> 'testo_telegram' from public.s_post_passaggi where id = pas) = 'testo **prova**', 'la fotografia tiene il testo mandato';
  assert exists (select 1 from public.push_coda where email = v_coord and tag = 'post-' || pid), 'al Coordinatore arriva la notifica';
  ok := false;
  begin perform public.s_post_manda(pid, 'direttore'); exception when others then ok := sqlerrm like 'Si manda una bozza%'; end;
  assert ok, 'un post che aspetta non si manda una seconda volta';

  /* mentre aspetta non si cambia, e non si scarta */
  ok := false;
  begin update public.s_post set testo_telegram = 'cambiato' where id = pid; exception when others then ok := sqlerrm like 'Il post è dal Coordinatore%'; end;
  assert ok, 'il testo non si cambia mentre il Coordinatore lo guarda';
  ok := false;
  begin update public.s_post set stato = 'scartato' where id = pid; exception when others then ok := sqlerrm like '%solo coi pulsanti%'; end;
  assert ok, 'un post che aspetta non si scarta: prima si ritira';
  update public.s_post set data_programmata = current_date + 3 where id = pid;   -- la data si sposta lo stesso

  /* il Direttore non decide un passaggio del Coordinatore */
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'visto'); exception when others then ok := sqlerrm like 'Il visto spetta al Coordinatore%'; end;
  assert ok, 'il visto è del Coordinatore';

  /* il Coordinatore chiede modifiche: senza nota no, con la nota torna in bozza */
  perform set_config('request.jwt.claims', json_build_object('email', v_coord, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'modifiche', ' '); exception when others then ok := sqlerrm like 'Scrivi che cosa cambiare%'; end;
  assert ok, 'chi chiede modifiche scrive quali';
  ok := false;
  begin perform public.s_post_decidi(pas, 'approvato'); exception when others then ok := sqlerrm like 'Il Coordinatore dà il visto o chiede modifiche%'; end;
  assert ok, 'il Coordinatore non approva';
  r := public.s_post_decidi(pas, 'modifiche', 'Cita l''art. 122 del D.Lgs. 81/2008');
  assert (select stato from public.s_post where id = pid) = 'bozza', 'con le modifiche il post torna alla segreteria';
  assert (select nota from public.s_post_passaggi where id = pas) like 'Cita l''art. 122%', 'la nota resta scritta';
  assert exists (select 1 from public.push_coda where email = v_segr and evento = 'post_modifiche' and tag = 'post-' || pid), 'la segreteria è avvisata';
  ok := false;
  begin perform public.s_post_decidi(pas, 'visto'); exception when others then ok := sqlerrm like 'Su questo post si è già deciso%'; end;
  assert ok, 'un passaggio deciso non si decide di nuovo';

  /* la segreteria corregge e rimanda; il Coordinatore dà il visto: passa al Direttore */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  update public.s_post set testo_telegram = 'testo corretto, art. 122' where id = pid;
  r := public.s_post_manda(pid, 'coordinatore');
  pas := (r ->> 'passaggio')::bigint;
  perform set_config('request.jwt.claims', json_build_object('email', v_coord, 'role', 'authenticated')::text, true);
  r := public.s_post_decidi(pas, 'visto', 'Va bene');
  pas2 := (r ->> 'al_direttore')::bigint;
  assert pas2 is not null, 'col visto nasce il passaggio al Direttore';
  assert (select stato from public.s_post where id = pid) = 'al_direttore', 'il visto non basta: il post è dal Direttore';
  assert (select testi -> 'visto_coordinatore' ->> 'nota' from public.s_post_passaggi where id = pas2) = 'Va bene', 'il Direttore vede il visto e la nota';
  assert (select richiesto_da from public.s_post_passaggi where id = pas2) = v_segr, 'il passaggio al Direttore resta della segreteria che l''ha mandato';
  assert exists (select 1 from public.push_coda where email = v_dir and tag = 'post-' || pid), 'al Direttore arriva la notifica';

  /* chi legge che cosa (RLS) */
  set local role authenticated;
  select count(*) into n from public.s_post_passaggi where post_id = pid and verso = 'direttore';
  assert n = 0, 'il Coordinatore non legge i passaggi del Direttore';
  select count(*) into n from public.s_post_passaggi where post_id = pid and verso = 'coordinatore';
  assert n = 2, 'il Coordinatore legge i suoi, trovati ' || n;
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  select count(*) into n from public.s_post_passaggi where post_id = pid;
  assert n = 1, 'il Direttore legge solo i suoi, trovati ' || n;
  select count(*) into n from public.s_post where id = pid;
  assert n = 0, 'il Direttore non legge s_post: legge la fotografia del passaggio';
  ok := false;
  begin update public.s_post_passaggi set stato = 'approvato' where id = pas2; exception when others then ok := true; end;
  assert ok or (select stato from public.s_post_passaggi where id = pas2) = 'in_attesa', 'nessuno scrive nei passaggi senza le funzioni';
  reset role;

  /* il Direttore: senza indicazioni scritte «approvato con indicazioni» non va */
  ok := false;
  begin perform public.s_post_decidi(pas2, 'approvato_indicazioni', ''); exception when others then ok := sqlerrm like 'Scrivi le indicazioni%'; end;
  assert ok, 'le indicazioni si scrivono';
  r := public.s_post_decidi(pas2, 'approvato_indicazioni', 'Togli la seconda frase');
  assert (select stato from public.s_post where id = pid) = 'approvato', 'approvato con indicazioni = si può pubblicare';
  assert exists (select 1 from public.push_coda where email = v_segr and titolo = 'Post approvato con indicazioni'), 'la segreteria è avvisata';

  /* dopo l'approvazione la segreteria applica le indicazioni e pubblica */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  update public.s_post set testo_telegram = 'testo corretto' where id = pid;
  update public.s_post set stato = 'pubblicato', pubblicato_il = now() where id = pid;

  /* al Direttore direttamente, non approvato: torna in bozza */
  r := public.s_post_manda(pid2, 'direttore');
  pas := (r ->> 'passaggio')::bigint;
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'non_approvato'); exception when others then ok := sqlerrm like 'Scrivi perché non lo approvi%'; end;
  assert ok, 'chi non approva dice perché';
  perform public.s_post_decidi(pas, 'non_approvato', 'Non è il momento');
  assert (select stato from public.s_post where id = pid2) = 'bozza', 'non approvato: torna in bozza';

  /* il ritiro */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  r := public.s_post_manda(pid2, 'direttore');
  pas := (r ->> 'passaggio')::bigint;
  perform public.s_post_ritira(pid2);
  assert (select stato from public.s_post where id = pid2) = 'bozza', 'ritirato: torna in bozza';
  assert (select stato from public.s_post_passaggi where id = pas) = 'ritirato', 'il passaggio resta scritto come ritirato';
  ok := false;
  begin perform public.s_post_ritira(pid2); exception when others then ok := sqlerrm like '%non sta aspettando nessuno%'; end;
  assert ok, 'non si ritira un post che non aspetta';
end $$;

rollback;
