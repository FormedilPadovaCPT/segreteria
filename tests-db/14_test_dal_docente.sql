-- Il test scritto dal docente (19/09/2026).
-- Invito col link firmato, proposta che torna, «porta nel test» / «scarta».
-- Tutto dentro una transazione che si annulla: alla fine non resta niente.
--
-- Quello che tiene fermo, in ordine di importanza:
--   · la firma dell'invito NON è quella dell'evento (prefissi distinti);
--   · una domanda a risposta chiusa senza la risposta giusta non passa —
--     è il motivo per cui il «correttore» su un secondo file può sparire;
--   · una proposta non è il test finché qualcuno non la porta dentro;
--   · con prove già consegnate le domande non si sostituiscono;
--   · scartare vuole il motivo, e NON chiude l'invito (si scarta per far rifare);
--   · chi non è segreteria non crea inviti.
begin;

do $$
declare
  v_corso bigint; v_inv bigint; v_prop bigint; v_cod text; v_fir text;
  v_err text; v_n int; v_link text; v_dom jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('email', 'cptpd@did.formedilpadova.it', 'role', 'authenticated')::text, true);
  if not public.is_segreteria() then raise exception 'non riesco a impersonare la segreteria'; end if;

  -- un corso senza test già scritto: non si tocca niente di vero
  select c.id into v_corso from public.s_corsi c
   where not exists (select 1 from public.s_test_domande d where d.corso_id = c.id)
     and not exists (select 1 from public.s_test_prove p where p.corso_id = c.id)
   order by c.id desc limit 1;
  if v_corso is null then raise exception 'nessun corso libero su cui provare'; end if;

  -- ── l'invito ────────────────────────────────────────────────────────────
  select (public.dtest_invita(v_corso, 'Rossi Ing. Mario', 'mario@example.it')) ->> 'codice' into v_cod;
  select (public.dtest_invita(v_corso, 'Bianchi Geom. Ada')) ->> 'link' into v_link;
  if position('testdocente=' in v_link) = 0 then raise exception 'il link non porta alla pagina del docente: %', v_link; end if;
  select id into v_inv from public.s_test_inviti where codice = v_cod;

  -- ── la firma ────────────────────────────────────────────────────────────
  select public.dtest_firma(v_cod) into v_fir;
  select esito into v_err from public.dtest_verifica(v_cod || '.' || v_fir);
  if v_err <> 'agganciato' then raise exception 'firma buona respinta: %', v_err; end if;
  select esito into v_err from public.dtest_verifica(v_cod || '.0123456789ab');
  if v_err <> 'firma non valida' then raise exception 'firma falsa accettata: %', v_err; end if;
  select esito into v_err from public.dtest_verifica(v_cod);
  if v_err <> 'firma mancante' then raise exception 'accettato senza firma: %', v_err; end if;
  select esito into v_err from public.dtest_verifica('PIPPO.x');
  if v_err <> 'invito non trovato' then raise exception 'codice inventato: %', v_err; end if;
  -- ⚠️ prefissi distinti: un invito non deve aprire il questionario dell'evento
  if public.dtest_firma(v_cod) = public.quest_firma(v_cod) then
    raise exception 'la firma dell''invito coincide con quella dell''evento';
  end if;

  -- ── scadenza e revoca ───────────────────────────────────────────────────
  update public.s_test_inviti set scadenza = current_date - 1 where id = v_inv;
  select esito into v_err from public.dtest_verifica(v_cod || '.' || v_fir);
  if v_err <> 'invito scaduto' then raise exception 'invito scaduto accettato: %', v_err; end if;
  update public.s_test_inviti set scadenza = current_date + 10 where id = v_inv;
  perform public.dtest_revoca(v_inv, 'prova');
  select esito into v_err from public.dtest_verifica(v_cod || '.' || v_fir);
  if v_err <> 'invito revocato' then raise exception 'invito revocato accettato: %', v_err; end if;
  update public.s_test_inviti set stato = 'in_attesa', chiuso_il = null, chiuso_da = null where id = v_inv;

  -- ── che cosa è una domanda ben scritta ──────────────────────────────────
  if public.dtest_domande_esito('[]'::jsonb) is null then raise exception 'accetta zero domande'; end if;
  if public.dtest_domande_esito('[{"testo":"a","tipo":"scelta","opzioni":["x","y"],"corrette":[]}]'::jsonb) is null
    then raise exception 'accetta una domanda senza la risposta giusta'; end if;
  if public.dtest_domande_esito('[{"testo":"a","tipo":"scelta","opzioni":["x","y"],"corrette":["x","y"]}]'::jsonb) is null
    then raise exception 'accetta due risposte giuste su una a scelta unica'; end if;
  if public.dtest_domande_esito('[{"testo":"a","tipo":"scelta","opzioni":["x"],"corrette":["x"]}]'::jsonb) is null
    then raise exception 'accetta una domanda con una sola opzione'; end if;
  -- ⚠️ il controllo che vale più di tutti: la risposta giusta si indica col
  -- TESTO, non col numero di riga. Con gli indici il test correggerebbe ogni
  -- prova a zero, in silenzio.
  if public.dtest_domande_esito('[{"testo":"a","tipo":"scelta","opzioni":["x","y"],"corrette":[1]}]'::jsonb) is null
    then raise exception 'accetta la risposta giusta indicata con un numero'; end if;
  if public.dtest_domande_esito('[{"testo":"a","tipo":"multipla","opzioni":["x","y"],"corrette":["x","w"]}]'::jsonb) is null
    then raise exception 'accetta una risposta giusta che non è fra quelle proposte'; end if;
  if public.dtest_domande_esito('[{"testo":"a","tipo":"testo","opzioni":["x","y"]}]'::jsonb) is null
    then raise exception 'accetta opzioni su una domanda a testo libero'; end if;
  v_dom := '[{"testo":"quanto fa 2+2","tipo":"scelta","opzioni":["3","4"],"corrette":["4"],"punti":2},
             {"testo":"scegli i DPI","tipo":"multipla","opzioni":["casco","scarpe","ombrello"],"corrette":["casco","scarpe"],"punti":2},
             {"testo":"spiega con parole tue","tipo":"testo","punti":3}]'::jsonb;
  v_err := public.dtest_domande_esito(v_dom);
  if v_err is not null then raise exception 'rifiuta domande buone: %', v_err; end if;

  -- ── la proposta diventa test solo con «porta nel test» ──────────────────
  insert into public.s_test_proposte (invito_id, corso_id, nominativo, domande, fonte)
  values (v_inv, v_corso, 'Rossi Ing. Mario', v_dom, 'prova') returning id into v_prop;
  select count(*) into v_n from public.s_test_domande where corso_id = v_corso;
  if v_n <> 0 then raise exception 'la proposta è già diventata test da sola (% domande)', v_n; end if;

  perform public.dtest_accetta(v_prop, 'sostituisci');
  select count(*) into v_n from public.s_test_domande where corso_id = v_corso;
  if v_n <> 3 then raise exception 'dopo «porta nel test» ci sono % domande invece di 3', v_n; end if;
  select count(*) into v_n from public.s_test_domande
   where corso_id = v_corso and jsonb_array_length(corrette) > 0;
  if v_n <> 2 then raise exception 'le risposte giuste sono arrivate su % domande invece di 2', v_n; end if;
  select stato into v_err from public.s_test_inviti where id = v_inv;
  if v_err <> 'accettato' then raise exception 'l''invito è rimasto %', v_err; end if;

  begin
    perform public.dtest_accetta(v_prop, 'aggiungi');
    raise exception 'ha accettato due volte la stessa proposta';
  exception when others then
    if position('già stata' in SQLERRM) = 0 then raise; end if;
  end;

  -- ── «aggiungi in fondo» accoda, non cancella ────────────────────────────
  insert into public.s_test_proposte (invito_id, corso_id, nominativo, domande, fonte)
  values (v_inv, v_corso, 'Bianchi Geom. Ada',
          '[{"testo":"altra","tipo":"scelta","opzioni":["a","b"],"corrette":["a"]}]'::jsonb, 'prova')
  returning id into v_prop;
  perform public.dtest_accetta(v_prop, 'aggiungi');
  select count(*) into v_n from public.s_test_domande where corso_id = v_corso;
  if v_n <> 4 then raise exception 'dopo «aggiungi» ci sono % domande invece di 4', v_n; end if;
  select max(ordine) into v_n from public.s_test_domande where corso_id = v_corso;
  if v_n <> 4 then raise exception 'l''ordine dopo «aggiungi» è %', v_n; end if;

  -- ⚠️ con una prova già consegnata le domande non si sostituiscono
  insert into public.s_test_prove (corso_id, nominativo, risposte, punteggio_max, esito)
  values (v_corso, 'Chi ha già fatto il test', '{}'::jsonb, 4, 'da_correggere');
  insert into public.s_test_proposte (invito_id, corso_id, nominativo, domande, fonte)
  values (v_inv, v_corso, 'Terzo', v_dom, 'prova') returning id into v_prop;
  begin
    perform public.dtest_accetta(v_prop, 'sostituisci');
    raise exception 'ha sostituito le domande con una prova già consegnata';
  exception when others then
    if position('ha consegnato' in SQLERRM) = 0 then raise; end if;
  end;

  -- ── scartare vuole il motivo, e l'invito resta aperto ───────────────────
  begin
    perform public.dtest_scarta(v_prop, '   ');
    raise exception 'ha scartato senza motivo';
  exception when others then
    if position('si scrive perché' in SQLERRM) = 0 then raise; end if;
  end;
  update public.s_test_inviti set stato = 'consegnato' where id = v_inv;
  perform public.dtest_scarta(v_prop, 'due domande sono uguali');
  select stato into v_err from public.s_test_proposte where id = v_prop;
  if v_err <> 'scartata' then raise exception 'lo scarto ha lasciato lo stato a %', v_err; end if;
  select stato into v_err from public.s_test_inviti where id = v_inv;
  if v_err <> 'consegnato' then raise exception 'lo scarto ha chiuso l''invito (%)', v_err; end if;

  -- ── una proposta senza corso non si porta da nessuna parte ──────────────
  insert into public.s_test_proposte (corso_id, nominativo, domande, riferimento_esito, fonte)
  values (null, 'Ignoto', v_dom, 'firma non valida', 'prova') returning id into v_prop;
  begin
    perform public.dtest_accetta(v_prop);
    raise exception 'ha accettato una proposta non agganciata a un corso';
  exception when others then
    if position('non è agganciata' in SQLERRM) = 0 then raise; end if;
  end;

  -- ── chi non è segreteria non passa ──────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('email', 'nessuno@example.it', 'role', 'authenticated')::text, true);
  begin
    perform public.dtest_invita(v_corso, 'Tale');
    raise exception 'un estraneo ha creato un invito';
  exception when others then
    if position('non autorizzato' in SQLERRM) = 0 then raise; end if;
  end;

  -- ── la verifica di un MODULO: l'invito la porta con sé ─────────────────
  perform set_config('request.jwt.claims',
    json_build_object('email', 'cptpd@did.formedilpadova.it', 'role', 'authenticated')::text, true);
  declare v_parte bigint; v_cod2 text; v_prop2 bigint; v_dom2 int; begin
    v_parte := ((public.test_parte_apri(v_corso, 'Modulo di prova', 'Rossi Ing. Mario')) ->> 'id')::bigint;
    if (select test_modo from public.s_corsi where id = v_corso) <> 'per_modulo' then
      raise exception 'il corso non è passato alla verifica per modulo';
    end if;
    v_cod2 := (public.dtest_invita(v_corso, 'Rossi Ing. Mario', null, null, 30, v_parte)) ->> 'codice';
    select i.parte_id into v_parte from public.s_test_inviti i where i.codice = v_cod2;
    if v_parte is null then raise exception 'l''invito non si è portato dietro il modulo'; end if;

    insert into public.s_test_proposte (invito_id, corso_id, nominativo, domande, fonte)
    values ((select id from public.s_test_inviti where codice = v_cod2), v_corso, 'Rossi Ing. Mario',
            '[{"testo":"del modulo","tipo":"scelta","opzioni":["a","b"],"corrette":["b"]}]'::jsonb, 'prova')
    returning id into v_prop2;
    perform public.dtest_accetta(v_prop2, 'sostituisci');
    select count(*) into v_dom2 from public.s_test_domande where parte_id = v_parte;
    if v_dom2 <> 1 then raise exception 'la domanda non è finita nel modulo (% trovate)', v_dom2; end if;
    -- l'origine dice chi l'ha scritta: in un corso con più docenti è l'unico modo di saperlo
    if (select origine from public.s_test_domande where parte_id = v_parte limit 1) is distinct from 'Rossi Ing. Mario' then
      raise exception 'la domanda non porta il nome di chi l''ha scritta';
    end if;
    -- il modulo con prove consegnate non si elimina
    insert into public.s_test_prove (corso_id, parte_id, nominativo, risposte, punteggio_max, esito)
    values (v_corso, v_parte, 'Tizio', '{}'::jsonb, 1, 'da_correggere');
    begin
      perform public.test_parte_elimina(v_parte);
      raise exception 'ha eliminato un modulo con prove consegnate';
    exception when others then
      if position('prove consegnate' in SQLERRM) = 0 then raise; end if;
    end;
  end;

  raise notice 'OK: invito, firma, scadenza, revoca, validazione, porta nel test, aggiungi, scarto, permessi, moduli';
end $$;

rollback;
