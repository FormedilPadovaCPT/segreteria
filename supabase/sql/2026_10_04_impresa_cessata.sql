-- ============================================================
-- Impresa cessata nel Registro Imprese (04/10/2026, chiesto dall'utente:
-- «devo poter mettere l'impresa come cessata (diverso dal cessata cassa
-- edile ceiv)»).
--
-- «Stato in Cassa» (stato_cassa) dice che cosa risulta nella lista della
-- Cassa Edile; questo dice che l'impresa ha chiuso l'attività presso la
-- Camera di Commercio. Sono due fatti diversi: un'impresa può essere
-- sospesa in Cassa e ancora attiva, o cessata in Camera di Commercio e
-- non ancora tolta dalla lista. «stato» resta la nazione della sede.
--
-- La data si scrive com'è sul Registro (o com'è nota); la fonte dice da
-- dove la si è letta. Si scrive dalla scheda della segreteria con
-- s_aggiorna_impresa, che tiene lo storico in s_impresa_audit.
--
-- Nello stesso giro entra fra i campi modificabili anche impresa_cf: il
-- codice fiscale personale del titolare delle ditte individuali, la cui
-- chiave è la partita IVA. La scheda della segreteria non lo mostrava,
-- quella del gestionale sì: le due schede sembravano dire cose diverse.
-- ============================================================

alter table public.imprese
  add column if not exists cessata_il date,
  add column if not exists cessata_fonte text;

comment on column public.imprese.cessata_il is
  'Data di cessazione dell''impresa nel Registro Imprese (Camera di Commercio). Non è lo stato in Cassa Edile (stato_cassa).';
comment on column public.imprese.cessata_fonte is
  'Da dove si è letta la cessazione (es. ufficiocamerale.it, visura, comunicazione dell''impresa).';

CREATE OR REPLACE FUNCTION public.s_aggiorna_impresa(p_id text, p_dati jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  campi_ok text[] := array[
    'impresa_nome','ragione_sociale2','piva','indirizzo','comune','prov','cap','stato',
    'sede_amministrativa','impresa_email_ref','impresa_email2','impresa_email3','pec',
    'pagina_web','impresa_telefono','impresa_telefono2','tel_3','cellulare',
    'ccnl','contratto_ccnl','contratto_ccnl_altro','tipo_impresa','tipologia_impresa',
    'ruolo','numero_addetti','numero_dip_isc_ce_pd','n_inps','n_inail','ance',
    'cod_sdi','cod_socrate','cod_ceiv','cassa_edile','ce','ce_altra','stato_cassa',
    'rspp','att_codice','note_access','tipo_iscrizione_ccia',
    -- 04/10/2026
    'impresa_cf','cessata_il','cessata_fonte'
  ];
  k text;
  v text;
  tipo text;
  vecchio text;
  n_mod int := 0;
  utente text := coalesce(auth.jwt() ->> 'email', 'sistema');
begin
  if not public.is_segreteria() then
    raise exception 'Non autorizzato';
  end if;
  if not exists (select 1 from imprese where impresa_id = p_id) then
    raise exception 'Impresa non trovata';
  end if;

  for k, v in select key, value #>> '{}' from jsonb_each(p_dati) loop
    if not (k = any(campi_ok)) then
      continue;   -- campo non modificabile: ignorato in silenzio
    end if;

    select data_type into tipo from information_schema.columns
     where table_schema = 'public' and table_name = 'imprese' and column_name = k;

    execute format('select %I::text from imprese where impresa_id = $1', k)
      into vecchio using p_id;

    if coalesce(vecchio,'') is distinct from coalesce(v,'') then
      execute format('update imprese set %I = nullif($1,'''')::%s, updated_at = now() where impresa_id = $2',
                     k, tipo)
        using v, p_id;

      insert into public.s_impresa_audit (impresa_id, campo, prima, dopo, utente)
      values (p_id, k, vecchio, v, utente);

      n_mod := n_mod + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'modificati', n_mod);
end $function$;
