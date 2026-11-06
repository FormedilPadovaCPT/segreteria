-- ============================================================
-- Post social: visto del Coordinatore e approvazione del Direttore (06/11/2026)
--
-- Deciso dall'utente (segreteria d'area) il 06/11/2026:
--   · la segreteria rilegge la bozza e la manda AL COORDINATORE (contenuti
--     tecnici) oppure direttamente AL DIRETTORE;
--   · il Coordinatore dà il visto — e allora il post passa comunque al
--     Direttore — oppure scrive una nota con le modifiche: il post torna
--     alla segreteria, che corregge il testo (lo tocca una persona sola);
--   · il Direttore approva, approva con indicazioni (la segreteria le
--     applica e pubblica senza ripassare da lui) o non approva con una nota;
--   · gli avvisi sono notifiche del gestionale, niente mail;
--   · pubblica sempre la segreteria, a mano, come prima.
--
-- Stesso disegno delle approvazioni dei preventivi (s_approvazioni_direttore):
-- una riga per ogni passaggio, con la fotografia di ciò che è stato mandato,
-- chi ha deciso, quando e con quale nota. Le righe le scrivono solo le
-- funzioni. Mentre un post aspetta il Coordinatore o il Direttore non si
-- cambia: per cambiarlo la segreteria lo ritira.
--
-- «approvato» lo dà solo il Direttore. I post già approvati prima di oggi
-- restano come sono e si possono pubblicare.
-- ============================================================

alter table public.s_post drop constraint if exists s_post_stato_check;
alter table public.s_post add constraint s_post_stato_check
  check (stato in ('bozza','al_coordinatore','al_direttore','approvato','pubblicato','scartato'));

create table if not exists public.s_post_passaggi (
  id              bigserial primary key,
  post_id         bigint not null references public.s_post(id) on delete cascade,
  verso           text not null check (verso in ('coordinatore','direttore')),
  stato           text not null default 'in_attesa'
                  check (stato in ('in_attesa','visto','modifiche','approvato','approvato_indicazioni','non_approvato','ritirato')),
  richiesto_da    text not null,               -- e-mail della segreteria che l'ha mandato
  richiesto_il    timestamptz not null default now(),
  nota_richiesta  text,                        -- due righe della segreteria a chi deve vedere
  testi           jsonb not null,              -- fotografia del post com'era quando è partito
  deciso_da       text,                        -- e-mail
  deciso_da_nome  text,
  deciso_il       timestamptz,
  nota            text                         -- visto con nota, modifiche, indicazioni, motivo
);
create index if not exists s_post_passaggi_post on public.s_post_passaggi (post_id, richiesto_il);
create unique index if not exists s_post_passaggi_uno_in_attesa on public.s_post_passaggi (post_id) where stato = 'in_attesa';

comment on table public.s_post_passaggi is
  'Post social mandati dalla segreteria al Coordinatore (visto o modifiche) e al Direttore (approva, approva con indicazioni, non approva). Scritta solo da s_post_manda, s_post_ritira, s_post_decidi (06/11/2026).';

alter table public.s_post_passaggi enable row level security;
drop policy if exists s_post_passaggi_lettura on public.s_post_passaggi;
create policy s_post_passaggi_lettura on public.s_post_passaggi for select to authenticated
  using (is_segreteria()
         or (verso = 'coordinatore' and is_coordinatore())
         or (verso = 'direttore' and is_direttore()));
revoke all on public.s_post_passaggi from anon;
revoke insert, update, delete on public.s_post_passaggi from authenticated;
grant select on public.s_post_passaggi to authenticated;

/* ── la fotografia del post: ciò che vede chi deve decidere ── */
create or replace function public.s_post_istantanea(p public.s_post)
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object(
    'titolo', p.titolo, 'pilastro', p.pilastro, 'fonte', p.fonte, 'fonte_url', p.fonte_url, 'norma', p.norma,
    'verifica', p.verifica, 'testo_telegram', p.testo_telegram, 'testo_app', p.testo_app,
    'testo_linkedin', p.testo_linkedin, 'testo_instagram', p.testo_instagram, 'hashtag', p.hashtag,
    'immagine_url', p.immagine_url, 'immagini', coalesce(p.immagini, '[]'::jsonb), 'video_url', p.video_url,
    'immagine_suggerita', p.immagine_suggerita, 'data_programmata', p.data_programmata,
    'evidenza_fino_al', p.evidenza_fino_al)
$$;

/* ── la regola sul post: stati e contenuto ── */
create or replace function public.s_post_regola()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.post_via_funzione', true), '') = 'si' then return new; end if;
  if tg_op = 'INSERT' then
    if new.stato <> 'bozza' then
      raise exception 'Un post nuovo nasce come bozza: approvarlo spetta al Direttore';
    end if;
    return new;
  end if;
  if new.stato is distinct from old.stato then
    if new.stato in ('al_coordinatore', 'al_direttore') or old.stato in ('al_coordinatore', 'al_direttore') then
      raise exception 'Il post si manda al Coordinatore o al Direttore, e si ritira, solo coi pulsanti della pagina Comunicazione';
    end if;
    if new.stato = 'approvato' then
      raise exception 'Un post lo approva il Direttore, nella pagina Comunicazione del gestionale';
    end if;
    if new.stato = 'pubblicato' and old.stato not in ('approvato', 'pubblicato') then
      raise exception 'Si pubblica solo un post approvato dal Direttore';
    end if;
  end if;
  if old.stato in ('al_coordinatore', 'al_direttore') and (
       new.titolo is distinct from old.titolo or new.pilastro is distinct from old.pilastro
    or new.testo_telegram is distinct from old.testo_telegram or new.testo_app is distinct from old.testo_app
    or new.testo_linkedin is distinct from old.testo_linkedin or new.testo_instagram is distinct from old.testo_instagram
    or new.hashtag is distinct from old.hashtag or new.immagine_url is distinct from old.immagine_url
    or new.immagini is distinct from old.immagini or new.video_url is distinct from old.video_url) then
    raise exception 'Il post è %: mentre aspetta non si cambia. Per correggerlo, prima «Ritira»',
      case old.stato when 'al_coordinatore' then 'dal Coordinatore' else 'dal Direttore' end;
  end if;
  return new;
end $$;

drop trigger if exists s_post_regola on public.s_post;
create trigger s_post_regola before insert or update on public.s_post
  for each row execute function public.s_post_regola();

/* chi ha fatto il gesto, col nome */
create or replace function public.s_post_nome(p_email text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select nome from app_ruoli where lower(email) = lower(p_email) and stato = 'attivo' and coalesce(nome, '') <> '' limit 1),
    (select nullif(trim(concat_ws(' ', tecnico_nome, tecnico_cognome)), '') from tecnici where lower(email) = lower(p_email) limit 1),
    p_email)
$$;

/* ── la segreteria manda il post ── */
create or replace function public.s_post_manda(p_post bigint, p_verso text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare p public.s_post; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_dest text; v_id bigint;
begin
  if not coalesce(is_segreteria(), false) then raise exception 'Il post lo manda la segreteria'; end if;
  if p_verso not in ('coordinatore', 'direttore') then raise exception 'Si manda al Coordinatore o al Direttore, non a «%»', p_verso; end if;
  select * into p from s_post where id = p_post for update;
  if p.id is null then raise exception 'Post % non trovato', p_post; end if;
  if p.stato not in ('bozza', 'scartato') then
    raise exception 'Si manda una bozza: questo post è «%»', replace(p.stato, '_', ' ');
  end if;
  if nullif(trim(coalesce(p.testo_telegram, '')), '') is null and nullif(trim(coalesce(p.testo_app, '')), '') is null then
    raise exception 'Il post non ha testo: scrivi almeno il testo di Telegram o dell''app servizi';
  end if;
  select lower(trim(valore)) into v_dest from s_config where chiave = p_verso || '_email';
  if coalesce(v_dest, '') = '' then raise exception 'Non so chi sia il %: manca %_email in s_config', p_verso, p_verso; end if;

  insert into s_post_passaggi (post_id, verso, richiesto_da, nota_richiesta, testi)
  values (p.id, p_verso, v_email, nullif(trim(coalesce(p_nota, '')), ''), s_post_istantanea(p))
  returning id into v_id;
  perform set_config('app.post_via_funzione', 'si', true);
  update s_post set stato = 'al_' || p_verso, scarto_motivo = null, aggiornato_da = v_email where id = p.id;
  perform set_config('app.post_via_funzione', '', true);

  begin
    perform push_accoda(v_dest, 'post_da_vedere',
      case p_verso when 'coordinatore' then 'Un post da vedere' else 'Un post da approvare' end,
      'La segreteria ti manda un post per i social: «' || left(p.titolo, 70) || '». Lo trovi in Comunicazione.',
      './?vista=comunicazione', 'post-' || p.id);
  exception when others then raise warning 's_post_manda avviso: %', sqlerrm; end;
  return jsonb_build_object('passaggio', v_id, 'stato', 'al_' || p_verso);
end $$;

/* ── la segreteria lo ritira (per correggerlo, o perché non serve più) ── */
create or replace function public.s_post_ritira(p_post bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_id bigint;
begin
  if not coalesce(is_segreteria(), false) then raise exception 'Il post lo ritira la segreteria'; end if;
  update s_post_passaggi set stato = 'ritirato', deciso_da = v_email, deciso_da_nome = s_post_nome(v_email), deciso_il = now()
   where post_id = p_post and stato = 'in_attesa' returning id into v_id;
  if v_id is null then raise exception 'Il post % non sta aspettando nessuno', p_post; end if;
  perform set_config('app.post_via_funzione', 'si', true);
  update s_post set stato = 'bozza', aggiornato_da = v_email where id = p_post;
  perform set_config('app.post_via_funzione', '', true);
  return jsonb_build_object('passaggio', v_id, 'stato', 'bozza');
end $$;

/* ── il Coordinatore e il Direttore decidono ── */
create or replace function public.s_post_decidi(p_passaggio bigint, p_esito text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.s_post_passaggi; p public.s_post; v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
        v_nome text; v_nota text := nullif(trim(coalesce(p_nota, '')), ''); v_stato text; v_dir text; v_nuovo bigint;
begin
  select * into r from s_post_passaggi where id = p_passaggio for update;
  if r.id is null then raise exception 'Passaggio % non trovato', p_passaggio; end if;
  if r.stato <> 'in_attesa' then raise exception 'Su questo post si è già deciso (%)', replace(r.stato, '_', ' '); end if;
  if r.verso = 'coordinatore' then
    if not coalesce(is_coordinatore(), false) then raise exception 'Il visto spetta al Coordinatore'; end if;
    if p_esito not in ('visto', 'modifiche') then raise exception 'Il Coordinatore dà il visto o chiede modifiche, non «%»', p_esito; end if;
  else
    if not coalesce(is_direttore(), false) then raise exception 'L''approvazione spetta al Direttore'; end if;
    if p_esito not in ('approvato', 'approvato_indicazioni', 'non_approvato') then raise exception 'Il Direttore approva, approva con indicazioni o non approva, non «%»', p_esito; end if;
  end if;
  if p_esito in ('modifiche', 'approvato_indicazioni', 'non_approvato') and length(coalesce(v_nota, '')) < 3 then
    raise exception '%', case p_esito when 'modifiche' then 'Scrivi che cosa cambiare: la segreteria corregge il testo'
                                     when 'approvato_indicazioni' then 'Scrivi le indicazioni: la segreteria le applica prima di pubblicare'
                                     else 'Scrivi perché non lo approvi: torna alla segreteria' end;
  end if;
  v_nome := s_post_nome(v_email);
  update s_post_passaggi set stato = p_esito, deciso_da = v_email, deciso_da_nome = v_nome, deciso_il = now(), nota = v_nota
   where id = r.id;
  select * into p from s_post where id = r.post_id for update;

  v_stato := case p_esito when 'visto' then 'al_direttore' when 'approvato' then 'approvato'
                          when 'approvato_indicazioni' then 'approvato' else 'bozza' end;
  if p_esito = 'visto' then
    /* il visto non basta: il post passa al Direttore, con il visto scritto accanto */
    select lower(trim(valore)) into v_dir from s_config where chiave = 'direttore_email';
    insert into s_post_passaggi (post_id, verso, richiesto_da, nota_richiesta, testi)
    values (p.id, 'direttore', r.richiesto_da, r.nota_richiesta,
            s_post_istantanea(p) || jsonb_build_object('visto_coordinatore',
              jsonb_build_object('nome', v_nome, 'il', now(), 'nota', v_nota)))
    returning id into v_nuovo;
  end if;
  perform set_config('app.post_via_funzione', 'si', true);
  update s_post set stato = v_stato, aggiornato_da = v_email where id = p.id;
  perform set_config('app.post_via_funzione', '', true);

  begin
    perform push_accoda(r.richiesto_da, 'post_' || p_esito,   -- un evento per esito: push_accoda scarta lo stesso evento entro 2 minuti
      case p_esito when 'visto' then 'Visto del Coordinatore' when 'modifiche' then 'Modifiche dal Coordinatore'
                   when 'approvato' then 'Post approvato' when 'approvato_indicazioni' then 'Post approvato con indicazioni'
                   else 'Post non approvato' end,
      '«' || left(p.titolo, 70) || '»: ' ||
      case p_esito when 'visto' then 'il Coordinatore ha dato il visto, ora è dal Direttore.'
                   when 'modifiche' then 'il Coordinatore chiede delle modifiche. La nota è in Comunicazione.'
                   when 'approvato' then 'il Direttore l''ha approvato. Si può pubblicare.'
                   when 'approvato_indicazioni' then 'il Direttore l''ha approvato con indicazioni da applicare prima di pubblicare.'
                   else 'il Direttore non l''ha approvato. La nota è in Comunicazione.' end,
      './?vista=comunicazione', 'post-' || p.id);
    if p_esito = 'visto' and coalesce(v_dir, '') <> '' then
      perform push_accoda(v_dir, 'post_da_vedere', 'Un post da approvare',
        'Un post per i social con il visto del Coordinatore: «' || left(p.titolo, 70) || '». Lo trovi in Comunicazione.',
        './?vista=comunicazione', 'post-' || p.id);
    end if;
  exception when others then raise warning 's_post_decidi avviso: %', sqlerrm; end;
  return jsonb_build_object('passaggio', r.id, 'esito', p_esito, 'stato', v_stato, 'al_direttore', v_nuovo);
end $$;

revoke all on function public.s_post_manda(bigint, text, text) from public, anon;
revoke all on function public.s_post_ritira(bigint) from public, anon;
revoke all on function public.s_post_decidi(bigint, text, text) from public, anon;
revoke all on function public.s_post_nome(text) from public, anon, authenticated;
revoke all on function public.s_post_istantanea(public.s_post) from public, anon, authenticated;
grant execute on function public.s_post_manda(bigint, text, text) to authenticated;
grant execute on function public.s_post_ritira(bigint) to authenticated;
grant execute on function public.s_post_decidi(bigint, text, text) to authenticated;
