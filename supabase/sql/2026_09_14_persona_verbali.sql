-- =============================================================================
--  I VERBALI IN CUI COMPARE UNA PERSONA, E PER QUALI IMPRESE (14/09/2026)
-- -----------------------------------------------------------------------------
--  Chiesto dall'utente dopo le nomine dai verbali: per un coordinatore
--  l'impresa non sta nella nomina (e' un libero professionista), ma e' utile
--  sapere per quali imprese ha lavorato. Lo dicono i verbali, quindi non si
--  duplica niente: la funzione li cerca con la stessa chiave del nominativo
--  usata da s_nomine_da_visita (titoli esclusi, ordine indifferente).
--
--  security invoker: vede le visite che la RLS gia' concede a chi chiama (il
--  personale). La usano la scheda persona dell'app segreteria e la scheda
--  persona della rubrica del gestionale.
--
--  Limite dichiarato: due omonimi si confondono, come nelle nomine.
--
--  Applicata su Supabase come migrazione persona_verbali_2026_09_14.
-- =============================================================================

create or replace function public.persona_verbali(p_persona_id uuid)
returns table (visita_id text, nr_verbale text, data_visita date, figura text, qualifica text,
               impresa_id text, impresa_nome text, cantiere_id text, comune text, indirizzo text)
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select public.nominativo_chiave(coalesce(pp.nome, '') || ' ' || coalesce(pp.cognome, '')) k,
           substring(coalesce(pp.cognome, '') from '^[A-Za-z]{3,}') pref
      from public.persone pp
     where pp.persona_id = p_persona_id
  ), f as (
    select v.visita_id, v.nr_verbale, v.data_visita, v.impresa_id, v.cantiere_id, v.qual_ppre,
           public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.csp_nome,  v.csp_cog)),  ''), v.csp))      k_csp,
           public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.cse_nome,  v.cse_cog)),  ''), v.cse))      k_cse,
           public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.rl_nome,   v.rl_cog)),   ''), v.resp_lav)) k_rl,
           public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.ppre_nome, v.ppre_cog)), ''), v.nom_ppre)) k_pp
      from public.visite v
      cross join p
     where coalesce(v.elimina, 0) = 0
       and p.k is not null and position(' ' in p.k) > 0
       and (p.pref is null
            or concat_ws(' ', v.csp, v.cse, v.resp_lav, v.nom_ppre,
                              v.csp_nome, v.csp_cog, v.cse_nome, v.cse_cog,
                              v.rl_nome, v.rl_cog, v.ppre_nome, v.ppre_cog) ilike '%' || p.pref || '%')
  )
  select f.visita_id, f.nr_verbale, f.data_visita,
         concat_ws(', ',
                   case when f.k_csp = p.k then 'CSP' end,
                   case when f.k_cse = p.k then 'CSE' end,
                   case when f.k_rl  = p.k then 'Resp. lavori' end,
                   case when f.k_pp  = p.k then 'Presente' end) figura,
         case when f.k_pp = p.k then f.qual_ppre end qualifica,
         f.impresa_id, i.impresa_nome, f.cantiere_id, c.comune_nome, c.cantiere_indirizzo
    from f
    cross join p
    left join public.imprese i on i.impresa_id = f.impresa_id
    left join public.cantieri c on c.cantiere_id = f.cantiere_id
   where p.k in (f.k_csp, f.k_cse, f.k_rl, f.k_pp)
   order by f.data_visita desc, f.nr_verbale desc
$$;
revoke execute on function public.persona_verbali(uuid) from public, anon;
grant execute on function public.persona_verbali(uuid) to authenticated, service_role;
