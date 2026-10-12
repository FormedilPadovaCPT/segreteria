-- ═══════════════════════════════════════════════════════════════════════
--  LE RISPOSTE AI VERBALI VANNO AL TECNICO (12/10/2026)
--
--  Chiesto dall'utente: «a volte capita che l'impresa o altre figure
--  rispondano al verbale, ovviamente torna a me perché son tutti inviati
--  con account cptpd@did: sarebbe possibile un automatismo che nel caso di
--  queste mail di risposta le girasse direttamente al tecnico che ha fatto
--  la visita?». Scelte dell'utente: inoltro completo con gli allegati, ogni
--  ora in orario d'ufficio, coordinatore in copia.
--
--  Ogni ora la edge function `risposte-verbali` legge la casella, riconosce
--  le mail col numero del verbale nell'oggetto, e le gira al tecnico (o ai
--  due tecnici) della visita. Qui il registro: una riga per mail esaminata,
--  girata o no, e perché. È l'eccezione 8 a «l'app prepara, la persona
--  manda» (CLAUDE.md): interna, e l'app non scrive niente al posto di nessuno.
-- ═══════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.s_mail_risposte_verbali (
  id               bigint generated always as identity primary key,
  gmail_id         text not null unique,
  thread_id        text,
  ricevuta_il      timestamptz,
  mittente         text,
  mittente_nome    text,
  oggetto          text,
  nr_verbale       text,
  visita_id        text,
  tecnico_email    text,                  -- uno o due, separati da virgola
  esito            text not null check (esito in ('inoltrata', 'esclusa', 'senza_tecnico', 'errore')),
  motivo           text,
  inoltro_a        text,
  inoltro_il       timestamptz,
  allegati         int,
  allegati_omessi  text,
  tentativi        int not null default 0,
  created_at       timestamptz not null default now()
);
comment on table public.s_mail_risposte_verbali is
  'Le risposte ai verbali arrivate a cptpd@did e girate al tecnico della visita (edge function risposte-verbali, 12/10/2026). Una riga per mail esaminata, anche quelle non girate (scritte da dentro l''ente, risposte automatiche, verbale senza tecnico), col motivo.';
comment on column public.s_mail_risposte_verbali.esito is
  'inoltrata = il tecnico l''ha ricevuta · esclusa = non era da girare (motivo) · senza_tecnico = verbale non agganciato a un tecnico, la guarda la segreteria · errore = invio non riuscito, si ritenta fino a tre volte.';

create index if not exists s_mail_risposte_verbali_ric_idx on public.s_mail_risposte_verbali (ricevuta_il desc);
create index if not exists s_mail_risposte_verbali_nr_idx on public.s_mail_risposte_verbali (nr_verbale);

alter table public.s_mail_risposte_verbali enable row level security;
revoke all on public.s_mail_risposte_verbali from anon;
grant select on public.s_mail_risposte_verbali to authenticated;
grant all on public.s_mail_risposte_verbali to service_role;

/* chi legge: segreteria e coordinatore tutto; il tecnico le risposte ai suoi verbali */
drop policy if exists s_mail_risposte_verbali_sel on public.s_mail_risposte_verbali;
create policy s_mail_risposte_verbali_sel on public.s_mail_risposte_verbali for select to authenticated
  using (
    public.is_segreteria() or public.is_coordinatore()
    or position(lower(coalesce(auth.jwt() ->> 'email', '-')) in lower(coalesce(tecnico_email, ''))) > 0
  );

insert into public.s_config (chiave, valore, descrizione) values
  ('risposte_verbali_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine del giro orario che gira al tecnico le risposte ai suoi verbali (edge function risposte-verbali).'),
  ('risposte_verbali_ultimo_giro', '',
   'Il battito del giro risposte-verbali: quando è passato l''ultima volta e che cosa ha trovato. Vuoto = mai partito.')
on conflict (chiave) do nothing;

commit;

-- ── il giro orario ───────────────────────────────────────────────────────
-- Al minuto 30, dalle 06 alle 17 UTC dal lunedì al venerdì: le 8:30-19:30
-- d'estate, le 7:30-18:30 d'inverno. pg_sleep(20) perché nei primi secondi
-- del minuto PostgREST risponde 504 (13/09/2026); l'esito si controlla con
-- RAISE EXCEPTION. ⚠️ La chiave anon non si scrive qui (il file sta in un
-- repository): si ricopia dal giro `mail-respinte-giro`.
do $$
declare chiave text; comando text;
begin
  select (regexp_match(command, 'Bearer ([A-Za-z0-9_.-]+)'))[1] into chiave
    from cron.job where jobname = 'mail-respinte-giro';
  if coalesce(chiave, '') = '' then
    raise exception 'risposte-verbali-giro: non trovo la chiave nel giro mail-respinte-giro';
  end if;

  comando := replace($job$
do $body$
declare r record; tok text;
begin
  select valore into tok from public.s_config where chiave = 'risposte_verbali_token';
  if coalesce(tok, '') = '' then
    raise exception 'risposte-verbali-giro: manca s_config.risposte_verbali_token';
  end if;
  commit;
  perform pg_sleep(20);
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '240000');
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/risposte-verbali',
    array[http_header('X-Risposte-Verbali', tok),
          http_header('Authorization', 'Bearer __CHIAVE__')],
    'application/json', '{}')::http_request);
  if r.status <> 200 then
    raise exception 'risposte-verbali-giro: HTTP % %', r.status, left(r.content, 300);
  end if;
end
$body$;
$job$, '__CHIAVE__', chiave);

  perform cron.unschedule('risposte-verbali-giro') where exists (select 1 from cron.job where jobname = 'risposte-verbali-giro');
  perform cron.schedule('risposte-verbali-giro', '30 6-17 * * 1-5', comando);
end $$;
