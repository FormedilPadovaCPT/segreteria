-- ============================================================================
-- 2026_10_14 — Il piano di verifica 5.D.4 lo compila l'RGV, e le date vanno
-- nel calendario «Direzione»
--
-- Chiesto dall'utente il 14/10/2026: protocollato e inviato il piano al
-- gruppo di verifica (impresa in copia), l'RGV rientra nel piano e ne
-- compila il dettaglio (data, sito, dalle, alle, componenti del GdV,
-- funzioni dell'impresa, attività), salva, stampa e lo fa firmare
-- all'impresa in sede. La segreteria lo vede aggiornato, e le date vanno
-- nel calendario Google «Direzione» di cptpd@did con promemoria, con l'RGV
-- invitato (deciso dall'utente lo stesso giorno: eccezione 11 alla regola
-- «l'app prepara, la persona manda»).
--
-- Gli eventi li scrive la edge function `calendario-piano`, uno per giornata,
-- ritrovati nel calendario dalla proprietà privata `pratica_piano`: le righe
-- del piano si riscrivono a ogni salvataggio e un id sulla riga si
-- perderebbe. Qui resta solo l'esito dell'ultimo allineamento.
-- ============================================================================
alter table public.a_piano_verifica
  add column if not exists calendario_il timestamptz,
  add column if not exists calendario_esito text;

comment on column public.a_piano_verifica.calendario_esito is
  'Esito dell''ultimo allineamento delle date del piano col calendario Google (funzione calendario-piano): quante giornate, chi è invitato, o perché non è riuscito.';

insert into public.s_config (chiave, valore)
values ('piano_calendario_id', 'c_cf9b7b4f739cc42753f6207d36431da4dc7521c948e2e0135aa96f85e6ce5080@group.calendar.google.com')
on conflict (chiave) do nothing;
