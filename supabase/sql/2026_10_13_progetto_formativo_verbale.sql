-- ============================================================
-- PROGETTO FORMATIVO DELL'EDIZIONE E VERBALE DI VERIFICA FINALE
-- (13/10/2026) — lotto 3 del fascicolo corso digitale
--
-- Progetto: 2_AREE/Formazione/2026_10_13_REL_Area-Sicurezza_fascicolo-corso-
-- digitale_progetto-tecnico.md, § 2.3, § 5.2, § 5.4.
--
-- Che cosa nasce:
--   1. su `s_corsi`: da dove nasce il corso (`origine_tipo`, `origine_rif`:
--      l'autorizzazione sta nella pratica a monte, non nell'apertura),
--      `formativa` (solo conferenze di cantiere: se vero vuole il fascicolo
--      pieno, altrimenti è un convegno), `codice_socrate` (il gestionale
--      dell'ufficio corsi, quando il corso è inserito anche lì), `rpf_email`
--      (congelata), e lo stato del PROGETTO FORMATIVO dell'edizione
--      (l'Allegato 3: dichiarazione dell'RPF + analisi aula, PDF disegnato
--      da documenti-corso, firma dell'RPF nel registro, rif `progetto:<id>`).
--   2. `s_corsi_verbali_verifica`: il VERBALE DI VERIFICA FINALE (Allegato 4,
--      Accordo parte I punto 5): dati del corso, luogo e data, modalità,
--      lingua, lo SCRUTINIO fotografato (per ogni iscritto ore, % assenze,
--      ammesso sì/no e perché, esito della verifica, esito finale),
--      gli esaminatori, gli argomenti se la verifica è un colloquio,
--      annotazioni. Lo prepara `corso_verbale_prepara` dalle presenze e
--      dalle prove del test; l'RPF lo completa; firme in catena (esaminatori,
--      poi RPF; rif `verbale:<id>`). Una fotografia, non una vista: dopo
--      la firma non si ricalcola; se cambia una presenza si apre una
--      versione nuova.
--   3. su `s_corsi_iscritti`: chi ha aggiunto l'allievo in aula (lotto 5)
--      e quando la segreteria l'ha verificato. La MANSIONE è necessaria
--      (analisi aula dell'Allegato 3): non si blocca l'iscrizione — gli
--      arrivi dal portale e dalle conferenze non la portano sempre — ma
--      il verbale non si dichiara pronto con un ammesso senza mansione,
--      e la maschera la segnala in rosso.
--   4. su `s_corsi_incarichi`: l'accettazione dell'incarico (lotto 5).
--   5. GUARDIANO degli attestati: per un corso dell'Accordo (tipologia con
--      accordo_2025) un attestato non prende numero finché il verbale di
--      verifica non è firmato. È il punto in cui il fascicolo fa da
--      guardiano, e vale nel database, non solo nella maschera.
-- ============================================================

-- ── 1. il corso ──────────────────────────────────────────────
alter table public.s_corsi
  add column if not exists origine_tipo        text check (origine_tipo in ('progetto_finanziato', 'richiesta_impresa', 'conferenza', 'ufficio')),
  add column if not exists origine_rif         text,
  add column if not exists formativa           boolean,
  add column if not exists codice_socrate      text,
  add column if not exists rpf_email           text,
  add column if not exists analisi_aula_note   text,
  add column if not exists progetto_stato      text not null default 'da_fare' check (progetto_stato in ('da_fare', 'pronto', 'in_firma', 'firmato')),
  add column if not exists progetto_firmato_il timestamptz,
  add column if not exists progetto_pdf_path   text,
  add column if not exists progetto_sha256     text;
comment on column public.s_corsi.origine_rif is 'La pratica che autorizza il corso: id del progetto finanziato, della richiesta/consulenza dei servizi CPT (approvata dal Direttore), della conferenza, o la nota per l''iniziativa dell''ufficio.';
comment on column public.s_corsi.formativa is 'Solo conferenze di cantiere (13/10/2026, deciso dall''utente): vero = formativa, fascicolo pieno e crediti; falso = come un convegno, solo registro.';
comment on column public.s_corsi.codice_socrate is 'Il codice del corso nel gestionale dell''ufficio corsi (Socrate), quando il corso è inserito anche lì per il libretto formativo; stampato accanto al nostro numero.';
comment on column public.s_corsi.progetto_stato is 'Il progetto formativo dell''edizione (Allegato 3): da_fare → pronto (RPF) → in_firma (segreteria) → firmato (registro delle firme, rif progetto:<id>).';

-- ── 2. il verbale di verifica finale ────────────────────────
create table if not exists public.s_corsi_verbali_verifica (
  id                  bigint generated always as identity primary key,
  corso_id            bigint not null references public.s_corsi(id) on delete restrict,
  versione            smallint not null default 1,
  stato               text not null default 'bozza' check (stato in ('bozza', 'pronto', 'in_firma', 'firmato', 'superato')),
  data_verifica       date,
  luogo               text,
  modalita_erogazione text,
  lingua              text not null default 'italiano',
  scrutinio           jsonb not null default '[]'::jsonb,
  esaminatori         jsonb not null default '[]'::jsonb,
  argomenti_colloquio text,
  annotazioni         text,
  pdf_bucket_path     text,
  sha256_pdf          text,
  firmato_il          timestamptz,
  creato_da           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  aggiornato_da       text,
  unique (corso_id, versione)
);
create index if not exists s_corsi_verbali_corso on public.s_corsi_verbali_verifica (corso_id, versione desc);
comment on table public.s_corsi_verbali_verifica is
  'Verbale di verifica finale del corso (Allegato 4, Accordo CSR 59/2025 parte I punto 5), 13/10/2026. scrutinio = fotografia per iscritto {iscritto_id, nominativo, cf, impresa, mansione, ore, ore_totali, perc_frequenza, perc_assenze, ammesso, motivo, verifica (positivo|negativo|colloquio|non_sostenuta), esito}. Stati: bozza → pronto → in_firma → firmato → superato. Si scrive solo con corso_verbale_prepara / corso_verbale_salva / corso_verbale_stato.';
alter table public.s_corsi_verbali_verifica enable row level security;
drop policy if exists s_corsi_verbali_sel on public.s_corsi_verbali_verifica;
create policy s_corsi_verbali_sel on public.s_corsi_verbali_verifica
  for select to authenticated using ((select public.is_personale()) or public.is_docente_del_corso(corso_id));
revoke all on public.s_corsi_verbali_verifica from anon;
grant select on public.s_corsi_verbali_verifica to authenticated;

-- ── 3. gli iscritti ──────────────────────────────────────────
alter table public.s_corsi_iscritti
  add column if not exists aggiunto_in_aula_da text,
  add column if not exists aggiunto_in_aula_il timestamptz,
  add column if not exists verificato_da_segreteria_il timestamptz;

-- ── 4. gli incarichi ─────────────────────────────────────────
alter table public.s_corsi_incarichi
  add column if not exists accettato_il timestamptz,
  add column if not exists accettazione_firma_id bigint references public.s_firme(id) on delete set null;
create index if not exists s_corsi_incarichi_accettazione on public.s_corsi_incarichi (accettazione_firma_id);

-- ── 5. chi può (RPF e segreteria) ────────────────────────────
create or replace function public.corso_e_accordo(p_corso bigint)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.s_corsi c join public.s_corsi_tipologie t on t.id = c.tipologia_id
     where c.id = p_corso and t.accordo_2025 and coalesce(c.formativa, true));
$$;
revoke all on function public.corso_e_accordo(bigint) from public, anon;
grant execute on function public.corso_e_accordo(bigint) to authenticated;

-- il progetto formativo dell'edizione: i passaggi di stato
create or replace function public.corso_progetto_stato(p_corso bigint, p_stato text)
returns public.s_corsi
language plpgsql security definer set search_path to 'public'
as $$
declare r public.s_corsi; capo boolean := public.is_segreteria() or public.is_rpf();
begin
  select * into r from s_corsi where id = p_corso;
  if r.id is null then raise exception 'Corso non trovato.'; end if;
  if p_stato = 'pronto' then
    if not capo then raise exception 'Il progetto formativo lo dichiara pronto il responsabile del progetto formativo.'; end if;
    if r.progetto_stato not in ('da_fare') then raise exception 'Il progetto è già %.', r.progetto_stato; end if;
    if r.tipologia_id is null then raise exception 'Il corso non ha una tipologia: senza, non c''è progetto formativo.'; end if;
    if not exists (select 1 from s_corsi_iscritti i where i.corso_id = p_corso and coalesce(i.esito, '') not in ('annullato', 'sostituito')) then
      raise exception 'Senza iscritti non c''è analisi aula: il progetto si dichiara pronto dopo le iscrizioni.';
    end if;
  elsif p_stato = 'in_firma' then
    if not public.is_segreteria() then raise exception 'In firma lo manda la segreteria.'; end if;
    if r.progetto_stato <> 'pronto' then raise exception 'Si manda in firma solo un progetto pronto (stato «%»).', r.progetto_stato; end if;
  elsif p_stato = 'da_fare' then
    if not capo then raise exception 'Solo il responsabile del progetto formativo o la segreteria.'; end if;
    if r.progetto_stato = 'in_firma' and not public.is_segreteria() then raise exception 'Un progetto in firma lo riapre la segreteria, ritirando la richiesta.'; end if;
    if r.progetto_stato = 'firmato' then raise exception 'Un progetto firmato non si riapre: resta agli atti.'; end if;
  else
    raise exception 'Stato non previsto: %', p_stato;
  end if;
  update s_corsi set progetto_stato = p_stato, updated_at = now(), aggiornato_da = lower(coalesce(auth.jwt() ->> 'email', ''))
   where id = p_corso returning * into r;
  return r;
end $$;
revoke all on function public.corso_progetto_stato(bigint, text) from public, anon;
grant execute on function public.corso_progetto_stato(bigint, text) to authenticated;

-- il verbale: lo prepara il database dalle presenze e dalle prove, l'RPF lo completa
create or replace function public.corso_verbale_prepara(p_corso bigint)
returns public.s_corsi_verbali_verifica
language plpgsql security definer set search_path to 'public'
as $$
declare
  c   public.s_corsi;
  v   public.s_corsi_verbali_verifica;
  me  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  ore_tot numeric;
  scr jsonb;
  esam jsonb;
  ult_data date;
begin
  if not (public.is_segreteria() or public.is_rpf()) then
    raise exception 'Il verbale di verifica lo prepara il responsabile del progetto formativo (o la segreteria).';
  end if;
  select * into c from s_corsi where id = p_corso;
  if c.id is null then raise exception 'Corso non trovato.'; end if;
  select coalesce(sum(coalesce(extract(epoch from (g.alle - g.dalle)) / 3600, 0) + coalesce(extract(epoch from (g.alle2 - g.dalle2)) / 3600, 0)), 0), max(g.data)
    into ore_tot, ult_data from s_corsi_giornate g where g.corso_id = p_corso;
  if coalesce(c.durata_ore, 0) > 0 then ore_tot := c.durata_ore; end if;
  /* la fotografia dello scrutinio */
  select coalesce(jsonb_agg(jsonb_build_object(
      'iscritto_id', i.id, 'nominativo', i.nominativo, 'cf', i.cf, 'impresa', i.impresa_txt, 'mansione', i.mansione,
      'ore', coalesce(i.ore_frequentate, p.ore, 0), 'ore_totali', ore_tot,
      'perc_frequenza', coalesce(i.perc_frequenza, case when ore_tot > 0 then round(least(100, coalesce(i.ore_frequentate, p.ore, 0) / ore_tot * 100), 1) else null end),
      'perc_assenze', case when coalesce(i.perc_frequenza, case when ore_tot > 0 then round(least(100, coalesce(i.ore_frequentate, p.ore, 0) / ore_tot * 100), 1) end) is null then null
                           else round(100 - coalesce(i.perc_frequenza, case when ore_tot > 0 then round(least(100, coalesce(i.ore_frequentate, p.ore, 0) / ore_tot * 100), 1) end), 1) end,
      'ammesso', coalesce(i.perc_frequenza, case when ore_tot > 0 then round(least(100, coalesce(i.ore_frequentate, p.ore, 0) / ore_tot * 100), 1) else 0 end) >= coalesce(c.perc_freq_min, 90),
      'motivo', case when coalesce(i.perc_frequenza, case when ore_tot > 0 then round(least(100, coalesce(i.ore_frequentate, p.ore, 0) / ore_tot * 100), 1) else 0 end) >= coalesce(c.perc_freq_min, 90)
                     then null else 'frequenza sotto il ' || coalesce(c.perc_freq_min, 90) || '%' end,
      'verifica', case when t.esito = 'positivo' then 'positivo' when t.esito = 'negativo' then 'negativo' when t.esito is not null then t.esito else 'non_sostenuta' end,
      'verifica_percentuale', t.percentuale,
      'esito', i.esito
    ) order by i.nominativo), '[]'::jsonb)
    into scr
    from s_corsi_iscritti i
    left join lateral (select sum(coalesce(pr.ore, 0)) as ore from s_corsi_presenze pr where pr.iscritto_id = i.id and coalesce(pr.presente, true)) p on true
    left join lateral (select tp.esito, tp.percentuale from s_test_prove tp where tp.iscritto_id = i.id order by tp.consegnato_il desc nulls last limit 1) t on true
   where i.corso_id = p_corso and coalesce(i.esito, '') not in ('annullato', 'sostituito');
  /* gli esaminatori: i docenti del programma */
  select coalesce(jsonb_agg(distinct jsonb_build_object('persona_id', x.persona_id, 'nominativo', x.nominativo)), '[]'::jsonb) into esam
    from (select distinct on (coalesce(persona_id::text, nominativo)) persona_id, nominativo from s_corsi_interventi
           where corso_id = p_corso and coalesce(qualita, 'docente') in ('docente', 'codocente') order by coalesce(persona_id::text, nominativo), nominativo) x;
  /* la bozza in corso si aggiorna; se l'ultima versione è firmata o superata se ne apre una nuova */
  select * into v from s_corsi_verbali_verifica where corso_id = p_corso order by versione desc limit 1;
  if v.id is not null and v.stato in ('bozza', 'pronto') then
    update s_corsi_verbali_verifica set scrutinio = scr, esaminatori = case when jsonb_array_length(esaminatori) = 0 then esam else esaminatori end,
           data_verifica = coalesce(data_verifica, ult_data), luogo = coalesce(luogo, c.sede), modalita_erogazione = coalesce(modalita_erogazione, c.modalita),
           stato = 'bozza', updated_at = now(), aggiornato_da = me
     where id = v.id returning * into v;
  elsif v.id is not null and v.stato = 'in_firma' then
    raise exception 'Il verbale è in firma: per rifarlo la segreteria ritira la richiesta di firma.';
  else
    insert into s_corsi_verbali_verifica (corso_id, versione, scrutinio, esaminatori, data_verifica, luogo, modalita_erogazione, creato_da, aggiornato_da)
    values (p_corso, coalesce(v.versione, 0) + 1, scr, esam, ult_data, c.sede, c.modalita, me, me) returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.corso_verbale_prepara(bigint) from public, anon;
grant execute on function public.corso_verbale_prepara(bigint) to authenticated;

create or replace function public.corso_verbale_salva(p jsonb)
returns public.s_corsi_verbali_verifica
language plpgsql security definer set search_path to 'public'
as $$
declare v public.s_corsi_verbali_verifica; me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not (public.is_segreteria() or public.is_rpf()) then raise exception 'Il verbale lo scrive il responsabile del progetto formativo (o la segreteria).'; end if;
  select * into v from s_corsi_verbali_verifica where id = nullif(p ->> 'id', '')::bigint;
  if v.id is null then raise exception 'Verbale non trovato.'; end if;
  if v.stato not in ('bozza', 'pronto') then raise exception 'Un verbale % non si modifica.', v.stato; end if;
  update s_corsi_verbali_verifica s set
    data_verifica       = case when p ? 'data_verifica' then nullif(p ->> 'data_verifica', '')::date else s.data_verifica end,
    luogo               = case when p ? 'luogo' then nullif(p ->> 'luogo', '') else s.luogo end,
    modalita_erogazione = case when p ? 'modalita_erogazione' then nullif(p ->> 'modalita_erogazione', '') else s.modalita_erogazione end,
    lingua              = case when p ? 'lingua' then coalesce(nullif(p ->> 'lingua', ''), 'italiano') else s.lingua end,
    scrutinio           = case when p ? 'scrutinio' then coalesce(p -> 'scrutinio', '[]'::jsonb) else s.scrutinio end,
    esaminatori         = case when p ? 'esaminatori' then coalesce(p -> 'esaminatori', '[]'::jsonb) else s.esaminatori end,
    argomenti_colloquio = case when p ? 'argomenti_colloquio' then nullif(p ->> 'argomenti_colloquio', '') else s.argomenti_colloquio end,
    annotazioni         = case when p ? 'annotazioni' then nullif(p ->> 'annotazioni', '') else s.annotazioni end,
    stato = 'bozza', updated_at = now(), aggiornato_da = me
  where s.id = v.id returning * into v;
  return v;
end $$;
revoke all on function public.corso_verbale_salva(jsonb) from public, anon;
grant execute on function public.corso_verbale_salva(jsonb) to authenticated;

create or replace function public.corso_verbale_stato(p_id bigint, p_stato text)
returns public.s_corsi_verbali_verifica
language plpgsql security definer set search_path to 'public'
as $$
declare v public.s_corsi_verbali_verifica; capo boolean := public.is_segreteria() or public.is_rpf(); n int;
begin
  select * into v from s_corsi_verbali_verifica where id = p_id;
  if v.id is null then raise exception 'Verbale non trovato.'; end if;
  if p_stato = 'pronto' then
    if not capo then raise exception 'Il verbale lo dichiara pronto il responsabile del progetto formativo.'; end if;
    if v.stato <> 'bozza' then raise exception 'Il verbale non è in bozza (stato «%»).', v.stato; end if;
    if v.data_verifica is null then raise exception 'Manca la data della verifica finale.'; end if;
    if jsonb_array_length(v.esaminatori) = 0 then raise exception 'Serve almeno un docente esaminatore.'; end if;
    select count(*) into n from jsonb_array_elements(v.scrutinio) r where (r ->> 'ammesso')::boolean and coalesce(r ->> 'mansione', '') = '';
    if n > 0 then raise exception '% ammessi senza mansione: va scritta sull''iscritto (analisi aula).', n; end if;
    select count(*) into n from jsonb_array_elements(v.scrutinio) r where (r ->> 'ammesso')::boolean and coalesce(r ->> 'verifica', '') not in ('positivo', 'negativo', 'colloquio');
    if n > 0 then raise exception '% ammessi senza esito della verifica (positivo, negativo o colloquio).', n; end if;
    select count(*) into n from jsonb_array_elements(v.scrutinio) r where r ->> 'verifica' = 'colloquio';
    if n > 0 and coalesce(v.argomenti_colloquio, '') = '' then raise exception 'La verifica è stata un colloquio per % iscritti: il verbale deve riportare gli argomenti trattati.', n; end if;
  elsif p_stato = 'in_firma' then
    if not public.is_segreteria() then raise exception 'In firma lo manda la segreteria.'; end if;
    if v.stato <> 'pronto' then raise exception 'Si manda in firma solo un verbale pronto (stato «%»).', v.stato; end if;
  elsif p_stato = 'bozza' then
    if not capo then raise exception 'Solo il responsabile del progetto formativo o la segreteria.'; end if;
    if v.stato not in ('pronto', 'in_firma') then raise exception 'Si riapre solo un verbale pronto o in firma (stato «%»).', v.stato; end if;
    if v.stato = 'in_firma' and not public.is_segreteria() then raise exception 'Un verbale in firma lo riapre la segreteria, ritirando la richiesta.'; end if;
  else
    raise exception 'Stato non previsto: %', p_stato;
  end if;
  update s_corsi_verbali_verifica set stato = p_stato, updated_at = now(), aggiornato_da = lower(coalesce(auth.jwt() ->> 'email', ''))
   where id = p_id returning * into v;
  return v;
end $$;
revoke all on function public.corso_verbale_stato(bigint, text) from public, anon;
grant execute on function public.corso_verbale_stato(bigint, text) to authenticated;

-- ── 6. il registro delle firme chiude anche progetto e verbale ──
create or replace function public.s_firme_dopo_corso()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare v_id bigint; v_corso bigint;
begin
  if new.tipo = 'progetto_formativo' then
    v_id := nullif(regexp_replace(new.rif, '^progetto:', ''), '')::bigint;
    if v_id is null then return new; end if;
    if new.stato = 'firmata' and not exists (select 1 from s_firme f where f.tipo = new.tipo and f.rif = new.rif and f.stato in ('in_coda', 'in_attesa')) then
      update s_corsi set progetto_stato = 'firmato', progetto_firmato_il = new.firmata_il, progetto_pdf_path = new.file_firmato, progetto_sha256 = new.sha256_firmato, updated_at = now()
       where id = v_id;
    elsif new.stato in ('rimandata', 'ritirata') and old.stato in ('in_attesa', 'in_coda') then
      update s_corsi set progetto_stato = 'pronto', updated_at = now() where id = v_id and progetto_stato = 'in_firma';
    end if;
  elsif new.tipo = 'verbale_verifica' then
    v_id := nullif(regexp_replace(new.rif, '^verbale:', ''), '')::bigint;
    if v_id is null then return new; end if;
    if new.stato = 'firmata' and not exists (select 1 from s_firme f where f.tipo = new.tipo and f.rif = new.rif and f.stato in ('in_coda', 'in_attesa')) then
      update s_corsi_verbali_verifica set stato = 'firmato', firmato_il = new.firmata_il, pdf_bucket_path = new.file_firmato, sha256_pdf = new.sha256_firmato, updated_at = now()
       where id = v_id returning corso_id into v_corso;
      update s_corsi_verbali_verifica set stato = 'superato', updated_at = now() where corso_id = v_corso and id <> v_id and stato = 'firmato';
    elsif new.stato in ('rimandata', 'ritirata') and old.stato in ('in_attesa', 'in_coda') then
      update s_corsi_verbali_verifica set stato = 'pronto', updated_at = now() where id = v_id and stato = 'in_firma';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.s_firme_dopo_corso() from public, anon, authenticated;
drop trigger if exists trg_s_firme_dopo_corso on public.s_firme;
create trigger trg_s_firme_dopo_corso
  after update of stato on public.s_firme
  for each row execute function public.s_firme_dopo_corso();

-- ── 7. il guardiano degli attestati ─────────────────────────
create or replace function public.s_corsi_iscritti_guardia_attestato()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.attestato_numero is distinct from old.attestato_numero and new.attestato_numero is not null
     and public.corso_e_accordo(new.corso_id)
     and not exists (select 1 from s_corsi_verbali_verifica v where v.corso_id = new.corso_id and v.stato = 'firmato') then
    raise exception 'Corso dell''Accordo Stato-Regioni: l''attestato si emette dopo il verbale di verifica finale firmato (fascicolo del corso).';
  end if;
  return new;
end $$;
revoke all on function public.s_corsi_iscritti_guardia_attestato() from public, anon, authenticated;
drop trigger if exists trg_s_corsi_iscritti_guardia_attestato on public.s_corsi_iscritti;
create trigger trg_s_corsi_iscritti_guardia_attestato
  before update of attestato_numero on public.s_corsi_iscritti
  for each row execute function public.s_corsi_iscritti_guardia_attestato();
