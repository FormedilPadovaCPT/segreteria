-- Test: i compensi delle asseverazioni solo a fine processo (segreteria, 07/10/2026:
-- 2026_10_07_asseverazioni_a_fine_processo.sql). Con l'accesso della segreteria, in una transazione annullata:
--   · le pratiche aperte che non sono ancora arrivate in commissione (piano, verifica in corso, RDV redatto…)
--     non si propongono, né nel loro mese né fra le mai registrate;
--   · arrivata in commissione (delibera), la pratica si propone nel mese della delibera, e non più nel suo.
-- (12/11/2026) La pratica la sceglie il test fra quelle aperte: prima era fissata su P 2026/03 «al piano», e il
-- test è andato rosso quando la pratica è avanzata (RDV redatto il 10/11) senza che il codice fosse cambiato.
begin;
select set_config('request.jwt.claims', json_build_object('email','cptpd@did.formedilpadova.it','role','authenticated',
  'sub',(select id::text from auth.users where email='cptpd@did.formedilpadova.it'))::text, true);

do $$
declare pid uuid; num text; tec text; rif date; aperte text[]; r jsonb;
begin
  -- pratiche aperte e non ancora in commissione: nessuna deve risultare da pagare
  select array_agg(a.numero_protocollo) into aperte
    from public.a_pratica a
   where a.data_delibera is null and a.data_parere is null
     and a.stato::text not in ('parere_emesso', 'delibera_cptc', 'asseverata', 'diniego', 'archiviata', 'annullata');

  -- una di queste con un verificatore nel gruppo di verifica: la più recente
  select a.id, a.numero_protocollo, g.tecnico_id,
         coalesce(a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico)::date
    into pid, num, tec, rif
    from public.a_pratica a
    join public.a_pratica_gdv g on g.pratica_id = a.id and g.ruolo = 'verificatore'
   where a.numero_protocollo = any(aperte)
   order by coalesce(a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico) desc nulls last
   limit 1;

  if pid is null then
    raise notice 'SALTATO 29_asseverazioni_a_fine_processo: nessuna pratica aperta con un verificatore — niente da provare';
    return;
  end if;

  -- prima della commissione: né nel mese di riferimento, né in quello corrente, né fra le mai registrate
  r := public.s_prestazioni_calcola(tec, extract(year from coalesce(rif, current_date))::int, extract(month from coalesce(rif, current_date))::int)
       || public.s_prestazioni_calcola(tec, extract(year from current_date)::int, extract(month from current_date)::int)
       || public.s_prestazioni_mai_registrate(tec, extract(year from current_date)::int, extract(month from current_date)::int);
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'asseverazione'
                       and e->>'numero_protocollo' = any(aperte)),
         'pratiche non ancora in commissione proposte per il pagamento (' || array_to_string(aperte, ', ') || ')';

  -- in commissione: si propone nel mese della delibera
  update public.a_pratica set data_delibera = current_date where id = pid;
  r := public.s_prestazioni_calcola(tec, extract(year from current_date)::int, extract(month from current_date)::int);
  assert exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'asseverazione' and e->>'numero_protocollo' = num
                   and (e->>'data')::date = current_date), 'con la delibera ' || num || ' si propone, nel mese della delibera';
  if rif is not null and date_trunc('month', rif) <> date_trunc('month', current_date) then
    r := public.s_prestazioni_calcola(tec, extract(year from rif)::int, extract(month from rif)::int);
    assert not exists (select 1 from jsonb_array_elements(r) e where e->>'numero_protocollo' = num),
           num || ' proposta ancora nel mese di riferimento, non in quello della delibera';
  end if;

  raise notice 'OK 29_asseverazioni_a_fine_processo (provata su %, aperte: %)', num, array_to_string(aperte, ', ');
end $$;

rollback;
