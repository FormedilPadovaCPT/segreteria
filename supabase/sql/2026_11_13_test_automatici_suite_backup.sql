-- 13/11/2026 — APPLICATA lo stesso giorno (migrazione test_automatici_suite_backup_2026_11_13).
-- Il backup notturno scrive il suo verdetto accanto a quelli dei test (suite «backup»),
-- così il cruscotto della segreteria vede anche il suo silenzio. Lo scrive l'ultimo
-- passo di gestionale-visite/.github/workflows/backup-db.yml.
-- Rieseguibile.
alter table public.s_test_automatici drop constraint if exists s_test_automatici_suite_check;
alter table public.s_test_automatici add constraint s_test_automatici_suite_check
  check (suite = any (array['database'::text, 'browser'::text, 'backup'::text]));
comment on table public.s_test_automatici is
  'Verdetti dei giri automatici su GitHub: suite database (lunedì), browser (feriali e dopo ogni pubblicazione), backup (ogni notte, dal 13/11/2026; passati = MB del file caricato su Drive). Nessuna riga da troppo tempo vale come un fallimento.';
