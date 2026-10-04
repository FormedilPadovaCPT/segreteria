-- ============================================================
-- Unioni che sommano davvero (04/10/2026, segnalato dall'utente:
-- «quando unisco due o più imprese a me sembra che qualche dato si perda
-- e non nasca una impresa con tutti i contatti delle sommate» — visto
-- nell'unione di C.L.E.A. del 04/10 alle 12:22 — e «controlla anche
-- unione cantieri»).
--
-- fondi_imprese portava sulla principale 9 campi, solo se vuoti: un'email
-- diversa del doppione restava sulla scheda archiviata, e PEC, secondi
-- telefoni, cellulare, email 2 e 3, codici, note non passavano mai.
-- fondi_cantieri: la posizione precisa del doppione non passava se la
-- principale aveva quella approssimata (centro del comune), il civico
-- nemmeno, e un codice «da riclassificare» vinceva su quello vero.
--
-- Ora:
-- s_unisci_anagrafica_impresa: i recapiti si SOMMANO (email nei tre posti
--   email, telefoni nei tre posti telefono, PEC e cellulare nel loro),
--   senza doppioni (email senza maiuscole, telefoni per sole cifre); ogni
--   altro campo vuoto si riempie dal primo doppione che ce l'ha; quello che
--   non trova posto, o che è diverso, si scrive nelle note d'ufficio con la
--   scheda da cui viene. Un contatto riservato resta riservato.
-- s_unisci_anagrafica_cantiere: campi vuoti dal doppione; civico «SNC» e
--   codici non validi (5 «Altro», durata 7, importo 11) sostituiti da quelli
--   veri; posizione precisa del doppione se la principale non l'ha; le
--   differenze e una chiusura del doppione vanno nel registro dell'unione.
-- fondi_cantieri non unisce due cantieri con codici CNCE diversi: per la
--   Cassa Edile sono due cantieri, e le imprese previste sono legate al
--   codice (si perderebbe il legame).
-- ============================================================

create or replace function public.s_unisci_anagrafica_impresa(p_master text, p_dupes text[], p_quando text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m jsonb; d jsonb; did text;
  semplici_esclusi text[] := array['impresa_id','impresa_nome','elimina','created_at','updated_at','id_impacc',
    'data_agg_access','note_access','contatti_riservati',
    'impresa_email_ref','impresa_email2','impresa_email3','pec',
    'impresa_telefono','impresa_telefono2','tel_3','cellulare'];
  slot_mail text[] := array['impresa_email_ref','impresa_email2','impresa_email3'];
  slot_tel  text[] := array['impresa_telefono','impresa_telefono2','tel_3'];
  ris text[]; ris_d text[];
  cambiati text[] := '{}';
  extra text[]; righe_nota text[] := '{}';
  k text; v text; mv text; s text; posto text; gia boolean;
  nota_d text; blocco text; nota_m text;
begin
  select to_jsonb(i) into m from imprese i where impresa_id = p_master;
  if m is null then raise exception 'Impresa principale inesistente'; end if;
  ris := coalesce(array(select jsonb_array_elements_text(coalesce(m->'contatti_riservati','[]'::jsonb))), '{}');

  foreach did in array p_dupes loop
    select to_jsonb(i) into d from imprese i where impresa_id = did;
    continue when d is null or did = p_master;
    extra := '{}';
    ris_d := coalesce(array(select jsonb_array_elements_text(coalesce(d->'contatti_riservati','[]'::jsonb))), '{}');

    -- 1) campi semplici: il vuoto si riempie, il diverso si annota
    for k in select jsonb_object_keys(d) loop
      continue when k = any(semplici_esclusi);
      v := nullif(btrim(d->>k), '');
      continue when v is null;
      mv := nullif(btrim(m->>k), '');
      if mv is null then
        m := jsonb_set(m, array[k], d->k);
        cambiati := array_append(cambiati, k);
      elsif lower(mv) <> lower(v) and not (least(length(mv), length(v)) >= 15 and (position(lower(v) in lower(mv)) > 0 or position(lower(mv) in lower(v)) > 0)) then   -- un testo lungo contenuto nell'altro (nome tagliato) non è diverso; «Padova» e «Noventa Padovana» sì
        extra := array_append(extra, replace(k, '_', ' ') || ' «' || v || '»');
      end if;
    end loop;
    if lower(btrim(coalesce(d->>'impresa_nome',''))) not in (lower(btrim(coalesce(m->>'impresa_nome',''))), lower(btrim(coalesce(m->>'ragione_sociale2',''))), '')
       and position(lower(btrim(d->>'impresa_nome')) in lower(coalesce(m->>'impresa_nome','') || ' ' || coalesce(m->>'ragione_sociale2',''))) = 0 then
      extra := array_append(extra, 'nome «' || btrim(d->>'impresa_nome') || '»');
    end if;

    -- 2) email: si sommano nei tre posti email
    foreach s in array slot_mail loop
      v := nullif(btrim(d->>s), '');
      continue when v is null;
      select exists (select 1 from unnest(slot_mail || array['pec']) x where lower(btrim(coalesce(m->>x,''))) = lower(v)) into gia;
      continue when gia;
      posto := (select x from unnest(slot_mail) x where nullif(btrim(m->>x),'') is null limit 1);
      if posto is not null then
        m := jsonb_set(m, array[posto], to_jsonb(v));
        cambiati := array_append(cambiati, posto);
        if s = any(ris_d) and posto = any(array['impresa_email_ref','impresa_email2','impresa_email3','pec','impresa_telefono','impresa_telefono2']) and not posto = any(ris) then   -- il vincolo ammette solo questi ris := array_append(ris, posto); end if;
      else
        extra := array_append(extra, 'email «' || v || '»');
      end if;
    end loop;

    -- 3) PEC
    v := nullif(btrim(d->>'pec'), '');
    if v is not null then
      select exists (select 1 from unnest(slot_mail || array['pec']) x where lower(btrim(coalesce(m->>x,''))) = lower(v)) into gia;
      if not gia then
        if nullif(btrim(m->>'pec'),'') is null then
          m := jsonb_set(m, array['pec'], to_jsonb(v)); cambiati := array_append(cambiati, 'pec');
          if 'pec' = any(ris_d) and not 'pec' = any(ris) then ris := array_append(ris, 'pec'); end if;
        else
          extra := array_append(extra, 'PEC «' || v || '»');
        end if;
      end if;
    end if;

    -- 4) telefoni (si confrontano le sole cifre) e cellulare
    foreach s in array slot_tel || array['cellulare'] loop
      v := nullif(btrim(d->>s), '');
      continue when v is null or regexp_replace(v, '\D', '', 'g') = '';
      select exists (select 1 from unnest(slot_tel || array['cellulare']) x
                      where regexp_replace(coalesce(m->>x,''), '\D', '', 'g') = regexp_replace(v, '\D', '', 'g')) into gia;
      continue when gia;
      if s = 'cellulare' then
        posto := case when nullif(btrim(m->>'cellulare'),'') is null then 'cellulare' end;
      else
        posto := (select x from unnest(slot_tel) x where nullif(btrim(m->>x),'') is null limit 1);
      end if;
      if posto is not null then
        m := jsonb_set(m, array[posto], to_jsonb(v));
        cambiati := array_append(cambiati, posto);
        if s = any(ris_d) and posto = any(array['impresa_email_ref','impresa_email2','impresa_email3','pec','impresa_telefono','impresa_telefono2']) and not posto = any(ris) then   -- il vincolo ammette solo questi ris := array_append(ris, posto); end if;
      else
        extra := array_append(extra, case when s = 'cellulare' then 'cellulare' else 'telefono' end || ' «' || v || '»');
      end if;
    end loop;

    -- 5) la nota: ciò che non ha trovato posto, e le note d'ufficio del doppione
    nota_d := nullif(btrim(regexp_replace(coalesce(d->>'note_access',''), '(^|\n)Scheda unita a [^\n]*', '', 'g')), '');
    if array_length(extra, 1) is not null or nota_d is not null then
      blocco := 'Dalla scheda unita ' || did || coalesce(' (' || p_quando || ')', '') || ': '
        || coalesce(array_to_string(extra, '; '), '')
        || case when nota_d is not null then case when array_length(extra,1) is not null then '. ' else '' end || 'Note: ' || nota_d else '' end;
      righe_nota := array_append(righe_nota, blocco);
    end if;
  end loop;

  -- scrittura: solo i campi cambiati, ognuno col suo tipo
  foreach k in array coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}') loop
    execute format('update imprese set %1$I = (jsonb_populate_record(null::imprese, $1)).%1$I where impresa_id = $2', k)
      using m, p_master;
  end loop;
  update imprese set contatti_riservati = ris
   where impresa_id = p_master and coalesce(contatti_riservati, '{}') is distinct from ris;
  select note_access into nota_m from imprese where impresa_id = p_master;
  foreach blocco in array righe_nota loop
    if position(blocco in coalesce(nota_m, '')) = 0 then
      nota_m := concat_ws(E'\n', nullif(nota_m, ''), blocco);
    end if;
  end loop;
  update imprese set note_access = nota_m where impresa_id = p_master and note_access is distinct from nota_m;

  return jsonb_build_object('campi_riempiti', to_jsonb(coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}')),
                            'annotati', coalesce(array_length(righe_nota, 1), 0));
end
$function$;

create or replace function public.s_unisci_anagrafica_cantiere(p_master text, p_dupes text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m jsonb; d jsonb; did text; k text; v text; mv text;
  esclusi text[] := array['cantiere_id','elimina','created_at','updated_at','lat','lng','geocode_status','geocoded_at',
    'geocode_tentativi','cantiere_chiuso','data_chiusura','chiuso_da','motivo_chiusura','note_chiusura',
    'cantiere_civico','cantiere_tip_int','cantiere_tip_ope','cantiere_durata','cantiere_importo'];
  cambiati text[] := '{}';
  diff jsonb := '[]'::jsonb;
  c record;
  pos jsonb;          -- la prima posizione precisa ('ok') fra i doppioni
  gs text; la double precision;
  snc text := '^\s*(s\.?\s*n\.?\s*c\.?|snc|s/n|sn)?\s*$';
begin
  select to_jsonb(x) into m from cantieri x where cantiere_id = p_master;
  if m is null then raise exception 'Cantiere principale inesistente'; end if;
  foreach did in array p_dupes loop
    select to_jsonb(x) into d from cantieri x where cantiere_id = did;
    continue when d is null or did = p_master;
    for k in select jsonb_object_keys(d) loop
      continue when k = any(esclusi);
      v := nullif(btrim(d->>k), ''); continue when v is null;
      mv := nullif(btrim(m->>k), '');
      if mv is null then m := jsonb_set(m, array[k], d->k); cambiati := array_append(cambiati, k);
      elsif lower(mv) <> lower(v) then diff := diff || jsonb_build_object('da', did, 'campo', k, 'principale', mv, 'doppione', v);
      end if;
    end loop;
    -- civico: «SNC» o vuoto non vale un numero vero
    v := nullif(btrim(d->>'cantiere_civico'), '');
    if v is not null and v !~* snc then
      if coalesce(m->>'cantiere_civico','') ~* snc then
        m := jsonb_set(m, '{cantiere_civico}', to_jsonb(v)); cambiati := array_append(cambiati, 'cantiere_civico');
      elsif lower(btrim(m->>'cantiere_civico')) <> lower(v) then
        diff := diff || jsonb_build_object('da', did, 'campo', 'cantiere_civico', 'principale', m->>'cantiere_civico', 'doppione', v);
      end if;
    end if;
    -- codici: un valore non valido («Altro», «non disponibile») cede a quello vero
    for c in select * from (values ('cantiere_tip_int',1,4),('cantiere_tip_ope',1,16),('cantiere_durata',1,6),('cantiere_importo',1,10)) t(col,lo,hi) loop
      v := d->>c.col; continue when v is null;
      mv := m->>c.col;
      if v::int between c.lo and c.hi and (mv is null or mv::int not between c.lo and c.hi) then
        m := jsonb_set(m, array[c.col], d->c.col); cambiati := array_append(cambiati, c.col);
      elsif mv is not null and v <> mv then
        diff := diff || jsonb_build_object('da', did, 'campo', c.col, 'principale', mv, 'doppione', v);
      end if;
    end loop;
    -- posizione: quella precisa del doppione se la principale non l'ha
    if pos is null and d->>'geocode_status' = 'ok' and d->>'lat' is not null and d->>'lng' is not null then
      pos := jsonb_build_object('lat', d->'lat', 'lng', d->'lng', 'geocoded_at', d->'geocoded_at');
    end if;
    -- chiusura del doppione: non si copia (la principale vive), si registra
    if coalesce((d->>'cantiere_chiuso')::boolean, false) and not coalesce((m->>'cantiere_chiuso')::boolean, false) then
      diff := diff || jsonb_build_object('da', did, 'campo', 'chiusura', 'doppione',
        concat_ws(' · ', 'chiuso il ' || to_char((d->>'data_chiusura')::timestamptz, 'DD/MM/YYYY'), d->>'motivo_chiusura', d->>'note_chiusura'));
    end if;
  end loop;
  foreach k in array coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}') loop
    execute format('update cantieri set %1$I = (jsonb_populate_record(null::cantieri, $1)).%1$I where cantiere_id = $2', k)
      using m, p_master;
  end loop;
  /* la posizione si scrive DOPO, in un aggiornamento a sé: cambiare civico o indirizzo la
     azzera (trg_reset_geocode), e quella precisa del doppione vale per il suo indirizzo */
  select geocode_status, lat into gs, la from cantieri where cantiere_id = p_master;
  if pos is not null and (coalesce(gs, '') <> 'ok' or la is null) then
    update cantieri set lat = (pos->>'lat')::double precision, lng = (pos->>'lng')::double precision,
           geocode_status = 'ok', geocoded_at = (pos->>'geocoded_at')::timestamptz
     where cantiere_id = p_master;
    cambiati := array_append(cambiati, 'posizione');
  end if;
  return jsonb_build_object('campi_riempiti', to_jsonb(coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}')), 'differenze', diff);
end
$function$;

revoke all on function public.s_unisci_anagrafica_impresa(text, text[], text) from public, anon, authenticated;
revoke all on function public.s_unisci_anagrafica_cantiere(text, text[]) from public, anon, authenticated;

-- fondi_imprese: al posto dei 9 campi, la somma vera (il resto non cambia)
do $do$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.fondi_imprese(text,text[])'::regprocedure);
  nuovo := regexp_replace(src,
    'update imprese m set\s+piva\s+=.*?where m\.impresa_id = p_master_id;',
    'v_anag := public.s_unisci_anagrafica_impresa(p_master_id, p_dupe_ids, to_char(now(), ''DD/MM/YYYY''));
 v_note := v_note || jsonb_build_object(''anagrafica'', v_anag);');
  if nuovo = src then raise exception 'fondi_imprese: blocco dei 9 campi non trovato, niente cambiato'; end if;
  nuovo := replace(nuovo, E' v_arch    int;', E' v_arch    int;\n v_anag    jsonb;');
  if position('v_anag    jsonb;' in nuovo) = 0 then raise exception 'fondi_imprese: dichiarazione non inserita'; end if;
  execute nuovo;
end
$do$;

-- fondi_cantieri: niente unione fra CNCE diversi; i campi si sommano con s_unisci_anagrafica_cantiere
CREATE OR REPLACE FUNCTION public.fondi_cantieri(p_master_id text, p_dupe_ids text[], p_origine text DEFAULT 'unione'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_utente text := coalesce(auth.jwt() ->> 'email', 'sistema (' || session_user || ')');
 r        record;
 n        bigint;
 v_toccate jsonb := '{}'::jsonb;
 v_note   jsonb := '[]'::jsonb;
 tot      bigint := 0;
 v_arch   int;
 v_lotti  int;
 v_cnce   text;
 v_anag   jsonb;
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
 select count(distinct lower(trim(lotto))) into v_lotti from cantieri
 where cantiere_id = any(p_dupe_ids || p_master_id) and coalesce(trim(lotto), '') <> '';
 if v_lotti > 1 then
 raise exception 'Questi cantieri sono lotti diversi dello stesso complesso: non sono doppioni e non si uniscono';
 end if;
 -- 04/10/2026: due codici CNCE diversi = due cantieri per la Cassa Edile; le imprese previste
 -- sono legate al codice, e unendo se ne perderebbe il legame
 select string_agg(distinct upper(trim(cantiere_cnce)), ', ') into v_cnce from cantieri
 where cantiere_id = any(p_dupe_ids || p_master_id) and coalesce(trim(cantiere_cnce), '') <> '';
 if v_cnce like '%,%' and coalesce(p_origine, 'unione') <> 'riaggancio' then
 raise exception 'Questi cantieri hanno codici CNCE diversi (%): per la Cassa Edile sono due cantieri, e unendoli si perderebbe il legame con le imprese previste. Non si uniscono.', v_cnce;
 end if;
 perform set_config('app.incarico_sistema', '1', true);
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
 update cantieri set elimina = 1, updated_at = now() where cantiere_id = any(p_dupe_ids);
 get diagnostics v_arch = row_count;
 if coalesce(p_origine, 'unione') <> 'riaggancio' then
 v_anag := public.s_unisci_anagrafica_cantiere(p_master_id, p_dupe_ids);
 v_note := v_note || jsonb_build_object('anagrafica', v_anag);
 end if;
 insert into s_unioni_log (tipo, master_id, dupe_ids, utente, toccate, note, origine)
 values ('cantiere', p_master_id, p_dupe_ids, v_utente, v_toccate, v_note, coalesce(p_origine, 'unione'));
 return jsonb_build_object('ok', true, 'master', p_master_id, 'cantieri_archiviati', v_arch,
 'righe_spostate', tot, 'toccate', v_toccate, 'note', v_note);
end $function$;

-- RECUPERO delle unioni già fatte (eseguito il 04/10/2026, una volta sola): copia delle schede
-- principali in archivio.bk_2026_10_04_unioni_imprese / _cantieri, esito per unione in
-- archivio.recupero_unioni_2026_10_04. Solo aggiunte: campi vuoti, recapiti nei posti liberi, note.
--   for l in select ... from s_unioni_log where tipo in ('impresa','cantiere') order by id loop
--     s_unisci_anagrafica_impresa(master, dupe_ids, data dell'unione) / s_unisci_anagrafica_cantiere(...)
