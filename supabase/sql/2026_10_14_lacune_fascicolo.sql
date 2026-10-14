-- ============================================================
-- LE LACUNE DEL FASCICOLO DIGITALE (14/10/2026)
-- dalla verifica di legge del 14/10 (vault: 2_AREE/Formazione/
-- 2026_10_14_REL_Area-Sicurezza_fascicolo-elettronico-requisiti-firme-presenze_ricerca.md)
--
-- 1. IL CODICE PERSONALE NON BASTA DA SOLO. Fino a oggi stava stampato
--    sul registro accanto al nome: chi vedeva il foglio poteva firmare per
--    un collega. Da oggi il codice si consegna su un biglietto personale
--    (corsi-doc.js) e alla firma si chiede anche l'ANNO DI NASCITA, che si
--    confronta con la data di nascita della persona o, in mancanza, col
--    codice fiscale. Online il portale ferma subito chi sbaglia (impronta
--    di codice+anno pubblicata, mai l'anno in chiaro); senza rete la firma
--    arriva lo stesso e porta il segno «anno non corrispondente»: la vede
--    il docente, e la conferma di gruppo la salta.
-- 4. L'ELENCO DEI DOCENTI CON FIRME (FAQ Ministero n. 43): un pezzo a sé
--    del fascicolo, generato da `corso_elenco_docenti` — per ogni docente
--    interventi, ore, lettera d'incarico, accettazione, registri firmati,
--    con data e impronta di ogni firma.
-- 5. LA TRACCIA DELLE FIRME NEL FASCICOLO: `corso_traccia_presenze` dà
--    tutte le firme dal QR (anche respinte e non riconosciute) con ora del
--    server, ora del telefono, chi ha confermato e quando.
-- + IL PACCHETTO DEL CORSO: un file .zip con tutto (documenti firmati,
--   elenco docenti, traccia, attestati, dati in JSON, manifesto con le
--   impronte SHA-256), da tenere su Drive e da copiare sul server della
--   scuola. I dati li dà `corso_pacchetto_dati`; l'impronta del pacchetto
--   resta sul corso.
-- ============================================================

-- ── 1. l'anno di nascita alla firma ──────────────────────────
alter table public.s_corsi_firme_presenza
  add column if not exists anno_dichiarato  smallint,
  add column if not exists anno_corrisponde boolean;
comment on column public.s_corsi_firme_presenza.anno_corrisponde is
  'L''anno di nascita scritto alla firma coincide con quello della persona (data di nascita, o codice fiscale)? null = non verificabile o non chiesto (14/10/2026).';

/* le ultime due cifre dell'anno di nascita: dalla persona, o dal codice
   fiscale (posizioni 7-8, con le lettere dell'omocodia) */
create or replace function public.iscritto_yy(p_iscritto bigint)
returns integer language plpgsql stable security definer set search_path to 'public' as $$
declare v_cf text; v_nato date; v_yy text;
begin
  select upper(btrim(coalesce(nullif(i.cf, ''), p.cf, ''))), p.data_nascita into v_cf, v_nato
    from public.s_corsi_iscritti i left join public.persone p on p.persona_id = i.persona_id
   where i.id = p_iscritto;
  if v_nato is not null then return (extract(year from v_nato)::int) % 100; end if;
  if v_cf ~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$' then
    v_yy := translate(substr(v_cf, 7, 2), 'LMNPQRSTUV', '0123456789');
    return v_yy::int;
  end if;
  return null;
end $$;
revoke execute on function public.iscritto_yy(bigint) from public, anon, authenticated;

/* l'impronta di codice+anno che va al portale: senza l'anno in chiaro */
create or replace function public.pres_impronta_anno(p_codice text, p_yy integer)
returns text language sql immutable set search_path to 'public', 'extensions' as $$
  select case when p_codice is null or p_yy is null then null
    else encode(extensions.digest(convert_to(upper(p_codice) || ':' || lpad(p_yy::text, 2, '0'), 'UTF8'), 'sha256'), 'hex') end;
$$;
revoke execute on function public.pres_impronta_anno(text, integer) from public, anon, authenticated;

create or replace function public.pres_pubblicazione(p_corso_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare r record; v_giornate jsonb; v_pers jsonb; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or v_ruolo = 'service_role') then raise exception 'non autorizzato'; end if;
  select c.id, c.titolo, c.sede, c.data_inizio, c.data_fine, c.pres_codice, c.pres_chiuso_il
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found or r.pres_codice is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'data',   to_char(g.data, 'YYYY-MM-DD'),
           'dalle',  to_char(g.dalle, 'HH24:MI'),
           'alle',   to_char(g.alle, 'HH24:MI'),
           'dalle2', to_char(g.dalle2, 'HH24:MI'),
           'alle2',  to_char(g.alle2, 'HH24:MI'),
           'sede',   coalesce(g.aula, g.sede)) order by g.data, g.dalle), '[]'::jsonb)
    into v_giornate from public.s_corsi_giornate g where g.corso_id = r.id;

  /* h = impronta del codice; a = impronta di codice+anno (solo se l'anno è
     ricavabile); n = iniziali. Niente nomi interi, niente CF, niente anno */
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'h', encode(extensions.digest(convert_to(upper(i.test_codice), 'UTF8'), 'sha256'), 'hex'),
           'a', public.pres_impronta_anno(i.test_codice, public.iscritto_yy(i.id)),
           'n', (select string_agg(left(p, 1) || '.', ' ')
                   from unnest(string_to_array(regexp_replace(coalesce(i.nominativo, ''), '\s+', ' ', 'g'), ' ')) p
                  where p <> '')))), '[]'::jsonb)
    into v_pers
    from public.s_corsi_iscritti i
   where i.corso_id = r.id and i.test_codice is not null
     and coalesce(i.esito, '') not in ('annullato', 'sostituito');

  return jsonb_build_object(
    'codice',    r.pres_codice,
    'firma',     public.pres_firma(r.pres_codice),
    'titolo',    r.titolo,
    'quando',    to_char(coalesce(r.data_inizio, r.data_fine), 'YYYY-MM-DD'),
    'sede',      r.sede,
    'chiuso_il', to_jsonb(r.pres_chiuso_il),
    'giornate',  v_giornate,
    'persone',   v_pers);
end $$;
revoke execute on function public.pres_pubblicazione(bigint) from public, anon;

/* la firma che arriva: con l'anno scritto dall'allievo. Si toglie la
   versione a 4 argomenti: due versioni con default renderebbero ambigua la
   chiamata per nome di portale-richieste. */
drop function if exists public.pres_registra(text, text, text, text);
create or replace function public.pres_registra(p_riferimento text, p_codice_personale text, p_ora_dispositivo text,
                                                p_submission_id text default null, p_anno text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_cod text; v_firma text; p int; c public.s_corsi; i public.s_corsi_iscritti; g public.s_corsi_giornate; v_disp timestamptz; v_dec jsonb;
        v_oggi date; v_note text[] := '{}'; v_ruolo text; v_anno int; v_yy int; v_corr boolean;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (v_ruolo = 'service_role' or public.is_segreteria()) then raise exception 'non autorizzato'; end if;

  if p_riferimento is null or position('.' in p_riferimento) = 0 then
    return jsonb_build_object('riferimento_esito', 'senza invito');
  end if;
  p := position('.' in p_riferimento);
  v_cod := upper(substr(p_riferimento, 1, p - 1));
  v_firma := substr(p_riferimento, p + 1);
  if public.pres_firma(v_cod) is distinct from lower(v_firma) then
    return jsonb_build_object('riferimento_esito', 'firma non valida');
  end if;
  select * into c from public.s_corsi where pres_codice = v_cod;
  if not found then return jsonb_build_object('riferimento_esito', 'corso non trovato'); end if;

  select * into i from public.s_corsi_iscritti
   where corso_id = c.id and upper(test_codice) = upper(btrim(coalesce(p_codice_personale, '')));
  if not found then
    return jsonb_build_object('riferimento_esito', 'persona non riconosciuta', 'corso_id', c.id, 'fonte', 'qr');
  end if;

  /* l'anno: si confronta, non si rifiuta — una firma arrivata senza rete
     non si perde; la guarda il docente */
  if btrim(coalesce(p_anno, '')) ~ '^\d{4}$' then v_anno := btrim(p_anno)::int; end if;
  v_yy := public.iscritto_yy(i.id);
  v_corr := case when v_anno is null or v_yy is null then null else (v_anno % 100) = v_yy end;
  if v_corr is false then v_note := v_note || ('anno di nascita non corrispondente (scritto ' || v_anno || ')'); end if;
  if v_anno is null and v_yy is not null then v_note := array_append(v_note, 'anno di nascita non scritto'); end if;

  begin v_disp := nullif(btrim(coalesce(p_ora_dispositivo, '')), '')::timestamptz; exception when others then v_disp := null; end;
  v_oggi := (now() at time zone 'Europe/Rome')::date;

  select * into g from public.s_corsi_giornate where corso_id = c.id and data = v_oggi order by dalle limit 1;
  if not found and v_disp is not null then
    select * into g from public.s_corsi_giornate where corso_id = c.id and data = (v_disp at time zone 'Europe/Rome')::date order by dalle limit 1;
    if found then v_note := v_note || ('giornata del ' || to_char(g.data, 'DD/MM/YYYY') || ' scelta dall''ora del telefono: arrivata il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')); end if;
  end if;
  if g.id is null then
    select * into g from public.s_corsi_giornate where corso_id = c.id order by abs(data - v_oggi), dalle limit 1;
    if found then v_note := v_note || ('nessuna giornata oggi: scelta la più vicina, ' || to_char(g.data, 'DD/MM/YYYY')); end if;
  end if;
  if g.id is null then
    return jsonb_build_object('riferimento_esito', 'corso senza giornate', 'corso_id', c.id, 'iscritto_id', i.id, 'nominativo', i.nominativo, 'fonte', 'qr');
  end if;

  v_dec := public.pres_decidi(g.data, g.dalle, g.alle, g.dalle2, g.alle2, now());
  if (v_dec ->> 'fuori_orario')::boolean then v_note := v_note || coalesce(v_dec ->> 'motivo', 'fuori orario'); end if;
  if c.pres_chiuso_il is not null and now() > c.pres_chiuso_il then v_note := array_append(v_note, 'arrivata dopo la chiusura delle firme'); end if;

  return jsonb_build_object(
    'riferimento_esito', 'riconosciuta',
    'corso_id', c.id, 'giornata_id', g.id, 'iscritto_id', i.id, 'nominativo', i.nominativo,
    'tipo', v_dec ->> 'tipo', 'turno', (v_dec ->> 'turno')::int,
    'ora_server', now(), 'ora_dispositivo', v_disp,
    'fuori_orario', coalesce((v_dec ->> 'fuori_orario')::boolean, true),
    'anno_dichiarato', v_anno, 'anno_corrisponde', v_corr,
    'fonte', 'qr', 'stato', 'ricevuta',
    'note', nullif(array_to_string(v_note, '; '), ''));
end $$;
revoke execute on function public.pres_registra(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pres_registra(text, text, text, text, text) to service_role;

/* la conferma di gruppo salta le firme con l'anno che non torna: quelle le
   guarda il docente una per una, come le fuori orario */
create or replace function public.pres_conferma_allievo(p_iscritto_id bigint, p_giornata_id bigint)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare f record; v_n int := 0; v_corso bigint;
begin
  select corso_id into v_corso from public.s_corsi_iscritti where id = p_iscritto_id;
  if v_corso is null then raise exception 'iscritto % non trovato', p_iscritto_id; end if;
  if not (public.is_segreteria() or public.is_docente_del_corso(v_corso)) then raise exception 'non autorizzato'; end if;
  for f in select distinct on (tipo, turno) id from public.s_corsi_firme_presenza
            where iscritto_id = p_iscritto_id and giornata_id = p_giornata_id
              and stato = 'ricevuta' and not fuori_orario and tipo is not null
              and anno_corrisponde is not false
              and not exists (select 1 from public.s_corsi_firme_presenza x
                               where x.iscritto_id = p_iscritto_id and x.giornata_id = p_giornata_id
                                 and x.tipo = s_corsi_firme_presenza.tipo and x.turno = s_corsi_firme_presenza.turno and x.stato = 'confermata')
            order by tipo, turno, ora_server
  loop
    perform public.pres_conferma(f.id, 'confermata', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.pres_conferma_allievo(bigint, bigint) from public, anon;

/* la giornata del docente: con il segno dell'anno sulle firme */
create or replace function public.corso_docente_giornata(p_giornata bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare g public.s_corsi_giornate; c public.s_corsi;
begin
  select * into g from public.s_corsi_giornate where id = p_giornata;
  if not found then raise exception 'giornata % non trovata', p_giornata; end if;
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(g.corso_id)) then raise exception 'non autorizzato'; end if;
  select * into c from public.s_corsi where id = g.corso_id;
  return jsonb_build_object(
    'giornata', jsonb_build_object('id', g.id, 'data', g.data, 'dalle', to_char(g.dalle, 'HH24:MI'), 'alle', to_char(g.alle, 'HH24:MI'),
                  'dalle2', to_char(g.dalle2, 'HH24:MI'), 'alle2', to_char(g.alle2, 'HH24:MI'), 'aula', coalesce(g.aula, g.sede)),
    'corso', jsonb_build_object('id', c.id, 'titolo', c.titolo, 'pres_codice', c.pres_codice, 'tipologia_id', c.tipologia_id),
    'iscritti', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'nominativo', i.nominativo, 'cf', i.cf, 'impresa_txt', i.impresa_txt, 'mansione', i.mansione,
        'test_codice', i.test_codice, 'aggiunto_in_aula_il', i.aggiunto_in_aula_il,
        'presenza', (select to_jsonb(p) - 'id' from public.s_corsi_presenze p where p.iscritto_id = i.id and p.giornata_id = g.id),
        'firme', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'tipo', f.tipo, 'turno', f.turno, 'ora_server', f.ora_server,
                            'stato', f.stato, 'fuori_orario', f.fuori_orario, 'anno_corrisponde', f.anno_corrisponde,
                            'note', f.note, 'fonte', f.fonte) order by f.ora_server)
                   from public.s_corsi_firme_presenza f where f.iscritto_id = i.id and f.giornata_id = g.id), '[]'::jsonb)
      ) order by i.nominativo)
      from public.s_corsi_iscritti i where i.corso_id = g.corso_id and coalesce(i.esito, '') not in ('annullato', 'sostituito')), '[]'::jsonb),
    'non_riconosciute', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ora_server', f.ora_server, 'riferimento_esito', f.riferimento_esito) order by f.ora_server)
      from public.s_corsi_firme_presenza f where f.corso_id = g.corso_id and f.iscritto_id is null and f.ora_server::date = g.data), '[]'::jsonb));
end $$;
revoke execute on function public.corso_docente_giornata(bigint) from public, anon;

-- ── 4. l'elenco dei docenti con le loro firme ────────────────
/* le firme di un documento, una per firmatario, con data e impronta */
create or replace function public.fascicolo_firme_di(p_tipo text, p_rif text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('firma_id', f.id, 'ordine', f.ordine, 'ruolo', f.firmatario_ruolo,
           'email', lower(coalesce(f.firmatario_email, f.firmata_da)), 'firmata_il', f.firmata_il, 'sha256', f.sha256_firmato,
           'autografo_il', f.autografo_il) order by f.ordine), '[]'::jsonb)
    from public.s_firme f where f.tipo = p_tipo and f.rif = p_rif and f.stato = 'firmata';
$$;
revoke execute on function public.fascicolo_firme_di(text, text) from public, anon, authenticated;

create or replace function public.corso_elenco_docenti(p_corso bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not (public.is_segreteria() or public.is_rpf()) then raise exception 'non autorizzato'; end if;
  with doc as (
    /* chi ha insegnato o ha un incarico: per persona, o per nome se non è in anagrafica */
    select coalesce(x.persona_id::text, 'nome:' || lower(btrim(x.nominativo))) as chiave, x.persona_id, x.nominativo
      from (select persona_id, nominativo from public.s_corsi_interventi where corso_id = p_corso and coalesce(qualita, 'docente') in ('docente', 'codocente', 'relatore', 'tutor')
            union all select persona_id, nominativo from public.s_corsi_incarichi where corso_id = p_corso) x
     where nullif(btrim(coalesce(x.nominativo, '')), '') is not null
  ), uno as (
    select distinct on (chiave) chiave, persona_id, nominativo from doc order by chiave, nominativo
  ), mail as (
    select u.chiave, array_remove(array[lower(p.email), lower(a.email), lower(t.email)], null) as email
      from uno u
      left join public.persone p on p.persona_id = u.persona_id
      left join lateral (select email from public.app_ruoli r where r.persona_id = u.persona_id and r.email is not null limit 1) a on true
      left join lateral (select email from public.tecnici k where k.persona_id = u.persona_id and k.email is not null limit 1) t on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nominativo', u.nominativo, 'persona_id', u.persona_id,
           'qualita', (select coalesce(jsonb_agg(distinct coalesce(i.qualita, 'docente')), '[]'::jsonb) from public.s_corsi_interventi i
                        where i.corso_id = p_corso and coalesce(i.persona_id::text, 'nome:' || lower(btrim(i.nominativo))) = u.chiave),
           'interventi', (select coalesce(jsonb_agg(jsonb_build_object('data', g.data, 'dalle', to_char(i.dalle, 'HH24:MI'), 'alle', to_char(i.alle, 'HH24:MI'),
                              'qualita', coalesce(i.qualita, 'docente'), 'materia', i.materia, 'argomenti', i.argomenti) order by g.data, i.dalle), '[]'::jsonb)
                            from public.s_corsi_interventi i left join public.s_corsi_giornate g on g.id = i.giornata_id
                           where i.corso_id = p_corso and coalesce(i.persona_id::text, 'nome:' || lower(btrim(i.nominativo))) = u.chiave),
           'ore', (select round(coalesce(sum(extract(epoch from (i.alle - i.dalle)) / 3600.0), 0)::numeric, 2) from public.s_corsi_interventi i
                    where i.corso_id = p_corso and i.dalle is not null and i.alle is not null and i.alle > i.dalle
                      and coalesce(i.persona_id::text, 'nome:' || lower(btrim(i.nominativo))) = u.chiave),
           'incarichi', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'qualita', k.qualita, 'ore', k.ore, 'data_incarico', k.data_incarico,
                              'protocollo', (select pr.codice from public.s_protocollo pr where pr.id = k.protocollo_out_id),
                              'accettato_il', k.accettato_il,
                              'lettera', public.fascicolo_firme_di('incarico_docenza', 'docenza:' || k.id::text),
                              'accettazione', public.fascicolo_firme_di('accettazione_incarico', 'incarico:' || k.id::text)) order by k.id), '[]'::jsonb)
                           from public.s_corsi_incarichi k
                          where k.corso_id = p_corso and coalesce(k.persona_id::text, 'nome:' || lower(btrim(k.nominativo))) = u.chiave),
           /* i registri e i verbali firmati da questa persona (per indirizzo) */
           'firme', (select coalesce(jsonb_agg(jsonb_build_object('tipo', f.tipo, 'rif', f.rif, 'titolo', f.titolo, 'firma_id', f.id,
                          'firmata_il', f.firmata_il, 'sha256', f.sha256_firmato,
                          'data', (select g.data from public.s_corsi_giornate g where f.tipo = 'registro_giornata' and 'giornata:' || g.id::text = f.rif)) order by f.firmata_il), '[]'::jsonb)
                       from public.s_firme f
                      where f.stato = 'firmata' and f.tipo in ('registro_giornata', 'verbale_verifica', 'scheda_formativa')
                        and lower(coalesce(f.firmatario_email, f.firmata_da, '')) = any (m.email)
                        and (f.corso_id = p_corso
                             or f.rif in (select 'giornata:' || g.id::text from public.s_corsi_giornate g where g.corso_id = p_corso)
                             or f.rif in (select 'verbale:' || v.id::text from public.s_corsi_verbali_verifica v where v.corso_id = p_corso)))
         ) order by u.nominativo), '[]'::jsonb)
    into v
    from uno u join mail m on m.chiave = u.chiave;
  return v;
end $$;
revoke execute on function public.corso_elenco_docenti(bigint) from public, anon;

-- ── 5. la traccia delle firme dal QR ─────────────────────────
create or replace function public.corso_traccia_presenze(p_corso bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.is_segreteria() or public.is_rpf()) then raise exception 'non autorizzato'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
           'id', f.id, 'progressivo', f.progressivo, 'submission_id', f.submission_id,
           'giornata', g.data, 'iscritto_id', f.iscritto_id, 'nominativo', coalesce(i.nominativo, f.nominativo),
           'tipo', f.tipo, 'turno', f.turno, 'ora_server', f.ora_server, 'ora_dispositivo', f.ora_dispositivo,
           'fuori_orario', f.fuori_orario, 'anno_corrisponde', f.anno_corrisponde, 'fonte', f.fonte,
           'stato', f.stato, 'confermata_da', f.confermata_da, 'confermata_il', f.confermata_il,
           'note', f.note, 'riferimento_esito', f.riferimento_esito) order by f.ora_server, f.id)
    from public.s_corsi_firme_presenza f
    left join public.s_corsi_giornate g on g.id = f.giornata_id
    left join public.s_corsi_iscritti i on i.id = f.iscritto_id
   where f.corso_id = p_corso), '[]'::jsonb);
end $$;
revoke execute on function public.corso_traccia_presenze(bigint) from public, anon;

-- ── il pacchetto del corso ───────────────────────────────────
alter table public.s_corsi
  add column if not exists fascicolo_pacchetto_sha256 text,
  add column if not exists fascicolo_pacchetto_il     timestamptz;
comment on column public.s_corsi.fascicolo_pacchetto_sha256 is
  'L''impronta SHA-256 del pacchetto .zip del corso (tutto il fascicolo in un file, 14/10/2026): chi ne ha una copia sul server della scuola la confronta con questa.';

alter table public.s_corsi_fascicolo_file drop constraint if exists s_corsi_fascicolo_file_pezzo_check;
alter table public.s_corsi_fascicolo_file add constraint s_corsi_fascicolo_file_pezzo_check
  check (pezzo in ('scheda', 'progetto', 'registro_giornata', 'verbale', 'accettazione', 'indice', 'elenco_docenti', 'traccia_presenze', 'pacchetto', 'altro'));

/* tutti i dati del corso, per il file dati-corso.json del pacchetto */
create or replace function public.corso_pacchetto_dati(p_corso bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c public.s_corsi; v_rif text[];
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select * into c from public.s_corsi where id = p_corso;
  if not found then raise exception 'corso % non trovato', p_corso; end if;
  v_rif := array['progetto:' || c.id::text]
        || coalesce((select array_agg('giornata:' || id::text) from public.s_corsi_giornate where corso_id = c.id), '{}')
        || coalesce((select array_agg('verbale:' || id::text) from public.s_corsi_verbali_verifica where corso_id = c.id), '{}')
        || coalesce((select array_agg('incarico:' || id::text) || array_agg('docenza:' || id::text) from public.s_corsi_incarichi where corso_id = c.id), '{}')
        || case when c.scheda_formativa_id is null then '{}'::text[] else array['scheda:' || c.scheda_formativa_id::text] end;
  return jsonb_build_object(
    'formato', 'pacchetto del corso, Formedil Padova, versione 1 (14/10/2026)',
    'generato_il', now(),
    'corso', to_jsonb(c),
    'tipologia', (select to_jsonb(t) from public.s_corsi_tipologie t where t.id = c.tipologia_id),
    'scheda_formativa', (select to_jsonb(s) from public.s_corsi_schede_formative s where s.id = c.scheda_formativa_id),
    'giornate', coalesce((select jsonb_agg(to_jsonb(g) order by g.data, g.dalle) from public.s_corsi_giornate g where g.corso_id = c.id), '[]'::jsonb),
    'interventi', coalesce((select jsonb_agg(to_jsonb(i) order by i.giornata_id, i.ordine, i.dalle) from public.s_corsi_interventi i where i.corso_id = c.id), '[]'::jsonb),
    'incarichi', coalesce((select jsonb_agg(to_jsonb(k) order by k.id) from public.s_corsi_incarichi k where k.corso_id = c.id), '[]'::jsonb),
    'iscritti', coalesce((select jsonb_agg(to_jsonb(i) order by i.nominativo) from public.s_corsi_iscritti i where i.corso_id = c.id), '[]'::jsonb),
    'presenze', coalesce((select jsonb_agg(to_jsonb(p) order by p.giornata_id, p.iscritto_id)
                            from public.s_corsi_presenze p join public.s_corsi_giornate g on g.id = p.giornata_id where g.corso_id = c.id), '[]'::jsonb),
    'firme_presenza', coalesce((select jsonb_agg(to_jsonb(f) - 'portale_esito' order by f.ora_server, f.id) from public.s_corsi_firme_presenza f where f.corso_id = c.id), '[]'::jsonb),
    'firme_documenti', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'tipo', f.tipo, 'rif', f.rif, 'titolo', f.titolo, 'nome_file', f.nome_file,
                            'ordine', f.ordine, 'stato', f.stato, 'firmatario_ruolo', f.firmatario_ruolo, 'firmatario_email', f.firmatario_email,
                            'richiesta_il', f.richiesta_il, 'firmata_il', f.firmata_il, 'firmata_da', f.firmata_da, 'autografo_il', f.autografo_il,
                            'sha256_originale', f.sha256_originale, 'sha256_firmato', f.sha256_firmato) order by f.tipo, f.rif, f.ordine)
                            from public.s_firme f where f.corso_id = c.id or f.rif = any (v_rif)), '[]'::jsonb),
    'verbali', coalesce((select jsonb_agg(to_jsonb(v) order by v.versione) from public.s_corsi_verbali_verifica v where v.corso_id = c.id), '[]'::jsonb),
    'test_prove', coalesce((select jsonb_agg(to_jsonb(t) - 'portale_esito' order by t.consegnato_il) from public.s_test_prove t where t.corso_id = c.id), '[]'::jsonb),
    'questionario_risposte', coalesce((select jsonb_agg(to_jsonb(q) - 'portale_esito' order by q.ricevuto_il) from public.s_quest_risposte q where q.corso_id = c.id), '[]'::jsonb),
    'elenco_docenti', public.corso_elenco_docenti(c.id),
    'depositati', coalesce((select jsonb_agg(to_jsonb(d) order by d.depositato_il) from public.s_corsi_fascicolo_file d where d.corso_id = c.id), '[]'::jsonb));
end $$;
revoke execute on function public.corso_pacchetto_dati(bigint) from public, anon;

/* il deposito del pacchetto scrive anche l'impronta sul corso */
create or replace function public.corso_fascicolo_deposita(p_corso bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', '')); r public.s_corsi_fascicolo_file;
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  if not exists (select 1 from public.s_corsi where id = p_corso) then raise exception 'corso % non trovato', p_corso; end if;
  if p ? 'cartella_id' then
    update public.s_corsi set fascicolo_drive_id = p ->> 'cartella_id', fascicolo_drive_url = coalesce(p ->> 'cartella_url', fascicolo_drive_url) where id = p_corso;
  end if;
  if p ? 'pezzo' then
    insert into public.s_corsi_fascicolo_file (corso_id, pezzo, rif, firma_id, nome, drive_id, drive_url, sha256, depositato_da)
    values (p_corso, p ->> 'pezzo', coalesce(p ->> 'rif', ''), nullif(p ->> 'firma_id', '')::bigint, p ->> 'nome', p ->> 'drive_id', p ->> 'drive_url', p ->> 'sha256', v_me)
    on conflict (corso_id, pezzo, rif) do update set firma_id = excluded.firma_id, nome = excluded.nome, drive_id = excluded.drive_id, drive_url = excluded.drive_url, sha256 = excluded.sha256, depositato_il = now(), depositato_da = v_me
    returning * into r;
    if r.pezzo = 'pacchetto' then
      update public.s_corsi set fascicolo_pacchetto_sha256 = r.sha256, fascicolo_pacchetto_il = now() where id = p_corso;
    end if;
    return to_jsonb(r);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.corso_fascicolo_deposita(bigint, jsonb) from public, anon;

/* corso_fascicolo dice anche del pacchetto: se ne aggiunge la chiave al risultato di prima */
do $$
declare d text; a text;
begin
  select pg_get_functiondef('public.corso_fascicolo(bigint)'::regprocedure) into d;
  a := '''chiuso_il'', c.fascicolo_chiuso_il, ''chiuso_da'', c.fascicolo_chiuso_da, ''codice_socrate'', c.codice_socrate);';
  if position(a in d) = 0 then raise exception 'corso_fascicolo: ancora non trovata'; end if;
  if position('fascicolo_pacchetto_sha256' in d) > 0 then return; end if;
  d := replace(d, a, '''chiuso_il'', c.fascicolo_chiuso_il, ''chiuso_da'', c.fascicolo_chiuso_da, ''codice_socrate'', c.codice_socrate,'
    || E'\n    ''pacchetto'', jsonb_build_object(''sha256'', c.fascicolo_pacchetto_sha256, ''il'', c.fascicolo_pacchetto_il),'
    || E'\n    ''firme_qr'', (select count(*) from public.s_corsi_firme_presenza fp where fp.corso_id = c.id));');
  execute d;
end $$;

-- ── il flusso nel cruscotto «che cosa è stato usato» ─────────
do $$
declare d text; a1 text; a2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 's_flussi_uso';
  a1 := 'from public.s_iscrizioni where stato = ''confermata''';
  a2 := '(''Formazione'', ''iscr_confermata'', ''Iscrizione confermata dalla segreteria'')';
  if d is null or position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 's_flussi_uso: ancora non trovata'; end if;
  if position('fascicolo_pacchetto' in d) > 0 then return; end if;
  d := replace(d, a1, a1 || E'\n    /* il pacchetto del corso (14/10/2026) */'
    || E'\n    union all select ''Formazione'', ''fascicolo_pacchetto'', ''Pacchetto del corso depositato'', fascicolo_pacchetto_il::date from public.s_corsi where fascicolo_pacchetto_il is not null');
  d := replace(d, a2, a2 || E',\n    (''Formazione'', ''fascicolo_pacchetto'', ''Pacchetto del corso depositato'')');
  execute d;
end $$;
