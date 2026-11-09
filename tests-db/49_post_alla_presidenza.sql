-- Test del passaggio dei post social ALLA PRESIDENZA (09/11/2026: 2026_11_09_post_alla_presidenza_spento.sql).
--   · spento (s_config.post_presidenza_attiva = 'no'): nessun post ci va;
--   · acceso (solo dentro questa transazione): la segreteria manda scrivendo perché; avviso a tutti e due;
--   · mentre aspetta il post non si cambia; il Direttore non decide al posto della Presidenza;
--   · ognuno decide una volta; con «entrambi» il primo ok non basta; «non approvo» di uno lo riporta in bozza;
--   · con correzioni la nota è obbligatoria e resta scritta con chi l'ha data;
--   · con «uno» basta il primo ok; ognuno legge solo i suoi passaggi (RLS).
-- Tutto dentro una transazione annullata: non resta nessuna riga (e nessuna notifica parte).
begin;

do $$
declare
  v_segr text; v_pres text; v_vice text; v_dir text; pid bigint; pid2 bigint; pid3 bigint; r jsonb; pas bigint;
  ok boolean; n int;
begin
  select lower(email) into v_segr from public.app_ruoli where ruolo in ('segreteria', 'admin') and stato = 'attivo' order by email limit 1;
  select lower(email) into v_pres from public.app_ruoli where carica = 'presidente' and stato = 'attivo' limit 1;
  select lower(email) into v_vice from public.app_ruoli where carica = 'vicepresidente' and stato = 'attivo' limit 1;
  select lower(valore) into v_dir from public.s_config where chiave = 'direttore_email';
  assert v_segr is not null and v_pres is not null and v_vice is not null and v_dir is not null, 'servono segreteria, Presidente, Vicepresidente e Direttore';
  assert (select valore from public.s_config where chiave = 'post_presidenza_attiva') = 'no', 'il passaggio nasce spento';

  insert into public.s_post (titolo, testo_telegram, stato, creato_da) values ('Prova presidenza 1', 'numeri **prova**', 'bozza', 'test') returning id into pid;
  insert into public.s_post (titolo, testo_telegram, stato, creato_da) values ('Prova presidenza 2', 'altro', 'bozza', 'test') returning id into pid2;
  insert into public.s_post (titolo, testo_telegram, stato, creato_da) values ('Prova presidenza 3', 'terzo', 'bozza', 'test') returning id into pid3;

  /* spento: non si manda */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_manda(pid, 'presidenza', 'Confronta categorie di imprese'); exception when others then ok := sqlerrm like 'Il passaggio alla Presidenza non è ancora acceso%'; end;
  assert ok, 'spento, alla Presidenza non va niente';

  /* acceso (solo qui) */
  update public.s_config set valore = 'si' where chiave = 'post_presidenza_attiva';
  ok := false;
  begin perform public.s_post_manda(pid, 'presidenza', ' '); exception when others then ok := sqlerrm like 'Scrivi perché il post va alla Presidenza%'; end;
  assert ok, 'si scrive perché va alla Presidenza';
  r := public.s_post_manda(pid, 'presidenza', 'Confronta imprese iscritte e non iscritte alla Cassa');
  pas := (r ->> 'passaggio')::bigint;
  assert (select stato from public.s_post where id = pid) = 'alla_presidenza', 'il post aspetta la Presidenza';
  assert exists (select 1 from public.push_coda where email = v_pres and tag = 'post-' || pid), 'avvisato il Presidente';
  assert exists (select 1 from public.push_coda where email = v_vice and tag = 'post-' || pid), 'avvisato il Vicepresidente';
  ok := false;
  begin update public.s_post set testo_telegram = 'cambiato' where id = pid; exception when others then ok := sqlerrm like 'Il post è dalla Presidenza%'; end;
  assert ok, 'mentre la Presidenza lo guarda il testo non si cambia';

  /* il Direttore non decide al posto della Presidenza */
  perform set_config('request.jwt.claims', json_build_object('email', v_dir, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'approvato'); exception when others then ok := sqlerrm like 'L''approvazione spetta a Presidente e Vicepresidente%'; end;
  assert ok, 'decide la Presidenza';

  /* il Presidente approva: con «entrambi» non basta */
  perform set_config('request.jwt.claims', json_build_object('email', v_pres, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'visto'); exception when others then ok := sqlerrm like 'Si approva, si approva con correzioni%'; end;
  assert ok, 'la Presidenza non dà visti';
  r := public.s_post_decidi(pas, 'approvato');
  assert (r ->> 'chiuso')::boolean = false, 'manca ancora il Vicepresidente';
  assert (select stato from public.s_post_passaggi where id = pas) = 'in_attesa', 'il passaggio aspetta ancora';
  assert (select stato from public.s_post where id = pid) = 'alla_presidenza', 'il post aspetta ancora';
  assert (select decisioni -> 'presidente' ->> 'esito' from public.s_post_passaggi where id = pas) = 'approvato', 'la decisione del Presidente resta scritta';
  assert exists (select 1 from public.push_coda where email = v_segr and evento = 'post_decisione_parziale' and tag = 'post-' || pid), 'la segreteria sa che manca uno';
  ok := false;
  begin perform public.s_post_decidi(pas, 'non_approvato', 'Ci ho ripensato'); exception when others then ok := sqlerrm like 'Su questo post hai già deciso%'; end;
  assert ok, 'ognuno decide una volta';

  /* RLS: il Presidente legge il passaggio della Presidenza, non quelli del Direttore */
  set local role authenticated;
  select count(*) into n from public.s_post_passaggi where id = pas;
  assert n = 1, 'il Presidente legge il suo passaggio';
  select count(*) into n from public.s_post_passaggi where verso = 'direttore';
  assert n = 0, 'il Presidente non legge i passaggi del Direttore';
  reset role;

  /* il Vicepresidente approva con correzioni: senza nota no; con la nota il post è approvato */
  perform set_config('request.jwt.claims', json_build_object('email', v_vice, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'approvato_indicazioni', ''); exception when others then ok := sqlerrm like 'Scrivi le correzioni%'; end;
  assert ok, 'le correzioni si scrivono';
  r := public.s_post_decidi(pas, 'approvato_indicazioni', 'Togli la frase sui servizi');
  assert (r ->> 'chiuso')::boolean, 'con tutti e due il passaggio si chiude';
  assert (select stato from public.s_post_passaggi where id = pas) = 'approvato_indicazioni', 'approvato con correzioni';
  assert (select stato from public.s_post where id = pid) = 'approvato', 'il post si può pubblicare dopo le correzioni';
  assert (select nota from public.s_post_passaggi where id = pas) like '%Vicepresidente: Togli la frase%', 'la correzione resta scritta con chi l''ha data';

  /* «non approvo» di uno dei due: subito in bozza */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  r := public.s_post_manda(pid2, 'presidenza', 'Nomina un territorio');
  pas := (r ->> 'passaggio')::bigint;
  perform set_config('request.jwt.claims', json_build_object('email', v_vice, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.s_post_decidi(pas, 'non_approvato'); exception when others then ok := sqlerrm like 'Scrivi perché non lo approvi%'; end;
  assert ok, 'chi non approva dice perché';
  perform public.s_post_decidi(pas, 'non_approvato', 'Il territorio non va nominato');
  assert (select stato from public.s_post where id = pid2) = 'bozza', 'un «no» riporta il post alla segreteria';
  assert (select stato from public.s_post_passaggi where id = pas) = 'non_approvato', 'il passaggio si chiude come non approvato';

  /* con «uno» basta il primo ok */
  update public.s_config set valore = 'uno' where chiave = 'post_presidenza_servono';
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  r := public.s_post_manda(pid3, 'presidenza', 'Statistica');
  pas := (r ->> 'passaggio')::bigint;
  perform set_config('request.jwt.claims', json_build_object('email', v_pres, 'role', 'authenticated')::text, true);
  perform public.s_post_decidi(pas, 'approvato');
  assert (select stato from public.s_post where id = pid3) = 'approvato', 'con «uno» basta il Presidente';

  /* Coordinatore e Direttore: come prima */
  perform set_config('request.jwt.claims', json_build_object('email', v_segr, 'role', 'authenticated')::text, true);
  insert into public.s_post (titolo, testo_telegram, stato, creato_da) values ('Prova direttore', 'x', 'bozza', 'test') returning id into pid;
  r := public.s_post_manda(pid, 'direttore');
  assert (select stato from public.s_post where id = pid) = 'al_direttore', 'al Direttore si manda come prima';
end $$;

rollback;
