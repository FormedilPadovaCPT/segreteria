-- ============================================================================
-- 2026_10_15 — Firme di presenza doppie: nascono già «respinte»
--
-- Dal primo corso vero (n. 236, formazione nuovi tecnici del 15/10/2026):
-- ognuno dei tre allievi che ha firmato col telefono ha mandato due volte
-- entrata e uscita, a 5-15 secondi di distanza, con due submission_id
-- diversi (due invii veri, non un ritentativo). La seconda firma restava
-- «ricevuta» e la firma del registro della giornata veniva rifiutata («ci
-- sono firme da guardare») anche se tutto risultava confermato. Le sei di
-- quel giorno sono state respinte a mano come doppioni.
--
-- Da qui: una firma dello stesso allievo, giornata, momento e turno arrivata
-- entro due minuti da un'altra non respinta nasce «respinta», con la nota che
-- dice di quale firma è il doppione. Resta scritta (niente si cancella).
-- Applicata il 15/10/2026 e provata in transazione annullata.
-- ============================================================================
create or replace function public.trg_firme_presenza_doppione()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_prima public.s_corsi_firme_presenza;
begin
  if new.iscritto_id is null or new.giornata_id is null or new.tipo is null then return new; end if;
  select * into v_prima from public.s_corsi_firme_presenza f
   where f.iscritto_id = new.iscritto_id and f.giornata_id = new.giornata_id
     and f.tipo = new.tipo and f.turno is not distinct from new.turno
     and f.stato in ('ricevuta', 'confermata')
     and abs(extract(epoch from (coalesce(new.ora_server, now()) - f.ora_server))) < 120
   order by f.ora_server limit 1;
  if found then
    new.stato := 'respinta';
    new.note := concat_ws(' · ', nullif(new.note, ''),
      'doppione: stessa firma arrivata ' || to_char(v_prima.ora_server at time zone 'Europe/Rome', 'HH24:MI:SS') || ' (id ' || v_prima.id || ')');
    new.confermata_da := 'automatico (doppione)';
    new.confermata_il := now();
  end if;
  return new;
end $function$;

drop trigger if exists trg_s_corsi_firme_presenza_doppione on public.s_corsi_firme_presenza;
create trigger trg_s_corsi_firme_presenza_doppione
  before insert on public.s_corsi_firme_presenza
  for each row execute function public.trg_firme_presenza_doppione();
