-- 18/11/2026 — Documenti dei tecnici: data da cui decorre l'obbligo di
-- aggiornamento per chi ha l'attestato da prima della norma.
--
-- Coordinatore: Allegato XIV del D.Lgs. 81/2008, «Per coloro che hanno
-- conseguito l'attestato prima dell'entrata in vigore del presente decreto,
-- l'obbligo di aggiornamento decorre dalla data di entrata in vigore del
-- medesimo decreto» (15/05/2008). Caso che l'ha fatto emergere: Balladore,
-- corso 120 ore del 10/10/1997, dato «decaduto dal 10/10/2007» perché i dieci
-- anni si contavano dal corso. Il calcolo è in segreteria-app/js/doc-tecnici-ore.js
-- (statoMobile) e nella copia generata del gestionale (crediti-ore.js):
-- i primi cinque anni e i dieci anni partono dalla data più recente fra il
-- corso e questa; le ore si contano comunque dal corso.

alter table public.s_doc_requisito
  add column if not exists aggiornamento_dal date;

comment on column public.s_doc_requisito.aggiornamento_dal is
  'Data da cui decorre l''obbligo di aggiornamento per chi ha l''attestato di base da prima (coordinatore: 15/05/2008, Allegato XIV D.Lgs. 81/2008). Vuota = dal corso.';

update public.s_doc_requisito
   set aggiornamento_dal = date '2008-05-15'
 where codice = 'agg_coordinatore';
