-- ============================================================
-- 27/09/2026 — fase B delle zone + correzione lettere mensili area 48
-- APPLICATO come migrazione numero_verbale_server_e_ronchitelli_2026_09_27.
-- ============================================================

-- 1. Le 11 lettere mensili 2021-2022 alla casella appalti@ancepadova.it erano di
--    Ronchitelli Michele (confermato dall'utente il 27/09/2026).
update public.s_incarichi_mensili
   set persona_id = 'fe9a4845-f7e0-43f4-b09b-973f9bc87e7e'
 where lower(tecnico_email) = 'appalti@ancepadova.it' and persona_id is null;
update public.zone_aree_tecnici set nome = 'Ronchitelli'
 where persona_id = 'fe9a4845-f7e0-43f4-b09b-973f9bc87e7e';

-- 2. Il numero del verbale lo dà il server (prima lo calcolava l'app leggendo le
--    visite: con «vede solo le sue» avrebbe dato numeri già usati). Stessa regola:
--    prefisso CPT/AA_AA/ dell'esercizio 1/10-30/9, ultimo numero + 1 su TUTTE le visite.
create or replace function public.prossimo_numero_verbale(p_data date default current_date)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  d    date := coalesce(p_data, current_date);
  s    int;
  pref text;
  n    int;
begin
  if not (select public.is_personale()) then raise exception 'Non autorizzato'; end if;
  s := case when extract(month from d) >= 10 then extract(year from d)::int else extract(year from d)::int - 1 end;
  pref := 'CPT/' || lpad((s % 100)::text, 2, '0') || '_' || lpad(((s + 1) % 100)::text, 2, '0') || '/';
  select max(nullif(substring(split_part(nr_verbale, '/', 3) from '^\d+'), '')::int) into n
    from public.visite
   where left(nr_verbale, length(pref)) = pref;
  return pref || lpad((coalesce(n, 0) + 1)::text, 4, '0');
end $$;
comment on function public.prossimo_numero_verbale(date) is 'Prossimo numero di verbale (CPT/AA_AA/NNNN) per la data della visita, calcolato su tutte le visite. Usata da nextVerbale() del gestionale dal 27/09/2026.';
revoke execute on function public.prossimo_numero_verbale(date) from public, anon;
grant execute on function public.prossimo_numero_verbale(date) to authenticated, service_role;
-- Per tornare indietro: drop function public.prossimo_numero_verbale(date); e rimettere nextVerbale() com'era (git).
