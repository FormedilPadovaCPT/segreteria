-- Test degli accessi della Commissione Sicurezza che seguono le Nomine (09/11/2026: 2026_11_09b_commissione_accessi.sql).
--   · la segreteria vede i nominati attivi con l'azione da fare; chi non è segreteria no;
--   · una nomina chiusa → l'accesso va chiuso; chi è ancora nominato non si chiude;
--   · la mansione cambiata → si aggiorna la carica; mai due Presidenti con l'accesso attivo;
--   · chi ha già l'accesso non si riapre; un indirizzo di ruolo passato a un'altra persona → subentro,
--     che riporta nome e persona e riapre il cambio password;
--   · le funzioni con la chiave d'amministrazione non le chiama un utente; ogni passaggio resta negli eventi.
-- Tutto dentro una transazione annullata.
begin;

do $$
declare v_segr text; v_dir text; j jsonb; ok boolean; v_ben text; v_truppa int; v_fin int; v_fab int; v_fab_mail text;
        v_badoer uuid; v_user uuid; n int;
begin
  select lower(email) into v_segr from public.app_ruoli where ruolo in ('segreteria', 'admin') and stato = 'attivo' order by email limit 1;
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);

  j := public.s_commissione_situazione();
  assert jsonb_array_length(j -> 'membri') >= 1, 'la segreteria vede i membri';
  select nomina_id into v_truppa from public.s_commissione_nominati() where carica = 'vicepresidente' limit 1;
  select nomina_id into v_fab from public.s_commissione_nominati() where carica = 'presidente' limit 1;
  select nomina_id, email into v_fin, v_ben from public.s_commissione_nominati() where carica = 'consigliere' order by nominativo limit 1;
  select email into v_fab_mail from public.s_commissione_nominati() where nomina_id = v_fab;
  assert v_truppa is not null and v_fab is not null and v_fin is not null, 'servono Presidente, Vicepresidente e un consigliere nominati';

  /* chi è ancora nominato non si chiude */
  ok := false;
  begin perform public.s_commissione_chiudi(v_ben); exception when others then ok := sqlerrm like '%risulta ancora nominato%'; end;
  assert ok, 'un nominato non si chiude';

  /* la nomina si chiude → l'accesso compare fra quelli da chiudere, e si chiude */
  update public.s_nomine set data_fine = current_date - 1 where access_id = v_fin;
  j := public.s_commissione_situazione();
  assert exists (select 1 from jsonb_array_elements(j -> 'da_chiudere') x where x ->> 'email' = v_ben), 'chi esce dalla Commissione va chiuso';
  perform public.s_commissione_chiudi(v_ben, 'fine mandato');
  assert (select stato from public.app_ruoli where lower(email) = v_ben) = 'revocato', 'accesso chiuso, non cancellato';
  assert exists (select 1 from public.s_commissione_eventi where email = v_ben and evento = 'accesso_chiuso'), 'resta scritto';
  ok := false;
  begin perform public.s_commissione_chiudi(v_ben); exception when others then ok := sqlerrm like '%è già chiuso%'; end;
  assert ok, 'non si chiude due volte';

  /* la mansione cambia: si aggiorna la carica */
  update public.s_nomine set mansione = 'Consigliere' where access_id = v_truppa;
  j := public.s_commissione_situazione();
  assert exists (select 1 from jsonb_array_elements(j -> 'membri') x where (x ->> 'nomina_id')::int = v_truppa and x ->> 'da_fare' = 'carica'), 'la carica è da aggiornare';
  perform public.s_commissione_aggiorna_carica(v_truppa);
  assert (select carica from public.app_ruoli where lower(email) = (select email from public.s_commissione_nominati() where nomina_id = v_truppa)) = 'consigliere', 'carica aggiornata';

  /* mai due Presidenti: un consigliere nominato Presidente aspetta che si chiuda l'accesso dell'altro */
  update public.s_nomine set mansione = 'Presidente' where access_id = v_truppa;
  ok := false;
  begin perform public.s_commissione_aggiorna_carica(v_truppa); exception when others then ok := sqlerrm like 'Prima si chiude l''accesso di %'; end;
  assert ok, 'un solo Presidente con l''accesso';

  /* chi ha già l'accesso non si riapre */
  ok := false;
  begin perform public.s_commissione_accesso_prepara(v_fab, v_segr); exception when others then ok := sqlerrm like '%ha già l''accesso%'; end;
  assert ok, 'il Presidente ha già l''accesso';

  /* passaggio di consegne: l'indirizzo di ruolo era di un'altra persona */
  select persona_id into v_badoer from public.s_nomine where persona_txt ilike 'Badoer%' limit 1;
  assert v_badoer is not null, 'serve una persona uscita dalla Commissione';
  update public.app_ruoli set persona_id = v_badoer, nome = 'Persona precedente' where lower(email) = v_fab_mail;
  j := public.s_commissione_situazione();
  assert exists (select 1 from jsonb_array_elements(j -> 'membri') x where (x ->> 'nomina_id')::int = v_fab and x ->> 'da_fare' = 'subentro'), 'riconosce il passaggio di consegne';
  j := public.s_commissione_accesso_prepara(v_fab, v_segr);
  assert j ->> 'situazione' = 'subentro' and j ->> 'nome_precedente' = 'Persona precedente', 'la funzione lo vede come subentro';
  assert length(j ->> 'cf') = 16, 'porta il codice fiscale per la password provvisoria';
  v_user := (j ->> 'user_id')::uuid;
  perform public.s_commissione_accesso_registra(v_fab, v_user, v_segr, 'subentro');
  assert (select persona_id from public.app_ruoli where lower(email) = v_fab_mail) = (select persona_id from public.s_commissione_nominati() where nomina_id = v_fab), 'l''accesso torna alla persona nominata';
  assert (select cambiata_il from public.app_cambio_password where user_id = v_user) is null, 'al primo accesso deve cambiare la password';
  assert exists (select 1 from public.s_commissione_eventi where email = v_fab_mail and evento = 'subentro' and dettaglio like '%prima: Persona precedente%'), 'il subentro resta scritto con il nome di prima';

  /* le funzioni con la chiave d'amministrazione: un non-segreteria non apre, un utente non le chiama */
  ok := false;
  begin perform public.s_commissione_accesso_prepara(v_fin, v_dir); exception when others then ok := sqlerrm like 'Gli accessi della Commissione li apre la segreteria%'; end;
  assert ok, 'il Direttore non apre accessi';
  set local role authenticated;
  ok := false;
  begin perform public.s_commissione_accesso_prepara(v_fin, v_segr); exception when others then ok := sqlerrm like '%permission denied%'; end;
  assert ok, 'un utente non chiama la funzione d''amministrazione';
  ok := false;
  begin perform public.s_commissione_accesso_registra(v_fin, v_user, v_segr, 'accesso_creato'); exception when others then ok := sqlerrm like '%permission denied%'; end;
  assert ok, 'né quella che registra';
  select count(*) into n from public.s_commissione_eventi;
  assert n > 0, 'la segreteria legge gli eventi';
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_commissione_situazione(); exception when others then ok := sqlerrm like 'La pagina della Commissione è della segreteria%'; end;
  assert ok, 'il quadro è della segreteria';
  select count(*) into n from public.s_commissione_eventi;
  assert n = 0, 'il Direttore non legge gli eventi';
  reset role;
end $$;

rollback;
