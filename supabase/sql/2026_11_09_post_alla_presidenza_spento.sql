-- ============================================================
-- Post social: il passaggio ALLA PRESIDENZA (09/11/2026, chiesto dall'utente) — SPENTO
--
-- Il Direttore (09/11/2026, riferito dall'utente) non approva più i post. I post che possono
-- toccare le parti sociali (ANCE, sindacati: statistiche, confronti fra categorie di imprese,
-- territori) li approvano Presidente e Vicepresidente. Qui il passaggio nel database:
--   · verso 'presidenza' in s_post_passaggi, stato 'alla_presidenza' in s_post;
--   · ognuno dei due decide per conto suo (colonna decisioni: {presidente:{…}, vicepresidente:{…}});
--     «non approvo» di uno dei due riporta subito il post in bozza; approvato quando hanno
--     approvato tutti quelli che servono (s_config.post_presidenza_servono: 'entrambi' | 'uno');
--   · la segreteria scrive PERCHÉ il post va alla Presidenza (nota obbligatoria);
--   · INTERRUTTORE: s_config.post_presidenza_attiva = 'no'. Finché non è 'si' nessun post ci va.
--     Le regole su chi approva che cosa le decide il Direttore: si accende dopo la sua risposta.
-- Coordinatore e Direttore funzionano esattamente come prima: il loro codice non cambia.
-- Test: tests-db/49_post_alla_presidenza.sql.
-- ============================================================

alter table public.s_post drop constraint if exists s_post_stato_check;
alter table public.s_post add constraint s_post_stato_check
  check (stato = any (array['bozza', 'al_coordinatore', 'al_direttore', 'alla_presidenza', 'approvato', 'pubblicato', 'scartato']));

alter table public.s_post_passaggi drop constraint if exists s_post_passaggi_verso_check;
alter table public.s_post_passaggi add constraint s_post_passaggi_verso_check
  check (verso = any (array['coordinatore', 'direttore', 'presidenza']));

alter table public.s_post_passaggi add column if not exists decisioni jsonb not null default '{}'::jsonb;
comment on column public.s_post_passaggi.decisioni is
  'Solo per verso = presidenza: la decisione di ciascuno, {"presidente": {"esito","nota","nome","il"}, "vicepresidente": {…}} (09/11/2026).';

insert into public.s_config (chiave, valore, descrizione) values
  ('post_presidenza_attiva', 'no', 'Post social: «si» accende il passaggio alla Presidenza (pagina Comunicazione del gestionale). Spento finché il Direttore non conferma le regole (09/11/2026).'),
  ('post_presidenza_servono', 'entrambi', 'Post social alla Presidenza: «entrambi» = servono Presidente e Vicepresidente; «uno» = basta uno dei due (09/11/2026).')
on conflict (chiave) do nothing;

/* ── chi legge i passaggi: ognuno i suoi, la segreteria tutti ── */
drop policy if exists s_post_passaggi_lettura on public.s_post_passaggi;
create policy s_post_passaggi_lettura on public.s_post_passaggi for select using (
  is_segreteria()
  or (verso = 'coordinatore' and is_coordinatore())
  or (verso = 'direttore' and is_direttore())
  or (verso = 'presidenza' and is_presidenza())
);

/* ── la regola sul post: stati e contenuto (come prima, con «alla_presidenza») ── */
create or replace function public.s_post_regola()
returns trigger language plpgsql set search_path to 'public' as $function$
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
    or new.immagini is distinct from old.immagini or new.video_url is distinct from old.video_url) then
    raise exception 'Il post è %: mentre aspetta non si cambia. Per correggerlo, prima «Ritira»',
      case old.stato when 'al_coordinatore' then 'dal Coordinatore' when 'al_direttore' then 'dal Direttore' else 'dalla Presidenza' end;
  end if;
  return new;
end $function$;

/* ── la segreteria manda: al Coordinatore, al Direttore o (se acceso) alla Presidenza ── */
create or replace function public.s_post_manda(p_post bigint, p_verso text, p_nota text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare p public.s_post; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_dest text; v_id bigint;
        v_pres text[]; v_stato text; v_x text;
begin
  if not coalesce(is_segreteria(), false) then raise exception 'Il post lo manda la segreteria'; end if;
  if p_verso not in ('coordinatore', 'direttore', 'presidenza') then raise exception 'Si manda al Coordinatore, al Direttore o alla Presidenza, non a «%»', p_verso; end if;
  select * into p from s_post where id = p_post for update;
  if p.id is null then raise exception 'Post % non trovato', p_post; end if;
  if p.stato not in ('bozza', 'scartato') then
    raise exception 'Si manda una bozza: questo post è «%»', replace(p.stato, '_', ' ');
  end if;
  if nullif(trim(coalesce(p.testo_telegram, '')), '') is null and nullif(trim(coalesce(p.testo_app, '')), '') is null then
    raise exception 'Il post non ha testo: scrivi almeno il testo di Telegram o dell''app servizi';
  end if;
  if p_verso = 'presidenza' then
    if coalesce((select lower(trim(valore)) from s_config where chiave = 'post_presidenza_attiva'), 'no') <> 'si' then
      raise exception 'Il passaggio alla Presidenza non è ancora acceso: si accende quando il Direttore conferma le regole (s_config.post_presidenza_attiva)';
    end if;
    if length(trim(coalesce(p_nota, ''))) < 3 then
      raise exception 'Scrivi perché il post va alla Presidenza (per esempio: confronta imprese iscritte e non iscritte): lo leggono Presidente e Vicepresidente';
    end if;
    select array_agg(distinct lower(trim(email))) into v_pres from app_ruoli
     where stato = 'attivo' and carica in ('presidente', 'vicepresidente') and coalesce(trim(email), '') <> '';
    if v_pres is null then raise exception 'Non trovo Presidente e Vicepresidente fra gli accessi attivi'; end if;
    v_stato := 'alla_presidenza';
  else
    select lower(trim(valore)) into v_dest from s_config where chiave = p_verso || '_email';
    if coalesce(v_dest, '') = '' then raise exception 'Non so chi sia il %: manca %_email in s_config', p_verso, p_verso; end if;
    v_stato := 'al_' || p_verso;
  end if;

  insert into s_post_passaggi (post_id, verso, richiesto_da, nota_richiesta, testi)
  values (p.id, p_verso, v_email, nullif(trim(coalesce(p_nota, '')), ''), s_post_istantanea(p))
  returning id into v_id;
  perform set_config('app.post_via_funzione', 'si', true);
  update s_post set stato = v_stato, scarto_motivo = null, aggiornato_da = v_email where id = p.id;
  perform set_config('app.post_via_funzione', '', true);

  begin
    if p_verso = 'presidenza' then
      foreach v_x in array v_pres loop
        perform push_accoda(v_x, 'post_da_vedere', 'Un post da approvare',
          'La segreteria vi manda un post per i social prima che esca: «' || left(p.titolo, 70) || '». Lo trovate in Comunicazione.',
          './?vista=comunicazione', 'post-' || p.id);
      end loop;
    else
      perform push_accoda(v_dest, 'post_da_vedere',
        case p_verso when 'coordinatore' then 'Un post da vedere' else 'Un post da approvare' end,
        'La segreteria ti manda un post per i social: «' || left(p.titolo, 70) || '». Lo trovi in Comunicazione.',
        './?vista=comunicazione', 'post-' || p.id);
    end if;
  exception when others then raise warning 's_post_manda avviso: %', sqlerrm; end;
  return jsonb_build_object('passaggio', v_id, 'stato', v_stato);
end $function$;

/* ── chi decide: Coordinatore e Direttore come prima; la Presidenza uno per uno ── */
create or replace function public.s_post_decidi(p_passaggio bigint, p_esito text, p_nota text DEFAULT NULL::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.s_post_passaggi; p public.s_post; v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
        v_nome text; v_nota text := nullif(trim(coalesce(p_nota, '')), ''); v_stato text; v_dir text; v_nuovo bigint;
        v_carica text; v_dec jsonb; v_servono text[]; v_basta_uno boolean; v_tutti boolean; v_fin text; v_note text; v_manca text;
begin
  select * into r from s_post_passaggi where id = p_passaggio for update;
  if r.id is null then raise exception 'Passaggio % non trovato', p_passaggio; end if;
  if r.stato <> 'in_attesa' then raise exception 'Su questo post si è già deciso (%)', replace(r.stato, '_', ' '); end if;

  /* ═══ PRESIDENZA (09/11/2026): ciascuno decide per sé ═══ */
  if r.verso = 'presidenza' then
    if not coalesce(is_presidenza(), false) then raise exception 'L''approvazione spetta a Presidente e Vicepresidente'; end if;
    if p_esito not in ('approvato', 'approvato_indicazioni', 'non_approvato') then
      raise exception 'Si approva, si approva con correzioni o non si approva, non «%»', p_esito;
    end if;
    if p_esito in ('approvato_indicazioni', 'non_approvato') and length(coalesce(v_nota, '')) < 3 then
      raise exception '%', case p_esito when 'approvato_indicazioni' then 'Scrivi le correzioni: la segreteria le applica prima di pubblicare'
                                        else 'Scrivi perché non lo approvi: torna alla segreteria' end;
    end if;
    select carica into v_carica from app_ruoli
     where lower(email) = v_email and stato = 'attivo' and carica in ('presidente', 'vicepresidente')
     order by case carica when 'presidente' then 1 else 2 end limit 1;
    if r.decisioni ? v_carica then raise exception 'Su questo post hai già deciso'; end if;
    v_nome := s_post_nome(v_email);
    v_dec := r.decisioni || jsonb_build_object(v_carica, jsonb_build_object('esito', p_esito, 'nota', v_nota, 'nome', v_nome, 'il', now()));
    select array_agg(distinct carica) into v_servono from app_ruoli where stato = 'attivo' and carica in ('presidente', 'vicepresidente');
    v_basta_uno := coalesce((select lower(trim(valore)) from s_config where chiave = 'post_presidenza_servono'), 'entrambi') = 'uno';
    v_tutti := v_basta_uno or coalesce((select bool_and(v_dec ? c) from unnest(v_servono) c), false);
    v_fin := case when p_esito = 'non_approvato' then 'non_approvato'
                  when v_tutti then case when exists (select 1 from jsonb_each(v_dec) e where e.value ->> 'esito' = 'approvato_indicazioni')
                                         then 'approvato_indicazioni' else 'approvato' end
                  else null end;
    select string_agg(initcap(e.key) || ': ' || (e.value ->> 'nota'), ' · ' order by e.key desc) into v_note
      from jsonb_each(v_dec) e where coalesce(e.value ->> 'nota', '') <> '';
    if v_fin is null then
      update s_post_passaggi set decisioni = v_dec where id = r.id;
    else
      update s_post_passaggi set decisioni = v_dec, stato = v_fin, deciso_da = v_email, deciso_da_nome = v_nome, deciso_il = now(), nota = v_note
       where id = r.id;
    end if;
    select * into p from s_post where id = r.post_id for update;
    v_stato := case when v_fin is null then p.stato when v_fin = 'non_approvato' then 'bozza' else 'approvato' end;
    if v_stato is distinct from p.stato then
      perform set_config('app.post_via_funzione', 'si', true);
      update s_post set stato = v_stato, aggiornato_da = v_email where id = p.id;
      perform set_config('app.post_via_funzione', '', true);
    end if;
    v_manca := (select string_agg(c, ' e ') from unnest(v_servono) c where not (v_dec ? c));
    begin
      perform push_accoda(r.richiesto_da, 'post_' || coalesce(v_fin, 'decisione_parziale'),
        case v_fin when 'approvato' then 'Post approvato dalla Presidenza' when 'approvato_indicazioni' then 'Post approvato con correzioni'
                   when 'non_approvato' then 'Post non approvato' else 'Una decisione della Presidenza' end,
        '«' || left(p.titolo, 70) || '»: ' ||
        case v_fin when 'approvato' then 'approvato dalla Presidenza. Si può pubblicare.'
                   when 'approvato_indicazioni' then 'approvato con correzioni da applicare prima di pubblicare. Le note sono in Comunicazione.'
                   when 'non_approvato' then 'non approvato (' || initcap(v_carica) || '). La nota è in Comunicazione.'
                   else initcap(v_carica) || ': ' || replace(p_esito, '_', ' ') || '. Manca ' || coalesce(v_manca, '—') || '.' end,
        './?vista=comunicazione', 'post-' || p.id);
    exception when others then raise warning 's_post_decidi avviso: %', sqlerrm; end;
    return jsonb_build_object('passaggio', r.id, 'esito', p_esito, 'carica', v_carica, 'stato', v_stato, 'chiuso', v_fin is not null, 'manca', v_manca);
  end if;

  /* ═══ COORDINATORE e DIRETTORE: invariato dal 06/11/2026 ═══ */
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
    perform push_accoda(r.richiesto_da, 'post_' || p_esito,
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
end $function$;
