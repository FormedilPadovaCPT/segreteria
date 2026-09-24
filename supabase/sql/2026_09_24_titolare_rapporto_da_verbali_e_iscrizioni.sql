-- «Titolare» (e ogni ruolo che e' un RAPPORTO) da verbali e iscrizioni (24/09/2026,
-- decisione dell'utente: «la nomina dovrebbe essere la funzione»).
-- visite_figure_ruoli mappa «presente:titolare» e «presente:socio titolare» sul ruolo 23
-- TITOLARE, che da oggi e' un tipo di rapporto (s_tipi_rapporto.ruolo_id). Le due strade
-- automatiche non creano piu' la nomina:
--   · s_nomine_da_visita: apre il rapporto con l'impresa visitata se non ce n'e' uno in
--     corso, senza data di inizio (il verbale prova il giorno, non da quando);
--   · iscr_nomina_da_ruolo: il rapporto aperto DA QUELLA iscrizione (iscr_registra_rapporto
--     lo apre sempre «dipendente») prende il tipo giusto. Un rapporto gia' in corso di
--     prima non si tocca: lo decide la segreteria.
-- Modifica chirurgica: si sostituisce un pezzo della definizione in vigore e si fallisce
-- se il pezzo non c'e' (la funzione e' cambiata e la patch va riletta).

do $$
declare d text; a text;
begin
  -- ── s_nomine_da_visita ──
  d := pg_get_functiondef('public.s_nomine_da_visita(text, boolean)'::regprocedure);
  a := E'  tentativi integer;\nbegin';
  if strpos(d, a) = 0 then raise exception 's_nomine_da_visita: dichiarazioni non trovate'; end if;
  d := replace(d, a, E'  tentativi integer;\n  tipo_rap  text;\n  rap_es    boolean;\nbegin');
  a := E'    if p_esegui then\n      perform pg_advisory_xact_lock(hashtext(''s_nomine.access_id''));\n    end if;\n    select * into es from public.s_nomine sn';
  if strpos(d, a) = 0 then raise exception 's_nomine_da_visita: punto di inserimento non trovato'; end if;
  d := replace(d, a,
E'    /* un ruolo che e'' un RAPPORTO (titolare, socio...) non diventa nomina:
       si apre il rapporto con l''impresa visitata, se non c''e'' (24/09/2026) */
    tipo_rap := (select t.codice from public.s_tipi_rapporto t where t.ruolo_id = m.ruolo_id);
    if tipo_rap is not null then
      if v.impresa_id is null then
        azione := ''saltata''; dettaglio := etichetta || '': e'''' un rapporto, ma il verbale non ha l''''impresa'';
        return next; continue;
      end if;
      impresa_id := v.impresa_id;
      select exists (select 1 from public.persone_imprese pi
                      where pi.persona_id = pid and pi.impresa_id = v.impresa_id
                        and (pi.data_cessazione is null or pi.data_cessazione >= v.data_visita)) into rap_es;
      if rap_es then
        azione := ''gia_presente''; dettaglio := ''rapporto in corso con l''''impresa'';
      elsif not p_esegui then
        azione := ''rapporto_da_creare''; dettaglio := etichetta;
      else
        insert into public.persone_imprese (persona_id, impresa_id, tipo_rapporto, note)
        values (pid, v.impresa_id, tipo_rap,
                format(''Rilevato dal verbale %s del %s: la persona vi compare come %s. La data di inizio non e'''' documentata dal verbale.'',
                       coalesce(v.nr_verbale, v.visita_id), to_char(v.data_visita, ''DD/MM/YYYY''), etichetta));
        azione := ''rapporto_creato''; dettaglio := etichetta;
      end if;
      return next; continue;
    end if;

' || a);
  execute d;

  -- ── iscr_nomina_da_ruolo ──
  d := pg_get_functiondef('public.iscr_nomina_da_ruolo(uuid, text, text, text, text, bigint, date)'::regprocedure);
  a := 'declare m record; v_ruolo text; v_esiste boolean; nuovo int; v_desc text;';
  if strpos(d, a) = 0 then raise exception 'iscr_nomina_da_ruolo: dichiarazioni non trovate'; end if;
  d := replace(d, a, a || ' v_tipo text; v_n int;');
  a := E'    return jsonb_build_object(''fatto'', false, ''motivo'', ''ruolo che non è una nomina: '' || p_ruolo);\n  end if;\n';
  if strpos(d, a) = 0 then raise exception 'iscr_nomina_da_ruolo: punto di inserimento non trovato'; end if;
  d := replace(d, a, a ||
E'
  /* un ruolo che e'' un RAPPORTO (titolare, socio...) non e'' una nomina (24/09/2026):
     il rapporto aperto da QUESTA iscrizione prende il tipo giusto; uno di prima non si tocca */
  select t.codice into v_tipo from public.s_tipi_rapporto t where t.ruolo_id = m.ruolo_id;
  if v_tipo is not null then
    update public.persone_imprese pi set tipo_rapporto = v_tipo
     where pi.persona_id = p_persona_id and pi.impresa_id = p_impresa_id
       and pi.data_cessazione is null and pi.tipo_rapporto = ''dipendente''
       and pi.note like ''Dichiarato con l''''iscrizione n° '' || p_iscrizione || '' %'';
    get diagnostics v_n = row_count;
    return jsonb_build_object(''fatto'', false, ''rapporto'', v_tipo, ''aggiornato'', v_n > 0,
      ''motivo'', case when v_n > 0 then ''ruolo che è un rapporto: registrato come rapporto «'' || v_tipo || ''»''
                     else ''ruolo che è un rapporto («'' || v_tipo || ''»): nessun rapporto aperto da questa iscrizione da correggere'' end);
  end if;
');
  execute d;
end $$;
