-- ============================================================
-- CANTIERI CRITICI: conferma vera anche per Presidenza (25/09/2026,
-- chiesto dall'utente dopo aver letto la chat WhatsApp del gruppo
-- "Area Sicurezza e Salute" — lì si decidono da anni le segnalazioni
-- SPISAL/ITL a colpi di "Procedi"/"Concordo", fuori dall'app).
--
-- Oggi «Demanda a Presidenza / Commissione Sicurezza» (cantieri-critici.js)
-- prepara solo una mail; quello che rispondono lo batte a mano la
-- segreteria in "Registra decisione o conferma" (tipo decisione_organo),
-- sempre per conto loro. Stessa cosa per la conferma del Direttore, ma
-- lì esiste anche la scorciatoia reale: link nell'app, risposta con
-- s_critico_conferma_direttore. Qui si dà la stessa scorciatoia a
-- Presidente e Vicepresidente, e un modo — per segreteria, coordinatore
-- E il Direttore — di coinvolgerli quando serve.
--
-- Nomi veri per i tre account-segnaposto (restano i ruoli, come
-- vuole l'utente: «perché le persone possono cambiare» — email invariate).
-- ============================================================

update public.app_ruoli set nome = 'Andrea Pagnacco'      where lower(email) = 'direzione@formedilpadova.it'      and carica = 'direttore';
update public.app_ruoli set nome = 'Enrico Maria Fabris'  where lower(email) = 'presidente@formedilpadova.it'     and carica = 'presidente';
update public.app_ruoli set nome = 'Benedetto Truppa'     where lower(email) = 'vicepresidente@formedilpadova.it' and carica = 'vicepresidente';

-- ── indirizzi di Presidente e Vicepresidente, stesso schema di direttore_email/coordinatore_email ──
insert into public.s_config (chiave, valore, descrizione) values
  ('presidente_email',     'presidente@formedilpadova.it',     'indirizzo del Presidente: coinvolto sui cantieri critici demandati alla Presidenza'),
  ('vicepresidente_email', 'vicepresidente@formedilpadova.it',  'indirizzo del Vicepresidente: coinvolto sui cantieri critici demandati alla Presidenza')
on conflict (chiave) do nothing;

-- ── 1. coinvolgere la Presidenza: lo può fare segreteria, coordinatore, o il Direttore stesso ──
-- Scrive lo stesso evento 'demandata' che già scrive "Demanda a Presidenza"
-- da segreteria-app, ma con dati.chi='presidenza' tracciato (oggi manca) e
-- avvisa Presidente e Vicepresidente con un link diretto al caso.
create or replace function public.s_critico_coinvolgi_presidenza(p_id bigint, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stato text; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_ev bigint; v_da text; v_pres text; v_vice text;
begin
  if not (coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false)) then
    raise exception 'Puoi farlo solo se sei il Direttore, il coordinatore o la segreteria';
  end if;
  select stato into v_stato from s_cantieri_critici where id = p_id;
  if v_stato is null then raise exception 'Caso % non trovato', p_id; end if;
  if v_stato in ('chiuso', 'annullato') then raise exception 'Il caso % è già %', p_id, v_stato; end if;
  v_da := case when coalesce(is_direttore(), false) then 'Direttore' when coalesce(is_coordinatore(), false) then 'coordinatore' else 'segreteria' end;
  insert into s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
  values (p_id, 'demandata',
          'Coinvolta la Presidenza (chiesto da: ' || v_da || ').' || case when nullif(trim(coalesce(p_nota, '')), '') is not null then ' ' || trim(p_nota) else '' end,
          false, jsonb_build_object('chi', 'presidenza', 'da', v_da, 'via', 'app', 'utente', v_email))
  returning id into v_ev;
  update s_cantieri_critici set stato = 'attesa_decisione' where id = p_id and stato not in ('chiuso', 'annullato');
  begin
    select lower(valore) into v_pres from s_config where chiave = 'presidente_email';
    select lower(valore) into v_vice from s_config where chiave = 'vicepresidente_email';
    if coalesce(v_pres, '') <> '' then
      perform push_accoda(v_pres, 'critico_presidenza', 'Cantieri critici — la Presidenza è coinvolta',
        'C''è un caso da valutare nella pagina Presidenza.', './?vista=direzione', 'critico-pres-' || p_id);
    end if;
    if coalesce(v_vice, '') <> '' then
      perform push_accoda(v_vice, 'critico_presidenza', 'Cantieri critici — la Presidenza è coinvolta',
        'C''è un caso da valutare nella pagina Presidenza.', './?vista=direzione', 'critico-pres-' || p_id);
    end if;
  exception when others then raise warning 's_critico_coinvolgi_presidenza avviso: %', sqlerrm; end;
  return jsonb_build_object('evento_id', v_ev);
end $$;
revoke all on function public.s_critico_coinvolgi_presidenza(bigint, text) from public, anon;
grant execute on function public.s_critico_coinvolgi_presidenza(bigint, text) to authenticated;

-- ── 2. la decisione vera di Presidente o Vicepresidente ──
-- Scrive lo stesso tipo 'decisione_organo' che oggi la segreteria scrive
-- a mano in "Registra decisione o conferma": da qui in poi, se risponde
-- lui/lei stesso/a dall'app, segnalaOrgani() in cantieri-critici.js vede
-- la decisione vera, non più solo quella riportata dalla segreteria.
create or replace function public.s_critico_decide_presidenza(p_id bigint, p_cosa text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stato text; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_carica text; v_chi text; v_ev bigint;
begin
  if not coalesce(is_presidenza(), false) then
    raise exception 'La decisione è riservata a Presidente e Vicepresidente';
  end if;
  if p_cosa not in ('segnalare', 'non_segnalare') then
    raise exception 'Decisione non valida: %', p_cosa;
  end if;
  select stato into v_stato from s_cantieri_critici where id = p_id;
  if v_stato is null then raise exception 'Caso % non trovato', p_id; end if;
  if v_stato in ('chiuso', 'annullato') then raise exception 'Il caso % è già %', p_id, v_stato; end if;
  select mia_carica() into v_carica;
  v_chi := case v_carica when 'presidente' then 'Presidente' when 'vicepresidente' then 'Vicepresidente' else 'Presidenza' end;
  insert into s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
  values (p_id, 'decisione_organo',
          v_chi || ', dall''app il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY "alle" HH24:MI') || ': '
            || case p_cosa when 'segnalare' then 'decide di SEGNALARE agli organi di vigilanza' else 'decide di NON segnalare' end
            || case when nullif(trim(coalesce(p_nota, '')), '') is not null then '. ' || trim(p_nota) else '.' end,
          true, jsonb_build_object('chi', v_chi, 'cosa', p_cosa, 'via', 'app', 'utente', v_email))
  returning id into v_ev;
  return jsonb_build_object('evento_id', v_ev, 'cosa', p_cosa, 'chi', v_chi);
end $$;
revoke all on function public.s_critico_decide_presidenza(bigint, text, text) from public, anon;
grant execute on function public.s_critico_decide_presidenza(bigint, text, text) to authenticated;

-- ── 3. s_direzione_in_attesa: anche la Presidenza vede i propri casi in attesa ──
-- Le autorizzazioni dei servizi CPT restano solo di Direttore/coordinatore/
-- segreteria (nessuna richiesta di estenderle). I critici, per la Presidenza,
-- sono quelli demandati a lei (dati.chi='presidenza') e ancora senza una
-- decisione_organo successiva alla richiesta.
create or replace function public.s_direzione_in_attesa()
returns jsonb language sql stable security definer set search_path = public as $$
  with aut as (
    select 'segnalazione' as tipo, id, progressivo, aut_richiesta_il::date as dal,
           coalesce(nullif(trim(concat_ws(' — ', ind_cantiere, comune_cantiere)), ''), notificante, 'cantiere da individuare') as chi
      from s_segnalazioni where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'consulenza', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_consulenze where aut_stato = 'richiesta' and corsia = 'uscita' and stato not in ('chiusa', 'scartata')
    union all
    select case when tipo_richiesta = 'serie' then 'serie di visite' else 'visita richiesta' end, id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_visite_richieste where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'conferenza di cantiere', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_conferenze_cantiere where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
    union all
    select 'attestazione DM 132', id, progressivo, aut_richiesta_il::date, coalesce(ragione_sociale, 'impresa da individuare')
      from s_attestazioni_dm132 where aut_stato = 'richiesta' and stato not in ('chiusa', 'scartata')
  ),
  ruolo as (
    select case when coalesce(is_presidenza(), false) and not coalesce(is_direttore(), false) then 'presidenza' else 'direttore' end as v
  ),
  crit as (
    select c.id, c.impresa_nome, c.cantiere_desc, c.data_evento,
           (select max(e.created_at) from s_cantieri_critici_eventi e, ruolo
             where e.critico_id = c.id and e.tipo = 'demandata' and e.dati ->> 'chi' = ruolo.v) as chiesta_il
      from s_cantieri_critici c where c.stato not in ('chiuso', 'annullato')
  )
  select case when coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false) or coalesce(is_presidenza(), false)
    then jsonb_build_object(
      'autorizzazioni', case when coalesce(is_direttore(), false) or coalesce(is_coordinatore(), false) or coalesce(is_segreteria(), false)
        then coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'id', id, 'progressivo', progressivo, 'dal', dal, 'chi', chi,
                                   'link', 'https://formedilpadovacpt.github.io/segreteria/#' ||
                                     case tipo when 'segnalazione' then 'segnalazione' when 'consulenza' then 'consulenza'
                                               when 'conferenza di cantiere' then 'conferenza' when 'attestazione DM 132' then 'attestazione' else 'visita' end
                                     || '-' || id) order by dal nulls last) from aut), '[]'::jsonb)
        else '[]'::jsonb end,
      'critici', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'impresa', impresa_nome, 'cantiere', cantiere_desc, 'data_evento', data_evento, 'dal', chiesta_il::date)
                                   order by chiesta_il) from crit, ruolo
                            where chiesta_il is not null and not exists (
                              select 1 from s_cantieri_critici_eventi e2 where e2.critico_id = crit.id
                                 and e2.tipo = case when ruolo.v = 'presidenza' then 'decisione_organo' else 'autorizzazione_direttore' end
                                 and e2.created_at > crit.chiesta_il)), '[]'::jsonb),
      'al', now())
    else jsonb_build_object('autorizzazioni', '[]'::jsonb, 'critici', '[]'::jsonb, 'al', now(), 'non_autorizzato', true) end;
$$;
revoke all on function public.s_direzione_in_attesa() from public, anon;
grant execute on function public.s_direzione_in_attesa() to authenticated;
