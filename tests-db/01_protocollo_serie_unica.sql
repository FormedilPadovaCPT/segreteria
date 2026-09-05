-- Test del registro di protocollo: fino al 30/09/2026 due contatori (IN e OUT),
-- dal 01/10/2026 (s_config.protocollo_serie_unica_dal) un solo contatore per
-- esercizio. Tutto dentro una transazione che viene annullata: non resta nulla.
-- Si esegue con:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests-db/01_protocollo_serie_unica.sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000000"}', true);

do $$
declare
  r1 public.s_protocollo; r2 public.s_protocollo; r3 public.s_protocollo; r4 public.s_protocollo;
  v_in int; v_out int; v_dal date;
begin
  select valore::date into v_dal from public.s_config where chiave = 'protocollo_serie_unica_dal';
  assert v_dal = date '2026-10-01', 'la data del passaggio alla serie unica non e'' piu'' il 01/10/2026: ' || coalesce(v_dal::text, 'null');

  select max(numero) into v_in  from public.s_protocollo where esercizio is null and direzione = 'IN';
  select max(numero) into v_out from public.s_protocollo where esercizio is null and direzione = 'OUT';

  -- il giorno prima del passaggio: i due registri ereditati da Access
  r1 := public.s_crea_protocollo(jsonb_build_object('direzione', 'IN',  'data_prot', v_dal - 1, 'oggetto', 'TEST automatico'));
  r2 := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'data_prot', v_dal - 1, 'oggetto', 'TEST automatico'));
  assert r1.esercizio is null and r1.numero = v_in + 1,  'IN storico: atteso ' || (v_in + 1) || ', trovato ' || r1.numero;
  assert r2.esercizio is null and r2.numero = v_out + 1, 'OUT storico: atteso ' || (v_out + 1) || ', trovato ' || r2.numero;

  -- dal passaggio: entrata e uscita pescano dallo stesso contatore dell'esercizio
  r3 := public.s_crea_protocollo(jsonb_build_object('direzione', 'IN',  'data_prot', v_dal,     'oggetto', 'TEST automatico'));
  r4 := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'data_prot', v_dal + 1, 'oggetto', 'TEST automatico'));
  assert r3.esercizio = public.s_esercizio(v_dal) and r3.numero = 1,
    'serie unica, primo numero: ' || coalesce(r3.esercizio, 'null') || '/' || r3.numero;
  assert r4.esercizio = r3.esercizio and r4.numero = 2,
    'serie unica: IN e OUT devono condividere il contatore, trovato ' || r4.numero;
  assert r3.codice = 'Prot_' || r3.esercizio || '_0001', 'codice della serie unica: ' || coalesce(r3.codice, 'null');

  -- l'esercizio dell'ente va dal 1/10 al 30/9
  assert public.s_esercizio('2026-09-30') = '25-26' and public.s_esercizio('2026-10-01') = '26-27'
     and public.s_esercizio('2027-09-30') = '26-27' and public.s_esercizio('2027-10-01') = '27-28', 's_esercizio';

  raise notice 'OK protocollo: storico % / % → serie unica %/1 e %/2', r1.numero, r2.numero, r3.esercizio, r4.esercizio;
end $$;

rollback;
