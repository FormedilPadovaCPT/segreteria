-- 07/10/2026 — L'USCITA SENZA VERBALE SI PAGA COME UNA VISITA (deciso dall'utente).
-- Quando il tecnico va sul posto per un incarico e il cantiere è finito o non c'è, registra l'esito senza visita
-- (gestionale, 2026_10_07_incarichi_esito_senza_visita.sql). s_prestazioni_calcola_interna, parte e): quell'uscita
-- entra nella chiusura del mese in cui è andato, con la tariffa della visita. La parte c) (servizi con corrispettivo)
-- esclude gli incarichi con esito, così la stessa uscita non compare due volte. Il resto della funzione è quello
-- del 07/10/2026 (asseverazioni a fine processo).

begin;

create or replace function public.s_prestazioni_calcola_interna(p_tecnico text, p_anno integer, p_mese integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dal date := make_date(p_anno, p_mese, 1);
  v_al  date := (make_date(p_anno, p_mese, 1) + interval '1 month - 1 day')::date;
  v_email text;
  v_cognome text;
  v_out jsonb := '[]'::jsonb;
begin
  select lower(email), tecnico_cognome into v_email, v_cognome from public.tecnici where tecnico_id = p_tecnico;

  /* a) visite */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'visita', 'visita_id', v.visita_id, 'nr_verbale', v.nr_verbale,
      'data', v.data_visita, 'stato_visita', v.stato,
      'tipo', t.tipo, 'tariffa_codice', t.tipo,
      'tariffa_unitaria', public.s_tariffa(t.tipo, v.data_visita, p_tecnico),
      'quantita', 1, 'unita', 'visita',
      'importo', public.s_tariffa(t.tipo, v.data_visita, p_tecnico),
      'descrizione', concat_ws(' — ', coalesce(i.impresa_nome, v.impresa_rl_nome), c.comune_nome,
                       case when v.senza_rapporto then 'stage senza rapporto' else null end,
                       case when v.rlst_sn then 'con RLST' else null end),
      'impresa', coalesce(i.impresa_nome, v.impresa_rl_nome), 'comune', c.comune_nome,
      'accesso_n', v.acc_cant, 'tipo_accesso', v.tipo_accesso, 'rlst', v.rlst_sn, 'stage', coalesce(v.stage_vis, false) or v.senza_rapporto,
      'progetto_id', v.progetto_id, 'cantiere_id', v.cantiere_id,
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by v.data_visita, v.nr_verbale)
    from public.visite v
    left join public.imprese i on i.impresa_id = v.impresa_id
    left join public.cantieri c on c.cantiere_id = v.cantiere_id
    left join public.s_prestazioni p on p.visita_id = v.visita_id
    cross join lateral (select case
        when v.senza_rapporto or coalesce(v.stage_vis, false) or v.tipo_accesso = 9 then 'visita_stage'
        when v.progetto_id is not null and v.progetto_id not in (14) then 'visita_progetto'
        when coalesce(nullif(regexp_replace(coalesce(v.acc_cant, ''), '\D', '', 'g'), ''), '1')::int > 1 and public.s_tariffa('visita_successiva', v.data_visita, p_tecnico) is distinct from public.s_tariffa('visita_prima', v.data_visita, p_tecnico) then 'visita_successiva'
        else 'visita_prima' end as tipo) t
    where v.tecnico_id = p_tecnico and v.elimina is distinct from 1
      and v.data_visita between v_dal and v_al
  ), '[]'::jsonb);

  /* a2) visite stage fuori provincia, senza verbale (s_visite_stage) */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'stage', 'visita_stage_id', s.id,
      'data', s.data, 'tipo', 'visita_stage', 'tariffa_codice', 'visita_stage',
      'tariffa_unitaria', public.s_tariffa('visita_stage', s.data, p_tecnico),
      'quantita', 1, 'unita', 'visita',
      'importo', public.s_tariffa('visita_stage', s.data, p_tecnico),
      'descrizione', concat_ws(' — ', s.azienda, concat_ws(' ', s.comune, case when s.provincia is not null then '(' || s.provincia || ')' end), 'stage fuori provincia senza verbale', case when s.stagista is not null then 'stagista ' || s.stagista end),
      'impresa', s.azienda, 'comune', s.comune, 'stage', true, 'rlst', false, 'tipo_accesso', 9, 'progetto_id', 15,
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by s.data)
    from public.s_visite_stage s
    left join public.s_prestazioni p on p.visita_stage_id = s.id
    where s.tecnico_id = p_tecnico and s.stato = 'registrata' and s.data between v_dal and v_al
  ), '[]'::jsonb);

  /* b) docenze (lettere di incarico dei corsi) */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'docenza', 'corso_incarico_id', k.id, 'corso_id', k.corso_id,
      'data', coalesce(k.data_incarico, c.data_inizio),
      'tipo', 'docenza', 'tariffa_codice', 'docenza_ora',
      'tariffa_unitaria', coalesce(k.tariffa_oraria, public.s_tariffa('docenza_ora', coalesce(k.data_incarico, c.data_inizio)::date, p_tecnico)),
      'quantita', coalesce(k.ore, 0), 'unita', 'ora',
      'importo', coalesce(k.corrispettivo, coalesce(k.ore, 0) * coalesce(k.tariffa_oraria, public.s_tariffa('docenza_ora', coalesce(k.data_incarico, c.data_inizio)::date, p_tecnico))),
      'descrizione', concat_ws(' — ', 'Corso n° ' || k.corso_id, c.titolo),
      'progetto_id', c.progetto_id, 'prot_out_id', k.protocollo_out_id,
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by k.data_incarico)
    from public.s_corsi_incarichi k
    join public.s_corsi c on c.id = k.corso_id
    left join public.s_prestazioni p on p.corso_incarico_id = k.id
    where coalesce(k.data_incarico, c.data_inizio) between v_dal and v_al
      and (
        exists (select 1 from public.persone pe join public.tecnici t on lower(t.email) = lower(pe.email) where pe.persona_id = k.persona_id and t.tecnico_id = p_tecnico)
        or (v_cognome is not null and k.nominativo ilike '%' || v_cognome || '%')
      )
  ), '[]'::jsonb);

  /* c) servizi con corrispettivo (incarichi del gestionale) */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'incarico', 'incarico_id', i.id,
      'data', coalesce(i.eseguito_il::date, i.data_risposta, i.data_richiesta),
      'tipo', case when coalesce(i.tipologia_richiesta, i.tipo_richiesta, i.oggetto, '') ilike '%conferenz%' then 'conferenza'
                   when coalesce(i.tipologia_richiesta, i.tipo_richiesta, i.oggetto, '') ilike '%consulen%' then 'consulenza'
                   else 'altro' end,
      'tariffa_codice', null,
      'tariffa_unitaria', i.corrispettivo, 'quantita', coalesce(i.ore, 1), 'unita', 'ora',
      'importo', i.corrispettivo * coalesce(i.ore, 1),
      'descrizione', concat_ws(' — ', 'Incarico n° ' || i.id, coalesce(i.tipologia_richiesta, i.tipo_richiesta), i.impresa, i.comune),
      'avviso', case when i.visita_id is not null or exists (select 1 from public.visite vv where vv.prot_int = i.id::text)
                     then 'ha una visita collegata: se già conteggiata fra le visite, non aggiungere' else null end,
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by i.data_richiesta)
    from public.incarichi i
    left join public.s_prestazioni p on p.incarico_id = i.id
    where lower(coalesce(i.tecnico_email, '')) = coalesce(v_email, '')
      and coalesce(i.corrispettivo, 0) > 0
      and i.esito_senza_visita is null   -- 07/10/2026: l'uscita senza verbale si paga come visita, parte e)
      and coalesce(i.eseguito_il::date, i.data_risposta, i.data_richiesta) between v_dal and v_al
  ), '[]'::jsonb);

  /* d) asseverazioni — dal 07/10/2026 SOLO A FINE PROCESSO (regola dell'utente: «i compensi previsti per le
        asseverazioni vanno in pagamento esclusivamente a fine processo, quando si arriva alla commissione, non
        prima»): la pratica deve essere arrivata alla CPTC (delibera o parere, oppure stato parere_emesso,
        delibera_cptc, asseverata, diniego) e il mese è quello della delibera. Prima bastava la data di fine
        verifica o, in mancanza, quella dell'incarico: pratiche ancora al «piano» risultavano da pagare.
        Dal 17/09/2026 per
        componente del gruppo, con le giornate registrate (vedi migrazione
        2026_09_17_prestazioni_asseverazione_giornate_registrate.sql) */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'asseverazione', 'a_pratica_id', x.id, 'numero_protocollo', x.numero_protocollo,
      'data', x.data_rif,
      'tipo', 'asseverazione', 'tariffa_codice', 'asseverazione_giorno',
      'tariffa_unitaria', x.tariffa,
      'quantita', x.quantita, 'unita', 'giorno',
      'importo', case when x.compenso_incarico is not null and x.compenso_incarico > 0
                        and (x.registrate is null or x.registrate = x.previste)
                      then x.compenso_incarico
                      else round(x.quantita * x.tariffa, 2) end,
      'giornate_registrate', x.registrate, 'giornate_previste', x.previste,
      'ruolo_gdv', x.ruolo,
      'descrizione', concat_ws(' — ', 'Asseverazione ' || coalesce(x.numero_protocollo, ''), x.tipo, x.impresa_nome,
                       case when x.ruolo = 'osservatore' then 'osservatore' end),
      'avviso', case
        when p.id is not null then null   -- già registrata: vale la prestazione salvata
        when x.registrate is null and x.previste is null
          then 'nessuna giornata registrata né prevista: 1 giorno proposto, da verificare'
        when x.registrate is null
          then 'nessuna giornata registrata da questo tecnico: vale l''incarico (' || x.previste || ' gg)'
        when x.previste is not null and x.registrate <> x.previste
          then 'giornate registrate ' || x.registrate || ' gg, incarico ' || x.previste || ' gg'
               || case when x.compenso_incarico > 0 then ' (compenso dell''incarico ' || x.compenso_incarico || ' €)' else '' end
               || ': la proposta segue il registrato'
        else null end,
      'progetto_id', 18,
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by x.data_rif)
    from (
      select a.id, a.numero_protocollo, a.tipo::text as tipo, id_imp.impresa_nome,
             coalesce(a.data_delibera, a.data_parere, a.data_rilascio_asseverazione, a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico) as data_rif,
             g.ruolo,
             reg.gu as registrate,
             coalesce(nullif(g.giornate, 0), a.incarico_giornate) as previste,
             coalesce(reg.gu, nullif(g.giornate, 0), a.incarico_giornate, 1) as quantita,
             coalesce(nullif(g.tariffa_giornaliera, 0), a.incarico_tariffa_giornaliera,
                      public.s_tariffa('asseverazione_giorno', coalesce(a.data_fine_verifica, a.data_incarico)::date, p_tecnico)) as tariffa,
             coalesce(g.compenso, case when g.id is null then a.incarico_compenso end) as compenso_incarico
      from public.a_pratica a
      left join public.imprese id_imp on id_imp.impresa_id = a.impresa_id::text
      left join lateral (
        select q.id, q.ruolo, q.giornate, q.tariffa_giornaliera, q.compenso
        from public.a_pratica_gdv q
        where q.pratica_id = a.id and q.tecnico_id = p_tecnico
        order by (q.ruolo = 'verificatore') desc, q.ordine
        limit 1) g on true
      left join lateral (
        select case when count(*) = 0 then null else
                 round(((coalesce(sum(extract(epoch from (r.ora_alle - r.ora_dalle)) / 3600.0)
                                  filter (where r.ora_dalle is not null and r.ora_alle is not null), 0) / 8.0)
                        + (count(distinct r.data)
                           - count(distinct r.data) filter (where r.ora_dalle is not null and r.ora_alle is not null))
                       ) * 2) / 2.0 end as gu
        from public.a_pratica_giornata r
        where r.pratica_id = a.id and r.tecnico_id = p_tecnico) reg on true
      where coalesce(a.data_delibera, a.data_parere, a.data_rilascio_asseverazione, a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico)::date between v_dal and v_al
        and (a.data_delibera is not null or a.data_parere is not null
             or a.stato::text in ('parere_emesso', 'delibera_cptc', 'asseverata', 'diniego'))
        and (
          (g.id is not null and (g.ruolo = 'verificatore' or coalesce(g.compenso, 0) > 0))
          or (not exists (select 1 from public.a_pratica_gdv q2 where q2.pratica_id = a.id)
              and (a.tecnico_principale::text = p_tecnico or a.tecnico_verificatore2::text = p_tecnico))
        )
    ) x
    left join public.s_prestazioni p on p.a_pratica_id = x.id and p.tecnico_id = p_tecnico
  ), '[]'::jsonb);

  /* e) uscite senza verbale (07/10/2026, deciso dall'utente): il tecnico è andato sul posto per un incarico ma il
        cantiere era finito o non c'era. Si paga come una visita, nel mese in cui è andato. */
  v_out := v_out || coalesce((
    select jsonb_agg(jsonb_build_object(
      'sorgente', 'senza_visita', 'incarico_id', i.id,
      'data', i.esito_data, 'tipo', 'visita_prima', 'tariffa_codice', 'visita_prima',
      'tariffa_unitaria', public.s_tariffa('visita_prima', i.esito_data, p_tecnico),
      'quantita', 1, 'unita', 'visita',
      'importo', public.s_tariffa('visita_prima', i.esito_data, p_tecnico),
      'descrizione', concat_ws(' — ', 'Incarico n° ' || i.id,
                       case i.esito_senza_visita when 'cantiere_finito' then 'uscita senza verbale: cantiere già finito'
                                                 when 'cantiere_non_trovato' then 'uscita senza verbale: cantiere non trovato'
                                                 else 'uscita senza verbale' end,
                       i.impresa, i.comune),
      'impresa', i.impresa, 'comune', i.comune, 'rlst', false,
      'avviso', 'nessun verbale: ' || left(coalesce(i.esito_nota, ''), 140),
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id, 'chiusa_il', p.chiusa_il
    ) order by i.esito_data)
    from public.incarichi i
    left join public.s_prestazioni p on p.incarico_id = i.id
    where lower(coalesce(i.tecnico_email, '')) = coalesce(v_email, '')
      and i.esito_senza_visita is not null
      and i.esito_data between v_dal and v_al
  ), '[]'::jsonb);

  return v_out;
end $function$;

commit;
