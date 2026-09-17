-- Paga dei tecnici per l'asseverazione: giornate registrate, non solo previste
-- (17/09/2026, approvato dall'utente: «bisognerebbe che i dati combaciassero»)
--
-- Fino a oggi s_prestazioni_calcola_interna proponeva per l'asseverazione le
-- giornate PREVISTE dall'incarico della pratica (a_pratica.incarico_giornate),
-- uguali per il 1° e il 2° verificatore. Dal 15/09/2026 ogni giornata di
-- verifica dice chi l'ha fatta (a_pratica_giornata.tecnico_id), e ogni
-- componente ha il proprio incarico (a_pratica_gdv.giornate/tariffa/compenso).
--
-- Ora, per ciascun tecnico:
--   - chi: le righe di a_pratica_gdv (verificatori; osservatori solo se hanno
--     un compenso > 0 — in affiancamento sono senza compenso). Per le pratiche
--     senza righe gdv restano le colonne storiche tecnico_principale /
--     tecnico_verificatore2.
--   - quantità: i GIORNI/UOMO REGISTRATI da quel tecnico, con la stessa regola
--     dell'app asseverazione (riepilogoPerTecnico in src/lib/giornate.ts):
--     ore / 8 più un giorno intero per ogni data senza orari, arrotondato al
--     mezzo giorno. Se non ha registrato niente, valgono le giornate previste
--     del suo incarico (poi quelle della pratica), e la riga lo dice.
--   - quando registrate e previste non coincidono, la riga porta un avviso con
--     i due numeri: la proposta segue il registrato, la segreteria decide.
--   - importo: giorni × tariffa (gdv → pratica → s_tariffa). Un compenso
--     scritto a mano sull'incarico (es. asseveratore esterno) resta com'è se il
--     registrato coincide col previsto; altrimenti si ricalcola e l'avviso
--     riporta il compenso dell'incarico.
--   - la prestazione già registrata si aggancia per pratica E tecnico (prima
--     solo per pratica: con due verificatori le righe si confondevano).
--
-- La funzione si aggiorna sostituendo solo la sezione d): le sezioni a)-c)
-- restano quelle in produzione.

do $migr$
declare
  d text;
  i_da int;
  i_a int;
  nuova text := $sez$  /* d) asseverazioni (verifica conclusa nel mese) — dal 17/09/2026 per
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
      'prestazione_id', p.id, 'fattura_id', p.fattura_id, 'incarico_mensile_id', p.incarico_mensile_id
    ) order by x.data_rif)
    from (
      select a.id, a.numero_protocollo, a.tipo::text as tipo, id_imp.impresa_nome,
             coalesce(a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico) as data_rif,
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
      where coalesce(a.data_fine_verifica, a.data_inizio_verifica, a.data_incarico)::date between v_dal and v_al
        and (
          (g.id is not null and (g.ruolo = 'verificatore' or coalesce(g.compenso, 0) > 0))
          or (not exists (select 1 from public.a_pratica_gdv q2 where q2.pratica_id = a.id)
              and (a.tecnico_principale::text = p_tecnico or a.tecnico_verificatore2::text = p_tecnico))
        )
    ) x
    left join public.s_prestazioni p on p.a_pratica_id = x.id and p.tecnico_id = p_tecnico
  ), '[]'::jsonb);

$sez$;
begin
  d := pg_get_functiondef('public.s_prestazioni_calcola_interna(text,integer,integer)'::regprocedure);
  i_da := position('  /* d) asseverazioni' in d);
  i_a := position('  return v_out;' in d);
  if i_da = 0 or i_a = 0 or i_a < i_da then
    raise exception 's_prestazioni_calcola_interna: sezione d) non trovata, niente da fare';
  end if;
  d := substr(d, 1, i_da - 1) || nuova || substr(d, i_a);
  execute d;
end
$migr$;

-- i permessi non cambiano con CREATE OR REPLACE: la funzione interna resta
-- senza grant, la chiama solo l'involucro s_prestazioni_calcola
