-- Storico degli stati in Cassa Edile (19/09/2026).
-- Simula una lista nuova dentro una transazione che si annulla e controlla
-- i rami che contano: stato cambiato, impresa sparita, impresa nuova, stessa
-- lista due volte, lista più vecchia, lista monca, cambio a mano.
-- Tiene fermo anche il tempo: la prima stesura andava in TIMEOUT.
begin;

do $$
declare
  a text; b text; c text; r jsonb; t0 timestamptz; n int; v_stato_b text;
begin
  -- A: attiva, con una sola riga di lista → la lista nuova la dà Sospesa
  select s.impresa_id into a
    from imprese_cassa_storico s join imprese i on i.impresa_id = s.impresa_id
   where s.attuale and s.fonte = 'lista' and s.stato = 'Attiva' and i.stato_cassa = 'Attiva'
     and (select count(*) from ceiv_lista l where l.cf = i.impresa_id or l.piva = i.impresa_id) = 1
   limit 1;
  if a is null then raise exception 'nessuna impresa Attiva su cui provare'; end if;
  update ceiv_lista l set stato = 'Sospesa' where l.cf = a or l.piva = a;

  -- B: sospesa → sparisce dalla lista
  select s.impresa_id into b from imprese_cassa_storico s
   where s.attuale and s.fonte = 'lista' and s.stato = 'Sospesa' and s.impresa_id <> a limit 1;
  select stato_cassa into v_stato_b from imprese where impresa_id = b;
  delete from ceiv_lista l where l.cf = b or l.piva = b or l.piva = (select piva from imprese where impresa_id = b);

  -- N: mai vista
  insert into ceiv_lista (codice, iscritta, stato, cf, piva, ragione_sociale, comune, aggiornata_il)
  values ('TEST999', true, 'Attiva', 'TSTPRV00A00A000A', null, 'IMPRESA DI PROVA STORICO', 'PADOVA', '2099-01-31');

  t0 := clock_timestamp();
  r := ceiv_applica('2099-01-31');
  if clock_timestamp() - t0 > interval '20 seconds' then
    raise exception 'ceiv_applica troppo lenta: % (la prima stesura con gli OR andava in timeout)', clock_timestamp() - t0;
  end if;
  if r -> 'storico' is null or (r -> 'storico' ->> 'saltato') is not null then
    raise exception 'lo storico non è stato aggiornato: %', r;
  end if;

  -- A: due periodi, il vecchio chiuso e il nuovo attuale; anagrafica allineata
  select count(*) into n from imprese_cassa_storico where impresa_id = a;
  if n <> 2 then raise exception 'A: attesi 2 periodi, trovati %', n; end if;
  if not exists (select 1 from imprese_cassa_storico where impresa_id = a and attuale and stato = 'Sospesa' and visto_dal = '2099-01-31') then
    raise exception 'A: manca il periodo Sospesa attuale'; end if;
  if not exists (select 1 from imprese_cassa_storico where impresa_id = a and not attuale and stato = 'Attiva') then
    raise exception 'A: il periodo Attiva non è stato chiuso (o è stato perso)'; end if;
  if (select stato_cassa from imprese where impresa_id = a) <> 'Sospesa' then
    raise exception 'A: anagrafica non aggiornata'; end if;

  -- B: «Non più in lista» nello storico, ma l'anagrafica NON si tocca
  if not exists (select 1 from imprese_cassa_storico where impresa_id = b and attuale and stato = 'Non più in lista') then
    raise exception 'B: la scomparsa dalla lista non è stata annotata'; end if;
  if (select stato_cassa from imprese where impresa_id = b) is distinct from v_stato_b then
    raise exception 'B: l''anagrafica è stata toccata — l''assenza dalla lista non è una prova'; end if;

  -- N: creata in anagrafica e con il suo primo periodo
  if not exists (select 1 from imprese_cassa_storico where impresa_id = 'TSTPRV00A00A000A' and attuale and stato = 'Attiva' and fonte = 'lista') then
    raise exception 'N: l''impresa nuova non ha il suo periodo'; end if;

  -- mai due «attuali» per la stessa impresa
  select count(*) into n from (select impresa_id from imprese_cassa_storico where attuale group by 1 having count(*) > 1) x;
  if n > 0 then raise exception '% imprese con due periodi attuali', n; end if;

  -- la stessa lista due volte non aggiunge niente
  select count(*) into n from imprese_cassa_storico;
  perform ceiv_storico_aggiorna('2099-01-31');
  if (select count(*) from imprese_cassa_storico) <> n then
    raise exception 'la stessa lista applicata due volte ha aggiunto periodi'; end if;

  -- una lista più vecchia non riscrive la storia
  r := ceiv_storico_aggiorna('2026-08-01');
  if (r ->> 'saltato') is distinct from 'true' then raise exception 'lista più vecchia non saltata: %', r; end if;

  -- cambio a mano: nasce un periodo «manuale», e un salvataggio senza cambio non ne crea
  perform set_config('app.ceiv_applica', '', true);
  select impresa_id into c from imprese_cassa_storico
   where attuale and fonte = 'lista' and stato = 'Cessata' and impresa_id not in (a, b) limit 1;
  update imprese set stato_cassa = 'Attiva' where impresa_id = c;
  if not exists (select 1 from imprese_cassa_storico where impresa_id = c and attuale and stato = 'Attiva' and fonte = 'manuale') then
    raise exception 'C: il cambio a mano non ha lasciato traccia (il trigger inghiotte gli errori: guardare i warning)'; end if;
  select count(*) into n from imprese_cassa_storico where impresa_id = c;
  update imprese set impresa_nome = impresa_nome where impresa_id = c;
  if (select count(*) from imprese_cassa_storico where impresa_id = c) <> n then
    raise exception 'C: un salvataggio senza cambio di stato ha creato un periodo'; end if;

  -- lista monca: lo storico non si tocca
  select count(*) into n from imprese_cassa_storico;
  delete from ceiv_lista where codice not in (select codice from ceiv_lista order by codice limit 100);
  r := ceiv_storico_aggiorna('2099-02-28');
  if (r ->> 'saltato') is distinct from 'true' then raise exception 'lista monca non fermata: %', r; end if;
  if (select count(*) from imprese_cassa_storico) <> n then raise exception 'la lista monca ha scritto nello storico'; end if;
end $$;

-- chi non è entrato non legge lo storico e non chiama le funzioni
do $$
begin
  if has_table_privilege('anon', 'public.imprese_cassa_storico', 'select') then
    raise exception 'anon legge imprese_cassa_storico'; end if;
  if has_function_privilege('authenticated', 'public.ceiv_applica(date)', 'execute')
     or has_function_privilege('authenticated', 'public.ceiv_storico_aggiorna(date)', 'execute')
     or has_function_privilege('authenticated', 'public.ceiv_aggancio()', 'execute') then
    raise exception 'le funzioni della lista CEIV sono chiamabili da un utente dell''app'; end if;
end $$;

rollback;
