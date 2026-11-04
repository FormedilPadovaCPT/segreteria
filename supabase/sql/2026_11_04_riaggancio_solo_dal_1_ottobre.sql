-- ============================================================
-- Riaggancio cantieri senza CNCE: condono dello storico (04/11/2026, deciso dall'utente).
-- Il pannello mostra solo i cantieri senza CNCE che hanno almeno una visita dal
-- 1° ottobre 2026 (inizio dei verbali nell'app), o che sono nati da quel giorno
-- e non hanno ancora visite. Lo storico (1.909 cantieri con l'ultima visita prima
-- del 1/10) resta com'è: nessuna riga viene modificata, è solo un filtro, e
-- togliendo la condizione torna tutto visibile.
-- I nuovi senza codice sono ammessi (lavori senza notifica in Cassa): si controllano
-- dalla segreteria, perché il CNCE può comparire nella lista della Cassa dopo la visita.
-- Al 04/11 i riagganci fatti erano 50 (s_unioni_log, origine 'riaggancio', 04-29/10).
-- ============================================================

create or replace function public.s_riaggancio_candidati()
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with tutti as materialized (
    select c.cantiere_id, c.cantiere_indirizzo, c.cantiere_civico, c.comune_nome, c.cantiere_etichetta,
           c.cantiere_comune_cod, c.cantiere_committente_id, c.created_at,
           public.s_riaggancio_chiave(c.cantiere_indirizzo) as chiave
      from cantieri c
     where c.elimina = 0 and nullif(btrim(c.cantiere_cnce), '') is null
  ),
  senza as materialized (
    select t.* from tutti t
     where exists (select 1 from visite v
                    where v.cantiere_id = t.cantiere_id and v.elimina = 0 and v.data_visita >= date '2026-10-01')
        or (t.created_at >= date '2026-10-01'
            and not exists (select 1 from visite v where v.cantiere_id = t.cantiere_id and v.elimina = 0))
  ),
  con as materialized (
    select x.cantiere_id, x.cantiere_indirizzo, x.cantiere_civico, x.cantiere_cnce, x.cantiere_etichetta,
           x.cantiere_chiuso, x.cantiere_committente_id, x.cantiere_comune_cod, x.comune_nome
      from cantieri x
     where x.elimina = 0 and nullif(btrim(x.cantiere_cnce), '') is not null
  ),
  coppie as (
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
    'storico_escluso', (select count(*) from tutti) - (select count(*) from senza),
    'dal', '2026-10-01',
    'con_candidati', (select count(*) from righe),
    'righe', coalesce((select jsonb_agg(to_jsonb(r) - 'con_stesso' order by r.con_stesso desc, r.comune_nome, r.cantiere_id) from righe r), '[]'::jsonb))
$function$;
