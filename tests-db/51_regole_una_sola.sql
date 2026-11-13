-- Test: le regole scritte sia nel database sia nel gestionale sono ancora quelle (13/11/2026).
--
-- L'IPC e l'elenco delle tipologie di visita che chiedono un incarico sono scritti nel
-- database E nel codice del gestionale. Dalla parte del gestionale le copie sono confrontate
-- da test/ipc-una-regola.test.cjs e test/tipologie-incarico-una-regola.test.cjs, che portano
-- la regola ricopiata dal database. Questo test è l'altra metà: se qualcuno cambia la
-- funzione nel database, fallisce qui, e chi la cambia sa che deve cambiarla anche là.
--
-- Non esegue le funzioni: ne legge il testo. Non scrive niente.
begin;
do $$
declare
  src text;
  norm text;
begin
  -- 1. IPC: public.calcola_ipc
  select lower(regexp_replace(p.prosrc, '\s+', ' ', 'g')) into norm
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'calcola_ipc';
  if norm is null then raise exception 'calcola_ipc non esiste più'; end if;
  if position('v_nc_plus >= 1 or v_nc_minus > 3' in norm) = 0 then
    raise exception 'IPC ALTO: la soglia nel database è cambiata (attesa: NC+ >= 1 oppure NC- > 3). Va cambiata anche nel gestionale: test/ipc-una-regola.test.cjs';
  end if;
  if position('v_oss > 6 or (v_nc_minus >= 1 and v_nc_minus <= 3)' in norm) = 0 then
    raise exception 'IPC MEDIO: la soglia nel database è cambiata (attesa: OSS > 6 oppure NC- fra 1 e 3). Va cambiata anche nel gestionale';
  end if;
  if position('v_oss >= 1 and v_oss <= 6' in norm) = 0 then
    raise exception 'IPC BASSO: la soglia nel database è cambiata (attesa: OSS fra 1 e 6). Va cambiata anche nel gestionale';
  end if;

  -- 2. tipologie che chiedono un incarico: public.verbale_mancanze
  select regexp_replace(lower(p.prosrc), '\s+', '', 'g') into src
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'verbale_mancanze';
  if src is null then raise exception 'verbale_mancanze non esiste più'; end if;
  if position('tipo_accessoin(1,6,8,9,11,12)' in src) = 0 then
    raise exception 'Tipologie con incarico: l''elenco nel database è cambiato (atteso 1,6,8,9,11,12). Va cambiato anche TIPI_CON_INCARICO in gestionale-visite/index.html';
  end if;
end $$;
rollback;
