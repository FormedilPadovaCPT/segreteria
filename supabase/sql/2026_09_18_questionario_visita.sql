/* ============================================================================
   QUESTIONARIO DOPO IL SOPRALLUOGO — legato al verbale  (18/09/2026)

   Chiesto dall'utente dopo aver visto le tre proposte: vale la «B» — una
   domanda sola, e le altre compaiono in base alla risposta — e il questionario
   deve partire dalla mail che trasmette il verbale, con un pulsante, così si
   sa SEMPRE a quale visita si riferisce.

   Perché un link firmato e non un semplice «?visita=V2526-0874»: gli
   identificativi sono in fila (0873, 0874, 0875…), quindi indovinarli è banale
   e chiunque potrebbe riempire di giudizi falsi le visite altrui. La firma è un
   HMAC del solo identificativo con un segreto che sta in s_config: il portale
   non lo conosce e non lo deve conoscere — si limita a riportare indietro ciò
   che ha ricevuto, e a controllare è il Gestionale quando ritira la risposta
   dalla cassetta.

   ⚠️ Se la firma non torna la risposta NON si butta: si salva senza il
   riferimento alla visita, e `riferimento_esito` dice perché. Vale la regola
   del 04/09 su da che parte sbagliare: perdere una risposta è peggio che
   tenerne una non agganciata.

   Le colonne del questionario vecchio restano tutte: le risposte raccolte
   allora dicono quel che dicevano (regola d'oro 7).
   ============================================================================ */

-- ── 1. il segreto con cui si firmano i link, e la radice del portale ────────
insert into s_config (chiave, valore, descrizione)
values ('questionario_segreto', encode(extensions.gen_random_bytes(32), 'hex'),
        'Segreto del link «Valuta la visita» della mail del verbale. Cambiarlo invalida i link già spediti.')
on conflict (chiave) do nothing;

insert into s_config (chiave, valore, descrizione)
values ('questionario_url_base', 'https://formedilpadovacpt.github.io/servizi/',
        'Radice del portale servizi, usata per comporre il link del questionario.')
on conflict (chiave) do nothing;

-- ── 2. le colonne del questionario nuovo ───────────────────────────────────
alter table public.s_questionari_sopralluogo
  add column if not exists visita_id          text,
  add column if not exists nr_verbale         text,
  add column if not exists utilita            smallint,
  add column if not exists motivi             text,
  add column if not exists commento           text,
  add column if not exists azione_dopo        text,
  add column if not exists riferimento_esito  text;

comment on column public.s_questionari_sopralluogo.visita_id is
  'La visita a cui il giudizio si riferisce, risolta dal link firmato della mail del verbale. Vuota se il questionario è stato aperto dal menu del portale.';
comment on column public.s_questionari_sopralluogo.utilita is
  'Quanto è stata utile la visita, 1-5. È la sola domanda obbligatoria del questionario.';
comment on column public.s_questionari_sopralluogo.motivi is
  'Le pastiglie del ramo: che cosa non ha funzionato (voto 1-2) o che cosa è servito (4-5), separate da « · ».';
comment on column public.s_questionari_sopralluogo.commento is
  'Testo libero del ramo intermedio (voto 3) e di chi vuole aggiungere qualcosa.';
comment on column public.s_questionari_sopralluogo.azione_dopo is
  'Che cosa è stato fatto dopo la visita. È la domanda che misura se il servizio serve, non se è piaciuto.';
comment on column public.s_questionari_sopralluogo.riferimento_esito is
  'Come è andato l''aggancio alla visita: agganciato / firma non valida / visita non trovata / senza invito.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_questionari_utilita_ck') then
    alter table public.s_questionari_sopralluogo
      add constraint s_questionari_utilita_ck check (utilita is null or utilita between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 's_questionari_visita_fk') then
    alter table public.s_questionari_sopralluogo
      add constraint s_questionari_visita_fk foreign key (visita_id)
      references public.visite (visita_id) on delete set null;
  end if;
end $$;

create index if not exists s_questionari_visita_idx on public.s_questionari_sopralluogo (visita_id);

-- ── 3. la firma ────────────────────────────────────────────────────────────
create or replace function public.questionario_firma(p_visita_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_segreto text;
begin
  if p_visita_id is null or btrim(p_visita_id) = '' then return null; end if;
  select valore into v_segreto from public.s_config where chiave = 'questionario_segreto';
  if v_segreto is null or v_segreto = '' then
    raise exception 'questionario_segreto mancante in s_config: il link non si può firmare';
  end if;
  /* 12 caratteri esadecimali: 48 bit, più che sufficienti contro il tentativo
     a mano, e un link che resta corto abbastanza da stare in un pulsante. */
  return left(encode(extensions.hmac(p_visita_id, v_segreto, 'sha256'), 'hex'), 12);
end $$;

revoke execute on function public.questionario_firma(text) from public, anon;
grant execute on function public.questionario_firma(text) to service_role;

-- ── 3-bis. percent-encoding di quel che finisce nel link ───────────────────
create or replace function public.url_encode_semplice(p text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(
    case when c ~ '^[A-Za-z0-9_.~-]$' then c
         else (select string_agg('%' || upper(substr(s.hx, n, 2)), '' order by n)
                 from (select encode(convert_to(c, 'UTF8'), 'hex') as hx) s,
                      generate_series(1, length(s.hx), 2) as n)
    end, '' order by i), '')
  from regexp_split_to_table(p, '') with ordinality as t(c, i);
$$;

revoke execute on function public.url_encode_semplice(text) from public, anon;
grant execute on function public.url_encode_semplice(text) to authenticated, service_role;

-- ── 4. il link da mettere nella mail del verbale ───────────────────────────
/* Oltre al riferimento firmato porta data, tecnico e comune: servono SOLO a
   scrivere l'intestazione della pagina («Visita del 12 settembre, con …»).
   Chi li cambiasse a mano mentirebbe soltanto a sé stesso: nel database
   finisce quello che dice il Gestionale, letto dalla visita vera. */
create or replace function public.questionario_link(p_visita_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r record; v_base text; v_firma text;
begin
  if not public.is_personale() then
    raise exception 'non autorizzato';
  end if;
  select v.visita_id, v.data_visita,
         nullif(btrim(coalesce(t.titolo,'') || ' ' || coalesce(t.tecnico_nome,'') || ' ' || coalesce(t.tecnico_cognome,'')), '') as tecnico,
         coalesce(c.comune_nome, '') as comune
    into r
    from public.visite v
    left join public.tecnici  t on t.tecnico_id  = v.tecnico_id
    left join public.cantieri c on c.cantiere_id = v.cantiere_id
   where v.visita_id = p_visita_id;
  if not found then return null; end if;

  select valore into v_base from public.s_config where chiave = 'questionario_url_base';
  v_base  := coalesce(v_base, 'https://formedilpadovacpt.github.io/servizi/');
  v_firma := public.questionario_firma(p_visita_id);

  return v_base
      || '?valuta=' || public.url_encode_semplice(p_visita_id || '.' || v_firma)
      || case when r.data_visita is null then '' else '&d=' || to_char(r.data_visita, 'YYYY-MM-DD') end
      || case when r.tecnico is null then '' else '&t=' || public.url_encode_semplice(r.tecnico) end
      || case when r.comune  =  ''   then '' else '&c=' || public.url_encode_semplice(r.comune)  end;
end $$;

revoke execute on function public.questionario_link(text) from public, anon;
grant execute on function public.questionario_link(text) to authenticated, service_role;

-- ── 5. la verifica, quando la risposta torna dal portale ───────────────────
create or replace function public.questionario_verifica(p_riferimento text)
returns table (visita_id text, nr_verbale text, tecnico text, data_visita date, esito text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id text; v_firma text; p int; r record;
begin
  if p_riferimento is null or btrim(p_riferimento) = '' then
    return query select null::text, null::text, null::text, null::date, 'senza invito'::text; return;
  end if;
  p := position('.' in p_riferimento);
  if p = 0 then
    return query select null::text, null::text, null::text, null::date, 'riferimento malformato'::text; return;
  end if;
  v_id    := substr(p_riferimento, 1, p - 1);
  v_firma := substr(p_riferimento, p + 1);

  if public.questionario_firma(v_id) is distinct from lower(v_firma) then
    return query select null::text, null::text, null::text, null::date, 'firma non valida'::text; return;
  end if;

  select v.visita_id, v.nr_verbale, v.data_visita,
         nullif(btrim(coalesce(t.titolo,'') || ' ' || coalesce(t.tecnico_nome,'') || ' ' || coalesce(t.tecnico_cognome,'')), '') as tecnico
    into r
    from public.visite v
    left join public.tecnici t on t.tecnico_id = v.tecnico_id
   where v.visita_id = v_id;
  if not found then
    return query select null::text, null::text, null::text, null::date, 'visita non trovata'::text; return;
  end if;

  return query select r.visita_id, r.nr_verbale, r.tecnico, r.data_visita, 'agganciato'::text;
end $$;

revoke execute on function public.questionario_verifica(text) from public, anon, authenticated;
grant execute on function public.questionario_verifica(text) to service_role;
