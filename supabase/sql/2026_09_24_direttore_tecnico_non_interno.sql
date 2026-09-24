-- Il direttore tecnico spesso non e' dipendente (utente, 24/09/2026): non e' piu' una
-- funzione interna, la nomina non apre il rapporto. Applicata come migrazione
-- direttore_tecnico_non_interno_2026_09_24.
update public.s_ruoli set propone_rapporto = false where id_ruolo = 41;

-- i 5 rapporti aperti in mattinata dal recupero SOLO per una nomina da direttore tecnico:
-- si annullano (erano dedotti, non documentati; la nomina resta)
delete from public.persone_imprese
 where note like 'Aperto dalle nomine interne già registrate (DIRETTORE TECNICO;%'
   and created_at::date = date '2026-09-24';

-- i 16 rapporti dell'import Access col tipo «direttore_tecnico», portati in mattinata a
-- «dipendente»: il tipo non si sa, tornano «altro / da precisare» (la nota conserva l'origine)
update public.persone_imprese set tipo_rapporto = 'altro'
 where tipo_rapporto = 'dipendente' and note like '%Tipo nell''import Access: direttore_tecnico';
