-- Rete di sicurezza del database scritta con pgTAP (04/10/2026).
-- Rispetto agli assert dei test 01-20, pgTAP dice QUALE controllo e' fallito
-- e, con is_empty(), ELENCA le righe colpevoli: il 21/09 il test 03 e' andato
-- rosso per settimane anche perche' il messaggio diceva solo «6 funzioni».
--
-- pgTAP non e' installato in modo permanente: l'estensione si crea dentro la
-- transazione e sparisce col rollback finale, insieme a tutto il resto.
-- finish(true) solleva un errore se un controllo fallisce, cosi' psql con
-- ON_ERROR_STOP esce con codice 1 e il workflow diventa rosso.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

-- 1. nessuna funzione di public eseguibile con la chiave pubblica.
--    Supabase concede EXECUTE ad anon a ogni funzione nuova: questo controllo
--    e' quello che se ne accorge (caso del 04/10/2026, cinque trigger e
--    s_riaggancio_chiave). Rimedio: revoke ... from public, anon.
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$, 'nessuna funzione di public eseguibile da anon');

-- 2. ogni tabella di public ha la RLS accesa
select is_empty($$
  select c.relname::text from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
$$, 'RLS accesa su tutte le tabelle di public');

-- 3. nessuna policy USING (true) sulle tabelle con dati
select is_empty($$
  select tablename || '.' || policyname from pg_policies
   where schemaname = 'public' and (qual = 'true' or with_check = 'true')
     and tablename not in ('checklist_voci', 'comuni_istat', 'comuni_catastali', 'ateco_codici',
                           'comuni_cap', 'imprese_certificazioni_tipi')
$$, 'nessuna policy USING (true) fuori dalle tabelle di consultazione');

-- 4. le funzioni SECURITY DEFINER fissano il search_path
select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$, 'SECURITY DEFINER sempre con search_path');

-- 5. qualita' dei dati: nessuna nomina di tecnico CPT ancora aperta per chi in
--    «tecnici» risulta solo non attivo. Caso del 04/10/2026: l'import dei
--    rapporti da Access (24/09) aveva riaperto Canova nel gruppo «tecnici»
--    del protocollo con una nomina senza date.
select is_empty($$
  select p.cognome || ' ' || p.nome || ' (nomina ' || n.access_id || ')'
    from public.s_nomine n join public.persone p on p.persona_id = n.persona_id
   where n.ruolo_id = 6 and (n.data_fine is null or n.data_fine >= current_date)
     and exists (select 1 from public.tecnici t
                  where lower(t.tecnico_cognome) = lower(p.cognome) and lower(t.tecnico_nome) = lower(p.nome) and not t.attivo)
     and not exists (select 1 from public.tecnici t
                  where lower(t.tecnico_cognome) = lower(p.cognome) and lower(t.tecnico_nome) = lower(p.nome) and t.attivo)
$$, 'nessuna nomina di tecnico aperta per un tecnico non attivo');

select * from finish(true);
rollback;
