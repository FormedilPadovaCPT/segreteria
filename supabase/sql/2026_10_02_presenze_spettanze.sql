-- ============================================================
-- SPETTANZE di ferie e permessi, per il saldo (02/10/2026)
--
-- L'utente vuole «un'idea del saldo» di ferie e permessi, come quello
-- della banca ore. Il goduto c'è (righe «Ferie» e «Permesso» di
-- s_presenze_extra, dal 2012), ma le ORE SPETTANTI non erano agli atti
-- da nessuna parte: non si ricavano dal contratto a stima, si scrivono
-- dalla busta paga. Una riga per dipendente, anno e monte:
--   spettanza_min        ore che maturano nell'anno (in minuti)
--   residuo_iniziale_min residuo dell'anno prima al 1° gennaio, dalla
--                        busta paga; NULL = si riporta il saldo calcolato
--                        dell'anno prima, se c'è
--   fonte                da dove viene il numero (es. «busta paga 12/2025»)
-- ============================================================

create table if not exists public.s_presenze_spettanze (
  dipendente           text    not null,
  anno                 int     not null check (anno between 2009 and 2100),
  monte                text    not null check (monte in ('ferie', 'permessi')),
  spettanza_min        int     not null check (spettanza_min >= 0),
  residuo_iniziale_min int,
  fonte                text,
  note                 text,
  aggiornato_da        text,
  updated_at           timestamptz not null default now(),
  primary key (dipendente, anno, monte)
);

alter table public.s_presenze_spettanze enable row level security;
drop policy if exists sgr_presenze_spettanze_all on public.s_presenze_spettanze;
create policy sgr_presenze_spettanze_all on public.s_presenze_spettanze
  for all using (is_segreteria()) with check (is_segreteria());
revoke all on public.s_presenze_spettanze from anon;
grant select, insert, update, delete on public.s_presenze_spettanze to authenticated;
