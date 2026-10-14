-- ============================================================================
-- 2026_10_14 — Il questionario di gradimento si apre da solo a un'ora data
--
-- Chiesto dall'utente il 14/10/2026, preparando la riunione dei tecnici nuovi
-- del 15/10: «vorrei poter inserire una data con orario che attivi il
-- questionario di gradimento, così non lo devo abilitare: domani alle 11.30
-- risulta già aperto».
--
-- Fino a oggi il questionario rispondeva dal momento in cui la segreteria lo
-- apriva: aprirlo il giorno prima voleva dire lasciarlo compilabile prima
-- dell'incontro, aprirlo in aula voleva dire ricordarsene. Ora si apre quando
-- si vuole (codice, QR e foglio nascono subito e si stampano), e si indica
-- «risponde dal»: prima di quell'ora il portale dice quando si apre, e una
-- risposta arrivata lo stesso (pagina lasciata aperta) entra fuori conteggio.
-- Vuoto = risponde subito, come prima.
--
-- Due progetti: questa parte sul GESTIONALE (utdantrfugnmqsuujxbe); quella del
-- portale in fondo, sul progetto SERVIZI (qcvwrgjldbdoxcfdsvkq), va eseguita
-- PRIMA di pubblicare, insieme alla nuova questionari-ricevi: altrimenti il
-- campo apre_il viene rifiutato come «non previsto».
-- ============================================================================

alter table public.s_corsi
  add column if not exists quest_apre_il timestamptz;

comment on column public.s_corsi.quest_apre_il is
  'Da quando il questionario di gradimento risponde (14/10/2026). Vuoto = da quando è stato aperto. Prima di quest''ora il portale dice quando si apre e le risposte entrano fuori conteggio.';

-- quest_apri prende «risponde dal». La firma cambia: si toglie la vecchia,
-- altrimenti le due convivono e una chiamata a 4 argomenti è ambigua.
drop function if exists public.quest_apri(bigint, text, integer, integer);

create or replace function public.quest_apri(
  p_corso_id bigint, p_modello text default null, p_ore integer default 48,
  p_tetto integer default null, p_apre_il timestamptz default null)
returns table(codice text, link text, chiuso_il timestamptz, tetto integer)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare r record; v_codice text; v_fine timestamptz; v_tetto integer; v_base text;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;

  select c.id, c.titolo, c.tipo, c.data_inizio, c.data_fine, c.quest_codice, c.quest_modello
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found then raise exception 'corso % non trovato', p_corso_id; end if;

  v_codice := coalesce(r.quest_codice, public.quest_codice_nuovo(p_corso_id));

  select (g.data + coalesce(g.alle2, g.alle, time '23:59')) at time zone 'Europe/Rome'
    into v_fine
    from public.s_corsi_giornate g
   where g.corso_id = p_corso_id
   order by g.data desc, coalesce(g.alle2, g.alle, time '23:59') desc
   limit 1;

  if v_fine is null then
    v_fine := ((coalesce(r.data_fine, r.data_inizio, (now() at time zone 'Europe/Rome')::date)
                + time '23:59') at time zone 'Europe/Rome');
  end if;
  v_fine := v_fine + make_interval(hours => greatest(coalesce(p_ore, 48), 1));

  -- un'apertura dopo la chiusura non risponderebbe mai: si dice subito
  if p_apre_il is not null and p_apre_il >= v_fine then
    raise exception 'il questionario si aprirebbe dopo la chiusura (%): controlla data e ora',
      to_char(v_fine at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
  end if;

  v_tetto := coalesce(p_tetto,
    (select count(*)::int + 5 from public.s_corsi_iscritti i
      where i.corso_id = p_corso_id and coalesce(i.esito, '') not in ('annullato', 'sostituito')));

  update public.s_corsi c
     set quest_codice    = v_codice,
         quest_modello   = coalesce(p_modello, c.quest_modello,
                             case when c.conferenza_id is not null then 'conferenza'
                                  when c.progetto_id   is not null then 'convegno'
                                  else 'corso' end),
         quest_aperto_il = coalesce(c.quest_aperto_il, now()),
         quest_apre_il   = p_apre_il,
         quest_chiuso_il = v_fine,
         quest_tetto     = v_tetto,
         questionario_previsto = true
   where c.id = p_corso_id;

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');

  return query select v_codice,
    v_base || '?evento=' || public.url_encode_semplice(v_codice || '.' || public.quest_firma(v_codice)),
    v_fine, v_tetto;
end $function$;

revoke execute on function public.quest_apri(bigint, text, integer, integer, timestamptz) from public, anon;
grant execute on function public.quest_apri(bigint, text, integer, integer, timestamptz) to authenticated;

-- cambiare l'ora d'apertura a questionario già aperto (null = risponde da subito)
create or replace function public.quest_imposta_apertura(p_corso_id bigint, p_apre_il timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_chiuso timestamptz; v_cod text;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select c.quest_codice, c.quest_chiuso_il into v_cod, v_chiuso
    from public.s_corsi c where c.id = p_corso_id;
  if not found then raise exception 'corso % non trovato', p_corso_id; end if;
  if v_cod is null then raise exception 'il questionario di questo corso non è ancora aperto'; end if;
  if p_apre_il is not null and v_chiuso is not null and p_apre_il >= v_chiuso then
    raise exception 'il questionario si aprirebbe dopo la chiusura (%): controlla data e ora',
      to_char(v_chiuso at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
  end if;
  update public.s_corsi set quest_apre_il = p_apre_il where id = p_corso_id;
  return p_apre_il;
end $function$;

revoke execute on function public.quest_imposta_apertura(bigint, timestamptz) from public, anon;
grant execute on function public.quest_imposta_apertura(bigint, timestamptz) to authenticated;

-- quest_link: la scheda del corso mostra anche «risponde dal»
create or replace function public.quest_link(p_corso_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare r record; v_base text;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select c.quest_codice, c.quest_chiuso_il, c.quest_apre_il, c.quest_tetto, c.quest_modello,
         c.quest_pubblicato_il, c.quest_pubblica_esito,
         c.test_codice, c.test_chiuso_il, c.test_soglia, c.test_minuti,
         c.test_pubblicato_il, c.test_pubblica_esito
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found then return null; end if;

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');

  return jsonb_build_object(
    'codice',         r.quest_codice,
    'link',           case when r.quest_codice is null then null else
                        v_base || '?evento=' || public.url_encode_semplice(r.quest_codice || '.' || public.quest_firma(r.quest_codice)) end,
    'apre_il',        r.quest_apre_il,
    'chiuso_il',      r.quest_chiuso_il,
    'tetto',          r.quest_tetto,
    'modello',        r.quest_modello,
    'pubblicato_il',  r.quest_pubblicato_il,
    'pubblica_esito', r.quest_pubblica_esito,
    'test_codice',    r.test_codice,
    'test_link',      case when r.test_codice is null then null else
                        v_base || '?test=' || public.url_encode_semplice(r.test_codice || '.' || public.quest_firma(r.test_codice)) end,
    'test_chiuso_il', r.test_chiuso_il,
    'test_soglia',    r.test_soglia,
    'test_minuti',    r.test_minuti);
end $function$;

-- quest_pubblicazione: al portale scende anche apre_il
create or replace function public.quest_pubblicazione(p_corso_id bigint)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare r record; v_dom jsonb; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or v_ruolo = 'service_role') then
    raise exception 'non autorizzato';
  end if;

  select c.id, c.titolo, c.tipo, c.sede, c.data_inizio, c.data_fine,
         c.quest_codice, c.quest_modello, c.quest_chiuso_il, c.quest_apre_il
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found or r.quest_codice is null then return null; end if;

  select coalesce(jsonb_agg(d order by d.tronco desc, d.ordine, d.id), '[]'::jsonb)
    into v_dom
    from (
      select id, ordine, testo, tipo, opzioni, obbligatoria, tronco
        from public.s_quest_domande
       where modello = r.quest_modello
       union all
      select id, 100 + ordine, testo, tipo, opzioni, obbligatoria, tronco
        from public.s_quest_domande
       where corso_id = r.id
    ) d;

  return jsonb_build_object(
    'codice',      r.quest_codice,
    'firma',       public.quest_firma(r.quest_codice),
    'titolo',      r.titolo,
    'genere',      coalesce(r.quest_modello, 'corso'),
    'quando',      to_char(coalesce(r.data_inizio, r.data_fine), 'YYYY-MM-DD'),
    'sede',        r.sede,
    'apre_il',     to_jsonb(r.quest_apre_il),
    'chiuso_il',   to_jsonb(r.quest_chiuso_il),
    'domande',     v_dom);
end $function$;

-- quest_verifica: una risposta arrivata prima dell'apertura entra fuori conteggio
create or replace function public.quest_verifica(p_riferimento text)
returns table(corso_id bigint, titolo text, aperto boolean, oltre_tetto boolean, esito text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare v_cod text; v_firma text; p int; r record; v_quante int; v_prima boolean;
begin
  if p_riferimento is null or btrim(p_riferimento) = '' then
    return query select null::bigint, null::text, false, false, 'senza invito'::text; return;
  end if;
  p := position('.' in p_riferimento);
  if p = 0 then
    return query select null::bigint, null::text, false, false, 'riferimento malformato'::text; return;
  end if;
  v_cod   := substr(p_riferimento, 1, p - 1);
  v_firma := substr(p_riferimento, p + 1);

  if public.quest_firma(v_cod) is distinct from lower(v_firma) then
    return query select null::bigint, null::text, false, false, 'firma non valida'::text; return;
  end if;

  select c.id, c.titolo, c.quest_chiuso_il, c.quest_apre_il, c.quest_tetto
    into r from public.s_corsi c where c.quest_codice = v_cod;
  if not found then
    return query select null::bigint, null::text, false, false, 'evento non trovato'::text; return;
  end if;

  select count(*)::int into v_quante
    from public.s_quest_risposte q where q.corso_id = r.id and not q.oltre_tetto;
  v_prima := r.quest_apre_il is not null and r.quest_apre_il > now();

  return query select r.id, r.titolo,
    not v_prima and (r.quest_chiuso_il is null or r.quest_chiuso_il > now()),
    v_prima
      or (r.quest_chiuso_il is not null and r.quest_chiuso_il <= now())
      or (r.quest_tetto is not null and v_quante >= r.quest_tetto),
    'agganciato'::text;
end $function$;


-- ═══════════════════ progetto SERVIZI (qcvwrgjldbdoxcfdsvkq) ═══════════════
/*
alter table public.questionari_pubblici add column if not exists apre_il timestamptz;

create or replace function public.apri_questionario(p_codice text, p_firma text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare q public.questionari_pubblici; cod text; fir text;
begin
  cod := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9-]', '', 'g'));
  fir := lower(regexp_replace(coalesce(p_firma,  ''), '[^A-Fa-f0-9]',  '', 'g'));
  if length(cod) not between 3 and 40 or length(fir) not between 8 and 64 then
    return jsonb_build_object('trovato', false);
  end if;

  select * into q from public.questionari_pubblici
   where codice = cod
     and firma_hash = encode(extensions.digest(convert_to(fir, 'UTF8'), 'sha256'), 'hex');
  if not found then
    -- codice inesistente e firma sbagliata rispondono allo stesso modo: chi
    -- prova a indovinare non impara nemmeno se l'evento esiste.
    return jsonb_build_object('trovato', false);
  end if;

  return jsonb_build_object(
    'trovato',   true,
    'non_ancora', (q.apre_il is not null and q.apre_il > now()),
    'aperto',    (q.apre_il is null or q.apre_il <= now())
                 and (q.chiuso_il is null or q.chiuso_il > now()),
    'codice',    q.codice,
    'titolo',    q.titolo,
    'genere',    q.genere,
    'quando',    q.quando,
    'sede',      q.sede,
    'apre_il',   q.apre_il,
    'chiuso_il', q.chiuso_il,
    'domande',   q.domande);
end $fn$;
*/
