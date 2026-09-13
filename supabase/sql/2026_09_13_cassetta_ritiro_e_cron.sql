-- =============================================================================
--  GESTIONALE: IL RITIRO DALLA CASSETTA DEL PORTALE e i job pg_cron (13/09/2026)
-- -----------------------------------------------------------------------------
--  La cassetta delle lettere del portale sta sul progetto Supabase Servizi
--  (SQL in supabase/progetto-servizi/sql/2026_09_13_cassetta_portale.sql). Qui
--  la parte del Gestionale: la configurazione che serve a portale-richieste per
--  ritirare, e il giro automatico ogni 3 minuti.
--  ⚠️ I segreti NON stanno in questo file: s_config.cassetta_token deve essere
--  identico a cassetta_impostazioni.cassetta_token del progetto Servizi, e si
--  copia a mano da un database all'altro (mai nel repository).
--  Applicato su Supabase a mano (execute_sql) il 13/09/2026: questo file e' la
--  sua copia, da rieseguire solo sapendo quel che fa.
-- =============================================================================

insert into public.s_config (chiave, valore, descrizione, updated_by) values
  ('cassetta_consegna_url', 'https://qcvwrgjldbdoxcfdsvkq.supabase.co/functions/v1/cassetta-consegna',
   'Sportello della cassetta del portale (progetto Servizi) da cui portale-richieste ritira le richieste.', 'migrazione 2026_09_13'),
  ('cassetta_ricevi_url', 'https://qcvwrgjldbdoxcfdsvkq.supabase.co/functions/v1/portale-ricevi',
   'Porta pubblica della cassetta del portale (progetto Servizi): il battito ne controlla la raggiungibilita''.', 'migrazione 2026_09_13'),
  ('portale_diretto_pubblico', 'si',
   'si = portale-richieste accetta ancora i moduli direttamente dal portale (pagine in cache); no = solo dalla cassetta.', 'migrazione 2026_09_13')
on conflict (chiave) do nothing;
-- ('cassetta_token', '<la stessa parola di cassetta_impostazioni sul progetto Servizi>')  -- a mano

-- ⚠️ I job pg_cron che chiamano una funzione aspettano 20 secondi: nei primi
-- secondi del minuto in cui parte un job, PostgREST risponde 504 alle funzioni
-- (13/09/2026, dai log: giro della cassetta, battito delle 05:20, import delle
-- 04:30 falliti sempre alla prima lettura di s_config; le chiamate a meta'
-- minuto mai). E un fallimento si alza con RAISE EXCEPTION: con RAISE WARNING
-- cron.job_run_details lo segna «succeeded», ed e' cosi' che il battito della
-- strada diretta e' risultato riuscito senza aver mai funzionato.
select cron.schedule('ritiro-cassetta', '*/3 * * * *', $cron$
do $body$
declare
  r record;
  tok text;
begin
  select valore into tok from public.s_config where chiave = 'cassetta_token';
  if coalesce(tok, '') = '' then
    raise exception 'ritiro-cassetta: manca s_config.cassetta_token';
  end if;
  commit;
  perform pg_sleep(20);
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '150000');
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/portale-richieste',
    array[http_header('X-Cassetta-Token', tok)],
    'application/json',
    '{"giro":true}'
  )::http_request);
  if r.status <> 200 then
    raise exception 'ritiro-cassetta: HTTP % %', r.status, left(r.content, 300);
  end if;
end
$body$;
$cron$);

-- Agli altri job (4 import-rlst-mattina, 5 battito-portale, 7 bacheca-giornata,
-- 8 battito-portale-diretto) il 13/09/2026 sono stati aggiunti, senza riscriverne
-- il resto (alcuni contengono la chiave di servizio), «perform pg_sleep(20);»
-- all'inizio e il RAISE EXCEPTION sull'esito, con cron.alter_job + replace().
