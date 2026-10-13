-- =============================================================================
--  PROGETTO SERVIZI: LE FIRME DI PRESENZA DAL QR DEL CORSO (13/10/2026)
--  lotto 4 del fascicolo corso digitale
-- -----------------------------------------------------------------------------
--  Il Gestionale COPIA qui (funzione questionari-pubblica, cosa:'presenza' →
--  questionari-ricevi, azione pubblica_pres) i soli dati che servono alla
--  pagina ?presenza= del portale: titolo, giornate con gli orari, e delle
--  persone l'impronta del codice personale + le iniziali. Nessun nome intero,
--  nessun codice fiscale: stesso disegno del test (18/09/2026).
--
--  Due porte pubbliche, security definer, risposta {trovato:false} identica
--  per codice inesistente e firma sbagliata:
--    apri_presenza(codice, firma)              → il corso e le sue giornate
--    pres_che_cosa(codice, firma, personale)   → «sei tu? C. L.» e che cosa
--                                                 si sta per firmare
--  La firma vera arriva dalla cassetta (tipo `prs`) e la decide il
--  Gestionale al ritiro (pres_registra); qui si dice PRIMA che cosa succede,
--  con la stessa regola (pres_decidi, parola per parola).
-- =============================================================================

create table if not exists public.presenze_pubbliche (
  codice        text primary key,                     -- P<corso>-XXXX
  firma_hash    text not null,                        -- sha256 esadecimale della firma del link
  titolo        text not null,
  quando        date,
  sede          text,
  chiuso_il     timestamptz,
  giornate      jsonb not null default '[]'::jsonb,   -- [{data, dalle, alle, dalle2, alle2, sede}]
  persone       jsonb not null default '[]'::jsonb,   -- [{h, n}]: impronta del codice personale, iniziali
  aggiornato_il timestamptz not null default now()
);
comment on table public.presenze_pubbliche is
  'Firme di presenza dal QR (13/10/2026): copia minima fatta dal Gestionale, letta dalla pagina ?presenza= solo con codice e firma. Nessun nome intero, nessun CF.';
alter table public.presenze_pubbliche enable row level security;
revoke all on table public.presenze_pubbliche from anon, authenticated;

-- la cassetta accetta il tipo nuovo
alter table public.cassetta drop constraint if exists cassetta_tipo_check;
alter table public.cassetta add constraint cassetta_tipo_check
  check (tipo = any (array['seg','not','cons','vis','conf','att','rlst','rls','qst','qev','tst','isc','dtst','prs']));

/* la regola, PAROLA PER PAROLA la stessa del Gestionale (pres_decidi in
   segreteria-app/supabase/sql/2026_10_13_firme_presenza.sql): chi cambia una
   la cambia anche nell'altra. */
create or replace function public.pres_decidi(p_data date, p_dalle time, p_alle time, p_dalle2 time, p_alle2 time, p_ora timestamptz)
returns jsonb language plpgsql immutable as $$
declare t record; v_ini timestamptz; v_fine timestamptz; v_meta timestamptz;
        best jsonb := null; best_d interval := null; d interval;
begin
  if p_data is null or p_ora is null then return jsonb_build_object('tipo', null, 'turno', null, 'fuori_orario', true, 'motivo', 'giornata senza data'); end if;
  for t in select 1 as turno, p_dalle as d, p_alle as a union all select 2, p_dalle2, p_alle2 loop
    continue when t.d is null or t.a is null;
    v_ini  := (p_data + t.d) at time zone 'Europe/Rome';
    v_fine := (p_data + t.a) at time zone 'Europe/Rome';
    if v_fine <= v_ini then v_fine := v_fine + interval '1 day'; end if;
    v_meta := v_ini + (v_fine - v_ini) / 2;
    if p_ora >= v_ini - interval '60 minutes' and p_ora < v_meta then
      return jsonb_build_object('tipo', 'entrata', 'turno', t.turno, 'ora_turno', to_char(t.d, 'HH24:MI'), 'fuori_orario', false);
    end if;
    if p_ora >= v_meta and p_ora <= v_fine + interval '60 minutes' then
      return jsonb_build_object('tipo', 'uscita', 'turno', t.turno, 'ora_turno', to_char(t.a, 'HH24:MI'), 'fuori_orario', false);
    end if;
    d := greatest(p_ora - v_ini, v_ini - p_ora);
    if best is null or d < best_d then
      best := jsonb_build_object('tipo', 'entrata', 'turno', t.turno, 'ora_turno', to_char(t.d, 'HH24:MI'), 'fuori_orario', true); best_d := d;
    end if;
    d := greatest(p_ora - v_fine, v_fine - p_ora);
    if d < best_d then
      best := jsonb_build_object('tipo', 'uscita', 'turno', t.turno, 'ora_turno', to_char(t.a, 'HH24:MI'), 'fuori_orario', true); best_d := d;
    end if;
  end loop;
  if best is null then return jsonb_build_object('tipo', null, 'turno', null, 'fuori_orario', true, 'motivo', 'giornata senza orari'); end if;
  return best;
end $$;

create or replace function public.apri_presenza(p_codice text, p_firma text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare t public.presenze_pubbliche; cod text; fir text;
begin
  cod := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9-]', '', 'g'));
  fir := lower(regexp_replace(coalesce(p_firma,  ''), '[^A-Fa-f0-9]',  '', 'g'));
  if length(cod) not between 3 and 40 or length(fir) not between 8 and 64 then
    return jsonb_build_object('trovato', false);
  end if;
  select * into t from public.presenze_pubbliche
   where codice = cod
     and firma_hash = encode(extensions.digest(convert_to(fir, 'UTF8'), 'sha256'), 'hex');
  if not found then return jsonb_build_object('trovato', false); end if;
  return jsonb_build_object(
    'trovato', true,
    'aperto',  (t.chiuso_il is null or t.chiuso_il > now()),
    'codice',  t.codice, 'titolo', t.titolo, 'quando', t.quando, 'sede', t.sede,
    'chiuso_il', t.chiuso_il, 'giornate', t.giornate,
    'oggi', to_char((now() at time zone 'Europe/Rome')::date, 'YYYY-MM-DD'));
end $$;

/* «sei tu? C. L.» e che cosa si sta per firmare, sull'ora di QUESTO server
   (la stessa ora del Gestionale: la decisione che vale resta la sua) */
create or replace function public.pres_che_cosa(p_codice text, p_firma text, p_personale text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare t public.presenze_pubbliche; cod text; fir text; per text; h text; v jsonb; g jsonb; v_oggi date; dec jsonb; v_data date;
begin
  cod := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9-]', '', 'g'));
  fir := lower(regexp_replace(coalesce(p_firma,  ''), '[^A-Fa-f0-9]',  '', 'g'));
  per := upper(regexp_replace(coalesce(p_personale, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(per) not between 3 and 12 then return jsonb_build_object('trovato', false); end if;
  select * into t from public.presenze_pubbliche
   where codice = cod
     and firma_hash = encode(extensions.digest(convert_to(fir, 'UTF8'), 'sha256'), 'hex');
  if not found then return jsonb_build_object('trovato', false); end if;

  h := encode(extensions.digest(convert_to(per, 'UTF8'), 'sha256'), 'hex');
  select x into v from jsonb_array_elements(t.persone) x where x ->> 'h' = h;
  if v is null then return jsonb_build_object('trovato', false); end if;

  /* la giornata di oggi; se oggi non c'è lezione, la più vicina */
  v_oggi := (now() at time zone 'Europe/Rome')::date;
  select x into g from jsonb_array_elements(t.giornate) x
   where (x ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$'
   order by abs((x ->> 'data')::date - v_oggi), x ->> 'dalle' limit 1;
  if g is null then
    return jsonb_build_object('trovato', true, 'iniziali', v ->> 'n', 'giornata', null, 'tipo', null, 'fuori_orario', true);
  end if;
  v_data := (g ->> 'data')::date;
  dec := public.pres_decidi(v_data, (g ->> 'dalle')::time, (g ->> 'alle')::time, (g ->> 'dalle2')::time, (g ->> 'alle2')::time, now());
  return jsonb_build_object(
    'trovato', true, 'iniziali', v ->> 'n',
    'giornata', to_char(v_data, 'YYYY-MM-DD'), 'oggi', (v_data = v_oggi),
    'tipo', dec ->> 'tipo', 'turno', (dec ->> 'turno')::int, 'ora_turno', dec ->> 'ora_turno',
    'fuori_orario', coalesce((dec ->> 'fuori_orario')::boolean, true));
end $$;
