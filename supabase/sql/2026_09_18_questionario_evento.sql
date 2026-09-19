/* ============================================================================
   QUESTIONARIO DI GRADIMENTO DI UN EVENTO — corsi, convegni, conferenze di
   cantiere                                                    (18/09/2026)

   Chiesto dall'utente dopo il questionario del sopralluogo: un motore solo per
   tutti i momenti formativi, con un TRONCO di domande sempre uguali più le
   domande scritte per quell'evento. Il tronco è ciò che permette di
   confrontare un convegno del 2026 con uno del 2029: se cambiano tutte le
   domande ogni volta, non resta nessuna serie storica.

   LE DECISIONI DELL'UTENTE, che questo file mette in pratica:

   1. ANONIMO. Il questionario non dice chi ha risposto, e il database non
      deve poterlo ricostruire. Per questo s_quest_risposte porta una DATA e
      non un istante: con dieci persone in aula, l'ora di arrivo più l'ordine
      delle firme sul registro basterebbe a risalire alla persona.

   2. SENZA QUESTIONARIO NON SI EMETTE L'ATTESTATO — ma essendo le risposte
      anonime il sistema non sa chi ha compilato: la spunta la mette la
      SEGRETERIA, sull'iscritto. Due strade, tutte e due volute:
      in blocco («Spunta tutti», il gesto normale di un convegno da 120
      persone) e riga per riga. Resta scritto chi l'ha messa e quando, perché
      è una dichiarazione di una persona, non una constatazione della
      macchina.

   3. IL CARTACEO ESISTE e non è un ripiego: in cantiere chi non ha il
      telefono compila il foglio che il docente gli consegna e riporta in
      segreteria. Quelle risposte si trascrivono qui con fonte 'carta'.
      ⚠️ Conseguenza da conoscere: le risposte raccolte e le spunte NON
      coincidono quasi mai, e non è un errore da inseguire.

   4. FINESTRA DI 48 ORE per tutti e TETTO legato ai presenti: il codice sta
      su un foglio che gira per l'aula e può essere fotografato. Ma una
      risposta oltre il tetto NON si butta: si salva con oltre_tetto = true e
      resta fuori dalle statistiche (regola del 04/09 su da che parte
      sbagliare — perdere un dato è peggio che tenerne uno dichiarato).

   Il link firmato è lo stesso disegno del questionario del sopralluogo
   (2026_09_18_questionario_visita.sql): il portale non conosce il segreto e
   non lo deve conoscere, riporta indietro il riferimento tal quale e a
   controllarlo è il Gestionale quando ritira la risposta dalla cassetta.
   ============================================================================ */

-- ── 1. i modelli ───────────────────────────────────────────────────────────
create table if not exists public.s_quest_modelli (
  codice       text primary key,
  nome         text not null,
  descrizione  text,
  attivo       boolean not null default true,
  creato_il    timestamptz not null default now()
);

comment on table public.s_quest_modelli is
  'I modelli di questionario di gradimento: conferenza di cantiere, corso, convegno o progetto. Un modello è solo un insieme di domande di partenza.';

insert into public.s_quest_modelli (codice, nome, descrizione) values
  ('conferenza', 'Conferenza di cantiere',
   'Due domande sole: si compila in cantiere, in piedi, spesso da chi l''italiano lo mastica appena.'),
  ('corso', 'Corso di formazione',
   'Il tronco comune delle tre domande, più le domande di quel corso.'),
  ('convegno', 'Convegno o progetto',
   'Il tronco comune, più le domande scritte per quell''occasione.')
on conflict (codice) do nothing;

-- ── 2. le domande ──────────────────────────────────────────────────────────
/* Una riga per domanda. O appartiene a un MODELLO (e allora vale per ogni
   evento che lo usa), o appartiene a un CORSO (le domande di quell'evento):
   mai tutte e due, mai nessuna delle due. Le domande del tronco portano
   tronco = true e non si cancellano. */
create table if not exists public.s_quest_domande (
  id            bigint generated always as identity primary key,
  modello       text references public.s_quest_modelli (codice) on delete cascade,
  corso_id      bigint references public.s_corsi (id) on delete cascade,
  ordine        integer not null default 1,
  testo         text not null,
  tipo          text not null default 'scelta',
  opzioni       jsonb not null default '[]'::jsonb,
  obbligatoria  boolean not null default false,
  tronco        boolean not null default false,
  creato_il     timestamptz not null default now(),
  constraint s_quest_dom_dove_ck check (num_nonnulls(modello, corso_id) = 1),
  constraint s_quest_dom_tipo_ck check (tipo in ('scala', 'scelta', 'multipla', 'testo')),
  constraint s_quest_dom_testo_ck check (btrim(testo) <> ''),
  /* una domanda a scelta senza opzioni non è una domanda */
  constraint s_quest_dom_opzioni_ck check (
    tipo not in ('scelta', 'multipla')
    or (jsonb_typeof(opzioni) = 'array' and jsonb_array_length(opzioni) between 2 and 8)),
  /* il tronco appartiene sempre a un modello, mai a un singolo evento */
  constraint s_quest_dom_tronco_ck check (not tronco or modello is not null)
);

create index if not exists s_quest_dom_modello_idx on public.s_quest_domande (modello, ordine);
create index if not exists s_quest_dom_corso_idx   on public.s_quest_domande (corso_id, ordine);

comment on column public.s_quest_domande.tronco is
  'Domanda del tronco comune: c''è in ogni evento di quel modello e non si toglie. È quella che rende confrontabili gli anni.';
comment on column public.s_quest_domande.opzioni is
  'Le risposte proposte, come elenco JSON di stringhe. Per «scala» e «testo» resta vuoto.';

/* il tronco: la prima domanda è la stessa dappertutto, le altre no.
   In cantiere si sta in due domande — è la regola dell''utente, non una
   semplificazione nostra. */
insert into public.s_quest_domande (modello, ordine, testo, tipo, opzioni, obbligatoria, tronco)
select * from (values
  ('conferenza', 1, 'Quanto vi è stata utile?', 'scala', '[]'::jsonb, true, true),
  ('conferenza', 2, 'Che cosa vi portate in cantiere?', 'multipla',
     '["un rischio che non avevamo visto","l''uso corretto di un DPI","una procedura da cambiare","niente di nuovo"]'::jsonb, false, true),
  ('corso', 1, 'Quanto vi è stato utile?', 'scala', '[]'::jsonb, true, true),
  ('corso', 2, 'Che cosa vi portate a casa?', 'multipla',
     '["un metodo da provare","chiarezza su una norma","contatti utili","poco"]'::jsonb, false, true),
  ('corso', 3, 'Di che cosa vorreste si parlasse la prossima volta?', 'testo', '[]'::jsonb, false, true),
  ('convegno', 1, 'Quanto vi è stato utile?', 'scala', '[]'::jsonb, true, true),
  ('convegno', 2, 'Che cosa vi portate a casa?', 'multipla',
     '["un metodo da provare","chiarezza su una norma","contatti utili","poco"]'::jsonb, false, true),
  ('convegno', 3, 'Di che cosa vorreste si parlasse la prossima volta?', 'testo', '[]'::jsonb, false, true)
) as v(modello, ordine, testo, tipo, opzioni, obbligatoria, tronco)
where not exists (select 1 from public.s_quest_domande d where d.tronco);

/* al massimo cinque domande per evento: oltre, nessuno arriva in fondo e le
   risposte si fermano a metà — il dato non nasce sbagliato, nasce vuoto. */
create or replace function public.s_quest_domande_limite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.corso_id is not null
     and (select count(*) from public.s_quest_domande where corso_id = new.corso_id) >= 5 then
    raise exception 'un evento può avere al massimo 5 domande proprie, oltre il tronco';
  end if;
  return new;
end $$;

revoke execute on function public.s_quest_domande_limite() from public, anon, authenticated;
grant  execute on function public.s_quest_domande_limite() to service_role;

drop trigger if exists trg_s_quest_domande_limite on public.s_quest_domande;
create trigger trg_s_quest_domande_limite
  before insert on public.s_quest_domande
  for each row execute function public.s_quest_domande_limite();

/* il tronco non si cancella e non cambia natura */
create or replace function public.s_quest_tronco_fermo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.tronco then raise exception 'le domande del tronco comune non si cancellano'; end if;
    return old;
  end if;
  if old.tronco and (new.tronco is distinct from old.tronco or new.tipo is distinct from old.tipo) then
    raise exception 'del tronco comune si può correggere il testo, non il tipo';
  end if;
  return new;
end $$;

revoke execute on function public.s_quest_tronco_fermo() from public, anon, authenticated;
grant  execute on function public.s_quest_tronco_fermo() to service_role;

drop trigger if exists trg_s_quest_tronco_fermo on public.s_quest_domande;
create trigger trg_s_quest_tronco_fermo
  before update or delete on public.s_quest_domande
  for each row execute function public.s_quest_tronco_fermo();

-- ── 3. le risposte ─────────────────────────────────────────────────────────
create table if not exists public.s_quest_risposte (
  id             bigint generated always as identity primary key,
  corso_id       bigint not null references public.s_corsi (id) on delete cascade,
  ricevuto_il    date not null default (now() at time zone 'Europe/Rome')::date,
  fonte          text not null default 'online',
  risposte       jsonb not null default '{}'::jsonb,
  utilita        smallint,
  oltre_tetto    boolean not null default false,
  submission_id  text unique,
  inserita_da    text,
  constraint s_quest_risp_fonte_ck check (fonte in ('online', 'carta')),
  constraint s_quest_risp_utilita_ck check (utilita is null or utilita between 1 and 5),
  /* trascrivere un cartaceo è un gesto di qualcuno: deve dire chi */
  constraint s_quest_risp_carta_ck check (fonte <> 'carta' or inserita_da is not null)
);

create index if not exists s_quest_risp_corso_idx on public.s_quest_risposte (corso_id);

comment on table public.s_quest_risposte is
  'Le risposte al questionario di gradimento di un evento. ANONIME: nessuna colonna, nemmeno indiretta, dice chi ha risposto.';
comment on column public.s_quest_risposte.ricevuto_il is
  'Data, non istante: l''ora esatta, incrociata con l''ordine delle firme sul registro, rimetterebbe il nome sopra la risposta.';
comment on column public.s_quest_risposte.risposte is
  'Le risposte per id di domanda: { "<id domanda>": "testo" | ["a","b"] | 4 }.';
comment on column public.s_quest_risposte.oltre_tetto is
  'Arrivata a finestra chiusa o oltre il tetto dei presenti: si conserva ma resta fuori dalle statistiche.';

-- ── 4. l'evento: dove si apre il questionario ──────────────────────────────
alter table public.s_corsi
  add column if not exists quest_modello        text references public.s_quest_modelli (codice),
  add column if not exists quest_codice         text unique,
  add column if not exists quest_aperto_il      timestamptz,
  add column if not exists quest_chiuso_il      timestamptz,
  add column if not exists quest_tetto          integer,
  add column if not exists quest_pubblicato_il  timestamptz,
  add column if not exists quest_pubblica_esito text;

comment on column public.s_corsi.quest_codice is
  'Il codice corto stampato sotto il QR, per chi non inquadra: <id corso>-XXXX, senza lettere e cifre che si confondono.';
comment on column public.s_corsi.quest_chiuso_il is
  'Quando il codice smette di rispondere: 48 ore dopo la fine dell''evento (decisione dell''utente, uguale per tutti).';
comment on column public.s_corsi.quest_tetto is
  'Quante risposte si accettano: i presenti più cinque. Oltre, la risposta si salva ma è oltre_tetto.';

-- ── 5. la spunta sull'iscritto ─────────────────────────────────────────────
alter table public.s_corsi_iscritti
  add column if not exists quest_compilato    boolean not null default false,
  add column if not exists quest_compilato_il date,
  add column if not exists quest_compilato_da text,
  add column if not exists quest_fonte        text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_corsi_iscr_quest_fonte_ck') then
    alter table public.s_corsi_iscritti
      add constraint s_corsi_iscr_quest_fonte_ck
      check (quest_fonte is null or quest_fonte in ('blocco', 'singolo', 'carta'));
  end if;
end $$;

comment on column public.s_corsi_iscritti.quest_compilato is
  'Dichiarazione della segreteria che questa persona ha compilato il questionario. Le risposte sono anonime: il sistema non lo sa e non lo può sapere.';
comment on column public.s_corsi_iscritti.quest_fonte is
  'Come è stata messa la spunta: blocco = «Spunta tutti», singolo = riga per riga, carta = il foglio è stato consegnato.';

-- ── 6. il codice e la firma ────────────────────────────────────────────────
/* ⚠️ Su Supabase «revoke ... from public, anon» NON toglie il grant che le
   default privileges danno ad AUTHENTICATED: va revocato anche quello, o
   qualunque utente dell'app può farsi firmare un codice e fabbricare link
   validi per eventi altrui. Trovato il 18/09/2026 col controllo dei grant, e
   lo stesso difetto c'era su questionario_firma del questionario visita
   (corretto con la migrazione quest_firme_solo_servizio_2026_09_18).
   Le funzioni che le usano sono security definer e girano come proprietario:
   continuano a funzionare senza grant al chiamante. */
/* alfabeto senza 0/O/1/I/L: il codice si legge ad alta voce in aula */
create or replace function public.quest_codice_nuovo(p_corso_id bigint)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_c text; i int; v_tent int := 0;
begin
  loop
    v_c := '';
    for i in 1..4 loop
      v_c := v_c || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    v_c := p_corso_id::text || '-' || v_c;
    exit when not exists (select 1 from public.s_corsi where quest_codice = v_c);
    v_tent := v_tent + 1;
    if v_tent > 50 then raise exception 'non riesco a trovare un codice libero per il corso %', p_corso_id; end if;
  end loop;
  return v_c;
end $$;

revoke execute on function public.quest_codice_nuovo(bigint) from public, anon, authenticated;
grant execute on function public.quest_codice_nuovo(bigint) to service_role;

create or replace function public.quest_firma(p_codice text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_segreto text;
begin
  if p_codice is null or btrim(p_codice) = '' then return null; end if;
  select valore into v_segreto from public.s_config where chiave = 'questionario_segreto';
  if v_segreto is null or v_segreto = '' then
    raise exception 'questionario_segreto mancante in s_config: il link non si può firmare';
  end if;
  return left(encode(extensions.hmac('evento:' || p_codice, v_segreto, 'sha256'), 'hex'), 12);
end $$;

/* «evento:» davanti al codice tiene le due firme separate: una firma buona per
   un questionario di evento non deve valere per una visita, e viceversa. */
revoke execute on function public.quest_firma(text) from public, anon, authenticated;
grant execute on function public.quest_firma(text) to service_role;

-- ── 7. aprire il questionario di un evento ─────────────────────────────────
create or replace function public.quest_apri(
  p_corso_id bigint,
  p_modello  text default null,
  p_ore      integer default 48,
  p_tetto    integer default null)
returns table (codice text, link text, chiuso_il timestamptz, tetto integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r record; v_codice text; v_fine timestamptz; v_tetto integer; v_base text;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;

  select c.id, c.titolo, c.tipo, c.data_inizio, c.data_fine, c.quest_codice, c.quest_modello
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found then raise exception 'corso % non trovato', p_corso_id; end if;

  v_codice := coalesce(r.quest_codice, public.quest_codice_nuovo(p_corso_id));

  /* La finestra parte dalla FINE dell'evento, non da adesso: il questionario
     si apre quando il corso è già in calendario, ma deve scadere dopo.
     L'ora vera di fine sta sull'ultima giornata (anche il secondo turno, se
     c'è); senza giornate si ripiega sulla data del corso a fine giornata, e
     con niente del tutto su oggi — dichiarato, non indovinato. */
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
         quest_chiuso_il = v_fine,
         quest_tetto     = v_tetto,
         questionario_previsto = true
   where c.id = p_corso_id;

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');

  return query select v_codice,
    v_base || '?evento=' || public.url_encode_semplice(v_codice || '.' || public.quest_firma(v_codice)),
    v_fine, v_tetto;
end $$;

revoke execute on function public.quest_apri(bigint, text, integer, integer) from public, anon;
grant execute on function public.quest_apri(bigint, text, integer, integer) to authenticated, service_role;

-- ── 8. che cosa va pubblicato sul portale ──────────────────────────────────
/* Il portale NON parla con questo database (regola del 13/09: chi sta su
   internet non deve avere le chiavi). Le domande gli arrivano perché il
   Gestionale gliele PUBBLICA sul progetto Servizi, come già fa con gli
   attestati. Qui si prepara che cosa mandare: solo testo di domande, mai
   un nominativo. */
create or replace function public.quest_pubblicazione(p_corso_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare r record; v_dom jsonb; v_ruolo text;
begin
  /* la segreteria dall'app, oppure il SERVIZIO quando la edge function
     pubblica da sola. ⚠️ Dentro una security definer `current_user` è il
     proprietario, non il chiamante: il ruolo si legge dai claim che PostgREST
     imposta dal JWT verificato (trovato provando, 18/09 — vedi
     2026_09_18_questionario_ponte_portale.sql). */
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or v_ruolo = 'service_role') then
    raise exception 'non autorizzato';
  end if;

  select c.id, c.titolo, c.tipo, c.sede, c.data_inizio, c.data_fine,
         c.quest_codice, c.quest_modello, c.quest_chiuso_il
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
    /* l'istante intero, col suo fuso: senza offset chi lo rilegge lo prende
       per UTC e la chiusura scivola avanti di due ore (trovato provando). */
    'chiuso_il',   to_jsonb(r.quest_chiuso_il),
    'domande',     v_dom);
end $$;

revoke execute on function public.quest_pubblicazione(bigint) from public, anon;
grant execute on function public.quest_pubblicazione(bigint) to authenticated, service_role;

-- ── 9. la verifica, quando la risposta torna dalla cassetta ────────────────
create or replace function public.quest_verifica(p_riferimento text)
returns table (corso_id bigint, titolo text, aperto boolean, oltre_tetto boolean, esito text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_cod text; v_firma text; p int; r record; v_quante int;
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

  select c.id, c.titolo, c.quest_chiuso_il, c.quest_tetto
    into r from public.s_corsi c where c.quest_codice = v_cod;
  if not found then
    return query select null::bigint, null::text, false, false, 'evento non trovato'::text; return;
  end if;

  select count(*)::int into v_quante
    from public.s_quest_risposte q where q.corso_id = r.id and not q.oltre_tetto;

  /* Aperto o no, la risposta si salva: qui si dice soltanto se conta.
     Buttarla sarebbe il modo peggiore di sbagliare (regola del 04/09). */
  return query select r.id, r.titolo,
    (r.quest_chiuso_il is null or r.quest_chiuso_il > now()),
    (r.quest_chiuso_il is not null and r.quest_chiuso_il <= now())
      or (r.quest_tetto is not null and v_quante >= r.quest_tetto),
    'agganciato'::text;
end $$;

revoke execute on function public.quest_verifica(text) from public, anon, authenticated;
grant execute on function public.quest_verifica(text) to service_role;

-- ── 10. la spunta: in blocco o riga per riga ───────────────────────────────
create or replace function public.quest_spunta(
  p_corso_id  bigint,
  p_iscritti  bigint[] default null,   -- null = tutti gli ammessi
  p_valore    boolean default true,
  p_fonte     text default null)       -- null = 'blocco' se tutti, 'singolo' altrimenti
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_fonte text; v_chi text; v_n integer;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  v_fonte := coalesce(p_fonte, case when p_iscritti is null then 'blocco' else 'singolo' end);
  if v_fonte not in ('blocco', 'singolo', 'carta') then
    raise exception 'fonte non prevista: %', v_fonte;
  end if;
  v_chi := coalesce(auth.jwt() ->> 'email', 'segreteria');

  update public.s_corsi_iscritti i
     set quest_compilato    = p_valore,
         quest_compilato_il = case when p_valore then (now() at time zone 'Europe/Rome')::date end,
         quest_compilato_da = case when p_valore then v_chi end,
         quest_fonte        = case when p_valore then v_fonte end
   where i.corso_id = p_corso_id
     and (p_iscritti is null or i.id = any (p_iscritti))
     and (p_iscritti is not null or coalesce(i.esito, '') not in ('annullato', 'sostituito'));

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.quest_spunta(bigint, bigint[], boolean, text) from public, anon;
grant execute on function public.quest_spunta(bigint, bigint[], boolean, text) to authenticated, service_role;

-- ── 11. come sta andando (solo aggregati) ──────────────────────────────────
create or replace function public.quest_riepilogo(p_corso_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case when (select public.is_segreteria()) then jsonb_build_object(
    'iscritti',   (select count(*) from public.s_corsi_iscritti i
                    where i.corso_id = p_corso_id and coalesce(i.esito,'') not in ('annullato','sostituito')),
    'spuntati',   (select count(*) from public.s_corsi_iscritti i
                    where i.corso_id = p_corso_id and i.quest_compilato),
    'raccolte',   (select count(*) from public.s_quest_risposte q
                    where q.corso_id = p_corso_id and not q.oltre_tetto),
    'su_carta',   (select count(*) from public.s_quest_risposte q
                    where q.corso_id = p_corso_id and q.fonte = 'carta'),
    'fuori',      (select count(*) from public.s_quest_risposte q
                    where q.corso_id = p_corso_id and q.oltre_tetto),
    'utilita',    (select round(avg(q.utilita)::numeric, 1) from public.s_quest_risposte q
                    where q.corso_id = p_corso_id and not q.oltre_tetto and q.utilita is not null),
    'voti_bassi', (select count(*) from public.s_quest_risposte q
                    where q.corso_id = p_corso_id and not q.oltre_tetto and q.utilita <= 2)
  ) else null end;
$$;

revoke execute on function public.quest_riepilogo(bigint) from public, anon;
grant execute on function public.quest_riepilogo(bigint) to authenticated, service_role;

-- ── 12. chi legge e chi scrive ─────────────────────────────────────────────
alter table public.s_quest_modelli  enable row level security;
alter table public.s_quest_domande  enable row level security;
alter table public.s_quest_risposte enable row level security;

drop policy if exists sgr_quest_modelli_all on public.s_quest_modelli;
create policy sgr_quest_modelli_all on public.s_quest_modelli
  for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));

drop policy if exists sgr_quest_domande_all on public.s_quest_domande;
create policy sgr_quest_domande_all on public.s_quest_domande
  for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));

drop policy if exists sgr_quest_risposte_all on public.s_quest_risposte;
create policy sgr_quest_risposte_all on public.s_quest_risposte
  for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
