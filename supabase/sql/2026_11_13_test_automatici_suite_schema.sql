-- 13/11/2026 — APPLICATA lo stesso giorno (migrazione test_automatici_suite_schema_2026_11_13).
-- Quarta suite, «schema»: il giro notturno che deposita lo schema del database su Drive
-- (gestionale-visite/.github/workflows/schema-db.yml) scrive qui il suo verdetto.
-- Rieseguibile.
alter table public.s_test_automatici drop constraint if exists s_test_automatici_suite_check;
alter table public.s_test_automatici add constraint s_test_automatici_suite_check
  check (suite = any (array['database'::text, 'browser'::text, 'backup'::text, 'schema'::text]));
comment on table public.s_test_automatici is
  'Verdetti dei giri automatici su GitHub: suite database (lunedì), browser (feriali e dopo ogni pubblicazione), backup (ogni notte, dal 13/11/2026; passati = MB del file su Drive), schema (ogni notte, dal 13/11/2026; passati = KB dello schema depositato in _SISTEMA/schema_db). Nessuna riga da troppo tempo vale come un fallimento.';
