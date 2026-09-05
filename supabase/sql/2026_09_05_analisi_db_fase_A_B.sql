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

-- Fase D, parte leggera (05/09/2026 sera) ---------------------------------
-- F10: le copie denormalizzate dichiarano che cosa sono (SNAPSHOT / COPIA DI COMODO / com'era scritto nella fonte)
comment on column public.s_incarichi_mensili.tecnico_nome  is 'SNAPSHOT al momento della lettera di incarico: non ricalcolare da tecnici.';
comment on column public.s_incarichi_mensili.tecnico_email is 'SNAPSHOT al momento della lettera di incarico: non ricalcolare da tecnici.';
comment on column public.s_fatture_tecnici.tecnico_nome    is 'SNAPSHOT: intestazione della fattura come ricevuta. Fa fede il documento, non tecnici.';
comment on column public.s_prestazioni.tecnico_nome        is 'COPIA DI COMODO: fa fede tecnici (join su tecnico_id). Può essere ricalcolata.';
comment on column public.incarichi.tecnico_nome            is 'COPIA DI COMODO: fa fede tecnici (join su tecnico_id). Può essere ricalcolata.';
comment on column public.incarichi.tecnico_email           is 'COPIA DI COMODO: fa fede tecnici.email. Può essere ricalcolata.';
comment on column public.segnalazioni_cantiere.tecnico_nome is 'COPIA DI COMODO: fa fede tecnici. Può essere ricalcolata.';
comment on column public.s_protocollo.impresa_nome         is 'SNAPSHOT: nome dell''impresa com''era scritto sul documento protocollato (regola d''oro 7). Non ricalcolare.';
comment on column public.s_attestazioni_dm132.ragione_sociale  is 'SNAPSHOT al momento della richiesta: l''impresa può cambiare nome (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_conferenze_cantiere.ragione_sociale is 'SNAPSHOT al momento della richiesta: l''impresa può cambiare nome (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_consulenze.ragione_sociale          is 'SNAPSHOT al momento della richiesta: l''impresa può cambiare nome (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_notifiche_cantiere.ragione_sociale  is 'SNAPSHOT al momento della comunicazione (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_rls_anagrafe.ragione_sociale        is 'SNAPSHOT al momento della comunicazione (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_rlst_pratiche.ragione_sociale       is 'SNAPSHOT al momento della richiesta (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_visite_richieste.ragione_sociale    is 'SNAPSHOT al momento della richiesta (regola d''oro 7). Fa fede imprese per l''anagrafica corrente.';
comment on column public.s_portale_ricezioni.ragione_sociale   is 'DATO GREZZO come compilato nel modulo del portale: non è l''anagrafica.';
comment on column public.s_nomine.persona_txt   is 'NOMINATIVO COM''ERA SCRITTO nella fonte (storico Access): si conserva anche quando persona_id è valorizzato.';
comment on column public.s_nomine.impresa_txt   is 'NOME COM''ERA SCRITTO nella fonte (storico Access): si conserva anche quando impresa_id è valorizzato.';
comment on column public.s_corsi.impresa_txt    is 'NOME COM''ERA SCRITTO nella fonte: si conserva anche quando impresa_id è valorizzato.';
comment on column public.s_corsi_iscritti.impresa_txt is 'SNAPSHOT: impresa dell''iscritto al momento del corso (regola d''oro 7, deciso 01/09/2026). L''attestato mostra questa, non l''impresa attuale.';
comment on column public.s_doc_tecnico.persona_txt is 'NOMINATIVO COM''ERA SCRITTO nella fonte: si conserva anche quando tecnico_id è valorizzato.';
-- F8: a_pratica congelata, nessuna colonna nuova
comment on table public.a_pratica is 'CONGELATA il 05/09/2026 (analisi DB): 125 colonne, 25 mai valorizzate. Nessuna colonna nuova: le prossime cose vanno in tabelle figlie 1:1 (es. a_pratica_commissione, a_pratica_rdv) lette con select(''*, a_pratica_rdv(*)'').';
