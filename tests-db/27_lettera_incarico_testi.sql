-- Test della coda della lettera mensile in tre parti (segreteria, 07/10/2026: 2026_10_07_lettera_incarico_testi.sql).
--   · il testo fisso non ha più il blocco ATTENZIONE né emoji, ha il punto 9 sull'account;
--   · cambiarlo lascia una riga in s_config_storia con prima, dopo e chi;
--   · l'avviso del mese è uno per mese e non può essere vuoto;
--   · le annotazioni interne non stanno più nella nota che va in lettera.
-- Tutto dentro una transazione annullata.
begin;

do $$
declare t text; n int; ok boolean; msg text;
begin
  select valore into t from public.s_config where chiave = 'incarico_visite_testo';
  assert t like 'Modalità visite e consulenze%', 'il testo fisso parte dalle modalità';
  assert t not like '%ATTENZIONE%' and t not like '%VERONESE%' and t not like '%The Builder%', 'tolto il blocco ATTENZIONE';
  assert t !~ '[\U0001F300-\U0001FAFF]', 'niente emoji: il PDF le stampava «??»';
  assert t like '%9) Comunicazioni con il CPT%nome.cognome@did.formedilpadova.it%', 'account al punto 9';

  select count(*) into n from public.s_config_storia;
  update public.s_config set valore = t || ' prova', updated_by = 'prova@test' where chiave = 'incarico_visite_testo';
  assert (select count(*) from public.s_config_storia) = n + 1, 'il cambio resta nello storico';
  assert (select cambiato_da = 'prova@test' and valore_prima = t from public.s_config_storia order by id desc limit 1), 'chi e il testo di prima';
  update public.s_config set updated_at = now() where chiave = 'incarico_visite_testo';
  assert (select count(*) from public.s_config_storia) = n + 1, 'se il testo non cambia, niente storico';

  ok := false; begin insert into public.s_incarichi_avvisi (anno, mese, testo) values (2026, 10, 'doppio'); exception when unique_violation then ok := true; end;
  assert ok, 'un avviso per mese';
  ok := false; begin insert into public.s_incarichi_avvisi (anno, mese, testo) values (2031, 1, '  '); exception when check_violation then ok := true; end;
  assert ok, 'un avviso vuoto non si salva: si cancella';
  -- (il testo dell'avviso di ottobre lo cambia la segreteria: il test non ne controlla il contenuto)

  assert not exists (select 1 from public.s_incarichi_mensili where anno = 2026 and (note ~ '^\d{2}/\d{2}/\d{4} chiuso senza attività' or note like 'Riaperto il %')),
    'le annotazioni dell''app non stanno nella nota della lettera';
  assert (select count(*) from public.s_incarichi_mensili where note_interne is not null) >= 6, 'stanno in note_interne';
  raise notice 'OK 27_lettera_incarico_testi';
end $$;

rollback;
