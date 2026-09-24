-- Rapporti e nomine dalla scheda impresa (24/09/2026, decisioni dell'utente).
--
-- RAPPORTO (persone_imprese) = a chi appartiene la persona e da quando a quando:
--   dipendente, apprendista, tirocinante, titolare, socio. Qualifica, mansione, date.
-- NOMINA (s_nomine) = che funzione svolge per quell'impresa: RSPP, RLS, preposto...
--
-- Tre decisioni:
--   1. DIPENDENTE, APPRENDISTA, TIROCINANTE, TITOLARE, SOCIO sono RAPPORTI e non piu'
--      nomine: se li si sceglie come ruolo, l'app registra il rapporto.
--   2. Le funzioni INTERNE (preposto, capocantiere, caposquadra, RLS, addetti alle
--      emergenze, dirigente, direttore tecnico) PROPONGONO il rapporto «dipendente»
--      con la spunta gia' messa; RSPP, medico, coordinatori no: possono essere esterni.
--   3. Quali ruoli sono l'una o l'altra cosa lo dice il DATABASE, non il codice:
--      s_tipi_rapporto e la colonna s_ruoli.propone_rapporto. Si cambia una riga.

-- ── 1. i tipi di rapporto ─────────────────────────────────────────────────────
create table if not exists public.s_tipi_rapporto (
  codice    text primary key,
  etichetta text not null,
  ruolo_id  integer references public.s_ruoli(id_ruolo),  -- il ruolo di Access che lo esprimeva
  ordine    integer not null default 100
);
comment on table public.s_tipi_rapporto is
  'Tipi di rapporto persona-impresa (persone_imprese.tipo_rapporto). ruolo_id = il ruolo di s_ruoli che in Access si registrava come nomina: sceglierlo nella maschera nomine registra il rapporto.';

insert into public.s_tipi_rapporto (codice, etichetta, ruolo_id, ordine) values
  ('dipendente',  'Dipendente',              20, 10),
  ('apprendista', 'Apprendista',             35, 20),
  ('tirocinante', 'Tirocinante',             67, 30),
  ('titolare',    'Titolare',                23, 40),
  ('socio',       'Socio',                   42, 50),
  -- figura esterna: RSPP esterno, professionista, consulente, sindacalista... legati
  -- all'impresa senza rapporto di lavoro (decisione dell'utente sullo storico, 24/09)
  ('esterno',     'Figura esterna (nessun rapporto di lavoro)', null, 80),
  ('altro',       'Altro / da precisare',  null, 90)
on conflict (codice) do update set etichetta = excluded.etichetta, ruolo_id = excluded.ruolo_id, ordine = excluded.ordine;

alter table public.s_tipi_rapporto enable row level security;
drop policy if exists s_tipi_rapporto_sel on public.s_tipi_rapporto;
create policy s_tipi_rapporto_sel on public.s_tipi_rapporto
  for select to authenticated using ((select public.is_personale()));
revoke all on public.s_tipi_rapporto from anon;
grant select on public.s_tipi_rapporto to authenticated;

-- ── 2. le funzioni interne propongono il rapporto ─────────────────────────────
alter table public.s_ruoli add column if not exists propone_rapporto boolean not null default false;
comment on column public.s_ruoli.propone_rapporto is
  'Funzione interna all''impresa: registrando la nomina si propone anche il rapporto «dipendente» (spunta gia'' messa, si toglie). RSPP, medico e coordinatori restano false: possono essere esterni.';
update public.s_ruoli set propone_rapporto = (id_ruolo in (2, 12, 14, 15, 21, 22, 41, 53));
-- 2 RLS · 12 PREPOSTO · 14 ADD. EMERGENZA INCENDI · 15 ADD. PRIMO SOCCORSO
-- 21 CAPOCANTIERE · 22 CAPOSQUADRA · 41 DIRETTORE TECNICO · 53 DIRIGENTE

-- ── 3. la segreteria scrive i rapporti ────────────────────────────────────────
-- Le policy di persone_imprese nascono dall'app asseverazione (ufficio, coordinatore,
-- tecnici della pratica). Si aggiunge la segreteria, senza togliere niente.
drop policy if exists pi_view on public.persone_imprese;
create policy pi_view on public.persone_imprese for select to authenticated using (
  (select public.is_segreteria()) or a_is_office_or_coordinator() or exists (
    select 1 from a_pratica p where p.impresa_id = persone_imprese.impresa_id
      and (a_my_tecnico_id() = p.tecnico_principale or a_my_tecnico_id() = p.tecnico_secondario or a_my_tecnico_id() = p.osservatore)));
drop policy if exists pi_ins on public.persone_imprese;
create policy pi_ins on public.persone_imprese for insert to authenticated with check (
  (select public.is_segreteria()) or (select a_is_office_or_coordinator()) or exists (
    select 1 from a_pratica p where p.impresa_id = persone_imprese.impresa_id
      and ((select a_my_tecnico_id()) = p.tecnico_principale or (select a_my_tecnico_id()) = p.tecnico_secondario)));
drop policy if exists pi_upd on public.persone_imprese;
create policy pi_upd on public.persone_imprese for update to authenticated using (
  (select public.is_segreteria()) or (select a_is_office_or_coordinator()) or exists (
    select 1 from a_pratica p where p.impresa_id = persone_imprese.impresa_id
      and ((select a_my_tecnico_id()) = p.tecnico_principale or (select a_my_tecnico_id()) = p.tecnico_secondario)))
  with check (
  (select public.is_segreteria()) or (select a_is_office_or_coordinator()) or exists (
    select 1 from a_pratica p where p.impresa_id = persone_imprese.impresa_id
      and ((select a_my_tecnico_id()) = p.tecnico_principale or (select a_my_tecnico_id()) = p.tecnico_secondario)));

-- ── 4. registrare persona + rapporto + nomine in un colpo solo ────────────────
-- p = {
--   persona_id | persona: {titolo, cognome, nome, cf, email, telefono},
--   impresa_id,
--   rapporto: {tipo, qualifica, mansione, data_assunzione, note} | null,
--   nomine: [{ruolo_id, data_inizio, mansione, note}]
-- }
-- Tutto o niente. Non duplica: CF gia' in anagrafica = quella persona; rapporto gia'
-- in corso con l'impresa = non se ne apre un secondo; nomina equivalente in corso =
-- non se ne crea un'altra. Restituisce che cosa ha fatto, contato.
create or replace function public.s_registra_persona_impresa(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_pid uuid := nullif(p->>'persona_id', '')::uuid;
  v_imp text := nullif(trim(p->>'impresa_id'), '');
  v_imp_nome text;
  v_pers jsonb := p->'persona';
  v_cf text;
  v_rap jsonb := p->'rapporto';
  v_tipo text;
  v_rap_id uuid;
  v_rap_esito text := 'nessuno';
  v_n jsonb;
  v_ruolo record;
  v_nome text;
  v_acc int;
  v_nomine_create int := 0;
  v_nomine_gia int := 0;
  v_persona_esito text := 'esistente';
begin
  if not (select public.is_segreteria()) then
    raise exception 'Solo la segreteria registra persone e rapporti';
  end if;
  if v_imp is null then raise exception 'Manca l''impresa'; end if;
  select impresa_nome into v_imp_nome from imprese where impresa_id = v_imp;
  if not found then raise exception 'Impresa % non trovata', v_imp; end if;

  -- la persona: scelta, oppure nuova (mai doppia sul codice fiscale)
  if v_pid is null then
    if v_pers is null or coalesce(nullif(trim(v_pers->>'cognome'), ''), nullif(trim(v_pers->>'nome'), '')) is null then
      raise exception 'Serve la persona: sceglila dall''anagrafica o scrivi almeno il cognome';
    end if;
    v_cf := upper(nullif(trim(v_pers->>'cf'), ''));
    if v_cf is not null then
      select persona_id into v_pid from persone where upper(cf) = v_cf and coalesce(elimina, 0) = 0 limit 1;
    end if;
    if v_pid is null then
      insert into persone (titolo, cognome, nome, cf, email, telefono, updated_by)
      values (nullif(trim(v_pers->>'titolo'), ''), nullif(trim(v_pers->>'cognome'), ''),
              nullif(trim(v_pers->>'nome'), ''), v_cf,
              nullif(trim(v_pers->>'email'), ''), nullif(trim(v_pers->>'telefono'), ''),
              auth.jwt() ->> 'email')
      returning persona_id into v_pid;
      v_persona_esito := 'creata';
    else
      v_persona_esito := 'trovata_dal_cf';
    end if;
  elsif not exists (select 1 from persone where persona_id = v_pid) then
    raise exception 'Persona non trovata';
  end if;
  select trim(concat_ws(' ', cognome, titolo, nome)) into v_nome from persone where persona_id = v_pid;

  -- il rapporto
  if v_rap is not null and jsonb_typeof(v_rap) = 'object' then
    v_tipo := coalesce(nullif(v_rap->>'tipo', ''), 'dipendente');
    if not exists (select 1 from s_tipi_rapporto where codice = v_tipo) then
      raise exception 'Tipo di rapporto sconosciuto: %', v_tipo;
    end if;
    select id into v_rap_id from persone_imprese
     where persona_id = v_pid and impresa_id = v_imp
       and (data_cessazione is null or data_cessazione >= current_date)
     order by data_assunzione desc nulls last limit 1;
    if found then
      v_rap_esito := 'gia_in_corso';
    else
      insert into persone_imprese (persona_id, impresa_id, tipo_rapporto, qualifica, mansione, data_assunzione, note)
      values (v_pid, v_imp, v_tipo,
              nullif(v_rap->>'qualifica', '')::public.a_qualifica_lavoratore,
              nullif(trim(v_rap->>'mansione'), ''),
              nullif(v_rap->>'data_assunzione', '')::date,
              nullif(trim(v_rap->>'note'), ''))
      returning id into v_rap_id;
      v_rap_esito := 'creato';
    end if;
  end if;

  -- le nomine (funzioni). Un ruolo che e' un rapporto non diventa nomina.
  for v_n in select * from jsonb_array_elements(coalesce(p->'nomine', '[]'::jsonb)) loop
    select id_ruolo, ruolo into v_ruolo from s_ruoli where id_ruolo = (v_n->>'ruolo_id')::int;
    if not found then raise exception 'Ruolo % non trovato', v_n->>'ruolo_id'; end if;
    if exists (select 1 from s_tipi_rapporto t where t.ruolo_id = v_ruolo.id_ruolo) then
      raise exception '«%» e'' un rapporto, non una nomina', v_ruolo.ruolo;
    end if;
    perform pg_advisory_xact_lock(hashtext('s_nomine.access_id'));
    if exists (select 1 from s_nomine sn where sn.persona_id = v_pid and sn.ruolo_id = v_ruolo.id_ruolo
                  and sn.impresa_id = v_imp and (sn.data_fine is null or sn.data_fine >= current_date)) then
      v_nomine_gia := v_nomine_gia + 1;
      continue;
    end if;
    select greatest(90000, coalesce(max(access_id), 90000)) + 1 into v_acc from s_nomine where access_id >= 90000;
    insert into s_nomine (access_id, data_reg, persona_txt, persona_id, impresa_txt, impresa_id,
                          ruolo_txt, ruolo_id, mansione, data_inizio, note, created_at, updated_at)
    values (v_acc, current_date, v_nome, v_pid, v_imp_nome, v_imp,
            v_ruolo.ruolo, v_ruolo.id_ruolo, nullif(trim(v_n->>'mansione'), ''),
            nullif(v_n->>'data_inizio', '')::date, nullif(trim(v_n->>'note'), ''), now(), now());
    v_nomine_create := v_nomine_create + 1;
  end loop;

  return jsonb_build_object(
    'persona_id', v_pid, 'persona', v_persona_esito,
    'rapporto_id', v_rap_id, 'rapporto', v_rap_esito,
    'nomine_create', v_nomine_create, 'nomine_gia_in_corso', v_nomine_gia);
end $$;
revoke execute on function public.s_registra_persona_impresa(jsonb) from public, anon;
grant execute on function public.s_registra_persona_impresa(jsonb) to authenticated, service_role;

-- ── 5. cessare un rapporto (e, se si vuole, le nomine in corso per quell'impresa) ─
create or replace function public.s_rapporto_cessa(p_id uuid, p_data date, p_chiudi_nomine boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  if not (select public.is_segreteria()) then
    raise exception 'Solo la segreteria cessa un rapporto';
  end if;
  if p_data is null then raise exception 'Serve la data di cessazione'; end if;
  select * into r from persone_imprese where id = p_id;
  if not found then raise exception 'Rapporto non trovato'; end if;
  if r.data_assunzione is not null and p_data < r.data_assunzione then
    raise exception 'La cessazione (%) viene prima dell''assunzione (%)', p_data, r.data_assunzione;
  end if;
  update persone_imprese set data_cessazione = p_data where id = p_id;
  if p_chiudi_nomine then
    update s_nomine set data_fine = p_data, updated_at = now()
     where persona_id = r.persona_id and impresa_id = r.impresa_id
       and (data_fine is null or data_fine > p_data)
       and (data_inizio is null or data_inizio <= p_data);
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('rapporto', p_id, 'nomine_chiuse', n);
end $$;
revoke execute on function public.s_rapporto_cessa(uuid, date, boolean) from public, anon;
grant execute on function public.s_rapporto_cessa(uuid, date, boolean) to authenticated, service_role;
