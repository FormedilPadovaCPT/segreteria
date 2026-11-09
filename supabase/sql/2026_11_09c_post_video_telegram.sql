-- Video dei post per Telegram (09/11/2026, scelta dell'utente «YouTube + Telegram").
-- Il video breve (MP4) si carica dalla scheda del post solo per mandarlo al canale
-- Telegram come video vero: Telegram ne tiene la sua copia, e dopo la pubblicazione
-- il file si CANCELLA da qui (non deve pesare su spazio e traffico del progetto).
-- Per l'app servizi resta il link YouTube (s_post.video_url), che non pesa.

alter table public.s_post
  add column if not exists video_file_url text,
  add column if not exists video_file_path text;

comment on column public.s_post.video_file_url is
  'MP4 temporaneo per Telegram (bucket social-video): si cancella dopo la pubblicazione sul canale';
comment on column public.s_post.video_file_path is
  'percorso del MP4 temporaneo nel bucket social-video';

-- bucket separato da quello delle immagini: solo MP4, al massimo 20 MB (limite di
-- Telegram per i video mandati con un indirizzo). Pubblico in lettura perché
-- Telegram lo scarica dall'indirizzo; scrive solo la funzione redazione-social
-- (service role, URL firmato per il caricamento): nessuna policy per i client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-video', 'social-video', true, 20971520, array['video/mp4'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
