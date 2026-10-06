-- Test della riapertura di un verbale definitivo (gestionale, 06/10/2026: 2026_10_06_riapri_verbale.sql).
--   · senza motivo non si riapre; una bozza non si riapre;
--   · riaperto: torna «bozza» e la riapertura resta scritta col motivo;
--   · richiuso con chiudi_verbale: torna «definitivo» e la riapertura è segnata come richiusa.
-- Nota: riapri_verbale lascia passare session_user = 'postgres', quindi il rifiuto a chi non è segreteria da qui non
-- si prova (lo stesso limite di fondi_imprese); lo controlla la funzione con is_segreteria().
-- Tutto dentro una transazione annullata: non resta nessuna riga (e nessuna notifica parte).
begin;

do $$
declare vid text; r jsonb; ok boolean; msg text;
begin
  select visita_id into vid from public.visite
   where stato = 'definitivo' and coalesce(elimina, 0) = 0 and jsonb_array_length(public.verbale_mancanze(visita_id)) = 0
   order by data_visita desc limit 1;
  assert vid is not null, 'serve un verbale definitivo completo';

  ok := false; msg := null;
  begin perform public.riapri_verbale(vid, ''); exception when others then msg := sqlerrm; ok := msg like 'Scrivi%'; end;
  assert ok, 'senza motivo non si riapre: ' || coalesce(msg, '(nessun errore)');

  r := public.riapri_verbale(vid, 'Manca il CSE: correggi e richiudi');
  assert (r ->> 'ok')::boolean, 'riaperto';
  assert (select stato from public.visite where visita_id = vid) = 'bozza', 'torna in bozza';
  assert exists (select 1 from public.visite_riaperture where visita_id = vid and richiuso_il is null and motivo like 'Manca il CSE%'), 'la riapertura è scritta col motivo';

  ok := false; msg := null;
  begin perform public.riapri_verbale(vid, 'di nuovo'); exception when others then msg := sqlerrm; ok := msg like '%non è definitivo%'; end;
  assert ok, 'una bozza non si riapre: ' || coalesce(msg, '(nessun errore)');

  r := public.chiudi_verbale(vid);
  assert (r ->> 'ok')::boolean, 'si richiude: ' || r::text;
  assert (select stato from public.visite where visita_id = vid) = 'definitivo', 'torna definitivo';
  assert not exists (select 1 from public.visite_riaperture where visita_id = vid and richiuso_il is null), 'la riapertura è chiusa';

  assert not has_function_privilege('anon', 'public.riapri_verbale(text,text)', 'EXECUTE'), 'anon non riapre';
  assert not has_table_privilege('authenticated', 'public.visite_riaperture', 'INSERT'), 'le riaperture le scrive solo la funzione';
end $$;

select 'ok — riapertura dei verbali definitivi' as esito;
rollback;
