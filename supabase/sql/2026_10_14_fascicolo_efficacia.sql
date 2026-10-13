-- ============================================================
-- IL FASCICOLO SU DRIVE E LA VERIFICA DI EFFICACIA (14/10/2026)
-- lotti 6 e 7 del fascicolo corso digitale (progetto § 2.5, § 2.6)
--
-- LOTTO 6 — il fascicolo del corso:
--   · lo STATO dei pezzi non si memorizza: lo calcola `corso_fascicolo(corso)`
--     da ciò che c'è (scheda firmata? progetto firmato? registro firmato per
--     ogni giornata? verbale firmato? attestati emessi?), come una vista
--     Bases del vault: una lista di controllo calcolata non resta indietro;
--   · `s_corsi_fascicolo_file` ricorda che cosa è stato DEPOSITATO su Drive
--     (cartella del corso in 2_AREE/Formazione/edizioni_corsi/, creata dalla
--     segreteria dall'app) e `s_corsi.fascicolo_*` la cartella e la chiusura;
--   · `corso_fascicolo_chiudi` chiude solo un fascicolo completo (per un
--     corso dell'Accordo: scheda, progetto, registri, verbale, attestati).
-- LOTTO 7 — la verifica di efficacia (Accordo 17/04/2025, a carico del
--   datore di lavoro, 6-12 mesi dopo): `s_corsi_efficacia` ha una riga per
--   impresa dei partecipanti di un corso dell'Accordo svolto; la popola
--   `efficacia_genera()` ogni primo del mese (pg_cron); nel cruscotto della
--   segreteria la tessera «📬 Verifiche di efficacia da ricordare» prepara
--   la bozza .eml e la segreteria segna «inviata» — l'app prepara, la
--   persona manda.
-- ============================================================

-- ── lotto 6 ──────────────────────────────────────────────────
alter table public.s_corsi
  add column if not exists fascicolo_drive_id  text,
  add column if not exists fascicolo_drive_url text,
  add column if not exists fascicolo_chiuso_il timestamptz,
  add column if not exists fascicolo_chiuso_da text;
comment on column public.s_corsi.fascicolo_drive_id is 'La cartella del corso su Drive (2_AREE/Formazione/edizioni_corsi/<data>_Corso-<id>_<titolo>), creata dall''app segreteria al primo deposito (14/10/2026, lotto 6).';

create table if not exists public.s_corsi_fascicolo_file (
  id            bigint generated always as identity primary key,
  corso_id      bigint not null references public.s_corsi(id) on delete cascade,
  pezzo         text not null check (pezzo in ('scheda', 'progetto', 'registro_giornata', 'verbale', 'accettazione', 'indice', 'altro')),
  rif           text not null default '',
  firma_id      bigint references public.s_firme(id) on delete set null,
  nome          text not null,
  drive_id      text not null,
  drive_url     text,
  sha256        text,
  depositato_il timestamptz not null default now(),
  depositato_da text,
  unique (corso_id, pezzo, rif)
);
comment on table public.s_corsi_fascicolo_file is 'Che cosa del fascicolo del corso è stato depositato nella cartella su Drive (14/10/2026, lotto 6): un pezzo per riga, col file di Drive. Lo stato dei pezzi NON sta qui: lo calcola corso_fascicolo.';
alter table public.s_corsi_fascicolo_file enable row level security;
drop policy if exists fascicolo_file_segr on public.s_corsi_fascicolo_file;
create policy fascicolo_file_segr on public.s_corsi_fascicolo_file for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
drop policy if exists fascicolo_file_sel on public.s_corsi_fascicolo_file;
create policy fascicolo_file_sel on public.s_corsi_fascicolo_file for select to authenticated
  using ((select public.is_rpf()) or public.is_docente_del_corso(corso_id));

/* il file firmato di un documento: quello dell'ultima firma della catena */
create or replace function public.fascicolo_firmato(p_tipo text, p_rif text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('firma_id', f.id, 'file', f.file_firmato, 'firmata_il', f.firmata_il, 'nome_file', f.nome_file, 'firmatari',
           (select count(*) from public.s_firme x where x.tipo = p_tipo and x.rif = p_rif and x.stato = 'firmata'))
    from public.s_firme f
   where f.tipo = p_tipo and f.rif = p_rif and f.stato = 'firmata'
     and not exists (select 1 from public.s_firme y where y.tipo = p_tipo and y.rif = p_rif and y.stato in ('in_coda', 'in_attesa'))
   order by f.ordine desc limit 1;
$$;

create or replace function public.corso_fascicolo(p_corso bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c public.s_corsi; t public.s_corsi_tipologie; s record; v public.s_corsi_verbali_verifica; v_accordo boolean;
        v_giornate jsonb; v_isc record; v_att record; v_test record; v_quest int; v_inc jsonb; v_dep jsonb; v_manc text[] := '{}'; v_completo boolean;
        v_scheda jsonb; v_prog jsonb; v_verb jsonb;
begin
  select * into c from public.s_corsi where id = p_corso;
  if not found then raise exception 'corso % non trovato', p_corso; end if;
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(p_corso)) then raise exception 'non autorizzato'; end if;
  if c.tipologia_id is not null then select * into t from public.s_corsi_tipologie where id = c.tipologia_id; end if;
  v_accordo := coalesce(t.accordo_2025, false) and (c.tipo <> 'conferenza_cantiere' or coalesce(c.formativa, false));

  if c.scheda_formativa_id is not null then
    select id, versione, stato, firmata_il into s from public.s_corsi_schede_formative where id = c.scheda_formativa_id;
    v_scheda := jsonb_build_object('id', s.id, 'versione', s.versione, 'stato', s.stato, 'firmata_il', s.firmata_il,
                  'firmato', public.fascicolo_firmato('scheda_formativa', 'scheda:' || s.id::text));
  end if;
  v_prog := jsonb_build_object('stato', c.progetto_stato, 'firmato_il', c.progetto_firmato_il, 'firmato', public.fascicolo_firmato('progetto_formativo', 'progetto:' || c.id::text));
  select * into v from public.s_corsi_verbali_verifica where corso_id = c.id order by versione desc limit 1;
  if v.id is not null then
    v_verb := jsonb_build_object('id', v.id, 'versione', v.versione, 'stato', v.stato, 'firmato_il', v.firmato_il, 'firmato', public.fascicolo_firmato('verbale_verifica', 'verbale:' || v.id::text));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'data', g.data,
           'registro', public.fascicolo_firmato('registro_giornata', 'giornata:' || g.id::text),
           'in_firma', exists (select 1 from public.s_firme f where f.tipo = 'registro_giornata' and f.rif = 'giornata:' || g.id::text and f.stato in ('in_attesa', 'in_coda')),
           'presenze', (select count(*) from public.s_corsi_presenze p where p.giornata_id = g.id),
           'firme_qr', (select count(*) from public.s_corsi_firme_presenza fp where fp.giornata_id = g.id and fp.stato = 'confermata')) order by g.data), '[]'::jsonb)
    into v_giornate from public.s_corsi_giornate g where g.corso_id = c.id;
  select count(*) filter (where coalesce(esito, '') not in ('annullato', 'sostituito')) as n,
         count(*) filter (where coalesce(esito, '') not in ('annullato', 'sostituito') and nullif(btrim(coalesce(mansione, '')), '') is null) as senza_mansione,
         count(*) filter (where aggiunto_in_aula_il is not null and verificato_da_segreteria_il is null) as da_verificare,
         count(*) filter (where attestato_numero is not null and attestato_revocato_il is null) as attestati,
         count(*) filter (where esito in ('presente', 'presente_online')) as ammessi
    into v_isc from public.s_corsi_iscritti where corso_id = c.id;
  select count(*) as prove, count(*) filter (where convalidato_il is not null) as convalidate into v_test from public.s_test_prove where corso_id = c.id;
  select count(*) into v_quest from public.s_quest_risposte where corso_id = c.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'nominativo', k.nominativo, 'qualita', k.qualita,
           'lettera', public.fascicolo_firmato('incarico_docenza', 'docenza:' || k.id::text), 'accettato_il', k.accettato_il,
           'accettazione', public.fascicolo_firmato('accettazione_incarico', 'incarico:' || k.id::text)) order by k.id), '[]'::jsonb)
    into v_inc from public.s_corsi_incarichi k where k.corso_id = c.id;
  select coalesce(jsonb_agg(jsonb_build_object('pezzo', d.pezzo, 'rif', d.rif, 'nome', d.nome, 'drive_url', d.drive_url, 'drive_id', d.drive_id, 'depositato_il', d.depositato_il, 'firma_id', d.firma_id) order by d.depositato_il), '[]'::jsonb)
    into v_dep from public.s_corsi_fascicolo_file d where d.corso_id = c.id;

  /* che cosa manca per chiudere: per un corso dell'Accordo il fascicolo pieno, altrimenti i registri */
  if v_isc.n = 0 then v_manc := array_append(v_manc, 'nessun iscritto'); end if;
  if v_accordo then
    if v_scheda is null or (v_scheda -> 'firmato') is null or jsonb_typeof(v_scheda -> 'firmato') = 'null' then v_manc := array_append(v_manc, 'scheda formativa firmata'); end if;
    if jsonb_typeof(v_prog -> 'firmato') = 'null' then v_manc := array_append(v_manc, 'progetto formativo firmato'); end if;
    if v_verb is null or jsonb_typeof(v_verb -> 'firmato') = 'null' then v_manc := array_append(v_manc, 'verbale di verifica firmato'); end if;
    if coalesce(c.rilascio_attestato, false) and v_isc.attestati = 0 then v_manc := array_append(v_manc, 'attestati emessi'); end if;
  end if;
  if jsonb_array_length(v_giornate) = 0 then v_manc := array_append(v_manc, 'almeno una giornata'); end if;
  if exists (select 1 from jsonb_array_elements(v_giornate) g where jsonb_typeof(g -> 'registro') = 'null' and (g ->> 'presenze')::int = 0) then
    v_manc := array_append(v_manc, 'registro firmato o presenze per ogni giornata');
  end if;
  if v_isc.da_verificare > 0 then v_manc := array_append(v_manc, (v_isc.da_verificare || ' allievi aggiunti in aula da verificare')); end if;
  v_completo := cardinality(v_manc) = 0;

  return jsonb_build_object(
    'corso_id', c.id, 'accordo', v_accordo, 'tipologia', case when t.id is null then null else jsonb_build_object('id', t.id, 'titolo', t.titolo) end,
    'scheda', v_scheda, 'progetto', v_prog, 'verbale', v_verb, 'giornate', v_giornate,
    'iscritti', jsonb_build_object('n', v_isc.n, 'senza_mansione', v_isc.senza_mansione, 'da_verificare', v_isc.da_verificare, 'ammessi', v_isc.ammessi),
    'attestati', jsonb_build_object('emessi', v_isc.attestati, 'previsti', coalesce(c.rilascio_attestato, false)),
    'test', jsonb_build_object('codice', c.test_codice, 'prove', v_test.prove, 'convalidate', v_test.convalidate),
    'questionario', jsonb_build_object('codice', c.quest_codice, 'risposte', v_quest),
    'incarichi', v_inc, 'depositati', v_dep,
    'mancanti', to_jsonb(v_manc), 'completo', v_completo,
    'cartella', jsonb_build_object('drive_id', c.fascicolo_drive_id, 'drive_url', c.fascicolo_drive_url),
    'chiuso_il', c.fascicolo_chiuso_il, 'chiuso_da', c.fascicolo_chiuso_da, 'codice_socrate', c.codice_socrate);
end $$;
revoke execute on function public.corso_fascicolo(bigint) from public, anon;

/* la segreteria registra un deposito (o la cartella) */
create or replace function public.corso_fascicolo_deposita(p_corso bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', '')); r public.s_corsi_fascicolo_file;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if not exists (select 1 from public.s_corsi where id = p_corso) then raise exception 'corso % non trovato', p_corso; end if;
  if p ? 'cartella_id' then
    update public.s_corsi set fascicolo_drive_id = p ->> 'cartella_id', fascicolo_drive_url = coalesce(p ->> 'cartella_url', fascicolo_drive_url) where id = p_corso;
  end if;
  if p ? 'pezzo' then
    insert into public.s_corsi_fascicolo_file (corso_id, pezzo, rif, firma_id, nome, drive_id, drive_url, sha256, depositato_da)
    values (p_corso, p ->> 'pezzo', coalesce(p ->> 'rif', ''), nullif(p ->> 'firma_id', '')::bigint, p ->> 'nome', p ->> 'drive_id', p ->> 'drive_url', p ->> 'sha256', v_me)
    on conflict (corso_id, pezzo, rif) do update set firma_id = excluded.firma_id, nome = excluded.nome, drive_id = excluded.drive_id, drive_url = excluded.drive_url, sha256 = excluded.sha256, depositato_il = now(), depositato_da = v_me
    returning * into r;
    return to_jsonb(r);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.corso_fascicolo_deposita(bigint, jsonb) from public, anon;

create or replace function public.corso_fascicolo_chiudi(p_corso bigint, p_riapri boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare f jsonb; v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if p_riapri then
    update public.s_corsi set fascicolo_chiuso_il = null, fascicolo_chiuso_da = null where id = p_corso;
    return jsonb_build_object('chiuso', false);
  end if;
  f := public.corso_fascicolo(p_corso);
  if not (f ->> 'completo')::boolean then
    raise exception 'Il fascicolo non è completo: manca %', array_to_string(array(select jsonb_array_elements_text(f -> 'mancanti')), ', ');
  end if;
  if (f -> 'cartella' ->> 'drive_id') is null then raise exception 'Il fascicolo non è ancora su Drive: prima «Deposita».'; end if;
  update public.s_corsi set fascicolo_chiuso_il = now(), fascicolo_chiuso_da = v_me, stato = case when stato = 'svolto' then 'chiuso' else stato end where id = p_corso;
  return jsonb_build_object('chiuso', true, 'chiuso_il', now());
end $$;
revoke execute on function public.corso_fascicolo_chiudi(bigint, boolean) from public, anon;

-- ── lotto 7 ──────────────────────────────────────────────────
create table if not exists public.s_corsi_efficacia (
  id                  bigint generated always as identity primary key,
  corso_id            bigint not null references public.s_corsi(id) on delete cascade,
  impresa_id          text,
  impresa_txt         text,
  email               text,
  partecipanti        int not null default 0,
  da_mandare_dal      date not null,
  entro               date not null,
  bozza_preparata_il  timestamptz,
  inviata_il          timestamptz,
  inviata_da          text,
  note                text,
  created_at          timestamptz not null default now()
);
/* una riga per impresa: con impresa_id NULL (impresa scritta a mano) un vincolo unique non terrebbe
   (i NULL sono distinti): indice sull'espressione, e lo stesso nell'on conflict */
create unique index if not exists s_corsi_efficacia_una_per_impresa
  on public.s_corsi_efficacia (corso_id, coalesce(impresa_id, ''), coalesce(impresa_txt, ''));
comment on table public.s_corsi_efficacia is 'I promemoria della verifica di efficacia (Accordo 17/04/2025: a carico del datore di lavoro, 6-12 mesi dopo il corso), una riga per impresa dei partecipanti (14/10/2026, lotto 7). Li popola efficacia_genera() ogni primo del mese; la segreteria prepara la bozza dal cruscotto e segna «inviata».';
alter table public.s_corsi_efficacia enable row level security;
drop policy if exists efficacia_segr on public.s_corsi_efficacia;
create policy efficacia_segr on public.s_corsi_efficacia for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));

create or replace function public.efficacia_genera()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0;
begin
  for r in
    select c.id as corso_id, c.data_fine, i.impresa_id, nullif(btrim(coalesce(i.impresa_txt, '')), '') as impresa_txt, count(*) as n,
           coalesce(nullif(btrim(coalesce(im.impresa_email_ref, '')), ''), nullif(btrim(coalesce(im.pec, '')), '')) as email
      from public.s_corsi c
      join public.s_corsi_tipologie t on t.id = c.tipologia_id
      join public.s_corsi_iscritti i on i.corso_id = c.id and i.esito in ('presente', 'presente_online')
      left join public.imprese im on im.impresa_id = i.impresa_id
     where c.stato in ('svolto', 'chiuso') and c.data_fine is not null
       and t.accordo_2025 and (c.tipo <> 'conferenza_cantiere' or coalesce(c.formativa, false))
       and c.data_fine >= date '2026-10-01'
       and (i.impresa_id is not null or nullif(btrim(coalesce(i.impresa_txt, '')), '') is not null)
     group by c.id, c.data_fine, i.impresa_id, nullif(btrim(coalesce(i.impresa_txt, '')), ''), im.impresa_email_ref, im.pec
  loop
    insert into public.s_corsi_efficacia (corso_id, impresa_id, impresa_txt, email, partecipanti, da_mandare_dal, entro)
    values (r.corso_id, r.impresa_id, r.impresa_txt, r.email, r.n, r.data_fine + interval '6 months', r.data_fine + interval '12 months')
    on conflict (corso_id, coalesce(impresa_id, ''), coalesce(impresa_txt, '')) do update set partecipanti = excluded.partecipanti, email = coalesce(public.s_corsi_efficacia.email, excluded.email);
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.efficacia_genera() from public, anon;

create or replace function public.efficacia_segna(p_id bigint, p_stato text, p_note text default null)
returns public.s_corsi_efficacia language plpgsql security definer set search_path to 'public' as $$
declare r public.s_corsi_efficacia; v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if p_stato = 'preparata' then
    update public.s_corsi_efficacia set bozza_preparata_il = now(), note = coalesce(p_note, note) where id = p_id returning * into r;
  elsif p_stato = 'inviata' then
    update public.s_corsi_efficacia set inviata_il = now(), inviata_da = v_me, bozza_preparata_il = coalesce(bozza_preparata_il, now()), note = coalesce(p_note, note) where id = p_id returning * into r;
  elsif p_stato = 'riapri' then
    update public.s_corsi_efficacia set inviata_il = null, inviata_da = null, note = coalesce(p_note, note) where id = p_id returning * into r;
  else
    raise exception 'stato % non previsto (preparata, inviata, riapri)', p_stato;
  end if;
  if r.id is null then raise exception 'promemoria % non trovato', p_id; end if;
  return r;
end $$;
revoke execute on function public.efficacia_segna(bigint, text, text) from public, anon;

/* il giro mensile: il primo del mese alle 6:30 di Roma (4:30 UTC d'estate) */
select cron.unschedule('efficacia-genera') where exists (select 1 from cron.job where jobname = 'efficacia-genera');
select cron.schedule('efficacia-genera', '30 4 1 * *', $$select public.efficacia_genera()$$);

-- ── i flussi nel cruscotto «che cosa è stato usato» ──────────
do $$
declare d text; a1 text; a2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 's_flussi_uso';
  a1 := 'from public.s_iscrizioni where stato = ''confermata''';
  a2 := '(''Formazione'', ''iscr_confermata'', ''Iscrizione confermata dalla segreteria'')';
  if d is null or position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 's_flussi_uso: ancora non trovata'; end if;
  if position('fascicolo_deposito' in d) > 0 then return; end if;
  d := replace(d, a1, a1 || E'\n    /* fascicolo su Drive e verifica di efficacia (14/10/2026, lotti 6 e 7) */'
    || E'\n    union all select ''Formazione'', ''fascicolo_deposito'', ''Documento del fascicolo depositato su Drive'', depositato_il::date from public.s_corsi_fascicolo_file'
    || E'\n    union all select ''Formazione'', ''fascicolo_chiuso'', ''Fascicolo del corso chiuso'', fascicolo_chiuso_il::date from public.s_corsi where fascicolo_chiuso_il is not null'
    || E'\n    union all select ''Formazione'', ''efficacia_inviata'', ''Promemoria della verifica di efficacia inviato'', inviata_il::date from public.s_corsi_efficacia where inviata_il is not null');
  d := replace(d, a2, a2 || E',\n    (''Formazione'', ''fascicolo_deposito'', ''Documento del fascicolo depositato su Drive''),\n    (''Formazione'', ''fascicolo_chiuso'', ''Fascicolo del corso chiuso''),\n    (''Formazione'', ''efficacia_inviata'', ''Promemoria della verifica di efficacia inviato'')');
  execute d;
end $$;
