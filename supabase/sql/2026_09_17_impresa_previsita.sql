-- Scheda impresa pre-visita (gestionale visite)
-- Chiesta dall'utente il 17/09/2026: quando il tecnico sceglie un'impresa nel verbale,
-- deve vedere subito che cosa sa l'ufficio di quell'impresa.
--
-- Che cosa entra (deciso dall'utente):
--   · ultime visite con i rilievi e il rientro previsto
--   · cantieri critici aperti (accessi negati e segnalazioni)
--   · asseverazione in corso o scaduta
--   · RLST SOLO come «richiesta di affidamento inviata il …» — l'ASC non comunica se la prende in carico
--   · stato in Cassa Edile, con la data della lista da cui viene
-- Che cosa NON entra: la formazione dei lavoratori, che è dell'ufficio corsi.
--
-- Una funzione sola, security definer: il tecnico non deve poter leggere per conto suo
-- le pratiche di asseverazione o le pratiche RLST, ma questi pochi dati sì.

create or replace function public.impresa_previsita(p_impresa_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not (select public.is_personale()) then
    raise exception 'Riservato al personale';
  end if;
  if p_impresa_id is null or btrim(p_impresa_id) = '' then
    return null;
  end if;

  select jsonb_build_object(
    'impresa', (
      select jsonb_build_object(
        'id', i.impresa_id,
        'nome', i.impresa_nome,
        'comune', i.comune,
        'prov', i.prov,
        'stato_cassa', i.stato_cassa,
        'cod_ceiv', i.cod_ceiv,
        'lista_al', i.data_agg_access,
        'ccnl', coalesce(nullif(i.contratto_ccnl, ''), i.ccnl),
        'dipendenti_ce', i.numero_dip_isc_ce_pd,
        'rspp', i.rspp
      )
      from imprese i where i.impresa_id = p_impresa_id
    ),

    -- ultime visite: quelle dell'impresa principale e quelle in cui compare fra le presenti
    'visite', (
      select coalesce(jsonb_agg(x order by x->>'data' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'verbale', v.nr_verbale,
          'data', v.data_visita,
          'ipc', v.ipc,
          'nc_piu', coalesce(v.ipc_nc_plus, 0),
          'nc_meno', coalesce(v.ipc_nc_minus, 0),
          'oss', coalesce(v.ipc_oss, 0),
          'ritorno', v.data_ritorno,
          'cantiere', coalesce(nullif(c.cantiere_descrizione, ''),
                               nullif(trim(coalesce(c.cantiere_indirizzo, '') || ' ' || coalesce(c.cantiere_civico, '')), ''),
                               c.cantiere_etichetta),
          'comune', c.comune_nome,
          'tecnico', trim(coalesce(t.tecnico_nome, '') || ' ' || coalesce(t.tecnico_cognome, ''))
        ) as x
        from visite v
        left join cantieri c on c.cantiere_id = v.cantiere_id
        left join tecnici t on t.tecnico_id = v.tecnico_id
        where coalesce(v.elimina, 0) = 0
          and (v.impresa_id = p_impresa_id
               or exists (select 1 from visite_imprese_presenti ip
                          where ip.visita_id = v.visita_id and ip.impresa_id = p_impresa_id))
        order by v.data_visita desc nulls last, v.nr_verbale desc
        limit 5
      ) s
    ),

    -- rientri ancora da fare: ultima visita del cantiere con una data di ritorno e nessuna visita successiva
    'rientri', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'verbale', u.nr_verbale, 'data', u.data_visita, 'ritorno', u.data_ritorno,
               'ipc', u.ipc, 'cantiere', u.cantiere, 'comune', u.comune) order by u.data_ritorno), '[]'::jsonb)
      from (
        select distinct on (v.cantiere_id)
               v.nr_verbale, v.data_visita, v.data_ritorno, v.ipc,
               coalesce(nullif(c.cantiere_descrizione, ''),
                        nullif(trim(coalesce(c.cantiere_indirizzo, '') || ' ' || coalesce(c.cantiere_civico, '')), ''),
                        c.cantiere_etichetta) as cantiere,
               c.comune_nome as comune
        from visite v
        left join cantieri c on c.cantiere_id = v.cantiere_id
        where coalesce(v.elimina, 0) = 0
          and coalesce(c.cantiere_chiuso, false) = false
          and (v.impresa_id = p_impresa_id
               or exists (select 1 from visite_imprese_presenti ip
                          where ip.visita_id = v.visita_id and ip.impresa_id = p_impresa_id))
        order by v.cantiere_id, v.data_visita desc nulls last, v.nr_verbale desc
      ) u
      where u.data_ritorno is not null
    ),

    -- cantieri critici aperti: accesso negato o segnalazione proposta, non ancora chiusi
    'critici', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'data', k.data_evento, 'stato', k.stato, 'origine', k.origine,
               'motivo', k.motivo, 'cantiere', k.cantiere_desc, 'priorita', k.priorita
             ) order by k.data_evento desc), '[]'::jsonb)
      from s_cantieri_critici k
      where k.impresa_id = p_impresa_id
        and k.stato not in ('chiuso', 'annullato')
    ),

    -- asseverazione: l'ultima pratica dell'impresa
    'asseverazione', (
      select jsonb_build_object(
        'numero', a.numero_protocollo,
        'tipo', a.tipo,
        'stato', a.stato,
        'scadenza_attestato', a.data_scadenza_attestato_emesso,
        'protocollo_nazionale', a.protocollo_nazionale,
        'data_delibera', a.data_delibera
      )
      from a_pratica a
      where a.impresa_id = p_impresa_id
      order by coalesce(a.data_delibera, a.data_richiesta) desc nulls last, a.id desc
      limit 1
    ),

    -- RLST: solo che la richiesta di affidamento è partita, e quando
    'rlst', (
      select jsonb_build_object(
        'richiesta_il', coalesce(r.data_comp, r.timestamp_modulo::date),
        'progressivo', r.progressivo
      )
      from s_rlst_pratiche r
      where r.impresa_id = p_impresa_id
      order by coalesce(r.data_comp, r.timestamp_modulo::date) desc nulls last, r.id desc
      limit 1
    )
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.impresa_previsita(text) is
  'Scheda dell''impresa mostrata al tecnico quando la sceglie in un verbale: ultime visite, rientri da fare, cantieri critici aperti, asseverazione, richiesta RLST, stato Cassa Edile. Niente formazione dei lavoratori (ufficio corsi).';

revoke execute on function public.impresa_previsita(text) from public, anon;
grant execute on function public.impresa_previsita(text) to authenticated, service_role;
