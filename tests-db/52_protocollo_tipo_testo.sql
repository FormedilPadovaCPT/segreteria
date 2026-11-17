-- Test del trigger s_protocollo_tipo_txt (17/11/2026): il testo del tipo di
-- documento si riempie dal codice, e i testi scritti a mano restano.
-- Tutto dentro una transazione che viene annullata: non resta nulla.
-- Si esegue con:  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests-db/52_protocollo_tipo_testo.sql
-- Senza il trigger fallisce il primo caso (testo vuoto): verificato il 17/11 sui
-- Prot_26-27_0146 e 0147, creati prima del trigger col solo codice.
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000000"}', true);

do $$
declare
  r1 public.s_protocollo; r2 public.s_protocollo; r3 public.s_protocollo;
  v_33 text; v_19 text;
begin
  select descrizione into v_33 from public.s_tipo_doc where id_doc = 33;
  select descrizione into v_19 from public.s_tipo_doc where id_doc = 19;

  -- 1. solo il codice: il testo viene dal catalogo
  r1 := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'oggetto', 'TEST automatico', 'tipo_doc_id', '33'));
  assert (select tipo_doc_txt from public.s_protocollo where id = r1.id) = v_33,
    'solo codice 33: atteso «' || v_33 || '»';

  -- 2. testo scritto a mano, diverso dal catalogo: resta
  r2 := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'oggetto', 'TEST automatico', 'tipo_doc_id', '16', 'tipo_doc_txt', 'Comunicazione'));
  assert (select tipo_doc_txt from public.s_protocollo where id = r2.id) = 'Comunicazione',
    'testo a mano: doveva restare «Comunicazione»';

  -- 3. si cambia il codice e il testo era quello del catalogo: segue il nuovo codice
  update public.s_protocollo set tipo_doc_id = 19 where id = r1.id;
  assert (select tipo_doc_txt from public.s_protocollo where id = r1.id) = v_19,
    'cambio codice 33 -> 19: atteso «' || v_19 || '»';

  -- 4. si cambia il codice ma il testo era scritto a mano: resta
  update public.s_protocollo set tipo_doc_id = 19 where id = r2.id;
  assert (select tipo_doc_txt from public.s_protocollo where id = r2.id) = 'Comunicazione',
    'cambio codice con testo a mano: doveva restare «Comunicazione»';

  -- 5. solo il testo, senza codice: resta
  r3 := public.s_crea_protocollo(jsonb_build_object('direzione', 'OUT', 'oggetto', 'TEST automatico', 'tipo_doc_txt', 'Lettera di affiancamento'));
  assert (select tipo_doc_txt from public.s_protocollo where id = r3.id) = 'Lettera di affiancamento',
    'solo testo: doveva restare «Lettera di affiancamento»';

  raise notice 'protocollo_tipo_testo: 5 casi su 5';
end $$;

rollback;
