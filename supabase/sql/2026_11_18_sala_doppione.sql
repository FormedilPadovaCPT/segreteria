-- ════════════════════════════════════════════════════════════════════════
-- Registrazione in sala: il doppione si vede nella coda        (18/11/2026)
-- Dalla prova del corso 338: la pagina della sala lasciava registrare una
-- seconda entrata. Ora il portale la ferma (sala_stato, progetto Servizi);
-- qui la rete di sicurezza per quando passa lo stesso (senza rete, altro
-- telefono): la richiesta arriva con la nota «doppione» in note_ufficio, così
-- in coda si respinge invece di confermarla. Non si blocca niente: decide la
-- segreteria.
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.trg_iscrizioni_sala_doppione()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_tipo text; v_cf text; v_prima record;
begin
  v_tipo := new.persone -> 0 ->> 'in_sala';
  v_cf := upper(regexp_replace(coalesce(new.persone -> 0 ->> 'cf', ''), '[^A-Za-z0-9]', '', 'g'));
  if new.corso_id is null or v_tipo not in ('entrata', 'uscita') or length(v_cf) <> 16 then return new; end if;
  select s.id, s.progressivo, coalesce(s.in_sala_il, s.creato_il) as il into v_prima
    from public.s_iscrizioni s
   where s.corso_id = new.corso_id and s.stato is distinct from 'respinta'
     and s.persone -> 0 ->> 'in_sala' = v_tipo
     and upper(regexp_replace(coalesce(s.persone -> 0 ->> 'cf', ''), '[^A-Za-z0-9]', '', 'g')) = v_cf
     and (coalesce(s.in_sala_il, s.creato_il) at time zone 'Europe/Rome')::date = (now() at time zone 'Europe/Rome')::date
   order by s.id limit 1;
  if found then
    new.note_ufficio := concat_ws(' · ', nullif(new.note_ufficio, ''),
      'doppione: ' || v_tipo || ' già registrata alle ' || to_char(v_prima.il at time zone 'Europe/Rome', 'HH24:MI')
      || ' (richiesta n° ' || coalesce(v_prima.progressivo::text, v_prima.id::text) || '): da respingere');
  end if;
  return new;
end $$;
drop trigger if exists trg_s_iscrizioni_sala_doppione on public.s_iscrizioni;
create trigger trg_s_iscrizioni_sala_doppione before insert on public.s_iscrizioni
  for each row execute function public.trg_iscrizioni_sala_doppione();
