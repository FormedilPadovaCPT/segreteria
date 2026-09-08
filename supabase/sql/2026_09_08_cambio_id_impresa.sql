-- ============================================================================
-- 2026-09-08 — Cambio della chiave di un'impresa (codice fiscale = impresa_id)
--
-- Chiesto dall'utente per l'impresa 04538080286 «A.T.I. Semenzato – Dalle
-- Fratte – Vecchiato», nata dall'import con la P.IVA come chiave, che va
-- portata al codice fiscale DLLMNL76C09B563L. Dal 15/07/2026 la chiave delle
-- imprese è il CF (memoria «Regola impresa_cf»), ma finora cambiarla voleva
-- dire una migrazione a mano: le 9 chiavi esterne sono tutte NO ACTION e non
-- differibili, e ci sono altre 20 colonne `impresa_id` senza vincolo.
--
-- Come funziona `s_cambia_id_impresa(vecchio, nuovo, motivo)`:
--   1. crea la riga nuova come copia di quella vecchia, con impresa_id e
--      impresa_cf = nuovo; la P.IVA resta quella che era (se era vuota e il
--      vecchio codice era una P.IVA, ci finisce lui: il vecchio codice resta
--      cercabile come chiave secondaria);
--   2. sposta sul nuovo codice OGNI colonna `impresa_id` delle tabelle di
--      public (scoperte dal catalogo, non da un elenco scritto a mano: una
--      tabella nuova viene presa da sola) più `cantiere_imprese_previste.impresa_cf`;
--   3. cancella la riga vecchia: se una tabella con vincolo fosse sfuggita,
--      la DELETE fallisce e tutto torna indietro — è la rete di sicurezza;
--   4. lascia traccia in `s_impresa_cambio_id` (con il conteggio per tabella),
--      in `s_impresa_audit` e in `note_access` dell'impresa.
-- Solo la segreteria può chiamarla (o chi opera direttamente sul database).
-- ============================================================================

create table if not exists public.s_impresa_cambio_id (
  id         bigserial primary key,
  vecchio    text not null,
  nuovo      text not null,
  motivo     text,
  utente     text,
  quando     timestamptz not null default now(),
  toccate    jsonb not null default '{}'::jsonb
);
comment on table public.s_impresa_cambio_id is
  'Storico dei cambi di chiave (impresa_id = codice fiscale) fatti con s_cambia_id_impresa: chi, quando, perché, e quante righe per tabella sono state spostate.';
alter table public.s_impresa_cambio_id enable row level security;
drop policy if exists s_impresa_cambio_id_sel on public.s_impresa_cambio_id;
create policy s_impresa_cambio_id_sel on public.s_impresa_cambio_id for select to authenticated using (public.is_segreteria());
revoke all on public.s_impresa_cambio_id from public, anon;
grant select on public.s_impresa_cambio_id to authenticated;

create or replace function public.s_cambia_id_impresa(p_vecchio text, p_nuovo text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vecchio text := upper(trim(coalesce(p_vecchio, '')));
  v_nuovo   text := upper(regexp_replace(coalesce(p_nuovo, ''), '\s', '', 'g'));
  v_utente  text := coalesce(auth.jwt() ->> 'email', 'sistema (' || session_user || ')');
  v_nome    text;
  r         record;
  n         bigint;
  toccate   jsonb := '{}'::jsonb;
  tot       bigint := 0;
begin
  -- chi può: la segreteria dall'app, o chi opera direttamente sul database
  -- (session_user, non current_user: dentro una security definer current_user
  -- è sempre il proprietario, e il controllo non varrebbe nulla)
  if not public.is_segreteria() and session_user <> 'postgres' then
    raise exception 'Non autorizzato: il cambio di chiave è un atto della segreteria';
  end if;
  if v_vecchio = '' or v_nuovo = '' then
    raise exception 'Servono il codice attuale e quello nuovo';
  end if;
  if v_vecchio = v_nuovo then
    raise exception 'Il codice nuovo è uguale a quello attuale';
  end if;
  if not (v_nuovo ~ '^[0-9]{11}$' or v_nuovo ~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$') then
    raise exception 'Il codice nuovo non è né un codice fiscale (16 caratteri) né una partita IVA (11 cifre): %', v_nuovo;
  end if;
  select impresa_nome into v_nome from imprese where impresa_id = v_vecchio;
  if v_nome is null then
    raise exception 'Impresa % non trovata', v_vecchio;
  end if;
  if exists (select 1 from imprese where impresa_id = v_nuovo) then
    raise exception 'Esiste già un''impresa con codice %: qui si cambia la chiave, non si fondono due schede', v_nuovo;
  end if;

  -- le tabelle con la guardia sugli incarichi lasciano passare l'operazione di sistema
  perform set_config('app.incarico_sistema', '1', true);

  -- 1. la riga nuova, copia di quella vecchia con la chiave nuova
  insert into imprese
  select (jsonb_populate_record(null::imprese,
            to_jsonb(i)
            || jsonb_build_object('impresa_id', v_nuovo, 'impresa_cf', v_nuovo)
            || case when (i.piva is null or i.piva = '') and v_vecchio ~ '^[0-9]{11}$'
                    then jsonb_build_object('piva', v_vecchio) else '{}'::jsonb end
            || jsonb_build_object('note_access',
                 concat_ws(E'\n', nullif(i.note_access, ''),
                   format('Codice fiscale (chiave) cambiato da %s a %s il %s da %s%s',
                          v_vecchio, v_nuovo, to_char(now(), 'DD/MM/YYYY'), v_utente,
                          case when nullif(p_motivo, '') is not null then ' — ' || p_motivo else '' end)))
         )).*
    from imprese i where i.impresa_id = v_vecchio;

  -- 2. ogni colonna impresa_id delle tabelle di public (scoperte dal catalogo)
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and ((c.column_name = 'impresa_id' and c.table_name <> 'imprese')
            or (c.table_name = 'cantiere_imprese_previste' and c.column_name = 'impresa_cf'))
     order by c.table_name
  loop
    execute format('update public.%I set %I = $1 where %I = $2', r.table_name, r.column_name, r.column_name)
      using v_nuovo, v_vecchio;
    get diagnostics n = row_count;
    if n > 0 then
      toccate := toccate || jsonb_build_object(r.table_name || '.' || r.column_name, n);
      tot := tot + n;
    end if;
  end loop;

  -- 3. la riga vecchia: se qualche riferimento è rimasto, qui fallisce tutto
  delete from imprese where impresa_id = v_vecchio;

  -- 4. la traccia
  insert into s_impresa_cambio_id (vecchio, nuovo, motivo, utente, toccate)
  values (v_vecchio, v_nuovo, nullif(p_motivo, ''), v_utente, toccate);
  insert into s_impresa_audit (impresa_id, campo, prima, dopo, utente)
  values (v_nuovo, 'impresa_id', v_vecchio, v_nuovo, v_utente);

  return jsonb_build_object('ok', true, 'vecchio', v_vecchio, 'nuovo', v_nuovo,
                            'impresa', v_nome, 'righe_spostate', tot, 'toccate', toccate);
end $$;
revoke execute on function public.s_cambia_id_impresa(text, text, text) from public, anon;
grant execute on function public.s_cambia_id_impresa(text, text, text) to authenticated, service_role;
