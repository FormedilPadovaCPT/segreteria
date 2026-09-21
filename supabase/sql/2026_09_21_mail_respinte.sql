-- ═══════════════════════════════════════════════════════════════════════
--  LE MAIL DEL VERBALE CHE TORNANO INDIETRO (21/09/2026)
--
--  Chiesto dall'utente: «le nuove visite dei tecnici che partiranno col
--  nuovo gestionale partiranno da cptpd@did.formedilpadova.it e se
--  qualche mail fosse sbagliata il ritorno lo vedo solo io; servirebbe
--  una funzione che una volta al giorno controllasse se c'è qualche mail
--  di avviso che non è stato possibile inviare […] e che avvisasse il
--  tecnico, perché possibile che la mail fosse errata».
--
--  ⚠️ IL PROBLEMA VERO È CHE IL RIMBALZO OGGI NON LO VEDE NESSUNO.
--  Il verbale parte da `cptpd@did.formedilpadova.it` (send-verbale), e
--  il messaggio di mancata consegna torna in quella casella. Il
--  cruscotto «Posta e agenda» (08/09) non lo mostra: nelle regole di
--  `bacheca-giornata` `mailer-daemon` sta fra i mittenti da **ignorare**.
--  Quindi un indirizzo sbagliato in anagrafica resta sbagliato per
--  sempre, e l'impresa non riceve il verbale senza che nessuno lo sappia.
--  È esattamente la regola del 04/09: **un canale che non si sorveglia è
--  un canale di cui non si sa niente** — qui applicata al ritorno.
--
--  Come funziona: una volta al giorno la edge function `mail-respinte`
--  legge nella casella i messaggi del mailer-daemon, ne ricava
--  l'indirizzo che ha fallito, il codice di errore e il numero di
--  verbale citato nell'oggetto originale, aggancia la visita e il
--  tecnico che l'ha fatta, e scrive una riga qui. Se il rifiuto è
--  **permanente** (5.x.x) manda al tecnico un avviso: l'indirizzo
--  potrebbe essere sbagliato, lo guardi.
--
--  ⚠️ L'INDIRIZZO NON SI CORREGGE DA SOLO. Un rimbalzo dice che quella
--  casella non ha accettato il messaggio, non quale sia l'indirizzo
--  giusto: a correggerlo è il tecnico, che sa chi ha incontrato in
--  cantiere (regola d'oro 1). L'app segnala, la persona decide.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.s_mail_respinte (
  id                bigint generated always as identity primary key,
  gmail_id          text not null,            -- vedi l'indice unico in fondo: la chiave e' (gmail_id, destinatario)
  ricevuta_il       timestamptz,
  destinatario      text,                     -- l'indirizzo che ha rifiutato
  codice            text,                     -- lo stato SMTP: 5.1.1, 4.4.7…
  permanente        boolean,                  -- 5.x.x = non esiste / rifiutata per sempre
  motivo            text,                     -- il Diagnostic-Code, come l'ha scritto il server
  oggetto_originale text,
  nr_verbale        text,
  visita_id         text,
  tecnico_id        text,
  tecnico_email     text,
  ruolo             text,                     -- in quale campo del verbale stava quell'indirizzo
  impresa_nome      text,
  stato             text not null default 'nuova'
                    check (stato in ('nuova', 'avvisato', 'risolta', 'ignorata')),
  avviso_il         timestamptz,
  avviso_a          text,
  avviso_esito      text,
  risolta_il        timestamptz,
  risolta_da        text,
  risolta_note      text,
  created_at        timestamptz not null default now()
);

comment on table public.s_mail_respinte is
  'I messaggi di mancata consegna tornati nella casella dell''ente dopo l''invio di un verbale. Una riga per rimbalzo, agganciata al verbale e al tecnico che l''ha fatto. L''indirizzo non si corregge da solo: lo guarda il tecnico.';
comment on column public.s_mail_respinte.permanente is
  'true = rifiuto definitivo (5.x.x): l''indirizzo quasi certamente è sbagliato, e il tecnico va avvisato. false = ritardo (4.x.x): si registra e basta, può consegnarsi da sé.';
comment on column public.s_mail_respinte.ruolo is
  'Dove stava quell''indirizzo nel verbale: committente, responsabile dei lavori, CSP, CSE, impresa. Vuoto = non ritrovato, e allora lo cerca una persona.';
comment on column public.s_mail_respinte.stato is
  'nuova = da guardare · avvisato = il tecnico lo sa · risolta = l''indirizzo è stato sistemato · ignorata = non era un nostro problema.';

/* ⚠️ UN SOLO RAPPORTO PUÒ ELENCARE PIÙ INDIRIZZI FALLITI: il verbale parte
   a committente, RL, CSP, CSE e imprese in una mail sola, e il rapporto di
   mancata consegna li raggruppa. La chiave è quindi (rapporto, indirizzo):
   con il solo `gmail_id` il secondo indirizzo sarebbe andato perso in
   silenzio, che è il modo peggiore di sbagliare per un registro nato
   apposta per non perdere i ritorni.
   Colonne nude e non un'espressione: PostgREST risolve `on_conflict`
   cercando un vincolo su quelle colonne, e `coalesce(destinatario,'')` non
   gli corrisponderebbe. Il destinatario è sempre valorizzato. */
create unique index if not exists s_mail_respinte_uniq
  on public.s_mail_respinte (gmail_id, destinatario);

create index if not exists s_mail_respinte_aperte_idx on public.s_mail_respinte (stato, ricevuta_il desc);
create index if not exists s_mail_respinte_tecnico_idx on public.s_mail_respinte (tecnico_email);

alter table public.s_mail_respinte enable row level security;

/* ⚠️ Su Supabase una tabella nuova nasce leggibile da `anon`, e la chiave
   anon sta in un repository pubblico: la RLS la terrebbe a zero righe, ma
   il permesso va tolto lo stesso — è il controllo che fa il test
   `03_rls_personale.sql`, ed è la stessa ragione per cui si revoca `anon`
   dalle funzioni (regola del 07/09). */
revoke all on public.s_mail_respinte from anon;
grant select, update on public.s_mail_respinte to authenticated;
grant all on public.s_mail_respinte to service_role;

/* chi legge: la segreteria e il coordinatore tutto; il tecnico le sue —
   il suo indirizzo sbagliato è roba sua, quello di un collega no */
drop policy if exists s_mail_respinte_sel on public.s_mail_respinte;
create policy s_mail_respinte_sel on public.s_mail_respinte for select to authenticated
  using (
    public.is_segreteria() or public.is_coordinatore()
    or lower(coalesce(tecnico_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

/* scrive solo la funzione che legge la casella (service role) e la
   segreteria quando chiude una riga; il tecnico chiude le sue */
drop policy if exists s_mail_respinte_upd on public.s_mail_respinte;
create policy s_mail_respinte_upd on public.s_mail_respinte for update to authenticated
  using (
    public.is_segreteria()
    or lower(coalesce(tecnico_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    public.is_segreteria()
    or lower(coalesce(tecnico_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

/* ⚠️ un rimbalzo NON si cancella: è la prova che quel verbale non è
   arrivato. Si chiude dicendo com'è andata (stessa regola dei cantieri
   critici). Nessuna policy di delete, quindi nessuno lo elimina. */

-- ── chiudere una riga ─────────────────────────────────────────────────
create or replace function public.s_mail_respinta_chiudi(
  p_id bigint, p_stato text, p_note text default null)
returns public.s_mail_respinte
language plpgsql security definer set search_path = public as $$
declare v_r public.s_mail_respinte; v_chi text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if p_stato not in ('risolta', 'ignorata') then
    raise exception 'Una riga si chiude come «risolta» o «ignorata»';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Scrivi che cosa hai fatto: l''indirizzo corretto, o perché non serviva';
  end if;
  select * into v_r from public.s_mail_respinte where id = p_id for update;
  if v_r.id is null then raise exception 'Rimbalzo % non trovato', p_id; end if;
  if not (public.is_segreteria() or lower(coalesce(v_r.tecnico_email, '')) = v_chi) then
    raise exception 'Non autorizzato';
  end if;
  update public.s_mail_respinte
     set stato = p_stato, risolta_il = now(), risolta_da = v_chi, risolta_note = left(btrim(p_note), 500)
   where id = p_id
  returning * into v_r;
  return v_r;
end $$;

comment on function public.s_mail_respinta_chiudi(bigint, text, text) is
  'Chiude un rimbalzo: «risolta» (indirizzo sistemato) o «ignorata», sempre con una nota. La possono chiudere la segreteria e il tecnico a cui è intestata.';

revoke execute on function public.s_mail_respinta_chiudi(bigint, text, text) from public, anon;
grant execute on function public.s_mail_respinta_chiudi(bigint, text, text) to authenticated, service_role;

-- ── la notifica al telefono, accanto alla mail ────────────────────────
create or replace function public.push_da_mail_respinte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.stato = 'avvisato' and old.stato is distinct from new.stato
       and coalesce(new.permanente, false) then
      perform push_accoda(new.tecnico_email, 'mail_respinta', 'Una mail del verbale è tornata indietro',
        'Un indirizzo del verbale non ha accettato la mail: controllalo nel gestionale.',
        './?vista=dashboard', 'respinta-' || new.id);
    end if;
  exception when others then raise warning 'push_da_mail_respinte: %', sqlerrm; end;
  return null;
end $$;

revoke execute on function public.push_da_mail_respinte() from public, anon, authenticated;
grant execute on function public.push_da_mail_respinte() to service_role;

drop trigger if exists trg_push_mail_respinte on public.s_mail_respinte;
create trigger trg_push_mail_respinte after update of stato on public.s_mail_respinte
  for each row execute function public.push_da_mail_respinte();

-- ── il flusso entra nel riquadro «flussi mai usati» ───────────────────
do $$
declare def text; punto text;
begin
  select pg_get_functiondef('public.s_flussi_uso()'::regprocedure) into def;
  punto := 'union all select ''Tecnici'', ''stage_senza_verbale''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo il punto di innesto';
  end if;
  def := replace(def, punto,
    'union all select ''Tecnici'', ''mail_respinta'', ''Mail del verbale tornata indietro'', ricevuta_il::date'
    || E'\n      from public.s_mail_respinte' || E'\n    ' || punto);
  punto := '(''Tecnici'', ''stage_senza_verbale''';
  def := replace(def, punto,
    '(''Tecnici'', ''mail_respinta'', ''Mail del verbale tornata indietro''),' || E'\n    ' || punto);
  execute def;
end $$;

/* la parola d'ordine del giro quotidiano: la funzione non si fa chiamare
   dalla chiave anon, che sta in un repository pubblico */
insert into public.s_config (chiave, valore, descrizione) values
  ('mail_respinte_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine del giro quotidiano che cerca i rimbalzi nella casella dell''ente (edge function mail-respinte).'),
  ('mail_respinte_cc', '',
   'Copie dell''avviso al tecnico quando una mail del verbale torna indietro (vuoto = nessuna copia).')
on conflict (chiave) do nothing;

-- ── il giro quotidiano ────────────────────────────────────────────────
-- Alle 05:45 UTC (07:45 a Roma): la riga c'è già quando la segreteria apre
-- il cruscotto, e prima del giro di bacheca-giornata delle 6.
-- ⚠️ `pg_sleep(20)`: nei primi secondi del minuto in cui parte un job
-- pg_cron, PostgREST risponde 504 alle funzioni (13/09/2026). E l'esito si
-- controlla con RAISE EXCEPTION, non con un warning: un job che non può
-- fallire non dice niente quando riesce.
select cron.unschedule('mail-respinte-giro') where exists (select 1 from cron.job where jobname = 'mail-respinte-giro');
select cron.schedule('mail-respinte-giro', '45 5 * * *', $job$
do $body$
declare r record; tok text;
begin
  select valore into tok from public.s_config where chiave = 'mail_respinte_token';
  if coalesce(tok, '') = '' then
    raise exception 'mail-respinte-giro: manca s_config.mail_respinte_token';
  end if;
  commit;
  perform pg_sleep(20);
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '180000');
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/mail-respinte',
    array[http_header('X-Mail-Respinte', tok),
          http_header('Authorization', 'Bearer <chiave anon del progetto>')],
    'application/json', '{}')::http_request);
  if r.status <> 200 then
    raise exception 'mail-respinte-giro: HTTP % %', r.status, left(r.content, 300);
  end if;
end
$body$;
$job$);
