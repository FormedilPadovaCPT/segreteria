-- Test: il ricalcolo dell'IPC scatta una volta per istruzione, non per riga.
-- Contesto: fino al 05/09/2026 il trigger su visite_checklist era FOR EACH ROW e
-- salvare un verbale (delete + insert di ~52 righe) produceva ~52 UPDATE sulla
-- stessa riga di visite, ognuno con la sua riga di audit. Ora i trigger sono
-- FOR EACH STATEMENT con transition table (migrazione
-- ipc_trigger_per_istruzione_e_audit_senza_updated_at).
--
-- Il test prende la visita con più righe di checklist, la cancella e la
-- reinserisce come fa il gestionale, e verifica che:
--   1. i cinque campi IPC di visite siano identici a prima;
--   2. visite abbia ricevuto al massimo 2 UPDATE (uno per il delete, uno per l'insert);
--   3. l'audit di visite non abbia registrato righe (cambiava solo updated_at).
-- Tutto dentro una transazione annullata alla fine.

begin;

create temp table t_cnt(n int) on commit drop;
create function pg_temp.cnt_upd() returns trigger language plpgsql as $c$
begin insert into t_cnt values (1); return null; end $c$;
create trigger zz_test_cnt after update on public.visite for each row execute function pg_temp.cnt_upd();

do $$
declare
  v_vid text; b record; a record;
  n_rows int; n_upd int; n_audit_prima int; n_audit_dopo int;
begin
  select visita_id into v_vid from public.visite_checklist group by visita_id order by count(*) desc limit 1;
  if v_vid is null then raise exception 'nessuna riga in visite_checklist'; end if;

  select ipc, ipc_nc_plus, ipc_nc_minus, ipc_oss, esito_osserv into b from public.visite where visita_id = v_vid;
  create temp table t_chk on commit drop as select * from public.visite_checklist where visita_id = v_vid;
  select count(*) into n_rows from t_chk;
  select count(*) into n_audit_prima from public.visite_audit where visita_id = v_vid;

  delete from public.visite_checklist where visita_id = v_vid;
  insert into public.visite_checklist select * from t_chk;

  select ipc, ipc_nc_plus, ipc_nc_minus, ipc_oss, esito_osserv into a from public.visite where visita_id = v_vid;
  select count(*) into n_upd from t_cnt;
  select count(*) into n_audit_dopo from public.visite_audit where visita_id = v_vid;

  if a is distinct from b then
    raise exception 'IPC cambiato dopo il reinserimento: prima % dopo % (visita %)', b, a, v_vid;
  end if;
  if n_upd > 2 then
    raise exception 'visite ha ricevuto % UPDATE per % righe di checklist: il trigger lavora ancora per riga (visita %)', n_upd, n_rows, v_vid;
  end if;
  if n_audit_dopo > n_audit_prima then
    raise exception 'l''audit di visite ha registrato % righe per un salvataggio che non cambia nulla (visita %)', n_audit_dopo - n_audit_prima, v_vid;
  end if;

  raise notice 'OK ipc per istruzione: visita % (% righe checklist), % update su visite, 0 righe di audit', v_vid, n_rows, n_upd;
end $$;

rollback;
