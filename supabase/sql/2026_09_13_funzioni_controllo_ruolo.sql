-- =============================================================================
--  FUNZIONI SECURITY DEFINER: controllo di ruolo dove mancava (13/09/2026)
-- -----------------------------------------------------------------------------
--  L'advisor di Supabase segnalava 51 funzioni security definer eseguibili da
--  qualunque utente autenticato. La registrazione e' chiusa (disable_signup =
--  true, verificato il 13/09/2026): «autenticato» vuol dire uno dei 12 account
--  creati dalla segreteria. Una security definer gira come proprietario e
--  SCAVALCA la RLS, quindi il controllo deve farlo lei. Revisione una per una:
--
--  - 24 sono i controlli di ruolo (is_personale, is_segreteria, a_my_role...):
--    servono alle policy e devono restare eseguibili. Avviso accettato.
--  - Le funzioni che scrivono hanno gia' il controllo in testa (raise
--    exception), verificato leggendo il codice. Fa eccezione incarichi_ricalcola,
--    senza controllo: la chiamano solo il trigger su visite e incarichi_import,
--    entrambi security definer, e nessuna app -> via il permesso agli utenti.
--  - s_scheda_impresa e s_stat_protocollo filtrano gia' con is_segreteria() in
--    fondo alla query: a posto.
--  - 7 funzioni leggono da visite e committenti, che la RLS apre al solo
--    personale: ora filtrano con (select public.is_personale()), valutata una
--    volta sola per chiamata. Per il personale (viewer compresi) il risultato non
--    cambia; per chiunque altro nessuna riga.
--  - s_redazione_materia legge protocollo, post e corsi (RLS: sola segreteria):
--    diventa un involucro che ammette la segreteria o la chiave di servizio (la
--    routine social passa da redazione-social) e chiama s_redazione_materia_interna.
--    Stesso schema di s_prestazioni_calcola / s_prestazioni_calcola_interna.
--  - Nessuna app le chiama, tolto il permesso agli utenti: ricontrolli_pendenti
--    (la usa il promemoria del lunedi' con la chiave di servizio), s_tariffa e
--    s_regime_tecnico (le usa s_prestazioni_calcola_interna, che e' security
--    definer), s_prossimo_numero, incarichi_ricalcola, a_gdv_sync_pratica (e' una
--    funzione di trigger: il trigger scatta lo stesso).
--  - Restano aperte di proposito comune_cap_prov e sesso_da_nome: le chiamano i
--    trigger di completamento anagrafica, che girano coi permessi di chi inserisce
--    (tecnici e segreteria), e restituiscono solo CAP/provincia e M/F.
--
--  Prove in tests-db/03_rls_personale.sql. Applicata su Supabase come migrazione
--  funzioni_controllo_ruolo_2026_09_13.
-- =============================================================================

-- ── 1. Letture sul personale: stesso filtro della RLS di visite e committenti ──

CREATE OR REPLACE FUNCTION public.dash_macroaree(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text)
 RETURNS TABLE(zona integer, nc_plus bigint, nc_minus bigint, oss bigint, ver bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cv.zona_osserv::int as zona,
    count(*) filter (where vc.valore = 'NC+') as nc_plus,
    count(*) filter (where vc.valore = 'NC-') as nc_minus,
    count(*) filter (where vc.valore = 'OSS') as oss,
    count(*) filter (where vc.valore = 'VER') as ver
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  where (select public.is_personale()) and v.elimina is distinct from 1
    and cv.zona_osserv between 1 and 10
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by cv.zona_osserv
  order by cv.zona_osserv;
$function$;

CREATE OR REPLACE FUNCTION public.dash_macroaree_dettaglio(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text, p_zona integer DEFAULT NULL::integer, p_esito text DEFAULT NULL::text)
 RETURNS TABLE(visita_id text, data_visita date, nr_verbale text, comune text, cantiere_label text, impresa text, tecnico text, acc text, ipc text, n_rilievi bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.visita_id, v.data_visita, v.nr_verbale,
    c.comune_nome as comune,
    coalesce(nullif(btrim(concat_ws(' ', c.cantiere_indirizzo, c.cantiere_civico)),''), c.cantiere_etichetta, c.comune_nome) as cantiere_label,
    ip.impresa_nome as impresa,
    btrim(concat_ws(' ', t.tecnico_cognome, t.tecnico_nome)) as tecnico,
    v.acc_cant as acc,
    (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) as ipc,
    count(*) as n_rilievi
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  left join cantieri c on c.cantiere_id = v.cantiere_id
  left join tecnici t on t.tecnico_id = v.tecnico_id
  left join lateral (
    select i.impresa_nome
    from visite_imprese_presenti vip
    join imprese i on i.impresa_id = vip.impresa_id
    where vip.visita_id = v.visita_id
    order by vip.is_principale desc nulls last
    limit 1
  ) ip on true
  where (select public.is_personale()) and v.elimina is distinct from 1
    and cv.zona_osserv = p_zona
    and vc.valore = p_esito
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by v.visita_id, v.data_visita, v.nr_verbale, c.comune_nome,
    c.cantiere_indirizzo, c.cantiere_civico, c.cantiere_etichetta, ip.impresa_nome,
    t.tecnico_cognome, t.tecnico_nome, v.acc_cant, v.ipc
  order by count(*) desc, v.data_visita desc;
$function$;

CREATE OR REPLACE FUNCTION public.dash_ver_visite(p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_tecnico text DEFAULT NULL::text, p_tipo integer DEFAULT NULL::integer, p_ipc text DEFAULT NULL::text)
 RETURNS TABLE(visita_id text, ver bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select v.visita_id, count(*) filter (where vc.valore='VER') as ver
  from visite v
  join visite_checklist vc on vc.visita_id = v.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  where (select public.is_personale()) and v.elimina is distinct from 1
    and cv.zona_osserv between 1 and 10
    and (p_da is null or v.data_visita >= p_da)
    and (p_a is null or v.data_visita <= p_a)
    and (p_tecnico is null or v.tecnico_id::text = p_tecnico)
    and (p_tipo is null or v.tipo_accesso = p_tipo)
    and (p_ipc is null or (case when v.ipc in ('ALTO','MEDIO','BASSO') then v.ipc else 'NR' end) = p_ipc)
  group by v.visita_id;
$function$;

CREATE OR REPLACE FUNCTION public.visite_count_map()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(cantiere_id, n),'{}'::jsonb)
  from (
    select cantiere_id, count(*)::int n
    from visite
    where (select public.is_personale()) and coalesce(elimina,0)=0 and cantiere_id is not null
    group by cantiere_id
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.committenti_lista(p_search text DEFAULT NULL::text)
 RETURNS TABLE(committente_id text, committente_nome text, tipo_sogg text, committente_tipo smallint, cf_piva text, piva text, email text, telefono text, n_cantieri integer, n_visite integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cc as (
    select cantiere_committente_id cid, count(*)::int n
    from cantieri where cantiere_committente_id is not null and cantiere_committente_id<>'' group by 1
  ),
  cv as (
    select c.cantiere_committente_id cid, count(*)::int n
    from visite v join cantieri c on c.cantiere_id=v.cantiere_id
    where c.cantiere_committente_id is not null and c.cantiere_committente_id<>'' group by 1
  )
  select k.committente_id,k.committente_nome,k.tipo_sogg,k.committente_tipo,k.cf_piva,k.piva,k.email,k.telefono,
         coalesce(cc.n,0), coalesce(cv.n,0)
  from committenti k
  left join cc on cc.cid=k.committente_id
  left join cv on cv.cid=k.committente_id
  where (select public.is_personale()) and coalesce(k.elimina,0)=0
    and (coalesce(p_search,'')=''
         or k.committente_nome ilike '%'||p_search||'%'
         or k.committente_id ilike '%'||p_search||'%'
         or coalesce(k.cf_piva,'') ilike '%'||p_search||'%'
         or coalesce(k.piva,'') ilike '%'||p_search||'%')
  order by k.committente_nome
  limit 5000;
$function$;

CREATE OR REPLACE FUNCTION public.committenti_duplicati()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cc as (
    select cantiere_committente_id cid, count(*)::int n
    from cantieri where cantiere_committente_id is not null and cantiere_committente_id<>'' group by 1
  ),
  cv as (
    select c.cantiere_committente_id cid, count(*)::int n
    from visite v join cantieri c on c.cantiere_id=v.cantiere_id
    where c.cantiere_committente_id is not null and c.cantiere_committente_id<>'' group by 1
  ),
  nm as (
    select committente_id id, committente_nome nome, coalesce(cf_piva,piva) cfp, tipo_sogg,
           upper(regexp_replace(coalesce(committente_nome,''),'[^a-zA-Z0-9]','','g')) nn
    from committenti where (select public.is_personale()) and coalesce(elimina,0)=0 and coalesce(committente_nome,'')<>''
  ),
  dupnn as (select nn from nm where nn<>'' group by nn having count(*)>1),
  ident as (
    select m.nn gkey,
      jsonb_agg(jsonb_build_object('id',m.id,'nome',m.nome,'cfp',m.cfp,'tipo_sogg',m.tipo_sogg,
        'n_cantieri',coalesce(cc.n,0),'n_visite',coalesce(cv.n,0)) order by m.nome) membri
    from nm m join dupnn d on d.nn=m.nn
    left join cc on cc.cid=m.id left join cv on cv.cid=m.id
    group by m.nn
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo','identico','key',gkey,'membri',membri) order by gkey),'[]'::jsonb) from ident;
$function$;

CREATE OR REPLACE FUNCTION public.committenti_simili(p_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v jsonb; v_nome text;
begin
  if not public.is_personale() then return '[]'::jsonb; end if;
  perform set_config('pg_trgm.similarity_threshold','0.5',true);
  select committente_nome into v_nome from committenti where committente_id=p_id;
  if v_nome is null then return '[]'::jsonb; end if;
  with cc as (select cantiere_committente_id cid, count(*)::int n from cantieri where cantiere_committente_id is not null and cantiere_committente_id<>'' group by 1),
       cv as (select c.cantiere_committente_id cid, count(*)::int n from visite v join cantieri c on c.cantiere_id=v.cantiere_id where c.cantiere_committente_id is not null and c.cantiere_committente_id<>'' group by 1),
       sim as (
         select b.committente_id id, b.committente_nome nome, coalesce(b.cf_piva,b.piva) cfp, b.tipo_sogg,
                round(similarity(v_nome,b.committente_nome)::numeric,2) s
         from committenti b
         where coalesce(b.elimina,0)=0 and b.committente_id<>p_id and b.committente_nome % v_nome
         order by similarity(v_nome,b.committente_nome) desc limit 25
       )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'nome',nome,'cfp',cfp,'tipo_sogg',tipo_sogg,
           'sim',s,'n_cantieri',coalesce(cc.n,0),'n_visite',coalesce(cv.n,0)) order by s desc),'[]'::jsonb)
  into v from sim left join cc on cc.cid=sim.id left join cv on cv.cid=sim.id;
  return v;
end $function$;

-- ── 2. s_redazione_materia: involucro con controllo, corpo invariato in _interna ──

alter function public.s_redazione_materia(integer) rename to s_redazione_materia_interna;
revoke execute on function public.s_redazione_materia_interna(integer) from public, anon, authenticated;
comment on function public.s_redazione_materia_interna(integer) is
  'Corpo di s_redazione_materia (aggregati per la redazione social). Non si chiama direttamente: passa da s_redazione_materia, che controlla il ruolo. 13/09/2026.';

create or replace function public.s_redazione_materia(p_mesi integer default 12)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $function$
begin
  if not (public.is_segreteria() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Non autorizzato';
  end if;
  return public.s_redazione_materia_interna(p_mesi);
end
$function$;
revoke execute on function public.s_redazione_materia(integer) from public, anon;
grant execute on function public.s_redazione_materia(integer) to authenticated, service_role;
comment on function public.s_redazione_materia(integer) is
  'Materia della redazione social: segreteria dall''app (vista Comunicazione) o chiave di servizio (funzione redazione-social). Controllo aggiunto il 13/09/2026.';

-- ── 3. Nessuna app le chiama: permesso solo alla chiave di servizio ──

revoke execute on function public.ricontrolli_pendenti(integer)      from public, anon, authenticated;
revoke execute on function public.s_tariffa(text, date, text)         from public, anon, authenticated;
revoke execute on function public.s_regime_tecnico(text, date)        from public, anon, authenticated;
revoke execute on function public.s_prossimo_numero(text)             from public, anon, authenticated;
revoke execute on function public.incarichi_ricalcola(bigint, text)   from public, anon, authenticated;
revoke execute on function public.a_gdv_sync_pratica()                from public, anon, authenticated;

grant execute on function public.ricontrolli_pendenti(integer)    to service_role;
grant execute on function public.s_tariffa(text, date, text)       to service_role;
grant execute on function public.s_regime_tecnico(text, date)      to service_role;
grant execute on function public.s_prossimo_numero(text)           to service_role;
grant execute on function public.incarichi_ricalcola(bigint, text) to service_role;
