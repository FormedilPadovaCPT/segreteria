-- ============================================================
-- ORARIO SETTIMANALE del dipendente, per dire le ferie in GIORNI (02/10/2026)
--
-- L'utente vuole vedere le ferie anche in giorni, e i suoi giorni non sono
-- tutti uguali: part-time verticale lunedì 6 h, martedì-giovedì 8 h,
-- venerdì-domenica riposo (30 h = 83,33% di 36, come in busta). Scelta
-- dell'utente: il giorno si conta SUL SUO ORARIO VERO, non a 8 h fisse né
-- col divisore della busta (6 h = 156/26).
-- Una riga per dipendente e data da cui vale: un cambio d'orario non
-- riscrive il passato (regola d'oro 7). Ore in minuti per giorno.
-- ============================================================

create table if not exists public.s_presenze_orari (
  dipendente    text not null,
  dal           date not null,
  lun_min       numeric(6,2) not null default 0 check (lun_min >= 0 and lun_min <= 1440),
  mar_min       numeric(6,2) not null default 0 check (mar_min >= 0 and mar_min <= 1440),
  mer_min       numeric(6,2) not null default 0 check (mer_min >= 0 and mer_min <= 1440),
  gio_min       numeric(6,2) not null default 0 check (gio_min >= 0 and gio_min <= 1440),
  ven_min       numeric(6,2) not null default 0 check (ven_min >= 0 and ven_min <= 1440),
  sab_min       numeric(6,2) not null default 0 check (sab_min >= 0 and sab_min <= 1440),
  dom_min       numeric(6,2) not null default 0 check (dom_min >= 0 and dom_min <= 1440),
  fonte         text,
  aggiornato_da text,
  updated_at    timestamptz not null default now(),
  primary key (dipendente, dal)
);

alter table public.s_presenze_orari enable row level security;
drop policy if exists sgr_presenze_orari_all on public.s_presenze_orari;
create policy sgr_presenze_orari_all on public.s_presenze_orari
  for all using (is_segreteria()) with check (is_segreteria());
revoke all on public.s_presenze_orari from anon;
grant select, insert, update, delete on public.s_presenze_orari to authenticated;

-- orario di Renato Squizzato, verificato sulle presenze 2026 (mediana per
-- giorno: lun 6,33 h, mar-gio 8,16-8,25 h) e sulla busta (part-time 83,33%,
-- venerdì «R1 riposo settimanale»). Dal 1/1/2026 perché è il periodo verificato:
-- per gli anni prima l'orario non è stato controllato e non si presume
insert into public.s_presenze_orari (dipendente, dal, lun_min, mar_min, mer_min, gio_min, fonte, aggiornato_da)
values ('Renato Squizzato', '2026-01-01', 360, 480, 480, 480,
        'busta paga (part-time 83,33%, venerdì riposo) e presenze 2026', 'claude (scelta utente 02/10/2026)')
on conflict (dipendente, dal) do nothing;
