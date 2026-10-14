-- ============================================================
-- PASSWORD DIMENTICATA (14/10/2026, chiesto dall'utente: il Presidente non
-- riusciva a entrare nel gestionale per firmare, e nessuno poteva rimettersi
-- una password da solo)
--
-- La funzione `password-dimenticata` (verify_jwt false) riceve un indirizzo:
-- se appartiene a un account con un ruolo attivo (app_ruoli) o a un tecnico attivo, chiede a
-- Supabase un codice di recupero (admin.generateLink: nessuna mail di
-- Supabase, che senza un SMTP proprio consegnerebbe solo al team) e lo manda
-- dalla casella dell'ente, come gli altri avvisi automatici. La risposta è
-- sempre la stessa, che l'indirizzo esista o no.
-- Qui: il registro delle richieste, che serve anche a limitarle (3 per
-- indirizzo e 30 in tutto all'ora), e le due funzioni che la funzione usa.
-- ============================================================
create table if not exists public.auth_recupero_richieste (
  id         bigint generated always as identity primary key,
  email      text not null,
  chiesto_il timestamptz not null default now(),
  esito      text not null,      -- inviato | sconosciuto | troppe | errore: …
  ip         text
);
create index if not exists auth_recupero_richieste_email_idx on public.auth_recupero_richieste (email, chiesto_il desc);
comment on table public.auth_recupero_richieste is
  'Le richieste di «Password dimenticata?» del gestionale (14/10/2026): una riga per richiesta, con l''esito. Serve a limitarle e a sapere se il canale è usato. Nessun codice qui: il codice lo tiene Supabase.';
alter table public.auth_recupero_richieste enable row level security;
revoke all on table public.auth_recupero_richieste from anon, authenticated;
drop policy if exists auth_recupero_segr on public.auth_recupero_richieste;
create policy auth_recupero_segr on public.auth_recupero_richieste for select to authenticated using ((select public.is_segreteria()));
grant select on table public.auth_recupero_richieste to authenticated;

/* posso mandare il codice? un account vero, con un ruolo attivo, e non troppe richieste */
create or replace function public.recupero_password_ammesso(p_email text)
returns text language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v text := lower(btrim(coalesce(p_email, '')));
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'sconosciuto'; end if;
  if (select count(*) from public.auth_recupero_richieste where chiesto_il > now() - interval '1 hour') >= 30 then return 'troppe'; end if;
  if (select count(*) from public.auth_recupero_richieste where email = v and chiesto_il > now() - interval '1 hour') >= 3 then return 'troppe'; end if;
  if not exists (select 1 from auth.users u where lower(u.email) = v and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())) then return 'sconosciuto'; end if;
  /* un ruolo attivo (segreteria, Direzione, Presidenza, consiglieri, amministrazione) o un tecnico attivo:
     i tecnici non stanno in app_ruoli, e un tecnico non più attivo non si rimette in gioco da qui */
  if not exists (select 1 from public.app_ruoli r where lower(r.email) = v and r.stato = 'attivo')
     and not exists (select 1 from public.tecnici t where lower(t.email) = v and t.attivo) then return 'sconosciuto'; end if;
  return 'ok';
end $$;
revoke execute on function public.recupero_password_ammesso(text) from public, anon, authenticated;
grant execute on function public.recupero_password_ammesso(text) to service_role;

create or replace function public.recupero_password_registra(p_email text, p_esito text, p_ip text default null)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.auth_recupero_richieste (email, esito, ip) values (lower(btrim(coalesce(p_email, ''))), left(coalesce(p_esito, ''), 300), left(p_ip, 60));
$$;
revoke execute on function public.recupero_password_registra(text, text, text) from public, anon, authenticated;
grant execute on function public.recupero_password_registra(text, text, text) to service_role;
