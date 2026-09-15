-- ============================================================================
-- 15/09/2026 — Protocollo in USCITA: inviato o no.
--
-- Chiesto dall'utente: nell'elenco del protocollo una colonna che dica se il
-- documento in uscita è partito. I protocolli in uscita già registrati si
-- danno per inviati alla data dell'invio; quelli nuovi si segnano quando
-- partono.
--
-- - inviato_il / inviato_da su s_protocollo (solo direzione OUT).
-- - Impostazione in blocco dei protocolli in uscita esistenti: la data della
--   mail segnata «inviata» nell'app se c'è, poi quella in cui l'app l'ha
--   preparata, poi mail_inviata_at, poi la data del protocollo (fatta il
--   15/09/2026: 2.573 su 2.573, 5 con data diversa da data_prot).
-- - Trigger su s_prot_invii: «L'ho inviata» su una mail preparata segna il
--   protocollo come inviato quel giorno, se nessuno l'aveva già fatto.
--
-- Applicata a mano con execute_sql il 15/09/2026.
-- ============================================================================

alter table public.s_protocollo
  add column if not exists inviato_il date,
  add column if not exists inviato_da text;

comment on column public.s_protocollo.inviato_il is
  'Solo protocolli in USCITA: giorno in cui il documento è partito (mail, PEC, posta, a mano). Vuoto = non ancora inviato. I protocolli in uscita esistenti al 15/09/2026 sono stati impostati in blocco; da allora si valorizza a mano, o da solo quando su una mail preparata si preme «L''ho inviata».';
comment on column public.s_protocollo.inviato_da is
  'Chi ha segnato l''invio del protocollo in uscita (e-mail utente), oppure la nota dell''impostazione in blocco del 15/09/2026.';

create index if not exists s_protocollo_out_da_inviare_idx
  on public.s_protocollo (data_prot desc)
  where direzione = 'OUT' and inviato_il is null;

-- impostazione in blocco (una volta sola: tocca solo le righe ancora vuote)
update public.s_protocollo p set
  inviato_il = coalesce(
    (select (min(i.inviata_at) at time zone 'Europe/Rome')::date from public.s_prot_invii i where i.protocollo_id = p.id),
    (select (min(i.preparata_at) at time zone 'Europe/Rome')::date from public.s_prot_invii i where i.protocollo_id = p.id),
    (p.mail_inviata_at at time zone 'Europe/Rome')::date,
    p.data_prot,
    p.data_doc,
    (p.created_at at time zone 'Europe/Rome')::date),
  inviato_da = 'impostato in blocco il 15/09/2026 (protocollo in uscita già registrato)'
where p.direzione = 'OUT' and p.inviato_il is null and not p.annullato
  and p.created_at < '2026-09-15 23:59:59+02';

create or replace function public.s_prot_invii_segna_protocollo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- «L'ho inviata» su una mail preparata: il protocollo in uscita risulta inviato quel giorno,
  -- se nessuno l'aveva già segnato.
  if new.inviata_at is not null and (tg_op = 'INSERT' or old.inviata_at is null) then
    update public.s_protocollo
       set inviato_il = (new.inviata_at at time zone 'Europe/Rome')::date,
           inviato_da = coalesce(new.inviata_da, inviato_da)
     where id = new.protocollo_id and direzione = 'OUT' and inviato_il is null;
  end if;
  return new;
end $$;
revoke execute on function public.s_prot_invii_segna_protocollo() from public, anon;
grant execute on function public.s_prot_invii_segna_protocollo() to service_role;

drop trigger if exists trg_prot_invii_segna_protocollo on public.s_prot_invii;
create trigger trg_prot_invii_segna_protocollo
  after insert or update of inviata_at on public.s_prot_invii
  for each row execute function public.s_prot_invii_segna_protocollo();
