-- ============================================================
-- RISCONTRO MENSILE CON LA BUSTA PAGA (02/10/2026)
--
-- Proposta approvata dall'utente dopo il confronto con 20 buste: ogni mese si
-- scrivono le cifre del riquadro «Riposi» del cedolino — GODUTO A.C. e
-- RESIDUO TOT., in centesimi d'ora — e l'app le confronta con le proprie
-- righe fino a fine mese. È il controllo fatto a mano il 02/10, ridotto a un
-- minuto al mese. Valori in minuti con due decimali (106,64 h = 6398,4 min).
-- ============================================================

create table if not exists public.s_presenze_busta (
  dipendente       text not null,
  anno             int  not null check (anno between 2009 and 2100),
  mese             int  not null check (mese between 1 and 12),
  monte            text not null check (monte in ('ferie', 'ex_festivita', 'rol')),
  goduto_ac_min    numeric(10,2) not null check (goduto_ac_min >= 0),
  residuo_tot_min  numeric(10,2),
  fonte            text,
  aggiornato_da    text,
  updated_at       timestamptz not null default now(),
  primary key (dipendente, anno, mese, monte)
);

alter table public.s_presenze_busta enable row level security;
drop policy if exists sgr_presenze_busta_all on public.s_presenze_busta;
create policy sgr_presenze_busta_all on public.s_presenze_busta
  for all using (is_segreteria()) with check (is_segreteria());
revoke all on public.s_presenze_busta from anon;
grant select, insert, update, delete on public.s_presenze_busta to authenticated;

-- spettanze 2025 (residuo A.P. dalla busta di dicembre 2024, maturato annuo dalla busta di dicembre 2025)
insert into public.s_presenze_spettanze (dipendente, anno, monte, spettanza_min, residuo_iniziale_min, fonte, aggiornato_da)
values ('Renato Squizzato', 2025, 'ferie', 160.00*60, 70.00*60, 'busta paga dicembre 2024 (residuo) e dicembre 2025 (maturato)', 'claude (dalle buste paga, ok utente 02/10/2026)'),
       ('Renato Squizzato', 2025, 'ex_festivita', 26.68*60, 136.90*60, 'busta paga dicembre 2024 (residuo) e dicembre 2025 (maturato)', 'claude (dalle buste paga, ok utente 02/10/2026)')
on conflict (dipendente, anno, monte) do nothing;

-- riscontro: le buste lette il 02/10/2026 (gennaio 2025 – agosto 2026; giugno 2026 mancante)
insert into public.s_presenze_busta (dipendente, anno, mese, monte, goduto_ac_min, residuo_tot_min, fonte, aggiornato_da)
select 'Renato Squizzato', v.anno, v.mese, v.monte, v.goduto*60, v.residuo*60, 'busta paga ' || v.mese || '/' || v.anno, 'claude (dalle buste paga, ok utente 02/10/2026)'
from (values
  (2025,1,'ferie',8.00,75.33),(2025,2,'ferie',8.00,88.66),(2025,3,'ferie',8.00,101.99),(2025,4,'ferie',8.00,115.32),
  (2025,5,'ferie',8.00,128.65),(2025,6,'ferie',16.00,133.98),(2025,7,'ferie',24.00,139.31),(2025,8,'ferie',114.00,62.64),
  (2025,9,'ferie',114.00,75.97),(2025,10,'ferie',114.00,89.30),(2025,11,'ferie',114.00,102.63),(2025,12,'ferie',136.00,94.00),
  (2025,1,'ex_festivita',0.00,139.12),(2025,2,'ex_festivita',0.00,141.34),(2025,3,'ex_festivita',0.00,143.56),(2025,4,'ex_festivita',0.00,145.78),
  (2025,5,'ex_festivita',0.00,148.00),(2025,6,'ex_festivita',0.00,150.22),(2025,7,'ex_festivita',1.00,151.44),(2025,8,'ex_festivita',1.00,153.66),
  (2025,9,'ex_festivita',1.00,155.88),(2025,10,'ex_festivita',1.00,158.10),(2025,11,'ex_festivita',9.00,152.32),(2025,12,'ex_festivita',11.00,152.58),
  (2026,1,'ferie',6.00,101.33),(2026,2,'ferie',6.00,114.66),(2026,3,'ferie',6.00,127.99),(2026,4,'ferie',6.00,141.32),
  (2026,5,'ferie',6.00,154.65),(2026,7,'ferie',18.00,169.31),(2026,8,'ferie',130.00,70.64),
  (2026,1,'ex_festivita',8.00,146.80),(2026,2,'ex_festivita',9.00,148.02),(2026,3,'ex_festivita',9.00,150.24),(2026,4,'ex_festivita',9.00,152.46),
  (2026,5,'ex_festivita',9.00,154.68),(2026,7,'ex_festivita',11.00,157.12),(2026,8,'ex_festivita',11.00,159.34)
) as v(anno, mese, monte, goduto, residuo)
on conflict (dipendente, anno, mese, monte) do nothing;
