/* ============================================================
   INCARICHI DI DOCENZA — la proposta si corregge, e si può
   registrare un compenso per chi non è un docente (relatori
   ospiti, moderatori).
   Chiesto dall'utente il 19/09/2026 guardando la scheda del
   corso 203: «Proponi incarichi» scriveva ore, tariffa e
   corrispettivo e il toast diceva «controlla e correggi se
   serve», ma nella riga c'erano solo «lettera» ed «elimina» —
   da correggere non c'era niente.

   Tre colonne:
   - qualita:      stesso vocabolario di s_corsi_interventi.qualita,
                   così un ospite si distingue da un docente. Lo
                   storico resta 'docente', che è ciò che era.
   - updated_at /
     aggiornato_da: qui si scrivono numeri che diventano un
                   pagamento; chi ha corretto un compenso, e
                   quando, deve restare scritto.

   ⚠️ Il COMPENSO FORFETTARIO non ha una colonna: è la riga
   senza ore e senza tariffa oraria ma con il corrispettivo
   (tipico dell'ospite pagato a intervento). s_prestazioni_calcola
   legge già coalesce(corrispettivo, ore*tariffa), quindi il
   forfait passa senza toccare la funzione.

   ⚠️ Una riga con protocollo_out_id ha già la sua lettera in
   mano al docente: correggerla è ammesso (un errore si
   corregge), ma l'app chiede conferma e scrive la variazione
   in note — il foglio uscito dice un'altra cifra, e questo non
   si nasconde (regola d'oro 7: il fatto si aggiunge).
   ============================================================ */

alter table public.s_corsi_incarichi
  add column if not exists qualita text not null default 'docente',
  add column if not exists updated_at timestamptz,
  add column if not exists aggiornato_da text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_corsi_incarichi_qualita_check') then
    alter table public.s_corsi_incarichi
      add constraint s_corsi_incarichi_qualita_check
      check (qualita = any (array['docente','codocente','relatore','ospite','moderatore','uditore','stampa']));
  end if;
end $$;

comment on column public.s_corsi_incarichi.qualita is
  'Docente, codocente, relatore, ospite, moderatore… — stesso vocabolario di s_corsi_interventi.qualita. Lo storico importato è tutto «docente».';
comment on column public.s_corsi_incarichi.corrispettivo is
  'Compenso complessivo. Di norma ore × tariffa_oraria; con ore e tariffa vuote è un compenso FORFETTARIO (ospite pagato a intervento). Vince sempre su ore × tariffa, anche in s_prestazioni_calcola.';
comment on column public.s_corsi_incarichi.aggiornato_da is
  'Chi ha corretto la riga dall''app (le correzioni dopo la lettera protocollata restano anche in note).';
