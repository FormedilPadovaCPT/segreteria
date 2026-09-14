-- =============================================================================
--  NOME E COGNOME SCRITTI AL CONTRARIO: SI CORREGGONO AL SALVATAGGIO (14/09/2026)
-- -----------------------------------------------------------------------------
--  Richiesta dell'utente: «quando riscontri inversioni palesi del nome cognome
--  applica tu la correzione in fase di salvataggio». Caso d'origine: il
--  committente persona fisica del verbale 866, nome «Triani» e cognome
--  «Stefano». Nasce dal parser di import, che per il committente PF prende la
--  prima parola della ragione sociale come cognome; ma inversioni arrivano da
--  ogni porta (form, import, Access), quindi la regola sta nel database.
--
--  «Palese» vuol dire una di queste due cose, e nient'altro:
--    1. c'e' il CODICE FISCALE e le sue lettere tornano solo nell'ordine
--       inverso (e' il controllo deterministico gia' scritto nel CLAUDE.md per
--       gli attestati). Se il CF non torna in nessuno dei due ordini non si
--       decide;
--    2. senza CF, il DIZIONARIO DEI NOMI dell'anagrafica persone (lo stesso di
--       sesso_da_nome): ogni parola del cognome e' un nome di battesimo ben
--       attestato (almeno 5 persone, e almeno 10 volte piu' spesso come nome
--       che come cognome) e NESSUNA parola del nome compare mai come nome di
--       battesimo. Cosi' «Triani / Stefano» si gira, «Eusebiu / Vasile
--       Antonovici» e «Gouda Ahmed / Mohamed Tawfik» no.
--  Le parole di due lettere (De, Di, La) e i titoli non contano; i record con
--  la stessa coppia nome/cognome non fanno testo, altrimenti l'inversione
--  stessa si darebbe ragione.
--
--  Ogni scambio si scrive in anagrafica_inversioni (prima, dopo, motivo, chi):
--  e' la traccia per tornare indietro. Un titolo finito in testa al nome
--  («Geo Zago») passa nel campo titolo, se e' vuoto.
--
--  Trigger: trg_persone_a_inversione (BEFORE, prima di cf_fill e del
--  completamento anagrafica, cosi' il sesso si calcola dal nome giusto) e
--  trg_visite_a_inversione sulle coppie di committente PF, persona presente,
--  RL, CSP e CSE, con la stringa del verbale ricomposta. Un errore non blocca
--  mai il salvataggio.
--
--  Applicata su Supabase come migrazione inversioni_nome_cognome_2026_09_14.
-- =============================================================================

-- ── 1. Le lettere del codice fiscale ─────────────────────────────────────────
create or replace function public.parole_nominativo(t text)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(array(
    select u.w
      from unnest(regexp_split_to_array(
             upper(translate(coalesce(t, ''), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')),
             '[^A-Z]+')) with ordinality as u(w, i)
     where u.w <> ''
       and u.w not in ('GEOM', 'GEOMETRA', 'GEO', 'ING', 'INGEGNERE', 'ARCH', 'ARCHITETTO',
                       'DOTT', 'DOTTSSA', 'SSA', 'DR', 'SIG', 'RA', 'SIGG', 'SIGNOR', 'SIGNORA',
                       'AVV', 'RAG', 'PROF', 'PER', 'IND', 'PERITO', 'PI')
     order by u.i), '{}')
$$;

create or replace function public.cf_codice_cognome(p text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select substr(regexp_replace(x, '[AEIOU]', '', 'g') || regexp_replace(x, '[^AEIOU]', '', 'g') || 'XXX', 1, 3)
    from (select array_to_string(public.parole_nominativo(p), '') x) s
$$;

create or replace function public.cf_codice_nome(p text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case when length(c) >= 4 then substr(c, 1, 1) || substr(c, 3, 1) || substr(c, 4, 1)
              else substr(c || v || 'XXX', 1, 3) end
    from (select regexp_replace(x, '[AEIOU]', '', 'g') c, regexp_replace(x, '[^AEIOU]', '', 'g') v
            from (select array_to_string(public.parole_nominativo(p), '') x) s) s2
$$;

revoke execute on function public.parole_nominativo(text) from public, anon;
revoke execute on function public.cf_codice_cognome(text) from public, anon;
revoke execute on function public.cf_codice_nome(text) from public, anon;
grant execute on function public.parole_nominativo(text) to authenticated, service_role;
grant execute on function public.cf_codice_cognome(text) to authenticated, service_role;
grant execute on function public.cf_codice_nome(text) to authenticated, service_role;

-- ── 2. Sono invertiti? (null = no, o non si sa) ──────────────────────────────
create or replace function public.nome_cognome_invertiti(p_nome text, p_cognome text, p_cf text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cf     text := upper(regexp_replace(coalesce(p_cf, ''), '[^A-Za-z0-9]', '', 'g'));
  tn     text[] := public.parole_nominativo(p_nome);
  tc     text[] := public.parole_nominativo(p_cognome);
  t      text;
  n_nome integer;
  n_cog  integer;
  conta  integer := 0;
begin
  if coalesce(array_length(tn, 1), 0) = 0 or coalesce(array_length(tc, 1), 0) = 0 then
    return null;
  end if;

  -- 1. il codice fiscale decide, se c'e'
  if cf ~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z]' and length(cf) = 16 then
    if substr(cf, 1, 3) = public.cf_codice_cognome(p_cognome) and substr(cf, 4, 3) = public.cf_codice_nome(p_nome) then
      return null;
    end if;
    if substr(cf, 1, 3) = public.cf_codice_cognome(p_nome) and substr(cf, 4, 3) = public.cf_codice_nome(p_cognome) then
      return 'codice fiscale';
    end if;
    return null;
  end if;

  -- 2. senza CF: ogni parola del cognome e' un nome di battesimo ben attestato...
  foreach t in array tc loop
    continue when length(t) < 3;
    conta := conta + 1;
    select count(*) into n_nome from public.persone pp
     where upper(split_part(trim(pp.nome), ' ', 1)) = t and coalesce(pp.elimina, 0) = 0
       and not (upper(trim(pp.nome)) = upper(trim(p_nome)) and upper(trim(coalesce(pp.cognome, ''))) = upper(trim(p_cognome)));
    select count(*) into n_cog from public.persone pp
     where lower(pp.cognome) = lower(t) and coalesce(pp.elimina, 0) = 0;
    if n_nome < 5 or n_cog * 10 > n_nome then
      return null;
    end if;
  end loop;
  if conta = 0 then
    return null;
  end if;

  -- ...e nessuna parola del nome lo e' mai
  conta := 0;
  foreach t in array tn loop
    continue when length(t) < 3;
    conta := conta + 1;
    select count(*) into n_nome from public.persone pp
     where upper(split_part(trim(pp.nome), ' ', 1)) = t and coalesce(pp.elimina, 0) = 0
       and not (upper(trim(pp.nome)) = upper(trim(p_nome)) and upper(trim(coalesce(pp.cognome, ''))) = upper(trim(p_cognome)));
    if n_nome > 0 then
      return null;
    end if;
  end loop;
  if conta = 0 then
    return null;
  end if;

  return 'dizionario dei nomi';
end;
$$;
revoke execute on function public.nome_cognome_invertiti(text, text, text) from public, anon, authenticated;
grant execute on function public.nome_cognome_invertiti(text, text, text) to service_role;

-- ── 3. Lo scambio, col titolo al suo posto ───────────────────────────────────
create or replace function public.inverti_nome_cognome(p_nome text, p_cognome text, p_titolo text,
                                                        out nome text, out cognome text, out titolo text)
language plpgsql
immutable
set search_path = public
as $$
declare
  re constant text := '^(geometra|geom|geo|ingegnere|ing|architetto|arch|dottssa|dott|dr|avv|rag|prof|signor|sig)[.]?[[:space:]]+';
  m  text[];
  t  text;
begin
  titolo  := p_titolo;
  cognome := trim(coalesce(p_nome, ''));
  nome    := trim(coalesce(p_cognome, ''));
  m := regexp_match(cognome, re, 'i');
  if m is not null then
    cognome := regexp_replace(cognome, re, '', 'i');
    t := m[1];
  end if;
  m := regexp_match(nome, re, 'i');
  if m is not null then
    nome := regexp_replace(nome, re, '', 'i');
    t := coalesce(t, m[1]);
  end if;
  if t is not null and coalesce(trim(titolo), '') = '' then
    titolo := case lower(t)
                when 'geometra' then 'Geom.' when 'geom' then 'Geom.' when 'geo' then 'Geom.'
                when 'ingegnere' then 'Ing.' when 'ing' then 'Ing.'
                when 'architetto' then 'Arch.' when 'arch' then 'Arch.'
                when 'dottssa' then 'Dott.ssa' when 'dott' then 'Dott.' when 'dr' then 'Dott.'
                when 'avv' then 'Avv.' when 'rag' then 'Rag.' when 'prof' then 'Prof.'
                else titolo end;
  end if;
  nome    := nullif(nome, '');
  cognome := nullif(cognome, '');
end;
$$;
revoke execute on function public.inverti_nome_cognome(text, text, text) from public, anon;
grant execute on function public.inverti_nome_cognome(text, text, text) to authenticated, service_role;

-- ── 4. Il registro degli scambi ──────────────────────────────────────────────
create table if not exists public.anagrafica_inversioni (
  id            bigint generated always as identity primary key,
  tabella       text not null,
  chiave        text not null,
  campo         text not null,
  nome_prima    text,
  cognome_prima text,
  nome_dopo     text,
  cognome_dopo  text,
  motivo        text not null,
  utente        text,
  creato_il     timestamptz not null default now()
);
alter table public.anagrafica_inversioni enable row level security;
drop policy if exists inv_sel on public.anagrafica_inversioni;
create policy inv_sel on public.anagrafica_inversioni for select to authenticated
  using ((select public.is_segreteria()));
revoke all on public.anagrafica_inversioni from anon;

create or replace function public.registra_inversione(p_tabella text, p_chiave text, p_campo text,
                                                      p_nome_prima text, p_cognome_prima text,
                                                      p_nome_dopo text, p_cognome_dopo text, p_motivo text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.anagrafica_inversioni (tabella, chiave, campo, nome_prima, cognome_prima,
                                            nome_dopo, cognome_dopo, motivo, utente)
  values (p_tabella, p_chiave, p_campo, p_nome_prima, p_cognome_prima, p_nome_dopo, p_cognome_dopo, p_motivo,
          coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', current_user::text));
$$;
revoke execute on function public.registra_inversione(text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.registra_inversione(text, text, text, text, text, text, text, text) to service_role;

-- ── 5. Trigger su persone ────────────────────────────────────────────────────
create or replace function public.tg_persone_inversione()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mot text;
  r   record;
begin
  if coalesce(new.elimina, 0) <> 0 then
    return new;
  end if;
  mot := public.nome_cognome_invertiti(new.nome, new.cognome, new.cf);
  if mot is null then
    return new;
  end if;
  select * into r from public.inverti_nome_cognome(new.nome, new.cognome, new.titolo);
  perform public.registra_inversione('persone', new.persona_id::text, 'nome/cognome',
                                     new.nome, new.cognome, r.nome, r.cognome, mot);
  new.nome := r.nome;
  new.cognome := r.cognome;
  new.titolo := r.titolo;
  return new;
exception when others then
  raise warning 'inversione nome/cognome (persona %): %', new.persona_id, sqlerrm;
  return new;
end;
$$;
revoke execute on function public.tg_persone_inversione() from public, anon, authenticated;
grant execute on function public.tg_persone_inversione() to service_role;

drop trigger if exists trg_persone_a_inversione on public.persone;
create trigger trg_persone_a_inversione
  before insert or update of nome, cognome, cf
  on public.persone
  for each row execute function public.tg_persone_inversione();

-- ── 6. Trigger sulle visite ──────────────────────────────────────────────────
create or replace function public.tg_visite_inversione()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mot text;
  r   record;
begin
  if coalesce(new.elimina, 0) <> 0 then
    return new;
  end if;

  if new.comm_tipo_sogg = 'PF' then
    mot := public.nome_cognome_invertiti(new.comm_nome, new.comm_cog, new.comm_cf);
    if mot is not null then
      select * into r from public.inverti_nome_cognome(new.comm_nome, new.comm_cog, new.comm_titolo);
      perform public.registra_inversione('visite', new.visita_id, 'committente', new.comm_nome, new.comm_cog, r.nome, r.cognome, mot);
      new.comm_nome := r.nome; new.comm_cog := r.cognome; new.comm_titolo := r.titolo;
    end if;
  end if;

  mot := public.nome_cognome_invertiti(new.ppre_nome, new.ppre_cog, null);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.ppre_nome, new.ppre_cog, new.ppre_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'persona presente', new.ppre_nome, new.ppre_cog, r.nome, r.cognome, mot);
    new.ppre_nome := r.nome; new.ppre_cog := r.cognome; new.ppre_titolo := r.titolo;
    new.nom_ppre := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.rl_nome, new.rl_cog, null);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.rl_nome, new.rl_cog, new.rl_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'responsabile dei lavori', new.rl_nome, new.rl_cog, r.nome, r.cognome, mot);
    new.rl_nome := r.nome; new.rl_cog := r.cognome; new.rl_titolo := r.titolo;
    new.resp_lav := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.csp_nome, new.csp_cog, null);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.csp_nome, new.csp_cog, new.csp_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'CSP', new.csp_nome, new.csp_cog, r.nome, r.cognome, mot);
    new.csp_nome := r.nome; new.csp_cog := r.cognome; new.csp_titolo := r.titolo;
    new.csp := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.cse_nome, new.cse_cog, null);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.cse_nome, new.cse_cog, new.cse_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'CSE', new.cse_nome, new.cse_cog, r.nome, r.cognome, mot);
    new.cse_nome := r.nome; new.cse_cog := r.cognome; new.cse_titolo := r.titolo;
    new.cse := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  return new;
exception when others then
  raise warning 'inversione nome/cognome (visita %): %', new.visita_id, sqlerrm;
  return new;
end;
$$;
revoke execute on function public.tg_visite_inversione() from public, anon, authenticated;
grant execute on function public.tg_visite_inversione() to service_role;

drop trigger if exists trg_visite_a_inversione on public.visite;
create trigger trg_visite_a_inversione
  before insert or update of comm_nome, comm_cog, comm_cf, comm_tipo_sogg,
                             ppre_nome, ppre_cog, rl_nome, rl_cog,
                             csp_nome, csp_cog, cse_nome, cse_cog
  on public.visite
  for each row execute function public.tg_visite_inversione();
