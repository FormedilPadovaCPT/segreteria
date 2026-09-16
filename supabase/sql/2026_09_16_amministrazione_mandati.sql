-- ============================================================
-- AMMINISTRAZIONE NELL'APP SEGRETERIA: mandati di pagamento
-- (16/09/2026, chiesto dall'utente)
--
-- Patrizia Bertin (amministrazione@formedilpadova.it) entra nell'app con
-- un ruolo suo, «amministrazione», e vede SOLO la parte contabile:
--   1. il mandato di pagamento arriva per mail con il link all'app;
--   2. lo apre e preme «Presa visione»: l'app registra chi e quando e
--      genera il PDF del mandato col visto e la firma (s_config
--      amministrazione_firma_id), depositato accanto all'originale;
--   3. segna «Pagato il…» sul mandato intero o sulle singole fatture;
--   4. al tecnico parte DA SOLO l'avviso di avvenuto pagamento (edge
--      function avviso-pagamento; scelta dell'utente, eccezione dichiarata
--      alla regola «le mail le manda una persona»).
--
-- Il mandato NON passa dal Direttore (solo in copia): lo firma
-- l'Amministrazione.
--
-- ⚠️ Minimo privilegio: il ruolo «amministrazione» NON è «personale».
-- is_personale() lo esclude, così Patrizia non eredita le ~280 policy su
-- anagrafiche, visite e protocollo. Vede le fatture solo quando sono in un
-- mandato: le fatture in stand-by (e il loro motivo, che è un giudizio sul
-- lavoro del tecnico) non le arrivano.
-- ============================================================

-- ── il ruolo ────────────────────────────────────────────────
create or replace function public.is_amministrazione()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_ruoli
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ruolo = 'amministrazione' and stato = 'attivo'
  );
$$;
revoke execute on function public.is_amministrazione() from public, anon;
grant execute on function public.is_amministrazione() to authenticated, service_role;

create or replace function public.is_personale()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_ruoli
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and stato = 'attivo'
      and ruolo <> 'amministrazione'
  ) or exists (
    select 1 from public.tecnici
    where lower(email) = lower(coalesce(auth.jwt()->>'email',''))
      and coalesce(attivo, true) and coalesce(elimina, 0) = 0
  );
$$;

-- ── colonne ─────────────────────────────────────────────────
alter table public.s_mandati_pagamento
  add column if not exists visto_il timestamptz,
  add column if not exists visto_da text,
  add column if not exists visto_nome text,
  add column if not exists visto_drive_file_id text,
  add column if not exists visto_drive_url text,
  add column if not exists pagato_il date;

comment on column public.s_mandati_pagamento.visto_il is 'Presa visione dell''Amministrazione, registrata dall''app (s_mandato_presa_visione)';
comment on column public.s_mandati_pagamento.visto_drive_file_id is 'PDF del mandato col visto e la firma dell''Amministrazione (l''originale resta in drive_file_id)';
comment on column public.s_mandati_pagamento.pagato_il is 'Data dell''ultimo pagamento, valorizzata quando TUTTE le fatture del mandato risultano pagate';

alter table public.s_fatture_tecnici
  add column if not exists pagata_il date,
  add column if not exists pagata_da text,
  add column if not exists pagamento_estremi text,
  add column if not exists avviso_pagamento_il timestamptz,
  add column if not exists avviso_pagamento_a text,
  add column if not exists avviso_pagamento_esito text,
  add column if not exists avviso_pagamento_dal timestamptz;

comment on column public.s_fatture_tecnici.pagata_il is 'Data del pagamento, segnata dall''Amministrazione o dalla segreteria';
comment on column public.s_fatture_tecnici.avviso_pagamento_il is 'Quando è partito l''avviso di avvenuto pagamento al tecnico (edge function avviso-pagamento)';
comment on column public.s_fatture_tecnici.avviso_pagamento_dal is 'Prenotazione dell''invio: evita due avvisi se la funzione parte due volte insieme';

-- Lo storico: le 609 fatture importate chiuse come «pagata» NON devono
-- ricevere un avviso adesso. Si dichiarano già comunicate.
update public.s_fatture_tecnici
   set avviso_pagamento_esito = 'non inviato: fattura pagata prima del 16/09/2026 (storico)'
 where stato = 'pagata' and avviso_pagamento_il is null and avviso_pagamento_esito is null;

-- ── che cosa vede l'Amministrazione ─────────────────────────
drop policy if exists s_mandati_pagamento_sel on public.s_mandati_pagamento;
create policy s_mandati_pagamento_sel on public.s_mandati_pagamento for select to authenticated
  using ((select is_segreteria()) or (select is_coordinatore()) or (select is_direttore()) or (select is_amministrazione()));

drop policy if exists s_fatture_tecnici_sel on public.s_fatture_tecnici;
create policy s_fatture_tecnici_sel on public.s_fatture_tecnici for select to authenticated
  using ((select is_segreteria()) or (tecnico_id = (select s_mio_tecnico_id())) or (select is_coordinatore())
         or (select is_direttore()) or ((select is_amministrazione()) and mandato_id is not null));

drop policy if exists s_prestazioni_sel on public.s_prestazioni;
create policy s_prestazioni_sel on public.s_prestazioni for select to authenticated
  using ((select is_segreteria()) or (tecnico_id = (select s_mio_tecnico_id())) or (select is_coordinatore())
         or (select is_direttore())
         or ((select is_amministrazione()) and exists (
               select 1 from public.s_fatture_tecnici f
                where f.id = s_prestazioni.fattura_id and f.mandato_id is not null)));

drop policy if exists s_incarichi_mensili_sel on public.s_incarichi_mensili;
create policy s_incarichi_mensili_sel on public.s_incarichi_mensili for select to authenticated
  using ((select is_segreteria()) or (tecnico_id = (select s_mio_tecnico_id())) or (select is_coordinatore())
         or (select is_direttore())
         or ((select is_amministrazione()) and exists (
               select 1 from public.s_fatture_tecnici f
                where f.incarico_mensile_id = s_incarichi_mensili.id and f.mandato_id is not null)));

drop policy if exists s_config_sel on public.s_config;
create policy s_config_sel on public.s_config for select
  using (is_segreteria()
         or (is_direttore() and chiave = any (array['direttore_email', 'direttore_nome', 'direttore_firma_id']))
         or (is_amministrazione() and chiave = any (array['amministrazione_email', 'amministrazione_nome', 'amministrazione_firma_id']))
         or (((select auth.uid()) is not null) and chiave = any (array['didattica_referenti', 'stage_relazione_cc', 'stage_relazione_cartella'])));

-- ── configurazione ──────────────────────────────────────────
insert into public.s_config (chiave, valore) values
  ('amministrazione_nome', 'Bertin Patrizia'),
  ('avviso_pagamento_cc', 'cpt@formedilpadova.it')
on conflict (chiave) do nothing;
-- amministrazione_firma_id si scrive quando c'è la firma scansionata
-- (in _SISTEMA/firme/, come quelle di Direttore e Presidente).

-- ── 1. presa visione ────────────────────────────────────────
-- Solo l'Amministrazione: il visto è suo, la segreteria non lo mette al
-- posto di un altro. Idempotente: una seconda chiamata non sposta la data.
create or replace function public.s_mandato_presa_visione(p_id bigint)
returns public.s_mandati_pagamento
language plpgsql security definer set search_path = public as $$
declare v public.s_mandati_pagamento; v_chi text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_amministrazione() then
    raise exception 'La presa visione del mandato la registra l''Amministrazione';
  end if;
  update public.s_mandati_pagamento
     set visto_il = coalesce(visto_il, now()),
         visto_da = coalesce(visto_da, v_chi),
         visto_nome = coalesce(visto_nome, (select valore from public.s_config where chiave = 'amministrazione_nome'), v_chi)
   where id = p_id
  returning * into v;
  if v.id is null then raise exception 'Mandato % non trovato', p_id; end if;
  return v;
end $$;
revoke execute on function public.s_mandato_presa_visione(bigint) from public, anon;
grant execute on function public.s_mandato_presa_visione(bigint) to authenticated, service_role;

-- Il PDF col visto si genera DOPO la presa visione (data e ora ci vanno
-- stampate sopra): se il deposito fallisce, il visto resta registrato e
-- il documento si rigenera. Lo può ricollegare anche la segreteria.
create or replace function public.s_mandato_visto_documento(p_id bigint, p_drive_file_id text, p_drive_url text)
returns public.s_mandati_pagamento
language plpgsql security definer set search_path = public as $$
declare v public.s_mandati_pagamento;
begin
  if not (public.is_amministrazione() or public.is_segreteria()) then raise exception 'Non autorizzato'; end if;
  update public.s_mandati_pagamento
     set visto_drive_file_id = p_drive_file_id, visto_drive_url = p_drive_url
   where id = p_id and visto_il is not null
  returning * into v;
  if v.id is null then raise exception 'Mandato % senza presa visione: prima il visto, poi il documento', p_id; end if;
  return v;
end $$;
revoke execute on function public.s_mandato_visto_documento(bigint, text, text) from public, anon;
grant execute on function public.s_mandato_visto_documento(bigint, text, text) to authenticated, service_role;

-- ── 2. pagamento ────────────────────────────────────────────
-- Sul mandato intero (p_fatture null) o su alcune fatture. Tocca solo
-- fatture «in mandato»: una fattura già pagata non si ripaga, e una in
-- stand-by non è mai arrivata qui. Quando nel mandato non resta niente da
-- pagare, il mandato prende la data dell'ultimo pagamento.
create or replace function public.s_fatture_segna_pagate(
  p_mandato_id bigint, p_fatture bigint[] default null, p_data date default current_date, p_estremi text default null)
returns bigint[]
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_chi text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not (public.is_amministrazione() or public.is_segreteria()) then raise exception 'Non autorizzato'; end if;
  if p_mandato_id is null then raise exception 'Serve il numero del mandato'; end if;
  if p_data is null or p_data > current_date then raise exception 'La data del pagamento non può essere nel futuro'; end if;

  with agg as (
    update public.s_fatture_tecnici
       set stato = 'pagata', pagata_il = p_data, pagata_da = v_chi,
           pagamento_estremi = nullif(trim(coalesce(p_estremi, '')), ''),
           updated_at = now(), aggiornato_da = v_chi
     where mandato_id = p_mandato_id and stato = 'mandato'
       and (p_fatture is null or id = any (p_fatture))
    returning id
  )
  select coalesce(array_agg(id order by id), '{}') into v_ids from agg;

  update public.s_mandati_pagamento m
     set pagato_il = (select max(f.pagata_il) from public.s_fatture_tecnici f where f.mandato_id = m.id)
   where m.id = p_mandato_id
     and not exists (select 1 from public.s_fatture_tecnici f where f.mandato_id = m.id and f.stato = 'mandato');

  return v_ids;
end $$;
revoke execute on function public.s_fatture_segna_pagate(bigint, bigint[], date, text) from public, anon;
grant execute on function public.s_fatture_segna_pagate(bigint, bigint[], date, text) to authenticated, service_role;

-- ── l'utente ────────────────────────────────────────────────
-- Il ruolo; l'account di accesso (auth) si crea a parte, con l'invito.
insert into public.app_ruoli (email, ruolo, stato, nome)
values ('amministrazione@formedilpadova.it', 'amministrazione', 'attivo', 'Bertin Patrizia — Amministrazione')
on conflict do nothing;
