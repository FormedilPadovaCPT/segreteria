-- ============================================================
-- SEGNALAZIONI: QUANDO IL TECNICO HA FATTO LA VISITA (02/10/2026)
--
-- Chiesto dall'utente guardando il cruscotto: la segnalazione n° 2
-- (sindacato, Santa Giustina in Colle) restava fra le «autorizzate da
-- eseguire» con la pastiglia «eseguito da Visentini». Per il tecnico
-- non c'era più niente da fare; restava alla segreteria decidere — col
-- Direttore, trattandosi di un sindacato — se e come dare un riscontro.
--
-- Il passo si legge dall'INCARICO, che vive nel gestionale: quando il
-- tecnico registra la visita l'incarico passa a «eseguito». Da qui:
--   - la segnalazione collegata passa allo stato «eseguita», con la data
--     e il cantiere della visita (stati di partenza: ricevuta, istruita,
--     autorizzata, assegnata, riscontrata — la presa in carico può essere
--     partita prima della visita);
--   - alla segreteria arriva una notifica sul telefono/computer (testo
--     fisso, nessun nome: regola delle notifiche del 17/09);
--   - se l'incarico viene riaperto la segnalazione torna «assegnata».
-- La chiusura resta della segreteria: «eseguita» vuol dire che tocca a lei.
--
-- Il trigger non sta mai dentro il salvataggio del tecnico: tutto in un
-- blocco che inghiotte gli errori (un guasto qui non blocca un verbale).
-- ============================================================

create or replace function public.s_segnalazione_da_incarico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_data date; v_cant text; n int;
begin
  begin
    if new.stato = 'eseguito' and old.stato is distinct from 'eseguito' then
      select v.data_visita, v.cantiere_id into v_data, v_cant from visite v where v.visita_id = new.visita_id;
      update s_segnalazioni s
         set stato = 'eseguita',
             data_verbale = coalesce(v_data, s.data_verbale),
             cantiere_id = coalesce(s.cantiere_id, v_cant),
             updated_at = now(),
             aggiornato_da = 'automatico: visita registrata dal tecnico (incarico n° ' || new.id || ')'
       where s.incarico_id = new.id
         and s.stato in ('ricevuta', 'istruita', 'autorizzata', 'assegnata', 'riscontrata');
      get diagnostics n = row_count;
      if n > 0 then
        perform push_accoda('cptpd@did.formedilpadova.it', 'segnalazione_eseguita', 'Segnalazione: visita fatta',
          'Il tecnico ha registrato la visita su una segnalazione: nell''app Segreteria c''è da decidere il riscontro e chiudere la pratica.',
          './', 'segnalazione-inc-' || new.id);
      end if;
    elsif new.stato = 'aperto' and old.stato = 'eseguito' then
      update s_segnalazioni s
         set stato = 'assegnata', updated_at = now(),
             aggiornato_da = 'automatico: incarico n° ' || new.id || ' riaperto'
       where s.incarico_id = new.id and s.stato = 'eseguita';
    end if;
  exception when others then raise warning 's_segnalazione_da_incarico: %', sqlerrm; end;
  return null;
end $$;
revoke execute on function public.s_segnalazione_da_incarico() from public, anon, authenticated;

drop trigger if exists trg_segnalazione_da_incarico on public.incarichi;
create trigger trg_segnalazione_da_incarico
  after update of stato on public.incarichi
  for each row execute function public.s_segnalazione_da_incarico();

-- le segnalazioni la cui visita è già stata registrata (al 02/10/2026: la n° 2)
update public.s_segnalazioni s
   set stato = 'eseguita',
       data_verbale = coalesce(v.data_visita, s.data_verbale),
       cantiere_id = coalesce(s.cantiere_id, v.cantiere_id),
       updated_at = now(),
       aggiornato_da = 'automatico: visita già registrata dal tecnico (allineamento del 02/10/2026)'
  from public.incarichi i left join public.visite v on v.visita_id = i.visita_id
 where i.id = s.incarico_id
   and (i.stato in ('eseguito', 'chiuso') or i.eseguito_il is not null)
   and s.stato in ('ricevuta', 'istruita', 'autorizzata', 'assegnata', 'riscontrata');
