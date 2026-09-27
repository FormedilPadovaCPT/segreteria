-- ============================================================
-- Zone dei tecnici con le date, come in Access — 27/09/2026
-- (fase A: solo database, le app non cambiano)
--
-- Access teneva le zone in due tabelle:
--   TAreaTecnici  = le 56 aree (un «pacchetto» di comuni e quartieri di Padova),
--                   con il tecnico scritto come testo nell'etichetta;
--   T_Area2       = quali comuni stavano in ogni area, dal… al… (997 righe).
-- Su Supabase era arrivata solo la fotografia di oggi (tecnici_zone, 16/07/2026),
-- senza date e senza aree. Qui si rifà il modello di Access con i legami veri:
--   zone_aree          le 56 aree, con i numeri di Access (li portano già le
--                      lettere mensili storiche: s_incarichi_mensili.area_zona);
--   zone_aree_tecnici  chi aveva l'area, dal… al… — ricostruito dalle lettere
--                      mensili effettivamente mandate, non dall'etichetta;
--   zone_aree_comuni   comuni e quartieri dell'area, dal… al… (da T_Area2).
-- Padova: nei verbali resta «PADOVA», il quartiere è solo gestione interna e
-- si calcola dallo stradario (file 2026_09_27_stradario_padova.sql).
--
-- tecnici_zone diventa una VISTA su «oggi» con le stesse righe di prima
-- (verificato: 113 su 113), così proposta del tecnico, mappa, lettera mensile
-- e «la mia zona» continuano a funzionare senza toccare il codice.
-- La tabella vecchia va in archivio, non si cancella.
-- Per tornare indietro: 2026_09_27_zone_aree_ANNULLA.sql
-- ============================================================

create table public.zone_aree (
  area_id     integer primary key,
  etichetta   text not null,          -- «Campo1» di Access: «202207Camuffo202307», «2025Canova»…
  descrizione text,                   -- «Area» di Access: l'elenco dei comuni come testo
  note        text,
  created_at  timestamptz not null default now()
);
comment on table public.zone_aree is 'Aree dei tecnici (pacchetti di comuni/quartieri), numerate come in Access TAreaTecnici. Chi le ha: zone_aree_tecnici; che cosa contengono: zone_aree_comuni.';

create table public.zone_aree_tecnici (
  id          bigint generated always as identity primary key,
  area_id     integer not null references public.zone_aree(area_id),
  tecnico_id  text references public.tecnici(tecnico_id),
  persona_id  uuid references public.persone(persona_id),
  nome        text not null,          -- come appare nelle fonti (cognome o casella)
  dal         date not null,
  al          date,                   -- null = ancora oggi
  fonte       text not null,
  creato_da   text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now(),
  constraint zone_aree_tecnici_periodo check (al is null or al >= dal)
);
comment on table public.zone_aree_tecnici is 'Chi aveva ogni area e quando. Un''area può avere due tecnici nello stesso periodo (es. 45, 47). Storico ricostruito il 27/09/2026 dalle lettere mensili (s_incarichi_mensili.area_zona).';
create index ix_zone_aree_tecnici_area_id    on public.zone_aree_tecnici (area_id);
create index ix_zone_aree_tecnici_tecnico_id on public.zone_aree_tecnici (tecnico_id);
create index ix_zone_aree_tecnici_persona_id on public.zone_aree_tecnici (persona_id);

create table public.zone_aree_comuni (
  id          bigint generated always as identity primary key,
  area_id     integer not null references public.zone_aree(area_id),
  comune_nome text not null,          -- come cantieri.comune_nome (maiuscolo, apostrofi)
  quartiere   smallint,               -- solo per PADOVA: 1..6 (Q1 Centro … Q6 Ovest)
  dal         date not null,
  al          date,                   -- null = ancora oggi
  access_id   integer unique,         -- IDArea2 di Access
  fonte       text not null,
  creato_da   text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now(),
  constraint zone_aree_comuni_periodo check (al is null or al >= dal),
  constraint zone_aree_comuni_quartiere check (quartiere is null or (comune_nome = 'PADOVA' and quartiere between 1 and 6))
);
comment on table public.zone_aree_comuni is 'Comuni (e quartieri di Padova) di ogni area, dal… al…. Spostare un comune = chiudere la riga (al) e aprirne una nell''area nuova. Importato da Access T_Area2 il 27/09/2026.';
create index ix_zone_aree_comuni_area_id on public.zone_aree_comuni (area_id);
create index ix_zone_aree_comuni_comune on public.zone_aree_comuni (comune_nome, quartiere);
-- un comune (o quartiere) sta in una sola area alla volta
create unique index zone_aree_comuni_uno_aperto on public.zone_aree_comuni (comune_nome, coalesce(quartiere, 0)) where al is null;

-- permessi: come tecnici_zone — legge il personale, scrive la segreteria
alter table public.zone_aree         enable row level security;
alter table public.zone_aree_tecnici enable row level security;
alter table public.zone_aree_comuni  enable row level security;
do $$
declare t text;
begin
  foreach t in array array['zone_aree','zone_aree_tecnici','zone_aree_comuni'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_personale()))', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_segreteria()))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_segreteria()))', t||'_del', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
