-- ============================================================================
-- 2026-09-08 — Anagrafiche: completamento automatico all'inserimento
--
-- Chiesto dall'utente dopo l'import della visita CPT/25_26/0849 (10/08/2026):
-- l'impresa «Edil Intonaci F.lli Cerello snc» era nata senza CAP, provincia e
-- forma giuridica, e la persona «Cerello Cristiano» senza titolo né sesso,
-- benché tutto fosse ricavabile da ciò che c'era già (comune, ragione sociale,
-- nome di battesimo).
--
-- La regola vive nel database, non nelle maschere: vale così per tutte le
-- porte da cui entra un'anagrafica — modale «Nuova impresa» del gestionale
-- visite, maschera Imprese della segreteria, parser di import dal modulo
-- Google, upsert delle persone al salvataggio della visita.
--
-- Principio: si riempie SOLO ciò che è vuoto e SOLO ciò che è deducibile con
-- certezza. Niente si inventa: se il comune non è in tabella o il nome è
-- ambiguo, il campo resta vuoto.
-- ============================================================================

-- ─── 1. comune → CAP / provincia ────────────────────────────────────────────
-- Normalizzazione del nome comune: maiuscole, senza accenti, senza il
-- quartiere («PADOVA - Q3 Est» → «PADOVA»), spazi compressi.
create or replace function public.comune_norm(p text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(
           translate(upper(coalesce(p, '')), 'ÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ''’', 'AAAAEEEEIIIIOOOOUUUU  '),
           '\s+', ' ', 'g')), '');
$$;
-- il quartiere di Padova va tolto DOPO la traduzione (il trattino sopravvive)
create or replace function public.comune_norm_base(p text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(public.comune_norm(p), '\s*-\s*Q\d.*$', '')), '');
$$;

create table if not exists public.comuni_cap (
  nome       text not null,
  nome_norm  text generated always as (public.comune_norm_base(nome)) stored,
  cap        text,
  prov       text,
  fonte      text not null default 'CAP_PD di app-data.js (gestionale visite) + comuni_catastali',
  created_at timestamptz not null default now(),
  primary key (nome_norm)
);
comment on table public.comuni_cap is
  'Comune → CAP e provincia per il completamento automatico delle anagrafiche. Per le città con più CAP vale quello generico (Padova 35100). Seminata il 2026-09-08 dalla mappa CAP_PD del gestionale visite; la provincia viene da comuni_catastali quando il nome è univoco.';

alter table public.comuni_cap enable row level security;
drop policy if exists comuni_cap_sel on public.comuni_cap;
create policy comuni_cap_sel on public.comuni_cap for select to authenticated using (true);
revoke all on public.comuni_cap from public, anon;
grant select on public.comuni_cap to authenticated;

-- seme: 110 comuni (provincia di Padova + i comuni limitrofi già usati dal gestionale)
insert into public.comuni_cap(nome,cap) values
('Abano Terme','35031'),
('Agna','35021'),
('Albignasego','35020'),
('Anguillara Veneta','35022'),
('Arquà Petrarca','35032'),
('Arquà Polesine','45031'),
('Arre','35020'),
('Arzergrande','35020'),
('Bagnoli di Sopra','35023'),
('Baone','35030'),
('Barbona','35040'),
('Battaglia Terme','35041'),
('Boara Pisani','35040'),
('Borgo Veneto','35046'),
('Borgoricco','35010'),
('Bovolenta','35024'),
('Brugine','35020'),
('Cadoneghe','35010'),
('Campodarsego','35011'),
('Campodoro','35010'),
('Camposampiero','35012'),
('Campo San Martino','35010'),
('Candiana','35020'),
('Carceri','35040'),
('Carmignano di Brenta','35010'),
('Cartura','35025'),
('Casale di Scodosia','35040'),
('Casalserugo','35020'),
('Castelbaldo','35040'),
('Cervarese Santa Croce','35030'),
('Chioggia','30015'),
('Cinto Euganeo','35030'),
('Cittadella','35013'),
('Codevigo','35020'),
('Conselve','35026'),
('Correzzola','35020'),
('Curtarolo','35010'),
('Due Carrare','35020'),
('Este','35042'),
('Fontaniva','35014'),
('Galliera Veneta','35015'),
('Galzignano Terme','35030'),
('Gazzo','35010'),
('Grantorto','35010'),
('Granze','35040'),
('Guarda Veneta','45030'),
('Legnaro','35020'),
('Limena','35010'),
('Loreggia','35010'),
('Lozzo Atestino','35034'),
('Maserà di Padova','35020'),
('Masi','35040'),
('Massanzago','35010'),
('Megliadino San Fidenzio','35040'),
('Megliadino San Vitale','35040'),
('Merlara','35040'),
('Mestrino','35035'),
('Monselice','35043'),
('Montagnana','35044'),
('Montegrotto Terme','35036'),
('Motta','35060'),
('Noventa Padovana','35027'),
('Ospedaletto Euganeo','35045'),
('Padova','35100'),
('Pernumia','35020'),
('Piacenza d''Adige','35040'),
('Piazzola sul Brenta','35016'),
('Piombino Dese','35017'),
('Piove di Sacco','35028'),
('Polverara','35020'),
('Ponso','35040'),
('Pontelongo','35029'),
('Ponte San Nicolò','35020'),
('Pozzonovo','35020'),
('Rovolon','35030'),
('Rubano','35030'),
('Saccolongo','35030'),
('San Giorgio delle Pertiche','35010'),
('San Giorgio in Bosco','35010'),
('San Martino di Lupari','35018'),
('San Pietro in Gu','35010'),
('San Pietro Viminario','35020'),
('Sant''Angelo di Piove di Sacco','35020'),
('Santa Caterina d''Este','35040'),
('Santa Giustina in Colle','35010'),
('Sant''Elena','35040'),
('Sant''Urbano','35040'),
('Saonara','35020'),
('Selvazzano Dentro','35030'),
('Solesino','35047'),
('Stanghella','35048'),
('Teolo','35037'),
('Terrassa Padovana','35020'),
('Tombolo','35019'),
('Torre di Mosto','30020'),
('Torreglia','35038'),
('Trebaseleghe','35010'),
('Tribano','35020'),
('Urbana','35040'),
('Veggiano','35030'),
('Vescovana','35040'),
('Vighizzolo d''Este','35040'),
('Vigodarzere','35010'),
('Vigonovo','35010'),
('Vigonza','35010'),
('Villa del Conte','35010'),
('Villa Estense','35040'),
('Villafranca Padovana','35010'),
('Villanova di Camposampiero','35010'),
('Vo''','35030')
on conflict (nome_norm) do nothing;

-- provincia da comuni_catastali, solo dove il nome è univoco in Italia
update public.comuni_cap c
   set prov = x.prov
  from (select public.comune_norm_base(nome) n, min(prov) prov
          from public.comuni_catastali
         group by 1 having count(distinct prov) = 1) x
 where x.n = c.nome_norm and c.prov is null;

-- Ricerca: prima comuni_cap (CAP + prov), poi la sola provincia da
-- comuni_catastali se il nome è univoco. Mai due candidati.
create or replace function public.comune_cap_prov(p_comune text)
returns table(cap text, prov text)
language sql
stable
security definer
set search_path = public
as $$
  with n as (select public.comune_norm_base(p_comune) v)
  select c.cap, c.prov
    from public.comuni_cap c, n
   where c.nome_norm = n.v
  union all
  select null::text, x.prov
    from (select public.comune_norm_base(cc.nome) nn, min(cc.prov) prov
            from public.comuni_catastali cc, n
           where public.comune_norm_base(cc.nome) = n.v
           group by 1 having count(distinct cc.prov) = 1) x
   where not exists (select 1 from public.comuni_cap c, n where c.nome_norm = n.v)
  limit 1;
$$;
revoke execute on function public.comune_cap_prov(text) from public, anon;
grant execute on function public.comune_cap_prov(text) to authenticated, service_role;

-- ─── 2. forma giuridica dalla ragione sociale ───────────────────────────────
-- I valori sono quelli già in uso nella colonna imprese.tipo_impresa
-- (S.r.l. 1.597, S.n.c. 360, S.A.S. 191, S.r.l.s 187, S.p.A. 172, ...).
-- Torna null se dal nome non si capisce: la ditta individuale, ad esempio,
-- non si deduce da un nome di persona.
create or replace function public.forma_giuridica_da_nome(p_nome text)
returns text
language sql
immutable
as $$
  with s as (select ' ' || lower(coalesce(p_nome, '')) || ' ' n)
  select case
    when n ~ '[^a-z]s\.?\s?r\.?\s?l\.?\s?s\.?[^a-z]' or n ~ '[^a-z]srls[^a-z]'
      then 'S.r.l.s'
    when (n ~ '[^a-z]s\.?\s?r\.?\s?l\.?[^a-z]' or n ~ '[^a-z]srl[^a-z]') and n ~ 'unipersonale|socio unico|s\.?\s?u\.?[^a-z]'
      then 'S.r.l. Unipersonale'
    when n ~ '[^a-z]s\.?\s?r\.?\s?l\.?[^a-z]' or n ~ '[^a-z]srl[^a-z]'
      then 'S.r.l.'
    when n ~ '[^a-z]s\.?\s?n\.?\s?c\.?[^a-z]' or n ~ '[^a-z]snc[^a-z]'
      then 'S.n.c.'
    when n ~ '[^a-z]s\.?\s?a\.?\s?s\.?[^a-z]' or n ~ '[^a-z]sas[^a-z]'
      then 'S.A.S.'
    when n ~ '[^a-z]s\.?\s?p\.?\s?a\.?[^a-z]' or n ~ '[^a-z]spa[^a-z]'
      then 'S.p.A.'
    when n ~ 's\.?\s?c\.?\s?a\.?\s?r\.?\s?l|soc(\.|ietà|ieta)?\s*coop|cooperativa|[^a-z]s\.?\s?coop|[^a-z]scarl[^a-z]|[^a-z]s\.?\s?c\.?\s?s\.?[^a-z]'
      then 'S.coop.'
    when n ~ 'consorzio'
      then 'Consorzio'
    when n ~ 'ditta individuale|impresa individuale'
      then 'Ditta Individuale'
    else null end
  from s;
$$;

-- ─── 3. trigger su imprese ──────────────────────────────────────────────────
create or replace function public.imprese_completa_anagrafica()
returns trigger
language plpgsql
set search_path = public
as $$
declare r record;
begin
  if new.comune is not null and trim(new.comune) <> ''
     and (new.cap is null or trim(new.cap) = '' or new.prov is null or trim(new.prov) = '') then
    select * into r from public.comune_cap_prov(new.comune);
    if found then
      if new.cap  is null or trim(new.cap)  = '' then new.cap  := r.cap;  end if;
      if new.prov is null or trim(new.prov) = '' then new.prov := r.prov; end if;
    end if;
  end if;
  -- la sigla di provincia si scrive maiuscola (in archivio c'era anche «Pd»)
  if new.prov is not null then new.prov := nullif(upper(trim(new.prov)), ''); end if;
  if new.tipo_impresa is null or trim(new.tipo_impresa) = '' then
    new.tipo_impresa := public.forma_giuridica_da_nome(
      coalesce(new.impresa_nome, '') || ' ' || coalesce(new.ragione_sociale2, ''));
  end if;
  return new;
end $$;
revoke execute on function public.imprese_completa_anagrafica() from public, anon;

drop trigger if exists trg_imprese_completa_anagrafica on public.imprese;
create trigger trg_imprese_completa_anagrafica
  before insert or update of comune, cap, prov, impresa_nome, ragione_sociale2, tipo_impresa
  on public.imprese
  for each row execute function public.imprese_completa_anagrafica();

-- ─── 4. sesso dal nome di battesimo, titolo di cortesia ─────────────────────
-- Il dizionario è l'anagrafica stessa: 8.500 persone con il sesso scritto,
-- 1.769 nomi distinti di cui 1.713 unanimi. Si risponde solo quando il nome è
-- noto e (quasi) unanime; altrimenti null, e il titolo resta vuoto.
create index if not exists ix_persone_primo_nome
  on public.persone (upper(split_part(trim(nome), ' ', 1)));

create or replace function public.sesso_da_nome(p_nome text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when m >= 2 and f = 0 then 'M'
           when f >= 2 and m = 0 then 'F'
           when m + f >= 5 and m >= 0.9 * (m + f) then 'M'
           when m + f >= 5 and f >= 0.9 * (m + f) then 'F'
           else null end
    from (select count(*) filter (where upper(sesso) = 'M') m,
                 count(*) filter (where upper(sesso) = 'F') f
            from public.persone
           where coalesce(elimina, 0) = 0 and sesso is not null and nome is not null
             and upper(split_part(trim(nome), ' ', 1)) = upper(split_part(trim(coalesce(p_nome, '')), ' ', 1))) x;
$$;
revoke execute on function public.sesso_da_nome(text) from public, anon;
grant execute on function public.sesso_da_nome(text) to authenticated, service_role;

-- Gira DOPO trg_persone_cf_fill (ordine alfabetico dei trigger): se c'è il
-- codice fiscale il sesso arriva da lì, e qui si usa il nome solo se manca.
create or replace function public.persone_completa_anagrafica()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sesso is not null then new.sesso := nullif(upper(trim(new.sesso)), ''); end if;
  if new.sesso is null and new.nome is not null and trim(new.nome) <> '' then
    new.sesso := public.sesso_da_nome(new.nome);
  end if;
  if (new.titolo is null or trim(new.titolo) = '') and new.sesso in ('M', 'F') then
    new.titolo := case new.sesso when 'M' then 'Sig.' else 'Sig.ra' end;
  end if;
  return new;
end $$;
revoke execute on function public.persone_completa_anagrafica() from public, anon;

drop trigger if exists trg_persone_completa_anagrafica on public.persone;
create trigger trg_persone_completa_anagrafica
  before insert or update of nome, cf, sesso, titolo
  on public.persone
  for each row execute function public.persone_completa_anagrafica();

-- ─── 5. ATECO 2025 completo ─────────────────────────────────────────────────
-- ateco_codici aveva 151 righe (i soli codici presenti nell'Access). La
-- struttura ufficiale ATECO 2025 (3.257 voci) sta nel file
-- 3_RISORSE/Codici_ATECO/StrutturaATECO-2025-IT-EN-1.xlsx del vault ed è
-- caricata dal file gemello 2026_09_08_ateco_2025_seed.sql (on conflict do
-- nothing: le righe già presenti non cambiano).
-- imprese_ateco: la segreteria può ora scrivere anche da qui (policy già
-- presenti: is_segreteria su insert/update/delete). Fonte distinta dall'Access.
alter table public.imprese_ateco alter column fonte set default 'segreteria';

-- ─── 6. igiene: le funzioni pure non devono essere eseguibili da anon ───────
-- (regola del 07/09: revoke from public, anon; e' il test 03_rls_personale a contarle)
revoke execute on function public.comune_norm(text) from public, anon;
revoke execute on function public.comune_norm_base(text) from public, anon;
revoke execute on function public.forma_giuridica_da_nome(text) from public, anon;
grant execute on function public.comune_norm(text), public.comune_norm_base(text), public.forma_giuridica_da_nome(text) to authenticated, service_role;

-- ─── 7. caricamento ATECO 2025 dal file gemello pubblicato sul repo ─────────
-- Eseguito a mano il 2026-09-08 (estensione http gia' installata):
-- do $$ declare s text; begin
--   select content into s from http_get('https://raw.githubusercontent.com/FormedilPadovaCPT/segreteria/main/supabase/sql/2026_09_08_ateco_2025_seed.sql');
--   execute s;
-- end $$;
