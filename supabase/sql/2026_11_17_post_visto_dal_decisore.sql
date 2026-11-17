-- 17/11/2026, chiesto dall'utente: nel cruscotto della segreteria un riquadro dei post mandati a
-- Coordinatore e Direttore, che dica a che punto sono: in attesa, VISTI (aperti), approvati, rimandati.
-- Lo stato e le decisioni c'erano già (s_post_passaggi); mancava «l'ha aperto?».
--
-- visti: chi fra quelli che decidono ha aperto il passaggio nella pagina «📣 Comunicazione» del
-- gestionale, e quando la prima volta. Chiave = verso (coordinatore, direttore) o carica per la
-- Presidenza (presidente, vicepresidente), che decidono ciascuno per sé. Lo scrive solo
-- s_post_visto, che controlla chi è: la segreteria nell'anteprima «Vedi come…» non lo scrive.

alter table public.s_post_passaggi add column if not exists visti jsonb not null default '{}'::jsonb;
comment on column public.s_post_passaggi.visti is
  'Chi fra i decisori ha aperto il passaggio in attesa nella pagina Comunicazione del gestionale, e quando la prima volta: {"direttore": {"nome": …, "il": …}}. Lo scrive s_post_visto (17/11/2026).';

create or replace function public.s_post_visto(p_passaggi bigint[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
        v_nome text; v_carica text; v_n integer := 0; r public.s_post_passaggi; v_chiave text;
begin
  if v_email = '' or p_passaggi is null then return 0; end if;
  select carica into v_carica from app_ruoli
   where lower(email) = v_email and stato = 'attivo' and carica in ('presidente', 'vicepresidente')
   order by case carica when 'presidente' then 1 else 2 end limit 1;
  for r in select * from s_post_passaggi where id = any(p_passaggi) and stato = 'in_attesa' for update loop
    v_chiave := case
      when r.verso = 'coordinatore' and coalesce(is_coordinatore(), false) then 'coordinatore'
      when r.verso = 'direttore' and coalesce(is_direttore(), false) then 'direttore'
      when r.verso = 'presidenza' and coalesce(is_presidenza(), false) and v_carica is not null then v_carica
      else null end;
    continue when v_chiave is null or r.visti ? v_chiave;
    v_nome := coalesce(v_nome, s_post_nome(v_email));
    update s_post_passaggi set visti = visti || jsonb_build_object(v_chiave, jsonb_build_object('nome', v_nome, 'il', now()))
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

revoke all on function public.s_post_visto(bigint[]) from public, anon;
grant execute on function public.s_post_visto(bigint[]) to authenticated;
