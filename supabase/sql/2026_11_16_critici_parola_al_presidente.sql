-- ============================================================
-- CANTIERI CRITICI: Presidente e Vicepresidente ne parlano insieme,
-- la parola è SOLO del Presidente (16/11/2026, precisato dall'utente:
-- «decidono insieme presidente e vice normalmente sentendo il parere di
-- coordinatore ed eventualmente del direttore ma la parola spetta sempre
-- e solo al presidente»).
--
-- · s_critico_decide_presidenza: il Presidente DECIDE; il Vicepresidente
--   scrive il suo PARERE (stesso tipo di evento 'decisione_organo', con
--   dati.valore = 'parere' e il testo che lo dice). Le app contano come
--   decisione solo la riga con dati.chi = 'Presidente'.
-- · s_direzione_in_attesa: per la Presidenza un caso esce dalla coda di
--   chi ha risposto lui stesso, non di chiunque: il parere del
--   Vicepresidente non toglie il caso al Presidente.
-- ============================================================

create or replace function public.s_critico_decide_presidenza(p_id bigint, p_cosa text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_stato text; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_carica text; v_chi text; v_ev bigint; v_pres boolean;
begin
  if not coalesce(is_presidenza(), false) then
    raise exception 'La decisione spetta al Presidente; il Vicepresidente dà il suo parere';
  end if;
  if p_cosa not in ('segnalare', 'non_segnalare') then
    raise exception 'Scelta non valida: %', p_cosa;
  end if;
  select stato into v_stato from s_cantieri_critici where id = p_id;
  if v_stato is null then raise exception 'Caso % non trovato', p_id; end if;
  if v_stato in ('chiuso', 'annullato') then raise exception 'Il caso % è già %', p_id, v_stato; end if;
  select mia_carica() into v_carica;
  v_chi := case v_carica when 'presidente' then 'Presidente' when 'vicepresidente' then 'Vicepresidente' else 'Presidenza' end;
  v_pres := v_chi = 'Presidente';
  insert into s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
  values (p_id, 'decisione_organo',
          v_chi || ', dall''app il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY "alle" HH24:MI') || ': '
            || case when v_pres then
                 case p_cosa when 'segnalare' then 'decide di SEGNALARE agli organi di vigilanza' else 'decide di NON segnalare' end
               else
                 case p_cosa when 'segnalare' then 'è del parere di segnalare agli organi di vigilanza' else 'è del parere di non segnalare' end
                 || ' (parere: la decisione spetta al Presidente)'
               end
            || case when nullif(trim(coalesce(p_nota, '')), '') is not null then '. ' || trim(p_nota) else '.' end,
          true, jsonb_build_object('chi', v_chi, 'cosa', p_cosa, 'via', 'app', 'utente', v_email,
                                   'valore', case when v_pres then 'decisione' else 'parere' end))
  returning id into v_ev;
  return jsonb_build_object('evento_id', v_ev, 'cosa', p_cosa, 'chi', v_chi, 'valore', case when v_pres then 'decisione' else 'parere' end);
end $$;

revoke execute on function public.s_critico_decide_presidenza(bigint, text, text) from public, anon;
grant execute on function public.s_critico_decide_presidenza(bigint, text, text) to authenticated, service_role;

create or replace function public.s_direzione_in_attesa()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with aut as (
    select 'segnalazione' as tipo, id, progressivo, aut_richiesta_il::date as dal,
           coalesce(nullif(trim(concat_ws(' — ', ind_cantiere, comune_cantiere)), ''), notificante, 'cantiere da individuare') as chi
      from s_segnalazioni where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'consulenza', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_consulenze where aut_stato = 'richiesta' and corsia = 'uscita' and stato not in ('chiusa', 'scartata')
    union all
    select case when tipo_richiesta = 'serie' then 'serie di visite' else 'visita richiesta' end, id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_visite_richieste where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'conferenza di cantiere', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_conferenze_cantiere where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'attestazione DM 132', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_attestazioni_dm132 where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
  ),
  ruolo as (
    select case when coalesce(is_presidenza(), false) and not coalesce(is_direttore(), false) then 'presidenza' else 'direttore' end as v,
           lower(coalesce(auth.jwt() ->> 'email', '')) as io
  ),
  crit as (
    select c.id, c.impresa_nome, c.cantiere_desc, c.data_evento,
           (select max(e.created_at) from s_cantieri_critici_eventi e, ruolo
             where e.critico_id = c.id and e.tipo = 'demandata' and e.dati ->> 'chi' = ruolo.v) as chiesta_il
      from s_cantieri_critici c where c.stato not in ('chiuso', 'annullato')
  )
  select case when coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false) or coalesce(is_presidenza(), false)
    then jsonb_build_object(
      'autorizzazioni', case when coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false)
        then coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'id', id, 'progressivo', progressivo, 'dal', dal, 'chi', chi,
                                   'link', 'https://formedilpadovacpt.github.io/segreteria/#' ||
                                     case tipo when 'segnalazione' then 'segnalazione' when 'consulenza' then 'consulenza'
                                               when 'conferenza di cantiere' then 'conferenza' when 'attestazione DM 132' then 'attestazione' else 'visita' end
                                     || '-' || id) order by dal nulls last) from aut), '[]'::jsonb)
        else '[]'::jsonb end,
      'critici', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'impresa', impresa_nome, 'cantiere', cantiere_desc, 'data_evento', data_evento, 'dal', chiesta_il::date)
                                   order by chiesta_il) from crit, ruolo
                            where chiesta_il is not null and not exists (
                              select 1 from s_cantieri_critici_eventi e2 where e2.critico_id = crit.id
                                 and e2.tipo = case when ruolo.v = 'presidenza' then 'decisione_organo' else 'autorizzazione_direttore' end
                                 -- (16/11/2026) per la Presidenza conta solo la risposta di chi guarda: il parere del
                                 -- Vicepresidente non toglie il caso dalla coda del Presidente, e viceversa
                                 and (ruolo.v <> 'presidenza' or lower(coalesce(e2.dati ->> 'utente', e2.autore, '')) = ruolo.io)
                                 and e2.created_at > crit.chiesta_il)), '[]'::jsonb),
      'al', now())
    else jsonb_build_object('autorizzazioni', '[]'::jsonb, 'critici', '[]'::jsonb, 'al', now(), 'non_autorizzato', true) end;
$function$;

revoke execute on function public.s_direzione_in_attesa() from public, anon;
grant execute on function public.s_direzione_in_attesa() to authenticated, service_role;
