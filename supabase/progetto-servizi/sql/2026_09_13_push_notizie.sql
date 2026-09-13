-- =============================================================================
--  PROGETTO SUPABASE «SERVIZI» (qcvwrgjldbdoxcfdsvkq) — AVVISI DELLE NOTIZIE
--  SUL TELEFONO (13/09/2026)
-- -----------------------------------------------------------------------------
--  Chi usa il portale servizi puo' attivare dalla pagina Notizie un avviso che
--  arriva sul telefono (Android; iPhone con l'app aggiunta alla schermata Home)
--  quando si pubblica una notizia. Niente app negli store: Web Push nella PWA.
--
--    push_iscrizioni    un browser iscritto: solo l'indirizzo del servizio di
--                       notifica e le due chiavi pubbliche che il browser da'.
--                       Nessun nome, nessuna e-mail, nessun IP.
--    push_invii         una riga per notizia avvisata: e' anche la PRENOTAZIONE
--                       (notizia_id unico), cosi' due inneschi insieme non mandano
--                       due volte lo stesso avviso; e il registro di com'e' andata
--    push_impostazioni  parola d'ordine del campanello, sale dell'IP, contatto
--                       VAPID, e la coppia di chiavi VAPID (la genera la funzione
--                       al primo uso: non passa ne' da file ne' dalla chat)
--    push_quota         tetto delle iscrizioni, per tutti e per impronta dell'IP
--
--  Inneschi, come per la cassetta: CAMPANELLO subito (trigger su notizie →
--  pg_net → funzione push-notizie) e GIRO di rete ogni 30 minuti (pg_cron), che
--  raccoglie una notizia pubblicata il cui campanello non e' arrivato.
--  Le notizie gia' pubblicate al 13/09/2026 si segnano come avvisate: attivando
--  il servizio non parte nessuna notifica vecchia.
--  Tutto chiuso ad anon e authenticated: lo tocca solo la service role.
--  Applicata su Supabase come migrazione push_notizie.
-- =============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── impostazioni ──
create table if not exists public.push_impostazioni (
  chiave text primary key,
  valore text not null,
  descrizione text,
  aggiornato_il timestamptz not null default now()
);
alter table public.push_impostazioni enable row level security;
revoke all on table public.push_impostazioni from anon, authenticated;

insert into public.push_impostazioni (chiave, valore, descrizione) values
  ('campanello_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine del campanello (trigger su notizie e giro pg_cron) verso push-notizie. Non esce dal database.'),
  ('ip_sale', replace(gen_random_uuid()::text, '-', ''),
   'Sale per l''impronta dell''IP nel tetto delle iscrizioni. Dell''IP non si conserva nulla.'),
  ('funzione_url', 'https://qcvwrgjldbdoxcfdsvkq.supabase.co/functions/v1/push-notizie',
   'Indirizzo della funzione che manda gli avvisi.'),
  ('contatto', 'mailto:cpt@formedilpadova.it',
   'Contatto VAPID comunicato ai servizi di notifica (Google, Apple, Mozilla) insieme a ogni avviso.'),
  ('quota_ora', '300', 'Iscrizioni (nuove o rinnovate) ammesse in un''ora, per tutti.'),
  ('quota_ora_ip', '20', 'Iscrizioni ammesse in un''ora dalla stessa impronta IP.')
on conflict (chiave) do nothing;

comment on table public.push_impostazioni is
  'Avvisi delle notizie (13/09/2026). La riga «vapid» (coppia di chiavi) la crea push-notizie al primo uso: NON si cancella e NON si cambia, altrimenti tutte le iscrizioni dei telefoni smettono di ricevere finche'' ognuno non si iscrive di nuovo.';

-- ── iscrizioni ──
create table if not exists public.push_iscrizioni (
  id bigint generated always as identity primary key,
  endpoint text not null unique check (length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh text not null check (length(p256dh) between 80 and 120),
  auth text not null check (length(auth) between 16 and 40),
  dispositivo text not null default 'altro' check (dispositivo in ('android', 'iphone', 'computer', 'altro')),
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  ultimo_invio_il timestamptz,
  errori_consecutivi integer not null default 0
);
alter table public.push_iscrizioni enable row level security;
revoke all on table public.push_iscrizioni from anon, authenticated;
comment on table public.push_iscrizioni is
  'Browser iscritti agli avvisi delle notizie. Solo dati tecnici del servizio di notifica: nessun nome, e-mail o IP. Si cancellano da sole quando il servizio risponde 404/410 (app disinstallata, permesso tolto) o dopo 10 errori di fila.';

-- ── invii (prenotazione + registro) ──
create table if not exists public.push_invii (
  id bigint generated always as identity primary key,
  notizia_id uuid not null unique,
  avviato_il timestamptz not null default now(),
  concluso_il timestamptz,
  tentativi integer not null default 1,
  destinatari integer,
  consegnati integer,
  rimossi integer,
  falliti integer,
  nota text
);
alter table public.push_invii enable row level security;
revoke all on table public.push_invii from anon, authenticated;
comment on table public.push_invii is
  'Una riga per notizia avvisata. notizia_id unico = prenotazione: un solo invio anche se campanello e giro arrivano insieme. Senza chiave esterna di proposito: il registro resta anche se la notizia si cancella.';

-- ── tetto delle iscrizioni (stessa forma di cassetta_quota, contatore separato) ──
create table if not exists public.push_quota (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  il timestamptz not null default now()
);
create index if not exists push_quota_il on public.push_quota (il);
alter table public.push_quota enable row level security;
revoke all on table public.push_quota from anon, authenticated;

create or replace function public.push_quota(p_ip text, p_max_ora integer, p_max_ora_ip integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n_tot integer; n_ip integer;
begin
  perform pg_advisory_xact_lock(hashtext('push_quota'));
  delete from public.push_quota where il < now() - interval '1 day';
  select count(*), count(*) filter (where ip_hash = coalesce(p_ip, 'sconosciuto'))
    into n_tot, n_ip
    from public.push_quota where il > now() - interval '1 hour';
  if n_tot >= p_max_ora or n_ip >= p_max_ora_ip then
    return false;
  end if;
  insert into public.push_quota (ip_hash) values (coalesce(p_ip, 'sconosciuto'));
  return true;
end $$;

-- ── le notizie da avvisare ──
-- Senza id (giro di rete): le pubblicate negli ultimi 3 giorni non ancora avvisate.
-- Con id (campanello): quella notizia, qualunque sia la data (una bozza vecchia
-- pubblicata oggi e' nuova per chi legge).
create or replace function public.push_notizie_da_inviare(p_id uuid default null)
returns table (id uuid, titolo text, corpo text, priorita text)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.titolo, n.corpo, n.priorita
    from public.notizie n
   where n.pubblicata
     and ((p_id is null and n.data_pubbl >= current_date - 3) or n.id = p_id)
     and not exists (select 1 from public.push_invii i where i.notizia_id = n.id and i.concluso_il is not null)
   order by n.created_at
   limit 5;
$$;

-- Prenota l'invio di una notizia. Restituisce {id, preso_il} a chi l'ha presa,
-- null a chi arriva secondo. Una prenotazione morta (lavorazione interrotta)
-- si riprende dopo 10 minuti.
create or replace function public.push_prenota(p_notizia uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint; v_il timestamptz;
begin
  insert into public.push_invii (notizia_id) values (p_notizia)
    on conflict (notizia_id) do nothing
    returning id, avviato_il into v_id, v_il;
  if v_id is null then
    update public.push_invii
       set avviato_il = clock_timestamp(), tentativi = tentativi + 1
     where notizia_id = p_notizia and concluso_il is null
       and avviato_il < now() - interval '10 minutes'
    returning id, avviato_il into v_id, v_il;
  end if;
  if v_id is null then return null; end if;
  return jsonb_build_object('id', v_id, 'preso_il', v_il);
end $$;

-- Chiude l'invio: solo chi l'ha prenotato (stesso avviato_il) lo puo' chiudere.
create or replace function public.push_concludi(p_id bigint, p_preso_il timestamptz, p_esito jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_invii
     set concluso_il = now(),
         destinatari = (p_esito->>'destinatari')::int,
         consegnati  = (p_esito->>'consegnati')::int,
         rimossi     = (p_esito->>'rimossi')::int,
         falliti     = (p_esito->>'falliti')::int,
         nota        = left(p_esito->>'nota', 1000)
   where id = p_id and avviato_il = p_preso_il and concluso_il is null;
  return found;
end $$;

-- Esiti per iscrizione in una chiamata sola (gli id viaggiano nel corpo, non nell'URL).
create or replace function public.push_registra(p_consegnate bigint[], p_errori bigint[], p_morte bigint[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n_tolte integer; n_troppi integer;
begin
  update public.push_iscrizioni set ultimo_invio_il = now(), errori_consecutivi = 0
   where id = any(coalesce(p_consegnate, '{}'));
  update public.push_iscrizioni set errori_consecutivi = errori_consecutivi + 1
   where id = any(coalesce(p_errori, '{}'));
  delete from public.push_iscrizioni where id = any(coalesce(p_morte, '{}'));
  get diagnostics n_tolte = row_count;
  delete from public.push_iscrizioni where id = any(coalesce(p_errori, '{}')) and errori_consecutivi >= 10;
  get diagnostics n_troppi = row_count;
  return jsonb_build_object('tolte', n_tolte, 'tolte_per_errori', n_troppi);
end $$;

revoke execute on function public.push_quota(text, integer, integer)            from public, anon, authenticated;
revoke execute on function public.push_notizie_da_inviare(uuid)                  from public, anon, authenticated;
revoke execute on function public.push_prenota(uuid)                             from public, anon, authenticated;
revoke execute on function public.push_concludi(bigint, timestamptz, jsonb)      from public, anon, authenticated;
revoke execute on function public.push_registra(bigint[], bigint[], bigint[])    from public, anon, authenticated;
grant execute on function public.push_quota(text, integer, integer)              to service_role;
grant execute on function public.push_notizie_da_inviare(uuid)                   to service_role;
grant execute on function public.push_prenota(uuid)                              to service_role;
grant execute on function public.push_concludi(bigint, timestamptz, jsonb)       to service_role;
grant execute on function public.push_registra(bigint[], bigint[], bigint[])     to service_role;

-- ── le notizie gia' pubblicate non si avvisano ──
insert into public.push_invii (notizia_id, concluso_il, destinatari, consegnati, rimossi, falliti, nota)
select n.id, now(), 0, 0, 0, 0, 'Pubblicata prima dell''attivazione degli avvisi (13/09/2026): nessuna notifica.'
  from public.notizie n
 where n.pubblicata
on conflict (notizia_id) do nothing;

-- ── campanello: una notizia diventa pubblicata ──
-- Non deve MAI impedire di pubblicare: se pg_net non parte si registra un
-- avviso e ci pensa il giro di rete.
create or replace function public.notizie_campanello_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_url text; v_token text;
begin
  if not new.pubblicata then return null; end if;
  if tg_op = 'UPDATE' and old.pubblicata then return null; end if;
  if exists (select 1 from public.push_invii where notizia_id = new.id) then return null; end if;
  select valore into v_url from public.push_impostazioni where chiave = 'funzione_url';
  select valore into v_token from public.push_impostazioni where chiave = 'campanello_token';
  if v_url is null or v_token is null then return null; end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('azione', 'invia', 'notizia_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Campanello', v_token),
      timeout_milliseconds := 10000);
  exception when others then
    raise warning 'push-notizie: campanello non partito per la notizia %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.notizie_campanello_push() from public, anon, authenticated;

drop trigger if exists notizie_campanello_push on public.notizie;
create trigger notizie_campanello_push
  after insert or update of pubblicata on public.notizie
  for each row execute function public.notizie_campanello_push();

-- ── giro di rete ogni 30 minuti (a :07 e :37) ──
-- pg_sleep(20): allo scoccare del minuto le funzioni chiamate dal database possono
-- prendere 504 (lezione del 13/09/2026 sul Gestionale).
select cron.schedule('push-notizie-giro', '7,37 * * * *', $cron$
  select pg_sleep(20);
  select net.http_post(
    url := (select valore from public.push_impostazioni where chiave = 'funzione_url'),
    body := jsonb_build_object('azione', 'invia'),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'X-Campanello', (select valore from public.push_impostazioni where chiave = 'campanello_token')),
    timeout_milliseconds := 10000);
$cron$);
