-- ============================================================
-- TIPOLOGIE DI CORSO E SCHEDA FORMATIVA (13/10/2026) — lotto 2 del
-- fascicolo corso digitale
--
-- Progetto: 2_AREE/Formazione/2026_10_13_REL_Area-Sicurezza_fascicolo-corso-
-- digitale_progetto-tecnico.md, § 2.2, § 5.1, § 6.
--
-- Che cosa nasce:
--   1. `s_corsi_tipologie`: il CATALOGO dei corsi (antincendio livello 2,
--      preposti, aggiornamento lavoratori…): riferimento normativo, ore
--      minime, validità e aggiornamento, modalità ammesse, soglia di
--      frequenza, massimo discenti, test e questionario, se ricade
--      nell'Accordo CSR 59/2025 (fascicolo pieno), firme dal QR,
--      equivalenze («vale anche come»), crediti. Una tipologia non si
--      cancella: si supera (soft-archive).
--   2. `s_corsi_schede_formative`: la SCHEDA FORMATIVA della tipologia,
--      versionata, coi campi della scheda dell'Ufficio Corsi uno per uno:
--      traguardi, abilità, conoscenze, requisiti pre-corso, NAI/BES,
--      modalità, contenuti per unità didattica con le ore, metodologie,
--      strumenti, verifica e gradimento, note normative. La scrive il
--      responsabile del progetto formativo (RPF, is_rpf) oppure il docente
--      a cui la delega (`delegata_a`); la segreteria la manda in firma
--      (catena: delegato, poi RPF — registro s_firme, lotto 1) e a catena
--      completa la versione diventa `firmata` e VIGENTE per la tipologia;
--      le versioni firmate prima passano `superata`.
--   3. `s_corsi.tipologia_id` e `scheda_formativa_id`: l'edizione congela
--      la versione della scheda al momento dell'apertura (regola d'oro 7,
--      come RPF e rappresentante legale). `s_corsi.firme_qr`: se il corso
--      usa le firme di presenza dal QR (lotto 4), proposto dalla tipologia.
--
-- Si scrive SOLO con le RPC `tipologia_salva`, `scheda_salva`,
-- `scheda_stato`: ogni RPC controlla il ruolo nel corpo e tocca solo le
-- chiavi presenti nel JSON (regola «aprire e salvare non cambia niente»).
-- ============================================================

-- ── 1. il catalogo ───────────────────────────────────────────
create table if not exists public.s_corsi_tipologie (
  id                    bigint generated always as identity primary key,
  codice                text not null,
  titolo                text not null,
  riferimento_normativo text,
  ore_minime            numeric,
  validita_anni         smallint,
  aggiornamento_ore     numeric,
  aggiornamento_anni    smallint,
  modalita_ammesse      text[] not null default array['presenza'],
  perc_freq_min         numeric not null default 90,
  max_discenti          smallint not null default 30,
  rapporto_pratica      text,
  test_previsto         boolean not null default true,
  questionario_previsto boolean not null default true,
  tipo_attestato        text not null default 'frequenza_verifica'
                        check (tipo_attestato in ('partecipazione', 'frequenza', 'frequenza_verifica')),
  accordo_2025          boolean not null default true,
  firme_qr              boolean not null default true,
  vale_anche_come       text[] not null default '{}',
  crediti               numeric,
  scheda_vigente_id     bigint,
  stato                 text not null default 'attiva' check (stato in ('attiva', 'superata')),
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  aggiornato_da         text
);
create unique index if not exists s_corsi_tipologie_codice on public.s_corsi_tipologie (upper(codice));
comment on table public.s_corsi_tipologie is
  'Catalogo delle tipologie di corso (13/10/2026, lotto 2 del fascicolo corso digitale): riferimento normativo, ore, validità, soglie, se ricade nell''Accordo CSR 59/2025. La scheda formativa vigente è scheda_vigente_id. Si scrive solo con tipologia_salva (segreteria o RPF).';

-- ── 2. la scheda formativa, versionata ──────────────────────
create table if not exists public.s_corsi_schede_formative (
  id                 bigint generated always as identity primary key,
  tipologia_id       bigint not null references public.s_corsi_tipologie(id) on delete restrict,
  versione           smallint not null default 1,
  stato              text not null default 'bozza'
                     check (stato in ('bozza', 'pronta', 'in_firma', 'firmata', 'superata')),
  compilata_da       text,
  compilata_il       timestamptz,
  delegata_a         text,
  traguardi          text,
  abilita            text,
  conoscenze         text,
  requisiti_precorso jsonb not null default '[]'::jsonb,
  nai_bes            jsonb not null default '[]'::jsonb,
  modalita           jsonb not null default '[]'::jsonb,
  contenuti          jsonb not null default '[]'::jsonb,
  metodologie        jsonb not null default '[]'::jsonb,
  strumenti          jsonb not null default '[]'::jsonb,
  verifica           jsonb not null default '[]'::jsonb,
  note_normative     text,
  pdf_bucket_path    text,
  pdf_drive_id       text,
  sha256_pdf         text,
  firmata_il         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  aggiornato_da      text,
  unique (tipologia_id, versione)
);
create index if not exists s_corsi_schede_tipologia on public.s_corsi_schede_formative (tipologia_id, versione desc);
create index if not exists s_corsi_schede_delegata on public.s_corsi_schede_formative (lower(delegata_a));
comment on table public.s_corsi_schede_formative is
  'Scheda formativa (progettazione didattica) di una tipologia di corso, versionata (13/10/2026). I campi jsonb sono elenchi di voci {k, testo, on} (le caselle della scheda dell''Ufficio Corsi) e, per contenuti, {unita, argomenti, ore}. Stati: bozza → pronta → in_firma → firmata (vigente) → superata. Si scrive solo con scheda_salva / scheda_stato.';
alter table public.s_corsi_tipologie
  drop constraint if exists s_corsi_tipologie_scheda_vigente_fk;
alter table public.s_corsi_tipologie
  add constraint s_corsi_tipologie_scheda_vigente_fk
  foreign key (scheda_vigente_id) references public.s_corsi_schede_formative(id) on delete set null;
create index if not exists s_corsi_tipologie_vigente on public.s_corsi_tipologie (scheda_vigente_id);

-- ── 3. il corso punta alla tipologia e alla versione della scheda ──
alter table public.s_corsi
  add column if not exists tipologia_id bigint references public.s_corsi_tipologie(id) on delete set null,
  add column if not exists scheda_formativa_id bigint references public.s_corsi_schede_formative(id) on delete set null,
  add column if not exists firme_qr boolean;
create index if not exists s_corsi_tipologia on public.s_corsi (tipologia_id);
create index if not exists s_corsi_scheda on public.s_corsi (scheda_formativa_id);
comment on column public.s_corsi.scheda_formativa_id is 'La versione della scheda formativa congelata sull''edizione all''apertura (13/10/2026).';
comment on column public.s_corsi.firme_qr is 'Il corso usa le firme di presenza dal QR (lotto 4): proposto dalla tipologia, modificabile per corso. Null = come la tipologia.';

-- ── 4. chi legge ─────────────────────────────────────────────
alter table public.s_corsi_tipologie enable row level security;
alter table public.s_corsi_schede_formative enable row level security;
drop policy if exists s_corsi_tipologie_sel on public.s_corsi_tipologie;
create policy s_corsi_tipologie_sel on public.s_corsi_tipologie
  for select to authenticated using ((select public.is_personale()) or (select public.is_docente()));
drop policy if exists s_corsi_schede_sel on public.s_corsi_schede_formative;
create policy s_corsi_schede_sel on public.s_corsi_schede_formative
  for select to authenticated
  using ((select public.is_personale()) or lower(coalesce(delegata_a, '')) = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.s_corsi_tipologie from anon;
revoke all on public.s_corsi_schede_formative from anon;
grant select on public.s_corsi_tipologie to authenticated;
grant select on public.s_corsi_schede_formative to authenticated;

-- ── 5. chi scrive: le RPC ────────────────────────────────────
-- il catalogo: segreteria o RPF; solo le chiavi presenti
create or replace function public.tipologia_salva(p jsonb)
returns public.s_corsi_tipologie
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id bigint := nullif(p ->> 'id', '')::bigint;
  r    public.s_corsi_tipologie;
  me   text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not (public.is_segreteria() or public.is_rpf()) then
    raise exception 'Il catalogo delle tipologie lo scrivono la segreteria e il responsabile del progetto formativo.';
  end if;
  if v_id is null then
    if coalesce(p ->> 'codice', '') = '' or coalesce(p ->> 'titolo', '') = '' then
      raise exception 'Servono codice e titolo.';
    end if;
    insert into s_corsi_tipologie (codice, titolo, aggiornato_da) values (p ->> 'codice', p ->> 'titolo', me) returning * into r;
    v_id := r.id;
  end if;
  update s_corsi_tipologie t set
    codice                = case when p ? 'codice' then p ->> 'codice' else t.codice end,
    titolo                = case when p ? 'titolo' then p ->> 'titolo' else t.titolo end,
    riferimento_normativo = case when p ? 'riferimento_normativo' then nullif(p ->> 'riferimento_normativo', '') else t.riferimento_normativo end,
    ore_minime            = case when p ? 'ore_minime' then nullif(p ->> 'ore_minime', '')::numeric else t.ore_minime end,
    validita_anni         = case when p ? 'validita_anni' then nullif(p ->> 'validita_anni', '')::smallint else t.validita_anni end,
    aggiornamento_ore     = case when p ? 'aggiornamento_ore' then nullif(p ->> 'aggiornamento_ore', '')::numeric else t.aggiornamento_ore end,
    aggiornamento_anni    = case when p ? 'aggiornamento_anni' then nullif(p ->> 'aggiornamento_anni', '')::smallint else t.aggiornamento_anni end,
    modalita_ammesse      = case when p ? 'modalita_ammesse' then coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'modalita_ammesse') x), '{}') else t.modalita_ammesse end,
    perc_freq_min         = case when p ? 'perc_freq_min' then coalesce(nullif(p ->> 'perc_freq_min', '')::numeric, 90) else t.perc_freq_min end,
    max_discenti          = case when p ? 'max_discenti' then coalesce(nullif(p ->> 'max_discenti', '')::smallint, 30) else t.max_discenti end,
    rapporto_pratica      = case when p ? 'rapporto_pratica' then nullif(p ->> 'rapporto_pratica', '') else t.rapporto_pratica end,
    test_previsto         = case when p ? 'test_previsto' then (p ->> 'test_previsto')::boolean else t.test_previsto end,
    questionario_previsto = case when p ? 'questionario_previsto' then (p ->> 'questionario_previsto')::boolean else t.questionario_previsto end,
    tipo_attestato        = case when p ? 'tipo_attestato' then p ->> 'tipo_attestato' else t.tipo_attestato end,
    accordo_2025          = case when p ? 'accordo_2025' then (p ->> 'accordo_2025')::boolean else t.accordo_2025 end,
    firme_qr              = case when p ? 'firme_qr' then (p ->> 'firme_qr')::boolean else t.firme_qr end,
    vale_anche_come       = case when p ? 'vale_anche_come' then coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'vale_anche_come') x), '{}') else t.vale_anche_come end,
    crediti               = case when p ? 'crediti' then nullif(p ->> 'crediti', '')::numeric else t.crediti end,
    stato                 = case when p ? 'stato' then p ->> 'stato' else t.stato end,
    note                  = case when p ? 'note' then nullif(p ->> 'note', '') else t.note end,
    updated_at = now(), aggiornato_da = me
  where t.id = v_id
  returning * into r;
  if r.id is null then raise exception 'Tipologia non trovata.'; end if;
  return r;
end $$;
revoke all on function public.tipologia_salva(jsonb) from public, anon;
grant execute on function public.tipologia_salva(jsonb) to authenticated;

-- chi può scrivere QUESTA scheda: segreteria e RPF sempre; il delegato
-- finché è bozza o pronta, e non può cambiare né delega né stato
create or replace function public.scheda_posso_scrivere(p_scheda public.s_corsi_schede_formative)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.is_segreteria() or public.is_rpf()
      or (lower(coalesce(p_scheda.delegata_a, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and p_scheda.stato in ('bozza', 'pronta'));
$$;
revoke all on function public.scheda_posso_scrivere(public.s_corsi_schede_formative) from public, anon, authenticated;

create or replace function public.scheda_salva(p jsonb)
returns public.s_corsi_schede_formative
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id  bigint := nullif(p ->> 'id', '')::bigint;
  v_tip bigint := nullif(p ->> 'tipologia_id', '')::bigint;
  r     public.s_corsi_schede_formative;
  me    text := lower(coalesce(auth.jwt() ->> 'email', ''));
  capo  boolean := public.is_segreteria() or public.is_rpf();
begin
  if v_id is null then
    /* una versione nuova: solo RPF e segreteria; si parte dalla più recente */
    if not capo then raise exception 'Una versione nuova della scheda la apre il responsabile del progetto formativo (o la segreteria).'; end if;
    if v_tip is null then raise exception 'Serve la tipologia.'; end if;
    insert into s_corsi_schede_formative (tipologia_id, versione, compilata_da, compilata_il, aggiornato_da,
      traguardi, abilita, conoscenze, requisiti_precorso, nai_bes, modalita, contenuti, metodologie, strumenti, verifica, note_normative)
    select v_tip, coalesce((select max(versione) from s_corsi_schede_formative where tipologia_id = v_tip), 0) + 1, me, now(), me,
           s.traguardi, s.abilita, s.conoscenze, coalesce(s.requisiti_precorso, '[]'::jsonb), coalesce(s.nai_bes, '[]'::jsonb), coalesce(s.modalita, '[]'::jsonb),
           coalesce(s.contenuti, '[]'::jsonb), coalesce(s.metodologie, '[]'::jsonb), coalesce(s.strumenti, '[]'::jsonb), coalesce(s.verifica, '[]'::jsonb), s.note_normative
      from (select * from s_corsi_schede_formative where tipologia_id = v_tip order by versione desc limit 1) s
      right join (select 1) x on true
    returning * into r;
    v_id := r.id;
  else
    select * into r from s_corsi_schede_formative where id = v_id;
    if r.id is null then raise exception 'Scheda non trovata.'; end if;
    if not public.scheda_posso_scrivere(r) then
      raise exception 'Questa scheda non la puoi modificare (stato «%», delegata a «%»).', r.stato, coalesce(r.delegata_a, '—');
    end if;
    if r.stato in ('in_firma', 'firmata', 'superata') and not public.is_segreteria() then
      raise exception 'Una scheda in firma o firmata non si modifica: si apre una versione nuova.';
    end if;
  end if;
  update s_corsi_schede_formative s set
    traguardi          = case when p ? 'traguardi' then nullif(p ->> 'traguardi', '') else s.traguardi end,
    abilita            = case when p ? 'abilita' then nullif(p ->> 'abilita', '') else s.abilita end,
    conoscenze         = case when p ? 'conoscenze' then nullif(p ->> 'conoscenze', '') else s.conoscenze end,
    requisiti_precorso = case when p ? 'requisiti_precorso' then coalesce(p -> 'requisiti_precorso', '[]'::jsonb) else s.requisiti_precorso end,
    nai_bes            = case when p ? 'nai_bes' then coalesce(p -> 'nai_bes', '[]'::jsonb) else s.nai_bes end,
    modalita           = case when p ? 'modalita' then coalesce(p -> 'modalita', '[]'::jsonb) else s.modalita end,
    contenuti          = case when p ? 'contenuti' then coalesce(p -> 'contenuti', '[]'::jsonb) else s.contenuti end,
    metodologie        = case when p ? 'metodologie' then coalesce(p -> 'metodologie', '[]'::jsonb) else s.metodologie end,
    strumenti          = case when p ? 'strumenti' then coalesce(p -> 'strumenti', '[]'::jsonb) else s.strumenti end,
    verifica           = case when p ? 'verifica' then coalesce(p -> 'verifica', '[]'::jsonb) else s.verifica end,
    note_normative     = case when p ? 'note_normative' then nullif(p ->> 'note_normative', '') else s.note_normative end,
    /* la delega la decide chi è capo; il delegato non se la cambia */
    delegata_a         = case when p ? 'delegata_a' and capo then lower(nullif(p ->> 'delegata_a', '')) else s.delegata_a end,
    compilata_da       = coalesce(s.compilata_da, me),
    compilata_il       = coalesce(s.compilata_il, now()),
    updated_at = now(), aggiornato_da = me
  where s.id = v_id
  returning * into r;
  return r;
end $$;
revoke all on function public.scheda_salva(jsonb) from public, anon;
grant execute on function public.scheda_salva(jsonb) to authenticated;

-- i passaggi di stato che fanno le persone (firmata e superata li fa il registro delle firme)
create or replace function public.scheda_stato(p_id bigint, p_stato text)
returns public.s_corsi_schede_formative
language plpgsql security definer set search_path to 'public'
as $$
declare
  r    public.s_corsi_schede_formative;
  capo boolean := public.is_segreteria() or public.is_rpf();
begin
  select * into r from s_corsi_schede_formative where id = p_id;
  if r.id is null then raise exception 'Scheda non trovata.'; end if;
  if p_stato = 'pronta' then
    if not public.scheda_posso_scrivere(r) then raise exception 'Non puoi dichiarare pronta questa scheda.'; end if;
    if r.stato <> 'bozza' then raise exception 'La scheda non è in bozza (stato «%»).', r.stato; end if;
    if coalesce(r.traguardi, '') = '' or jsonb_array_length(r.contenuti) = 0 then
      raise exception 'Prima di dichiararla pronta servono almeno i traguardi di competenza e i contenuti.';
    end if;
  elsif p_stato = 'bozza' then
    if not capo and not public.scheda_posso_scrivere(r) then raise exception 'Non puoi riaprire questa scheda.'; end if;
    if r.stato not in ('pronta', 'in_firma') then raise exception 'Si riapre solo una scheda pronta o in firma (stato «%»).', r.stato; end if;
    if r.stato = 'in_firma' and not public.is_segreteria() then raise exception 'Una scheda in firma la riapre la segreteria, ritirando la richiesta di firma.'; end if;
  elsif p_stato = 'in_firma' then
    if not public.is_segreteria() then raise exception 'In firma la manda la segreteria.'; end if;
    if r.stato <> 'pronta' then raise exception 'Si manda in firma solo una scheda pronta (stato «%»).', r.stato; end if;
  elsif p_stato = 'superata' then
    if not capo then raise exception 'Solo il responsabile del progetto formativo o la segreteria.'; end if;
  else
    raise exception 'Stato non previsto: %', p_stato;
  end if;
  update s_corsi_schede_formative set stato = p_stato, updated_at = now(), aggiornato_da = lower(coalesce(auth.jwt() ->> 'email', ''))
   where id = p_id returning * into r;
  return r;
end $$;
revoke all on function public.scheda_stato(bigint, text) from public, anon;
grant execute on function public.scheda_stato(bigint, text) to authenticated;

-- ── 6. il registro delle firme chiude il giro ───────────────
-- Quando l'ULTIMA firma della catena «scheda:<id>» è apposta, la scheda è
-- firmata e vigente per la tipologia; le versioni firmate prima passano
-- superata. Se una firma viene rimandata o la richiesta ritirata, la
-- scheda torna pronta (si rimanda in firma, o si riapre).
create or replace function public.s_firme_dopo_scheda()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_scheda bigint;
  v_tip    bigint;
begin
  if new.tipo <> 'scheda_formativa' then return new; end if;
  v_scheda := nullif(regexp_replace(new.rif, '^scheda:', ''), '')::bigint;
  if v_scheda is null then return new; end if;
  if new.stato = 'firmata' and not exists (
       select 1 from s_firme f where f.tipo = new.tipo and f.rif = new.rif and f.stato in ('in_coda', 'in_attesa')) then
    update s_corsi_schede_formative
       set stato = 'firmata', firmata_il = new.firmata_il, pdf_bucket_path = new.file_firmato, sha256_pdf = new.sha256_firmato, updated_at = now()
     where id = v_scheda returning tipologia_id into v_tip;
    update s_corsi_schede_formative set stato = 'superata', updated_at = now()
     where tipologia_id = v_tip and id <> v_scheda and stato = 'firmata';
    update s_corsi_tipologie set scheda_vigente_id = v_scheda, updated_at = now() where id = v_tip;
  elsif new.stato in ('rimandata', 'ritirata') and old.stato in ('in_attesa', 'in_coda') then
    update s_corsi_schede_formative set stato = 'pronta', updated_at = now()
     where id = v_scheda and stato = 'in_firma';
  end if;
  return new;
end $$;
revoke all on function public.s_firme_dopo_scheda() from public, anon, authenticated;
drop trigger if exists trg_s_firme_dopo_scheda on public.s_firme;
create trigger trg_s_firme_dopo_scheda
  after update of stato on public.s_firme
  for each row execute function public.s_firme_dopo_scheda();
