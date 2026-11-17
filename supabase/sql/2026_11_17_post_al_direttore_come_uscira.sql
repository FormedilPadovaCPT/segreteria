-- 17/11/2026 — Il Direttore vede il post COME USCIRÀ, video e materiale per l'agenzia compresi
-- (chiesto dall'utente: «il direttore in comunicazione vede … i post, come apparirebbero,
-- quindi anche il video di Telegram»).
-- 1) La fotografia del post mandata a Coordinatore e Direttore porta anche il video per
--    Telegram (sul canale il post esce come video, non con le immagini) e il materiale per
--    l'agenzia (s_post.kit_allegati), che prima mancavano.
-- 2) Mentre il post aspetta, anche video e materiale per l'agenzia restano fermi: ciò che il
--    Direttore approva è ciò che esce. (Supera la riga del 17/11 mattina che li lasciava
--    aggiungere anche durante l'attesa.)
-- 3) Coordinatore e Direttore leggono i file del materiale per l'agenzia (bucket privato
--    social-kit), per vederli nella pagina Comunicazione del gestionale. Scrive solo la segreteria.

create or replace function public.s_post_istantanea(p s_post)
 returns jsonb
 language sql
 immutable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'titolo', p.titolo, 'pilastro', p.pilastro, 'fonte', p.fonte, 'fonte_url', p.fonte_url, 'norma', p.norma,
    'verifica', p.verifica, 'testo_telegram', p.testo_telegram, 'testo_app', p.testo_app,
    'testo_linkedin', p.testo_linkedin, 'testo_instagram', p.testo_instagram, 'hashtag', p.hashtag,
    'immagine_url', p.immagine_url, 'immagini', coalesce(p.immagini, '[]'::jsonb), 'video_url', p.video_url,
    'video_file_url', p.video_file_url, 'kit_allegati', coalesce(p.kit_allegati, '[]'::jsonb),
    'immagine_suggerita', p.immagine_suggerita, 'data_programmata', p.data_programmata,
    'evidenza_fino_al', p.evidenza_fino_al)
$function$;

create or replace function public.s_post_regola()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.post_via_funzione', true), '') = 'si' then return new; end if;
  if tg_op = 'INSERT' then
    if new.stato <> 'bozza' then
      raise exception 'Un post nuovo nasce come bozza: approvarlo spetta al Direttore';
    end if;
    return new;
  end if;
  if new.stato is distinct from old.stato then
    if new.stato in ('al_coordinatore', 'al_direttore', 'alla_presidenza') or old.stato in ('al_coordinatore', 'al_direttore', 'alla_presidenza') then
      raise exception 'Il post si manda in approvazione, e si ritira, solo coi pulsanti della pagina Comunicazione';
    end if;
    if new.stato = 'approvato' then
      raise exception 'Un post lo approva il Direttore, nella pagina Comunicazione del gestionale';
    end if;
    if new.stato = 'pubblicato' and old.stato not in ('approvato', 'pubblicato') then
      raise exception 'Si pubblica solo un post approvato dal Direttore';
    end if;
  end if;
  if old.stato in ('al_coordinatore', 'al_direttore', 'alla_presidenza') and (
       new.titolo is distinct from old.titolo or new.pilastro is distinct from old.pilastro
    or new.testo_telegram is distinct from old.testo_telegram or new.testo_app is distinct from old.testo_app
    or new.testo_linkedin is distinct from old.testo_linkedin or new.testo_instagram is distinct from old.testo_instagram
    or new.hashtag is distinct from old.hashtag or new.immagine_url is distinct from old.immagine_url
    or new.immagini is distinct from old.immagini or new.video_url is distinct from old.video_url
    or new.video_file_url is distinct from old.video_file_url or new.kit_allegati is distinct from old.kit_allegati) then
    raise exception 'Il post è %: mentre aspetta non si cambia. Per correggerlo, prima «Ritira»',
      case old.stato when 'al_coordinatore' then 'dal Coordinatore' when 'al_direttore' then 'dal Direttore' else 'dalla Presidenza' end;
  end if;
  return new;
end $function$;

drop policy if exists social_kit_lettura on storage.objects;
create policy social_kit_lettura on storage.objects for select to authenticated
  using (bucket_id = 'social-kit' and ((select public.is_segreteria()) or (select public.is_direttore()) or (select public.is_coordinatore())));
