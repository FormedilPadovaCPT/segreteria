-- Test dell'esito senza visita «cantiere finito / non trovato» (07/10/2026: gestionale
-- 2026_10_07_incarichi_esito_senza_visita.sql e segreteria 2026_10_07_prestazioni_senza_visita.sql).
-- In una transazione annullata, su un incarico aperto di visita singola, assegnato a un tecnico con accesso:
--   · senza nota o con una data futura non si registra; un altro tecnico non può;
--   · registrato: l'incarico passa a «eseguito» con l'esito, la pratica collegata riceve la nota;
--   · il calcolo del mese lo paga come una visita;
--   · il tecnico lo ritira finché non è registrato per il pagamento; dopo, né lui né la riapertura lo tolgono.
begin;

create or replace function pg_temp.come(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated',
    'sub', (select id::text from auth.users where lower(email) = lower(p_email)))::text, true);
$$;

do $$
declare inc public.incarichi; nid bigint; tec text; tid text; altro text; r jsonb; ok boolean; msg text; tariffa numeric;
begin
  select i.id into nid from public.incarichi i
   where i.stato = 'aperto' and coalesce(i.visite_previste, 1) <= 1 and i.esito_senza_visita is null
     and exists (select 1 from auth.users u where lower(u.email) = lower(i.tecnico_email))
     and exists (select 1 from public.tecnici t where lower(t.email) = lower(i.tecnico_email))
   order by i.id desc limit 1;
  assert nid is not null, 'serve un incarico aperto di visita singola assegnato a un tecnico con accesso';
  select * into inc from public.incarichi where id = nid;
  tec := lower(inc.tecnico_email);
  select tecnico_id into tid from public.tecnici where lower(email) = tec;
  select lower(email) into altro from public.tecnici where attivo and email is not null and lower(email) <> tec and email ilike '%@did.%' limit 1;

  perform pg_temp.come(tec);
  ok := false; begin perform public.incarico_esito_senza_visita(nid, 'cantiere_finito', current_date, 'finito'); exception when others then ok := sqlerrm like 'Scrivi che cosa hai trovato%'; end;
  assert ok, 'serve la nota';
  ok := false; begin perform public.incarico_esito_senza_visita(nid, 'cantiere_finito', current_date + 1, 'lavori ultimati, area sgomberata'); exception when others then ok := sqlerrm like 'Serve la data%'; end;
  assert ok, 'niente date future';

  perform pg_temp.come(altro);
  ok := false; begin perform public.incarico_esito_senza_visita(nid, 'cantiere_finito', current_date, 'lavori ultimati, area sgomberata'); exception when others then ok := sqlerrm like 'L''esito lo scrive il tecnico%'; end;
  assert ok, 'un altro tecnico non può';

  perform pg_temp.come(tec);
  r := public.incarico_esito_senza_visita(nid, 'cantiere_finito', current_date, 'lavori ultimati, area sgomberata, nessuno sul posto');
  select * into inc from public.incarichi where id = nid;
  assert inc.stato = 'eseguito' and inc.esito_senza_visita = 'cantiere_finito' and inc.esito_data = current_date and inc.visita_id is null, 'eseguito senza verbale';
  assert not exists (select 1 from public.s_segnalazioni where incarico_id = nid and coalesce(note_ufficio, '') not like '%esito del tecnico senza visita%')
     and not exists (select 1 from public.s_visite_richieste where incarico_id = nid and coalesce(note_ufficio, '') not like '%esito del tecnico senza visita%'),
    'la pratica collegata riceve l''esito';

  -- a mano, da tecnico, l'esito non si cambia: la guardia lo rimette
  update public.incarichi set esito_nota = 'cambiata' where id = nid;
  assert (select esito_nota from public.incarichi where id = nid) like 'lavori ultimati%', 'la guardia protegge l''esito';

  perform pg_temp.come('cptpd@did.formedilpadova.it');
  r := public.s_prestazioni_calcola(tid, extract(year from current_date)::int, extract(month from current_date)::int);
  tariffa := public.s_tariffa('visita_prima', current_date, tid);
  assert exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'senza_visita' and (e->>'incarico_id')::bigint = nid
                   and e->>'tipo' = 'visita_prima' and (e->>'importo')::numeric = tariffa), 'si paga come una visita';

  perform pg_temp.come(tec);
  r := public.incarico_esito_annulla(nid);
  select * into inc from public.incarichi where id = nid;
  assert inc.stato = 'aperto' and inc.esito_senza_visita is null and inc.eseguito_il is null, 'il tecnico lo ritira';

  r := public.incarico_esito_senza_visita(nid, 'cantiere_non_trovato', current_date, 'all''indirizzo non c''è nessun cantiere');
  insert into public.s_prestazioni (tecnico_id, data, anno, mese, tipo, quantita, importo, incarico_id, origine)
  values (tid, current_date, extract(year from current_date)::int, extract(month from current_date)::int, 'visita_prima', 1, tariffa, nid, 'prova test 30');
  ok := false; begin perform public.incarico_esito_annulla(nid); exception when others then ok := sqlerrm like '%già stata registrata per il pagamento%'; end;
  assert ok, 'registrata per il pagamento: il tecnico non la ritira';
  perform pg_temp.come('cptpd@did.formedilpadova.it');
  ok := false; begin perform public.incarichi_set_stato(nid, 'aperto'); exception when others then ok := sqlerrm like '%pagare due volte%'; end;
  assert ok, 'e la riapertura si ferma';

  raise notice 'OK 30_incarichi_esito_senza_visita';
end $$;

rollback;
