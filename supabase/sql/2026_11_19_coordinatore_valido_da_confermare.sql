-- 19/11/2026 - Coordinatore «valido da confermare» (decisione dell'utente).
-- Per i tecnici che lavorano come coordinatori e si sono sempre aggiornati, il
-- conto dell'app dava «titolo decaduto» solo perché in archivio mancano gli
-- attestati di aggiornamento più vecchi (es. Simonetto: niente dal 2008 al 2018).
-- Una riga di tipo «da_confermare» sul requisito dice: il titolo si considera
-- valido, da confermare con gli attestati mancanti, che si chiederanno più avanti.
-- Il conteggio non cambia: cambia solo come si mostra un esito «scaduto».
alter table public.s_doc_tecnico drop constraint if exists s_doc_tecnico_tipo_chk;
alter table public.s_doc_tecnico add constraint s_doc_tecnico_tipo_chk
  check (tipo is null or tipo = any (array['attestato','aggiornamento','docenza','riconoscimento','da_confermare']));
update public.s_tendine_registro
   set voci = array['attestato','aggiornamento','docenza','riconoscimento','da_confermare'], aggiornato_il = now()
 where id = 'segr.dtf-tipo';
