-- ============================================================================
-- 2026_10_14 — Programma 5.D.3 e piano 5.D.4 passano dal Direttore
--
-- Chiesto dall'utente il 14/10/2026: i documenti dell'asseverazione che escono
-- a firma del Direttore li approva lui nell'app, poi la segreteria protocolla
-- e invia all'impresa e all'RGV. Dal 12/10 valeva per il solo preventivo
-- 5.D.2; ora anche per programma e piano, stessa tabella, tipi nuovi.
-- ============================================================================
alter table public.s_approvazioni_direttore drop constraint if exists s_approvazioni_direttore_tipo_check;
alter table public.s_approvazioni_direttore add constraint s_approvazioni_direttore_tipo_check
  check (tipo in ('preventivo_assev', 'programma_assev', 'piano_assev'));
comment on column public.s_approvazioni_direttore.tipo is
  'preventivo_assev (5.D.2, dal 12/10/2026) | programma_assev (5.D.3) | piano_assev (5.D.4), dal 14/10/2026: i documenti dell''asseverazione che escono a firma del Direttore e prendono numero, timbro e firma solo dopo la sua approvazione. rif = id della pratica.';
