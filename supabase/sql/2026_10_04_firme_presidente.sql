-- ============================================================
-- DOCUMENTI DA FIRMARE DAL PRESIDENTE, NELL'APP (04/10/2026)
--
-- Chiesto dall'utente: «ci son due tipi di documenti che oggi hanno il
-- giro cartaceo che richiede un sacco di tempo perché sono a firma del
-- Presidente … vorrei poter fare come per il Direttore che il Presidente
-- possa firmare questi documenti sull'app». I due tipi sono le LETTERE DI
-- INCARICO: quelle del gruppo di verifica dell'asseverazione e quelle di
-- docenza dei corsi.
--
-- Il giro (scelte dell'utente, stesso giorno):
--   1. la segreteria genera e protocolla la lettera, poi «Chiedi la firma
--      al Presidente»: l'app conserva QUEL PDF (la fotografia esatta di ciò
--      che il Presidente leggerà) e l'avviso al Presidente PARTE DA SOLO —
--      mail + notifica — perché il testo si legge tutto dal database;
--   2. il Presidente, nella sua pagina del gestionale, apre il PDF e preme
--      «Firmo» (o «Rimando» col motivo): la firma scansionata si appone SU
--      QUEL PDF, con data, ora e nome, e l'impronta (sha256) dell'originale
--      si ricontrolla prima di firmare;
--   3. la segreteria trova la versione firmata, la mette nel dossier e
--      prepara la mail al destinatario (la manda una persona, come sempre);
--   4. l'originale firmato a mano è FACOLTATIVO: se c'è, si segna la data.
-- La firma vale solo dopo il «Firmo»: dal 04/10/2026 la lettera di docenza
-- non stampa più da sola la firma del Presidente. Firma solo il Presidente
-- (non il Vicepresidente).
--
-- Si scrive SOLO dalla edge function `firma-presidente` (service role) e
-- dalle due RPC qui sotto: nessuna policy di scrittura sulla tabella.
-- ============================================================

-- chi è il Presidente: l'indirizzo in s_config, con un accesso attivo
create or replace function public.is_presidente()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.s_config c
     where c.chiave = 'presidente_email'
       and lower(trim(c.valore)) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) and exists (
    select 1 from public.app_ruoli
     where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       and stato = 'attivo'
  );
$$;
revoke all on function public.is_presidente() from public, anon;
grant execute on function public.is_presidente() to authenticated;

create table if not exists public.s_firme_presidente (
  id               bigint generated always as identity primary key,
  tipo             text not null check (tipo in ('incarico_assev', 'incarico_docenza')),
  -- il documento d'origine: 'gdv:<pratica_id>:<tecnico_id>' oppure 'docenza:<s_corsi_incarichi.id>'
  rif              text not null,
  protocollo_id    bigint references public.s_protocollo(id) on delete set null,
  titolo           text not null,
  destinatario     text,
  nome_file        text not null,
  -- la fotografia del PDF che il Presidente legge (bucket firme-presidente)
  file_originale   text not null,
  sha256_originale text not null,
  -- dove va la firma: pagina (0 = la prima), x, y, w, h in punti PDF, origine in basso a sinistra
  riquadro         jsonb not null,
  file_firmato     text,
  sha256_firmato   text,
  stato            text not null default 'in_attesa'
                   check (stato in ('in_attesa', 'firmata', 'rimandata', 'ritirata')),
  richiesta_da     text not null,
  richiesta_il     timestamptz not null default now(),
  avviso_il        timestamptz,
  avviso_esito     text,
  firmata_da       text,
  firmata_il       timestamptz,
  rimandata_il     timestamptz,
  rimandata_motivo text,
  ritirata_il      timestamptz,
  ritirata_da      text,
  -- l'originale cartaceo firmato a mano, se c'è (facoltativo)
  autografo_il     date,
  autografo_da     text,
  -- quando la segreteria ha messo la versione firmata nel dossier / nella mail
  usata_il         timestamptz
);
comment on table public.s_firme_presidente is
  'Documenti a firma del Presidente firmati nell''app (04/10/2026): lettere di incarico asseverazione e docenza. Si scrive solo dalla edge function firma-presidente e dalle RPC s_firma_*.';

-- un documento ha al più una richiesta viva (in attesa o firmata)
create unique index if not exists s_firme_presidente_viva
  on public.s_firme_presidente (tipo, rif) where stato in ('in_attesa', 'firmata');
create index if not exists s_firme_presidente_stato on public.s_firme_presidente (stato, richiesta_il desc);

alter table public.s_firme_presidente enable row level security;
drop policy if exists s_firme_presidente_lettura on public.s_firme_presidente;
create policy s_firme_presidente_lettura on public.s_firme_presidente
  for select to authenticated using (public.is_segreteria() or public.is_presidente());
revoke all on public.s_firme_presidente from anon;
grant select on public.s_firme_presidente to authenticated;

-- l'originale firmato a mano: lo segna la segreteria (null = toglie il segno)
create or replace function public.s_firma_autografo(p_id bigint, p_data date)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_segreteria() then raise exception 'Lo segna la segreteria.'; end if;
  update s_firme_presidente
     set autografo_il = p_data,
         autografo_da = case when p_data is null then null else lower(auth.jwt() ->> 'email') end
   where id = p_id and stato = 'firmata';
  if not found then raise exception 'Documento non trovato, o non ancora firmato nell''app.'; end if;
end $$;
revoke all on function public.s_firma_autografo(bigint, date) from public, anon;
grant execute on function public.s_firma_autografo(bigint, date) to authenticated;

-- la versione firmata è stata messa nel dossier / nella mail
create or replace function public.s_firma_usata(p_id bigint)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public.is_segreteria() then raise exception 'Lo segna la segreteria.'; end if;
  update s_firme_presidente set usata_il = coalesce(usata_il, now()) where id = p_id and stato = 'firmata';
end $$;
revoke all on function public.s_firma_usata(bigint) from public, anon;
grant execute on function public.s_firma_usata(bigint) to authenticated;

-- ── l'archivio dei PDF: privato, lo leggono solo segreteria e Presidente ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('firme-presidente', 'firme-presidente', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists firme_presidente_lettura on storage.objects;
create policy firme_presidente_lettura on storage.objects
  for select to authenticated
  using (bucket_id = 'firme-presidente' and (public.is_segreteria() or public.is_presidente()));

-- la segreteria carica la fotografia del documento (solo in originali/);
-- la versione firmata la scrive la edge function con la chiave di servizio
drop policy if exists firme_presidente_carica on storage.objects;
create policy firme_presidente_carica on storage.objects
  for insert to authenticated
  with check (bucket_id = 'firme-presidente' and public.is_segreteria() and name like 'originali/%');
