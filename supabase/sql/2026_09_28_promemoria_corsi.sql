-- ═══════════════════════════════════════════════════════════════════════
--  PROMEMORIA DELLE LEZIONI E MATERIALI DEL CORSO (28/09/2026)
--  Chiesto dall'utente: «quando apro un corso questo può essere aperto
--  molto tempo prima della prima data di inizio lezioni, vorrei poter
--  impostare: invia un promemoria della loro iscrizione, x giorni prima,
--  agli iscritti. Il promemoria dovrebbe essere attivo per tutte le
--  lezioni previste. A corso concluso, quando invio l'attestato […] tante
--  volte ci sono i materiali dei corsi che sono da condividere: vorrei
--  poter inserire i link […] con magari scritto di scaricarli il prima
--  possibile perché rimarranno a disposizione per tot tempo.»
--
--  ⚠️ IL PROMEMORIA PARTE DA SOLO, ed è la QUARTA eccezione dichiarata
--  alla regola «l'app prepara, la persona manda» (dopo l'avviso di
--  pagamento, l'avviso al coordinatore e la segnalazione all'ufficio
--  corsi), e la prima che va a persone FUORI dall'ente. L'ha decisa
--  l'utente il 28/09/2026 («automatico»). Regge per lo stesso motivo
--  delle altre: la mail non contiene niente scritto da chi la fa
--  partire — titolo, data, orario, sede e nomi si leggono dal database.
--
--  I MATERIALI invece restano nella regola: finiscono nella bozza degli
--  attestati, che manda una persona. La data «disponibili fino al» è un
--  invito a scaricare: l'app non toglie l'accesso ai file.
--
--  Qui stanno le colonne, il quaderno e il giro quotidiano; il mestiere
--  lo fa la edge function `promemoria-corsi`.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.s_corsi
  add column if not exists promemoria_giorni smallint,
  add column if not exists materiali jsonb not null default '[]'::jsonb,
  add column if not exists materiali_fino_al date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_corsi_promemoria_giorni_chk') then
    alter table public.s_corsi add constraint s_corsi_promemoria_giorni_chk
      check (promemoria_giorni is null or promemoria_giorni between 1 and 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 's_corsi_materiali_chk') then
    alter table public.s_corsi add constraint s_corsi_materiali_chk
      check (jsonb_typeof(materiali) = 'array');
  end if;
end $$;

comment on column public.s_corsi.promemoria_giorni is
  'Quanti giorni prima di OGNI lezione parte da solo il promemoria agli iscritti. Vuoto = nessun promemoria. I corsi nuovi nascono con 2.';
comment on column public.s_corsi.materiali is
  'I materiali da condividere con chi ha partecipato: elenco di {titolo, url}. Finiscono nella mail degli attestati.';
comment on column public.s_corsi.materiali_fino_al is
  'Fino a quando i materiali restano a disposizione: la mail lo dice per invitare a scaricarli. L''app NON toglie l''accesso ai file.';

-- ── il quaderno: una riga per iscritto e per lezione ────────────────────
-- La data della lezione sta nella chiave: se una lezione viene SPOSTATA,
-- chi aveva già ricevuto il promemoria ne riceve uno nuovo con la data
-- giusta. `prenotato_il` si scrive prima di spedire, così due chiamate
-- insieme non mandano due mail.
create table if not exists public.s_corsi_promemoria (
  id             bigint generated always as identity primary key,
  corso_id       bigint not null references public.s_corsi(id) on delete cascade,
  giornata_id    bigint not null references public.s_corsi_giornate(id) on delete cascade,
  iscritto_id    bigint not null references public.s_corsi_iscritti(id) on delete cascade,
  data_lezione   date   not null,
  email          text,
  origine_email  text check (origine_email is null or origine_email in ('iscrizione', 'persona', 'impresa')),
  prenotato_il   timestamptz not null default now(),
  inviato_il     timestamptz,
  esito          text,
  unique (giornata_id, iscritto_id, data_lezione)
);
create index if not exists s_corsi_promemoria_corso_idx on public.s_corsi_promemoria (corso_id);

comment on table public.s_corsi_promemoria is
  'Promemoria delle lezioni: una riga per iscritto e per lezione. La scrive solo la funzione promemoria-corsi.';
comment on column public.s_corsi_promemoria.esito is
  '«inviato», «senza indirizzo», oppure «non inviato: <motivo>». Vuoto = prenotato, in partenza.';
comment on column public.s_corsi_promemoria.origine_email is
  'Da dove viene l''indirizzo: quello dato all''iscrizione, l''anagrafica della persona, o (in mancanza) l''impresa.';

-- ── il battito: una riga per ogni giro, anche quando non c'era niente ───
-- Regola del 04/09/2026: senza, «nessun promemoria partito» resta ambiguo
-- fra «non c'erano lezioni» e «il giro è fermo».
create table if not exists public.s_corsi_promemoria_giri (
  id               bigint generated always as identity primary key,
  eseguito_il      timestamptz not null default now(),
  chi              text,
  lezioni          integer not null default 0,
  inviate          integer not null default 0,
  non_inviate      integer not null default 0,
  senza_indirizzo  integer not null default 0,
  errore           text
);

comment on table public.s_corsi_promemoria_giri is
  'Un rigo per ogni giro dei promemoria, anche a vuoto: dice che il giro è vivo.';

alter table public.s_corsi_promemoria enable row level security;
alter table public.s_corsi_promemoria_giri enable row level security;

drop policy if exists sgr_corsi_prom_sel on public.s_corsi_promemoria;
create policy sgr_corsi_prom_sel on public.s_corsi_promemoria
  for select to authenticated using ((select public.is_segreteria()));
drop policy if exists sgr_corsi_prom_giri_sel on public.s_corsi_promemoria_giri;
create policy sgr_corsi_prom_giri_sel on public.s_corsi_promemoria_giri
  for select to authenticated using ((select public.is_segreteria()));

-- si legge dall'app, si scrive solo dalla funzione (service role)
revoke all on public.s_corsi_promemoria, public.s_corsi_promemoria_giri from public, anon, authenticated;
grant select on public.s_corsi_promemoria, public.s_corsi_promemoria_giri to authenticated;
grant all on public.s_corsi_promemoria, public.s_corsi_promemoria_giri to service_role;

-- ── la parola d'ordine del giro, e il recapito per chi risponde ─────────
insert into public.s_config (chiave, valore, descrizione) values
  ('promemoria_corsi_token', encode(extensions.gen_random_bytes(24), 'hex'),
   'Parola d''ordine del giro quotidiano dei promemoria delle lezioni (funzione promemoria-corsi).'),
  ('promemoria_corsi_giorni', '2',
   'Giorni prima della lezione proposti per il promemoria quando nasce un corso nuovo. Sul singolo corso si cambia dalla scheda.')
on conflict (chiave) do nothing;

-- ── il flusso entra nel riquadro «flussi mai usati» del cruscotto ───────
-- Si parte dal testo che la funzione ha nel database (regola del 19/09).
do $$
declare def text; punto text;
begin
  select pg_get_functiondef('public.s_flussi_uso()'::regprocedure) into def;
  if position('promemoria_lezione' in def) > 0 then return; end if;

  punto := 'union all select ''Formazione'', ''quest_evento''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo il punto di innesto (%). Guardare la funzione prima di insistere.', punto;
  end if;
  def := replace(def, punto,
    'union all select ''Formazione'', ''promemoria_lezione'', ''Promemoria della lezione agli iscritti'', inviato_il::date'
    || E'\n      from public.s_corsi_promemoria where inviato_il is not null' || E'\n    ' || punto);

  punto := '(''Formazione'', ''quest_evento''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo l''elenco dei flussi (%).', punto;
  end if;
  def := replace(def, punto,
    '(''Formazione'', ''promemoria_lezione'', ''Promemoria della lezione agli iscritti''),' || E'\n    ' || punto);

  execute def;
end $$;

revoke execute on function public.s_flussi_uso() from public, anon;
grant execute on function public.s_flussi_uso() to authenticated, service_role;

-- ── il giro quotidiano ───────────────────────────────────────────────────
-- Alle 06:10 UTC (le 8:10 d'estate, le 7:10 d'inverno): la mattina, così il
-- promemoria si legge in giornata. A metà minuto, perché nei primi secondi
-- del minuto PostgREST risponde 504 (13/09/2026). L'esito si controlla con
-- RAISE EXCEPTION: un job che non può fallire non dice niente quando riesce.
-- ⚠️ La chiave anon NON si scrive in questo file, che sta in un repository:
-- si ricopia dal giro `mail-respinte-giro`, che ce l'ha già.
do $$
declare chiave text; comando text;
begin
  select (regexp_match(command, 'Bearer ([A-Za-z0-9_.-]+)'))[1] into chiave
    from cron.job where jobname = 'mail-respinte-giro';
  if coalesce(chiave, '') = '' then
    raise exception 'promemoria-corsi-giro: non trovo la chiave nel giro mail-respinte-giro';
  end if;

  comando := replace($job$
do $body$
declare r record; tok text;
begin
  select valore into tok from public.s_config where chiave = 'promemoria_corsi_token';
  if coalesce(tok, '') = '' then
    raise exception 'promemoria-corsi-giro: manca s_config.promemoria_corsi_token';
  end if;
  commit;
  perform pg_sleep(20);
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '240000');
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/promemoria-corsi',
    array[http_header('X-Promemoria-Corsi', tok),
          http_header('Authorization', 'Bearer __CHIAVE__')],
    'application/json', '{}')::http_request);
  if r.status <> 200 then
    raise exception 'promemoria-corsi-giro: HTTP % %', r.status, left(r.content, 300);
  end if;
end
$body$;
$job$, '__CHIAVE__', chiave);

  perform cron.unschedule('promemoria-corsi-giro') where exists (select 1 from cron.job where jobname = 'promemoria-corsi-giro');
  perform cron.schedule('promemoria-corsi-giro', '10 6 * * *', comando);
end $$;
