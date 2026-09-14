-- ============================================================================
-- 14/09/2026 — Le chiamate dal database alle edge function non si fidano più
-- della sola chiave anon.
--
-- La chiave anon sta in chiaro nei repository pubblici: una funzione che la
-- accetta come unica credenziale è aperta a chiunque. Due chiamanti del
-- database la usavano come Bearer:
--   - job pg_cron 7 «bacheca-giornata» → edge function bacheca-giornata
--   - public.geocode_tick()            → edge function geocode-cantieri
-- Ora ciascuno manda anche una parola d'ordine presa da s_config, e la
-- funzione rifiuta (401) chi non la porta. La chiave anon resta nell'header
-- Authorization solo perché le due funzioni hanno verify_jwt = true.
--
-- Applicato a mano con execute_sql il 14/09/2026. I valori delle parole
-- d'ordine NON stanno qui: si generano nel database e non escono.
-- ============================================================================

-- 1. le parole d'ordine
insert into public.s_config (chiave, valore, descrizione)
values
  ('bacheca_cron_token', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
   'Parola d''ordine con cui il job pg_cron «bacheca-giornata» chiama la funzione (header X-Bacheca-Token). Senza, la funzione risponde solo alla segreteria autenticata (14/09/2026).'),
  ('geocode_token', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
   'Parola d''ordine con cui public.geocode_tick() chiama la edge function geocode-cantieri (header X-Geocode-Token). Senza, la funzione risponde 401 (14/09/2026).')
on conflict (chiave) do nothing;

-- 2. job 7: si aggiunge l'header senza riscrivere il resto del comando
--    (pg_sleep(20) e RAISE EXCEPTION del 13/09 restano come sono)
select cron.alter_job(
  job_id := 7,
  command := replace(
    (select command from cron.job where jobid = 7),
    'array[http_header(''Authorization''',
    'array[http_header(''X-Bacheca-Token'', (select valore from public.s_config where chiave = ''bacheca_cron_token'')), http_header(''Authorization'''
  )
)
where (select command from cron.job where jobid = 7) not ilike '%X-Bacheca-Token%';

-- 3. geocode_tick(): stessa aggiunta, ricreando la funzione dalla sua definizione
do $$
declare d text;
begin
  d := pg_get_functiondef('public.geocode_tick()'::regprocedure);
  if position('X-Geocode-Token' in d) = 0 then
    d := replace(d, 'array[http_header(''Authorization''',
      'array[http_header(''X-Geocode-Token'', (select valore from public.s_config where chiave = ''geocode_token'')), http_header(''Authorization''');
    if position('X-Geocode-Token' in d) = 0 then
      raise exception 'geocode_tick: punto di sostituzione non trovato';
    end if;
    execute d;
  end if;
end $$;
