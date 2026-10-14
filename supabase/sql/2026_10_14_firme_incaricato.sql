-- ============================================================
-- LA LETTERA DI INCARICO PASSA AL TECNICO PER ACCETTAZIONE
-- (14/10/2026, chiesto dall'utente: «queste due lettere di incarico, una
-- volta firmate, dovrebbero passare alla firma del docente, in questo caso
-- a Nicola De Marco»)
--
-- Un ruolo nuovo nella catena delle firme: `incaricato`, il tecnico a cui
-- è rivolta la lettera di incarico dell'asseverazione, che firma «per
-- accettazione» nel riquadro sotto il suo nome, dopo il Presidente. Firma
-- dal gestionale (pagina Formazione, «Le mie firme») con il suo accesso;
-- la RLS di s_firme gli dà già le righe col suo indirizzo.
-- Gli osservatori di altri enti, senza accesso alle app, restano su carta.
-- ============================================================
alter table public.s_firme drop constraint if exists s_firme_ruolo_check;
alter table public.s_firme add constraint s_firme_ruolo_check
  check (firmatario_ruolo in ('presidente', 'direttore', 'rpf', 'docente', 'incaricato'));
comment on column public.s_firme.firmatario_ruolo is
  'Chi firma: presidente, direttore, rpf (responsabile del progetto formativo), docente (dei corsi), incaricato (il tecnico destinatario della lettera di incarico, per accettazione: 14/10/2026).';
