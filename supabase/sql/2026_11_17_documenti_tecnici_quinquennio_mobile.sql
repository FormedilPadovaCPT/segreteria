-- Documenti dei tecnici: aggiornamento del coordinatore a quinquennio mobile (17/11/2026, sera).
-- Accordo 59/CSR del 17/04/2025, Parte III, e FAQ di Ministero (27/03/2026, n. 8) e Regione
-- Veneto: trascorsi cinque anni dall'abilitazione, all'atto dell'incarico servono 40 ore nel
-- quinquennio antecedente; l'aggiornamento tardivo rimette in regola, ma dopo 10 anni senza
-- aggiornamenti il titolo decade e si rifà il corso da 120 ore. Fonti nel vault:
-- 3_RISORSE/Normativa/2026_11_17_REL_Area-Sicurezza_aggiornamento-coordinatori-e-formatori-regole-e-fonti.md
-- Sostituisce, per il coordinatore, i periodi fissi con recupero della migrazione
-- 2026_11_17_documenti_tecnici_ore_aggiornamenti.sql (mai andata online nel codice).

alter table public.s_doc_requisito
  add column if not exists periodo_mobile boolean not null default false,
  add column if not exists decadenza_mesi int;

comment on column public.s_doc_requisito.periodo_mobile is 'ore contate negli ultimi durata_mesi a ogni data (quinquennio mobile), dopo i primi durata_mesi dall''abilitazione';
comment on column public.s_doc_requisito.decadenza_mesi is 'mesi senza nessun aggiornamento dopo i quali il titolo decade e va rifatto il corso abilitante';

update public.s_doc_requisito
   set periodo_mobile = true, decadenza_mesi = 120, recupero_ore = false
 where codice = 'agg_coordinatore';
