-- ============================================================
-- DINIEGO DI ACCESSO AL CANTIERE (16/09/2026, chiesto dall'utente)
--
-- Quando al tecnico viene negato l'accesso a un cantiere, lo segnala
-- dal gestionale visite (bottone in dashboard, js diniego-accesso.js);
-- la segnalazione arriva alla segreteria, che la gestisce dall'app
-- segreteria (card nel cruscotto + dettaglio).
--
-- Essenziali, come chiesto: DATA, IMPRESA, CANTIERE e NOTE.
-- Impresa e cantiere si scelgono dall'anagrafica quando ci sono
-- (impresa_id, cantiere_id); se non ci sono si scrivono a mano
-- (impresa_nome, cantiere_desc), che restano comunque obbligatori:
-- sono quello che il tecnico ha visto, e non cambiano se domani
-- l'anagrafica viene corretta (regola d'oro 7).
--
-- La colonna si chiama impresa_id apposta: s_cambia_id_impresa sposta
-- da sola ogni colonna impresa_id di public quando cambia la chiave.
-- ============================================================

create table if not exists public.s_dinieghi_accesso (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  segnalato_da    text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  tecnico_id      text references public.tecnici(tecnico_id),
  tecnico_nome    text,
  data_diniego    date not null,
  impresa_id      text references public.imprese(impresa_id) on update cascade on delete set null,
  impresa_nome    text not null check (length(trim(impresa_nome)) > 0),
  cantiere_id     text references public.cantieri(cantiere_id) on update cascade on delete set null,
  cantiere_desc   text not null check (length(trim(cantiere_desc)) > 0),
  note            text not null check (length(trim(note)) > 0),
  stato           text not null default 'nuovo' check (stato in ('nuovo', 'in_gestione', 'chiuso')),
  gestione_note   text,
  gestito_da      text,
  gestito_il      timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.s_dinieghi_accesso is 'Accessi al cantiere negati al tecnico: segnalati dal gestionale visite, gestiti dalla segreteria (16/09/2026)';
comment on column public.s_dinieghi_accesso.cantiere_desc is 'Il cantiere come l''ha indicato il tecnico (indirizzo, comune, CNCE): resta anche se il cantiere è agganciato';
comment on column public.s_dinieghi_accesso.stato is 'nuovo = appena arrivato; in_gestione = la segreteria se ne sta occupando; chiuso = gestito, con esito in gestione_note';

create index if not exists s_dinieghi_accesso_stato_idx on public.s_dinieghi_accesso (stato, created_at desc);
create index if not exists s_dinieghi_accesso_impresa_idx on public.s_dinieghi_accesso (impresa_id);
create index if not exists s_dinieghi_accesso_cantiere_idx on public.s_dinieghi_accesso (cantiere_id);

alter table public.s_dinieghi_accesso enable row level security;

-- Il tecnico scrive a nome suo: chi segnala e il suo tecnico_id non si
-- scelgono, li mette il database (trigger qui sotto).
drop policy if exists s_dinieghi_accesso_ins on public.s_dinieghi_accesso;
create policy s_dinieghi_accesso_ins on public.s_dinieghi_accesso for insert to authenticated
  with check ((select is_personale()) and not (select is_viewer()));

-- Legge chi l'ha segnalato, la segreteria e il coordinatore.
drop policy if exists s_dinieghi_accesso_sel on public.s_dinieghi_accesso;
create policy s_dinieghi_accesso_sel on public.s_dinieghi_accesso for select to authenticated
  using (segnalato_da = lower(coalesce((select auth.jwt() ->> 'email'), ''))
         or (select is_segreteria()) or (select is_coordinatore()));

-- La gestione è della segreteria.
drop policy if exists s_dinieghi_accesso_upd on public.s_dinieghi_accesso;
create policy s_dinieghi_accesso_upd on public.s_dinieghi_accesso for update to authenticated
  using ((select is_segreteria())) with check ((select is_segreteria()));

-- Nessuna policy di delete: una segnalazione non si cancella, si chiude.

create or replace function public.s_dinieghi_accesso_prepara()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.segnalato_da := coalesce(nullif(v_email, ''), new.segnalato_da);
    new.stato := 'nuovo';
    new.gestione_note := null; new.gestito_da := null; new.gestito_il := null;
    select t.tecnico_id, trim(concat_ws(' ', t.tecnico_cognome, t.titolo, t.tecnico_nome))
      into new.tecnico_id, new.tecnico_nome
      from public.tecnici t where lower(t.email) = v_email
      order by t.attivo desc nulls last limit 1;
    if new.data_diniego > current_date then
      raise exception 'La data del diniego non può essere nel futuro';
    end if;
  else
    -- quello che ha scritto il tecnico non si riscrive: si gestisce accanto
    new.segnalato_da := old.segnalato_da; new.tecnico_id := old.tecnico_id; new.tecnico_nome := old.tecnico_nome;
    new.created_at := old.created_at; new.data_diniego := old.data_diniego;
    new.impresa_nome := old.impresa_nome; new.cantiere_desc := old.cantiere_desc; new.note := old.note;
    if new.stato is distinct from old.stato or new.gestione_note is distinct from old.gestione_note then
      new.gestito_da := nullif(v_email, ''); new.gestito_il := now();
    end if;
  end if;
  new.impresa_nome := trim(new.impresa_nome);
  new.cantiere_desc := trim(new.cantiere_desc);
  new.note := trim(new.note);
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.s_dinieghi_accesso_prepara() from public, anon;
grant execute on function public.s_dinieghi_accesso_prepara() to service_role;

drop trigger if exists trg_s_dinieghi_accesso_prepara on public.s_dinieghi_accesso;
create trigger trg_s_dinieghi_accesso_prepara before insert or update on public.s_dinieghi_accesso
  for each row execute function public.s_dinieghi_accesso_prepara();

revoke all on public.s_dinieghi_accesso from anon;
grant select, insert, update on public.s_dinieghi_accesso to authenticated;
