-- Test: anche il coordinatore divide le visite in lotti (gestionale, 07/10/2026: 2026_10_07_lotti_coordinatore.sql).
--   · con l'accesso del coordinatore (s_config.coordinatore_email) si leggono modulo originale e intestazioni,
--     visite_complesso dà l'indirizzo originale, sposta_visite_in_lotti riesce.
--   · il rifiuto dell'unione (adotta_lotto_cantiere) al coordinatore NON si prova da qui: s_unioni_autorizzato accetta
--     session_user = postgres, che da riga di comando resta tale anche con «set role authenticated».
-- Tutto dentro una transazione annullata.
begin;
select set_config('request.jwt.claims', json_build_object('email',(select valore from public.s_config where chiave='coordinatore_email'),'role','authenticated',
  'sub',(select u.id::text from auth.users u join public.s_config c on lower(u.email)=lower(c.valore) where c.chiave='coordinatore_email'))::text, true);
set local role authenticated;
do $$
declare mid text; vid text; r jsonb; n int;
begin
  assert public.is_coordinatore(), 'l''accesso di prova deve essere il coordinatore';
  assert not public.is_segreteria(), 'e non la segreteria';
  select count(*) into n from public.visite_modulo_originale; assert n > 0, 'il coordinatore legge il modulo originale';
  select count(*) into n from public.visite_modulo_fonti; assert n > 0, 'e le intestazioni';
  select k.cantiere_id into mid from public.cantieri k
   where coalesce(k.elimina,0)=0 and coalesce(btrim(k.lotto),'')=''
     and (select count(*) from public.visite v where v.cantiere_id=k.cantiere_id and v.elimina=0) >= 2
   order by k.cantiere_id limit 1;
  assert mid is not null, 'serve un cantiere senza lotto con almeno 2 visite';
  select count(*) into n from public.visite_complesso(mid);
  assert n >= 2, 'visite_complesso legge le visite: '||n;
  select v.visita_id into vid from public.visite v where v.cantiere_id=mid and v.elimina=0 order by v.data_visita desc limit 1;
  r := public.sposta_visite_in_lotti(mid, '1', jsonb_build_array(jsonb_build_object('visita_id', vid, 'lotto', '2')));
  assert (r->>'ok')::boolean and (r->>'spostate')::int=1, 'il coordinatore divide: '||r::text;
  raise notice 'ok — il coordinatore divide le visite in lotti (cantiere %)', mid;
end $$;
rollback;
