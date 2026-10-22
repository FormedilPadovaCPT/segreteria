-- Richiesta di permesso per VISITA MEDICA (22/10/2026, chiesto dall'utente dopo la ricerca RSU).
-- CCNL Formazione Professionale 2024-2027, art. 45 c.4 (pag. 52 del testo ufficiale in
-- 3_RISORSE/Normativa): permesso retribuito per visite ed esami prescritti dal SSN o in struttura
-- convenzionata che non si possono fare fuori orario, per il tempo necessario e il viaggio; oltre le
-- 18 ore annue si recupera come i permessi brevi (c.3). Contatore a parte: non tocca il tetto di
-- 36 ore del c.1 né la banca ore.
--
-- Il tipo «visita_medica» e il monte «visite_mediche» non hanno bisogno di niente: tipo e monte di
-- s_ferie_richieste non hanno vincoli. Serve solo la fotografia della dichiarazione e del contatore,
-- che leggono anche Direttore e Amministrazione (non leggono le tabelle delle presenze), come
-- saldo_foto (20/10/2026) e banca_righe (19/10/2026).
-- {per_se, ssn, fuori_orario_no, urgente, anno, tettoMin, usateMin, residuoMin, chiestaMin,
--  dentroMin, oltreMin, dopoMin, al}
alter table public.s_ferie_richieste add column if not exists visita_foto jsonb;
comment on column public.s_ferie_richieste.visita_foto is
  'Permesso per visita medica (art. 45 c.4 CCNL FP): dichiarazione del dipendente e contatore delle 18 ore annue, fotografati alla creazione e all''invio al Direttore.';
