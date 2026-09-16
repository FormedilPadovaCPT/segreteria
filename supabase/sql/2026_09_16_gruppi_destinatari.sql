-- ============================================================================
-- 16/09/2026 — Gruppi di destinatari per la posta del protocollo
--
-- Chiesto dall'utente: nella mail di un protocollo poter scrivere a un
-- gruppo — i tecnici, gli asseveratori, la Commissione Sicurezza — invece
-- di aggiungere le persone una per una.
--
-- ⚠️ UN GRUPPO NON È UN ELENCO DI NOMI: È «CHI HA OGGI UNA CERTA NOMINA».
--    La tabella dice solo quali ruoli di s_nomine formano il gruppo; i membri
--    si calcolano a ogni invio dalle nomine in corso. Così il gruppo segue da
--    solo i cambiamenti (una nomina chiusa esce, una nuova entra), e la mail
--    ricorda chi l'ha ricevuta davvero, perché s_prot_invii salva gli indirizzi.
--    Il rovescio: se una nomina non viene chiusa, la persona resta nel gruppo.
--
-- ⚠️ QUALE INDIRIZZO (scelta dell'utente, 16/09/2026):
--    1. se la persona è un tecnico, l'indirizzo istituzionale della tabella
--       tecnici (@did.formedilpadova.it);
--    2. altrimenti quello scritto sulla nomina (email_ruolo);
--    3. altrimenti il primo dell'anagrafica (email, email2, email3).
--    Sulle nomine dei tecnici l'indirizzo è ancora sul vecchio dominio
--    @did.scuolaedilepadova.net, dove l'app non ha mai spedito niente: per
--    questo la tabella tecnici viene prima. L'indirizzo resta visibile e
--    correggibile nella maschera d'invio.
-- ============================================================================

create table if not exists public.s_gruppi_destinatari (
  codice      text primary key check (codice ~ '^[a-z0-9_]+$'),
  nome        text not null,
  ruoli       integer[] not null check (cardinality(ruoli) > 0),
  ordine      integer not null default 0,
  attivo      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.s_gruppi_destinatari is
  'Gruppi di destinatari della posta del protocollo. Un gruppo è «chi ha oggi una delle nomine in ruoli» (s_nomine in corso): i membri non si scrivono qui, si calcolano con s_gruppo_destinatari(codice). Un gruppo nuovo si aggiunge come riga, non nel codice.';
comment on column public.s_gruppi_destinatari.ruoli is
  'id_ruolo di s_ruoli. Chi ha una nomina in corso con uno di questi ruoli è nel gruppo.';

alter table public.s_gruppi_destinatari enable row level security;

drop policy if exists s_gruppi_destinatari_sel on public.s_gruppi_destinatari;
create policy s_gruppi_destinatari_sel on public.s_gruppi_destinatari
  for select to authenticated using ((select public.is_segreteria()));

drop policy if exists s_gruppi_destinatari_mod on public.s_gruppi_destinatari;
create policy s_gruppi_destinatari_mod on public.s_gruppi_destinatari
  for all to authenticated
  using ((select public.is_segreteria()))
  with check ((select public.is_segreteria()));

insert into public.s_gruppi_destinatari (codice, nome, ruoli, ordine, note) values
  ('tecnici',               'Tecnici CPT',           array[6],  1, 'Nomina «TECNICO CPT PADOVA».'),
  ('asseveratori',          'Asseveratori',          array[76], 2, 'Nomina «TECNICO VERIFICATORE».'),
  ('commissione_sicurezza', 'Commissione Sicurezza', array[62], 3, 'Nomina «Commissione Sicurezza».')
on conflict (codice) do nothing;

-- ── I membri di un gruppo, con l'indirizzo da usare ─────────────────────────
-- security invoker: valgono le RLS di s_nomine (segreteria), persone e tecnici
-- (personale). Chi non è segreteria riceve un elenco vuoto.
create or replace function public.s_gruppo_destinatari(p_codice text)
returns table (persona_id uuid, nominativo text, mansione text, email text, fonte text)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with g as (
    select ruoli from public.s_gruppi_destinatari where codice = p_codice and attivo
  ),
  -- una riga per persona anche se ha due nomine dello stesso gruppo
  n as (
    select distinct on (coalesce(n.persona_id::text, lower(trim(n.persona_txt))))
           n.persona_id, n.persona_txt, n.mansione, n.email_ruolo
      from public.s_nomine n, g
     where n.ruolo_id = any (g.ruoli)
       and (n.data_fine is null or n.data_fine >= current_date)
       and (n.data_inizio is null or n.data_inizio <= current_date)
     order by coalesce(n.persona_id::text, lower(trim(n.persona_txt))),
              n.data_inizio desc nulls last, n.access_id desc
  ),
  r as (
    select n.persona_id,
           coalesce(nullif(trim(concat_ws(' ', p.cognome, p.titolo, p.nome)), ''), n.persona_txt) as nominativo,
           n.mansione,
           t.email as email_tecnico,
           -- un campo può contenere più indirizzi («a; b»): vale il primo
           nullif((regexp_split_to_array(trim(coalesce(n.email_ruolo, '')), '[;,[:space:]]+'))[1], '') as email_nomina,
           coalesce(
             nullif((regexp_split_to_array(trim(coalesce(p.email,  '')), '[;,[:space:]]+'))[1], ''),
             nullif((regexp_split_to_array(trim(coalesce(p.email2, '')), '[;,[:space:]]+'))[1], ''),
             nullif((regexp_split_to_array(trim(coalesce(p.email3, '')), '[;,[:space:]]+'))[1], '')
           ) as email_anagrafica
      from n
      left join public.persone p on p.persona_id = n.persona_id
      left join lateral (
        select t.email
          from public.tecnici t
         where p.persona_id is not null
           and nullif(trim(t.email), '') is not null
           and (   lower(trim(t.email)) in (lower(trim(coalesce(p.email, ''))),
                                            lower(trim(coalesce(p.email2, ''))),
                                            lower(trim(coalesce(p.email3, ''))))
                or (    lower(trim(t.tecnico_cognome)) = lower(trim(p.cognome))
                    and lower(trim(t.tecnico_nome))    = lower(trim(p.nome))))
         order by t.attivo desc
         limit 1
      ) t on true
  )
  select persona_id, nominativo, mansione,
         coalesce(email_tecnico, email_nomina, email_anagrafica) as email,
         case when email_tecnico is not null then 'tecnici'
              when email_nomina is not null then 'nomina'
              when email_anagrafica is not null then 'anagrafica' end as fonte
    from r
   order by nominativo;
$$;

comment on function public.s_gruppo_destinatari(text) is
  'I membri di un gruppo di destinatari (s_gruppi_destinatari): chi ha oggi una nomina in corso con uno dei ruoli del gruppo, con l''indirizzo da usare — prima quello istituzionale della tabella tecnici, poi quello della nomina, poi quello dell''anagrafica — e da dove viene. email vuota = la persona non ha indirizzi.';

revoke execute on function public.s_gruppo_destinatari(text) from public, anon;
grant  execute on function public.s_gruppo_destinatari(text) to authenticated, service_role;

-- ============================================================================
-- CORREZIONI ALLE NOMINE (decise dall'utente il 16/09/2026, eseguite a parte)
--
-- Perché i gruppi dicano il vero:
--   · chiusa la nomina TECNICO CPT PADOVA di Canova (7474): non è più tecnico;
--   · chiuse le nomine TECNICO VERIFICATORE di Finesso (6292) e Pasqualini (531);
--   · aggiunta la nomina TECNICO VERIFICATORE a De Marco, Visentini e Balladore,
--     asseveratori in servizio nel 2026, senza data di inizio (non documentata).
-- La data di fine è il 15/09/2026, ultimo giorno di validità: una nomina con
-- data_fine = oggi vale ancora per tutto oggi (la regola dell'app è
-- data_fine >= current_date), e il primo tentativo col 16/09 le lasciava nei
-- gruppi. Non è la data vera, che non è nota: lo dice la nota. Lorenzin (106) resta aperta finché l'utente non
-- comunica la data; Parasiliti (7480) non si tocca.
-- ============================================================================
do $$
declare
  v_id  integer;
  v_n   integer;
  v_nota_chiusura text := '[nomina chiusa il 16/09/2026 dalla segreteria, su indicazione dell''utente, per il gruppo di destinatari del protocollo: data effettiva di fine da confermare]';
  v_nota_nuova    text := '[registrata il 16/09/2026 dalla segreteria, su indicazione dell''utente: asseveratore in servizio nel 2026; data di inizio non documentata]';
  r record;
begin
  update public.s_nomine
     set data_fine = date '2026-09-15', note = concat_ws(' ', nullif(note, ''), v_nota_chiusura), updated_at = now()
   where ((access_id = 7474 and ruolo_id = 6)
      or (access_id in (6292, 531) and ruolo_id = 76))
     and data_fine is null;
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'Chiusura nomine: attese 3 righe, trovate %', v_n; end if;

  perform pg_advisory_xact_lock(hashtext('s_nomine_access_id'));
  for r in
    select * from (values
      ('920f9247-9371-4146-9052-d26886b4d4f4'::uuid, 'De Marco Arch. Nicola',  'nicola.demarco@did.formedilpadova.it'),
      ('fdb3b636-15fc-47be-ad4b-0620ac672622'::uuid, 'Visentini Arch. Tommaso', 'tommaso.visentini@did.formedilpadova.it'),
      ('19f60bc3-4b8c-4916-9b2a-71d31d8c755f'::uuid, 'Balladore Ing. Paolo',    'paolo.balladore@did.formedilpadova.it')
    ) as x(persona_id, persona_txt, email)
  loop
    if exists (select 1 from public.s_nomine n where n.persona_id = r.persona_id and n.ruolo_id = 76
                and (n.data_fine is null or n.data_fine >= current_date)) then
      continue;
    end if;
    select greatest(90000, coalesce(max(access_id), 0)) + 1 into v_id from public.s_nomine;
    insert into public.s_nomine (access_id, data_reg, persona_txt, persona_id, impresa_txt, impresa_id,
                                 ruolo_txt, ruolo_id, mansione, data_inizio, note, email_ruolo, created_at, updated_at)
    values (v_id, current_date, r.persona_txt, r.persona_id, 'FORMEDIL PADOVA', '80006850285',
            'TECNICO VERIFICATORE', 76, 'Asseveratore', null, v_nota_nuova, r.email, now(), now());
  end loop;
end $$;

-- ============================================================================
-- (stesso giorno, seconda richiesta) Il gruppo resta scritto sul protocollo e
-- sulla mail. L'utente, riaprendo il protocollo inviato al gruppo, non ne
-- trovava traccia: s_prot_invii teneva solo gli indirizzi.
-- Migrazione gruppo_destinatari_su_protocollo_e_invii_2026_09_16.
-- ============================================================================
alter table public.s_protocollo
  add column if not exists gruppo_destinatari text
  references public.s_gruppi_destinatari(codice) on update cascade on delete set null;

comment on column public.s_protocollo.gruppo_destinatari is
  'Il gruppo a cui è destinato il protocollo in uscita (s_gruppi_destinatari), scelto nella maschera: la mail d''invio propone i suoi membri in «A». Chi l''ha ricevuta davvero lo dice s_prot_invii.';

alter table public.s_prot_invii
  add column if not exists gruppi text[] not null default '{}';

comment on column public.s_prot_invii.gruppi is
  'I nomi dei gruppi di destinatari a cui è andata la mail: quelli con almeno un indirizzo ancora in «A» o in copia al momento della preparazione. Nome e non codice: la mail dice come si chiamava il gruppo quel giorno.';

-- Recupero del primo caso, eseguito a parte: il protocollo OUT 2581 del
-- 16/09/2026 («Promemoria riunione tecnici») era stato mandato al gruppo
-- tecnici prima che il gruppo si registrasse (lo dice l'utente; gli indirizzi
-- tornano: cinque in «A», Balladore in copia).
--   update s_protocollo set gruppo_destinatari = 'tecnici' where numero = 2581 and direzione = 'OUT' and esercizio is null;
--   update s_prot_invii set gruppi = array['Tecnici CPT'] where id = 17;
