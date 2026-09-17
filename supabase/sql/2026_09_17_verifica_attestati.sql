-- =============================================================================
--  GESTIONALE: VERIFICA PUBBLICA DEGLI ATTESTATI (17/09/2026, deciso dall'utente)
-- -----------------------------------------------------------------------------
--  Il QR degli attestati della serie N/aaaa porta a
--  https://formedilpadovacpt.github.io/servizi/verifica/?n=<numero>&c=<codice>.
--  La pagina legge dal progetto Servizi (SQL in
--  supabase/progetto-servizi/sql/2026_09_17_verifica_attestati.sql), dove la
--  funzione attestati-verifica di qui copia i soli dati minimi.
--
--  Su s_corsi_iscritti:
--    verifica_codice        il codice stampato (10 caratteri, alfabeto senza
--                           0/O/1/I). Nasce nell'app quando si genera
--                           l'attestato, perché va dentro il QR.
--    verifica_impronta      impronta dell'ultima copia pubblicata: se i dati
--                           cambiano (revoca, correzione) si ripubblica.
--    verifica_pubblicata_il / verifica_esito   com'è andata l'ultima copia.
--    attestato_revocato_il / attestato_revoca_motivo   la revoca: il motivo
--                           resta qui e NON va sulla pagina pubblica.
--
--  ⚠️ s_config.attestati_token = cassetta_impostazioni.attestati_token del
--  progetto Servizi: si copia a mano da un database all'altro, mai nei file.
-- =============================================================================

alter table public.s_corsi_iscritti
  add column if not exists verifica_codice text,
  add column if not exists verifica_impronta text,
  add column if not exists verifica_pubblicata_il timestamptz,
  add column if not exists verifica_esito text,
  add column if not exists attestato_revocato_il date,
  add column if not exists attestato_revoca_motivo text;

create unique index if not exists ux_corsi_iscritti_verifica_codice
  on public.s_corsi_iscritti (verifica_codice) where verifica_codice is not null;

alter table public.s_corsi_iscritti
  drop constraint if exists ck_corsi_iscritti_revoca_motivo;
alter table public.s_corsi_iscritti
  add constraint ck_corsi_iscritti_revoca_motivo
  check (attestato_revocato_il is null or coalesce(trim(attestato_revoca_motivo), '') <> '');

comment on column public.s_corsi_iscritti.verifica_codice is
  'Codice di verifica stampato sull''attestato (QR e testo). Sul progetto Servizi ne va solo l''impronta sha256.';
comment on column public.s_corsi_iscritti.attestato_revocato_il is
  'Revoca dell''attestato: la pagina pubblica mostra «revocato» e la data; il motivo resta qui.';

insert into public.s_config (chiave, valore, descrizione, updated_by) values
  ('attestati_pubblica_url', 'https://qcvwrgjldbdoxcfdsvkq.supabase.co/functions/v1/attestati-pubblica',
   'Funzione del progetto Servizi in cui attestati-verifica copia i dati minimi degli attestati.', 'migrazione 2026_09_17'),
  ('attestati_verifica_url', 'https://formedilpadovacpt.github.io/servizi/verifica/',
   'Pagina pubblica di verifica degli attestati: è l''indirizzo che finisce nel QR.', 'migrazione 2026_09_17')
on conflict (chiave) do nothing;
-- ('attestati_token', '<la stessa parola di cassetta_impostazioni sul progetto Servizi>')  -- a mano

-- Il giro notturno (04:40 UTC): ripete le copie non riuscite e quelle cambiate
-- senza passare dall'app. Stesse regole dei giri del 13/09/2026: 20 secondi di
-- attesa prima della chiamata, e l'esito si alza con RAISE EXCEPTION perché un
-- fallimento resti scritto in cron.job_run_details.
select cron.schedule('attestati-verifica-giro', '40 4 * * *', $cron$
do $body$
declare
  r record;
  tok text;
begin
  select valore into tok from public.s_config where chiave = 'attestati_token';
  if coalesce(tok, '') = '' then
    raise exception 'attestati-verifica-giro: manca s_config.attestati_token';
  end if;
  commit;
  perform pg_sleep(20);
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/attestati-verifica',
    array[http_header('X-Attestati-Token', tok)],
    'application/json',
    '{}'
  )::http_request);
  if r.status <> 200 then
    raise exception 'attestati-verifica-giro: HTTP % %', r.status, left(r.content, 300);
  end if;
end
$body$;
$cron$);
