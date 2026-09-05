-- Analisi DB 05/09/2026 — fasi A e B, eseguite sul progetto Gestionale (utdantrfugnmqsuujxbe).
-- Copia di quanto applicato via MCP, per lo storico nel repo. Il trigger IPC e l'audit sono
-- nella migrazione "ipc_trigger_per_istruzione_e_audit_senza_updated_at" (supabase_migrations).

-- Fase A ------------------------------------------------------------------
analyze;
vacuum (analyze) public.cantieri;
vacuum (analyze) public.s_nomine;
vacuum (analyze) public.s_incarichi_mensili;

-- tabelle di staging/backup fuori da public (non esposte all'API, non cancellate)
alter table public.imp_access_staging      set schema archivio;
alter table public.s_dip_extra_staging     set schema archivio;
alter table public.s_dip_persona           set schema archivio;
alter table public.staging_persone_ufficio set schema archivio;
alter table public.s_nomine_staging        set schema archivio;
alter table public.s_prot_staging          set schema archivio;
alter table public.stg_tsoft               set schema archivio;
alter table public.imp_access_match_review set schema archivio;
alter table public.ateco_staging           set schema archivio;

comment on view public.v_master_visite is 'Vista di consultazione per Studio ed export. Ricalcola gli aggregati checklist a ogni chiamata (~4 s per pagina): NON usare dalle app. Analisi DB 05/09/2026.';
alter table public.visite set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
alter table public.visite_checklist set (autovacuum_vacuum_scale_factor = 0.05);
alter table public.cantieri set (autovacuum_vacuum_scale_factor = 0.05);
-- alter database postgres set track_functions = 'pl';  -- NON applicabile: permission denied su Supabase

-- Fase B ------------------------------------------------------------------
alter table public.ceiv_lista add primary key (codice);   -- 0 duplicati, 0 null al 05/09

-- indici a corredo di tutte le FK di public che non ne avevano (39, nome idx_fk_<vincolo>)
do $$
declare r record; v_cols text; v_idx text;
begin
  for r in
    select c.conrelid::regclass as tab, c.conname, c.conkey, c.conrelid
    from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace
    where c.contype = 'f' and ns.nspname = 'public'
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                        and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into v_cols
    from unnest(r.conkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum;
    v_idx := left('idx_fk_' || replace(r.conname, '_fkey', ''), 63);
    execute format('create index if not exists %I on %s (%s)', v_idx, r.tab, v_cols);
  end loop;
end $$;

-- le funzioni trigger non devono essere chiamabili via RPC (advisor authenticated_security_definer_function_executable);
-- provato in transazione: con EXECUTE revocato un tecnico salva ancora la checklist (il trigger scatta lo stesso)
revoke execute on function public.trg_checklist_ipc_stmt() from authenticated, anon, public;
revoke execute on function public.a_tg_audit_change() from authenticated, anon, public;
