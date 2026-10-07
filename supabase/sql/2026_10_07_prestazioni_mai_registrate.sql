-- 07/10/2026 — LE ATTIVITÀ DEI MESI PASSATI MAI ENTRATE IN UN RIEPILOGO (proposta approvata dall'utente).
-- La chiusura del mese proponeva le attività del mese (s_prestazioni_calcola) e le «arretrate», cioè le prestazioni
-- già registrate e non ancora fatturate. Restava fuori quello che alla chiusura del suo mese non era stato registrato
-- (spunta tolta, o incarico arrivato dopo): da lì in poi nessuna chiusura lo riproponeva. Caso che l'ha fatto vedere:
-- la docenza di De Marco alla Formazione tecnici (corso 203, incarico del 19/09, settembre chiuso il 30/09).
-- s_prestazioni_mai_registrate: per i 12 mesi prima di quello che si chiude, le righe del calcolo ancora senza
-- prestazione, ma solo dei mesi che per quel tecnico NON hanno un incarico mensile «aperto» (quelli si chiudono da sé).
-- Le righe portano il loro mese d'origine. La chiusura le mostra SENZA spunta: alcune possono essere state escluse
-- apposta, e decide la segreteria (pagarle in questo riepilogo, o registrarle come chiuse col motivo).

begin;

create or replace function public.s_prestazioni_mai_registrate(p_tecnico text, p_anno integer, p_mese integer, p_mesi integer default 12)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  d date; v_out jsonb := '[]'::jsonb;
begin
  if not (public.is_segreteria() or public.is_coordinatore() or public.is_direttore()) then
    raise exception 'Non autorizzato';
  end if;
  for d in select generate_series(make_date(p_anno, p_mese, 1) - make_interval(months => greatest(1, least(p_mesi, 36))),
                                  make_date(p_anno, p_mese, 1) - interval '1 month', interval '1 month')::date loop
    continue when exists (select 1 from public.s_incarichi_mensili im
                           where im.tecnico_id = p_tecnico and im.anno = extract(year from d) and im.mese = extract(month from d)
                             and im.stato = 'aperto');
    v_out := v_out || coalesce((
      select jsonb_agg(e || jsonb_build_object('origine_anno', extract(year from d)::int, 'origine_mese', extract(month from d)::int))
        from jsonb_array_elements(public.s_prestazioni_calcola_interna(p_tecnico, extract(year from d)::int, extract(month from d)::int)) e
       where e->>'prestazione_id' is null), '[]'::jsonb);
  end loop;
  return v_out;
end $function$;
revoke execute on function public.s_prestazioni_mai_registrate(text, integer, integer, integer) from public, anon;
grant execute on function public.s_prestazioni_mai_registrate(text, integer, integer, integer) to authenticated;

commit;
