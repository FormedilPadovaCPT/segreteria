-- Tecnico verificatore UNI 11751-2: qualifica e mantenimento (18/11/2026, chiesto dall'utente)
--
-- Norma (copia CNCPT in 3_RISORSE/Normativa/UNI e norme tecniche/, letta con OCR il 18/11/2026):
--  - 6.1, prospetto 5, criterio 2: corso auditor 40 h + corso 16 h dell'OP + almeno 10 giorni
--    di attività di verifica in affiancamento (qualifica);
--  - 6.2: nel triennio almeno tre verifiche di asseverazione «della durata di almeno 6 g/u,
--    anche in affiancamento» e almeno 16 h di aggiornamento su MOG, SGSL, audit.
-- Scelte dell'utente del 18/11/2026: i 6 g/u sono il totale delle verifiche del triennio;
-- contano anche i mantenimenti; l'osservatore conta (affiancamento). Gli affiancamenti fatti
-- prima dell'attestato valgono (FORMEDIL Italia, riportato nella mail di De Marco del 29/07/2026).
-- Il manuale CNCPT 2017 precede la norma e non ne parla.

alter table public.s_doc_requisito
  add column if not exists verifiche_soglia integer,
  add column if not exists verifiche_gu_soglia numeric,
  add column if not exists affiancamento_giorni_soglia numeric;

alter table public.s_doc_tecnico drop constraint if exists s_doc_tecnico_tipo_chk;
alter table public.s_doc_tecnico add constraint s_doc_tecnico_tipo_chk
  check (tipo is null or tipo = any (array['attestato', 'aggiornamento', 'docenza', 'riconoscimento']));

update public.s_doc_requisito set
  ore_soglia = 16, ore_soglia_corsi = null, durata_mesi = 36, preavviso_giorni = 180,
  recupero_ore = false, docenza_alternativa = false, periodo_mobile = false,
  verifiche_soglia = 3, verifiche_gu_soglia = 6, affiancamento_giorni_soglia = 10,
  note = concat_ws(E'\n', nullif(note, ''),
    '18/11/2026: qualifica = attestato del corso 16 h + 10 giorni di verifica in affiancamento (UNI 11751-2, 6.1, criterio 2; valgono anche quelli precedenti all''attestato). Mantenimento, a trienni dall''attestato: 16 ore su MOG, SGSL, audit e almeno 3 verifiche di asseverazione per 6 g/u in tutto (6.2). Contano mantenimenti e osservatore (scelte dell''utente del 18/11/2026). Le verifiche si leggono dall''app asseverazione (asseverazione_verifiche()).')
 where codice = 'uni_11751';

/* gli attestati del corso TV: attestato di base, la scadenza la calcola il conteggio */
update public.s_doc_tecnico set tipo = 'attestato', data_fine = null,
  note = concat_ws(E'\n', note, '18/11/2026: segnato come attestato di base del conteggio UNI 11751-2 (la scadenza la calcola l''app).')
 where requisito_id = (select id from public.s_doc_requisito where codice = 'uni_11751') and tipo is null;

/* qualifica già riconosciuta */
insert into public.s_doc_tecnico (tecnico_id, requisito_id, tipo, descrizione, data_inizio, note, creato_da)
select t.tecnico_id, r.id, 'riconoscimento', x.descr, x.data::date, x.nota, 'assistente, per cptpd@did.formedilpadova.it'
  from (values
    ('De Marco', 'Qualifica di tecnico verificatore riconosciuta: affiancamenti precedenti al corso ritenuti validi da FORMEDIL Italia', '2026-07-29',
     'Fonte: mail di Nicola De Marco del 29/07/2026 (2_AREE/Asseverazione/_riferimento/2026_07_29_COMU_De-Marco-Nicola_info-asseverazioni-campagna-2026.md): «le giornate di affiancamento fatte prima del corso asseveratori sono valide: può fare l''asseveratore da subito». Confermato dall''utente il 18/11/2026.'),
    ('Balladore', 'Qualifica di tecnico verificatore riconosciuta: asseveratore che opera da solo', '2026-08-06',
     'Fonte: _ROSTER asseveratori (2_AREE/Asseverazione/asseveratori/), «gli asseveratori che possono operare oggi da soli sono Balladore e De Marco», confermato dall''utente il 06/08 e il 09/09/2026; verificatore nelle pratiche 2020-2021.')
  ) x(cognome, descr, data, nota)
  join public.tecnici t on t.tecnico_cognome = x.cognome and t.attivo
  join public.s_doc_requisito r on r.codice = 'uni_11751'
 where not exists (select 1 from public.s_doc_tecnico d where d.tecnico_id = t.tecnico_id and d.requisito_id = r.id and d.tipo = 'riconoscimento');

/* le verifiche dall'app asseverazione: una riga per tecnico e pratica del gruppo di verifica */
create or replace function public.asseverazione_verifiche()
returns table (tecnico_id text, pratica text, tipo text, ruolo text, rgv boolean, data date, gu numeric, giornate numeric)
language sql stable security definer set search_path to 'public'
as $$
  select g.tecnico_id, p.numero_protocollo, p.tipo::text, g.ruolo, coalesce(g.rgv, false),
         coalesce(p.data_fine_verifica::date, p.data_rdv, p.data_rilascio_asseverazione, p.data_inizio_verifica::date),
         p.preventivo_giorni_uomo, g.giornate
    from public.a_pratica_gdv g
    join public.a_pratica p on p.id = g.pratica_id
   where g.tecnico_id is not null
     and (public.is_segreteria() or public.is_coordinatore() or g.tecnico_id = public.mio_tecnico_id())
$$;
revoke execute on function public.asseverazione_verifiche() from public, anon;
grant execute on function public.asseverazione_verifiche() to authenticated;

/* crediti_formativi(): in più le verifiche dei tecnici che vede chi chiede */
do $$ declare d text := pg_get_functiondef('public.crediti_formativi'::regproc);
  vecchio text := $q$    'altri_requisiti', coalesce($q$;
  nuovo text := $q$    'verifiche', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.data) from public.asseverazione_verifiche() v
       where v.tecnico_id in (select tecnico_id from tec)), '[]'::jsonb),
    'altri_requisiti', coalesce($q$;
begin
  if position('''verifiche''' in d) > 0 then return; end if;
  if position(vecchio in d) = 0 then raise exception 'punto di inserimento non trovato'; end if;
  execute replace(d, vecchio, nuovo);
end $$;

/* «Riconoscimento della qualifica» anche nelle due tendine della segreteria e nella conferma
   degli attestati caricati dai tecnici (applicato come migrazione a parte, stesso giorno) */
update public.s_tendine_registro set voci = array['attestato', 'aggiornamento', 'docenza', 'riconoscimento']::text[] where id in ('segr.dtf-tipo', 'segr.dti-tipo');

do $$ declare d text := pg_get_functiondef('public.crediti_conferma_invio(bigint,integer,text,date,numeric,numeric,text,text)'::regprocedure);
begin
  if position('riconoscimento' in d) > 0 then return; end if;
  d := replace(d, $q$if p_tipo not in ('attestato', 'aggiornamento', 'docenza') then$q$, $q$if p_tipo not in ('attestato', 'aggiornamento', 'docenza', 'riconoscimento') then$q$);
  d := replace(d, $q$if p_tipo <> 'attestato' and coalesce(p_ore, 0) <= 0 then$q$, $q$if p_tipo in ('aggiornamento', 'docenza') and coalesce(p_ore, 0) <= 0 then$q$);
  execute d;
end $$;
