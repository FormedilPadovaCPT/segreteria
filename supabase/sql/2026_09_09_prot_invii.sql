-- Applicata il 09/09/2026 (migrazione `s_prot_invii_storico_mail`).
-- Che cosa abbiamo scritto e mandato con un protocollo.
--
-- Segnalato dall'utente: nel dialogo «Invia protocollato» si scrive il testo
-- della comunicazione, la bozza parte, e poi «che fine fa che poi non lo vedo
-- più». Il testo viveva solo nel textarea. Sul protocollo restavano
-- `mail_inviata_at` e `mail_destinatari`, un solo posto per una sola mail —
-- ma un protocollo di mail ne genera più d'una, e di nessuna si vedeva il testo.
--
-- Si registra che la bozza è stata PREPARATA, non che è partita: l'app prepara
-- e la persona invia a mano. `inviata_at` si valorizza solo se qualcuno lo
-- conferma dal dettaglio del protocollo.
create table if not exists public.s_prot_invii (
  id             bigint generated always as identity primary key,
  protocollo_id  bigint not null references public.s_protocollo(id) on delete cascade,
  modo           text not null,
  canale         text not null,
  destinatari    text[] not null default '{}',
  cc             text[] not null default '{}',
  oggetto        text,
  testo          text,
  allegati       text[] not null default '{}',
  preparata_at   timestamptz not null default now(),
  preparata_da   text,
  inviata_at     timestamptz,
  inviata_da     text
);

create index if not exists s_prot_invii_prot_idx on public.s_prot_invii (protocollo_id, preparata_at desc);

alter table public.s_prot_invii enable row level security;

create policy s_prot_invii_view on public.s_prot_invii
  for select to authenticated using (public.is_segreteria());
create policy s_prot_invii_ins on public.s_prot_invii
  for insert to authenticated with check (public.is_segreteria());
create policy s_prot_invii_upd on public.s_prot_invii
  for update to authenticated using (public.is_segreteria()) with check (public.is_segreteria());
create policy s_prot_invii_del on public.s_prot_invii
  for delete to authenticated using (public.is_segreteria());
