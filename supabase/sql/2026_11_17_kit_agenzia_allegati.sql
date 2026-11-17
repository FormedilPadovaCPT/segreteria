-- 17/11/2026 — Il kit per l'agenzia porta le immagini e i video (chiesto dall'utente:
-- «nel kit dell'agenzia deve essere completo con le immagini, eventualmente anche i video»).
-- Prima il kit era una bozza .eml coi soli testi. Ora allega:
--   1) le immagini del post (copertina e carosello, bucket pubblico social-media);
--   2) il video per Telegram, se c'è ancora (si cancella dopo la pubblicazione sul canale);
--   3) il MATERIALE PER L'AGENZIA: file caricati apposta, nei formati che servono a
--      Instagram, Facebook e LinkedIn (1080x1350, 1080x1080, video verticale...), in
--      dimensione originale. Non vanno su Telegram né nell'app servizi.
-- I file del punto 3 stanno nel bucket PRIVATO social-kit: li legge e li scrive solo la
-- segreteria, perché sono materiale ancora da pubblicare.
-- La colonna non è fra quelle che s_post_regola blocca mentre il post aspetta il
-- Direttore: il materiale per l'agenzia si può preparare anche in quel momento.

alter table public.s_post
  add column if not exists kit_allegati jsonb not null default '[]'::jsonb;
alter table public.s_post
  drop constraint if exists s_post_kit_allegati_ck;
alter table public.s_post
  add constraint s_post_kit_allegati_ck check (jsonb_typeof(kit_allegati) = 'array');
comment on column public.s_post.kit_allegati is
  'Materiale per l''agenzia (17/11/2026): [{nome, path, mime, dimensione, caricato_il}] nel bucket privato social-kit; il kit .eml lo allega insieme alle immagini e al video del post.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-kit', 'social-kit', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists social_kit_lettura on storage.objects;
drop policy if exists social_kit_carica on storage.objects;
drop policy if exists social_kit_togli on storage.objects;
create policy social_kit_lettura on storage.objects for select to authenticated
  using (bucket_id = 'social-kit' and (select public.is_segreteria()));
create policy social_kit_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'social-kit' and (select public.is_segreteria()) and name like 'post-%/%');
create policy social_kit_togli on storage.objects for delete to authenticated
  using (bucket_id = 'social-kit' and (select public.is_segreteria()));
