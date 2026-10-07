-- Test del complesso a lotti (gestionale, 07/10/2026: 2026_10_07_lotti_complesso.sql).
--   · adotta_lotto_cantiere: una scheda con il lotto scritto nell'indirizzo diventa lotto del complesso di un'altra
--     (prende CNCE e radice, il lotto esce dall'indirizzo ed entra in campo ed etichetta); lo stesso lotto non si
--     ripete; CNCE diversi si rifiutano.
--   · lotti_acc_complesso e visite_complesso: numero d'ordine sul lotto e sul complesso, visite di tutti i lotti.
--   · sposta_visite_in_lotti: una visita passa su un lotto nuovo; i definitivi tengono l'accesso stampato, le bozze
--     lo riprendono dal lotto; una visita di un'altra scheda si rifiuta.
-- Con l'accesso della segreteria (cptpd@), tutto dentro una transazione annullata.
begin;
select set_config('request.jwt.claims', json_build_object('email','cptpd@did.formedilpadova.it','role','authenticated',
  'sub',(select id::text from auth.users where email='cptpd@did.formedilpadova.it'))::text, true);
set local role authenticated;

do $$
declare mid text; oid text; altro text; r jsonb; o public.cantieri; m public.cantieri; ok boolean; msg text;
        n int; nvis int; vid text; vstato text; vacc text; nid text; tot int;
begin
  -- il principale: CNCE senza lotto con almeno 2 visite
  select k.cantiere_id into mid from public.cantieri k
   where coalesce(k.elimina,0)=0 and k.cantiere_cnce ilike 'CNCE%' and coalesce(btrim(k.lotto),'')=''
     and (select count(*) from public.visite v where v.cantiere_id=k.cantiere_id and v.elimina=0) >= 2
   order by k.cantiere_id limit 1;
  assert mid is not null, 'serve un cantiere CNCE senza lotto con almeno 2 visite';
  -- la scheda importata: senza CNCE, col lotto scritto nell'indirizzo e una visita
  select k.cantiere_id into oid from public.cantieri k
   where coalesce(k.elimina,0)=0 and coalesce(k.cantiere_cnce,'') !~* '^CNCE' and coalesce(btrim(k.lotto),'')=''
     and k.cantiere_indirizzo ~* '\mlott[oi]\M\s*\(?\s*\d'
     and exists (select 1 from public.visite v where v.cantiere_id=k.cantiere_id and v.elimina=0)
   order by k.cantiere_id limit 1;
  assert oid is not null, 'serve una scheda senza CNCE col lotto nell''indirizzo';
  select k.cantiere_id into altro from public.cantieri k
   where coalesce(k.elimina,0)=0 and k.cantiere_cnce ilike 'CNCE%' and k.cantiere_id<>mid
     and upper(k.cantiere_cnce)<>(select upper(cantiere_cnce) from public.cantieri where cantiere_id=mid) limit 1;

  -- adotta
  r := public.adotta_lotto_cantiere(mid, oid, '14', '1');
  assert (r->>'ok')::boolean, 'adottato';
  select * into m from public.cantieri where cantiere_id=mid;
  select * into o from public.cantieri where cantiere_id=oid;
  assert m.lotto='1', 'il principale è il lotto 1';
  assert o.lotto='14' and o.lotto_di=mid, 'la scheda adottata è il lotto 14 del complesso';
  assert upper(o.cantiere_cnce)=upper(m.cantiere_cnce), 'prende il CNCE del principale';
  assert o.cantiere_indirizzo !~* '\mlott[oi]\M', 'il lotto esce dall''indirizzo: '||o.cantiere_indirizzo;
  assert o.cantiere_etichetta like '% – lotto 14', 'etichetta col lotto: '||coalesce(o.cantiere_etichetta,'(vuota)');
  assert exists (select 1 from public.lotti_del_cantiere(mid) l where l.cantiere_id=oid and l.lotto='14'), 'il lotto adottato sta nell''elenco del complesso';
  assert (select count(*) from public.cantieri_correzioni where cantiere_id=oid and origine like 'lotto riconosciuto dall''unione%') >= 3, 'resta scritto';

  ok:=false; begin perform public.adotta_lotto_cantiere(mid, oid, '1', null); exception when others then msg:=sqlerrm; ok:=msg like '%c''è già%'; end;
  assert ok, 'lo stesso lotto non si ripete: '||coalesce(msg,'(nessun errore)');
  if altro is not null then
    ok:=false; begin perform public.adotta_lotto_cantiere(mid, altro, '9', null); exception when others then msg:=sqlerrm; ok:=msg like '%CNCE diversi%'; end;
    assert ok, 'CNCE diversi non diventano lotti: '||coalesce(msg,'(nessun errore)');
  end if;

  -- i numeri d'ordine
  select count(*) into tot from public.visite v where v.cantiere_id in (mid, oid) and v.elimina=0;
  select count(*) into n from public.lotti_acc_complesso(mid);
  assert n=tot, 'una riga per visita del complesso: '||n||' su '||tot;
  assert (select max(acc_complesso) from public.lotti_acc_complesso(mid))=tot, 'il complesso conta fino in fondo';
  assert (select max(acc_lotto) from public.lotti_acc_complesso(mid) where cantiere_id=oid)=(select count(*) from public.visite where cantiere_id=oid and elimina=0), 'il lotto conta le sue';
  select count(*) into n from public.visite_complesso(mid);
  assert n=tot, 'visite_complesso: tutte le visite dei lotti: '||n||' su '||tot;
  assert (select count(*) from public.visite_complesso(mid) where lotto is null)=0, 'ogni visita ha il suo lotto';
  assert (select count(*) from public.visite_complesso(mid) where acc_lotto is null or acc_complesso is null)=0, 'ogni visita ha i due numeri';

  -- dividere: l'ultima visita del principale va su un lotto nuovo «3»
  select v.visita_id, v.stato, v.acc_cant into vid, vstato, vacc from public.visite v where v.cantiere_id=mid and v.elimina=0 order by v.data_visita desc, v.visita_id desc limit 1;
  select count(*) into nvis from public.visite where cantiere_id=mid and elimina=0;
  r := public.sposta_visite_in_lotti(mid, null, jsonb_build_array(jsonb_build_object('visita_id', vid, 'lotto', '3')));
  assert (r->>'ok')::boolean and (r->>'spostate')::int=1, 'una visita spostata: '||r::text;
  assert jsonb_array_length(r->'lotti_creati')=1, 'il lotto 3 è nato';
  nid := r->'lotti_creati'->0->>'cantiere_id';
  assert (select cantiere_id from public.visite where visita_id=vid)=nid, 'la visita sta sul lotto nuovo';
  assert (select lotto from public.cantieri where cantiere_id=nid)='3' and (select lotto_di from public.cantieri where cantiere_id=nid)=mid, 'lotto 3 del complesso';
  assert (select count(*) from public.visite where cantiere_id=mid and elimina=0)=nvis-1, 'il principale ne ha una in meno';
  if vstato='definitivo' then
    assert (select acc_cant from public.visite where visita_id=vid) is not distinct from vacc, 'il definitivo tiene il numero stampato';
  else
    assert (select acc_cant from public.visite where visita_id=vid)='1', 'la bozza riprende il numero dal lotto';
  end if;
  assert (select count(*) from public.cantieri_correzioni where cantiere_id=nid and campo='visita '||vid)=1, 'lo spostamento resta scritto';

  ok:=false; begin perform public.sposta_visite_in_lotti(mid, null, jsonb_build_array(jsonb_build_object('visita_id', vid, 'lotto', '4'))); exception when others then msg:=sqlerrm; ok:=msg like '%non è su questa scheda%'; end;
  assert ok, 'una visita di un''altra scheda si rifiuta: '||coalesce(msg,'(nessun errore)');
  ok:=false; begin perform public.sposta_visite_in_lotti(mid, null, '[]'::jsonb); exception when others then msg:=sqlerrm; ok:=msg like 'Nessuna visita%'; end;
  assert ok, 'senza righe non parte';

  raise notice 'ok — complesso a lotti: adottato %, visite %, lotto nuovo %', oid, tot, nid;
end $$;
rollback;
