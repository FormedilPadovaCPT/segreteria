-- ============================================================================
-- 2026-09-08 — «Posta e agenda» nel cruscotto della segreteria
--
-- Chiesto dall'utente: vedere nel cruscotto se ci sono mail importanti e che
-- eventi ci sono in settimana, con un controllo automatico alle 8 dal lunedì
-- al giovedì. La lettura la fa la edge function `bacheca-giornata` col
-- service account dell'ente (delega domain-wide: gmail.readonly aggiunto
-- dall'utente l'08/09/2026, calendar.readonly dal 07/09); qui stanno le due
-- tabelle che il cruscotto legge, la configurazione e il cron.
--
-- Nelle tabelle finiscono SOLO intestazioni (mittente, oggetto, data) e
-- l'anteprima che Gmail stesso mostra in elenco: mai il corpo delle mail.
-- Le righe di posta vivono 10 giorni, gli eventi finché non sono passati.
-- Le legge solo la segreteria; le scrive solo la funzione (service_role).
-- ============================================================================

create table if not exists public.s_bacheca_mail (
  id             bigserial primary key,
  casella        text not null,
  gmail_id       text not null,
  thread_id      text,
  mittente       text,
  mittente_email text,
  oggetto        text,
  data           timestamptz,
  letta          boolean,
  ha_allegati    boolean,
  anteprima      text,
  punteggio      integer not null default 0,
  motivi         text[] not null default '{}',
  importante     boolean not null default false,
  visto_il       timestamptz,
  unique (casella, gmail_id)
);
comment on table public.s_bacheca_mail is
  'Mail delle caselle dell''ufficio lette ogni mattina da bacheca-giornata: intestazioni, anteprima di Gmail e punteggio di importanza. Mai il corpo. Righe cancellate dopo 10 giorni.';
create index if not exists ix_s_bacheca_mail_data on public.s_bacheca_mail (data desc);

create table if not exists public.s_bacheca_eventi (
  id             bigserial primary key,
  calendario_id  text not null,
  calendario     text,
  casella        text,
  evento_id      text not null,
  titolo         text,
  inizio         timestamptz,
  fine           timestamptz,
  tutto_il_giorno boolean not null default false,
  luogo          text,
  link           text,
  visto_il       timestamptz,
  unique (calendario_id, evento_id)
);
comment on table public.s_bacheca_eventi is
  'Eventi dei prossimi giorni dei calendari dell''ufficio, letti ogni mattina da bacheca-giornata per il cruscotto.';
create index if not exists ix_s_bacheca_eventi_inizio on public.s_bacheca_eventi (inizio);

alter table public.s_bacheca_mail enable row level security;
alter table public.s_bacheca_eventi enable row level security;
drop policy if exists s_bacheca_mail_sel on public.s_bacheca_mail;
create policy s_bacheca_mail_sel on public.s_bacheca_mail for select to authenticated using (public.is_segreteria());
drop policy if exists s_bacheca_eventi_sel on public.s_bacheca_eventi;
create policy s_bacheca_eventi_sel on public.s_bacheca_eventi for select to authenticated using (public.is_segreteria());
revoke all on public.s_bacheca_mail, public.s_bacheca_eventi from public, anon;
grant select on public.s_bacheca_mail, public.s_bacheca_eventi to authenticated;
grant usage, select on sequence public.s_bacheca_mail_id_seq, public.s_bacheca_eventi_id_seq to service_role;

-- configurazione: caselle, calendari e regole di importanza (modificabili dalla segreteria, non nel codice)
insert into public.s_config (chiave, valore, descrizione) values
  ('bacheca_caselle', 'cptpd@did.formedilpadova.it,cpt@formedilpadova.it',
   'Caselle lette da bacheca-giornata (separate da virgola). Devono stare nel Workspace: il service account le legge per delega.'),
  ('bacheca_calendari', 'primary,c_ec5b2c076b35c3d0a8f2ca66fb6ba8fc1b502c9fed4dce653807edb93e26adf0@group.calendar.google.com,c_vv6fllsnnvgb9s7tgpttn9bjt8@group.calendar.google.com',
   'Calendari letti da bacheca-giornata: «primary» = il calendario personale di ogni casella, poi gli id dei calendari condivisi.'),
  ('bacheca_regole', '',
   'Regole di importanza in JSON (soglia, mittenti[{match,peso,etichetta}], parole[{match,peso}], ignora[], peso_allegato, peso_non_letta, peso_tecnico). Vuoto = predefinite nel codice della funzione.'),
  ('bacheca_ore_mail', '', 'Ore di posta guardate a ogni giro (vuoto = 30, e 80 il lunedì per coprire il fine settimana).'),
  ('bacheca_giorni_eventi', '', 'Giorni di agenda mostrati (vuoto = 7).')
on conflict (chiave) do nothing;

-- cron: lunedì-giovedì alle 8 (ora italiana estiva = 6 UTC; d'inverno alle 7, come gli altri job della casa)
select cron.unschedule(jobid) from cron.job where jobname = 'bacheca-giornata';
select cron.schedule('bacheca-giornata', '0 6 * * 1-4', $cron$
do $body$
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '240000');
  perform http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/bacheca-giornata',
    array[http_header('Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZGFudHJmdWdubXFzdXVqeGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjEzMTYsImV4cCI6MjA5MzgzNzMxNn0.L6YUgMD9rYPtqZCn5-c6hB-ok5nSCISpSolj_a-pcmM')],
    'application/json','{}')::http_request);
end
$body$;
$cron$);
