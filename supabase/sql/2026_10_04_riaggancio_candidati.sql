-- ============================================================
-- Riaggancio cantieri senza CNCE (04/10/2026): il pannello del gestionale
-- («Qualità dati») cercava i candidati dal browser, cantiere per cantiere:
-- con 2.017 cantieri senza codice erano decine di migliaia di letture una
-- dopo l'altra, e la pagina restava su «Caricamento…». Nessun riaggancio è
-- mai stato fatto (s_unioni_log, origine 'riaggancio': zero righe).
-- La stessa ricerca (ultima parola significativa dell'indirizzo, stesso
-- comune, solo cantieri con CNCE) ora la fa il database in un colpo solo,
-- e restituisce solo i cantieri che hanno almeno un candidato.
-- ============================================================

create or replace function public.s_riaggancio_chiave(p_ind text)
returns text
language sql
immutable
as $function$
  select (array_agg(w order by n desc))[1]
    from unnest(regexp_split_to_array(
           btrim(regexp_replace(regexp_replace(
             translate(lower(coalesce(p_ind, '')), 'àáâäèéêëìíîïòóôöùúûüç', 'aaaaeeeeiiiioooouuuuc'),
             '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')), ' ')) with ordinality t(w, n)
   where length(w) > 2
     and w <> all (array['via','viale','vle','piazza','pzza','pza','corso','cso','vicolo','largo','strada','str',
       'localita','loc','borgo','contra','contrada','riviera','lungargine','passaggio','salita','calle','stradella',
       'snc','del','della','dei','delle','san','santa','santo'])
$function$;

create or replace function public.s_riaggancio_candidati()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with senza as materialized (
    select c.cantiere_id, c.cantiere_indirizzo, c.cantiere_civico, c.comune_nome, c.cantiere_etichetta,
           c.cantiere_comune_cod, c.cantiere_committente_id, public.s_riaggancio_chiave(c.cantiere_indirizzo) as chiave
      from cantieri c
     where c.elimina = 0 and nullif(btrim(c.cantiere_cnce), '') is null
  ),
  con as materialized (
    select x.cantiere_id, x.cantiere_indirizzo, x.cantiere_civico, x.cantiere_cnce, x.cantiere_etichetta,
           x.cantiere_chiuso, x.cantiere_committente_id, x.cantiere_comune_cod, x.comune_nome
      from cantieri x
     where x.elimina = 0 and nullif(btrim(x.cantiere_cnce), '') is not null
  ),
  coppie as (
    -- stesso comune (per codice; per nome se il codice manca) e ultima parola significativa dell'indirizzo
    select s.cantiere_id as src, x.*,
           coalesce(upper(btrim(s.cantiere_committente_id)) = upper(btrim(x.cantiere_committente_id)), false) as stesso
      from senza s
      join con x on x.cantiere_comune_cod = s.cantiere_comune_cod
     where s.chiave is not null and x.cantiere_indirizzo ilike '%' || s.chiave || '%'
    union all
    select s.cantiere_id, x.*,
           coalesce(upper(btrim(s.cantiere_committente_id)) = upper(btrim(x.cantiere_committente_id)), false)
      from senza s
      join con x on x.comune_nome ilike '%' || s.comune_nome || '%'
     where s.chiave is not null and s.cantiere_comune_cod is null and nullif(btrim(s.comune_nome), '') is not null
       and x.cantiere_indirizzo ilike '%' || s.chiave || '%'
  ),
  scelte as (
    select k.*, row_number() over (partition by k.src order by k.stesso desc, k.cantiere_chiuso nulls first, k.cantiere_id) as n
      from coppie k
  ),
  comm as (
    select committente_id, committente_nome, coalesce(nullif(cf_piva, ''), nullif(piva, ''), committente_id) as cod
      from committenti where elimina = 0
  ),
  nvis as (
    select v.cantiere_id, count(*) as visite from visite v
     where v.elimina = 0 and v.cantiere_id in (select cantiere_id from senza) group by v.cantiere_id
  ),
  righe as (
    select s.cantiere_id, s.cantiere_indirizzo, s.cantiere_civico, s.comune_nome, s.cantiere_etichetta,
           s.cantiere_committente_id, coalesce(nv.visite, 0) as visite,
           cs.committente_nome, cs.cod as committente_cod,
           jsonb_agg(jsonb_build_object(
             'cantiere_id', k.cantiere_id, 'cantiere_indirizzo', k.cantiere_indirizzo, 'cantiere_civico', k.cantiere_civico,
             'cantiere_cnce', k.cantiere_cnce, 'cantiere_etichetta', k.cantiere_etichetta, 'cantiere_chiuso', k.cantiere_chiuso,
             'committente_id', k.cantiere_committente_id, 'committente_nome', ck.committente_nome, 'committente_cod', ck.cod,
             'stesso_committente', k.stesso) order by k.n) as candidati,
           bool_or(k.stesso) as con_stesso
      from senza s
      join scelte k on k.src = s.cantiere_id and k.n <= 25
      left join nvis nv on nv.cantiere_id = s.cantiere_id
      left join comm cs on cs.committente_id = s.cantiere_committente_id
      left join comm ck on ck.committente_id = k.cantiere_committente_id
     group by s.cantiere_id, s.cantiere_indirizzo, s.cantiere_civico, s.comune_nome, s.cantiere_etichetta,
              s.cantiere_committente_id, nv.visite, cs.committente_nome, cs.cod
  )
  select jsonb_build_object(
    'senza_cnce', (select count(*) from senza),
    'con_candidati', (select count(*) from righe),
    'righe', coalesce((select jsonb_agg(to_jsonb(r) - 'con_stesso' order by r.con_stesso desc, r.comune_nome, r.cantiere_id) from righe r), '[]'::jsonb))
$function$;

revoke all on function public.s_riaggancio_candidati() from public, anon;
grant execute on function public.s_riaggancio_candidati() to authenticated;
