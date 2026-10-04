-- ============================================================
-- imprese_mail_di_altri più veloce (04/10/2026). La Scrivania dell'Ufficio
-- nel gestionale ha mostrato «non letto» sul riquadro «Imprese con
-- l'indirizzo di un'altra impresa»: alle 14:39 il database l'ha interrotta
-- per statement timeout (8 s). Da sola impiegava 2,3 s e scriveva su disco
-- (temp read 17.701 pagine): per ogni riga cercava l'impresa «titolare»
-- dell'indirizzo riscorrendo tutto l'elenco degli indirizzi; con gli altri
-- conteggi in parallelo arrivava a 10 s. Dopo il recupero delle unioni le
-- imprese hanno più indirizzi, e il lavoro è cresciuto.
-- Stesso risultato, riga per riga (verificato con EXCEPT nei due sensi):
-- il titolare si calcola una volta per indirizzo, e i dati della Cassa e
-- il numero di visite solo per le righe che restano.
-- ============================================================

create or replace function public.imprese_mail_di_altri()
returns table(impresa_id text, impresa_nome text, piva text, comune text, colonna text, mail text, titolare_id text,
              titolare_nome text, condivisa_con integer, in_cassa boolean, mail_cassa text, stessa_della_cassa boolean, n_visite bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not public.is_segreteria() then
    raise exception 'Riservato alla segreteria.' using errcode = '42501';
  end if;
  return query
  with parole_comuni(s) as (values
    ('costruzioni'),('edile'),('edili'),('edilizia'),('impresa'),('societa'),('geom'),('fratelli'),('figli'),
    ('group'),('gruppo'),('restauri'),('impianti'),('servizi'),('scavi'),('lavori'),('snc'),('sas'),('srls'),
    ('soc'),('coop'),('cooperativa'),('italia'),('veneta'),('veneto'),('padova'),('immobiliare'),('general'),
    ('generali'),('strade'),('stradali')),
  m as (
    select i.impresa_id, i.impresa_nome, nullif(trim(i.piva), '') as piva, nullif(trim(i.impresa_cf), '') as cf, i.comune,
           coalesce(nullif(trim(i.piva), ''), nullif(trim(i.impresa_cf), ''), i.impresa_id) as sogg,
           (array['impresa_email_ref', 'impresa_email2', 'impresa_email3'])[u.pos::int] as colonna,
           lower(trim(u.e)) as mail
      from public.imprese i
     cross join lateral unnest(array[i.impresa_email_ref, i.impresa_email2, i.impresa_email3]) with ordinality as u(e, pos)
     where coalesce(i.elimina, 0) = 0 and coalesce(trim(u.e), '') like '%@%'
  ),
  mm as materialized (
    select q.*,
           exists (
             select 1
               from regexp_split_to_table(lower(regexp_replace(q.impresa_nome, '[^A-Za-z0-9 ]', ' ', 'g')), '\s+') t
              where length(t) >= 4 and t not in (select s from parole_comuni)
                and (q.et like '%' || t || '%' or (length(q.et) >= 4 and t like '%' || q.et || '%') or q.lo like '%' || t || '%')
           ) as somiglia
      from (select m.*,
                   regexp_replace(split_part(split_part(m.mail, '@', 2), '.', 1), '[^a-z0-9]', '', 'g') as et,
                   regexp_replace(split_part(m.mail, '@', 1), '[^a-z0-9]', '', 'g') as lo
              from m) q
  ),
  g as materialized (
    select mm.mail, count(distinct mm.impresa_id) as n, count(distinct mm.impresa_id) filter (where mm.somiglia) as n_som
      from mm group by mm.mail having count(distinct mm.sogg) > 1
  ),
  -- il titolare: una volta per indirizzo (prima era cercato riga per riga)
  tit as materialized (
    select distinct on (y.mail) y.mail, y.impresa_id, y.impresa_nome
      from mm y join g on g.mail = y.mail
     where y.somiglia
     order by y.mail, y.impresa_id
  ),
  sel as materialized (
    select x.*, g.n, tit.impresa_id as t_id, tit.impresa_nome as t_nome
      from mm x
      join g on g.mail = x.mail
      join tit on tit.mail = x.mail
     where g.n_som between 1 and g.n - 1
       and not x.somiglia
       and not exists (select 1 from public.imprese_mail_decisioni d
                        where d.impresa_id = x.impresa_id and d.mail = x.mail and d.decisione = 'confermato')
  )
  select x.impresa_id, x.impresa_nome, x.piva, x.comune, x.colonna, x.mail,
         x.t_id, x.t_nome, (x.n - 1)::integer,
         c.in_cassa, c.mail_cassa, coalesce(c.mail_cassa = x.mail, false),
         (select count(distinct p.visita_id) from public.visite_imprese_presenti p where p.impresa_id = x.impresa_id)
    from sel x
   cross join lateral (
     select exists (select 1 from public.ceiv_lista l
                     where (x.piva is not null and l.piva = x.piva)
                        or (coalesce(x.cf, x.piva) is not null and l.cf = coalesce(x.cf, x.piva))) as in_cassa,
            public._ceiv_mail(x.piva, x.cf) as mail_cassa
   ) c
   order by coalesce(c.mail_cassa = x.mail, false), x.impresa_nome, x.mail;
end
$function$;
