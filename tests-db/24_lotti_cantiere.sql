-- Test dei lotti del cantiere guidati dal verbale (gestionale, 07/10/2026: 2026_10_07_lotti_cantiere.sql).
--   · la scheda di partenza prende il suo lotto e l'etichetta col lotto; la copia è identica salvo id, lotto,
--     etichetta e codice univoco; lo stesso nome di lotto non si ripete; la copia senza visite si toglie, la
--     scheda di partenza no; tutto resta scritto in cantieri_correzioni.
-- Tutto dentro una transazione annullata.
begin;

do $$
declare cid text; r jsonb; nid text; c0 public.cantieri; c1 public.cantieri; ok boolean; msg text; n int;
begin
  select k.cantiere_id into cid from public.cantieri k
   where coalesce(k.elimina,0)=0 and k.cantiere_cnce ilike 'CNCE%' and coalesce(btrim(k.lotto),'')=''
     and k.cantiere_committente_id is not null and k.cantiere_tip_int is not null
     and exists (select 1 from public.visite v where v.cantiere_id=k.cantiere_id and v.elimina=0)
   order by k.cantiere_id limit 1;
  assert cid is not null, 'serve un cantiere CNCE senza lotto con visite';
  select * into c0 from public.cantieri where cantiere_id=cid;

  ok:=false; begin perform public.crea_lotto_cantiere(cid, '', '2'); exception when others then msg:=sqlerrm; ok:=msg like 'Scrivi il nome%'; end;
  assert ok, 'senza il nome del lotto di partenza non si divide: '||coalesce(msg,'(nessun errore)');

  r := public.crea_lotto_cantiere(cid, '1', '2');
  assert (r->>'ok')::boolean and (r->>'creato')::boolean, 'creato';
  nid := r->>'cantiere_id';
  select * into c1 from public.cantieri where cantiere_id=nid;
  assert (select lotto from public.cantieri where cantiere_id=cid)='1', 'la scheda di partenza diventa il lotto 1';
  assert (select cantiere_etichetta from public.cantieri where cantiere_id=cid) like '% – lotto 1', 'etichetta col lotto';
  assert c1.lotto='2' and c1.cantiere_etichetta like '% – lotto 2' and length(c1.cantiere_etichetta)<=50;
  assert c1.cantiere_indirizzo=c0.cantiere_indirizzo and c1.cantiere_civico=c0.cantiere_civico and c1.comune_nome=c0.comune_nome
     and c1.cantiere_cnce=c0.cantiere_cnce and c1.cantiere_committente_id=c0.cantiere_committente_id
     and c1.cantiere_tip_int is not distinct from c0.cantiere_tip_int and c1.cantiere_tip_ope is not distinct from c0.cantiere_tip_ope
     and c1.cantiere_importo is not distinct from c0.cantiere_importo and c1.cantiere_durata is not distinct from c0.cantiere_durata
     and c1.cantiere_comune_cod is not distinct from c0.cantiere_comune_cod, 'la copia è identica';
  assert c1.nodo_id is null and not c1.cantiere_chiuso, 'senza codice univoco, aperta';
  assert (select count(*) from public.visite where cantiere_id=nid)=0, 'le visite restano sulla scheda di partenza';

  ok:=false; begin perform public.crea_lotto_cantiere(cid, null, '2'); exception when others then msg:=sqlerrm; ok:=msg like '%c''è già%'; end;
  assert ok, 'lo stesso lotto non si ripete: '||coalesce(msg,'(nessun errore)');

  select count(*) into n from public.lotti_del_cantiere(nid);
  assert n>=2, 'i lotti si vedono da qualunque lotto';
  assert exists (select 1 from public.lotti_del_cantiere(cid) l where l.cantiere_id=cid and l.visite>0 and l.ultima_impresa is not null), 'con visite e impresa';

  r := public.crea_lotto_cantiere(nid, null, null);
  assert r->>'cantiere_id'=nid and not (r->>'creato')::boolean, 'scegliere un lotto che ha già il nome non tocca niente';

  ok:=false; begin perform public.togli_lotto_cantiere(cid); exception when others then msg:=sqlerrm; ok:=msg like 'Si toglie solo%'; end;
  assert ok, 'la scheda di partenza non si toglie: '||coalesce(msg,'(nessun errore)');
  r := public.togli_lotto_cantiere(nid);
  assert (r->>'ok')::boolean and not exists (select 1 from public.cantieri where cantiere_id=nid), 'la copia senza visite si toglie';
  assert exists (select 1 from public.cantieri_correzioni where cantiere_id=nid and campo='scheda' and prima like '%"lotto": "2"%'), 'e resta scritta';

  assert public.etichetta_con_lotto('Via Boccaccio PADOVA - lotto 5 (Furlan)','x','snc','6')='Via Boccaccio PADOVA – lotto 6', 'il lotto vecchio si sostituisce';
  assert public.etichetta_con_lotto(null,'Via Roma','SNC','2')='Via Roma – lotto 2', 'senza etichetta: indirizzo, niente SNC';
  -- (07/10/2026) anche senza CNCE, e anche dopo aver corretto l'indirizzo di un lotto
  select k.cantiere_id into cid from public.cantieri k
   where coalesce(k.elimina,0)=0 and coalesce(k.cantiere_cnce,'')='' and coalesce(btrim(k.lotto),'')=''
     and exists (select 1 from public.visite v where v.cantiere_id=k.cantiere_id and v.elimina=0)
   order by k.cantiere_id limit 1;
  assert cid is not null, 'serve un cantiere senza CNCE con visite';
  r := public.crea_lotto_cantiere(cid, 'A', 'B');
  nid := r->>'cantiere_id';
  assert (select lotto_di from public.cantieri where cantiere_id=nid)=cid, 'la copia ricorda la scheda di partenza';
  assert (select lotto_di from public.cantieri where cantiere_id=cid) is null, 'la scheda di partenza non ha radice';
  update public.cantieri set cantiere_indirizzo = cantiere_indirizzo || ' interno' where cantiere_id = nid;
  assert exists (select 1 from public.lotti_del_cantiere(cid) l where l.cantiere_id=nid), 'il lotto con l''indirizzo corretto resta nel complesso';
  r := public.crea_lotto_cantiere(nid, null, 'C');
  assert (select lotto_di from public.cantieri where cantiere_id=r->>'cantiere_id')=cid, 'la copia di una copia punta alla prima';
  assert (select count(*) from public.lotti_del_cantiere(nid))=3, 'tre lotti, da qualunque lotto si guardi';

  assert not has_function_privilege('anon','public.crea_lotto_cantiere(text,text,text)','EXECUTE');
  assert not has_function_privilege('anon','public.togli_lotto_cantiere(text)','EXECUTE');
end $$;

select 'ok — lotti del cantiere' as esito;
rollback;
