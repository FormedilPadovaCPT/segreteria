-- ============================================================
-- FIRME DI PRESENZA DAL PORTALE (QR del corso)
-- (13/10/2026) — lotto 4 del fascicolo corso digitale
--
-- Progetto: 2_AREE/Formazione/2026_10_13_REL_Area-Sicurezza_fascicolo-corso-
-- digitale_progetto-tecnico.md, § 2.4 e § 4.
--
-- Come funziona, in breve:
--   - la segreteria APRE le firme del corso (`pres_apri`): nasce il codice
--     `P<corso>-XXXX`, un codice personale per ogni iscritto che non ce l'ha
--     (`corso_codici_personali`, lo stesso del test), e il link firmato
--     `?presenza=<codice>.<firma>` da stampare come QR (copertina del
--     registro + foglio da esporre in aula);
--   - sul portale l'allievo inquadra il QR, scrive il suo codice personale,
--     vede «sei tu? C. L.» e UN solo pulsante: «Firmo l'entrata delle 8:30»;
--     il modulo `prs` arriva alla cassetta e da lì a portale-richieste, che
--     chiama `pres_registra`;
--   - ENTRATA O USCITA LO DECIDE IL SERVER, sull'ora del server
--     (`pres_decidi`): da 60 minuti prima dell'inizio di un turno fino alla
--     metà è entrata; dalla metà fino a 60 minuti dopo la fine è uscita;
--     fuori finestra la firma si registra lo stesso, marcata `fuori_orario`,
--     e decide il docente;
--   - ogni firma nasce `ricevuta`; la CONFERMA (per allievo, deciso
--     dall'utente) la dà il docente del corso o la segreteria
--     (`pres_conferma`, `pres_conferma_allievo`); solo le CONFERMATE scrivono
--     `s_corsi_presenze.ingresso1/uscita1/ingresso2/uscita2` (trigger) e
--     ricalcolano `ore`, le stesse colonne che la segreteria riempie a mano;
--   - una firma che non si riconosce NON si butta: entra senza persona e
--     `riferimento_esito` dice perché (regola del 04/09 su da che parte
--     sbagliare).
-- ============================================================

-- ── 1. il corso: codice delle firme e pubblicazione ─────────
alter table public.s_corsi
  add column if not exists pres_codice          text,
  add column if not exists pres_aperto_il       timestamptz,
  add column if not exists pres_chiuso_il       timestamptz,
  add column if not exists pres_pubblicato_il   timestamptz,
  add column if not exists pres_pubblica_esito  text;
create unique index if not exists s_corsi_pres_codice_uq on public.s_corsi (pres_codice) where pres_codice is not null;
comment on column public.s_corsi.pres_codice is 'Il codice delle firme di presenza dal QR (P<corso>-XXXX, 13/10/2026): uno per corso, firmato con pres_firma nel link ?presenza=.';

-- ── 2. le firme ricevute ─────────────────────────────────────
create table if not exists public.s_corsi_firme_presenza (
  id                bigint generated always as identity primary key,
  corso_id          bigint references public.s_corsi(id) on delete cascade,
  giornata_id       bigint references public.s_corsi_giornate(id) on delete set null,
  iscritto_id       bigint references public.s_corsi_iscritti(id) on delete set null,
  nominativo        text,
  tipo              text check (tipo in ('entrata', 'uscita')),
  turno             smallint check (turno in (1, 2)),
  ora_server        timestamptz not null default now(),
  ora_dispositivo   timestamptz,
  fuori_orario      boolean not null default false,
  fonte             text not null default 'qr' check (fonte in ('qr', 'docente', 'carta')),
  stato             text not null default 'ricevuta' check (stato in ('ricevuta', 'confermata', 'respinta')),
  confermata_da     text,
  confermata_il     timestamptz,
  note              text,
  riferimento_esito text,
  submission_id     text unique,
  progressivo       integer unique,
  timestamp_modulo  timestamptz,
  portale_esito     jsonb,
  created_at        timestamptz not null default now()
);
comment on table public.s_corsi_firme_presenza is
  'Firme di presenza degli allievi dal QR del corso (13/10/2026, lotto 4). Ogni firma nasce «ricevuta»; la conferma del docente o della segreteria la scrive in s_corsi_presenze (trigger). ora_server fa fede, ora_dispositivo è indicativa (una firma in coda senza rete arriva dopo).';
comment on column public.s_corsi_firme_presenza.fuori_orario is 'Vero quando l''ora del server non cade nella finestra di nessun turno: si registra lo stesso, e decide il docente.';
/* una sola firma CONFERMATA per quel momento della giornata */
create unique index if not exists s_corsi_firme_presenza_una_confermata
  on public.s_corsi_firme_presenza (iscritto_id, giornata_id, tipo, turno) where stato = 'confermata';
create index if not exists s_corsi_firme_presenza_corso_idx on public.s_corsi_firme_presenza (corso_id, giornata_id, iscritto_id);

alter table public.s_corsi_firme_presenza enable row level security;
drop policy if exists firme_presenza_sel on public.s_corsi_firme_presenza;
create policy firme_presenza_sel on public.s_corsi_firme_presenza for select to authenticated
  using ((select public.is_segreteria()) or (select public.is_rpf()) or public.is_docente_del_corso(corso_id));
/* le scritture passano dalle funzioni (pres_registra, pres_conferma) o dal
   service_role di portale-richieste: nessuna policy di scrittura */
drop policy if exists firme_presenza_segr on public.s_corsi_firme_presenza;
create policy firme_presenza_segr on public.s_corsi_firme_presenza for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));

-- ── 3. la firma del link ──────────────────────────────────────
/* Stesso segreto, PREFISSO PROPRIO «pres:»: il QR delle firme non deve aprire
   il test o il questionario dello stesso corso. ⚠️ Revocata anche ad
   authenticated: una funzione che firma è un segreto in forma di codice. */
create or replace function public.pres_firma(p_codice text)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_segreto text;
begin
  if p_codice is null or btrim(p_codice) = '' then return null; end if;
  select valore into v_segreto from public.s_config where chiave = 'questionario_segreto';
  if v_segreto is null or v_segreto = '' then
    raise exception 'questionario_segreto mancante in s_config: il link non si può firmare';
  end if;
  return left(encode(extensions.hmac('pres:' || p_codice, v_segreto, 'sha256'), 'hex'), 12);
end $$;
revoke execute on function public.pres_firma(text) from public, anon, authenticated;
grant execute on function public.pres_firma(text) to service_role;

-- ── 4. entrata o uscita: la regola, in un posto solo ─────────
/* La stessa funzione, parola per parola, sta sul progetto Servizi
   (pres_che_cosa la usa per dire PRIMA di firmare che cosa si sta per
   firmare). La decisione che vale è quella del Gestionale al ritiro.
   Finestre: [inizio − 60 min, metà) = entrata; [metà, fine + 60 min] = uscita.
   Fuori finestra: il momento più vicino, marcato fuori_orario. */
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

-- ── 5. i codici personali, anche senza test ──────────────────
/* Lo stesso codice del test (s_corsi_iscritti.test_codice): fino a oggi
   nasceva solo con test_apri. Chi ce l'ha lo tiene (i registri sono già
   stampati); generato PER RIGA con ritentativo (lezione del 18/09). */
create or replace function public.corso_codici_personali(p_corso_id bigint)
returns integer language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare i record; v_alf text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_p text; v_tent int; v_n int := 0; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(p_corso_id) or v_ruolo = 'service_role') then
    raise exception 'non autorizzato';
  end if;
  for i in select id from public.s_corsi_iscritti
            where corso_id = p_corso_id and test_codice is null
              and coalesce(esito, '') not in ('annullato', 'sostituito')
            order by id
  loop
    v_tent := 0;
    loop
      select string_agg(substr(v_alf, 1 + floor(random() * length(v_alf))::int, 1), '')
        into v_p from generate_series(1, 5);
      exit when not exists (
        select 1 from public.s_corsi_iscritti
         where corso_id = p_corso_id and upper(test_codice) = v_p);
      v_tent := v_tent + 1;
      if v_tent > 50 then raise exception 'non riesco a trovare un codice personale libero'; end if;
    end loop;
    update public.s_corsi_iscritti set test_codice = v_p where id = i.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.corso_codici_personali(bigint) from public, anon;

-- ── 6. aprire le firme del corso ─────────────────────────────
create or replace function public.pres_apri(p_corso_id bigint, p_ore integer default 48)
returns table(codice text, link text, chiuso_il timestamptz, codici_personali integer)
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare r record; v_cod text; v_fine timestamptz; v_base text; v_n int; v_alf text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_tent int := 0;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select c.id, c.data_inizio, c.data_fine, c.pres_codice into r from public.s_corsi c where c.id = p_corso_id;
  if not found then raise exception 'corso % non trovato', p_corso_id; end if;

  v_cod := r.pres_codice;
  if v_cod is null then
    loop
      v_cod := 'P' || p_corso_id::text || '-' ||
        (select string_agg(substr(v_alf, 1 + floor(random() * length(v_alf))::int, 1), '') from generate_series(1, 4));
      exit when not exists (select 1 from public.s_corsi where pres_codice = v_cod);
      v_tent := v_tent + 1;
      if v_tent > 50 then raise exception 'non riesco a trovare un codice libero per il corso %', p_corso_id; end if;
    end loop;
  end if;

  /* chiusura: fine dell'ultima giornata più p_ore (come il test) — una firma
     in coda senza rete può arrivare il giorno dopo */
  select (g.data + coalesce(g.alle2, g.alle, time '23:59')) at time zone 'Europe/Rome'
    into v_fine from public.s_corsi_giornate g where g.corso_id = p_corso_id
    order by g.data desc, coalesce(g.alle2, g.alle, time '23:59') desc limit 1;
  if v_fine is null then
    v_fine := ((coalesce(r.data_fine, r.data_inizio, (now() at time zone 'Europe/Rome')::date) + time '23:59') at time zone 'Europe/Rome');
  end if;
  v_fine := v_fine + make_interval(hours => greatest(coalesce(p_ore, 48), 1));

  update public.s_corsi c
     set pres_codice    = v_cod,
         pres_aperto_il = coalesce(c.pres_aperto_il, now()),
         pres_chiuso_il = v_fine,
         firme_qr       = true
   where c.id = p_corso_id;

  v_n := public.corso_codici_personali(p_corso_id);

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');

  return query select v_cod,
    v_base || '?presenza=' || public.url_encode_semplice(v_cod || '.' || public.pres_firma(v_cod)),
    v_fine, v_n;
end $$;
revoke execute on function public.pres_apri(bigint, integer) from public, anon;

/* il link composto e firmato, per il QR del registro e del foglio in aula */
create or replace function public.pres_link(p_corso_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare r record; v_base text;
begin
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(p_corso_id)) then raise exception 'non autorizzato'; end if;
  select c.pres_codice, c.pres_chiuso_il, c.pres_pubblicato_il, c.pres_pubblica_esito into r from public.s_corsi c where c.id = p_corso_id;
  if not found or r.pres_codice is null then return null; end if;
  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');
  return jsonb_build_object(
    'codice', r.pres_codice,
    'link', v_base || '?presenza=' || public.url_encode_semplice(r.pres_codice || '.' || public.pres_firma(r.pres_codice)),
    'chiuso_il', r.pres_chiuso_il,
    'pubblicato_il', r.pres_pubblicato_il,
    'pubblica_esito', r.pres_pubblica_esito);
end $$;
revoke execute on function public.pres_link(bigint) from public, anon;

-- ── 7. che cosa scende al portale ────────────────────────────
/* titolo, giornate con gli orari (così la pagina sa che cosa sta per far
   firmare), persone come impronta del codice personale + iniziali.
   Nessun nome intero, nessun codice fiscale. */
create or replace function public.pres_pubblicazione(p_corso_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare r record; v_giornate jsonb; v_pers jsonb; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or v_ruolo = 'service_role') then raise exception 'non autorizzato'; end if;
  select c.id, c.titolo, c.sede, c.data_inizio, c.data_fine, c.pres_codice, c.pres_chiuso_il
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found or r.pres_codice is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'data',   to_char(g.data, 'YYYY-MM-DD'),
           'dalle',  to_char(g.dalle, 'HH24:MI'),
           'alle',   to_char(g.alle, 'HH24:MI'),
           'dalle2', to_char(g.dalle2, 'HH24:MI'),
           'alle2',  to_char(g.alle2, 'HH24:MI'),
           'sede',   coalesce(g.aula, g.sede)) order by g.data, g.dalle), '[]'::jsonb)
    into v_giornate from public.s_corsi_giornate g where g.corso_id = r.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'h', encode(extensions.digest(convert_to(upper(i.test_codice), 'UTF8'), 'sha256'), 'hex'),
           'n', (select string_agg(left(p, 1) || '.', ' ')
                   from unnest(string_to_array(regexp_replace(coalesce(i.nominativo, ''), '\s+', ' ', 'g'), ' ')) p
                  where p <> ''))), '[]'::jsonb)
    into v_pers
    from public.s_corsi_iscritti i
   where i.corso_id = r.id and i.test_codice is not null
     and coalesce(i.esito, '') not in ('annullato', 'sostituito');

  return jsonb_build_object(
    'codice',    r.pres_codice,
    'firma',     public.pres_firma(r.pres_codice),
    'titolo',    r.titolo,
    'quando',    to_char(coalesce(r.data_inizio, r.data_fine), 'YYYY-MM-DD'),
    'sede',      r.sede,
    'chiuso_il', to_jsonb(r.pres_chiuso_il),
    'giornate',  v_giornate,
    'persone',   v_pers);
end $$;
revoke execute on function public.pres_pubblicazione(bigint) from public, anon;

-- ── 8. la firma che arriva (chiamata da portale-richieste) ──
/* Rifà la firma del link, ritrova corso e persona, sceglie la giornata (quella
   di oggi sull'ora del server; se non c'è, quella del giorno del telefono —
   una firma in coda può arrivare il giorno dopo — altrimenti la più vicina)
   e applica la regola. NON scrive: restituisce i campi calcolati, e la riga
   la inserisce portale-richieste come per gli altri moduli. */
create or replace function public.pres_registra(p_riferimento text, p_codice_personale text, p_ora_dispositivo text, p_submission_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_cod text; v_firma text; p int; c public.s_corsi; i public.s_corsi_iscritti; g public.s_corsi_giornate; v_disp timestamptz; v_dec jsonb;
        v_oggi date; v_note text[] := '{}'; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (v_ruolo = 'service_role' or public.is_segreteria()) then raise exception 'non autorizzato'; end if;

  if p_riferimento is null or position('.' in p_riferimento) = 0 then
    return jsonb_build_object('riferimento_esito', 'senza invito');
  end if;
  p := position('.' in p_riferimento);
  v_cod := upper(substr(p_riferimento, 1, p - 1));
  v_firma := substr(p_riferimento, p + 1);
  if public.pres_firma(v_cod) is distinct from lower(v_firma) then
    return jsonb_build_object('riferimento_esito', 'firma non valida');
  end if;
  select * into c from public.s_corsi where pres_codice = v_cod;
  if not found then return jsonb_build_object('riferimento_esito', 'corso non trovato'); end if;

  select * into i from public.s_corsi_iscritti
   where corso_id = c.id and upper(test_codice) = upper(btrim(coalesce(p_codice_personale, '')));
  if not found then
    /* ⚠️ La firma NON si butta: si conserva senza persona e lo dice. */
    return jsonb_build_object('riferimento_esito', 'persona non riconosciuta', 'corso_id', c.id, 'fonte', 'qr');
  end if;

  begin v_disp := nullif(btrim(coalesce(p_ora_dispositivo, '')), '')::timestamptz; exception when others then v_disp := null; end;
  v_oggi := (now() at time zone 'Europe/Rome')::date;

  select * into g from public.s_corsi_giornate where corso_id = c.id and data = v_oggi order by dalle limit 1;
  if not found and v_disp is not null then
    select * into g from public.s_corsi_giornate where corso_id = c.id and data = (v_disp at time zone 'Europe/Rome')::date order by dalle limit 1;
    if found then v_note := v_note || ('giornata del ' || to_char(g.data, 'DD/MM/YYYY') || ' scelta dall''ora del telefono: arrivata il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')); end if;
  end if;
  if g.id is null then
    select * into g from public.s_corsi_giornate where corso_id = c.id order by abs(data - v_oggi), dalle limit 1;
    if found then v_note := v_note || ('nessuna giornata oggi: scelta la più vicina, ' || to_char(g.data, 'DD/MM/YYYY')); end if;
  end if;
  if g.id is null then
    return jsonb_build_object('riferimento_esito', 'corso senza giornate', 'corso_id', c.id, 'iscritto_id', i.id, 'nominativo', i.nominativo, 'fonte', 'qr');
  end if;

  v_dec := public.pres_decidi(g.data, g.dalle, g.alle, g.dalle2, g.alle2, now());
  if (v_dec ->> 'fuori_orario')::boolean then v_note := v_note || coalesce(v_dec ->> 'motivo', 'fuori orario'); end if;
  if c.pres_chiuso_il is not null and now() > c.pres_chiuso_il then v_note := v_note || 'arrivata dopo la chiusura delle firme'; end if;

  return jsonb_build_object(
    'riferimento_esito', 'riconosciuta',
    'corso_id', c.id, 'giornata_id', g.id, 'iscritto_id', i.id, 'nominativo', i.nominativo,
    'tipo', v_dec ->> 'tipo', 'turno', (v_dec ->> 'turno')::int,
    'ora_server', now(), 'ora_dispositivo', v_disp,
    'fuori_orario', coalesce((v_dec ->> 'fuori_orario')::boolean, true),
    'fonte', 'qr', 'stato', 'ricevuta',
    'note', nullif(array_to_string(v_note, '; '), ''));
end $$;
revoke execute on function public.pres_registra(text, text, text, text) from public, anon, authenticated;
grant execute on function public.pres_registra(text, text, text, text) to service_role;

-- ── 9. la conferma, e le presenze che ne seguono ─────────────
/* una firma confermata scrive la SUA colonna di s_corsi_presenze; una
   conferma ritirata la azzera; le altre colonne non si toccano (regola
   «aprire e salvare non cambia niente»: ognuno scrive solo la sua parte) */
create or replace function public.pres_ricalcola(p_iscritto bigint, p_giornata bigint, p_tipo text, p_turno int)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_ora time; r public.s_corsi_presenze; v_col text; v_ore numeric;
begin
  if p_iscritto is null or p_giornata is null or p_tipo is null or p_turno is null then return; end if;
  select (min(ora_server) at time zone 'Europe/Rome')::time into v_ora
    from public.s_corsi_firme_presenza
   where iscritto_id = p_iscritto and giornata_id = p_giornata and tipo = p_tipo and turno = p_turno and stato = 'confermata';
  v_col := case when p_tipo = 'entrata' then 'ingresso' else 'uscita' end || p_turno::text;

  insert into public.s_corsi_presenze (iscritto_id, giornata_id, presente) values (p_iscritto, p_giornata, true)
  on conflict (iscritto_id, giornata_id) do nothing;
  execute format('update public.s_corsi_presenze set %I = $1 where iscritto_id = $2 and giornata_id = $3', v_col) using v_ora, p_iscritto, p_giornata;

  select * into r from public.s_corsi_presenze where iscritto_id = p_iscritto and giornata_id = p_giornata;
  v_ore := round((
      case when r.ingresso1 is not null and r.uscita1 is not null and r.uscita1 > r.ingresso1 then extract(epoch from (r.uscita1 - r.ingresso1)) / 3600 else 0 end
    + case when r.ingresso2 is not null and r.uscita2 is not null and r.uscita2 > r.ingresso2 then extract(epoch from (r.uscita2 - r.ingresso2)) / 3600 else 0 end)::numeric, 2);
  update public.s_corsi_presenze
     set ore = v_ore,
         presente = presente or v_ora is not null
   where iscritto_id = p_iscritto and giornata_id = p_giornata;
end $$;
revoke execute on function public.pres_ricalcola(bigint, bigint, text, int) from public, anon, authenticated;

create or replace function public.trg_firme_presenza_applica()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.stato = 'confermata' then perform public.pres_ricalcola(new.iscritto_id, new.giornata_id, new.tipo, new.turno); end if;
  elsif tg_op = 'UPDATE' then
    if new.stato = 'confermata' or old.stato = 'confermata' then
      perform public.pres_ricalcola(new.iscritto_id, new.giornata_id, new.tipo, new.turno);
      if old.iscritto_id is distinct from new.iscritto_id or old.giornata_id is distinct from new.giornata_id
         or old.tipo is distinct from new.tipo or old.turno is distinct from new.turno then
        perform public.pres_ricalcola(old.iscritto_id, old.giornata_id, old.tipo, old.turno);
      end if;
    end if;
  elsif tg_op = 'DELETE' then
    if old.stato = 'confermata' then perform public.pres_ricalcola(old.iscritto_id, old.giornata_id, old.tipo, old.turno); end if;
    return old;
  end if;
  return new;
end $$;
drop trigger if exists trg_s_corsi_firme_presenza_applica on public.s_corsi_firme_presenza;
create trigger trg_s_corsi_firme_presenza_applica
  after insert or update or delete on public.s_corsi_firme_presenza
  for each row execute function public.trg_firme_presenza_applica();

/* la conferma di UNA firma (o il suo rifiuto, con una parola) */
create or replace function public.pres_conferma(p_id bigint, p_stato text, p_nota text default null)
returns public.s_corsi_firme_presenza language plpgsql security definer set search_path to 'public' as $$
declare f public.s_corsi_firme_presenza; v_chi text;
begin
  select * into f from public.s_corsi_firme_presenza where id = p_id;
  if not found then raise exception 'firma % non trovata', p_id; end if;
  if not (public.is_segreteria() or public.is_docente_del_corso(f.corso_id)) then raise exception 'non autorizzato'; end if;
  if p_stato not in ('confermata', 'respinta', 'ricevuta') then raise exception 'stato % non previsto', p_stato; end if;
  if p_stato = 'confermata' then
    if f.iscritto_id is null or f.giornata_id is null or f.tipo is null then
      raise exception 'questa firma non è agganciata a una persona e a una giornata: non si può confermare';
    end if;
    if exists (select 1 from public.s_corsi_firme_presenza
                where id <> f.id and iscritto_id = f.iscritto_id and giornata_id = f.giornata_id
                  and tipo = f.tipo and turno = f.turno and stato = 'confermata') then
      raise exception 'c''è già una firma confermata per l''% del turno % di questa persona: respingi quella o questa', f.tipo, f.turno;
    end if;
  end if;
  v_chi := coalesce(auth.jwt() ->> 'email', 'segreteria');
  update public.s_corsi_firme_presenza
     set stato = p_stato,
         confermata_da = case when p_stato = 'ricevuta' then null else v_chi end,
         confermata_il = case when p_stato = 'ricevuta' then null else now() end,
         note = case when nullif(btrim(coalesce(p_nota, '')), '') is null then note
                     else concat_ws('; ', note, btrim(p_nota)) end
   where id = p_id
   returning * into f;
  return f;
end $$;
revoke execute on function public.pres_conferma(bigint, text, text) from public, anon;

/* la conferma PER ALLIEVO (deciso dall'utente): tutte le firme ricevute in
   orario di quella persona in quella giornata, la prima per ogni momento;
   le fuori orario restano da guardare una per una */
create or replace function public.pres_conferma_allievo(p_iscritto_id bigint, p_giornata_id bigint)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare f record; v_n int := 0; v_corso bigint;
begin
  select corso_id into v_corso from public.s_corsi_iscritti where id = p_iscritto_id;
  if v_corso is null then raise exception 'iscritto % non trovato', p_iscritto_id; end if;
  if not (public.is_segreteria() or public.is_docente_del_corso(v_corso)) then raise exception 'non autorizzato'; end if;
  for f in select distinct on (tipo, turno) id from public.s_corsi_firme_presenza
            where iscritto_id = p_iscritto_id and giornata_id = p_giornata_id
              and stato = 'ricevuta' and not fuori_orario and tipo is not null
              and not exists (select 1 from public.s_corsi_firme_presenza x
                               where x.iscritto_id = p_iscritto_id and x.giornata_id = p_giornata_id
                                 and x.tipo = s_corsi_firme_presenza.tipo and x.turno = s_corsi_firme_presenza.turno and x.stato = 'confermata')
            order by tipo, turno, ora_server
  loop
    perform public.pres_conferma(f.id, 'confermata', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.pres_conferma_allievo(bigint, bigint) from public, anon;

-- ── 10. il flusso nel cruscotto «che cosa è stato usato» ─────
/* s_flussi_uso si estende senza ricopiarla: si legge la definizione in
   vigore e si aggiungono le due righe. Se un'ancora non si trova, si ferma. */
do $$
declare d text; a1 text; a2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 's_flussi_uso';
  a1 := 'from public.s_iscrizioni where stato = ''confermata''';
  a2 := '(''Formazione'', ''iscr_confermata'', ''Iscrizione confermata dalla segreteria'')';
  if d is null or position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 's_flussi_uso: ancora non trovata'; end if;
  if position('pres_firma_qr' in d) > 0 then return; end if;
  d := replace(d, a1, a1 || E'\n    /* firme di presenza dal QR (13/10/2026, lotto 4) */'
    || E'\n    union all select ''Formazione'', ''pres_firma_qr'', ''Firma di presenza arrivata dal QR'', ora_server::date from public.s_corsi_firme_presenza where fonte = ''qr'''
    || E'\n    union all select ''Formazione'', ''pres_confermata'', ''Firma di presenza confermata'', confermata_il::date from public.s_corsi_firme_presenza where stato = ''confermata''');
  d := replace(d, a2, a2 || E',\n    (''Formazione'', ''pres_firma_qr'', ''Firma di presenza arrivata dal QR''),\n    (''Formazione'', ''pres_confermata'', ''Firma di presenza confermata'')');
  execute d;
end $$;
