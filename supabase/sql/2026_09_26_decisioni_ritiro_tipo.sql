-- 26/09/2026 — Registro s_decisioni: PERCHÉ una questione esce dal registro.
--
-- «Scarta» e «Ritira» avevano solo un motivo libero, e il second brain non poteva
-- capire se la task andava chiusa («già risolta») o tenuta aperta («non la mostro
-- al Direttore»). Il 25/09 le due cose sono state mescolate: dieci proposte
-- scartate, quasi tutte con «già risolto», e una («esiste già…») che era un doppione.
-- Ora il tipo si sceglie, e il giro che allinea le task lo legge.
--
--   risolta       la cosa è già stata fatta o decisa: la task del vault si chiude
--   non_mostrare  la task resta, ma non è materia per il Direttore
--   doppione      c'è già un'altra questione per la stessa task
--   task_chiusa   l'ha ritirata il second brain perché la task è stata chiusa nel vault

alter table public.s_decisioni add column if not exists ritiro_tipo text;
alter table public.s_decisioni drop constraint if exists s_decisioni_ritiro_tipo_chk;
alter table public.s_decisioni add constraint s_decisioni_ritiro_tipo_chk
  check (ritiro_tipo is null or ritiro_tipo in ('risolta', 'non_mostrare', 'doppione', 'task_chiusa'));

comment on column public.s_decisioni.ritiro_tipo is
  'Perché è uscita dal registro: risolta (la task del vault si chiude) | non_mostrare (la task resta) | doppione | task_chiusa (ritirata dal second brain). Solo con stato ritirata.';

-- le dieci ritirate del 25/09: nove «già risolta / decisione già presa», una doppione
update public.s_decisioni set ritiro_tipo = 'doppione'
 where stato = 'ritirata' and ritiro_tipo is null and ritirata_motivo ilike 'esiste già%';
update public.s_decisioni set ritiro_tipo = 'risolta'
 where stato = 'ritirata' and ritiro_tipo is null;
