-- Test delle questioni sui verbali e del blocco del pagamento (gestionale, 20/10/2026: 2026_10_20_questioni_verbali.sql).
--   · il Coordinatore segnala al tecnico (messaggio obbligatorio, una sola segnalazione aperta per verbale);
--   · finché la questione è aperta la fattura che copre quel verbale non passa ad «approvata» né a «mandato»;
--   · il tecnico risponde («va bene così» vuole il perché), il Coordinatore chiude: allora la fattura si approva;
--   · «fai passare» chiude subito e non blocca niente;
--   · con la riapertura il verbale torna in bozza e blocca la fattura anche dopo essere stato richiuso, finché la
--     questione non è chiusa;
--   · la tabella la scrivono solo le funzioni, e un tecnico vede solo le questioni dei suoi verbali.
-- Nota: le funzioni lasciano passare session_user = 'postgres' (come riapri_verbale), quindi il rifiuto a chi non è
-- Coordinatore da qui non si prova; lo fanno is_coordinatore() e mio_tecnico_id().
-- Tutto dentro una transazione annullata: non resta nessuna riga (e nessuna notifica parte).
begin;

do $$
declare
  fid bigint; vid text; vid2 text; tec text; tec_mail text; altro_mail text;
  r jsonb; qid bigint; qid2 bigint; ok boolean; msg text; n int;
begin
  /* una fattura con almeno due verbali definitivi (quelli già fatturati sono storici e spesso non «completi»
     per verbale_mancanze: la richiusura del tecnico qui si simula, chiudi_verbale ha il suo test, il 23) */
  select p.fattura_id, min(v.visita_id), max(v.visita_id) into fid, vid, vid2
    from public.s_prestazioni p join public.visite v on v.visita_id = p.visita_id
   where p.fattura_id is not null and v.stato = 'definitivo' and coalesce(v.elimina, 0) = 0
   group by p.fattura_id having count(*) >= 2
   order by p.fattura_id desc limit 1;
  assert fid is not null and vid <> vid2, 'serve una fattura con due verbali definitivi';
  update public.s_fatture_tecnici set stato = 'verificata' where id = fid;

  /* si lavora come il Coordinatore: s_fattura_decisione non lascia passare postgres */
  perform set_config('request.jwt.claims', json_build_object('email', (select lower(valore) from public.s_config where chiave = 'coordinatore_email'), 'role', 'authenticated')::text, true);

  /* segnalazione */
  ok := false; msg := null;
  begin perform public.vq_segnala(vid, 'avviso', 'ok?', false); exception when others then msg := sqlerrm; ok := msg like 'Scrivi%'; end;
  assert ok, 'senza messaggio non si segnala: ' || coalesce(msg, '(nessun errore)');

  r := public.vq_segnala(vid, 'È indicata una visita di ritorno, ma la regola non prevede rientro', 'Togli la data di ritorno, per favore', false);
  assert (r ->> 'ok')::boolean, 'segnalato';
  qid := (r ->> 'id')::bigint;
  assert (select esito from public.visite_questioni where id = qid) = 'segnalata', 'la questione è aperta';
  assert exists (select 1 from public.push_coda where tag = 'questione-' || qid and testo like 'Il Coordinatore ti ha segnalato%'), 'la notifica dice che scrive il Coordinatore';
  assert (select stato from public.visite where visita_id = vid) = 'definitivo', 'senza riapertura il verbale resta definitivo';

  ok := false; msg := null;
  begin perform public.vq_segnala(vid, 'x', 'di nuovo lo stesso', false); exception when others then msg := sqlerrm; ok := msg like '%già una segnalazione aperta%'; end;
  assert ok, 'una sola segnalazione aperta per verbale: ' || coalesce(msg, '(nessun errore)');

  /* il blocco del pagamento */
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 1, 'la fattura ha una questione aperta, trovate ' || n;
  ok := false; msg := null;
  begin update public.s_fatture_tecnici set stato = 'approvata' where id = fid; exception when others then msg := sqlerrm; ok := msg like '%non può andare in pagamento%'; end;
  assert ok, 'con una questione aperta la fattura non si approva: ' || coalesce(msg, '(nessun errore)');
  ok := false; msg := null;
  begin perform public.s_fattura_decisione(fid, 'approvata', null); exception when others then msg := sqlerrm; ok := msg like '%non può andare in pagamento%'; end;
  assert ok, 'neanche dalla funzione della decisione: ' || coalesce(msg, '(nessun errore)');
  ok := false; msg := null;
  begin update public.s_fatture_tecnici set stato = 'mandato' where id = fid; exception when others then msg := sqlerrm; ok := msg like '%non può andare in pagamento%'; end;
  assert ok, 'né va in mandato: ' || coalesce(msg, '(nessun errore)');
  perform public.s_fattura_decisione(fid, 'standby', 'verbale da sistemare');
  assert (select stato from public.s_fatture_tecnici where id = fid) = 'standby', 'lo stand-by resta possibile';

  /* la risposta del tecnico */
  ok := false; msg := null;
  begin perform public.vq_rispondi(qid, 'va_bene', ''); exception when others then msg := sqlerrm; ok := msg like 'Scrivi perché%'; end;
  assert ok, '«va bene così» vuole il perché: ' || coalesce(msg, '(nessun errore)');
  r := public.vq_rispondi(qid, 'va_bene', 'Il committente ha chiesto una seconda visita');
  assert (select esito from public.visite_questioni where id = qid) = 'risposta', 'risposta registrata';
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 1, 'dopo la risposta la questione è ancora aperta';

  /* il Coordinatore chiude: la fattura si approva */
  r := public.vq_chiudi(qid, 'passata', 'Va bene, motivo valido');
  assert (select esito from public.visite_questioni where id = qid) = 'passata', 'chiusa';
  ok := false; msg := null;
  begin perform public.vq_chiudi(qid, 'risolta', null); exception when others then msg := sqlerrm; ok := msg like '%già chiusa%'; end;
  assert ok, 'una questione chiusa non si richiude: ' || coalesce(msg, '(nessun errore)');
  perform public.s_fattura_decisione(fid, 'approvata', null);
  assert (select stato from public.s_fatture_tecnici where id = fid) = 'approvata', 'chiusa la questione, la fattura si approva';

  /* «fai passare» chiude subito */
  update public.s_fatture_tecnici set stato = 'verificata' where id = fid;
  r := public.vq_passa(vid2, 'In «Osservazioni» c''è scritto che va tutto bene, ma la check-list ha 1 OSS', 'cosa da poco');
  assert (select esito from public.visite_questioni where id = (r ->> 'id')::bigint) = 'passata', 'fatta passare subito';
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 0, 'una questione fatta passare non blocca';

  /* segnalazione con riapertura, fatta dalla segreteria (20/10/2026 sera: anche la segreteria segnala e chiude) */
  perform set_config('request.jwt.claims', json_build_object('email', 'cptpd@did.formedilpadova.it', 'role', 'authenticated')::text, true);
  assert public.is_segreteria(), 'la casella dell''ufficio è segreteria';
  r := public.vq_segnala(vid2, 'avviso', 'Correggi le osservazioni e richiudi', true);
  /* la notifica di questa segnalazione può non esserci: push_accoda scarta un secondo avviso uguale allo stesso
     tecnico entro due minuti (le due segnalazioni restano comunque in Oggi). Il testo si prova sulla funzione. */
  assert public.vq_chi_scrive() = 'La segreteria', 'la notifica dice che scrive la segreteria';
  qid2 := (r ->> 'id')::bigint;
  assert (select stato from public.visite where visita_id = vid2) = 'bozza', 'con la riapertura torna in bozza';
  assert exists (select 1 from public.visite_riaperture where visita_id = vid2 and richiuso_il is null and motivo like 'Segnalazione sul verbale:%'), 'la riapertura è scritta';
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 2, 'bloccano sia la questione sia la riapertura, trovate ' || n;
  /* il tecnico richiude (simulato: è ciò che fa chiudi_verbale → riapertura_richiusa) */
  update public.visite set stato = 'definitivo' where visita_id = vid2;
  update public.visite_riaperture set richiuso_il = now() where visita_id = vid2 and richiuso_il is null;
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 1, 'richiuso il verbale resta la questione, finché il Coordinatore non la chiude';
  r := public.vq_rispondi(qid2, 'sistemo', null);
  assert exists (select 1 from public.push_coda where tag = 'questione-risp-' || qid2 and email = 'cptpd@did.formedilpadova.it'), 'la risposta avvisa anche la segreteria, che ha aperto la questione';
  /* il Coordinatore era già stato avvisato della prima risposta: entro due minuti push_accoda non ripete lo stesso avviso */
  assert exists (select 1 from public.push_coda where tag in ('questione-risp-' || qid, 'questione-risp-' || qid2)
                   and email = (select lower(valore) from public.s_config where chiave = 'coordinatore_email')), 'e il Coordinatore, che vede tutto';
  r := public.vq_chiudi(qid2, 'risolta', null);
  assert (select chiusa_da from public.visite_questioni where id = qid2) = 'cptpd@did.formedilpadova.it', 'la chiude la segreteria';
  select count(*) into n from public.fattura_questioni_aperte(array[fid]);
  assert n = 0, 'risolta: niente blocca più';

  /* chi vede e chi scrive */
  select v.tecnico_id, lower(t.email) into tec, tec_mail from public.visite v join public.tecnici t using (tecnico_id) where v.visita_id = vid2;
  select lower(email) into altro_mail from public.tecnici
   where tecnico_id <> tec and coalesce(attivo, true) and coalesce(elimina, 0) = 0 and email is not null
     and lower(email) <> (select lower(valore) from public.s_config where chiave = 'coordinatore_email')
     and not exists (select 1 from public.app_ruoli a where lower(a.email) = lower(tecnici.email) and a.ruolo = 'segreteria')
   limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', altro_mail, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.visite_questioni where visita_id in (vid, vid2);
  assert n = 0, 'un altro tecnico non vede le questioni dei verbali altrui, ne vede ' || n;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', tec_mail, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.visite_questioni where visita_id = vid2;
  assert n >= 1, 'il tecnico vede le questioni dei suoi verbali';
  reset role;

  assert not has_table_privilege('authenticated', 'public.visite_questioni', 'INSERT'), 'le questioni le scrivono solo le funzioni';
  assert not has_table_privilege('authenticated', 'public.visite_questioni', 'UPDATE'), 'e solo le funzioni le cambiano';
  assert not has_function_privilege('anon', 'public.vq_segnala(text,text,text,boolean)', 'EXECUTE'), 'anon non segnala';
  assert not has_function_privilege('anon', 'public.fattura_questioni_aperte(bigint[])', 'EXECUTE'), 'anon non legge i blocchi';
end $$;

select 'ok — questioni sui verbali e blocco del pagamento' as esito;
rollback;
