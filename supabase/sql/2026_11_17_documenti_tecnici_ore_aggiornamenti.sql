-- Documenti dei tecnici: attestato di base + aggiornamenti a ore (17/11/2026).
-- Il coordinatore deve fare 40 ore di aggiornamento ogni 5 anni, anche in piu'
-- moduli (art. 98 e all. XIV D.Lgs. 81/2008; interpello 19/2014); il formatore
-- 24 ore ogni 3 anni, di cui 8 in corsi di aggiornamento, oppure 24 ore di
-- docenza (D.I. 6/3/2013). Prima l'app guardava solo l'ultima riga: un corso
-- da 4 ore faceva ripartire la validita'. Ora ogni riga puo' dire di che tipo
-- e' e quante ore vale; il conteggio sta in js/doc-tecnici-ore.js.
-- Le righe esistenti non cambiano: senza «tipo» restano valutate dalla loro
-- data di fine, come prima.

alter table public.s_doc_requisito
  add column if not exists ore_soglia int,
  add column if not exists ore_soglia_corsi int,
  add column if not exists docenza_alternativa boolean not null default false,
  add column if not exists recupero_ore boolean not null default false,
  add column if not exists origine_requisito_id int references public.s_doc_requisito(id);

alter table public.s_doc_tecnico
  add column if not exists tipo text,
  add column if not exists ore numeric(6,1),
  add column if not exists ore_di_corso numeric(6,1);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 's_doc_tecnico_tipo_chk') then
    alter table public.s_doc_tecnico add constraint s_doc_tecnico_tipo_chk
      check (tipo is null or tipo in ('attestato', 'aggiornamento', 'docenza'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 's_doc_tecnico_ore_chk') then
    alter table public.s_doc_tecnico add constraint s_doc_tecnico_ore_chk
      check ((ore is null or ore >= 0) and (ore_di_corso is null or ore_di_corso >= 0));
  end if;
end $$;

comment on column public.s_doc_tecnico.tipo is 'attestato (base), aggiornamento o docenza; vuoto = riga vecchia, valutata dalla sua data di fine';
comment on column public.s_doc_tecnico.ore is 'ore dell''aggiornamento o della docenza';
comment on column public.s_doc_tecnico.ore_di_corso is 'di cui in corsi di aggiornamento (conta per la soglia dei corsi del formatore)';
comment on column public.s_doc_requisito.ore_soglia is 'ore di aggiornamento richieste per periodo (durata_mesi); vuoto = requisito senza conteggio a ore';
comment on column public.s_doc_requisito.origine_requisito_id is 'requisito da cui parte il conteggio se manca l''attestato proprio (aggiornamento coordinatore -> corso 120 ore)';

-- catalogo: aggiornamento coordinatore (codice agg_coordinatore) e formatori
update public.s_doc_requisito
   set ore_soglia = 40, recupero_ore = true,
       origine_requisito_id = (select id from public.s_doc_requisito where codice = 'corso_120h')
 where codice = 'agg_coordinatore';
update public.s_doc_requisito
   set ore_soglia = 24, ore_soglia_corsi = 8, docenza_alternativa = true
 where codice = 'formatori';

-- Simonetto: l'attestato del 2016 e' la base, la scadenza la calcola l'app
update public.s_doc_tecnico
   set tipo = 'attestato', data_fine = null
 where protocollo_txt = 'Prot_26-27_0154'
   and requisito_id = (select id from public.s_doc_requisito where codice = 'formatori');
