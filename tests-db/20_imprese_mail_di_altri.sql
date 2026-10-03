-- Test dell'elenco «Imprese con l'indirizzo di un'altra impresa» (gestionale visite, 03/10/2026).
--   · un tecnico non legge l'elenco e non decide: è della sola segreteria;
--   · un'impresa con l'indirizzo che somiglia al nome di un'ALTRA impresa entra nell'elenco, col nome
--     dell'altra; quella a cui l'indirizzo somiglia non ci entra;
--   · «togli» svuota l'indirizzo e lo scrive nelle decisioni; rifarlo viene rifiutato;
--   · «conferma» non cambia la scheda e toglie la riga dall'elenco;
--   · chi non è collegato non può chiamare le funzioni.
-- Tutto dentro una transazione annullata: non resta nessuna riga.
begin;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"franco.caon@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000002"}', true);
do $$
declare ok boolean;
begin
  ok := false;
  begin perform count(*) from public.imprese_mail_di_altri();
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un tecnico non deve poter leggere l''elenco';
  ok := false;
  begin perform public.impresa_mail_decidi('X', 'x@example.it', 'togli');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'un tecnico non deve poter decidere';
end $$;

select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"cptpd@did.formedilpadova.it","sub":"00000000-0000-0000-0000-000000000001"}', true);
do $$
declare r record; j jsonb; ok boolean; msg text; n int;
begin
  insert into public.imprese (impresa_id, impresa_nome, piva, impresa_email_ref) values
    ('TEST-MA-1', 'ZZTESTALFA COSTRUZIONI SRL', '99000000011', 'info@zztestalfa.example'),
    ('TEST-MA-2', 'Beta Qwerty Pavimenti',      '99000000022', 'INFO@zztestalfa.example '),
    ('TEST-MA-3', 'Gamma Uiop Intonaci',        '99000000033', 'info@zztestalfa.example');

  select count(*) into n from public.imprese_mail_di_altri() where impresa_id like 'TEST-MA-%';
  assert n = 2, 'le due imprese con l''indirizzo di ZZTESTALFA dovevano entrare nell''elenco, ne trovo ' || n;
  assert not exists (select 1 from public.imprese_mail_di_altri() where impresa_id = 'TEST-MA-1'),
    'l''impresa a cui l''indirizzo somiglia non è sospetta';
  select * into r from public.imprese_mail_di_altri() where impresa_id = 'TEST-MA-2';
  assert r.titolare_id = 'TEST-MA-1' and r.mail = 'info@zztestalfa.example' and r.colonna = 'impresa_email_ref' and r.condivisa_con = 2,
    'la riga deve dire di chi sembra l''indirizzo, in quale campo sta e con quante altre è condiviso';

  -- togli
  j := public.impresa_mail_decidi('TEST-MA-2', 'info@zztestalfa.example', 'togli');
  assert (j->>'ok')::boolean and j->>'decisione' = 'tolto', 'togli: ' || j::text;
  assert (select impresa_email_ref is null from public.imprese where impresa_id = 'TEST-MA-2'), 'l''indirizzo doveva sparire dalla scheda';
  assert (select impresa_email_ref from public.imprese where impresa_id = 'TEST-MA-1') = 'info@zztestalfa.example', 'l''altra impresa non va toccata';
  assert exists (select 1 from public.imprese_mail_decisioni where impresa_id = 'TEST-MA-2' and mail = 'info@zztestalfa.example' and decisione = 'tolto' and decisa_da = 'cptpd@did.formedilpadova.it'),
    'la decisione deve restare scritta, con l''indirizzo che c''era e chi l''ha presa';
  ok := false;
  begin perform public.impresa_mail_decidi('TEST-MA-2', 'info@zztestalfa.example', 'togli');
  exception when others then msg := sqlerrm; ok := msg like '%non ha (più)%'; end;
  assert ok, 'togliere due volte doveva essere rifiutato: ' || coalesce(msg, '(nessun errore)');

  -- conferma
  j := public.impresa_mail_decidi('TEST-MA-3', 'info@zztestalfa.example', 'conferma');
  assert j->>'decisione' = 'confermato', 'conferma: ' || j::text;
  assert (select impresa_email_ref from public.imprese where impresa_id = 'TEST-MA-3') = 'info@zztestalfa.example', 'confermare non cambia la scheda';
  assert not exists (select 1 from public.imprese_mail_di_altri() where impresa_id like 'TEST-MA-%'), 'dopo le due decisioni nessuna delle imprese di prova deve restare nell''elenco';

  -- una decisione che non esiste
  ok := false;
  begin perform public.impresa_mail_decidi('TEST-MA-3', 'info@zztestalfa.example', 'cancella-tutto');
  exception when others then ok := true; end;
  assert ok, 'una decisione non prevista doveva essere rifiutata';
end $$;

reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.imprese_mail_di_altri()', 'execute')
     and not has_function_privilege('anon', 'public.impresa_mail_decidi(text, text, text)', 'execute'),
    'chi non è collegato non deve poter chiamare le funzioni';
  assert not has_table_privilege('authenticated', 'public.imprese_mail_decisioni', 'insert'),
    'le decisioni si scrivono solo dalla funzione';
end $$;

rollback;
