-- Test: i compensi delle asseverazioni solo a fine processo (segreteria, 07/10/2026:
-- 2026_10_07_asseverazioni_a_fine_processo.sql). Con l'accesso della segreteria, in una transazione annullata:
--   · le pratiche ancora al «piano» (P 2026/02, /03, /04) non si propongono, né nel loro mese né fra le mai registrate;
--   · arrivata in commissione (delibera), la pratica si propone nel mese della delibera.
begin;
select set_config('request.jwt.claims', json_build_object('email','cptpd@did.formedilpadova.it','role','authenticated',
  'sub',(select id::text from auth.users where email='cptpd@did.formedilpadova.it'))::text, true);

do $$
declare dm text; ba text; r jsonb; pid uuid;
begin
  select tecnico_id into dm from public.tecnici where tecnico_cognome ilike 'De Marco%' and attivo limit 1;
  select tecnico_id into ba from public.tecnici where tecnico_cognome ilike 'Balladore%' limit 1;
  select id into pid from public.a_pratica where numero_protocollo = 'P 2026/03';
  assert dm is not null and pid is not null, 'servono De Marco e la pratica P 2026/03';
  assert (select stato::text from public.a_pratica where id = pid) = 'piano', 'il test parte con la pratica al piano';

  r := public.s_prestazioni_calcola(dm, 2026, 9) || public.s_prestazioni_mai_registrate(dm, 2026, 10)
       || public.s_prestazioni_mai_registrate(coalesce(ba, dm), 2026, 10);
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'asseverazione'
                       and e->>'numero_protocollo' in ('P 2026/02', 'P 2026/03', 'P 2026/04')), 'al piano non si pagano';

  update public.a_pratica set data_delibera = current_date where id = pid;
  r := public.s_prestazioni_calcola(dm, extract(year from current_date)::int, extract(month from current_date)::int);
  assert exists (select 1 from jsonb_array_elements(r) e where e->>'sorgente' = 'asseverazione' and e->>'numero_protocollo' = 'P 2026/03'
                   and (e->>'data')::date = current_date), 'con la delibera si propone, nel mese della delibera';
  r := public.s_prestazioni_calcola(dm, 2026, 9);
  assert not exists (select 1 from jsonb_array_elements(r) e where e->>'numero_protocollo' = 'P 2026/03'), 'non più nel mese dell''incarico';

  raise notice 'OK 29_asseverazioni_a_fine_processo';
end $$;

rollback;
