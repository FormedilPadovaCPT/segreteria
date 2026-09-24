-- Richiesta di ORE SUPPLEMENTARI (24/09/2026, chiesto dall'utente): il lavoratore
-- dichiara prima se le ore le recuperera' (alimentano la banca ore) o se vuole che
-- gli siano pagate (busta paga), e la richiesta passa dal nulla osta del Direttore.
-- Applicata come migrazione ferie_richieste_compenso_2026_09_24.
alter table public.s_ferie_richieste add column if not exists compenso text;
alter table public.s_ferie_richieste drop constraint if exists s_ferie_richieste_compenso_check;
alter table public.s_ferie_richieste add constraint s_ferie_richieste_compenso_check
  check (compenso is null or compenso in ('recupero', 'paga'));
comment on column public.s_ferie_richieste.compenso is
  'Solo per tipo = supplementari: recupero = alimenta la banca ore, paga = in busta paga. E'' la scelta del lavoratore, sottoposta al Direttore.';
