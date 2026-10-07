-- Test dei comuni/quartieri condivisi fra due aree (segreteria, 07/10/2026: 2026_10_07_zone_condivise.sql).
--   · Padova Q1 condiviso fra l'area di De Marco e quella di Visentini: tecnici_zone lo dà a tutti e due,
--     nessuna visita aperta si sposta;
--   · la stessa area non lo prende due volte;
--   · spostarlo in una delle due aree lo toglie all'altra (e le visite aperte dell'altra passano);
--   · un comune non condiviso si sposta come prima.
-- Tutto dentro una transazione annullata. Le aree si cercano per tecnico, non per numero.
begin;

do $$
declare a_dm int; a_vi int; a_ca int; j json; n int; ok boolean; msg text; e_dm text; e_vi text;
begin
  select t.area_id, lower(tc.email) into a_dm, e_dm from zone_aree_tecnici t join tecnici tc on tc.tecnico_id = t.tecnico_id
   where tc.tecnico_cognome ilike 'De Marco%' and t.dal <= current_date and t.al is null limit 1;
  select t.area_id, lower(tc.email) into a_vi, e_vi from zone_aree_tecnici t join tecnici tc on tc.tecnico_id = t.tecnico_id
   where tc.tecnico_cognome ilike 'Visentini%' and t.dal <= current_date and t.al is null limit 1;
  select t.area_id into a_ca from zone_aree_tecnici t join tecnici tc on tc.tecnico_id = t.tecnico_id
   where tc.tecnico_cognome ilike 'Caon%' and t.dal <= current_date and t.al is null limit 1;
  assert a_dm is not null and a_vi is not null and a_ca is not null, 'servono le aree di De Marco, Visentini e Caon';

  -- se Q1 è già condiviso (l'ha fatto la segreteria dopo questo test), lo si riporta alla sola area di De Marco
  if exists (select 1 from zone_aree_comuni where comune_nome='PADOVA' and quartiere=1 and al is null and area_id=a_vi) then
    perform zone_sposta('PADOVA', 1::smallint, a_dm);
  end if;
  assert (select count(*) from zone_aree_comuni where comune_nome='PADOVA' and quartiere=1 and al is null) = 1, 'Q1 parte da un''area sola';
  select count(*) into n from pendenze_riassegnate;

  j := zone_condividi('padova', 1::smallint, a_vi);
  assert (j->>'area')::int = a_vi, 'condiviso';
  assert (select count(*) from zone_aree_comuni where comune_nome='PADOVA' and quartiere=1 and al is null) = 2, 'Q1 in due aree';
  assert exists (select 1 from tecnici_zone where email=e_dm and comune_nome='PADOVA - Q1 Centro')
     and exists (select 1 from tecnici_zone where email=e_vi and comune_nome='PADOVA - Q1 Centro'), 'tecnici_zone lo dà a tutti e due';
  assert (select count(*) from pendenze_riassegnate) = n, 'condividere non sposta visite aperte';

  ok := false; begin perform zone_condividi('PADOVA', 1::smallint, a_vi); exception when others then msg := sqlerrm; ok := msg like '%già nell''area%'; end;
  assert ok, 'la stessa area non lo prende due volte: ' || coalesce(msg, '(nessun errore)');
  ok := false; begin perform zone_condividi('ESTE', 2::smallint, a_vi); exception when others then msg := sqlerrm; ok := msg like '%solo per Padova%'; end;
  assert ok, 'il quartiere vale solo per Padova';

  j := zone_anteprima_sposta('PADOVA', 1::smallint, a_dm);
  assert (j->>'area_vecchia')::int = a_vi, 'anteprima: lo perde l''area di Visentini';

  j := zone_sposta('PADOVA', 1::smallint, a_dm);
  assert (select array_agg(area_id) from zone_aree_comuni where comune_nome='PADOVA' and quartiere=1 and al is null) = array[a_dm],
    'spostato nella sola area di De Marco: tolto a Visentini';
  assert not exists (select 1 from tecnici_zone where email=e_vi and comune_nome='PADOVA - Q1 Centro');

  ok := false; begin perform zone_sposta('PADOVA', 1::smallint, a_dm); exception when others then msg := sqlerrm; ok := msg like '%già nell''area%'; end;
  assert ok, 'già solo lì: errore come prima';

  -- un comune qualunque si sposta come prima
  j := zone_sposta('VIGONZA', null, a_vi);
  assert (select array_agg(area_id) from zone_aree_comuni where comune_nome='VIGONZA' and al is null) = array[a_vi] and (j->>'area_vecchia')::int = a_ca;

  raise notice 'OK 26_zone_condivise';
end $$;

rollback;
