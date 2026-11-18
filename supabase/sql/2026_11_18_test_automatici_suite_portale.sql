-- (18/11/2026) quinta suite dei test automatici: «portale», scritta da
-- prove-moduli.yml del repository servizi. Ogni modulo del portale si apre, si
-- compila e la richiesta deve partire (cassetta finta). Il cruscotto della
-- segreteria la mostra accanto alle altre (js/home.js, SUITE).
alter table public.s_test_automatici drop constraint if exists s_test_automatici_suite_check;
alter table public.s_test_automatici add constraint s_test_automatici_suite_check
  check (suite in ('database', 'browser', 'backup', 'schema', 'portale'));
comment on constraint s_test_automatici_suite_check on public.s_test_automatici is
  'portale (18/11/2026): prove-moduli.yml del portale servizi, ogni modulo apre, compila e fa partire la richiesta.';
