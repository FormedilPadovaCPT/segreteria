-- Test delle foto dell'uscita senza visita (07/10/2026: gestionale 2026_10_07_incarichi_foto.sql).
-- Con i permessi veri (ruolo authenticated), in una transazione annullata:
--   · il tecnico dell'incarico registra la foto; un altro tecnico no;
--   · il personale la vede; il tecnico non la cancella, la segreteria sì.
begin;

create or replace function pg_temp.come(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated',
    'sub', (select id::text from auth.users where lower(email) = lower(p_email)))::text, true);
$$;
create temp table t_ctx (nid bigint, tec text, altro text);
grant all on t_ctx to authenticated;
insert into t_ctx
select i.id, lower(i.tecnico_email),
       (select lower(t.email) from public.tecnici t where t.attivo and t.email ilike '%@did.%' and lower(t.email) <> lower(i.tecnico_email)
          and exists (select 1 from auth.users u where lower(u.email) = lower(t.email)) limit 1)
  from public.incarichi i
 where i.stato = 'aperto' and exists (select 1 from auth.users u where lower(u.email) = lower(i.tecnico_email))
 order by i.id desc limit 1;

select pg_temp.come((select tec from t_ctx));
set local role authenticated;
do $$
declare c t_ctx; ok boolean; n int;
begin
  select * into c from t_ctx;
  assert c.nid is not null and c.altro is not null, 'serve un incarico aperto e un secondo tecnico';
  insert into public.incarichi_foto (incarico_id, drive_file_id, nome_file) values (c.nid, 'prova-test-31-a', 'prova.jpg');
  assert (select caricata_da from public.incarichi_foto where drive_file_id = 'prova-test-31-a') = c.tec, 'scritto chi l''ha caricata';
  delete from public.incarichi_foto where drive_file_id = 'prova-test-31-a';
  get diagnostics n = row_count;
  assert n = 0, 'il tecnico non cancella le foto';
end $$;
reset role;

select pg_temp.come((select altro from t_ctx));
set local role authenticated;
do $$
declare c t_ctx; ok boolean := false;
begin
  select * into c from t_ctx;
  begin insert into public.incarichi_foto (incarico_id, drive_file_id) values (c.nid, 'prova-test-31-b');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un altro tecnico non aggiunge foto a un incarico non suo';
  assert exists (select 1 from public.incarichi_foto where drive_file_id = 'prova-test-31-a'), 'il personale le vede';
end $$;
reset role;

select pg_temp.come('cptpd@did.formedilpadova.it');
set local role authenticated;
do $$ declare n int; begin
  delete from public.incarichi_foto where drive_file_id = 'prova-test-31-a';
  get diagnostics n = row_count;
  assert n = 1, 'la segreteria la toglie';
  raise notice 'OK 31_incarichi_foto';
end $$;
reset role;

rollback;
