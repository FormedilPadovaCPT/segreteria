-- ============================================================================
-- 2026_10_14 — La lettera di incarico firmata nell'app dal destinatario vale
-- come inviata nel protocollo
--
-- Deciso dall'utente il 14/10/2026: «Nicola l'ha già firmata in app: dovrebbe
-- considerarsi inviata nel protocollo, con l'invio in app per firma». La
-- lettera di incarico (asseverazione e docenza) arriva al destinatario
-- dentro l'app, che gliela mette davanti da firmare: quando la firma, l'ha
-- ricevuta, e il protocollo in uscita non deve più comparire fra quelli
-- «da inviare» aspettando una mail che non serve.
--
-- Vale solo per la firma del DESTINATARIO (ruolo «incaricato» o «docente»)
-- su una lettera di incarico col suo protocollo, e solo se il protocollo non
-- risulta già inviato: non sovrascrive un invio segnato a mano o una mail
-- partita. La firma del solo Presidente non basta: la lettera è ancora in
-- casa. Mezzo «Firma nell'app», data quella della firma (ora di Roma),
-- «inviato da» dice chi ha firmato.
-- ============================================================================
create or replace function public.trg_firme_incarico_inviato()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.stato = 'firmata'
     and (tg_op = 'INSERT' or old.stato is distinct from 'firmata')
     and new.tipo in ('incarico_assev', 'incarico_docenza')
     and new.firmatario_ruolo in ('incaricato', 'docente')
     and new.protocollo_id is not null then
    update public.s_protocollo p
       set inviato_il    = (coalesce(new.firmata_il, now()) at time zone 'Europe/Rome')::date,
           inviato_da    = 'firmata nell''app da ' || coalesce(new.firmatario_email, new.firmata_da, 'destinatario'),
           mezzo         = 'Firma nell''app',
           aggiornato_da = 'firma nell''app'
     where p.id = new.protocollo_id
       and p.direzione = 'OUT'
       and not coalesce(p.annullato, false)
       and p.inviato_il is null
       and p.mail_inviata_at is null;
  end if;
  return new;
end $function$;

drop trigger if exists trg_s_firme_incarico_inviato on public.s_firme;
create trigger trg_s_firme_incarico_inviato
  after insert or update of stato on public.s_firme
  for each row execute function public.trg_firme_incarico_inviato();

-- le lettere già firmate dal destinatario prima di oggi
update public.s_protocollo p
   set inviato_il    = (f.firmata_il at time zone 'Europe/Rome')::date,
       inviato_da    = 'firmata nell''app da ' || coalesce(f.firmatario_email, f.firmata_da, 'destinatario'),
       mezzo         = 'Firma nell''app',
       aggiornato_da = 'firma nell''app (recupero 14/10/2026)'
  from public.s_firme f
 where f.protocollo_id = p.id
   and f.stato = 'firmata'
   and f.tipo in ('incarico_assev', 'incarico_docenza')
   and f.firmatario_ruolo in ('incaricato', 'docente')
   and p.direzione = 'OUT'
   and not coalesce(p.annullato, false)
   and p.inviato_il is null
   and p.mail_inviata_at is null;
