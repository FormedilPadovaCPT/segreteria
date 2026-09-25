-- ============================================================
-- DIREZIONE: aggiunte del 25/09/2026, stesso giorno di
-- 2026_09_25_direzione_decisioni.sql, dopo il primo confronto con
-- l'utente su come usare il registro delle questioni:
--
--   1. TERZO ESITO per chi decide: oltre a "decido" e "rinvio",
--      il Direttore (o la Presidenza) può PROPORRE UN INCONTRO a
--      coordinatore e segreteria, con una data facoltativa e una
--      nota. Nuovo stato 'incontro', nuova colonna incontro_data.
--   2. PRIORITÀ: un grado (normale | alta) che l'ufficio o il
--      coordinatore possono impostare — la stessa scelta a due
--      valori già fatta per i cantieri critici (priorita in
--      s_cantieri_critici). Mai chi decide: chi apre e gestisce.
--   3. Le PROPOSTE dal second brain: verificato che la policy di
--      select/update ESCLUDE GIÀ stato='proposta' per il
--      coordinatore (solo la segreteria le vede e le gestisce) —
--      nessuna modifica necessaria, il comportamento voluto era
--      già live dal giorno prima. Righe di verifica in fondo.
-- ============================================================

-- ── 1. priorità ────────────────────────────────────────────
alter table public.s_decisioni add column if not exists priorita text not null default 'normale';
alter table public.s_decisioni drop constraint if exists s_decisioni_priorita_chk;
alter table public.s_decisioni add constraint s_decisioni_priorita_chk check (priorita in ('normale', 'alta'));
comment on column public.s_decisioni.priorita is 'normale | alta. La imposta chi apre o gestisce la questione (ufficio/coordinatore, stessa policy s_decisioni_upd), mai chi decide.';

-- ── 2. il terzo esito: propone un incontro ───────────────────
alter table public.s_decisioni add column if not exists incontro_data date;
comment on column public.s_decisioni.incontro_data is 'Data proposta per l''incontro (facoltativa). Si scrive solo con esito ''incontro'' di s_decisione_rispondi.';

alter table public.s_decisioni drop constraint if exists s_decisioni_stato_check;
alter table public.s_decisioni add constraint s_decisioni_stato_check
  check (stato in ('proposta', 'aperta', 'rinviata', 'decisa', 'incontro', 'chiusa', 'ritirata'));

-- trigger di riga: stessa logica già live (proposta si scrive allo stato dichiarato,
-- la data si corregge finché è proposta, pubblicata_da/il quando esce dalle proposte),
-- più il nuovo stato 'incontro' e la sua colonna fra quelle protette
create or replace function public.s_decisioni_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.aperta_da := coalesce(nullif(v_email, ''), new.aperta_da);
    if new.aperta_da_nome is null then
      select coalesce(
        (select nome from app_ruoli where lower(email) = new.aperta_da and stato = 'attivo' limit 1),
        (select trim(concat_ws(' ', tecnico_nome, tecnico_cognome)) from tecnici where lower(email) = new.aperta_da limit 1))
      into new.aperta_da_nome;
    end if;
    new.stato := case when new.stato = 'proposta' then 'proposta' else 'aperta' end;
    new.decisione := null; new.decisa_da := null; new.decisa_il := null; new.incontro_data := null;
    return new;
  end if;
  new.updated_at := now();
  new.aperta_da := old.aperta_da; new.aperta_da_nome := old.aperta_da_nome; new.created_at := old.created_at;
  if old.stato <> 'proposta' then new.aperta_il := old.aperta_il; end if;   -- sulla proposta la data si può ancora correggere
  if coalesce(current_setting('app.decisione_via_funzione', true), '') <> 'si' then
    new.decisione := old.decisione; new.decisa_da := old.decisa_da; new.decisa_da_email := old.decisa_da_email; new.decisa_il := old.decisa_il;
    new.rinviata_al := old.rinviata_al; new.incontro_data := old.incontro_data;
    if new.stato in ('decisa', 'rinviata', 'incontro') and old.stato not in ('decisa', 'rinviata', 'incontro') then
      raise exception 'La decisione si registra con la funzione s_decisione_rispondi';
    end if;
  end if;
  if old.stato = 'proposta' and new.stato = 'aperta' then
    new.pubblicata_da := v_email; new.pubblicata_il := now();
  end if;
  if new.stato = 'chiusa' and old.stato <> 'chiusa' then
    new.chiusa_da := coalesce(new.chiusa_da, v_email); new.chiusa_il := coalesce(new.chiusa_il, now());
  end if;
  return new;
end $$;

-- cronologia: il nuovo tipo di evento «incontro_proposto», e la priorità fra le modifiche
create or replace function public.s_decisioni_eventi_tg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_tipo text; v_testo text;
begin
  if tg_op = 'INSERT' then
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, v_email, case when new.stato = 'proposta' then 'proposta' else 'apertura' end, new.questione);
    return null;
  end if;
  if new.stato is distinct from old.stato then
    v_tipo := case new.stato when 'decisa' then 'decisione' when 'rinviata' then 'rinvio' when 'incontro' then 'incontro_proposto' when 'chiusa' then 'presa_in_carico'
                             when 'ritirata' then 'ritiro' when 'aperta' then (case when old.stato = 'proposta' then 'pubblicazione' else 'riapertura' end) end;
    v_testo := case new.stato when 'decisa' then new.decisione
                              when 'rinviata' then coalesce('Rinviata al ' || to_char(new.rinviata_al, 'DD/MM/YYYY'), 'Rinviata') || coalesce(': ' || new.decisione, '')
                              when 'incontro' then coalesce('Incontro proposto' || coalesce(' per il ' || to_char(new.incontro_data, 'DD/MM/YYYY'), '') || coalesce(': ' || new.decisione, ''), 'Incontro proposto')
                              when 'ritirata' then new.ritirata_motivo
                              when 'aperta' then (case when old.stato = 'proposta' then 'Resa visibile a Direttore e coordinatore' else null end) else null end;
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, coalesce(new.decisa_da_email, v_email), v_tipo, v_testo);
  elsif new.questione is distinct from old.questione or new.dettaglio is distinct from old.dettaglio
     or new.riguarda is distinct from old.riguarda or new.entro_il is distinct from old.entro_il or new.decisore is distinct from old.decisore
     or new.priorita is distinct from old.priorita then
    insert into s_decisioni_eventi (decisione_id, autore, tipo, testo) values (new.id, v_email, 'modifica',
      case when new.priorita is distinct from old.priorita and new.questione is not distinct from old.questione
             and new.dettaglio is not distinct from old.dettaglio and new.riguarda is not distinct from old.riguarda and new.entro_il is not distinct from old.entro_il and new.decisore is not distinct from old.decisore
           then 'Priorità: ' || new.priorita else new.questione end);
  end if;
  return null;
end $$;

-- la risposta: ora accetta anche 'incontro' (data facoltativa in p_rinvio_al, nota in p_testo)
create or replace function public.s_decisione_rispondi(p_id bigint, p_esito text, p_testo text default null, p_rinvio_al date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_nome text; v_ok boolean := false; v_coord text;
begin
  select * into d from s_decisioni where id = p_id;
  if d.id is null then raise exception 'Questione % non trovata', p_id; end if;
  if d.stato in ('chiusa', 'ritirata') then raise exception 'La questione % è già %', p_id, d.stato; end if;
  if p_esito not in ('decisa', 'rinviata', 'incontro') then raise exception 'Esito non valido: %', p_esito; end if;
  if p_esito = 'decisa' and nullif(trim(coalesce(p_testo, '')), '') is null then raise exception 'Scrivi la decisione'; end if;
  if p_esito = 'rinviata' and (p_rinvio_al is null or p_rinvio_al <= current_date) then raise exception 'Per rinviare serve una data futura'; end if;
  if p_esito = 'incontro' and p_rinvio_al is not null and p_rinvio_al < current_date then raise exception 'La data dell''incontro non può essere nel passato'; end if;
  v_ok := case d.decisore
            when 'direttore'   then coalesce(is_direttore(), false)
            when 'presidenza'  then coalesce(is_presidenza(), false)
            when 'commissione' then coalesce(is_segreteria(), false) or coalesce(is_coordinatore(), false)
          end;
  if not v_ok then raise exception 'La risposta spetta a: %', d.decisore; end if;
  select coalesce(
    (select nome from app_ruoli where lower(email) = v_email and stato = 'attivo' limit 1),
    (select trim(concat_ws(' ', tecnico_nome, tecnico_cognome)) from tecnici where lower(email) = v_email limit 1), v_email) into v_nome;
  perform set_config('app.decisione_via_funzione', 'si', true);
  update s_decisioni set
    stato = p_esito,
    decisione = nullif(trim(coalesce(p_testo, '')), ''),
    rinviata_al = case when p_esito = 'rinviata' then p_rinvio_al else null end,
    incontro_data = case when p_esito = 'incontro' then p_rinvio_al else null end,
    decisa_da = v_nome, decisa_da_email = v_email, decisa_il = now()
  where id = p_id;
  perform set_config('app.decisione_via_funzione', '', true);
  -- avviso a chi aveva aperto la questione (come per decisa/rinviata), più un avviso
  -- dedicato a coordinatore e segreteria quando l'esito è «propone un incontro»:
  -- loro gestiscono il registro, ma potrebbero non essere chi l'ha aperta
  begin
    if d.aperta_da is not null and d.aperta_da <> v_email then
      perform push_accoda(d.aperta_da, 'decisione',
        case p_esito when 'decisa' then 'C''è una decisione' when 'incontro' then 'Proposto un incontro' else 'Una questione è stata rinviata' end,
        case p_esito when 'decisa' then 'Una questione che avevi aperto ha avuto risposta: la trovi nella Zona Coordinatore.'
                     when 'incontro' then 'Per una questione che avevi aperto è stato proposto un incontro: la trovi nella Zona Coordinatore.'
                     else 'Una questione che avevi aperto è stata rinviata: la data è nella Zona Coordinatore.' end,
        './?vista=admin', 'decisione-' || p_id);
    end if;
    if p_esito = 'incontro' then
      select lower(valore) into v_coord from s_config where chiave = 'coordinatore_email';
      if coalesce(v_coord, '') <> '' and v_coord <> v_email then
        perform push_accoda(v_coord, 'incontro_proposto', 'Proposto un incontro',
          'Per una questione della Zona Coordinatore è stato proposto un incontro' || coalesce(' per il ' || to_char(p_rinvio_al, 'DD/MM/YYYY'), '') || '.',
          './?vista=admin', 'incontro-' || p_id);
      end if;
      if 'cptpd@did.formedilpadova.it' <> v_email then
        perform push_accoda('cptpd@did.formedilpadova.it', 'incontro_proposto', 'Proposto un incontro',
          'Per una questione della Zona Coordinatore è stato proposto un incontro' || coalesce(' per il ' || to_char(p_rinvio_al, 'DD/MM/YYYY'), '') || '.',
          './?vista=admin', 'incontro-' || p_id);
      end if;
    end if;
  exception when others then raise warning 's_decisione_rispondi avviso: %', sqlerrm; end;
  return jsonb_build_object('id', p_id, 'stato', p_esito, 'decisa_da', v_nome);
end $$;

-- ── 3. verifica: le proposte del second brain già viste solo dalla segreteria ──
-- (nessuna modifica: s_decisioni_sel e s_decisioni_upd escludono già stato='proposta'
-- per is_coordinatore(), dal giorno prima — vedi commento in testa al file)
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polname = 's_decisioni_sel' and polrelid = 'public.s_decisioni'::regclass
      and pg_get_expr(polqual, polrelid) like '%proposta%'
  ) then
    raise exception 'Attesa la clausola stato<>''proposta'' nella policy s_decisioni_sel: verificare a mano prima di proseguire';
  end if;
end $$;
