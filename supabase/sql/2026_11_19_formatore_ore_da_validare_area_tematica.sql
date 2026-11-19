-- 19/11/2026 - Ore del formatore «da validare per area tematica».
-- Risposta di FORMEDIL Italia (ing. Sonno, Prot_26-27_0165, punto 2): un corso
-- di aggiornamento per coordinatori vale anche per il formatore solo se rispetta
-- direttamente il D.I. 6/3/2013 (contenuti dell'area tematica del formatore,
-- organizzato da un soggetto dell'art. 32 c. 4, partecipazione documentata) e
-- si riconoscono solo le ore pertinenti. Nella ricostruzione del 17/11 gli
-- stessi corsi erano stati contati con tutte le ore per tutti e due i requisiti.
-- Scelta dell'utente del 19/11/2026: le ore restano contate, ma si vedono come
-- «da validare» finché la segreteria (o il responsabile scientifico) non le
-- conferma o le riduce riga per riga.

alter table public.s_doc_requisito
  add column if not exists verifica_area boolean not null default false;
comment on column public.s_doc_requisito.verifica_area is
  'Le righe di aggiornamento possono essere segnate «da validare per area tematica» (formatore, D.I. 6/3/2013; FORMEDIL Italia Prot_26-27_0165)';
update public.s_doc_requisito set verifica_area = true where codice = 'formatori';

alter table public.s_doc_tecnico
  add column if not exists area_da_validare boolean not null default false;
comment on column public.s_doc_tecnico.area_da_validare is
  'true = ore contate ma da validare: area tematica del formatore e soggetto dell''art. 32 c. 4 non ancora controllati (19/11/2026)';

-- i corsi del formatore che sono anche fra gli aggiornamenti da coordinatore
-- dello stesso tecnico, con la stessa data
update public.s_doc_tecnico f
   set area_da_validare = true
  from public.s_doc_requisito rf
 where rf.id = f.requisito_id and rf.codice = 'formatori'
   and f.tipo = 'aggiornamento'
   and exists (
     select 1 from public.s_doc_tecnico c
       join public.s_doc_requisito rc on rc.id = c.requisito_id and rc.codice = 'agg_coordinatore'
      where c.tecnico_id = f.tecnico_id and c.data_inizio = f.data_inizio and c.tipo = 'aggiornamento');
