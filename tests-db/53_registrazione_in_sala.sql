-- 53 — Registrazione in sala (18/11/2026): chi non si è iscritto si registra dal QR della sala,
-- la segreteria conferma dopo l'evento e le presenze seguono. Dati INVENTATI, transazione annullata.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000003"}', true);

do $$
declare v_corso bigint; v_g bigint; d date := (now() at time zone 'Europe/Rome')::date;
        v_e bigint; v_u bigint; v_x bigint; v_isc bigint; r jsonb; ok boolean; v_ora timestamptz;
begin
  assert not has_function_privilege('anon', 'public.sala_presenze(bigint)', 'execute'), 'sala_presenze chiusa ad anon';
  assert not has_function_privilege('anon', 'public.sala_link(bigint)', 'execute'), 'sala_link chiusa ad anon';

  insert into public.s_corsi (titolo, tipo, stato, data_inizio, sede)
  values ('Convegno di prova sala', 'convegno', 'aperto', d, 'Padova') returning id into v_corso;
  insert into public.s_corsi_giornate (corso_id, data, dalle, alle) values (v_corso, d, '09:30', '12:00') returning id into v_g;

  /* come la scrive portale-richieste: modulo isc, una persona marcata in_sala */
  v_ora := (d + time '09:20') at time zone 'Europe/Rome';
  insert into public.s_iscrizioni (corso_id, fonte, stato, per_conto, referente, persone, timestamp_modulo)
  values (v_corso, 'portale', 'nuova', 'persona', 'VERDI ANNA',
          '[{"cognome":"VERDI","nome":"ANNA","cf":"VRDNNA80A41H501X","ruolo":"RLS","impresa":{"ragione_sociale":"Sindacato di prova"},"in_sala":"entrata"}]', now())
  returning id into v_e;
  assert (select in_sala = 'entrata' and in_sala_il is not null from public.s_iscrizioni where id = v_e), 'la marca in_sala entra dal JSON';
  /* l'ora fuori finestra del modulo non vale: resta quella del ritiro */
  insert into public.s_iscrizioni (corso_id, fonte, stato, per_conto, referente, persone, timestamp_modulo)
  values (v_corso, 'portale', 'nuova', 'persona', 'VERDI ANNA',
          '[{"cognome":"VERDI","cf":"vrdnna80a41h501x","in_sala":"uscita"}]', now() - interval '3 hours')
  returning id into v_u;
  assert (select in_sala_il > now() - interval '1 minute' from public.s_iscrizioni where id = v_u), 'ora del modulo troppo vecchia: vale il ritiro';
  /* un'iscrizione normale non prende la marca */
  insert into public.s_iscrizioni (corso_id, fonte, stato, per_conto, referente, persone)
  values (v_corso, 'portale', 'nuova', 'persona', 'NERI', '[{"cognome":"NERI","nome":"PIO","cf":"NREPIO80A01H501Y"}]') returning id into v_x;
  assert (select in_sala is null from public.s_iscrizioni where id = v_x), 'iscrizione normale senza marca';

  /* le ore della registrazione: entrata alle 9:20, uscita alle 12:05 */
  update public.s_iscrizioni set in_sala_il = v_ora where id = v_e;
  update public.s_iscrizioni set in_sala_il = (d + time '12:05') at time zone 'Europe/Rome' where id = v_u;

  /* prima della conferma non c'è l'iscritto: la funzione si ferma e lo dice */
  ok := false;
  begin perform public.sala_presenze(v_e); exception when raise_exception then ok := true; end;
  assert ok, 'senza iscritto non scrive presenze';

  r := public.iscr_conferma(v_e, '[]'::jsonb, null, null);
  assert (r ->> 'iscritti')::int = 1, 'conferma crea l''iscritto: ' || r::text;
  r := public.sala_presenze(v_e);
  assert (r ->> 'firme_scritte')::int = 2, 'entrata e uscita scritte insieme: ' || r::text;
  v_isc := (r ->> 'iscritto_id')::bigint;
  assert (select count(*) from public.s_corsi_firme_presenza where iscritto_id = v_isc and fonte = 'sala' and stato = 'confermata') = 2, 'due firme confermate, fonte sala';
  assert (select fuori_orario from public.s_corsi_firme_presenza where iscritto_id = v_isc and tipo = 'entrata') = false, 'entrata alle 9:20 nella finestra';
  assert (select ingresso1 is not null and uscita1 is not null from public.s_corsi_presenze where iscritto_id = v_isc and giornata_id = v_g), 'il registro ha entrata e uscita';
  assert (select stato = 'confermata' and presenze_scritte_il is not null from public.s_iscrizioni where id = v_u), 'la richiesta d''uscita è chiusa con l''entrata';

  /* ripetere non raddoppia */
  r := public.sala_presenze(v_e);
  assert (r ->> 'firme_scritte')::int = 0, 'seconda volta: niente di nuovo';

  raise notice 'OK registrazione in sala';
end $$;

rollback;
