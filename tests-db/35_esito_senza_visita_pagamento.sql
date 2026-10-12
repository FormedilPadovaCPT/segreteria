-- Test della decisione della segreteria sull'uscita senza verbale (12/10/2026: gestionale
-- 2026_10_12_esito_senza_visita_pagamento.sql e segreteria 2026_10_12_prestazioni_senza_visita_decisione.sql).
-- In una transazione annullata, su un incarico aperto di visita singola, assegnato a un tecnico con accesso:
--   · finché la segreteria non decide, la chiusura del mese la propone con l'avviso «non ha ancora deciso»;
--   · «non si paga» vuole il motivo, chiude l'incarico e la toglie dalla chiusura del mese;
--   · il tecnico non decide e non cambia la decisione a mano; riaprire l'incarico la toglie;
--   · se l'uscita è già registrata per il pagamento, «non si paga» si ferma; «si paga» chiude.
begin;

create or replace function pg_temp.come(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated',
    'sub', (select id::text from auth.users where lower(email) = lower(p_email)))::text, true);
$$;

do $$
declare inc public.incarichi; nid bigint; tec text; tid text; r jsonb; ok boolean; tariffa numeric;
        anno int := extract(year from current_date)::int; mese int := extract(month from current_date)::int;
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
  tariffa := public.s_tariffa('visita_prima', current_date, tid);

  perform pg_temp.come(tec);
  r := public.incarico_esito_senza_visita(nid, 'cantiere_finito', current_date, 'lavori ultimati, area sgomberata');

  -- il tecnico non decide
  ok := false; begin perform public.incarico_esito_chiudi(nid, true, null); exception when others then ok := sqlerrm like '%lo decide la segreteria%'; end;
  assert ok, 'il tecnico non decide se la sua uscita si paga';

  perform pg_temp.come('cptpd@did.formedilpadova.it');
  r := public.s_prestazioni_calcola(tid, anno, mese);
  assert exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'senza_visita' and (e->>'incarico_id')::bigint = nid
                   and e->>'avviso' like 'la segreteria non ha ancora deciso%' and (e->>'importo')::numeric = tariffa),
    'non ancora deciso: la riga resta, con l''avviso';

  ok := false; begin perform public.incarico_esito_chiudi(nid, false, '   '); exception when others then ok := sqlerrm like 'Scrivi perché l''uscita non si paga%'; end;
  assert ok, '«non si paga» vuole il motivo';

  perform public.incarico_esito_chiudi(nid, false, 'incarico di tre mesi fa, due visite già fatte');
  select * into inc from public.incarichi where id = nid;
  assert inc.stato = 'chiuso' and inc.chiuso_il is not null and inc.esito_pagare is false
     and inc.esito_pagare_motivo = 'incarico di tre mesi fa, due visite già fatte' and inc.esito_pagare_il is not null,
    'decisa e chiusa in un colpo';
  r := public.s_prestazioni_calcola(tid, anno, mese);
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'senza_visita' and (e->>'incarico_id')::bigint = nid),
    '«non si paga»: fuori dalla chiusura del mese';
  r := public.s_prestazioni_calcola_interna(tid, anno, mese);
  assert not exists (select 1 from jsonb_array_elements(r) e where (e->>'incarico_id')::bigint = nid),
    'e non rientra da un''altra parte del calcolo';

  -- il tecnico non cambia la decisione a mano: la guardia la rimette
  perform pg_temp.come(tec);
  update public.incarichi set esito_pagare = true, esito_pagare_motivo = null where id = nid;
  assert (select esito_pagare from public.incarichi where id = nid) is false, 'la guardia protegge la decisione';

  -- riaprire toglie esito e decisione
  perform pg_temp.come('cptpd@did.formedilpadova.it');
  perform public.incarichi_set_stato(nid, 'aperto');
  select * into inc from public.incarichi where id = nid;
  assert inc.esito_senza_visita is null and inc.esito_pagare is null and inc.esito_pagare_motivo is null, 'riaperto: niente esito, niente decisione';

  -- già registrata per il pagamento: «non si paga» si ferma, «si paga» chiude
  perform pg_temp.come(tec);
  r := public.incarico_esito_senza_visita(nid, 'cantiere_non_trovato', current_date, 'all''indirizzo non c''è nessun cantiere');
  insert into public.s_prestazioni (tecnico_id, data, anno, mese, tipo, quantita, importo, incarico_id, origine)
  values (tid, current_date, anno, mese, 'visita_prima', 1, tariffa, nid, 'prova test 35');
  perform pg_temp.come('cptpd@did.formedilpadova.it');
  ok := false; begin perform public.incarico_esito_chiudi(nid, false, 'non dovuta'); exception when others then ok := sqlerrm like '%già registrata nella chiusura del mese%'; end;
  assert ok, 'registrata per il pagamento: si chiude quella riga, non si toglie da qui';
  perform public.incarico_esito_chiudi(nid, true, null);
  select * into inc from public.incarichi where id = nid;
  assert inc.stato = 'chiuso' and inc.esito_pagare is true and inc.esito_pagare_motivo is null, '«si paga» chiude';

  raise notice 'OK 35_esito_senza_visita_pagamento';
end $$;

rollback;
