-- ============================================================
-- Commissione Sicurezza: gli accessi al gestionale seguono le NOMINE (09/11/2026, chiesto dall'utente)
--
-- I membri della Commissione Sicurezza stanno già in s_nomine (ruolo «Commissione Sicurezza»,
-- 27 nomine, 8 attive al 09/11/2026, con date di inizio e fine e mansione Presidente /
-- Vice-Presidente / Consigliere). Non si tiene un secondo elenco: la pagina «Commissione Sicurezza»
-- dell'app segreteria confronta le nomine attive con gli accessi (app_ruoli) e propone, per
-- ciascuno, l'azione: crea l'accesso, riaprilo, passaggio di consegne (stesso indirizzo di ruolo,
-- persona nuova), aggiorna la carica, chiudi l'accesso di chi non è più nominato.
--   · l'accesso usa l'indirizzo del ruolo scritto nella nomina (email_ruolo), altrimenti quello
--     della persona; nome e codice fiscale vengono dall'anagrafica persone;
--   · creare o riaprire un account lo fa la funzione commissione-accesso (server, chiave
--     d'amministrazione): password provvisoria = codice fiscale in maiuscolo (decisione del
--     28/09/2026) e cambio obbligatorio al primo accesso (app_cambio_password);
--   · chiudere = app_ruoli.stato «revocato»: niente si cancella, le decisioni prese restano col
--     nome di chi le ha prese;
--   · un solo Presidente e un solo Vicepresidente con l'accesso attivo;
--   · ogni passaggio resta in s_commissione_eventi.
-- Test: tests-db/50_commissione_accessi.sql.
-- ============================================================

create table if not exists public.s_commissione_eventi (
  id bigserial primary key,
  il timestamptz not null default now(),
  da text,
  email text not null,
  persona_id uuid,
  nomina_id integer,
  evento text not null check (evento in ('accesso_creato', 'accesso_riaperto', 'subentro', 'accesso_chiuso', 'carica_aggiornata')),
  dettaglio text
);
comment on table public.s_commissione_eventi is 'Commissione Sicurezza: chi ha aperto, riaperto, passato, chiuso o aggiornato un accesso al gestionale, e quando (09/11/2026). Si scrive solo dalle funzioni.';
alter table public.s_commissione_eventi enable row level security;
drop policy if exists s_commissione_eventi_lettura on public.s_commissione_eventi;
create policy s_commissione_eventi_lettura on public.s_commissione_eventi for select using (is_segreteria());
revoke insert, update, delete on public.s_commissione_eventi from anon, authenticated;

/* la carica dell'accesso dalla mansione della nomina */
create or replace function public.s_commissione_carica(p_mansione text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when lower(regexp_replace(coalesce(p_mansione, ''), '[^a-zA-Z]', '', 'g')) = 'presidente' then 'presidente'
    when lower(regexp_replace(coalesce(p_mansione, ''), '[^a-zA-Z]', '', 'g')) = 'vicepresidente' then 'vicepresidente'
    else 'consigliere' end
$$;

/* i nominati attivi, uno per indirizzo (la nomina più recente) */
create or replace function public.s_commissione_nominati()
returns table (nomina_id integer, persona_id uuid, nominativo text, mansione text, carica text, dal date, email text, cf text)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (x.email) x.access_id, x.persona_id, x.nominativo, x.mansione, x.carica, x.data_inizio, x.email, x.cf
  from (
    select n.access_id, n.persona_id, n.mansione, n.data_inizio,
           coalesce(nullif(trim(concat_ws(' ', p.nome, p.cognome)), ''), n.persona_txt) as nominativo,
           s_commissione_carica(n.mansione) as carica,
           lower(trim(coalesce(nullif(trim(n.email_ruolo), ''), p.email))) as email,
           upper(trim(p.cf)) as cf
    from s_nomine n left join persone p on p.persona_id = n.persona_id
    where n.ruolo_id = (select id_ruolo from s_ruoli where ruolo = 'Commissione Sicurezza')
      and (n.data_fine is null or n.data_fine >= current_date)
  ) x
  order by x.email, x.data_inizio desc nulls last
$$;
revoke execute on function public.s_commissione_nominati() from public, anon, authenticated;

/* collega all'anagrafica gli accessi che non lo erano (Presidente, Vicepresidente, un consigliere al 09/11) */
update public.app_ruoli r set persona_id = n.persona_id
  from public.s_commissione_nominati() n
 where r.persona_id is null and lower(r.email) = n.email and n.persona_id is not null;

/* il quadro per la pagina della segreteria */
create or replace function public.s_commissione_situazione()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb; w jsonb;
begin
  if not coalesce(is_segreteria(), false) then raise exception 'La pagina della Commissione è della segreteria'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'nomina_id', n.nomina_id, 'persona_id', n.persona_id, 'nominativo', n.nominativo, 'mansione', n.mansione,
      'carica', n.carica, 'dal', n.dal, 'email', n.email, 'cf_ok', coalesce(n.cf ~ '^[A-Z0-9]{16}$', false),
      'accesso', case when r.email is null and u.id is null then null else jsonb_build_object(
          'email', r.email, 'ruolo', r.ruolo, 'stato', r.stato, 'carica', r.carica, 'nome', r.nome,
          'stessa_persona', r.persona_id is not distinct from n.persona_id,
          'account', u.id is not null, 'ultimo_accesso', u.last_sign_in_at,
          'password_cambiata', c.cambiata_il, 'password_da_cambiare', c.user_id is not null and c.cambiata_il is null) end,
      'da_fare', case
          when n.email is null then 'manca_email'
          when r.email is not null and r.ruolo <> 'viewer' then 'conflitto'
          when r.email is null or u.id is null then case when coalesce(n.cf ~ '^[A-Z0-9]{16}$', false) then 'crea' else 'manca_cf' end
          when r.persona_id is not null and r.persona_id is distinct from n.persona_id then 'subentro'
          when r.stato <> 'attivo' then 'riapri'
          when r.carica is distinct from n.carica then 'carica'
          else 'ok' end)
      order by case n.carica when 'presidente' then 1 when 'vicepresidente' then 2 else 3 end, n.nominativo), '[]'::jsonb)
    into v
    from s_commissione_nominati() n
    left join app_ruoli r on lower(r.email) = n.email
    left join auth.users u on lower(u.email) = n.email
    left join app_cambio_password c on c.user_id = u.id;
  select coalesce(jsonb_agg(jsonb_build_object('email', r.email, 'nome', r.nome, 'carica', r.carica,
           'ultimo_accesso', u.last_sign_in_at) order by r.nome), '[]'::jsonb)
    into w
    from app_ruoli r left join auth.users u on lower(u.email) = lower(r.email)
   where r.ruolo = 'viewer' and r.stato = 'attivo' and r.carica in ('presidente', 'vicepresidente', 'consigliere')
     and lower(r.email) not in (select n.email from s_commissione_nominati() n where n.email is not null);
  return jsonb_build_object('membri', v, 'da_chiudere', w,
    'ultimi_eventi', (select coalesce(jsonb_agg(to_jsonb(e) order by e.il desc), '[]'::jsonb)
                        from (select il, da, email, evento, dettaglio from s_commissione_eventi order by il desc limit 10) e));
end $function$;
grant execute on function public.s_commissione_situazione() to authenticated;

/* chiudere l'accesso di chi non è più nominato */
create or replace function public.s_commissione_chiudi(p_email text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.app_ruoli; v_da text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not coalesce(is_segreteria(), false) then raise exception 'Gli accessi della Commissione li chiude la segreteria'; end if;
  select * into r from app_ruoli where lower(email) = lower(trim(p_email)) for update;
  if r.email is null then raise exception 'Nessun accesso con l''indirizzo %', p_email; end if;
  if r.ruolo <> 'viewer' or coalesce(r.carica, '') not in ('presidente', 'vicepresidente', 'consigliere') then
    raise exception 'Da qui si chiudono solo gli accessi della Commissione';
  end if;
  if r.stato <> 'attivo' then raise exception 'L''accesso di % è già chiuso', r.nome; end if;
  if exists (select 1 from s_commissione_nominati() n where n.email = lower(r.email)) then
    raise exception '% risulta ancora nominato nella Commissione: prima si chiude la nomina, in Nomine', r.nome;
  end if;
  update app_ruoli set stato = 'revocato' where email = r.email;
  insert into s_commissione_eventi (da, email, persona_id, evento, dettaglio)
  values (v_da, r.email, r.persona_id, 'accesso_chiuso', coalesce(nullif(trim(p_motivo), ''), 'nomina chiusa') || ' (' || coalesce(r.nome, '') || ', ' || coalesce(r.carica, '') || ')');
  return jsonb_build_object('email', r.email, 'stato', 'revocato');
end $function$;
grant execute on function public.s_commissione_chiudi(text, text) to authenticated;

/* allineare la carica dell'accesso alla nomina (un Presidente e un Vicepresidente soli) */
create or replace function public.s_commissione_aggiorna_carica(p_nomina integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n record; r public.app_ruoli; v_da text := lower(coalesce(auth.jwt() ->> 'email', '')); v_altro text;
begin
  if not coalesce(is_segreteria(), false) then raise exception 'La carica la aggiorna la segreteria'; end if;
  select * into n from s_commissione_nominati() x where x.nomina_id = p_nomina;
  if n.nomina_id is null then raise exception 'La nomina % non è una nomina attiva della Commissione', p_nomina; end if;
  select * into r from app_ruoli where lower(email) = n.email for update;
  if r.email is null or r.stato <> 'attivo' or r.persona_id is distinct from n.persona_id then
    raise exception 'L''accesso di % non è aperto a suo nome: prima si crea o si passa', n.nominativo;
  end if;
  if n.carica in ('presidente', 'vicepresidente') then
    select nome into v_altro from app_ruoli where carica = n.carica and stato = 'attivo' and lower(email) <> n.email limit 1;
    if v_altro is not null then raise exception 'Prima si chiude l''accesso di %, che ha ancora la carica di %', v_altro, n.carica; end if;
  end if;
  update app_ruoli set carica = n.carica where email = r.email;
  insert into s_commissione_eventi (da, email, persona_id, nomina_id, evento, dettaglio)
  values (v_da, r.email, r.persona_id, n.nomina_id, 'carica_aggiornata', coalesce(r.carica, '—') || ' → ' || n.carica);
  return jsonb_build_object('email', r.email, 'carica', n.carica);
end $function$;
grant execute on function public.s_commissione_aggiorna_carica(integer) to authenticated;

/* ── per la funzione commissione-accesso (solo con la chiave d'amministrazione) ── */
create or replace function public.s_commissione_accesso_prepara(p_nomina integer, p_da text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n record; r public.app_ruoli; v_user uuid; v_sit text; v_altro text;
begin
  if not exists (select 1 from app_ruoli where lower(email) = lower(p_da) and ruolo in ('segreteria', 'admin') and stato = 'attivo') then
    raise exception 'Gli accessi della Commissione li apre la segreteria';
  end if;
  select * into n from s_commissione_nominati() x where x.nomina_id = p_nomina;
  if n.nomina_id is null then raise exception 'La nomina % non è una nomina attiva della Commissione', p_nomina; end if;
  if n.email is null then raise exception 'La nomina di % non ha un indirizzo: scrivilo nella nomina o nella scheda persona', n.nominativo; end if;
  if coalesce(n.cf, '') !~ '^[A-Z0-9]{16}$' then raise exception 'Manca il codice fiscale di % nell''anagrafica: serve per la password provvisoria', n.nominativo; end if;
  select * into r from app_ruoli where lower(email) = n.email;
  if r.email is not null and r.ruolo <> 'viewer' then
    raise exception 'L''indirizzo % è già usato da un accesso di altro tipo (%): non si tocca da qui', n.email, r.ruolo;
  end if;
  select id into v_user from auth.users where lower(email) = n.email;
  v_sit := case when v_user is null then 'nuovo'
                when r.email is null then 'riapri'
                when r.persona_id is not null and r.persona_id is distinct from n.persona_id then 'subentro'
                when r.stato <> 'attivo' then 'riapri'
                else 'ha_gia' end;
  if v_sit = 'ha_gia' then raise exception '% ha già l''accesso', n.nominativo; end if;
  if n.carica in ('presidente', 'vicepresidente') then
    select nome into v_altro from app_ruoli where carica = n.carica and stato = 'attivo' and lower(email) <> n.email limit 1;
    if v_altro is not null then raise exception 'Prima si chiude l''accesso di %, che ha ancora la carica di %', v_altro, n.carica; end if;
  end if;
  return jsonb_build_object('email', n.email, 'nome', n.nominativo, 'carica', n.carica, 'cf', n.cf, 'persona_id', n.persona_id,
                            'user_id', v_user, 'situazione', v_sit, 'nome_precedente', r.nome);
end $function$;

create or replace function public.s_commissione_accesso_registra(p_nomina integer, p_user_id uuid, p_da text, p_evento text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n record; v_prima text;
begin
  if p_evento not in ('accesso_creato', 'accesso_riaperto', 'subentro') then raise exception 'Evento non previsto: %', p_evento; end if;
  select * into n from s_commissione_nominati() x where x.nomina_id = p_nomina;
  if n.nomina_id is null then raise exception 'La nomina % non è una nomina attiva della Commissione', p_nomina; end if;
  select nome into v_prima from app_ruoli where lower(email) = n.email;
  insert into app_ruoli (email, ruolo, stato, nome, carica, persona_id)
  values (n.email, 'viewer', 'attivo', n.nominativo, n.carica, n.persona_id)
  on conflict (email) do update set ruolo = 'viewer', stato = 'attivo', nome = excluded.nome, carica = excluded.carica, persona_id = excluded.persona_id;
  insert into app_cambio_password (user_id, email, richiesto_il, richiesto_da, motivo, cambiata_il)
  values (p_user_id, n.email, now(), p_da, 'primo accesso: password provvisoria = codice fiscale', null)
  on conflict (user_id) do update set email = excluded.email, richiesto_il = now(), richiesto_da = excluded.richiesto_da,
                                      motivo = excluded.motivo, cambiata_il = null;
  insert into s_commissione_eventi (da, email, persona_id, nomina_id, evento, dettaglio)
  values (lower(p_da), n.email, n.persona_id, n.nomina_id, p_evento,
          n.nominativo || ', ' || n.carica || case when p_evento = 'subentro' and v_prima is not null then ' (prima: ' || v_prima || ')' else '' end);
  return jsonb_build_object('email', n.email, 'nome', n.nominativo, 'carica', n.carica);
end $function$;

revoke execute on function public.s_commissione_accesso_prepara(integer, text) from public, anon, authenticated;
revoke execute on function public.s_commissione_accesso_registra(integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.s_commissione_accesso_prepara(integer, text) to service_role;
grant execute on function public.s_commissione_accesso_registra(integer, uuid, text, text) to service_role;
grant execute on function public.s_commissione_nominati() to service_role;
