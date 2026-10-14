-- ============================================================================
-- 2026_10_14 — Il docente FIRMA la lettera di incarico, e ha l'archivio dei
-- suoi documenti firmati
--
-- Chiesto dall'utente il 14/10/2026: «il docente deve firmare la lettera di
-- incarico, se può scaricarla magari da un archivio dei suoi documenti
-- firmati, perché altrimenti ne esce un elenco infinito col tempo».
--
-- 1. La lettera di docenza va in CATENA: Presidente, poi il docente «per
--    accettazione» (ruolo `docente` in s_firme, riquadro sotto «PER
--    ACCETTAZIONE — il Docente»), come la lettera dell'asseverazione col
--    tecnico incaricato. La firma del docente sulla lettera VALE COME
--    ACCETTAZIONE: il trigger scrive `accettato_il` come faceva il foglio
--    a parte (`accettazione_incarico`, lotto 5), che resta solo per le
--    lettere firmate dal solo Presidente.
-- 2. `corso_docente_corsi`: la lettera è la versione firmata più avanti
--    nella catena (ordine), e c'è la riga del docente (`mia`) con il PDF
--    da leggere, per «Leggi» e «Firmo» dalla pagina del corso.
-- 3. `mie_firme_archivio`: i documenti che chi è collegato ha firmato, per
--    anno e tipo, con il PDF FINALE della catena (quello con tutte le firme,
--    non solo la propria). Lo legge la pagina «🗂️ I miei documenti firmati»
--    del gestionale, separata dagli elenchi di lavoro.
-- 4. Storage: chi ha firmato un documento può aprirne la versione finale
--    anche se l'ultima firma è di un altro.
-- ============================================================================

-- ── 1. la firma del docente sulla lettera = incarico accettato ─────────────
create or replace function public.trg_firme_accettazione_incarico()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.stato = 'firmata' and coalesce(old.stato, '') <> 'firmata' then
    /* il foglio di accettazione a parte (lotto 5) */
    if new.tipo = 'accettazione_incarico' and new.rif like 'incarico:%' then
      update public.s_corsi_incarichi set accettato_il = coalesce(new.firmata_il, now()), accettazione_firma_id = new.id
       where id = split_part(new.rif, ':', 2)::bigint;
    /* (14/10/2026) la firma del docente sulla lettera stessa */
    elsif new.tipo = 'incarico_docenza' and new.firmatario_ruolo = 'docente' and new.rif like 'docenza:%' then
      update public.s_corsi_incarichi set accettato_il = coalesce(new.firmata_il, now()), accettazione_firma_id = new.id
       where id = split_part(new.rif, ':', 2)::bigint and accettato_il is null;
    end if;
  end if;
  return new;
end $$;

-- ── 2. la pagina del docente ───────────────────────────────────────────────
create or replace function public.corso_docente_corsi()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_me uuid := public.mia_persona_id(); v_capo boolean := public.is_segreteria() or public.is_rpf(); v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not v_capo and v_me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'titolo', c.titolo, 'stato', c.stato, 'tipo', c.tipo, 'data_inizio', c.data_inizio, 'data_fine', c.data_fine,
      'sede', c.sede, 'pres_codice', c.pres_codice, 'pres_pubblicato_il', c.pres_pubblicato_il, 'perc_freq_min', c.perc_freq_min,
      'tipologia_id', c.tipologia_id,
      'mio', (v_me is not null and (exists (select 1 from public.s_corsi_interventi i where i.corso_id = c.id and i.persona_id = v_me)
                                  or exists (select 1 from public.s_corsi_incarichi k where k.corso_id = c.id and k.persona_id = v_me))),
      'incarico', (select jsonb_build_object('id', k.id, 'qualita', k.qualita, 'ore', k.ore, 'data_incarico', k.data_incarico,
                     'accettato_il', k.accettato_il, 'protocollo_id', k.protocollo_out_id,
                     /* la versione firmata più avanti nella catena: con tutte e due le firme, se ci sono */
                     'lettera', (select jsonb_build_object('firma_id', f.id, 'stato', f.stato, 'file', f.file_firmato, 'firmata_il', f.firmata_il, 'ruolo', f.firmatario_ruolo)
                                   from public.s_firme f where f.tipo = 'incarico_docenza' and f.rif = 'docenza:' || k.id::text and f.stato in ('in_attesa', 'in_coda', 'firmata')
                                   order by (f.stato = 'firmata') desc, f.ordine desc, f.richiesta_il desc limit 1),
                     /* (14/10/2026) la riga del docente nella catena: firma «per accettazione» */
                     'mia', (select jsonb_build_object('firma_id', f.id, 'stato', f.stato, 'file_originale', f.file_originale, 'file', f.file_firmato, 'firmata_il', f.firmata_il)
                               from public.s_firme f where f.tipo = 'incarico_docenza' and f.rif = 'docenza:' || k.id::text
                                and f.firmatario_ruolo = 'docente' and lower(f.firmatario_email) = v_email
                                and f.stato in ('in_attesa', 'in_coda', 'firmata', 'rimandata')
                              order by f.richiesta_il desc limit 1),
                     'accettazione', (select jsonb_build_object('firma_id', f.id, 'stato', f.stato, 'file', f.file_firmato, 'firmata_il', f.firmata_il)
                                        from public.s_firme f where f.tipo = 'accettazione_incarico' and f.rif = 'incarico:' || k.id::text and f.stato in ('in_attesa', 'firmata')
                                        order by f.richiesta_il desc limit 1))
                   from public.s_corsi_incarichi k where k.corso_id = c.id and v_me is not null and k.persona_id = v_me order by k.id limit 1),
      'iscritti_n', (select count(*) from public.s_corsi_iscritti i where i.corso_id = c.id and coalesce(i.esito, '') not in ('annullato', 'sostituito')),
      'giornate', coalesce((select jsonb_agg(jsonb_build_object(
          'id', g.id, 'data', g.data, 'dalle', to_char(g.dalle, 'HH24:MI'), 'alle', to_char(g.alle, 'HH24:MI'),
          'dalle2', to_char(g.dalle2, 'HH24:MI'), 'alle2', to_char(g.alle2, 'HH24:MI'), 'aula', coalesce(g.aula, g.sede),
          'registro', (select jsonb_build_object('firma_id', f.id, 'stato', f.stato, 'firmatario', f.firmatario_email, 'file', f.file_firmato, 'firmata_il', f.firmata_il, 'ordine', f.ordine)
                         from public.s_firme f where f.tipo = 'registro_giornata' and f.rif = 'giornata:' || g.id::text and f.stato in ('in_attesa', 'in_coda', 'firmata', 'rimandata')
                         order by f.ordine desc limit 1),
          'firmato_da_me', exists (select 1 from public.s_firme f where f.tipo = 'registro_giornata' and f.rif = 'giornata:' || g.id::text and f.stato = 'firmata' and lower(f.firmatario_email) = v_email),
          'da_guardare', (select count(*) from public.s_corsi_firme_presenza fp where fp.giornata_id = g.id and fp.stato = 'ricevuta'),
          'con_presenza', (select count(*) from public.s_corsi_presenze p join public.s_corsi_iscritti i on i.id = p.iscritto_id where p.giornata_id = g.id and coalesce(i.esito, '') not in ('annullato', 'sostituito')),
          'interventi', coalesce((select jsonb_agg(jsonb_build_object('id', iv.id, 'nominativo', iv.nominativo, 'persona_id', iv.persona_id, 'qualita', iv.qualita,
                                   'materia', iv.materia, 'argomenti', iv.argomenti, 'dalle', to_char(iv.dalle, 'HH24:MI'), 'alle', to_char(iv.alle, 'HH24:MI'),
                                   'mio', (v_me is not null and iv.persona_id = v_me)) order by iv.ordine, iv.dalle, iv.id)
                          from public.s_corsi_interventi iv where iv.giornata_id = g.id), '[]'::jsonb)
        ) order by g.data, g.dalle) from public.s_corsi_giornate g where g.corso_id = c.id), '[]'::jsonb)
    ) order by c.data_inizio desc nulls last, c.id desc)
    from (select * from public.s_corsi c0
           where c0.stato in ('bozza', 'aperto', 'svolto')
             and (v_capo or (v_me is not null and (exists (select 1 from public.s_corsi_interventi i where i.corso_id = c0.id and i.persona_id = v_me)
                                                   or exists (select 1 from public.s_corsi_incarichi k where k.corso_id = c0.id and k.persona_id = v_me))))
           order by c0.data_inizio desc nulls last limit 40) c
  ), '[]'::jsonb);
end $function$;

-- ── 3. l'archivio dei documenti firmati ────────────────────────────────────
-- Una riga per documento firmato da chi chiama (la sua firma), col PDF
-- finale della catena. Filtri: anno della propria firma, tipo. Senza
-- argomenti: l'anno più recente in cui c'è qualcosa. `anni` e `tipi`
-- servono alle tendine della pagina.
create or replace function public.mie_firme_archivio(p_anno integer default null, p_tipo text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_anno integer;
begin
  if v_email = '' then return jsonb_build_object('anni', '[]'::jsonb, 'tipi', '[]'::jsonb, 'righe', '[]'::jsonb); end if;
  v_anno := coalesce(p_anno, (select max(extract(year from (f.firmata_il at time zone 'Europe/Rome'))::int)
                                from public.s_firme f where lower(f.firmatario_email) = v_email and f.stato = 'firmata'));
  return jsonb_build_object(
    'anno', v_anno,
    'anni', coalesce((select jsonb_agg(a order by a desc) from (
               select distinct extract(year from (f.firmata_il at time zone 'Europe/Rome'))::int a
                 from public.s_firme f where lower(f.firmatario_email) = v_email and f.stato = 'firmata') x), '[]'::jsonb),
    'tipi', coalesce((select jsonb_agg(t order by t) from (
               select distinct f.tipo t from public.s_firme f where lower(f.firmatario_email) = v_email and f.stato = 'firmata') y), '[]'::jsonb),
    'righe', coalesce((select jsonb_agg(jsonb_build_object(
               'id', f.id, 'tipo', f.tipo, 'titolo', f.titolo, 'ruolo', f.firmatario_ruolo, 'corso_id', f.corso_id,
               'firmata_il', f.firmata_il, 'file_mio', f.file_firmato,
               'file_finale', (select f2.file_firmato from public.s_firme f2
                                where f2.tipo = f.tipo and f2.rif = f.rif and f2.stato = 'firmata' and f2.file_firmato is not null
                                order by f2.ordine desc, f2.firmata_il desc limit 1),
               'completo', not exists (select 1 from public.s_firme f3 where f3.tipo = f.tipo and f3.rif = f.rif and f3.stato in ('in_attesa', 'in_coda'))
             ) order by f.firmata_il desc)
             from public.s_firme f
            where lower(f.firmatario_email) = v_email and f.stato = 'firmata'
              and extract(year from (f.firmata_il at time zone 'Europe/Rome'))::int = v_anno
              and (p_tipo is null or p_tipo = '' or f.tipo = p_tipo)), '[]'::jsonb));
end $$;

revoke execute on function public.mie_firme_archivio(integer, text) from public, anon;
grant execute on function public.mie_firme_archivio(integer, text) to authenticated;

-- ── 4. storage: la versione finale a chi ha firmato prima ──────────────────
-- ⚠️ Il controllo sta in una funzione SECURITY DEFINER: dentro una policy
--    dello storage, `s_firme` si legge con la RLS di chi è collegato, che
--    vede solo le proprie righe, quindi non la riga di chi ha firmato dopo.
--    Scritta direttamente nella policy, la condizione non vedeva mai niente:
--    provato il 14/10/2026 col Presidente, che non apriva le lettere con la
--    firma del tecnico. Lo stesso valeva per la regola del lotto 5 sulla
--    lettera di docenza al docente (la riga del Presidente non è sua).
create or replace function public.firme_file_leggibile(p_nome text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  with io as (select lower(coalesce(auth.jwt() ->> 'email', '')) e)
  select (select e from io) <> '' and (
    /* i file delle proprie righe */
    exists (select 1 from public.s_firme f, io
             where lower(f.firmatario_email) = io.e
               and (f.file_originale = p_nome or f.file_firmato = p_nome or f.file_precedente = p_nome))
    /* la lettera di docenza firmata, al docente dell'incarico */
    or exists (select 1 from public.s_firme f
                 join public.s_corsi_incarichi k on f.tipo = 'incarico_docenza' and f.rif = 'docenza:' || k.id::text
                where f.stato = 'firmata' and f.file_firmato = p_nome
                  and k.persona_id is not null and k.persona_id = public.mia_persona_id())
    /* le versioni firmate dei documenti che si è firmato, anche con le firme di chi è venuto dopo */
    or exists (select 1 from public.s_firme f
                 join public.s_firme mia on mia.tipo = f.tipo and mia.rif = f.rif, io
                where f.stato = 'firmata' and f.file_firmato = p_nome
                  and mia.stato = 'firmata' and lower(mia.firmatario_email) = io.e)
  );
$$;
revoke execute on function public.firme_file_leggibile(text) from public, anon;
grant execute on function public.firme_file_leggibile(text) to authenticated;

drop policy if exists firme_presidente_lettura on storage.objects;
create policy firme_presidente_lettura on storage.objects
  for select to authenticated
  using (bucket_id = 'firme-presidente' and (public.is_segreteria() or public.firme_file_leggibile(name)));

-- Prova del 14/10/2026 (transazione annullata, role authenticated): il
-- Presidente vede le 6 voci del bucket, comprese le due lettere con la firma
-- del tecnico (15, 16); il tecnico incaricato le sue 4; un indirizzo
-- estraneo nessuna.
