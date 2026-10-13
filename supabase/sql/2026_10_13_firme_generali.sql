-- ============================================================
-- REGISTRO FIRME GENERALE, RUOLO DOCENTE, RESPONSABILE DEL PROGETTO
-- FORMATIVO (13/10/2026) — lotto 1 del fascicolo corso digitale
--
-- Progetto: 2_AREE/Formazione/2026_10_13_REL_Area-Sicurezza_fascicolo-corso-
-- digitale_progetto-tecnico.md (approvato dall'utente la sera del 13/10).
--
-- Che cosa cambia e perché:
--   1. `s_firme_presidente` diventa `s_firme`, il registro di TUTTE le firme
--      apposte nell'app: Presidente (come oggi), Direttore, responsabile del
--      progetto formativo (RPF) e docenti dei corsi. Rinominata adesso, con
--      la tabella vuota (0 righe il 13/10) e tre soli consumatori, perché fra
--      sei mesi costerebbe molto di più; resta una VISTA `s_firme_presidente`
--      con lo stesso nome finché le pagine che la leggono (gestionale
--      direzione.js, asseverazione firma-presidente/route.ts) non passano al
--      nome nuovo. La vista è security_invoker: vale la RLS della tabella.
--   2. ogni riga dice CHI deve firmare (`firmatario_email`, `firmatario_ruolo`)
--      e, per i documenti con più firme, in che ORDINE: la catena è lineare
--      (docente poi RPF; esaminatori poi RPF). La riga N nasce `in_coda` e
--      passa `in_attesa` quando la N-1 è firmata, prendendo come originale il
--      PDF firmato della precedente: ogni firmatario vede le firme già messe.
--   3. ruolo `docente` in app_ruoli, per i docenti esterni (i tecnici CPT
--      hanno già l'accesso): FUORI da is_personale(), come «amministrazione»,
--      con la sola lettura della propria riga — altrimenti onLogin non lo
--      riconosce e lo butta fuori.
--   4. `is_rpf()`: l'RPF lo dice s_config.responsabile_formativo_email (chiave
--      nuova, accanto a nome e firma che c'erano già). Balladore resta tecnico,
--      senza riga in app_ruoli: deciso dall'utente il 13/10.
--   5. `tecnici.persona_id` e `app_ruoli.persona_id`: il collegamento fra chi
--      entra nell'app e la persona dell'anagrafica, che è l'identità del
--      docente nei corsi (s_corsi_interventi/incarichi.persona_id). Prima non
--      c'era: solo 3 tecnici su 12 avevano la stessa e-mail in `persone`.
--      Riempito per nome e cognome dove la corrispondenza è UNA sola.
--   6. `is_docente_del_corso(corso_id)`: la persona collegata compare fra i
--      docenti di quel corso (interventi o incarichi).
--
-- Si scrive su s_firme SOLO dalla edge function `firma-documenti` (service
-- role) e dalle RPC s_firma_*: nessuna policy di scrittura.
-- ============================================================

-- ── 1. la tabella cambia nome ────────────────────────────────
alter table public.s_firme_presidente rename to s_firme;
alter sequence public.s_firme_presidente_id_seq rename to s_firme_id_seq;
alter index public.s_firme_presidente_pkey rename to s_firme_pkey;
alter index public.s_firme_presidente_stato rename to s_firme_stato;
drop index if exists public.s_firme_presidente_viva;
alter table public.s_firme drop constraint if exists s_firme_presidente_tipo_check;
alter table public.s_firme drop constraint if exists s_firme_presidente_stato_check;
comment on table public.s_firme is
  'Registro delle firme apposte nell''app (13/10/2026, prima s_firme_presidente): Presidente, Direttore, responsabile del progetto formativo e docenti. Una riga per firmatario; i documenti a più firme sono una catena ordinata. Si scrive solo dalla edge function firma-documenti e dalle RPC s_firma_*.';

-- ── 2. chi firma, in che ordine, su che cosa ────────────────
alter table public.s_firme
  add column if not exists firmatario_email text,
  add column if not exists firmatario_ruolo text,
  add column if not exists corso_id        bigint references public.s_corsi(id) on delete set null,
  add column if not exists ordine          smallint not null default 1,
  add column if not exists file_precedente text;
update public.s_firme
   set firmatario_email = coalesce(firmatario_email, (select lower(trim(valore)) from public.s_config where chiave = 'presidente_email')),
       firmatario_ruolo = coalesce(firmatario_ruolo, 'presidente');
alter table public.s_firme
  alter column firmatario_email set not null,
  alter column firmatario_ruolo set not null;
alter table public.s_firme
  add constraint s_firme_ruolo_check check (firmatario_ruolo in ('presidente', 'direttore', 'rpf', 'docente')),
  add constraint s_firme_tipo_check check (tipo in (
    'incarico_assev', 'incarico_docenza',            -- lettere a firma del Presidente (04/10/2026)
    'accettazione_incarico',                         -- il docente accetta l'incarico (lotto 5)
    'scheda_formativa', 'progetto_formativo',        -- lotti 2 e 3
    'registro_giornata', 'registro_corso',           -- lotto 5 e 6
    'verbale_verifica',                              -- lotto 3
    'documento')),                                   -- un PDF qualunque che la segreteria manda in firma
  add constraint s_firme_stato_check check (stato in ('in_coda', 'in_attesa', 'firmata', 'rimandata', 'ritirata')),
  add constraint s_firme_ordine_check check (ordine >= 1);
comment on column public.s_firme.ordine is 'Posto nella catena delle firme dello stesso documento (tipo, rif): 1 firma per primo. La riga N nasce in_coda e passa in_attesa quando la N-1 è firmata.';
comment on column public.s_firme.file_precedente is 'Per ordine > 1: il PDF firmato della riga precedente, da cui è stato preso file_originale di questa riga.';

-- un documento ha, per ogni firmatario, una sola richiesta viva
create unique index if not exists s_firme_viva
  on public.s_firme (tipo, rif, lower(firmatario_email)) where stato in ('in_coda', 'in_attesa', 'firmata');
create index if not exists s_firme_firmatario on public.s_firme (lower(firmatario_email), stato);
create index if not exists s_firme_corso on public.s_firme (corso_id);
create index if not exists s_firme_protocollo on public.s_firme (protocollo_id);

-- ── 3. il ruolo «docente» e la persona dietro l'accesso ──────
alter table public.app_ruoli
  add column if not exists persona_id uuid references public.persone(persona_id) on delete set null,
  add column if not exists firma_drive_id text;
create index if not exists app_ruoli_persona on public.app_ruoli (persona_id);
comment on column public.app_ruoli.persona_id is 'La persona dell''anagrafica dietro questo accesso (per i docenti esterni: è così che la pagina Formazione sa quali corsi sono suoi).';
comment on column public.app_ruoli.firma_drive_id is 'Firma scansionata su Drive, per chi non è tecnico (docente esterno). Facoltativa: senza, la firma nell''app è il solo testo con data, ora e nome.';
-- i ruoli ammessi, fin qui mai scritti: segreteria, admin, amministrazione, viewer, docente
alter table public.app_ruoli drop constraint if exists app_ruoli_ruolo_check;
alter table public.app_ruoli
  add constraint app_ruoli_ruolo_check check (ruolo in ('segreteria', 'admin', 'amministrazione', 'viewer', 'docente'));

alter table public.tecnici
  add column if not exists persona_id uuid references public.persone(persona_id) on delete set null;
create index if not exists tecnici_persona on public.tecnici (persona_id);
comment on column public.tecnici.persona_id is 'La persona dell''anagrafica che è questo tecnico (13/10/2026): è l''identità del docente nei corsi. Riempita per nome e cognome dove la corrispondenza era una sola.';
update public.tecnici t
   set persona_id = m.persona_id
  from (
    select t2.tecnico_id, min(p.persona_id::text)::uuid as persona_id
      from public.tecnici t2
      join public.persone p
        on lower(trim(p.nome)) = lower(trim(t2.tecnico_nome))
       and lower(trim(p.cognome)) = lower(trim(t2.tecnico_cognome))
       and coalesce(p.elimina, 0) = 0
     where t2.persona_id is null
     group by t2.tecnico_id
    having count(*) = 1
  ) m
 where m.tecnico_id = t.tecnico_id;

-- il docente NON è personale: non legge anagrafiche, visite, cantieri
create or replace function public.is_personale()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.app_ruoli
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and stato = 'attivo'
      and ruolo not in ('amministrazione', 'docente')
  ) or exists (
    select 1 from public.tecnici
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and coalesce(attivo, true) and coalesce(elimina, 0) = 0
  );
$$;

create or replace function public.is_docente()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.app_ruoli
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and stato = 'attivo' and ruolo = 'docente'
  );
$$;
revoke all on function public.is_docente() from public, anon;
grant execute on function public.is_docente() to authenticated;

-- ogni accesso legge la PROPRIA riga di app_ruoli (serve al docente, che non è personale)
drop policy if exists app_ruoli_sel_propria on public.app_ruoli;
create policy app_ruoli_sel_propria on public.app_ruoli
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ── 4. il responsabile del progetto formativo ────────────────
insert into public.s_config (chiave, valore, descrizione)
values ('responsabile_formativo_email', 'paolo.balladore@did.formedilpadova.it',
        'E-mail con cui il responsabile del progetto formativo entra nel gestionale: è così che is_rpf() lo riconosce (13/10/2026). Nome e firma stanno in responsabile_formativo_nome / _firma_id.')
on conflict (chiave) do nothing;

create or replace function public.is_rpf()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.s_config c
     where c.chiave = 'responsabile_formativo_email'
       and lower(trim(c.valore)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) and (
    exists (select 1 from public.app_ruoli
             where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and stato = 'attivo')
    or exists (select 1 from public.tecnici
                where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and coalesce(attivo, true) and coalesce(elimina, 0) = 0)
  );
$$;
revoke all on function public.is_rpf() from public, anon;
grant execute on function public.is_rpf() to authenticated;

-- ── 5. la persona dietro chi è collegato, e «è docente di questo corso» ──
create or replace function public.mia_persona_id()
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select r.persona_id from public.app_ruoli r
      where lower(r.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and r.stato = 'attivo' and r.persona_id is not null
      limit 1),
    (select t.persona_id from public.tecnici t
      where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and coalesce(t.attivo, true) and coalesce(t.elimina, 0) = 0 and t.persona_id is not null
      limit 1));
$$;
revoke all on function public.mia_persona_id() from public, anon;
grant execute on function public.mia_persona_id() to authenticated;

create or replace function public.is_docente_del_corso(p_corso bigint)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.mia_persona_id() is not null and (
    exists (select 1 from public.s_corsi_interventi i
             where i.corso_id = p_corso and i.persona_id = public.mia_persona_id())
    or exists (select 1 from public.s_corsi_incarichi k
                where k.corso_id = p_corso and k.persona_id = public.mia_persona_id())
  );
$$;
revoke all on function public.is_docente_del_corso(bigint) from public, anon;
grant execute on function public.is_docente_del_corso(bigint) to authenticated;

-- ── 6. chi legge le firme: la segreteria tutte, ciascuno le proprie ──
drop policy if exists s_firme_presidente_lettura on public.s_firme;
drop policy if exists s_firme_lettura on public.s_firme;
create policy s_firme_lettura on public.s_firme
  for select to authenticated
  using (public.is_segreteria() or lower(firmatario_email) = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.s_firme from anon;
grant select on public.s_firme to authenticated;

-- la vista di compatibilità col nome vecchio (security_invoker: vale la RLS di s_firme)
create view public.s_firme_presidente with (security_invoker = true) as select * from public.s_firme;
comment on view public.s_firme_presidente is 'Nome vecchio di s_firme (fino al 13/10/2026). Da togliere quando gestionale direzione.js e asseverazione firma-presidente/route.ts leggono s_firme.';
revoke all on public.s_firme_presidente from anon;
grant select on public.s_firme_presidente to authenticated;

-- ── 7. le RPC esistenti puntano alla tabella nuova ───────────
create or replace function public.s_firma_autografo(p_id bigint, p_data date)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_segreteria() then raise exception 'Lo segna la segreteria.'; end if;
  update s_firme
     set autografo_il = p_data,
         autografo_da = case when p_data is null then null else lower(auth.jwt() ->> 'email') end
   where id = p_id and stato = 'firmata';
  if not found then raise exception 'Documento non trovato, o non ancora firmato nell''app.'; end if;
end $$;

create or replace function public.s_firma_usata(p_id bigint)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_segreteria() then raise exception 'Lo segna la segreteria.'; end if;
  update s_firme set usata_il = coalesce(usata_il, now()) where id = p_id and stato = 'firmata';
end $$;

-- ── 8. il bucket: lo legge la segreteria e chi deve firmare quel documento ──
drop policy if exists firme_presidente_lettura on storage.objects;
create policy firme_presidente_lettura on storage.objects
  for select to authenticated
  using (bucket_id = 'firme-presidente' and (
    public.is_segreteria()
    or exists (select 1 from public.s_firme f
                where lower(f.firmatario_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and (f.file_originale = storage.objects.name or f.file_firmato = storage.objects.name
                       or f.file_precedente = storage.objects.name))));
-- la segreteria carica gli originali e le scansioni firmate a mano
drop policy if exists firme_presidente_carica on storage.objects;
create policy firme_presidente_carica on storage.objects
  for insert to authenticated
  with check (bucket_id = 'firme-presidente' and public.is_segreteria()
              and (name like 'originali/%' or name like 'autografe/%'));

-- ── 9. (stesso giorno, migrazione firme_default_firmatario_2026_10_13) ──
-- Una riga scritta SENZA firmatario è del Presidente: così la funzione
-- firma-presidente del 04/10 (app asseverazione) continua a scrivere
-- attraverso la vista s_firme_presidente finché non passa a firma-documenti.
create or replace function public.s_firme_default_firmatario()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.firmatario_email is null then
    select lower(trim(valore)) into new.firmatario_email from public.s_config where chiave = 'presidente_email';
  end if;
  if new.firmatario_ruolo is null then new.firmatario_ruolo := 'presidente'; end if;
  return new;
end $$;
revoke all on function public.s_firme_default_firmatario() from public, anon, authenticated;
drop trigger if exists trg_s_firme_default_firmatario on public.s_firme;
create trigger trg_s_firme_default_firmatario
  before insert on public.s_firme
  for each row execute function public.s_firme_default_firmatario();
