-- =============================================================================
--  PROGETTO SUPABASE «SERVIZI» (qcvwrgjldbdoxcfdsvkq) — LA CASSETTA DELLE LETTERE
--  DEL PORTALE (13/09/2026)
-- -----------------------------------------------------------------------------
--  Deciso con l'utente dopo le prove di sicurezza del 13/09: i moduli del portale
--  pubblico non arrivano piu' direttamente al database del Gestionale. Li riceve
--  il progetto Servizi, che li custodisce il tempo necessario; il Gestionale li
--  va a prendere (campanello subito, giro automatico come rete) e fa tutto il
--  resto: pratica, numero, Drive, foglio, mail. Il codice raggiungibile da
--  internet non ha piu' in mano ne' la chiave del Gestionale ne' quella Google.
--
--  Qui non si elabora nulla: si riceve, si conserva, si consegna, si cancella.
--    cassetta               una riga per compilazione (submission_id), il payload
--                           senza allegati; si svuota quando il Gestionale ritira
--    cassetta_impostazioni  parola d'ordine condivisa col Gestionale, sale per
--                           l'impronta dell'IP, indirizzo del Gestionale
--    bucket cassetta-allegati  privato: foto e PDF finche' non vengono ritirati
--  Tutto chiuso ad anon e authenticated: lo tocca solo la service role delle due
--  funzioni del progetto (portale-ricevi, cassetta-consegna).
--  Applicata su Supabase come migrazione cassetta_portale.
-- =============================================================================

create table if not exists public.cassetta (
  id bigint generated always as identity primary key,
  submission_id text not null unique check (submission_id ~ '^[A-Za-z0-9-]{8,64}$'),
  tipo text not null check (tipo in ('seg','not','cons','vis','conf','att','rlst','rls','qst')),
  ricevuto_at timestamptz not null default now(),
  ip_hash text,
  payload jsonb,
  dimensione integer not null default 0,
  allegati jsonb not null default '[]'::jsonb,
  allegati_byte bigint not null default 0,
  allegati_pronti boolean not null default false,
  stato text not null default 'arrivata' check (stato in ('arrivata', 'ritirata', 'scartata')),
  tentativi integer not null default 0,
  ultimo_tentativo_at timestamptz,
  ritirata_at timestamptz,
  progressivo integer,
  esito jsonb,
  nota text
);
create index if not exists cassetta_attesa_idx on public.cassetta (ricevuto_at) where stato = 'arrivata';
create index if not exists cassetta_ip_idx on public.cassetta (ip_hash, ricevuto_at);

comment on table public.cassetta is
  'Cassetta delle lettere del portale servizi (dal 13/09/2026): i moduli arrivano qui e il Gestionale li ritira. Il payload e gli allegati si cancellano al ritiro; la riga resta 30 giorni per riconoscere un reinvio.';
comment on column public.cassetta.ip_hash is
  'Impronta (sha-256 con sale) dell''indirizzo IP, solo per il tetto per mittente. Mai l''indirizzo in chiaro.';
comment on column public.cassetta.payload is
  'I campi del modulo senza allegati, limitati in numero e lunghezza. Si svuota quando il Gestionale ritira o scarta.';

alter table public.cassetta enable row level security;
revoke all on table public.cassetta from anon, authenticated;

create table if not exists public.cassetta_impostazioni (
  chiave text primary key,
  valore text not null,
  descrizione text,
  aggiornato_il timestamptz not null default now()
);
alter table public.cassetta_impostazioni enable row level security;
revoke all on table public.cassetta_impostazioni from anon, authenticated;

-- i due segreti nascono nel database e non passano dal repository
insert into public.cassetta_impostazioni (chiave, valore, descrizione) values
  ('cassetta_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine condivisa col Gestionale (s_config.cassetta_token): campanello, consegna, giro, battito.'),
  ('ip_sale', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Sale per l''impronta dell''IP (cassetta.ip_hash).'),
  ('gestionale_url', 'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/portale-richieste',
   'Funzione del Gestionale che ritira ed elabora le richieste.'),
  ('quota_ora', '60', 'Richieste nuove ammesse in un''ora, per tutti.'),
  ('quota_ora_ip', '15', 'Richieste nuove ammesse in un''ora dalla stessa impronta di IP.')
on conflict (chiave) do nothing;

-- il tetto: contato e segnato in un colpo solo, come s_portale_quota sul Gestionale
-- (un conteggio seguito da un inserimento lascia passare le richieste simultanee)
create table if not exists public.cassetta_quota (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  il timestamptz not null default now()
);
create index if not exists cassetta_quota_il on public.cassetta_quota (il);
create index if not exists cassetta_quota_ip_il on public.cassetta_quota (ip_hash, il);
alter table public.cassetta_quota enable row level security;
revoke all on table public.cassetta_quota from public, anon, authenticated;

create or replace function public.cassetta_quota(p_ip text, p_max_ora integer, p_max_ora_ip integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n_tot integer; n_ip integer;
begin
  perform pg_advisory_xact_lock(hashtext('cassetta_quota'));
  delete from public.cassetta_quota where il < now() - interval '1 day';
  select count(*), count(*) filter (where ip_hash = coalesce(p_ip, 'sconosciuto'))
    into n_tot, n_ip
    from public.cassetta_quota where il > now() - interval '1 hour';
  if n_tot >= p_max_ora or n_ip >= p_max_ora_ip then
    return false;
  end if;
  insert into public.cassetta_quota (ip_hash) values (coalesce(p_ip, 'sconosciuto'));
  return true;
end $$;
revoke execute on function public.cassetta_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.cassetta_quota(text, integer, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cassetta-allegati', 'cassetta-allegati', false, 13 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif', 'image/bmp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- igiene trovata nel controllo del 13/09: il trigger non deve essere chiamabile da anon
revoke execute on function public.update_updated_at() from public, anon;
