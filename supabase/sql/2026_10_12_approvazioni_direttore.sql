-- ============================================================
-- PREVENTIVI DA APPROVARE DAL DIRETTORE, NELL'APP (12/10/2026)
--
-- Chiesto dall'utente: il preventivo 5.D.2 dell'asseverazione esce a firma
-- del Direttore, ma l'app lo generava subito con timbro e firma. «Mi
-- piacerebbe si potesse preparare il preventivo e, come per altre richieste,
-- inviare un avviso sull'app al Direttore perché approvasse il preventivo
-- prima dell'invio, e solo dopo si possa generare con timbro e firma.»
--
-- Scelte dell'utente, stesso giorno:
--   * vale per il SOLO preventivo 5.D.2 (programma e piano restano come
--     sono: è il preventivo che impegna l'ente su un prezzo);
--   * il Direttore APPROVA oppure RIMANDA con una nota;
--   * l'avviso al Direttore parte da solo, mail + notifica: settima
--     eccezione INTERNA alla regola «l'app prepara, la persona manda», e
--     regge come le altre perché il testo si legge tutto dal database.
--
-- Il giro:
--   1. la segreteria prepara le voci e preme «Manda al Direttore»: l'app
--      conserva la BOZZA del PDF (senza firma, con la scritta BOZZA) e
--      l'impronta dei dati del preventivo (voci, addetti, SGSL, validità);
--   2. il Direttore, nella pagina «Direzione» del gestionale, apre la bozza
--      e preme «Approvo» o «Rimando» con la nota;
--   3. solo con l'approvazione viva e l'impronta UGUALE a quella di adesso
--      «Protocolla e genera» prende il numero, e il PDF esce con timbro e
--      firma. Se dopo l'approvazione una voce cambia, l'approvazione non
--      vale più: si rimanda al Direttore.
--
-- Si scrive SOLO dalla edge function `approvazione-direttore` (service
-- role): nessuna policy di scrittura sulla tabella.
-- ============================================================

create table if not exists public.s_approvazioni_direttore (
  id              bigint generated always as identity primary key,
  tipo            text not null check (tipo in ('preventivo_assev')),
  -- il documento d'origine: per il preventivo è l'id della pratica (a_pratica.id)
  rif             text not null,
  titolo          text not null,
  -- quello che il Direttore legge nell'elenco: impresa, pratica, giornate,
  -- importo, voci sotto il minimo della norma con la loro motivazione
  dettaglio       jsonb not null default '{}'::jsonb,
  -- impronta (sha256) dei dati che fanno il preventivo: si ricalcola quando
  -- si protocolla, e se è cambiata l'approvazione non vale più
  impronta_dati   text not null,
  -- la fotografia della bozza che il Direttore legge (bucket approvazioni-direttore)
  file_bozza      text not null,
  sha256_bozza    text not null,
  stato           text not null default 'in_attesa'
                  check (stato in ('in_attesa', 'approvata', 'rimandata', 'ritirata', 'superata')),
  richiesta_da    text not null,
  richiesta_il    timestamptz not null default now(),
  avviso_il       timestamptz,
  avviso_esito    text,
  decisa_da       text,
  decisa_il       timestamptz,
  -- la nota del Direttore: obbligatoria quando rimanda, facoltativa quando approva
  nota            text,
  chiusa_da       text,
  chiusa_il       timestamptz
);
comment on table public.s_approvazioni_direttore is
  'Documenti che il Direttore approva nell''app prima che escano a sua firma (12/10/2026): per ora il preventivo 5.D.2 dell''asseverazione. Si scrive solo dalla edge function approvazione-direttore.';

-- un documento ha al più una richiesta viva (in attesa o approvata)
create unique index if not exists s_approvazioni_direttore_viva
  on public.s_approvazioni_direttore (tipo, rif) where stato in ('in_attesa', 'approvata');
create index if not exists s_approvazioni_direttore_stato
  on public.s_approvazioni_direttore (stato, richiesta_il desc);

alter table public.s_approvazioni_direttore enable row level security;
drop policy if exists s_approvazioni_direttore_lettura on public.s_approvazioni_direttore;
create policy s_approvazioni_direttore_lettura on public.s_approvazioni_direttore
  for select to authenticated using (public.is_segreteria() or public.is_direttore());
revoke all on public.s_approvazioni_direttore from anon;
grant select on public.s_approvazioni_direttore to authenticated;

-- ── l'archivio delle bozze: privato, lo leggono solo segreteria e Direttore ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('approvazioni-direttore', 'approvazioni-direttore', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists approvazioni_direttore_lettura on storage.objects;
create policy approvazioni_direttore_lettura on storage.objects
  for select to authenticated
  using (bucket_id = 'approvazioni-direttore' and (public.is_segreteria() or public.is_direttore()));

-- la segreteria carica la bozza (solo in bozze/)
drop policy if exists approvazioni_direttore_carica on storage.objects;
create policy approvazioni_direttore_carica on storage.objects
  for insert to authenticated
  with check (bucket_id = 'approvazioni-direttore' and public.is_segreteria() and name like 'bozze/%');
