-- ============================================================
-- CANTIERI CRITICI: il Direttore PROPONE, il Presidente DECIDE
-- (16/11/2026, allinea l'app alla decisione dell'utente del 05/10/2026)
--
-- La segnalazione agli organi competenti (SPISAL, Ispettorato) la decide
-- il Presidente, legale rappresentante: la Commissione Sicurezza ha da
-- sempre delegato la sua competenza alla Presidenza. Direttore e
-- Commissione PROPONGONO; il Coordinatore istruisce il caso e scrive il
-- merito. Rif.: procedura Rev. 4 v03, par. 4.6.2 e Allegato B punto 24.
--
-- Fino a oggi s_critico_conferma_direttore scriveva «CONFERMA la
-- segnalazione»: ora scrive la PROPOSTA del Direttore e porta da sola il
-- caso al Presidente (s_critico_coinvolgi_presidenza: evento «demandata»
-- a chi = presidenza + avviso nell'app), perché una proposta che non
-- arriva a chi decide resterebbe ferma.
--
-- Nomi interni invariati (funzione, tipo evento 'autorizzazione_direttore',
-- valori 'segnalare' / 'non_segnalare'): al 16/11/2026 nel registro non c'è
-- nessun evento di questi tipi, ma i nomi li leggono le due app, i test e
-- s_direzione_in_attesa; cambiano solo i testi.
-- ============================================================

create or replace function public.s_critico_conferma_direttore(p_id bigint, p_cosa text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_stato text; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_ev bigint;
begin
  if not coalesce(is_direttore(), false) then
    raise exception 'La proposta del Direttore la registra solo il Direttore';
  end if;
  if p_cosa not in ('segnalare', 'non_segnalare') then
    raise exception 'Proposta non valida: %', p_cosa;
  end if;
  select stato into v_stato from s_cantieri_critici where id = p_id;
  if v_stato is null then raise exception 'Caso % non trovato', p_id; end if;
  if v_stato in ('chiuso', 'annullato') then raise exception 'Il caso % è già %', p_id, v_stato; end if;
  insert into s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
  values (p_id, 'autorizzazione_direttore',
          'Direttore, dall''app il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY "alle" HH24:MI') || ': '
            || case p_cosa when 'segnalare' then 'PROPONE al Presidente di segnalare agli organi di vigilanza'
                           else 'PROPONE al Presidente di non segnalare' end
            || case when nullif(trim(coalesce(p_nota, '')), '') is not null then '. ' || trim(p_nota) else '.' end,
          true, jsonb_build_object('chi', 'Direttore', 'cosa', p_cosa, 'via', 'app', 'utente', v_email, 'valore', 'proposta'))
  returning id into v_ev;
  -- la proposta va a chi decide: il caso passa al Presidente, che riceve l'avviso
  perform s_critico_coinvolgi_presidenza(p_id,
    case p_cosa when 'segnalare' then 'Il Direttore propone di segnalare.' else 'Il Direttore propone di non segnalare.' end);
  return jsonb_build_object('evento_id', v_ev, 'cosa', p_cosa);
end $$;

revoke execute on function public.s_critico_conferma_direttore(bigint, text, text) from public, anon;
grant execute on function public.s_critico_conferma_direttore(bigint, text, text) to authenticated, service_role;

comment on function public.s_critico_conferma_direttore(bigint, text, text) is
  'Cantieri critici: PROPOSTA del Direttore al Presidente (segnalare / non segnalare) e passaggio del caso al Presidente. Decide il Presidente (s_critico_decide_presidenza). Regola del 05/10/2026.';
