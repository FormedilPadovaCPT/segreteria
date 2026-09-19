-- ============================================================================
-- UNIONI COMPLETE DI IMPRESE, PERSONE E CANTIERI (19/09/2026)
--
-- Fino a oggi unire due schede doppie spostava solo una parte dei dati:
--   · imprese  (RPC fondi_imprese): visite, presenze, certificazioni, imprese previste.
--              Restavano sul doppione archiviato rapporti di lavoro, nomine, ATECO,
--              storia dello stato in Cassa, pratiche dei servizi e di asseverazione,
--              iscrizioni ai corsi, cantieri critici, incarichi, protocolli.
--   · persone  (dal browser): solo persone_imprese. Restavano nomine, iscrizioni ai
--              corsi, docenze, pratiche dei servizi.
--   · cantieri (dal browser): visite e segnalazioni GPS. Restavano incarichi,
--              cantieri critici, notifiche e segnalazioni del portale, a_cantiere.
-- Nessun errore: i dati sparivano dalla vista, legati a una scheda che nessuno apre.
--
-- REGOLE DI QUESTE FUNZIONI
--   1. Le colonne da spostare si SCOPRONO DAL CATALOGO (come s_cambia_id_impresa):
--      una tabella nuova con impresa_id / persona_id / cantiere_id viene presa da sola.
--   2. Dove c'e' un vincolo unico, prima si toglie dal doppione cio' che la principale
--      ha gia', poi si sposta. Si lavora UN DOPPIONE ALLA VOLTA, cosi' due doppioni con
--      la stessa riga non si scontrano fra loro.
--   3. Niente si cancella che non sia un vero duplicato di una riga gia' presente.
--      a_impresa_dati (una riga per impresa): se la principale ce l'ha gia', quella del
--      doppione RESTA DOV'E' e il registro lo dice — non si butta un dato d'asseverazione.
--   4. Storia dello stato in Cassa: i periodi del doppione passano alla principale ma
--      NON «attuali» (l'indice unico ne ammette uno), con la nota della provenienza.
--   5. NON si toccano: cf_impresa delle pratiche (e' quello che l'impresa ha scritto nel
--      modulo), incarichi.impresa_id_origine, gli snapshot testuali.
--   6. Ogni unione scrive una riga in s_unioni_log: chi, quando, quali id, quante righe
--      per tabella. E' la strada per ricostruire un'unione sbagliata.
--   7. Solo la segreteria (o chi opera direttamente sul database).
-- ============================================================================

-- ── il registro delle unioni ────────────────────────────────────────────────
create table if not exists public.s_unioni_log (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('impresa','persona','cantiere')),
  master_id   text not null,
  dupe_ids    text[] not null,
  utente      text not null,
  fatto_il    timestamptz not null default now(),
  toccate     jsonb not null default '{}'::jsonb,   -- tabella.colonna -> righe spostate
  note        jsonb not null default '[]'::jsonb,   -- cose lasciate indietro, doppioni tolti, campi ereditati
  origine     text                                  -- da quale maschera
);
alter table public.s_unioni_log enable row level security;
drop policy if exists s_unioni_log_sel on public.s_unioni_log;
create policy s_unioni_log_sel on public.s_unioni_log for select using ((select public.is_segreteria()));
-- nessuna policy di scrittura: scrivono solo le funzioni qui sotto (security definer)
revoke all on public.s_unioni_log from anon;

-- ── chi puo' ────────────────────────────────────────────────────────────────
create or replace function public.s_unioni_autorizzato() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.is_segreteria(), false) or session_user = 'postgres' $$;
revoke execute on function public.s_unioni_autorizzato() from public, anon, authenticated;

-- ============================================================================
-- IMPRESE
-- ============================================================================
create or replace function public.fondi_imprese(p_master_id text, p_dupe_ids text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_utente  text := coalesce(auth.jwt() ->> 'email', 'sistema (' || session_user || ')');
  v_master_cf text;
  v_dupe    text;
  v_dupe_cf text;
  r         record;
  n         bigint;
  v_toccate jsonb := '{}'::jsonb;
  v_note    jsonb := '[]'::jsonb;
  tot       bigint := 0;
  v_arch    int;
begin
  if not public.s_unioni_autorizzato() then
    raise exception 'Operazione consentita solo alla segreteria';
  end if;
  if p_master_id is null or p_dupe_ids is null or array_length(p_dupe_ids,1) is null then
    raise exception 'Parametri mancanti';
  end if;
  p_dupe_ids := array(select distinct x from unnest(p_dupe_ids) x where x is not null and x <> p_master_id);
  if array_length(p_dupe_ids,1) is null then
    raise exception 'Nessuna impresa da unire (diversa dalla principale)';
  end if;
  if not exists (select 1 from imprese where impresa_id = p_master_id) then
    raise exception 'Impresa principale inesistente';
  end if;
  if (select count(*) from imprese where impresa_id = any(p_dupe_ids)) <> array_length(p_dupe_ids,1) then
    raise exception 'Una delle imprese da unire non esiste';
  end if;

  perform set_config('app.incarico_sistema', '1', true);   -- il guardiano degli incarichi lascia passare
  select impresa_cf into v_master_cf from imprese where impresa_id = p_master_id;

  foreach v_dupe in array p_dupe_ids loop
    select impresa_cf into v_dupe_cf from imprese where impresa_id = v_dupe;

    -- (a) tabelle con un vincolo unico, o dove un doppio sarebbe un errore: prima si toglie il duplicato vero
    delete from visite_imprese_presenti d where d.impresa_id = v_dupe
       and exists (select 1 from visite_imprese_presenti m where m.visita_id = d.visita_id and m.impresa_id = p_master_id);
    get diagnostics n = row_count;
    if n > 0 then v_note := v_note || jsonb_build_object('tolti_doppi', 'visite_imprese_presenti', 'righe', n, 'da', v_dupe); end if;

    delete from imprese_certificazioni d where d.impresa_id = v_dupe
       and exists (select 1 from imprese_certificazioni m where m.impresa_id = p_master_id and m.certificazione = d.certificazione);
    get diagnostics n = row_count;
    if n > 0 then v_note := v_note || jsonb_build_object('tolti_doppi', 'imprese_certificazioni', 'righe', n, 'da', v_dupe); end if;

    delete from imprese_ateco d where d.impresa_id = v_dupe
       and exists (select 1 from imprese_ateco m where m.impresa_id = p_master_id and m.codice = d.codice
                     and m.data_ateco is not distinct from d.data_ateco);
    get diagnostics n = row_count;
    if n > 0 then v_note := v_note || jsonb_build_object('tolti_doppi', 'imprese_ateco', 'righe', n, 'da', v_dupe); end if;

    -- imprese previste dei cantieri: la chiave e' il codice fiscale
    if v_master_cf is not null and v_dupe_cf is not null and v_dupe_cf <> v_master_cf then
      delete from cantiere_imprese_previste d where d.impresa_cf = v_dupe_cf
         and exists (select 1 from cantiere_imprese_previste m where m.cnce = d.cnce and m.impresa_cf = v_master_cf);
      update cantiere_imprese_previste set impresa_cf = v_master_cf where impresa_cf = v_dupe_cf;
      get diagnostics n = row_count;
      if n > 0 then v_toccate := v_toccate || jsonb_build_object('cantiere_imprese_previste.impresa_cf',
                       coalesce((v_toccate ->> 'cantiere_imprese_previste.impresa_cf')::bigint, 0) + n); tot := tot + n; end if;
    end if;

    -- storia dello stato in Cassa: un solo periodo «attuale» per impresa
    update imprese_cassa_storico s
       set attuale = false,
           nota = concat_ws(' — ', nullif(s.nota, ''), 'periodo della scheda ' || v_dupe || ', unita il ' || to_char(now(), 'DD/MM/YYYY'))
     where s.impresa_id = v_dupe
       and (not s.attuale or exists (select 1 from imprese_cassa_storico m where m.impresa_id = p_master_id and m.attuale));
    update imprese_cassa_storico s
       set nota = concat_ws(' — ', nullif(s.nota, ''), 'periodo della scheda ' || v_dupe || ', unita il ' || to_char(now(), 'DD/MM/YYYY'))
     where s.impresa_id = v_dupe and s.attuale;

    -- dati d'asseverazione: una riga per impresa. Se la principale ce l'ha gia', quella del doppione resta dov'e'
    if exists (select 1 from a_impresa_dati where impresa_id = v_dupe) then
      if exists (select 1 from a_impresa_dati where impresa_id = p_master_id) then
        v_note := v_note || jsonb_build_object('lasciata_sul_doppione', 'a_impresa_dati', 'da', v_dupe,
                  'perche', 'la principale ha gia'' i suoi dati di asseverazione: vanno confrontati a mano');
      end if;
    end if;

    -- (b) tutto il resto: ogni colonna impresa_id di public, scoperta dal catalogo
    for r in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
         and c.column_name = 'impresa_id'
         and c.table_name not in ('imprese', 's_unioni_log')
       order by c.table_name
    loop
      if r.table_name = 'a_impresa_dati' and exists (select 1 from a_impresa_dati where impresa_id = p_master_id) then
        continue;
      end if;
      execute format('update public.%I set impresa_id = $1 where impresa_id = $2', r.table_name) using p_master_id, v_dupe;
      get diagnostics n = row_count;
      if n > 0 then
        v_toccate := v_toccate || jsonb_build_object(r.table_name || '.impresa_id',
                     coalesce((v_toccate ->> (r.table_name || '.impresa_id'))::bigint, 0) + n);
        tot := tot + n;
      end if;
    end loop;
  end loop;

  -- la principale eredita solo cio' che le manca
  update imprese m set
    piva                 = coalesce(nullif(m.piva, ''), d.piva),
    indirizzo            = coalesce(nullif(m.indirizzo, ''), d.indirizzo),
    comune               = coalesce(nullif(m.comune, ''), d.comune),
    impresa_email_ref    = coalesce(nullif(m.impresa_email_ref, ''), d.impresa_email_ref),
    impresa_telefono     = coalesce(nullif(m.impresa_telefono, ''), d.impresa_telefono),
    contratto_ccnl       = coalesce(m.contratto_ccnl, d.contratto_ccnl),
    cassa_edile          = coalesce(m.cassa_edile, d.cassa_edile),
    tipo_iscrizione_ccia = coalesce(m.tipo_iscrizione_ccia, d.tipo_iscrizione_ccia),
    cod_ceiv             = coalesce(nullif(m.cod_ceiv, ''), d.cod_ceiv)
  from (select max(nullif(piva,'')) piva, max(nullif(indirizzo,'')) indirizzo, max(nullif(comune,'')) comune,
               max(nullif(impresa_email_ref,'')) impresa_email_ref, max(nullif(impresa_telefono,'')) impresa_telefono,
               max(contratto_ccnl) contratto_ccnl, max(cassa_edile) cassa_edile,
               max(tipo_iscrizione_ccia) tipo_iscrizione_ccia, max(nullif(cod_ceiv,'')) cod_ceiv
          from imprese where impresa_id = any(p_dupe_ids)) d
  where m.impresa_id = p_master_id;

  update imprese set elimina = 1,
         note_access = concat_ws(E'\n', nullif(note_access, ''),
                         format('Scheda unita a %s il %s da %s', p_master_id, to_char(now(), 'DD/MM/YYYY'), v_utente))
   where impresa_id = any(p_dupe_ids);
  get diagnostics v_arch = row_count;

  insert into s_unioni_log (tipo, master_id, dupe_ids, utente, toccate, note, origine)
  values ('impresa', p_master_id, p_dupe_ids, v_utente, v_toccate, v_note, 'fondi_imprese');

  return jsonb_build_object('ok', true, 'master', p_master_id, 'imprese_archiviate', v_arch,
           'righe_spostate', tot, 'toccate', v_toccate, 'note', v_note,
           -- i nomi di prima, perche' il gestionale pubblicato li legge ancora
           'visite_spostate', coalesce((v_toccate ->> 'visite.impresa_id')::bigint, 0),
           'presenze_spostate', coalesce((v_toccate ->> 'visite_imprese_presenti.impresa_id')::bigint, 0),
           'certificazioni', coalesce((v_toccate ->> 'imprese_certificazioni.impresa_id')::bigint, 0),
           'previste_rimappate', coalesce((v_toccate ->> 'cantiere_imprese_previste.impresa_cf')::bigint, 0));
end $$;

revoke execute on function public.fondi_imprese(text, text[]) from public, anon;
grant  execute on function public.fondi_imprese(text, text[]) to authenticated, service_role;

-- ============================================================================
-- PERSONE
-- ============================================================================
create or replace function public.fondi_persone(p_master_id uuid, p_dupe_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_utente text := coalesce(auth.jwt() ->> 'email', 'sistema (' || session_user || ')');
  r        record;
  n        bigint;
  v_toccate jsonb := '{}'::jsonb;
  v_note   jsonb := '[]'::jsonb;
  tot      bigint := 0;
  v_arch   int;
  v_doppie int;
begin
  if not public.s_unioni_autorizzato() then
    raise exception 'Operazione consentita solo alla segreteria';
  end if;
  if p_master_id is null or p_dupe_ids is null or array_length(p_dupe_ids,1) is null then
    raise exception 'Parametri mancanti';
  end if;
  p_dupe_ids := array(select distinct x from unnest(p_dupe_ids) x where x is not null and x <> p_master_id);
  if array_length(p_dupe_ids,1) is null then
    raise exception 'Nessuna scheda da unire (diversa dalla principale)';
  end if;
  if not exists (select 1 from persone where persona_id = p_master_id) then
    raise exception 'Scheda principale inesistente';
  end if;
  if (select count(*) from persone where persona_id = any(p_dupe_ids)) <> array_length(p_dupe_ids,1) then
    raise exception 'Una delle schede da unire non esiste';
  end if;
  -- due codici fiscali diversi sono due persone: l'unione si ferma
  if (select count(distinct upper(cf)) from persone
       where persona_id = any(p_dupe_ids || p_master_id) and coalesce(cf,'') <> '' and cf !~ '\*') > 1 then
    raise exception 'Le schede hanno codici fiscali diversi: sono persone diverse, non si uniscono';
  end if;

  -- ogni colonna persona_id di public, scoperta dal catalogo
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.column_name = 'persona_id' and c.udt_name = 'uuid'
       and c.table_name not in ('persone')
     order by c.table_name
  loop
    execute format('update public.%I set persona_id = $1 where persona_id = any($2)', r.table_name) using p_master_id, p_dupe_ids;
    get diagnostics n = row_count;
    if n > 0 then v_toccate := v_toccate || jsonb_build_object(r.table_name || '.persona_id', n); tot := tot + n; end if;
  end loop;

  -- i gruppi dichiarati «non sono duplicati» seguono la scheda
  update dedup_esclusioni e
     set persona_ids = (select array_agg(distinct case when x = any(p_dupe_ids) then p_master_id else x end) from unnest(e.persona_ids) x)
   where e.persona_ids && p_dupe_ids;

  -- doppi che l'unione puo' aver creato: si DICONO, non si cancellano (un'iscrizione porta un attestato)
  select count(*) into v_doppie from (select corso_id from s_corsi_iscritti where persona_id = p_master_id group by corso_id having count(*) > 1) x;
  if v_doppie > 0 then v_note := v_note || jsonb_build_object('da_guardare', 's_corsi_iscritti', 'corsi_con_due_iscrizioni', v_doppie); end if;
  select count(*) into v_doppie from (select impresa_id from persone_imprese where persona_id = p_master_id group by impresa_id having count(*) > 1) x;
  if v_doppie > 0 then v_note := v_note || jsonb_build_object('da_guardare', 'persone_imprese', 'imprese_con_due_rapporti', v_doppie); end if;

  -- prima i doppioni nel cestino: l'indice unico sul codice fiscale non lascerebbe ereditarlo
  update persone p set elimina = 1, updated_at = now(), updated_by = v_utente,
         note = concat_ws(E'\n', nullif(p.note, ''), format('Scheda unita a %s il %s da %s', p_master_id, to_char(now(), 'DD/MM/YYYY'), v_utente))
   where p.persona_id = any(p_dupe_ids);
  get diagnostics v_arch = row_count;

  update persone m set
    titolo = coalesce(nullif(m.titolo,''), d.titolo), cf = coalesce(nullif(m.cf,''), d.cf),
    email = coalesce(nullif(m.email,''), d.email), email2 = coalesce(nullif(m.email2,''), d.email2), email3 = coalesce(nullif(m.email3,''), d.email3),
    telefono = coalesce(nullif(m.telefono,''), d.telefono), telefono2 = coalesce(nullif(m.telefono2,''), d.telefono2),
    qualifica = coalesce(nullif(m.qualifica,''), d.qualifica), data_nascita = coalesce(m.data_nascita, d.data_nascita),
    comune_nascita = coalesce(nullif(m.comune_nascita,''), d.comune_nascita), sesso = coalesce(nullif(m.sesso,''), d.sesso),
    indirizzo = coalesce(nullif(m.indirizzo,''), d.indirizzo), comune_res = coalesce(nullif(m.comune_res,''), d.comune_res),
    prov_res = coalesce(nullif(m.prov_res,''), d.prov_res), cap_res = coalesce(nullif(m.cap_res,''), d.cap_res),
    cittadinanza = coalesce(nullif(m.cittadinanza,''), d.cittadinanza),
    ruoli = (select array_agg(distinct x) from unnest(coalesce(m.ruoli, '{}') || coalesce(d.ruoli, '{}')) x where x is not null and x <> ''),
    updated_at = now(), updated_by = v_utente
  from (select max(nullif(titolo,'')) titolo, max(nullif(cf,'')) cf, max(nullif(email,'')) email, max(nullif(email2,'')) email2,
               max(nullif(email3,'')) email3, max(nullif(telefono,'')) telefono, max(nullif(telefono2,'')) telefono2,
               max(nullif(qualifica,'')) qualifica, max(data_nascita) data_nascita, max(nullif(comune_nascita,'')) comune_nascita,
               max(nullif(sesso,'')) sesso, max(nullif(indirizzo,'')) indirizzo, max(nullif(comune_res,'')) comune_res,
               max(nullif(prov_res,'')) prov_res, max(nullif(cap_res,'')) cap_res, max(nullif(cittadinanza,'')) cittadinanza,
               (select array_agg(distinct x) from persone p2, unnest(coalesce(p2.ruoli, '{}')) x where p2.persona_id = any(p_dupe_ids)) ruoli
          from persone where persona_id = any(p_dupe_ids)) d
  where m.persona_id = p_master_id;

  insert into s_unioni_log (tipo, master_id, dupe_ids, utente, toccate, note, origine)
  values ('persona', p_master_id::text, (select array_agg(x::text) from unnest(p_dupe_ids) x), v_utente, v_toccate, v_note, 'fondi_persone');

  return jsonb_build_object('ok', true, 'master', p_master_id, 'schede_archiviate', v_arch,
                            'righe_spostate', tot, 'toccate', v_toccate, 'note', v_note);
end $$;

revoke execute on function public.fondi_persone(uuid, uuid[]) from public, anon;
grant  execute on function public.fondi_persone(uuid, uuid[]) to authenticated, service_role;

-- ============================================================================
-- CANTIERI
--   p_origine: 'unione' (doppioni scelti a mano o per CNCE) | 'riaggancio' (cantiere senza
--   CNCE riportato su quello codificato: qui i dati del provvisorio NON completano l'altro)
-- ============================================================================
create or replace function public.fondi_cantieri(p_master_id text, p_dupe_ids text[], p_origine text default 'unione')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_utente text := coalesce(auth.jwt() ->> 'email', 'sistema (' || session_user || ')');
  r        record;
  n        bigint;
  v_toccate jsonb := '{}'::jsonb;
  v_note   jsonb := '[]'::jsonb;
  tot      bigint := 0;
  v_arch   int;
  v_lotti  int;
  k        cantieri%rowtype;
  d        record;
begin
  if not public.s_unioni_autorizzato() then
    raise exception 'Operazione consentita solo alla segreteria';
  end if;
  if p_master_id is null or p_dupe_ids is null or array_length(p_dupe_ids,1) is null then
    raise exception 'Parametri mancanti';
  end if;
  p_dupe_ids := array(select distinct x from unnest(p_dupe_ids) x where x is not null and x <> p_master_id);
  if array_length(p_dupe_ids,1) is null then
    raise exception 'Nessun cantiere da unire (diverso da quello mantenuto)';
  end if;
  if not exists (select 1 from cantieri where cantiere_id = p_master_id) then
    raise exception 'Cantiere da mantenere inesistente';
  end if;
  if (select count(*) from cantieri where cantiere_id = any(p_dupe_ids)) <> array_length(p_dupe_ids,1) then
    raise exception 'Uno dei cantieri da unire non esiste';
  end if;
  -- i lotti di un complesso NON sono doppioni (regola dell'08/09/2026): ognuno ha i suoi rientri
  select count(distinct lower(trim(lotto))) into v_lotti from cantieri
   where cantiere_id = any(p_dupe_ids || p_master_id) and coalesce(trim(lotto), '') <> '';
  if v_lotti > 1 then
    raise exception 'Questi cantieri sono lotti diversi dello stesso complesso: non sono doppioni e non si uniscono';
  end if;

  perform set_config('app.incarico_sistema', '1', true);

  -- ogni colonna cantiere_id di public che NON punta ad a_cantiere (quelle sono i cantieri dell'asseverazione)
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and ((c.column_name = 'cantiere_id' and c.udt_name = 'text' and c.table_name <> 'cantieri')
            or (c.table_name = 'a_cantiere' and c.column_name = 'cantiere_gestionale_id'))
       and not exists (select 1 from pg_constraint con
                         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
                        where con.contype = 'f' and con.conrelid = format('public.%I', c.table_name)::regclass
                          and a.attname = c.column_name and con.confrelid <> 'public.cantieri'::regclass)
     order by c.table_name
  loop
    execute format('update public.%I set %I = $1 where %I = any($2)', r.table_name, r.column_name, r.column_name)
      using p_master_id, p_dupe_ids;
    get diagnostics n = row_count;
    if n > 0 then v_toccate := v_toccate || jsonb_build_object(r.table_name || '.' || r.column_name, n); tot := tot + n; end if;
  end loop;

  -- prima si archiviano i doppioni: due cantieri attivi con lo stesso CNCE il database li rifiuta
  update cantieri set elimina = 1, updated_at = now() where cantiere_id = any(p_dupe_ids);
  get diagnostics v_arch = row_count;

  -- il cantiere mantenuto eredita solo i campi che ha vuoti (nel riaggancio no: il provvisorio non e' una fonte)
  if p_origine <> 'riaggancio' then
    select * into k from cantieri where cantiere_id = p_master_id;
    select (array_agg(cantiere_committente_id) filter (where coalesce(cantiere_committente_id,'') <> ''))[1] cantiere_committente_id,
           (array_agg(cantiere_importo) filter (where cantiere_importo is not null))[1] cantiere_importo,
           (array_agg(cantiere_durata) filter (where cantiere_durata is not null))[1] cantiere_durata,
           (array_agg(cantiere_tip_int) filter (where cantiere_tip_int is not null))[1] cantiere_tip_int,
           (array_agg(cantiere_tip_ope) filter (where cantiere_tip_ope is not null))[1] cantiere_tip_ope,
           (array_agg(cantiere_tip_ope_altro) filter (where coalesce(cantiere_tip_ope_altro,'') <> ''))[1] cantiere_tip_ope_altro,
           (array_agg(cantiere_cap) filter (where coalesce(cantiere_cap,'') <> ''))[1] cantiere_cap,
           (array_agg(cantiere_comune_cod) filter (where coalesce(cantiere_comune_cod,'') <> ''))[1] cantiere_comune_cod,
           (array_agg(comune_nome) filter (where coalesce(comune_nome,'') <> ''))[1] comune_nome,
           (array_agg(data_ult) filter (where data_ult is not null))[1] data_ult,
           (array_agg(data_inizio_lavori) filter (where data_inizio_lavori is not null))[1] data_inizio_lavori,
           (array_agg(nodo_id) filter (where coalesce(nodo_id,'') <> ''))[1] nodo_id,
           (array_agg(cantiere_descrizione) filter (where coalesce(cantiere_descrizione,'') <> ''))[1] cantiere_descrizione,
           (array_agg(cantiere_cnce) filter (where coalesce(trim(cantiere_cnce),'') <> ''))[1] cantiere_cnce,
           (array_agg(cantiere_etichetta) filter (where coalesce(cantiere_etichetta,'') <> ''))[1] cantiere_etichetta,
           (array_agg(lotto) filter (where coalesce(trim(lotto),'') <> ''))[1] lotto,
           (array_agg(lat) filter (where lat is not null and lng is not null))[1] lat,
           (array_agg(lng) filter (where lat is not null and lng is not null))[1] lng
      into d from cantieri where cantiere_id = any(p_dupe_ids);

    update cantieri c set
      cantiere_committente_id = coalesce(nullif(c.cantiere_committente_id,''), d.cantiere_committente_id),
      cantiere_importo = coalesce(c.cantiere_importo, d.cantiere_importo),
      cantiere_durata = coalesce(c.cantiere_durata, d.cantiere_durata),
      cantiere_tip_int = coalesce(c.cantiere_tip_int, d.cantiere_tip_int),
      cantiere_tip_ope = coalesce(c.cantiere_tip_ope, d.cantiere_tip_ope),
      cantiere_tip_ope_altro = coalesce(nullif(c.cantiere_tip_ope_altro,''), d.cantiere_tip_ope_altro),
      cantiere_cap = coalesce(nullif(c.cantiere_cap,''), d.cantiere_cap),
      cantiere_comune_cod = coalesce(nullif(c.cantiere_comune_cod,''), d.cantiere_comune_cod),
      comune_nome = coalesce(nullif(c.comune_nome,''), d.comune_nome),
      data_ult = coalesce(c.data_ult, d.data_ult),
      data_inizio_lavori = coalesce(c.data_inizio_lavori, d.data_inizio_lavori),
      nodo_id = coalesce(nullif(c.nodo_id,''), d.nodo_id),
      cantiere_descrizione = coalesce(nullif(c.cantiere_descrizione,''), d.cantiere_descrizione),
      cantiere_cnce = coalesce(nullif(trim(c.cantiere_cnce),''), d.cantiere_cnce),
      cantiere_etichetta = coalesce(nullif(c.cantiere_etichetta,''), d.cantiere_etichetta),
      lotto = coalesce(nullif(trim(c.lotto),''), d.lotto)
    where c.cantiere_id = p_master_id;
    -- la posizione con una scrittura a parte: un trigger la azzera quando cambia l'indirizzo
    if k.lat is null or k.lng is null then
      update cantieri set lat = d.lat, lng = d.lng where cantiere_id = p_master_id and d.lat is not null;
    end if;
    if coalesce(trim(k.cantiere_cnce),'') = '' and d.cantiere_cnce is not null then
      v_note := v_note || jsonb_build_object('ereditato', 'cantiere_cnce', 'valore', d.cantiere_cnce);
    end if;
  end if;

  insert into s_unioni_log (tipo, master_id, dupe_ids, utente, toccate, note, origine)
  values ('cantiere', p_master_id, p_dupe_ids, v_utente, v_toccate, v_note, coalesce(p_origine, 'unione'));

  return jsonb_build_object('ok', true, 'master', p_master_id, 'cantieri_archiviati', v_arch,
                            'righe_spostate', tot, 'toccate', v_toccate, 'note', v_note);
end $$;

revoke execute on function public.fondi_cantieri(text, text[], text) from public, anon;
grant  execute on function public.fondi_cantieri(text, text[], text) to authenticated, service_role;
