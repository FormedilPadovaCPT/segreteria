-- ============================================================
-- DIREZIONE E CONSIGLIO nel gestionale visite (25/09/2026, deciso
-- dall'utente): la carica degli account di sola lettura, il registro
-- delle QUESTIONI IN ATTESA DI DECISIONE, l'elenco automatico di ciò che
-- aspetta il Direttore e l'obiettivo di visite per esercizio (regola
-- CEIV: 100 visite ogni 50.000 euro di contributi).
--
-- Chi scrive che cosa:
--   · coordinatore e segreteria APRONO le questioni (insert/update diretti,
--     con le policy);
--   · il Direttore (e la Presidenza per le questioni sue) RISPONDE con la
--     funzione s_decisione_rispondi: sono account di sola lettura, e
--     restano tali — la funzione è l'unica porta, come per la conferma dei
--     cantieri critici;
--   · nessuno cancella: una questione si ritira, non si elimina.
-- ============================================================

-- ── 1. la carica degli account di sola lettura ─────────────────────
alter table public.app_ruoli add column if not exists carica text;
alter table public.app_ruoli drop constraint if exists app_ruoli_carica_chk;
alter table public.app_ruoli add constraint app_ruoli_carica_chk
  check (carica is null or carica in ('direttore', 'presidente', 'vicepresidente', 'consigliere'));
comment on column public.app_ruoli.carica is 'Per gli account di sola lettura: direttore | presidente | vicepresidente | consigliere. Il Direttore resta riconosciuto da s_config.direttore_email (is_direttore).';

update public.app_ruoli set carica = 'direttore'      where lower(email) = 'direzione@formedilpadova.it'      and carica is null;
update public.app_ruoli set carica = 'presidente'     where lower(email) = 'presidente@formedilpadova.it'     and carica is null;
update public.app_ruoli set carica = 'vicepresidente' where lower(email) = 'vicepresidente@formedilpadova.it' and carica is null;

create or replace function public.is_presidenza()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_ruoli
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ruolo = 'viewer' and stato = 'attivo'
      and carica in ('presidente', 'vicepresidente')
  );
$$;
revoke all on function public.is_presidenza() from public, anon;
grant execute on function public.is_presidenza() to authenticated;

-- la mia carica (per l'app: che cosa mostrare)
create or replace function public.mia_carica()
returns text language sql stable security definer set search_path = public as $$
  select carica from public.app_ruoli
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and stato = 'attivo'
  limit 1;
$$;
revoke all on function public.mia_carica() from public, anon;
grant execute on function public.mia_carica() to authenticated;

-- ── 2. il registro delle questioni in attesa di decisione ─────────
create table if not exists public.s_decisioni (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  aperta_da     text not null,                 -- email di chi l'ha aperta (dal jwt, trigger)
  aperta_da_nome text,
  aperta_il     date not null default current_date,
  questione     text not null,                 -- una riga: che cosa si chiede
  dettaglio     text,                          -- il contesto, se serve
  riguarda      text,                          -- impresa, pratica, persona, protocollo: testo libero
  link          text,                          -- collegamento alla pratica (un #hash di un'app), facoltativo
  decisore      text not null default 'direttore'
                check (decisore in ('direttore', 'presidenza', 'commissione')),
  entro_il      date,                          -- solo se la questione ha un termine vero
  riservata     boolean not null default false, -- questione sul personale: la vedono Direttore e coordinatore, non la segreteria
  stato         text not null default 'aperta'
                check (stato in ('aperta', 'rinviata', 'decisa', 'chiusa', 'ritirata')),
  rinviata_al   date,                          -- con stato 'rinviata': il promemoria tace fino a quel giorno
  decisione     text,                          -- il testo della decisione
  decisa_da     text,                          -- nome di chi ha deciso
  decisa_da_email text,
  decisa_il     timestamptz,
  chiusa_da     text,                          -- chi ha preso in carico la decisione (coordinatore/segreteria)
  chiusa_il     timestamptz,
  ritirata_motivo text
);
comment on table public.s_decisioni is 'Questioni in attesa di decisione (Direttore, Presidenza, Commissione Sicurezza), aperte da coordinatore e segreteria. Si ritirano, non si cancellano. 25/09/2026.';

create table if not exists public.s_decisioni_eventi (
  id            bigserial primary key,
  decisione_id  bigint not null references public.s_decisioni(id) on delete cascade,
  created_at    timestamptz not null default now(),
  autore        text,
  tipo          text not null,                 -- apertura | modifica | decisione | rinvio | presa_in_carico | ritiro | riapertura
  testo         text
);
create index if not exists s_decisioni_eventi_dec_idx on public.s_decisioni_eventi (decisione_id, created_at);
create index if not exists s_decisioni_stato_idx on public.s_decisioni (stato, decisore);

-- chi apre e quando si aggiorna li mette il database, non la maschera
create or replace function public.s_decisioni_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.aperta_da := coalesce(nullif(v_email, ''), new.aperta_da);
    if new.aperta_da_nome is null then
      select coalesce(
        (select nome from app_ruoli where lower(email) = new.aperta_da and stato = 'attivo' limit 1),
        (select trim(concat_ws(' ', tecnico_nome, tecnico_cognome)) from tecnici where lower(email) = new.aperta_da limit 1))
      into new.aperta_da_nome;
    end if;
    new.stato := 'aperta'; new.decisione := null; new.decisa_da := null; new.decisa_il := null;
    return new;
  end if;
  new.updated_at := now();
  -- quello che ha scritto chi ha aperto non si riscrive da chi non è lui
  new.aperta_da := old.aperta_da; new.aperta_da_nome := old.aperta_da_nome; new.aperta_il := old.aperta_il; new.created_at := old.created_at;
  -- la decisione si scrive SOLO con s_decisione_rispondi (che la marca in dati di sessione)
  if coalesce(current_setting('app.decisione_via_funzione', true), '') <> 'si' then
    new.decisione := old.decisione; new.decisa_da := old.decisa_da; new.decisa_da_email := old.decisa_da_email; new.decisa_il := old.decisa_il;
    new.rinviata_al := old.rinviata_al;
    if new.stato in ('decisa', 'rinviata') and old.stato not in ('decisa', 'rinviata') then
      raise exception 'La decisione si registra con la funzione s_decisione_rispondi';
    end if;
  end if;
  if new.stato = 'chiusa' and old.stato <> 'chiusa' then
    new.chiusa_da := coalesce(new.chiusa_da, v_email); new.chiusa_il := coalesce(new.chiusa_il, now());
  end if;
  return new;
end $$;
drop trigger if exists trg_s_decisioni on public.s_decisioni;
create trigger trg_s_decisioni before insert or update on public.s_decisioni
  for each row execute function public.s_decisioni_tg();

-- la cronologia si scrive da sola
create or replace function public.s_decisioni_eventi_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_tipo text; v_testo text;
begin
  if tg_op = 'INSERT' then
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, v_email, 'apertura', new.questione);
    return null;
  end if;
  if new.stato is distinct from old.stato then
    v_tipo := case new.stato when 'decisa' then 'decisione' when 'rinviata' then 'rinvio' when 'chiusa' then 'presa_in_carico'
                             when 'ritirata' then 'ritiro' when 'aperta' then 'riapertura' end;
    v_testo := case new.stato when 'decisa' then new.decisione
                              when 'rinviata' then coalesce('Rinviata al ' || to_char(new.rinviata_al, 'DD/MM/YYYY'), 'Rinviata') || coalesce(': ' || new.decisione, '')
                              when 'ritirata' then new.ritirata_motivo else null end;
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, coalesce(new.decisa_da_email, v_email), v_tipo, v_testo);
  elsif new.questione is distinct from old.questione or new.dettaglio is distinct from old.dettaglio
     or new.riguarda is distinct from old.riguarda or new.entro_il is distinct from old.entro_il or new.decisore is distinct from old.decisore then
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, v_email, 'modifica', new.questione);
  end if;
  return null;
end $$;
drop trigger if exists trg_s_decisioni_eventi on public.s_decisioni;
create trigger trg_s_decisioni_eventi after insert or update on public.s_decisioni
  for each row execute function public.s_decisioni_eventi_tg();

-- ── policy: di chi sono queste righe ──────────────────────────────
alter table public.s_decisioni enable row level security;
alter table public.s_decisioni_eventi enable row level security;
drop policy if exists s_decisioni_sel on public.s_decisioni;
create policy s_decisioni_sel on public.s_decisioni for select to authenticated using (
  (select public.is_direttore())
  or (select public.is_coordinatore())
  or ((select public.is_segreteria()) and not riservata)
  or ((select public.is_presidenza()) and decisore = 'presidenza')
);
drop policy if exists s_decisioni_ins on public.s_decisioni;
create policy s_decisioni_ins on public.s_decisioni for insert to authenticated with check (
  (select public.is_coordinatore()) or (select public.is_segreteria())
);
drop policy if exists s_decisioni_upd on public.s_decisioni;
create policy s_decisioni_upd on public.s_decisioni for update to authenticated
  using ((select public.is_coordinatore()) or ((select public.is_segreteria()) and not riservata))
  with check ((select public.is_coordinatore()) or ((select public.is_segreteria()) and not riservata));
-- niente delete: si ritira
drop policy if exists s_decisioni_eventi_sel on public.s_decisioni_eventi;
create policy s_decisioni_eventi_sel on public.s_decisioni_eventi for select to authenticated using (
  exists (select 1 from public.s_decisioni d where d.id = decisione_id)   -- eredita la policy del padre
);
grant select, insert, update on public.s_decisioni to authenticated;
grant select on public.s_decisioni_eventi to authenticated;
grant usage, select on sequence public.s_decisioni_id_seq to authenticated;
revoke all on public.s_decisioni, public.s_decisioni_eventi from anon;

-- ── 3. la risposta: la sola porta per chi decide ──────────────────
create or replace function public.s_decisione_rispondi(p_id bigint, p_esito text, p_testo text default null, p_rinvio_al date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_nome text; v_ok boolean := false;
begin
  select * into d from s_decisioni where id = p_id;
  if d.id is null then raise exception 'Questione % non trovata', p_id; end if;
  if d.stato in ('chiusa', 'ritirata') then raise exception 'La questione % è già %', p_id, d.stato; end if;
  if p_esito not in ('decisa', 'rinviata') then raise exception 'Esito non valido: %', p_esito; end if;
  if p_esito = 'decisa' and nullif(trim(coalesce(p_testo, '')), '') is null then raise exception 'Scrivi la decisione'; end if;
  if p_esito = 'rinviata' and (p_rinvio_al is null or p_rinvio_al <= current_date) then raise exception 'Per rinviare serve una data futura'; end if;
  -- chi può rispondere dipende da chi deve decidere
  v_ok := case d.decisore
            when 'direttore'   then coalesce(is_direttore(), false)
            when 'presidenza'  then coalesce(is_presidenza(), false)
            when 'commissione' then coalesce(is_segreteria(), false) or coalesce(is_coordinatore(), false)  -- si registra per conto della Commissione
          end;
  if not v_ok then raise exception 'La risposta spetta a: %', d.decisore; end if;
  select coalesce(
    (select nome from app_ruoli where lower(email) = v_email and stato = 'attivo' limit 1),
    (select trim(concat_ws(' ', tecnico_nome, tecnico_cognome)) from tecnici where lower(email) = v_email limit 1), v_email) into v_nome;
  perform set_config('app.decisione_via_funzione', 'si', true);
  update s_decisioni set
    stato = p_esito,
    decisione = nullif(trim(coalesce(p_testo, '')), ''),
    rinviata_al = case when p_esito = 'rinviata' then p_rinvio_al else null end,
    decisa_da = v_nome, decisa_da_email = v_email, decisa_il = now()
  where id = p_id;
  perform set_config('app.decisione_via_funzione', '', true);
  -- avviso interno a chi ha aperto la questione: testo letto dal database, canale
  -- delle notifiche dell'app (stessa famiglia delle due eccezioni ammesse)
  begin
    if d.aperta_da is not null and d.aperta_da <> v_email then
      perform push_accoda(d.aperta_da, 'decisione',
        case p_esito when 'decisa' then 'C''è una decisione' else 'Una questione è stata rinviata' end,
        case p_esito when 'decisa' then 'Una questione che avevi aperto ha avuto risposta: la trovi nella Zona Coordinatore.'
                     else 'Una questione che avevi aperto è stata rinviata: la data è nella Zona Coordinatore.' end,
        './?vista=admin', 'decisione-' || p_id);
    end if;
  exception when others then raise warning 's_decisione_rispondi avviso: %', sqlerrm; end;
  return jsonb_build_object('id', p_id, 'stato', p_esito, 'decisa_da', v_nome);
end $$;
revoke all on function public.s_decisione_rispondi(bigint, text, text, date) from public, anon;
grant execute on function public.s_decisione_rispondi(bigint, text, text, date) to authenticated;

-- ── 4. l'elenco automatico di ciò che aspetta il Direttore ─────────
-- Una sorgente sola per la pagina Direzione e per il task che allinea le
-- task del vault: autorizzazioni dei servizi CPT «sul tavolo del Direttore»
-- e conferme richieste sui cantieri critici senza risposta. Le questioni
-- scritte a mano stanno in s_decisioni (si leggono con le policy).
create or replace function public.s_direzione_in_attesa()
returns jsonb language sql stable security definer set search_path = public as $$
  with aut as (
    select 'segnalazione' as tipo, id, progressivo, aut_richiesta_il::date as dal,
           coalesce(nullif(trim(concat_ws(' — ', ind_cantiere, comune_cantiere)), ''), notificante, 'cantiere da individuare') as chi
      from s_segnalazioni where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'consulenza', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_consulenze where aut_stato = 'richiesta' and corsia = 'uscita' and stato not in ('chiusa', 'scartata')
    union all
    select case when tipo_richiesta = 'serie' then 'serie di visite' else 'visita richiesta' end, id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_visite_richieste where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'conferenza di cantiere', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_conferenze_cantiere where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'attestazione DM 132', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_attestazioni_dm132 where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
  ),
  crit as (
    select c.id, c.impresa_nome, c.cantiere_desc, c.data_evento,
           (select max(e.created_at) from s_cantieri_critici_eventi e
             where e.critico_id = c.id and e.tipo = 'demandata' and e.dati ->> 'chi' = 'direttore') as chiesta_il
      from s_cantieri_critici c where c.stato not in ('chiuso', 'annullato')
  )
  select case when coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false)
    then jsonb_build_object(
      'autorizzazioni', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'id', id, 'progressivo', progressivo, 'dal', dal, 'chi', chi,
                                   'link', 'https://formedilpadovacpt.github.io/segreteria/#' ||
                                     case tipo when 'segnalazione' then 'segnalazione' when 'consulenza' then 'consulenza'
                                               when 'conferenza di cantiere' then 'conferenza' when 'attestazione DM 132' then 'attestazione' else 'visita' end
                                     || '-' || id) order by dal nulls last) from aut), '[]'::jsonb),
      'critici', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'impresa', impresa_nome, 'cantiere', cantiere_desc, 'data_evento', data_evento, 'dal', chiesta_il::date)
                                   order by chiesta_il) from crit
                            where chiesta_il is not null and not exists (
                              select 1 from s_cantieri_critici_eventi e2 where e2.critico_id = crit.id
                                 and e2.tipo = 'autorizzazione_direttore' and e2.created_at > crit.chiesta_il)), '[]'::jsonb),
      'al', now())
    else jsonb_build_object('autorizzazioni', '[]'::jsonb, 'critici', '[]'::jsonb, 'al', now(), 'non_autorizzato', true) end;
$$;
revoke all on function public.s_direzione_in_attesa() from public, anon;
grant execute on function public.s_direzione_in_attesa() to authenticated;

-- ── 5. l'obiettivo di visite dell'esercizio (regola CEIV) ─────────
-- 100 visite ogni 50.000 euro di contributi Cassa Edile (quota CPT).
-- Lo scrive la segreteria dalla Zona Segreteria; lo leggono tutti nelle
-- Statistiche (anche il Consiglio).
create table if not exists public.visite_obiettivo_esercizio (
  esercizio        text primary key,           -- 'aaaa-aaaa', esercizio 1/10 - 30/9
  contributi_ceiv  numeric(12,2),              -- euro, quota CPT
  visite_minime    integer generated always as (case when contributi_ceiv is null then null else floor(contributi_ceiv / 50000 * 100)::int end) stored,
  visite_minime_manuali integer,               -- se il CdA fissa un numero diverso dal calcolo
  note             text,
  updated_by       text,
  updated_at       timestamptz not null default now()
);
comment on table public.visite_obiettivo_esercizio is 'Visite minime dell''esercizio dalla regola CEIV (100 ogni 50.000 euro di contributi, quota CPT). 25/09/2026.';
alter table public.visite_obiettivo_esercizio enable row level security;
drop policy if exists voe_sel on public.visite_obiettivo_esercizio;
create policy voe_sel on public.visite_obiettivo_esercizio for select to authenticated using ((select public.is_personale()));
drop policy if exists voe_write on public.visite_obiettivo_esercizio;
create policy voe_write on public.visite_obiettivo_esercizio for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
grant select, insert, update, delete on public.visite_obiettivo_esercizio to authenticated;
revoke all on public.visite_obiettivo_esercizio from anon;
create or replace function public.voe_tg() returns trigger language plpgsql as $$
begin new.updated_by := lower(coalesce(auth.jwt() ->> 'email', '')); new.updated_at := now(); return new; end $$;
drop trigger if exists trg_voe on public.visite_obiettivo_esercizio;
create trigger trg_voe before insert or update on public.visite_obiettivo_esercizio for each row execute function public.voe_tg();
