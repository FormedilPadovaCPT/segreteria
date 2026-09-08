-- ============================================================================
-- 2026-09-08 — Certificazioni delle imprese: da spunta a scheda
--
-- Chiesto dall'utente: nella scheda impresa della segreteria le certificazioni
-- devono avere tipo (a tendina), data del certificato, data di fine validità,
-- data dell'ultimo rinnovo, ente certificatore e note. Finora
-- imprese_certificazioni aveva solo (impresa_id, certificazione smallint 1-5):
-- la spunta del gestionale visite, senza date né ente.
--
-- Il codice numerico resta (il gestionale lo legge così, con la sua mappa
-- CERTIF_OPT 1-5); le etichette stanno ora in una tabella di riferimento,
-- così le due app leggono la stessa lista e si possono aggiungere tipi
-- senza toccare il codice. I tipi 6-9 sono nuovi e il gestionale non li
-- mostra: non è un errore, la sua modale «Nuova impresa» spunta solo 1-5.
-- ============================================================================

create table if not exists public.imprese_certificazioni_tipi (
  codice    smallint primary key,
  etichetta text not null,
  norma     text,
  attivo    boolean not null default true,
  ordine    smallint not null default 0
);
comment on table public.imprese_certificazioni_tipi is
  'Tipi di certificazione delle imprese (codice = imprese_certificazioni.certificazione). 1-5 sono quelli storici del gestionale visite (CERTIF_OPT); 6-9 aggiunti il 2026-09-08.';
insert into public.imprese_certificazioni_tipi (codice, etichetta, norma, ordine) values
  (1, 'Asseverazione MOG',                    'UNI 11751-1',       1),
  (2, 'Certificazione OHSAS 18001',           'BS OHSAS 18001',    2),
  (3, 'Sistema di gestione sicurezza',        'UNI EN ISO 45001',  3),
  (4, 'Sistema qualità',                      'UNI EN ISO 9001',   4),
  (5, 'Certificazione ambientale',            'UNI EN ISO 14001',  5),
  (6, 'Attestazione SOA',                     'D.P.R. 207/2010 / D.Lgs. 36/2023', 6),
  (7, 'Parità di genere',                     'UNI/PdR 125:2022',  7),
  (8, 'Responsabilità sociale',               'SA 8000',           8),
  (9, 'Altra certificazione (vedi note)',     null,                9)
on conflict (codice) do nothing;
alter table public.imprese_certificazioni_tipi enable row level security;
drop policy if exists imprese_certificazioni_tipi_sel on public.imprese_certificazioni_tipi;
create policy imprese_certificazioni_tipi_sel on public.imprese_certificazioni_tipi for select to authenticated using (true);
revoke all on public.imprese_certificazioni_tipi from public, anon;
grant select on public.imprese_certificazioni_tipi to authenticated;

alter table public.imprese_certificazioni
  add column if not exists data_certificato date,
  add column if not exists data_fine        date,
  add column if not exists data_rinnovo     date,
  add column if not exists ente             text,
  add column if not exists note             text,
  add column if not exists created_at       timestamptz not null default now(),
  add column if not exists updated_at       timestamptz,
  add column if not exists updated_by       text;
comment on column public.imprese_certificazioni.data_certificato is 'Data di prima emissione del certificato';
comment on column public.imprese_certificazioni.data_fine        is 'Fine validità del certificato in essere (si legge sul certificato, non si calcola)';
comment on column public.imprese_certificazioni.data_rinnovo     is 'Data dell''ultimo rinnovo o mantenimento';
comment on column public.imprese_certificazioni.ente             is 'Organismo che ha rilasciato il certificato (es. Bureau Veritas, RINA, FORMEDIL per l''asseverazione)';

-- il vincolo sui codici si allarga ai tipi nuovi e da oggi segue la tabella
alter table public.imprese_certificazioni drop constraint if exists imprese_certificazioni_certificazione_check;
alter table public.imprese_certificazioni
  add constraint imprese_certificazioni_certificazione_fkey
  foreign key (certificazione) references public.imprese_certificazioni_tipi(codice);

create or replace function public.imprese_certificazioni_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  return new;
end $$;
revoke execute on function public.imprese_certificazioni_touch() from public, anon;
drop trigger if exists trg_imprese_certificazioni_touch on public.imprese_certificazioni;
create trigger trg_imprese_certificazioni_touch
  before update on public.imprese_certificazioni
  for each row execute function public.imprese_certificazioni_touch();

-- ─── seconda parte, stesso giorno: le colonne che aveva Access e i tipi SGSL dello storico ─
-- (dall'export Query1.xlsx della tabella certificazioni di Access, 90 righe, mandato dall'utente)
alter table public.imprese_certificazioni
  add column if not exists numero      text,
  add column if not exists regolamento text,
  add column if not exists access_id   integer,
  add column if not exists fonte       text;
comment on column public.imprese_certificazioni.numero      is 'Numero dell''attestazione o del certificato, com''è scritto sul documento';
comment on column public.imprese_certificazioni.regolamento is 'Regolamento o schema di accreditamento citato sul certificato (es. D.P.R. 207/2010, Accredia RT-12)';
comment on column public.imprese_certificazioni.access_id   is 'ID_cert della tabella certificazioni di Access, per le righe importate il 2026-09-08';
create unique index if not exists ux_imprese_certificazioni_access_id on public.imprese_certificazioni(access_id) where access_id is not null;
insert into public.imprese_certificazioni_tipi (codice, etichetta, norma, ordine) values
  (10, 'MOG con SGSL secondo Linee guida UNI-INAIL',      'Linee guida UNI-INAIL 28.09.2001', 10),
  (11, 'MOG con SGSL conforme OHSAS 18001 (non certificato)', 'BS OHSAS 18001', 11),
  (12, 'MOG con SGSL da procedura interna aziendale',      null, 12)
on conflict (codice) do nothing;
-- L'import delle 90 righe sta in 2026_09_08_certificazioni_import_access.sql (generato da Query1.xlsx).
