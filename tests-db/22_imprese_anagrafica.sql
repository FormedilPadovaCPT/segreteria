-- Test dell'anagrafica imprese della segreteria (gestionale, 06/10/2026: 2026_10_06_imprese_anagrafica.sql).
--   · piva_valida: cifra di controllo e ufficio delle Entrate (la P.IVA sbagliata di Edil Tognetto supera la cifra);
--   · imprese_elenco e imprese_doppioni rispondono, coi conteggi coerenti;
--   · imprese_unisci rifiuta un valore che nessuna scheda ha, e il valore sostituito resta nelle note;
--   · impresa_elimina rifiuta una scheda con verbali, ed elimina una scheda senza niente lasciandone la copia.
-- Nota: s_unioni_autorizzato() lascia passare session_user = 'postgres', quindi il rifiuto a chi non è
-- segreteria da qui non si prova (vale lo stesso limite di fondi_imprese).
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

do $$
declare r jsonb; ok boolean; msg text; ia text; ib text; vuota text; x text;
begin
  assert public.piva_valida('02524300239') is true, 'P.IVA valida';
  assert public.piva_valida('IT02524300239') is true, 'con IT davanti';
  assert public.piva_valida('50005111716') is false, 'ufficio 171: non esiste';
  assert public.piva_valida('02524000239') is false, 'una cifra sbagliata';
  assert public.piva_valida('1234') is null, 'non 11 cifre: non si giudica';
  assert public.impresa_nome_norm('Edil Tognetto S.r.l.') = public.impresa_nome_norm('EDIL TOGNETTO SRL'), 'il nome si confronta senza forma giuridica';

  r := public.imprese_elenco(null, 'verbali', true, null, 5, 0);
  assert (r ->> 'totale')::int > 1000 and jsonb_array_length(r -> 'righe') = 5, 'l''elenco risponde a pagine';
  assert ((r -> 'righe' -> 0 ->> 'verbali')::int >= (r -> 'righe' -> 4 ->> 'verbali')::int), 'ordinato per collegamenti';
  r := public.imprese_elenco(null, 'nome', false, 'piva_non_valida', 500, 0);
  assert not exists (select 1 from jsonb_array_elements(r -> 'righe') e where public.piva_valida(e ->> 'piva') is true), 'il filtro non mostra P.IVA valide';

  r := public.imprese_doppioni(null, 5, 0);
  assert (select sum(value::int) from jsonb_each_text(r -> 'conteggi')) = (r ->> 'totale')::int, 'i conteggi per livello fanno il totale';

  -- unione: un gruppo vero, valore inventato rifiutato prima di toccare qualcosa
  r := public.imprese_doppioni(3, 1, 0);
  ia := r -> 'gruppi' -> 0 -> 'membri' -> 0 ->> 'impresa_id';
  ib := r -> 'gruppi' -> 0 -> 'membri' -> 1 ->> 'impresa_id';
  assert ia is not null and ib is not null, 'serve un gruppo di prova';
  ok := false;
  begin
    perform public.imprese_unisci(ia, array[ib], '{"piva":"99999999999"}');
  exception when others then msg := sqlerrm; ok := msg like '%non è di nessuna delle schede%';
  end;
  assert ok, 'un valore che nessuna scheda ha va rifiutato: ' || coalesce(msg, '(nessun errore)');
  assert (select elimina from imprese where impresa_id = ib) = 0, 'dopo il rifiuto non è cambiato niente';
  select btrim(impresa_nome) || ' (prova)' into x from imprese where impresa_id = ib;
  update imprese set impresa_nome = x where impresa_id = ib;
  r := public.imprese_unisci(ia, array[ib], jsonb_build_object('impresa_nome', x));
  assert (r ->> 'ok')::boolean and (select elimina from imprese where impresa_id = ib) = 1, 'unite: il doppione è archiviato';
  assert (select impresa_nome from imprese where impresa_id = ia) = x, 'il valore scelto è sulla principale';
  assert (select note_access from imprese where impresa_id = ia) like '%ragione sociale prima dell''unione%', 'il valore sostituito resta nelle note';

  -- eliminazione: con verbali no, senza il perché no, senza niente sì, con la copia
  ok := false; msg := null;
  begin
    perform public.impresa_elimina((select i.impresa_id from imprese i where i.elimina = 0 and coalesce(btrim(i.cod_ceiv), '') = ''
                                      and exists (select 1 from visite v where v.impresa_id = i.impresa_id) limit 1), 'prova');
  exception when others then msg := sqlerrm; ok := msg like 'Non si elimina: ha collegati%';
  end;
  assert ok, 'una scheda con verbali non si elimina: ' || coalesce(msg, '(nessun errore)');
  for x in select i.impresa_id from imprese i
            where i.elimina = 0 and coalesce(btrim(i.cod_ceiv), '') = ''
              and not exists (select 1 from visite v where v.impresa_id = i.impresa_id)
              and not exists (select 1 from visite_imprese_presenti p where p.impresa_id = i.impresa_id)
              and not exists (select 1 from persone_imprese p where p.impresa_id = i.impresa_id)
            limit 400
  loop
    if (select verbali + persone + altro from public.imprese_collegamenti(array[x])) = 0 then vuota := x; exit; end if;
  end loop;
  assert vuota is not null, 'serve una scheda senza collegamenti';
  ok := false; msg := null;
  begin
    perform public.impresa_elimina(vuota, '');
  exception when others then msg := sqlerrm; ok := msg like 'Scrivi perché%';
  end;
  assert ok, 'senza il perché non si elimina';
  r := public.impresa_elimina(vuota, 'prova annullata');
  assert (r ->> 'ok')::boolean and not exists (select 1 from imprese where impresa_id = vuota), 'eliminata';
  assert exists (select 1 from archivio.imprese_eliminate where impresa_id = vuota and motivo = 'prova annullata'), 'la copia in archivio c''è';

  r := public.imprese_doppioni_diverse(array[ia, 'zz-prova']);
  assert exists (select 1 from imprese_doppioni_decisioni d where d.a = least(ia, 'zz-prova') and d.b = greatest(ia, 'zz-prova')), 'la decisione «non sono doppioni» è scritta';

  assert not has_function_privilege('anon', 'public.impresa_elimina(text,text)', 'EXECUTE'), 'anon non elimina';
  assert not has_function_privilege('anon', 'public.imprese_unisci(text,text[],jsonb)', 'EXECUTE'), 'anon non unisce';
  assert not has_table_privilege('authenticated', 'archivio.imprese_eliminate', 'SELECT'), 'l''archivio non si legge dall''app';
  assert not has_table_privilege('authenticated', 'public.imprese_doppioni_decisioni', 'INSERT'), 'le decisioni si scrivono solo dalla funzione';
end $$;

select 'ok — anagrafica imprese' as esito;
rollback;
