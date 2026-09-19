/* ============================================================================
   IL TEST LO SCRIVE IL DOCENTE                                 (19/09/2026)

   Chiesto dall'utente: «nella scheda corso, se c'è un test finale bisogna che
   il docente del corso, anche tramite la segreteria, possa caricare il test di
   quello specifico corso o lezione o evento».

   IL BUCO CHE COLMA: fino a oggi le domande di `s_test_domande` le poteva
   scrivere SOLO la segreteria (policy `sgr_test_domande_all`; il coordinatore
   legge e basta). Ma il docente di un corso quasi mai è la segreteria: se è un
   tecnico entra nel gestionale visite e nell'app segreteria NON entra (regola
   del 17/09), e se è un docente ESTERNO non ha proprio un accesso. Risultato:
   il test lo doveva trascrivere l'ufficio da un Word, cioè esattamente il
   lavoro che il test dentro l'app doveva togliere.

   LA STRADA SCELTA DALL'UTENTE (19/09): un LINK TARGATO al docente, come il
   modulo delle iscrizioni che si manda al referente di una conferenza. Nessun
   account da creare: vale anche per gli esterni. E la segreteria CONFERMA
   SEMPRE prima che il test vada online — «una richiesta non è un iscritto»
   applicata al test: quello che finisce sul QR dei corsisti lo rilegge
   qualcuno.

   ⚠️ PERCHÉ NON C'È UN PONTE VERSO IL PORTALE. Questionario, test e iscrizioni
   pubblicano sul progetto Servizi le domande da disegnare. Qui non serve: la
   pagina del docente non deve LEGGERE niente di nostro — deve solo raccogliere
   quello che lui scrive. Titolo del corso e nome del docente viaggiano nel
   link come semplice intestazione, ed è la stessa scelta del questionario
   della visita (18/09): chi li cambiasse mentirebbe soltanto a sé stesso,
   perché a decidere di quale corso si tratta è il CODICE FIRMATO, non il
   testo che si legge in pagina.

   ⚠️ LA PAGINA DEL DOCENTE NON MOSTRA MAI LE DOMANDE GIÀ ATTIVE. Il link è
   «chi ce l'ha entra»: se mostrasse il test con le risposte segnate, un
   corsista che se lo facesse girare avrebbe le soluzioni. Il docente vede solo
   quello che sta scrivendo lui, e a consegna fatta la pagina ringrazia e non
   rimostra niente.

   ⚠️ UNA PROPOSTA ARRIVATA CON L'INVITO SCADUTO O REVOCATO NON SI BUTTA: si
   salva con scritto perché (`riferimento_esito`), come le risposte del
   questionario con la firma che non torna. Perdere il lavoro di un docente che
   ha compilato in buona fede sarebbe il modo peggiore di sbagliare (regola del
   04/09 su da che parte sbagliare).

   Migrazioni applicate, in quest'ordine:
     test_dal_docente_tabelle_2026_09_19     s_test_inviti, s_test_proposte, RLS
     test_dal_docente_funzioni_2026_09_19    firma, invito, verifica, accetta
     test_proposte_timestamp_modulo_2026_09_19   la colonna che il ritiro pretende
   ============================================================================ */

/* ── 1. le due tabelle ─────────────────────────────────────────────────────
   L'INVITO è la chiave che si manda al docente; la PROPOSTA è quello che
   torna indietro. Due tabelle e non una sola perché il docente può mandare
   più versioni (una corretta dopo un refuso), e ogni invio deve restare —
   il fatto si aggiunge, non si sovrascrive. */

create table if not exists public.s_test_inviti (
  id            bigserial primary key,
  corso_id      bigint not null references public.s_corsi(id) on delete cascade,
  persona_id    uuid references public.persone(persona_id),   /* ⚠️ la chiave di «persone» è persona_id, non id */
  nominativo    text not null,
  email         text,
  codice        text not null unique,
  stato         text not null default 'in_attesa'
                check (stato in ('in_attesa', 'consegnato', 'accettato', 'scartato', 'revocato')),
  scadenza      date not null default (current_date + 30),
  creato_da     text,
  creato_il     timestamptz not null default now(),
  consegnato_il timestamptz,
  chiuso_da     text,
  chiuso_il     timestamptz,
  motivo        text
);
comment on table public.s_test_inviti is
  'Invito a un docente a scrivere il test finale di un corso: il codice firmato che sta nel link. Non dà accesso a nient''altro e scade.';

create table if not exists public.s_test_proposte (
  id            bigserial primary key,
  invito_id     bigint references public.s_test_inviti(id) on delete set null,
  corso_id      bigint references public.s_corsi(id) on delete cascade,
  nominativo    text,
  domande       jsonb not null default '[]'::jsonb,
  note          text,
  stato         text not null default 'nuova'
                check (stato in ('nuova', 'accettata', 'scartata')),
  arrivata_il   timestamptz not null default now(),
  fonte         text not null default 'modulo',
  submission_id text,
  progressivo   integer,
  /* ⚠️ il ritiro scrive timestamp_modulo su ogni riga non anonima: senza la
     colonna la richiesta resta in cassetta (trovato alla prima prova vera,
     migrazione test_proposte_timestamp_modulo_2026_09_19) */
  timestamp_modulo timestamptz,
  portale_esito jsonb,
  riferimento_esito text,
  esaminata_da  text,
  esaminata_il  timestamptz,
  motivo        text,
  domande_portate integer
);
comment on table public.s_test_proposte is
  'Il test come lo ha scritto il docente. NON è il test: diventa tale solo quando la segreteria lo porta in s_test_domande (dtest_accetta).';
comment on column public.s_test_proposte.riferimento_esito is
  'Perché la proposta non si è agganciata a un invito (firma non valida, invito revocato, scaduto): si salva lo stesso, non si butta.';

create index if not exists s_test_inviti_corso_idx on public.s_test_inviti (corso_id);
create index if not exists s_test_proposte_corso_idx on public.s_test_proposte (corso_id, stato);
create unique index if not exists s_test_proposte_submission_idx
  on public.s_test_proposte (submission_id) where submission_id is not null;

alter table public.s_test_inviti enable row level security;
alter table public.s_test_proposte enable row level security;

/* la segreteria lavora, il coordinatore guarda: è lui che spesso valuta i
   test, e deve poter vedere che cosa ha proposto il docente */
create policy sgr_test_inviti_all on public.s_test_inviti
  for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy coord_test_inviti_sel on public.s_test_inviti
  for select to authenticated using ((select public.is_coordinatore()));
create policy sgr_test_proposte_all on public.s_test_proposte
  for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
create policy coord_test_proposte_sel on public.s_test_proposte
  for select to authenticated using ((select public.is_coordinatore()));

/* ── 2. la firma del link ──────────────────────────────────────────────────
   Stesso segreto delle altre firme, PREFISSO PROPRIO: un link d'invito non
   deve aprire il questionario o il test dello stesso corso (regola del
   18/09 sui prefissi distinti).
   ⚠️ Una funzione che FIRMA è un segreto in forma di codice: si revoca anche
   ad authenticated, o chi entra nell'app si fabbrica gli inviti. */
create or replace function public.dtest_firma(p_codice text)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_segreto text;
begin
  if p_codice is null or btrim(p_codice) = '' then return null; end if;
  select valore into v_segreto from public.s_config where chiave = 'questionario_segreto';
  if v_segreto is null or v_segreto = '' then
    raise exception 'questionario_segreto mancante in s_config: il link non si può firmare';
  end if;
  return left(encode(extensions.hmac('dtest:' || p_codice, v_segreto, 'sha256'), 'hex'), 12);
end $$;
revoke execute on function public.dtest_firma(text) from public, anon, authenticated;
grant execute on function public.dtest_firma(text) to service_role;

/* ── 3. il codice dell'invito ──────────────────────────────────────────────
   Come quello delle iscrizioni: alfabeto senza 0/O/1/I, prefisso col numero
   del corso perché a colpo d'occhio si sappia di che corso si parla.
   ⚠️ Generato PER RIGA con ritentativo sulla collisione: «improbabile» non è
   «impossibile» (lezione dei codici personali tutti uguali, 18/09). */
create or replace function public.dtest_codice_nuovo(p_corso_id bigint)
returns text language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; v_c text; i int; v_tent int := 0;
begin
  loop
    v_c := '';
    for i in 1..5 loop
      v_c := v_c || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::int, 1);
    end loop;
    v_c := 'D' || p_corso_id::text || '-' || v_c;
    exit when not exists (select 1 from public.s_test_inviti where codice = v_c);
    v_tent := v_tent + 1;
    if v_tent > 50 then raise exception 'non riesco a trovare un codice libero per il corso %', p_corso_id; end if;
  end loop;
  return v_c;
end $$;
revoke execute on function public.dtest_codice_nuovo(bigint) from public, anon;
grant execute on function public.dtest_codice_nuovo(bigint) to service_role;

/* ── 4. che cosa è una domanda ben scritta ─────────────────────────────────
   Un solo posto per la regola, usato dalla proposta in arrivo e dall'accetta.
   Restituisce null se va bene, altrimenti il motivo da mostrare a chi scrive. */
create or replace function public.dtest_domande_esito(p_domande jsonb)
returns text language plpgsql immutable set search_path to 'public' as $$
declare d jsonb; v_n int; v_opz int; v_cor int; i int;
begin
  if p_domande is null or jsonb_typeof(p_domande) <> 'array' then return 'le domande non sono un elenco'; end if;
  v_n := jsonb_array_length(p_domande);
  if v_n < 1 then return 'non c''è nessuna domanda'; end if;
  if v_n > 40 then return 'troppe domande: ' || v_n || ' (il massimo è 40)'; end if;
  for i in 0 .. v_n - 1 loop
    d := p_domande -> i;
    if jsonb_typeof(d) <> 'object' then return 'la domanda ' || (i + 1) || ' non è compilata'; end if;
    if coalesce(btrim(d ->> 'testo'), '') = '' then return 'la domanda ' || (i + 1) || ' non ha testo'; end if;
    if length(d ->> 'testo') > 500 then return 'la domanda ' || (i + 1) || ' è troppo lunga'; end if;
    if coalesce(d ->> 'tipo', '') not in ('scelta', 'multipla', 'testo') then
      return 'la domanda ' || (i + 1) || ' ha un tipo non previsto';
    end if;
    if coalesce((d ->> 'punti')::numeric, 1) <= 0 or coalesce((d ->> 'punti')::numeric, 1) > 100 then
      return 'i punti della domanda ' || (i + 1) || ' non sono validi';
    end if;
    v_opz := case when jsonb_typeof(d -> 'opzioni') = 'array' then jsonb_array_length(d -> 'opzioni') else 0 end;
    v_cor := case when jsonb_typeof(d -> 'corrette') = 'array' then jsonb_array_length(d -> 'corrette') else 0 end;
    if d ->> 'tipo' = 'testo' then
      if v_opz > 0 then return 'la domanda ' || (i + 1) || ' è a testo libero e non vuole risposte proposte'; end if;
    else
      if v_opz < 2 then return 'la domanda ' || (i + 1) || ' ha bisogno di almeno due risposte fra cui scegliere'; end if;
      if v_opz > 8 then return 'la domanda ' || (i + 1) || ' ha troppe risposte proposte'; end if;
      /* ⚠️ Il senso di tutto questo: la risposta giusta sta DENTRO la domanda,
         e senza non si corregge niente. È il controllo che il «correttore» su
         un secondo file Word non poteva fare. */
      if v_cor < 1 then return 'nella domanda ' || (i + 1) || ' non è segnata la risposta giusta'; end if;
      if d ->> 'tipo' = 'scelta' and v_cor <> 1 then
        return 'la domanda ' || (i + 1) || ' è a risposta unica ma ne ha segnate ' || v_cor;
      end if;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.dtest_domande_esito(jsonb) from public, anon;
grant execute on function public.dtest_domande_esito(jsonb) to authenticated, service_role;

/* ── 5. invitare un docente ────────────────────────────────────────────────
   Lo fa la segreteria dalla scheda del corso. Restituisce già il link da
   mettere nella mail: chi lo manda resta una persona (regola di sempre). */
create or replace function public.dtest_invita(
  p_corso_id bigint, p_nominativo text, p_email text default null,
  p_persona_id uuid default null, p_giorni int default 30)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_id bigint; v_cod text; v_base text; v_corso record;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if coalesce(btrim(p_nominativo), '') = '' then raise exception 'senza il nome del docente non si manda un invito'; end if;
  select id, titolo, test_previsto into v_corso from public.s_corsi where id = p_corso_id;
  if not found then raise exception 'corso % non trovato', p_corso_id; end if;

  v_cod := public.dtest_codice_nuovo(p_corso_id);
  insert into public.s_test_inviti (corso_id, persona_id, nominativo, email, codice, scadenza, creato_da)
  values (p_corso_id, p_persona_id, btrim(p_nominativo), nullif(btrim(coalesce(p_email, '')), ''),
          v_cod, current_date + greatest(coalesce(p_giorni, 30), 1), auth.email())
  returning id into v_id;

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');

  return jsonb_build_object(
    'id', v_id, 'codice', v_cod, 'titolo', v_corso.titolo,
    /* titolo e docente viaggiano nel link solo per intestare la pagina: a
       dire di quale corso si tratta è il codice firmato */
    'link', v_base || '?testdocente=' || public.url_encode_semplice(v_cod || '.' || public.dtest_firma(v_cod))
            || '&c=' || public.url_encode_semplice(left(coalesce(v_corso.titolo, ''), 120))
            || '&d=' || public.url_encode_semplice(left(btrim(p_nominativo), 80)),
    'scadenza', to_char(current_date + greatest(coalesce(p_giorni, 30), 1), 'YYYY-MM-DD'));
end $$;
revoke execute on function public.dtest_invita(bigint, text, text, uuid, int) from public, anon;
grant execute on function public.dtest_invita(bigint, text, text, uuid, int) to authenticated, service_role;

/* gli inviti di un corso, col link ricostruito (per rimandare la mail) */
create or replace function public.dtest_inviti(p_corso_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare v_base text; v_out jsonb;
begin
  if not (public.is_segreteria() or public.is_coordinatore()) then raise exception 'non autorizzato'; end if;
  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'nominativo', i.nominativo, 'email', i.email, 'codice', i.codice,
      'stato', i.stato, 'scadenza', to_char(i.scadenza, 'YYYY-MM-DD'),
      'scaduto', i.scadenza < current_date,
      'creato_il', to_jsonb(i.creato_il), 'creato_da', i.creato_da,
      'consegnato_il', to_jsonb(i.consegnato_il), 'motivo', i.motivo,
      /* il link si mostra solo finché serve: un invito chiuso non si rimanda */
      'link', case when i.stato in ('in_attesa', 'consegnato') and public.is_segreteria()
                   then v_base || '?testdocente=' || public.url_encode_semplice(i.codice || '.' || public.dtest_firma(i.codice))
                   else null end
    ) order by i.id desc), '[]'::jsonb) into v_out
    from public.s_test_inviti i where i.corso_id = p_corso_id;
  return v_out;
end $$;
revoke execute on function public.dtest_inviti(bigint) from public, anon;
grant execute on function public.dtest_inviti(bigint) to authenticated, service_role;

create or replace function public.dtest_revoca(p_id bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  update public.s_test_inviti
     set stato = 'revocato', chiuso_da = auth.email(), chiuso_il = now(),
         motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where id = p_id and stato in ('in_attesa', 'consegnato');
  if not found then raise exception 'invito non trovato, o già chiuso'; end if;
end $$;
revoke execute on function public.dtest_revoca(bigint, text) from public, anon;
grant execute on function public.dtest_revoca(bigint, text) to authenticated, service_role;

/* ── 6. la verifica del link, per chi ritira dalla cassetta ────────────────
   Stessa forma di iscr_verifica / quest_verifica: il riferimento è
   «codice.firma», e l'esito dice sempre perché. */
create or replace function public.dtest_verifica(p_riferimento text)
returns table(invito_id bigint, corso_id bigint, nominativo text, titolo text, aperto boolean, esito text)
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_cod text; v_firma text; p int; r record;
begin
  if p_riferimento is null or btrim(p_riferimento) = '' then
    return query select null::bigint, null::bigint, null::text, null::text, false, 'senza invito'::text; return;
  end if;
  p := position('.' in p_riferimento);
  if p = 0 then
    return query select null::bigint, null::bigint, null::text, null::text, false, 'firma mancante'::text; return;
  end if;
  v_cod := substr(p_riferimento, 1, p - 1);
  v_firma := substr(p_riferimento, p + 1);

  select i.id, i.corso_id, i.nominativo, i.stato, i.scadenza, c.titolo
    into r from public.s_test_inviti i
    left join public.s_corsi c on c.id = i.corso_id
   where i.codice = v_cod;
  if not found then
    return query select null::bigint, null::bigint, null::text, null::text, false, 'invito non trovato'::text; return;
  end if;
  if public.dtest_firma(v_cod) is distinct from lower(v_firma) then
    return query select null::bigint, null::bigint, null::text, null::text, false, 'firma non valida'::text; return;
  end if;
  if r.stato = 'revocato' then
    return query select r.id, r.corso_id, r.nominativo, r.titolo, false, 'invito revocato'::text; return;
  end if;
  if r.scadenza < current_date then
    return query select r.id, r.corso_id, r.nominativo, r.titolo, false, 'invito scaduto'::text; return;
  end if;
  return query select r.id, r.corso_id, r.nominativo, r.titolo, true, 'agganciato'::text;
end $$;
revoke execute on function public.dtest_verifica(text) from public, anon, authenticated;
grant execute on function public.dtest_verifica(text) to service_role;

/* segna l'invito come consegnato: la chiama chi ritira, dopo aver scritto la
   proposta. Non chiude l'invito — il docente può mandare una versione
   corretta finché la segreteria non ha accettato. */
create or replace function public.dtest_segna_consegnato(p_invito_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.s_test_inviti
     set stato = case when stato = 'in_attesa' then 'consegnato' else stato end,
         consegnato_il = now()
   where id = p_invito_id;
end $$;
revoke execute on function public.dtest_segna_consegnato(bigint) from public, anon, authenticated;
grant execute on function public.dtest_segna_consegnato(bigint) to service_role;

/* ── 7. portare la proposta nel test ───────────────────────────────────────
   È il passo che la segreteria fa a mano, ed è il punto di tutta la
   faccenda: finché non lo fa, il test non cambia.
   p_modo: 'sostituisci' (il test diventa quello del docente) oppure
   'aggiungi' (le domande si accodano a quelle che ci sono). */
create or replace function public.dtest_accetta(p_id bigint, p_modo text default 'sostituisci')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_err text; v_base int; v_n int := 0; d jsonb; i int;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select * into r from public.s_test_proposte where id = p_id;
  if not found then raise exception 'proposta non trovata'; end if;
  if r.stato <> 'nuova' then raise exception 'questa proposta è già stata %', r.stato; end if;
  if r.corso_id is null then raise exception 'la proposta non è agganciata a nessun corso: %', coalesce(r.riferimento_esito, 'motivo non registrato'); end if;
  if coalesce(p_modo, '') not in ('sostituisci', 'aggiungi') then raise exception 'modo non previsto: %', p_modo; end if;

  v_err := public.dtest_domande_esito(r.domande);
  if v_err is not null then raise exception 'la proposta non si può portare nel test: %', v_err; end if;

  if p_modo = 'sostituisci' then
    /* ⚠️ Si cancellano le domande, non le prove già consegnate: se qualcuno ha
       già fatto il test, cambiare le domande gli cambierebbe la prova sotto il
       naso. Per questo ci si ferma. */
    if exists (select 1 from public.s_test_prove where corso_id = r.corso_id) then
      raise exception 'c''è già chi ha consegnato il test: le domande non si sostituiscono, semmai si aggiungono';
    end if;
    delete from public.s_test_domande where corso_id = r.corso_id;
    v_base := 0;
  else
    select coalesce(max(ordine), 0) into v_base from public.s_test_domande where corso_id = r.corso_id;
  end if;

  for i in 0 .. jsonb_array_length(r.domande) - 1 loop
    d := r.domande -> i;
    insert into public.s_test_domande (corso_id, ordine, testo, tipo, opzioni, corrette, punti)
    values (r.corso_id, v_base + i + 1, btrim(d ->> 'testo'), d ->> 'tipo',
            coalesce(d -> 'opzioni', '[]'::jsonb), coalesce(d -> 'corrette', '[]'::jsonb),
            coalesce((d ->> 'punti')::numeric, 1));
    v_n := v_n + 1;
  end loop;

  update public.s_test_proposte
     set stato = 'accettata', esaminata_da = auth.email(), esaminata_il = now(), domande_portate = v_n
   where id = p_id;
  update public.s_test_inviti
     set stato = 'accettato', chiuso_da = auth.email(), chiuso_il = now()
   where id = r.invito_id and stato in ('in_attesa', 'consegnato');

  return jsonb_build_object('domande', v_n, 'corso_id', r.corso_id, 'modo', p_modo);
end $$;
revoke execute on function public.dtest_accetta(bigint, text) from public, anon;
grant execute on function public.dtest_accetta(bigint, text) to authenticated, service_role;

create or replace function public.dtest_scarta(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if coalesce(btrim(coalesce(p_motivo, '')), '') = '' then
    raise exception 'per scartare una proposta si scrive perché: è quello che si dice al docente';
  end if;
  select * into r from public.s_test_proposte where id = p_id;
  if not found then raise exception 'proposta non trovata'; end if;
  if r.stato <> 'nuova' then raise exception 'questa proposta è già stata %', r.stato; end if;
  update public.s_test_proposte
     set stato = 'scartata', esaminata_da = auth.email(), esaminata_il = now(), motivo = btrim(p_motivo)
   where id = p_id;
  /* ⚠️ L'invito NON si chiude: quasi sempre si scarta per far rifare, e il
     docente deve poter rimandare con lo stesso link. Si chiude a mano con
     «revoca» quando davvero non deve più scrivere. */
end $$;
revoke execute on function public.dtest_scarta(bigint, text) from public, anon;
grant execute on function public.dtest_scarta(bigint, text) to authenticated, service_role;
