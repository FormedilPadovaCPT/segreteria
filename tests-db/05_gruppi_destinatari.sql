-- Test dei gruppi di destinatari del protocollo (s_gruppi_destinatari +
-- s_gruppo_destinatari): un gruppo è «chi ha oggi la nomina», e la funzione
-- non deve essere chiamabile con la chiave pubblica.
-- Sola lettura; la transazione viene comunque annullata.
begin;

do $$
declare n int;
begin
  assert (select count(*) from public.s_gruppi_destinatari where attivo
           and codice in ('tecnici', 'asseveratori', 'commissione_sicurezza')) = 3,
    'i tre gruppi del 16/09/2026 esistono e sono attivi';

  assert not has_function_privilege('anon', 'public.s_gruppo_destinatari(text)', 'execute'),
    's_gruppo_destinatari non e'' eseguibile da anon';

  -- una nomina chiusa esce dal gruppo: Canova (TECNICO CPT PADOVA chiusa al 15/09/2026)
  select count(*) into n from public.s_gruppo_destinatari('tecnici') where nominativo ilike 'canova%';
  assert n = 0, 'Canova non e'' piu'' nel gruppo tecnici';

  -- ogni membro ha al piu' una riga, e i tecnici usano l'indirizzo istituzionale
  select count(*) into n from (
    select persona_id from public.s_gruppo_destinatari('tecnici') group by persona_id having count(*) > 1) d;
  assert n = 0, 'una riga per persona';
  select count(*) into n from public.s_gruppo_destinatari('tecnici')
   where fonte = 'tecnici' and email not ilike '%@did.formedilpadova.it';
  assert n = 0, 'l''indirizzo preso dalla tabella tecnici e'' quello istituzionale';

  -- un codice che non esiste non restituisce nessuno, e non da' errore
  assert (select count(*) from public.s_gruppo_destinatari('non_esiste')) = 0, 'gruppo inesistente = vuoto';

  raise notice 'OK gruppi di destinatari';
end $$;

rollback;
