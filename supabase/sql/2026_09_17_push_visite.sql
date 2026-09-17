-- ============================================================
-- NOTIFICHE SUL TELEFONO DEI TECNICI — gestionale visite installabile
-- (17/09/2026, chiesto dall'utente)
--
-- Il gestionale visite diventa un'app installabile e chi vuole attiva le
-- notifiche sul proprio telefono. Stesso motore dell'app servizi (Web Push,
-- modulo webpush.js provato col vettore dell'RFC 8291), con una differenza
-- che conta: lì l'avviso va a tutti, QUI VA A UNA PERSONA — l'iscrizione è
-- legata all'account con cui il tecnico è entrato.
--
-- Tre regole tenute ferme:
--  1. LA NOTIFICA NON STA MAI DENTRO IL SALVATAGGIO. I trigger scrivono solo
--     una riga in push_coda, dentro un blocco che inghiotte gli errori; la
--     spedizione la fa la funzione push-visite, chiamata col campanello
--     ASINCRONO di pg_net (parte dopo il commit). Un guasto delle notifiche
--     non può bloccare un incarico, un verbale o una fattura.
--  2. NIENTE NOMI NEL TESTO: una notifica si legge sulla schermata di blocco.
--     I testi sono fissi («Hai un nuovo incarico»), il dettaglio si legge
--     nell'app. Nessun testo scritto da un utente finisce in una notifica.
--  3. LE NOTIFICHE SI AFFIANCANO ALLE MAIL, NON LE SOSTITUISCONO: ciascuno le
--     attiva sul proprio telefono, e può non farlo.
--
-- Chi non ha nessun telefono iscritto: la riga di coda si chiude come
-- «nessun_dispositivo». È un fatto, non un errore.
-- ============================================================

create extension if not exists pg_net;

-- ---------- impostazioni: solo il database e la funzione ----------
create table if not exists public.push_impostazioni (
  chiave       text primary key,
  valore       text not null,
  descrizione  text,
  updated_at   timestamptz not null default now()
);
alter table public.push_impostazioni enable row level security;   -- nessuna policy: solo service_role
revoke all on public.push_impostazioni from anon, authenticated;

insert into public.push_impostazioni (chiave, valore, descrizione) values
  ('campanello_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine del campanello (trigger e giro pg_cron) verso push-visite. Non esce dal database.'),
  ('contatto', 'mailto:cpt@formedilpadova.it', 'Contatto dichiarato ai servizi di notifica (VAPID sub).'),
  ('funzione_url', 'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/push-visite', 'Indirizzo della funzione che spedisce.')
on conflict (chiave) do nothing;

-- ---------- i telefoni iscritti ----------
create table if not exists public.push_iscrizioni (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  email               text not null,
  tecnico_id          text references public.tecnici(tecnico_id) on update cascade on delete set null,
  endpoint            text not null unique,
  p256dh              text not null,
  auth                text not null,
  dispositivo         text not null default 'altro' check (dispositivo in ('android', 'iphone', 'computer', 'altro')),
  ultima_consegna_il  timestamptz,
  errori              integer not null default 0
);
comment on table public.push_iscrizioni is 'I telefoni (browser) su cui un tecnico ha attivato le notifiche del gestionale visite. Le scrive solo la funzione push-visite; ognuno vede le proprie.';
create index if not exists push_iscrizioni_email_idx on public.push_iscrizioni (lower(email));
alter table public.push_iscrizioni enable row level security;
drop policy if exists push_iscrizioni_sel on public.push_iscrizioni;
create policy push_iscrizioni_sel on public.push_iscrizioni for select to authenticated
  using (lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), '')) or (select is_segreteria()));
-- le chiavi del telefono (endpoint, p256dh, auth) non le legge nessun client: solo la funzione
revoke all on public.push_iscrizioni from anon, authenticated;
grant select (id, created_at, email, tecnico_id, dispositivo, ultima_consegna_il, errori) on public.push_iscrizioni to authenticated;

-- ---------- la coda ----------
create table if not exists public.push_coda (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  email           text not null,
  evento          text not null,
  titolo          text not null,
  testo           text not null,
  url             text not null default './',
  tag             text not null default 'gestionale',
  stato           text not null default 'in_attesa' check (stato in ('in_attesa', 'inviata', 'nessun_dispositivo', 'errore')),
  prenotata_fino  timestamptz,
  tentativi       integer not null default 0,
  inviata_il      timestamptz,
  esito           jsonb
);
comment on table public.push_coda is 'Notifiche da spedire ai tecnici. La riempiono i trigger (testi fissi, mai nomi), la svuota la funzione push-visite.';
create index if not exists push_coda_attesa_idx on public.push_coda (created_at) where stato = 'in_attesa';
alter table public.push_coda enable row level security;
drop policy if exists push_coda_sel on public.push_coda;
create policy push_coda_sel on public.push_coda for select to authenticated using ((select is_segreteria()));
revoke all on public.push_coda from anon, authenticated;
grant select on public.push_coda to authenticated;

-- ---------- accodare + suonare il campanello ----------
-- Non alza MAI un'eccezione: chi la chiama è un trigger dentro un salvataggio.
create or replace function public.push_accoda(p_email text, p_evento text, p_titolo text, p_testo text,
                                              p_url text default './', p_tag text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_tok text; v_url text;
begin
  if v_email = '' then return; end if;
  -- niente raffiche: lo stesso avviso alla stessa persona negli ultimi due minuti basta una volta
  if exists (select 1 from push_coda where email = v_email and evento = p_evento
               and created_at > now() - interval '2 minutes') then return; end if;
  insert into push_coda (email, evento, titolo, testo, url, tag)
  values (v_email, p_evento, left(p_titolo, 80), left(p_testo, 200), coalesce(p_url, './'), coalesce(p_tag, p_evento));
  begin
    select valore into v_tok from push_impostazioni where chiave = 'campanello_token';
    select valore into v_url from push_impostazioni where chiave = 'funzione_url';
    if coalesce(v_tok, '') <> '' and coalesce(v_url, '') <> '' then
      perform net.http_post(url := v_url, body := jsonb_build_object('azione', 'invia'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'X-Campanello', v_tok));
    end if;
  exception when others then
    raise warning 'push_accoda: campanello non partito (%): la riga resta in coda per il giro', sqlerrm;
  end;
exception when others then
  raise warning 'push_accoda: %', sqlerrm;
end $$;
revoke execute on function public.push_accoda(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.push_accoda(text, text, text, text, text, text) to service_role;

-- La funzione prende in carico un lotto: una riga presa non la prende un'altra chiamata.
create or replace function public.push_prenota_coda(p_max integer default 50)
returns setof public.push_coda language plpgsql security definer set search_path = public as $$
begin
  -- quello che aspetta da più di tre giorni non serve più a nessuno
  update push_coda set stato = 'errore', esito = jsonb_build_object('motivo', 'scaduta: in coda da più di 3 giorni')
   where stato = 'in_attesa' and created_at < now() - interval '3 days';
  return query
    update push_coda c set prenotata_fino = now() + interval '2 minutes', tentativi = c.tentativi + 1
     where c.id in (select id from push_coda
                     where stato = 'in_attesa' and (prenotata_fino is null or prenotata_fino < now())
                     order by id limit greatest(1, least(coalesce(p_max, 50), 200)) for update skip locked)
    returning c.*;
end $$;
revoke execute on function public.push_prenota_coda(integer) from public, anon, authenticated;
grant execute on function public.push_prenota_coda(integer) to service_role;

-- ---------- gli eventi ----------
create or replace function public.push_da_incarichi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if coalesce(new.tecnico_email, '') <> ''
       and (tg_op = 'INSERT' or lower(coalesce(old.tecnico_email, '')) <> lower(new.tecnico_email))
       and new.chiuso_il is null and new.eseguito_il is null
       and (new.data_richiesta is null or new.data_richiesta >= current_date - 60)   -- non gli import dello storico
       and lower(new.tecnico_email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
      perform push_accoda(new.tecnico_email, 'incarico', 'Nuovo incarico',
        'Ti è stato assegnato un incarico: aprilo nel gestionale per vederlo.', './?vista=incarichi', 'incarico-' || new.id);
    end if;
  exception when others then raise warning 'push_da_incarichi: %', sqlerrm; end;
  return null;
end $$;

create or replace function public.push_da_avvisi()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  begin
    if coalesce(new.attivo, true) and not coalesce(new.archiviato, false) then
      for r in select lower(t.email) as email from tecnici t
                where coalesce(t.attivo, true) and coalesce(t.elimina, 0) = 0 and coalesce(t.email, '') <> ''
                  and (new.destinatari is null or cardinality(new.destinatari) = 0 or t.tecnico_id = any (new.destinatari))
                  and lower(t.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) loop
        perform push_accoda(r.email, 'avviso', 'Avviso del coordinatore',
          case when new.priorita in ('alta', 'urgente') then 'C''è un avviso urgente in bacheca.' else 'C''è un nuovo avviso in bacheca.' end,
          './?vista=dashboard', 'avviso-' || new.id);
      end loop;
    end if;
  exception when others then raise warning 'push_da_avvisi: %', sqlerrm; end;
  return null;
end $$;

-- cantieri critici: la risposta dell'ufficio e le decisioni arrivano al tecnico; il caso nuovo al coordinatore
create or replace function public.push_da_critici()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_io text := lower(coalesce(auth.jwt() ->> 'email', '')); v_coord text;
begin
  begin
    if tg_op = 'INSERT' then
      if new.storico_rif is null and new.stato = 'nuovo' then
        select lower(valore) into v_coord from s_config where chiave = 'coordinatore_email';
        if coalesce(v_coord, '') <> '' and v_coord <> v_io then
          perform push_accoda(v_coord, 'critico_nuovo', 'Cantieri critici',
            'C''è un nuovo caso da guardare nella Zona Coordinatore.', './?vista=admin', 'critico-' || new.id);
        end if;
      end if;
    elsif new.gestione_note is distinct from old.gestione_note and new.gestione_note is not null
          and new.storico_rif is null and new.stato <> 'annullato'
          and coalesce(new.segnalato_da, '') <> '' and lower(new.segnalato_da) <> v_io then
      perform push_accoda(new.segnalato_da, 'critico_risposta', 'Risposta dell''ufficio',
        'C''è una risposta a una tua segnalazione: la trovi in «Accesso negato al cantiere».', './?vista=dashboard', 'critico-' || new.id);
    end if;
  exception when others then raise warning 'push_da_critici: %', sqlerrm; end;
  return null;
end $$;

create or replace function public.push_da_critici_eventi()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_a text;
begin
  begin
    if new.visibile_tecnico and new.tipo in ('decisione', 'risposta_tecnico', 'visita_riprogrammata', 'conferenza_proposta', 'segnalazione_organi') then
      select lower(segnalato_da) into v_a from s_cantieri_critici where id = new.critico_id and storico_rif is null;
      if coalesce(v_a, '') <> '' and v_a <> lower(coalesce(new.autore, '')) then
        perform push_accoda(v_a, 'critico_risposta', 'Aggiornamento sulla tua segnalazione',
          'C''è una novità su una tua segnalazione: la trovi in «Accesso negato al cantiere».', './?vista=dashboard', 'critico-' || new.critico_id);
      end if;
    end if;
  exception when others then raise warning 'push_da_critici_eventi: %', sqlerrm; end;
  return null;
end $$;

-- fatture dei tecnici: «da approvare» al coordinatore, «pagata» al tecnico (accanto alla mail, non al suo posto)
create or replace function public.push_da_fatture()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_a text;
begin
  begin
    if coalesce(new.importato_da_access, false) then return null; end if;
    if new.stato = 'verificata' and old.stato is distinct from new.stato then
      select lower(valore) into v_a from s_config where chiave = 'coordinatore_email';
      if coalesce(v_a, '') <> '' and v_a <> lower(coalesce(auth.jwt() ->> 'email', '')) then
        perform push_accoda(v_a, 'fattura_da_approvare', 'Fatture dei tecnici',
          'C''è una fattura da approvare nella Zona Coordinatore.', './?vista=admin', 'fattura-' || new.id);
      end if;
    end if;
    if new.pagata_il is not null and old.pagata_il is null then
      select lower(t.email) into v_a from tecnici t where t.tecnico_id = new.tecnico_id;
      perform push_accoda(v_a, 'fattura_pagata', 'Pagamento effettuato',
        'Una tua fattura risulta pagata: i dettagli nella mail che ti è arrivata.', './?vista=dashboard', 'fattura-' || new.id);
    end if;
  exception when others then raise warning 'push_da_fatture: %', sqlerrm; end;
  return null;
end $$;

do $$ declare f text; begin
  foreach f in array array['push_da_incarichi()', 'push_da_avvisi()', 'push_da_critici()', 'push_da_critici_eventi()', 'push_da_fatture()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

drop trigger if exists trg_push_incarichi on public.incarichi;
create trigger trg_push_incarichi after insert or update of tecnico_email on public.incarichi
  for each row execute function public.push_da_incarichi();
drop trigger if exists trg_push_avvisi on public.avvisi;
create trigger trg_push_avvisi after insert on public.avvisi
  for each row execute function public.push_da_avvisi();
drop trigger if exists trg_push_critici on public.s_cantieri_critici;
create trigger trg_push_critici after insert or update of gestione_note on public.s_cantieri_critici
  for each row execute function public.push_da_critici();
drop trigger if exists trg_push_critici_eventi on public.s_cantieri_critici_eventi;
create trigger trg_push_critici_eventi after insert on public.s_cantieri_critici_eventi
  for each row execute function public.push_da_critici_eventi();
drop trigger if exists trg_push_fatture on public.s_fatture_tecnici;
create trigger trg_push_fatture after update of stato, pagata_il on public.s_fatture_tecnici
  for each row execute function public.push_da_fatture();

-- ---------- il giro di riserva ----------
-- Ogni 5 minuti, SOLO se c'è qualcosa che aspetta: suona il campanello. E se una
-- riga aspetta da più di 20 minuti il job FALLISCE, così il guasto resta scritto
-- in cron.job_run_details (un controllo che non può fallire non dice niente).
select cron.unschedule('push-visite-giro') where exists (select 1 from cron.job where jobname = 'push-visite-giro');
select cron.schedule('push-visite-giro', '*/5 * * * *', $cron$
do $body$
declare n int; vecchie int;
begin
  select count(*), count(*) filter (where created_at < now() - interval '20 minutes') into n, vecchie
    from public.push_coda where stato = 'in_attesa';
  if n = 0 then return; end if;
  perform pg_sleep(20);
  perform net.http_post(
    url := (select valore from public.push_impostazioni where chiave = 'funzione_url'),
    body := jsonb_build_object('azione', 'invia'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Campanello', (select valore from public.push_impostazioni where chiave = 'campanello_token')));
  if vecchie > 0 then
    raise exception 'push-visite: % notifiche in coda da più di 20 minuti', vecchie;
  end if;
end
$body$;
$cron$);
