-- ============================================================
-- Unioni di persone e committenti che sommano (04/10/2026): stesso difetto
-- trovato nelle imprese (2026_10_04_unioni_che_sommano.sql). fondi_persone
-- portava i campi del doppione solo se vuoti sulla principale (un'email o
-- un telefono diverso restava sulla scheda archiviata); fondi_committenti
-- idem, e in più non scriveva nel registro s_unioni_log.
-- ============================================================

create or replace function public.s_unisci_anagrafica_persona(p_master uuid, p_dupes uuid[], p_quando text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m jsonb; d jsonb; did uuid;
  esclusi text[] := array['persona_id','nome','cognome','elimina','created_at','updated_at','updated_by','note',
    'contatti_riservati','ruoli','email','email2','email3','telefono','telefono2'];
  slot_mail text[] := array['email','email2','email3'];
  slot_tel  text[] := array['telefono','telefono2'];
  ammessi text[] := array['email','email2','email3','telefono','telefono2'];
  ris text[]; ris_d text[];
  cambiati text[] := '{}';
  extra text[]; righe_nota text[] := '{}';
  k text; v text; mv text; s text; posto text; gia boolean;
  nota_d text; blocco text; nota_m text; nome_d text; nome_m text;
begin
  select to_jsonb(p) into m from persone p where persona_id = p_master;
  if m is null then raise exception 'Scheda principale inesistente'; end if;
  ris := coalesce(array(select jsonb_array_elements_text(coalesce(m->'contatti_riservati','[]'::jsonb))), '{}');
  nome_m := lower(btrim(concat_ws(' ', m->>'cognome', m->>'nome')));

  foreach did in array p_dupes loop
    select to_jsonb(p) into d from persone p where persona_id = did;
    continue when d is null or did = p_master;
    extra := '{}';
    ris_d := coalesce(array(select jsonb_array_elements_text(coalesce(d->'contatti_riservati','[]'::jsonb))), '{}');

    for k in select jsonb_object_keys(d) loop
      continue when k = any(esclusi);
      v := nullif(btrim(d->>k), ''); continue when v is null;
      mv := nullif(btrim(m->>k), '');
      if mv is null then
        m := jsonb_set(m, array[k], d->k); cambiati := array_append(cambiati, k);
      elsif lower(mv) <> lower(v) then
        extra := array_append(extra, replace(k, '_', ' ') || ' «' || v || '»');
      end if;
    end loop;
    nome_d := btrim(concat_ws(' ', d->>'cognome', d->>'nome'));
    if nome_d <> '' and lower(nome_d) <> nome_m then extra := array_append(extra, 'nome «' || nome_d || '»'); end if;

    foreach s in array slot_mail loop
      v := nullif(btrim(d->>s), ''); continue when v is null;
      select exists (select 1 from unnest(slot_mail) x where lower(btrim(coalesce(m->>x,''))) = lower(v)) into gia;
      continue when gia;
      posto := (select x from unnest(slot_mail) x where nullif(btrim(m->>x),'') is null limit 1);
      if posto is not null then
        m := jsonb_set(m, array[posto], to_jsonb(v)); cambiati := array_append(cambiati, posto);
        if s = any(ris_d) and posto = any(ammessi) and not posto = any(ris) then ris := array_append(ris, posto); end if;
      else
        extra := array_append(extra, 'email «' || v || '»');
      end if;
    end loop;

    foreach s in array slot_tel loop
      v := nullif(btrim(d->>s), '');
      continue when v is null or regexp_replace(v, '\D', '', 'g') = '';
      select exists (select 1 from unnest(slot_tel) x
                      where regexp_replace(coalesce(m->>x,''), '\D', '', 'g') = regexp_replace(v, '\D', '', 'g')) into gia;
      continue when gia;
      posto := (select x from unnest(slot_tel) x where nullif(btrim(m->>x),'') is null limit 1);
      if posto is not null then
        m := jsonb_set(m, array[posto], to_jsonb(v)); cambiati := array_append(cambiati, posto);
        if s = any(ris_d) and posto = any(ammessi) and not posto = any(ris) then ris := array_append(ris, posto); end if;
      else
        extra := array_append(extra, 'telefono «' || v || '»');
      end if;
    end loop;

    nota_d := nullif(btrim(regexp_replace(coalesce(d->>'note',''), '(^|\n)Scheda unita a [^\n]*', '', 'g')), '');
    if array_length(extra, 1) is not null or nota_d is not null then
      righe_nota := array_append(righe_nota, 'Dalla scheda unita ' || left(did::text, 8) || coalesce(' (' || p_quando || ')', '') || ': '
        || coalesce(array_to_string(extra, '; '), '')
        || case when nota_d is not null then case when array_length(extra,1) is not null then '. ' else '' end || 'Note: ' || nota_d else '' end);
    end if;
  end loop;

  foreach k in array coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}') loop
    execute format('update persone set %1$I = (jsonb_populate_record(null::persone, $1)).%1$I where persona_id = $2', k)
      using m, p_master;
  end loop;
  update persone set contatti_riservati = ris
   where persona_id = p_master and coalesce(contatti_riservati, '{}') is distinct from ris;
  update persone set ruoli = (select coalesce(array_agg(distinct x), '{}') from persone p2, unnest(coalesce(p2.ruoli, '{}')) x
                               where p2.persona_id = any(p_dupes || p_master) and x is not null and x <> '')
   where persona_id = p_master;
  select note into nota_m from persone where persona_id = p_master;
  foreach blocco in array righe_nota loop
    if position(blocco in coalesce(nota_m, '')) = 0 then nota_m := concat_ws(E'\n', nullif(nota_m, ''), blocco); end if;
  end loop;
  update persone set note = nota_m where persona_id = p_master and note is distinct from nota_m;
  return jsonb_build_object('campi_riempiti', to_jsonb(coalesce((select array_agg(distinct x) from unnest(cambiati) x), '{}')),
                            'annotati', coalesce(array_length(righe_nota, 1), 0));
end
$function$;
revoke all on function public.s_unisci_anagrafica_persona(uuid, uuid[], text) from public, anon, authenticated;

-- fondi_persone: la somma vera al posto del blocco «solo se vuoto»
do $do$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.fondi_persone(uuid,uuid[])'::regprocedure);
  nuovo := regexp_replace(src,
    'update persone m set\s+titolo\s+=.*?where m\.persona_id = p_master_id;',
    'v_note := v_note || jsonb_build_object(''anagrafica'', public.s_unisci_anagrafica_persona(p_master_id, p_dupe_ids, to_char(now(), ''DD/MM/YYYY'')));
 update persone set updated_at = now(), updated_by = v_utente where persona_id = p_master_id;');
  if nuovo = src then raise exception 'fondi_persone: blocco non trovato, niente cambiato'; end if;
  execute nuovo;
end
$do$;

-- il registro delle unioni accetta anche i committenti
alter table public.s_unioni_log drop constraint s_unioni_log_tipo_check;
alter table public.s_unioni_log add constraint s_unioni_log_tipo_check check (tipo = any (array['impresa','persona','cantiere','committente']));

-- fondi_committenti: email e telefono diversi non si perdono in silenzio (il committente ha un
-- posto solo per ciascuno: quello del doppione va nel registro), e l'unione si registra
CREATE OR REPLACE FUNCTION public.fondi_committenti(p_master_id text, p_dupe_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := auth.jwt() ->> 'email';
  v_master_nome text; v_dupe_nomi text[]; v_cant int; v_vis int := 0; v_arch int;
  m committenti%rowtype; d record; v_diff jsonb := '[]'::jsonb;
begin
  if not public.is_segreteria() then raise exception 'Operazione consentita solo alla segreteria'; end if;
  if p_master_id is null or p_dupe_ids is null or array_length(p_dupe_ids,1) is null then raise exception 'Parametri mancanti'; end if;
  p_dupe_ids := array(select unnest(p_dupe_ids) except select p_master_id);
  if array_length(p_dupe_ids,1) is null then raise exception 'Nessun committente da unire diverso dal principale'; end if;
  if not exists (select 1 from committenti where committente_id = p_master_id) then raise exception 'Committente principale inesistente'; end if;
  select committente_nome into v_master_nome from committenti where committente_id = p_master_id;
  select array_agg(committente_nome) into v_dupe_nomi from committenti where committente_id = any(p_dupe_ids);
  update cantieri set cantiere_committente_id = p_master_id where cantiere_committente_id = any(p_dupe_ids);
  get diagnostics v_cant = row_count;
  if v_master_nome is not null and v_dupe_nomi is not null then
    update visite set comm_rag_soc = v_master_nome where comm_rag_soc = any(v_dupe_nomi) and comm_rag_soc is distinct from v_master_nome;
    get diagnostics v_vis = row_count;
  end if;
  -- campo per campo, nell'ordine dei doppioni: il vuoto si riempie, il diverso si registra
  for d in select * from committenti where committente_id = any(p_dupe_ids) order by array_position(p_dupe_ids, committente_id) loop
    select * into m from committenti where committente_id = p_master_id;
    update committenti set
      cf_piva = coalesce(nullif(m.cf_piva,''), d.cf_piva),
      piva = coalesce(nullif(m.piva,''), d.piva),
      email = coalesce(nullif(m.email,''), d.email),
      telefono = coalesce(nullif(m.telefono,''), d.telefono),
      tipo_sogg = coalesce(nullif(m.tipo_sogg,''), d.tipo_sogg),
      committente_tipo = coalesce(m.committente_tipo, d.committente_tipo)
    where committente_id = p_master_id;
    if nullif(m.email,'') is not null and nullif(d.email,'') is not null and lower(btrim(m.email)) <> lower(btrim(d.email)) then
      v_diff := v_diff || jsonb_build_object('da', d.committente_id, 'campo', 'email', 'valore', d.email); end if;
    if nullif(m.telefono,'') is not null and nullif(d.telefono,'') is not null
       and regexp_replace(m.telefono, '\D', '', 'g') <> regexp_replace(d.telefono, '\D', '', 'g') then
      v_diff := v_diff || jsonb_build_object('da', d.committente_id, 'campo', 'telefono', 'valore', d.telefono); end if;
  end loop;
  update committenti set elimina = 1 where committente_id = any(p_dupe_ids);
  get diagnostics v_arch = row_count;
  insert into s_unioni_log (tipo, master_id, dupe_ids, utente, toccate, note, origine)
  values ('committente', p_master_id, p_dupe_ids, coalesce(v_email, 'sistema'),
          jsonb_build_object('cantieri.cantiere_committente_id', v_cant, 'visite.comm_rag_soc', v_vis),
          case when jsonb_array_length(v_diff) > 0 then jsonb_build_array(jsonb_build_object('recapiti_non_entrati', v_diff)) else '[]'::jsonb end,
          'fondi_committenti');
  return jsonb_build_object('ok', true, 'master', p_master_id, 'committenti_archiviati', v_arch,
    'cantieri_spostati', v_cant, 'visite_normalizzate', v_vis, 'recapiti_non_entrati', v_diff);
end
$function$;

-- RECUPERO delle 8 unioni di persone già fatte (04/10/2026, una volta sola; copia in
-- archivio.bk_2026_10_04_unioni_persone)
