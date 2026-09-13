-- =============================================================================
--  PORTALE SERVIZI: difese dalla revisione di sicurezza (13/09/2026)
-- -----------------------------------------------------------------------------
--  1. Tetto delle richieste nuove contato e segnato in un colpo solo dal
--     database, per tutti e per impronta dell'indirizzo IP. Prima la funzione
--     portale-richieste contava e poi inseriva: centinaia di richieste nello
--     stesso istante passavano tutte, e le righe arrivate dallo specchio non
--     venivano contate. Dell'IP si tiene solo un'impronta (SHA-256 troncato).
--  2. Nessun permesso di SCRITTURA per anon sulle tabelle toccate dal portale.
--     Oggi la RLS le protegge gia' (verificato con prove da anonimo il
--     13/09/2026), ma una policy scritta male domani non deve bastare ad
--     aprirle. La lettura resta concessa: con la RLS restituisce zero righe, e
--     toglierla cambierebbe risposte che le app si aspettano.
--  Applicata su Supabase come migrazione portale_sicurezza.
-- =============================================================================

create table if not exists public.s_portale_quota (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  il timestamptz not null default now()
);
comment on table public.s_portale_quota is
  'Tetto delle richieste nuove del portale servizi (portale-richieste): una riga per richiesta ammessa, con l''impronta dell''IP. Le righe si cancellano da sole dopo un giorno.';
create index if not exists s_portale_quota_il on public.s_portale_quota (il);
create index if not exists s_portale_quota_ip_il on public.s_portale_quota (ip_hash, il);
alter table public.s_portale_quota enable row level security;
revoke all on table public.s_portale_quota from public, anon, authenticated;

create or replace function public.s_portale_quota(p_ip text, p_max_ora integer, p_max_ora_ip integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n_tot integer; n_ip integer;
begin
  -- una richiesta alla volta passa di qui: il conteggio e la riga nuova non si separano
  perform pg_advisory_xact_lock(hashtext('s_portale_quota'));
  delete from public.s_portale_quota where il < now() - interval '1 day';
  select count(*), count(*) filter (where ip_hash = coalesce(p_ip, 'sconosciuto'))
    into n_tot, n_ip
    from public.s_portale_quota where il > now() - interval '1 hour';
  if n_tot >= p_max_ora or n_ip >= p_max_ora_ip then
    return false;
  end if;
  insert into public.s_portale_quota (ip_hash) values (coalesce(p_ip, 'sconosciuto'));
  return true;
end $$;
revoke execute on function public.s_portale_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.s_portale_quota(text, integer, integer) to service_role;

revoke insert, update, delete, truncate, references, trigger on table
  public.s_portale_ricezioni, public.s_config,
  public.s_segnalazioni, public.s_notifiche_cantiere, public.s_consulenze, public.s_visite_richieste,
  public.s_conferenze_cantiere, public.s_attestazioni_dm132, public.s_rlst_pratiche, public.s_rls_anagrafe
from anon;
