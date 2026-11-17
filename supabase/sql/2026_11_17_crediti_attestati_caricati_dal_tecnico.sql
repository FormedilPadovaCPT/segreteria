-- Crediti formativi: il tecnico carica i suoi attestati, la segreteria convalida (17/11/2026)
--
-- Deciso dall'utente: ognuno carica per sé (il Coordinatore no, non è il suo
-- lavoro), senza protocollo (resta nel fascicolo del tecnico come le polizze).
-- Chi registra non è chi dichiara: l'invio del tecnico sta in una tabella a parte
-- e NON entra nel conto delle ore finché la segreteria non lo conferma. Alla
-- conferma nasce la riga di s_doc_tecnico, con i valori che la segreteria ha
-- controllato sul documento.
--
-- Il file lo carica la edge function crediti-attestato (gestionale), che scrive
-- qui col ruolo di servizio dopo averlo messo su Drive in
-- 2_AREE/Team_Tecnici/<cartella del tecnico>/curriculum_e_qualificazione/.

create table if not exists public.s_doc_tecnico_invii (
  id            bigserial primary key,
  tecnico_id    text not null references public.tecnici(tecnico_id),
  requisito_id  integer not null references public.s_doc_requisito(id),
  tipo          text not null check (tipo in ('attestato', 'aggiornamento', 'docenza')),
  data_inizio   date not null,
  ore           numeric check (ore is null or ore > 0),
  ore_di_corso  numeric check (ore_di_corso is null or ore_di_corso >= 0),
  descrizione   text not null,
  ente          text,
  note_tecnico  text,
  nome_file     text not null,
  drive_file_id text not null,
  drive_url     text,
  stato         text not null default 'da_verificare'
                check (stato in ('da_verificare', 'confermato', 'rifiutato')),
  motivo        text,
  doc_id        bigint references public.s_doc_tecnico(id) on delete set null,
  inviato_da    text not null,
  inviato_il    timestamptz not null default now(),
  verificato_da text,
  verificato_il timestamptz,
  check (stato <> 'rifiutato' or nullif(btrim(motivo), '') is not null)
);
create index if not exists s_doc_tecnico_invii_stato on public.s_doc_tecnico_invii (stato, inviato_il);
create index if not exists s_doc_tecnico_invii_tecnico on public.s_doc_tecnico_invii (tecnico_id);

alter table public.s_doc_tecnico_invii enable row level security;
-- la segreteria legge tutto; il tecnico solo i suoi. Nessuno scrive da fuori:
-- l'inserimento passa dalla funzione (ruolo di servizio), conferma e rifiuto
-- dalle due funzioni qui sotto.
drop policy if exists sgr_invii_lettura on public.s_doc_tecnico_invii;
create policy sgr_invii_lettura on public.s_doc_tecnico_invii for select to authenticated
  using (public.is_segreteria() or tecnico_id = public.mio_tecnico_id());
revoke all on public.s_doc_tecnico_invii from anon;
revoke insert, update, delete on public.s_doc_tecnico_invii from authenticated;
grant select on public.s_doc_tecnico_invii to authenticated;

/* ── conferma: nasce la riga che conta, coi valori controllati ── */
create or replace function public.crediti_conferma_invio(
  p_id bigint, p_requisito_id integer, p_tipo text, p_data date,
  p_ore numeric, p_ore_di_corso numeric, p_descrizione text, p_nota text default null)
returns bigint
language plpgsql security definer set search_path to 'public'
as $$
declare
  v public.s_doc_tecnico_invii;
  r public.s_doc_requisito;
  chi text := coalesce(auth.jwt() ->> 'email', 'segreteria');
  nuovo bigint;
begin
  if not public.is_segreteria() then
    raise exception 'solo la segreteria conferma gli attestati caricati dai tecnici';
  end if;
  select * into v from public.s_doc_tecnico_invii where id = p_id for update;
  if not found then raise exception 'invio % non trovato', p_id; end if;
  if v.stato <> 'da_verificare' then raise exception 'invio % già %', p_id, v.stato; end if;
  select * into r from public.s_doc_requisito where id = p_requisito_id;
  if not found then raise exception 'requisito % non trovato', p_requisito_id; end if;
  if p_tipo not in ('attestato', 'aggiornamento', 'docenza') then raise exception 'tipo % non valido', p_tipo; end if;
  if p_tipo = 'docenza' and not coalesce(r.docenza_alternativa, false) then
    raise exception 'per «%» la docenza non vale come aggiornamento', r.descrizione;
  end if;
  if p_data is null or p_data > current_date then raise exception 'data non valida'; end if;
  if p_tipo <> 'attestato' and coalesce(p_ore, 0) <= 0 then raise exception 'mancano le ore'; end if;

  insert into public.s_doc_tecnico
    (tecnico_id, requisito_id, tipo, descrizione, data_inizio, ore, ore_di_corso,
     drive_file_id, drive_url, note, creato_da)
  values
    (v.tecnico_id, p_requisito_id, p_tipo, nullif(btrim(p_descrizione), ''), p_data, p_ore, p_ore_di_corso,
     v.drive_file_id, v.drive_url,
     concat_ws(E'\n',
       'Caricato dal tecnico il ' || to_char(v.inviato_il at time zone 'Europe/Rome', 'DD/MM/YYYY')
         || ' (' || v.inviato_da || '), confermato dalla segreteria il '
         || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY') || '.',
       case when v.ente is not null then 'Ente: ' || v.ente end,
       case when v.note_tecnico is not null then 'Nota del tecnico: ' || v.note_tecnico end,
       nullif(btrim(p_nota), '')),
     chi)
  returning id into nuovo;

  update public.s_doc_tecnico_invii
     set stato = 'confermato', doc_id = nuovo, verificato_da = chi, verificato_il = now(),
         motivo = nullif(btrim(p_nota), '')
   where id = p_id;
  return nuovo;
end $$;

/* ── rifiuto: il motivo lo legge il tecnico nel suo riquadro ── */
create or replace function public.crediti_rifiuta_invio(p_id bigint, p_motivo text)
returns void
language plpgsql security definer set search_path to 'public'
as $$
declare chi text := coalesce(auth.jwt() ->> 'email', 'segreteria');
begin
  if not public.is_segreteria() then
    raise exception 'solo la segreteria rifiuta gli attestati caricati dai tecnici';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'scrivi il motivo: lo legge il tecnico'; end if;
  update public.s_doc_tecnico_invii
     set stato = 'rifiutato', motivo = btrim(p_motivo), verificato_da = chi, verificato_il = now()
   where id = p_id and stato = 'da_verificare';
  if not found then raise exception 'invio % non trovato o già lavorato', p_id; end if;
end $$;

revoke execute on function public.crediti_conferma_invio(bigint, integer, text, date, numeric, numeric, text, text) from public, anon;
revoke execute on function public.crediti_rifiuta_invio(bigint, text) from public, anon;
grant execute on function public.crediti_conferma_invio(bigint, integer, text, date, numeric, numeric, text, text) to authenticated;
grant execute on function public.crediti_rifiuta_invio(bigint, text) to authenticated;

/* ── crediti_formativi(): in più gli invii (il tecnico i suoi, la segreteria tutti
   quelli da verificare e gli ultimi lavorati). Il Coordinatore non li vede: non
   tocca a lui convalidare. ── */
create or replace function public.crediti_formativi()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with chi as (
    select public.is_segreteria() as segr, public.is_coordinatore() as coord, public.mio_tecnico_id() as mio
  ),
  req as (
    select r.* from public.s_doc_requisito r
     where r.attivo and (r.ore_soglia is not null
        or r.id in (select origine_requisito_id from public.s_doc_requisito where origine_requisito_id is not null))
  ),
  tec as (
    select t.tecnico_id, t.tecnico_cognome, t.tecnico_nome, t.asseveratore
      from public.tecnici t, chi
     where coalesce(t.attivo, false) and not coalesce(t.dipendente, false)
       and t.tecnico_id <> 'TEC-PROVA-2026'
       and (chi.segr or chi.coord or t.tecnico_id = chi.mio)
  )
  select jsonb_build_object(
    'ruolo', case when (select segr from chi) then 'segreteria' when (select coord from chi) then 'coordinatore'
                  when (select mio from chi) is not null then 'tecnico' else 'nessuno' end,
    'requisiti', coalesce((select jsonb_agg(to_jsonb(r) - 'note' - 'fonte' order by r.ordine) from req r), '[]'::jsonb),
    'tecnici', coalesce((select jsonb_agg(to_jsonb(t) order by t.tecnico_cognome, t.tecnico_nome) from tec t), '[]'::jsonb),
    'documenti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tecnico_id', d.tecnico_id, 'requisito_id', d.requisito_id, 'tipo', d.tipo,
        'descrizione', d.descrizione, 'data_inizio', d.data_inizio, 'data_fine', d.data_fine,
        'senza_scadenza', d.senza_scadenza, 'ore', d.ore, 'ore_di_corso', d.ore_di_corso,
        'drive_url', case when (select segr from chi) or d.tecnico_id = (select mio from chi) then d.drive_url end))
        from public.s_doc_tecnico d
       where d.tecnico_id in (select tecnico_id from tec)
         and d.requisito_id in (select id from req)), '[]'::jsonb),
    'invii', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.inviato_il desc)
        from public.s_doc_tecnico_invii i, chi
       where (chi.segr and (i.stato = 'da_verificare' or i.verificato_il > now() - interval '30 days'))
          or (i.tecnico_id = chi.mio and (i.stato <> 'confermato' or i.verificato_il > now() - interval '30 days'))), '[]'::jsonb)
  );
$function$;
