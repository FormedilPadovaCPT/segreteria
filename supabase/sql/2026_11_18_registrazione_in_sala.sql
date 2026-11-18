-- ============================================================
-- REGISTRAZIONE IN SALA (18/11/2026, chiesto dall'utente)
--
-- Ai convegni e ai seminari arriva sempre qualcuno che non si è iscritto
-- (spesso sindacalisti). Fino a oggi lo si aggiungeva a mano al banco, e la
-- firma dal QR non lo riconosceva: riconosce solo chi è in elenco.
--
-- Ora all'ingresso c'è un secondo QR, «Non ti sei iscritto? Registrati qui»
-- (pagina ?sala= del portale, stesso codice e firma del link di iscrizione).
-- Chi lo inquadra manda una RICHIESTA D'ISCRIZIONE normale (modulo `isc`,
-- nessuna modifica a portale-richieste), con dentro la persona marcata
-- `in_sala: entrata` o `uscita`. All'uscita inquadra di nuovo e mette codice
-- fiscale e cognome.
--
-- ⚠️ Chi certifica è la segreteria, dopo l'evento (decisione dell'utente):
--   · la richiesta si conferma come tutte le altre (iscr_conferma,
--     istruttoria coi doppioni);
--   · poi sala_presenze(id) scrive le firme di entrata e di uscita della
--     persona (fonte 'sala', già confermate, ora = quella della
--     registrazione) e chiude con lei le richieste d'uscita con lo stesso
--     codice fiscale.
-- Chi era già iscritto e ha usato il QR della sala (codice dimenticato) non
-- si iscrive di nuovo: sala_presenze trova l'iscritto per codice fiscale.
-- ============================================================

-- ── 1. la richiesta sa se viene dalla sala ──────────────────
alter table public.s_iscrizioni
  add column if not exists in_sala             text check (in_sala in ('entrata', 'uscita')),
  add column if not exists in_sala_il          timestamptz,
  add column if not exists presenze_scritte_il timestamptz;
comment on column public.s_iscrizioni.in_sala is
  'Registrazione in sala (18/11/2026): entrata o uscita dichiarata dalla persona dal QR «Non ti sei iscritto?». Null = iscrizione normale.';
comment on column public.s_iscrizioni.in_sala_il is
  'Ora della registrazione in sala: quella del modulo se è vicina al ritiro (al massimo 15 minuti prima), altrimenti l''ora del ritiro.';
comment on column public.s_iscrizioni.presenze_scritte_il is
  'Quando sala_presenze ha scritto le firme di presenza di questa registrazione in sala.';

/* la marca viaggia dentro la persona (persone[0].in_sala): così il modulo
   resta quello delle iscrizioni e la funzione che ritira non cambia */
create or replace function public.trg_iscrizioni_in_sala()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_tipo text;
begin
  if jsonb_typeof(new.persone) = 'array' and jsonb_array_length(new.persone) = 1 then
    v_tipo := lower(coalesce(new.persone -> 0 ->> 'in_sala', ''));
    if v_tipo in ('entrata', 'uscita') then
      new.in_sala := v_tipo;
      new.in_sala_il := case
        when new.timestamp_modulo is not null
         and new.timestamp_modulo between now() - interval '15 minutes' and now() + interval '2 minutes'
        then new.timestamp_modulo else now() end;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_s_iscrizioni_in_sala on public.s_iscrizioni;
create trigger trg_s_iscrizioni_in_sala before insert on public.s_iscrizioni
  for each row execute function public.trg_iscrizioni_in_sala();
revoke execute on function public.trg_iscrizioni_in_sala() from public, anon;

-- ── 2. le firme possono venire dalla sala ────────────────────
alter table public.s_corsi_firme_presenza drop constraint if exists s_corsi_firme_presenza_fonte_check;
alter table public.s_corsi_firme_presenza add constraint s_corsi_firme_presenza_fonte_check
  check (fonte in ('qr', 'docente', 'carta', 'sala'));

-- ── 3. scrivere le presenze di una registrazione in sala ─────
create or replace function public.sala_presenze(p_iscrizione_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.s_iscrizioni; q record; g record; v_cf text; v_isc record; dec jsonb;
        v_chi text; v_scritte int := 0; v_gia int := 0; v_senza int := 0; v_turno int; v_fuori boolean;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select * into r from public.s_iscrizioni where id = p_iscrizione_id;
  if not found then raise exception 'richiesta % inesistente', p_iscrizione_id; end if;
  if r.in_sala is null then raise exception 'la richiesta % non viene dalla registrazione in sala', p_iscrizione_id; end if;
  if r.stato = 'respinta' then raise exception 'la richiesta % è stata respinta', p_iscrizione_id; end if;

  v_cf := nullif(upper(regexp_replace(coalesce(r.persone -> 0 ->> 'cf', ''), '\s', '', 'g')), '');
  if v_cf is null then raise exception 'nella richiesta % manca il codice fiscale: la presenza va scritta a mano', p_iscrizione_id; end if;

  select i.id, i.nominativo into v_isc from public.s_corsi_iscritti i
   where i.corso_id = r.corso_id and upper(i.cf) = v_cf
     and coalesce(i.esito, '') not in ('annullato', 'sostituito')
   order by i.id limit 1;
  if not found then
    raise exception 'nessun iscritto con codice fiscale % in questo evento: conferma prima l''iscrizione', v_cf;
  end if;

  v_chi := coalesce(auth.jwt() ->> 'email', 'segreteria');

  /* tutte le registrazioni in sala di questa persona in questo evento, non
     ancora scritte: l'entrata di stamattina e l'uscita di mezzogiorno */
  for q in select s.* from public.s_iscrizioni s
            where s.corso_id = r.corso_id and s.in_sala is not null and s.presenze_scritte_il is null
              and s.stato <> 'respinta'
              and upper(regexp_replace(coalesce(s.persone -> 0 ->> 'cf', ''), '\s', '', 'g')) = v_cf
            order by s.in_sala_il
  loop
    select * into g from public.s_corsi_giornate gg
     where gg.corso_id = r.corso_id and gg.data = (q.in_sala_il at time zone 'Europe/Rome')::date
     order by gg.dalle nulls last limit 1;
    if not found then
      v_senza := v_senza + 1;
      update public.s_iscrizioni set note_ufficio = concat_ws(E'\n', note_ufficio,
        'Registrazione in sala del ' || to_char(q.in_sala_il at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI') || ': nessuna giornata dell''evento in quel giorno, presenza non scritta.')
       where id = q.id;
      continue;
    end if;

    dec := public.pres_decidi(g.data, g.dalle, g.alle, g.dalle2, g.alle2, q.in_sala_il);
    v_turno := coalesce((dec ->> 'turno')::int, 1);
    /* entrata o uscita la dice la persona; se l'orario dice altro, si segna */
    v_fuori := coalesce((dec ->> 'fuori_orario')::boolean, true) or coalesce(dec ->> 'tipo', '') <> q.in_sala;

    if exists (select 1 from public.s_corsi_firme_presenza f
                where f.iscritto_id = v_isc.id and f.giornata_id = g.id and f.tipo = q.in_sala
                  and f.turno = v_turno and f.stato = 'confermata') then
      v_gia := v_gia + 1;
    else
      insert into public.s_corsi_firme_presenza
        (corso_id, giornata_id, iscritto_id, nominativo, tipo, turno, ora_server, ora_dispositivo,
         fuori_orario, fonte, stato, confermata_da, confermata_il, note, riferimento_esito)
      values (r.corso_id, g.id, v_isc.id, v_isc.nominativo, q.in_sala, v_turno, q.in_sala_il, q.timestamp_modulo,
              v_fuori, 'sala', 'confermata', v_chi, now(),
              'Registrazione in sala, richiesta n° ' || q.id || '; confermata dalla segreteria dopo l''evento',
              'registrazione in sala');
      v_scritte := v_scritte + 1;
    end if;

    update public.s_iscrizioni set
      presenze_scritte_il = now(),
      stato = case when stato = 'confermata' then stato else 'confermata' end,
      confermata_il = coalesce(confermata_il, now()),
      confermata_da = coalesce(confermata_da, v_chi),
      iscritti_creati = coalesce(iscritti_creati, 0),
      note_ufficio = case when q.id = r.id then note_ufficio
                          else concat_ws(E'\n', note_ufficio, 'Presenza scritta insieme alla richiesta n° ' || r.id || '.') end
     where id = q.id;
  end loop;

  return jsonb_build_object('iscritto_id', v_isc.id, 'nominativo', v_isc.nominativo,
                            'firme_scritte', v_scritte, 'gia_presenti', v_gia, 'senza_giornata', v_senza);
end $$;
revoke execute on function public.sala_presenze(bigint) from public, anon;
grant execute on function public.sala_presenze(bigint) to authenticated, service_role;
comment on function public.sala_presenze(bigint) is
  'Registrazione in sala (18/11/2026): scrive le firme di entrata e uscita (fonte sala, confermate dalla segreteria) di chi si è registrato al QR «Non ti sei iscritto?», trovando l''iscritto per codice fiscale.';

-- ── 4. il link del QR della sala ─────────────────────────────
/* lo stesso codice e la stessa firma del link d'iscrizione: cambia solo la
   pagina del portale (?sala= invece di ?iscrizione=) */
create or replace function public.sala_link(p_corso_id bigint)
returns text language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare l jsonb;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  l := public.iscr_link(p_corso_id);
  if l is null or coalesce(l ->> 'link', '') = '' then return null; end if;
  return replace(l ->> 'link', '?iscrizione=', '?sala=');
end $$;
revoke execute on function public.sala_link(bigint) from public, anon;
grant execute on function public.sala_link(bigint) to authenticated;
