-- ============================================================
-- Secondi indirizzi — 28/09/2026
-- C'è chi la casella d'ufficio non la guarda mai: ogni bozza di mail della
-- segreteria che va a «email» va ANCHE a «anche_a». L'indirizzo d'ufficio
-- resta, perché è l'account con cui si entra nelle app.
-- Le righe si scrivono dal pannello o con una insert: qui NON ci sono
-- indirizzi, il repository è pubblico.
-- Legge solo chi prepara le bozze (segreteria e coordinatore): un indirizzo
-- personale non è un dato da mostrare a tutti i colleghi.
-- Per tornare indietro: 2026_09_28_secondi_indirizzi_ANNULLA.sql
-- ============================================================
create table if not exists public.s_secondi_indirizzi (
  email text primary key check (email = lower(email)),
  anche_a text not null check (anche_a ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nota text,
  aggiornato_da text,
  updated_at timestamptz not null default now()
);
comment on table public.s_secondi_indirizzi is 'Chi non legge la casella d''ufficio: ogni bozza di mail della segreteria che va a «email» va anche a «anche_a». L''indirizzo d''ufficio resta (è quello dell''account), l''altro si aggiunge. Dal 28/09/2026.';
alter table public.s_secondi_indirizzi enable row level security;
drop policy if exists sec_ind_sel on public.s_secondi_indirizzi;
create policy sec_ind_sel on public.s_secondi_indirizzi for select to authenticated
  using ((select public.is_segreteria()) or (select public.is_coordinatore()));
drop policy if exists sec_ind_scrivi on public.s_secondi_indirizzi;
create policy sec_ind_scrivi on public.s_secondi_indirizzi for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
revoke all on public.s_secondi_indirizzi from anon;
grant select, insert, update, delete on public.s_secondi_indirizzi to authenticated;
