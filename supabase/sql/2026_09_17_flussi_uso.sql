-- «Flussi mai usati»: quante volte ogni flusso delle app ha lavorato su un caso
-- vero, e quando la prima e l'ultima volta (17/09/2026, approvato dall'utente).
--
-- Perché: una dozzina di flussi risultano «da collaudare sul primo caso reale».
-- Se il primo caso arriva fra tre mesi nessuno ricorda come funzionano, e
-- l'errore salta fuori davanti all'impresa. Il cruscotto della segreteria li
-- mostra, così si sa quali provare prima che servano.
--
-- Che cosa si conta: solo il lavoro fatto dalle app. Restano fuori lo storico
-- importato (Access, righe con storico_rif, fonte 'access' / 'dnl_access',
-- importato_da_access) e ciò che è stato annullato (protocolli annullati, casi
-- con stato 'annullato'): una prova annullata non è un uso.
--
-- ⚠️ Un flusso nuovo si aggiunge qui in DUE punti: una riga nella union (come si
-- conta) e una riga nell'elenco «values» in fondo (perché compaia anche a zero).

create or replace function public.s_flussi_uso()
returns table (area text, codice text, flusso text, casi integer, primo date, ultimo date)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (select public.is_segreteria()) then
    raise exception 'solo la segreteria' using errcode = '42501';
  end if;

  return query
  with prot as (
    select p.tipo_doc_id, p.data_prot
    from public.s_protocollo p
    where not coalesce(p.annullato, false)
  ), righe(area, codice, flusso, d) as (
    /* ── servizi CPT ── */
    select 'Servizi CPT'::text, 'aut_direttore_app'::text, 'Autorizzazione del Direttore dall''app'::text, x.d
      from (select data_autorizzazione::date d from public.s_segnalazioni where aut_modalita = 'app'
            union all select data_autorizzazione::date from public.s_visite_richieste where aut_modalita = 'app'
            union all select data_autorizzazione::date from public.s_consulenze where aut_modalita = 'app'
            union all select data_autorizzazione::date from public.s_conferenze_cantiere where aut_modalita = 'app'
            union all select data_autorizzazione::date from public.s_attestazioni_dm132 where aut_modalita = 'app'
            union all select data_autorizzazione::date from public.s_ferie_richieste where aut_modalita = 'app') x
    union all select 'Servizi CPT', 'segn_presa_carico', 'Segnalazione: presa in carico al segnalante', pr.data_prot
      from public.s_segnalazioni s join public.s_protocollo pr on pr.id = s.protocollo_out_id and not coalesce(pr.annullato, false)
    union all select 'Servizi CPT', 'rlst_risposta', 'RLST: risposta protocollata all''impresa', data_prot from prot where tipo_doc_id = 52
    union all select 'Servizi CPT', 'rls_iscrizione', 'RLS: iscrizione all''anagrafe', data_prot from prot where tipo_doc_id = 53
    union all select 'Servizi CPT', 'consulenza', 'Consulenza registrata', coalesce(girata_il::date, importato_il::date) from public.s_consulenze
    union all select 'Servizi CPT', 'visita_richiesta', 'Richiesta visita autorizzata', data_autorizzazione::date
      from public.s_visite_richieste where aut_stato = 'approvata'
    union all select 'Servizi CPT', 'notifica_riscontro', 'Cantiere notificato: riscontro', coalesce(riscontro_inviato_il::date, importato_il::date)
      from public.s_notifiche_cantiere where coalesce(fonte, '') <> 'dnl_access' and (riscontro_inviato_il is not null or protocollo_out_id is not null)
    union all select 'Servizi CPT', 'conferenza', 'Conferenza di cantiere', importato_il::date from public.s_conferenze_cantiere
    union all select 'Servizi CPT', 'dm132', 'Attestazione DM 132/2024', importato_il::date from public.s_attestazioni_dm132
    /* ── cantieri critici ── */
    union all select 'Cantieri critici', 'critico_accesso', 'Accesso negato segnalato dal tecnico', created_at::date
      from public.s_cantieri_critici where origine = 'accesso_negato' and storico_rif is null and stato <> 'annullato'
    union all select 'Cantieri critici', 'critico_proposta', 'Proposta SPISAL/ITL dal verbale', created_at::date
      from public.s_cantieri_critici where origine = 'proposta_segnalazione' and storico_rif is null and stato <> 'annullato'
    union all select 'Cantieri critici', 'critico_lettera', 'Lettera di accesso negato all''impresa', data_prot from prot where tipo_doc_id = 67
    union all select 'Cantieri critici', 'critico_organi', 'Segnalazione a SPISAL / ITL', data_prot from prot where tipo_doc_id = 68
    /* ── tecnici: incarichi, fatture, pagamenti ── */
    union all select 'Tecnici', 'inc_mensile', 'Lettera di incarico mensile', data_prot from prot where tipo_doc_id = 62
    union all select 'Tecnici', 'riepilogo_fatturare', 'Riepilogo attività da fatturare', data_prot from prot where tipo_doc_id = 63
    union all select 'Tecnici', 'fattura_registrata', 'Fattura del tecnico registrata', created_at::date
      from public.s_fatture_tecnici where not coalesce(importato_da_access, false)
    union all select 'Tecnici', 'mandato', 'Mandato di pagamento emesso', created_at::date from public.s_mandati_pagamento
    union all select 'Tecnici', 'mandato_visto', 'Visto dell''Amministrazione sul mandato', visto_il::date from public.s_mandati_pagamento where visto_il is not null
    union all select 'Tecnici', 'avviso_pagamento', 'Avviso di pagamento al tecnico', avviso_pagamento_il::date
      from public.s_fatture_tecnici where avviso_pagamento_il is not null
    union all select 'Tecnici', 'stage_senza_verbale', 'Visita stage senza verbale', created_at::date from public.s_visite_stage
    union all select 'Tecnici', 'stage_abbinamenti', 'Abbinamenti allievi-aziende caricati', creato_il::date from public.s_stage_elenchi
    /* ── asseverazione ── */
    union all select 'Asseverazione', 'assev_avviso', 'Avviso di scadenza all''impresa', inviato_il::date from public.a_pratica_avviso where inviato_il is not null
    union all select 'Asseverazione', 'assev_ceiv', 'Verifica prerequisiti alla Cassa Edile', inviato_il::date from public.a_richiesta_ceiv where inviato_il is not null
    union all select 'Asseverazione', 'assev_preventivo', 'Preventivo 5.D.2 protocollato', data_prot from prot where tipo_doc_id = 66
    union all select 'Asseverazione', 'assev_formedil', 'Invio della pratica a FORMEDIL Italia', data_invio_cncpt::date from public.a_pratica where invio_protocollo_id is not null
    /* ── ufficio ── */
    union all select 'Ufficio', 'invia_protocollato', 'Protocollato inviato dall''app', inviata_at::date from public.s_prot_invii where inviata_at is not null
    union all select 'Ufficio', 'ferie', 'Richiesta ferie / permessi', created_at::date from public.s_ferie_richieste
    union all select 'Ufficio', 'post_pubblicato', 'Post pubblicato dalla redazione social', pubblicato_il::date from public.s_post where pubblicato_il is not null
    union all select 'Gestionale', 'push_consegnata', 'Notifica consegnata al telefono di un tecnico', inviata_il::date from public.push_coda where stato = 'inviata'
  )
  select r.area, r.codice, r.flusso,
         count(r.d)::int as casi, min(r.d) as primo, max(r.d) as ultimo
  from righe r
  group by r.area, r.codice, r.flusso
  union all
  /* i flussi senza nemmeno una riga non compaiono nel group by: si
     ricavano dall'elenco dei codici e valgono zero */
  select c.area, c.codice, c.flusso, 0, null::date, null::date
  from (values
    ('Servizi CPT', 'aut_direttore_app', 'Autorizzazione del Direttore dall''app'),
    ('Servizi CPT', 'segn_presa_carico', 'Segnalazione: presa in carico al segnalante'),
    ('Servizi CPT', 'rlst_risposta', 'RLST: risposta protocollata all''impresa'),
    ('Servizi CPT', 'rls_iscrizione', 'RLS: iscrizione all''anagrafe'),
    ('Servizi CPT', 'consulenza', 'Consulenza registrata'),
    ('Servizi CPT', 'visita_richiesta', 'Richiesta visita autorizzata'),
    ('Servizi CPT', 'notifica_riscontro', 'Cantiere notificato: riscontro'),
    ('Servizi CPT', 'conferenza', 'Conferenza di cantiere'),
    ('Servizi CPT', 'dm132', 'Attestazione DM 132/2024'),
    ('Cantieri critici', 'critico_accesso', 'Accesso negato segnalato dal tecnico'),
    ('Cantieri critici', 'critico_proposta', 'Proposta SPISAL/ITL dal verbale'),
    ('Cantieri critici', 'critico_lettera', 'Lettera di accesso negato all''impresa'),
    ('Cantieri critici', 'critico_organi', 'Segnalazione a SPISAL / ITL'),
    ('Tecnici', 'inc_mensile', 'Lettera di incarico mensile'),
    ('Tecnici', 'riepilogo_fatturare', 'Riepilogo attività da fatturare'),
    ('Tecnici', 'fattura_registrata', 'Fattura del tecnico registrata'),
    ('Tecnici', 'mandato', 'Mandato di pagamento emesso'),
    ('Tecnici', 'mandato_visto', 'Visto dell''Amministrazione sul mandato'),
    ('Tecnici', 'avviso_pagamento', 'Avviso di pagamento al tecnico'),
    ('Tecnici', 'stage_senza_verbale', 'Visita stage senza verbale'),
    ('Tecnici', 'stage_abbinamenti', 'Abbinamenti allievi-aziende caricati'),
    ('Asseverazione', 'assev_avviso', 'Avviso di scadenza all''impresa'),
    ('Asseverazione', 'assev_ceiv', 'Verifica prerequisiti alla Cassa Edile'),
    ('Asseverazione', 'assev_preventivo', 'Preventivo 5.D.2 protocollato'),
    ('Asseverazione', 'assev_formedil', 'Invio della pratica a FORMEDIL Italia'),
    ('Ufficio', 'invia_protocollato', 'Protocollato inviato dall''app'),
    ('Ufficio', 'ferie', 'Richiesta ferie / permessi'),
    ('Ufficio', 'post_pubblicato', 'Post pubblicato dalla redazione social'),
    ('Gestionale', 'push_consegnata', 'Notifica consegnata al telefono di un tecnico')
  ) as c(area, codice, flusso)
  where not exists (select 1 from righe r2 where r2.codice = c.codice)
  order by 4, 1, 3;
end
$$;

revoke execute on function public.s_flussi_uso() from public, anon;
grant execute on function public.s_flussi_uso() to authenticated, service_role;

comment on function public.s_flussi_uso() is
  'Per ogni flusso delle app: casi veri (storico importato e annullati esclusi), primo e ultimo uso. Cruscotto segreteria, riquadro «Flussi mai usati».';

/* ── 19/09/2026: i tre flussi del test scritto dal docente ────────────────
   Migrazione applicata a mano sul testo della funzione preso dal database
   (pg_get_functiondef + replace + execute), come per le unioni complete:
   una funzione di 10.000 caratteri non si ricopia a mano.

     dtest_proposta   un test scritto da un docente è arrivato
                      (s_test_proposte, escluse le righe di prova)
     dtest_portato    la segreteria l'ha portato nel test (stato accettata)
     test_modulo      è stata aperta una verifica per modulo (s_test_parti)

   ⚠️ Vale la regola di sempre: un flusso nuovo si aggiunge in DUE punti —
   la riga che lo conta e la riga dell'elenco che lo fa comparire anche a
   zero. Al 19/09/2026 i flussi censiti sono 38, di cui 26 mai usati. */
