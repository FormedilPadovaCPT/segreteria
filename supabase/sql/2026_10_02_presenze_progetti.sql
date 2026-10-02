-- ============================================================
-- Ore del personale sui PROGETTI (02/10/2026)
--
-- Le righe di «dettaglio attività» delle presenze (s_presenze_extra:
-- riunioni, formazione, progettazione…) si collegano ai progetti di
-- s_progetti_formativi, così la rendicontazione di un progetto mostra
-- anche le ore dell'ufficio e i contatori le contano per progetto.
--
-- Una riga può servire a PIÙ progetti: la progettazione CAM 2021-22 è di
-- tutti e due i corsi CAM, e l'utente ha deciso «metà ore ciascuno».
-- Per questo è una tabella di collegamento con la QUOTA della riga che
-- va a ogni progetto (1 = tutta, 0.5 = metà), e non una colonna.
-- Le quote di una riga non superano 1: le ore non si moltiplicano.
-- ============================================================

create table if not exists public.s_presenze_extra_progetti (
  extra_id    bigint  not null references public.s_presenze_extra(id) on delete cascade,
  progetto_id bigint  not null references public.s_progetti_formativi(id),
  quota       numeric not null default 1 check (quota > 0 and quota <= 1),
  creato_da   text,
  created_at  timestamptz not null default now(),
  primary key (extra_id, progetto_id)
);
create index if not exists s_presenze_extra_progetti_prog on public.s_presenze_extra_progetti (progetto_id);

alter table public.s_presenze_extra_progetti enable row level security;
drop policy if exists sgr_presenze_extra_progetti_all on public.s_presenze_extra_progetti;
create policy sgr_presenze_extra_progetti_all on public.s_presenze_extra_progetti
  for all using (is_segreteria()) with check (is_segreteria());
revoke all on public.s_presenze_extra_progetti from anon;
grant select, insert, update, delete on public.s_presenze_extra_progetti to authenticated;

-- la somma delle quote di una riga non supera 1
create or replace function public.s_presenze_extra_progetti_quota_ok()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select coalesce(sum(quota), 0) from public.s_presenze_extra_progetti where extra_id = new.extra_id) > 1.0001 then
    raise exception 'Le quote dei progetti della riga % superano il totale delle ore', new.extra_id;
  end if;
  return new;
end $$;
drop trigger if exists s_presenze_extra_progetti_quota on public.s_presenze_extra_progetti;
create constraint trigger s_presenze_extra_progetti_quota
  after insert or update on public.s_presenze_extra_progetti
  deferrable initially deferred
  for each row execute function public.s_presenze_extra_progetti_quota_ok();

-- ── storico: abbinamenti confermati dall'utente il 02/10/2026 ──
--   «Progettazione SPISAL (2018 MOG)»            → 5  MOG (iniziato nel 2018, andato oltre)
--   «Progettazione SPISAL (2021 AUDIT)»          → 4  Auditor 45001/14001/231 (è la sua progettazione)
--   «Progetto SPISAL (2022 Sicuri si Diventa)»   → 9  Sicuri si diventa
--   «Progetto SPISAL (2022 Soft Skills sicurezza)» → 10 Soft Skills sicurezza
--   «Progettazione CAM (Direttiva Costruzioni)»  → 6 e 7, metà ciascuno (i due corsi CAM)
--   «Progetto SPISAL (2022 Simulatore)» resta SENZA progetto: non è
--   «La realtà virtuale…» (l'utente: «simulatore e realtà son cose diverse»).
insert into public.s_presenze_extra_progetti (extra_id, progetto_id, quota, creato_da)
select e.id, m.progetto_id, m.quota, 'storico, abbinamento confermato dall''utente 02/10/2026'
from public.s_presenze_extra e
join (values
  ('Progettazione SPISAL (2018 MOG)', 5, 1.0),
  ('Progettazione SPISAL (2021 AUDIT)', 4, 1.0),
  ('Progetto SPISAL (2022 Sicuri si Diventa)', 9, 1.0),
  ('Progetto SPISAL (2022 Soft Skills sicurezza)', 10, 1.0),
  ('Progettazione CAM (Direttiva Costruzioni)', 6, 0.5),
  ('Progettazione CAM (Direttiva Costruzioni)', 7, 0.5)
) as m(causale, progetto_id, quota) on m.causale = e.causale
on conflict (extra_id, progetto_id) do nothing;
