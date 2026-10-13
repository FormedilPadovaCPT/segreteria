-- ============================================================
-- LA PAGINA DEL DOCENTE PER IL CORSO (14/10/2026) — lotto 5 del fascicolo
-- corso digitale (progetto § 5.3)
--
-- Che cosa nasce:
--   0. ⚠️ LE POLICY DI LETTURA CHE MANCAVANO: s_corsi, giornate, iscritti,
--      interventi, incarichi e presenze avevano solo «is_segreteria()».
--      L'RPF (un tecnico) e i docenti non vedevano niente dal gestionale —
--      la pagina del lotto 3 e documenti-corso (che legge col token di chi
--      chiama) tornavano vuoti. Da oggi: segreteria tutto; RPF in lettura
--      tutto; docente del corso in lettura i SUOI corsi (incarichi: solo il
--      suo, perché portano il compenso).
--   1. le RPC della pagina del docente, tutte security definer e tutte con
--      «is_docente_del_corso» (o segreteria/RPF):
--      corso_docente_corsi()            i miei corsi, con incarico, lettera,
--                                       accettazione, giornate e registri
--      corso_docente_giornata(g)        gli iscritti di una giornata con
--                                       presenze e firme dal QR
--      corso_docente_cerca_persona      per CF o cognome: nome, cognome, CF,
--                                       impresa del rapporto attivo — niente
--                                       recapiti
--      corso_docente_cerca_impresa      per P.IVA o nome: nessuna creazione
--      corso_docente_aggiungi_allievo   ⚠️ PRIMA DELLA FIRMA (deciso
--                                       dall'utente): persona per CF (creata
--                                       se manca, ruolo allievo), mansione
--                                       OBBLIGATORIA, codice personale subito,
--                                       ripubblicazione sul portale
--      corso_docente_presenza           assente / firma su carta / togli
--      corso_docente_argomenti          gli argomenti svolti del SUO intervento
--      corso_docente_registro_pronto    che cosa manca per firmare il registro
--                                       della giornata
--      pres_ripubblica(corso)           il corso torna sul portale (pg_net →
--                                       questionari-pubblica col token)
--   2. trigger: la firma dell'accettazione scrive accettato_il e
--      accettazione_firma_id sull'incarico.
--   3. storage: il docente legge la lettera di incarico firmata dal
--      Presidente del SUO incarico.
-- La firma dell'accettazione e del registro di giornata passano da
-- firma-documenti (azioni accetta_incarico e firma_registro): il PDF lo
-- disegna documenti-corso, il server lo carica, registra la riga e firma.
-- ============================================================

-- ── 0. le policy di lettura ──────────────────────────────────
drop policy if exists corsi_sel_rpf_docente on public.s_corsi;
create policy corsi_sel_rpf_docente on public.s_corsi for select to authenticated
  using ((select public.is_rpf()) or public.is_docente_del_corso(id));
drop policy if exists corsi_giorn_sel_rpf_docente on public.s_corsi_giornate;
create policy corsi_giorn_sel_rpf_docente on public.s_corsi_giornate for select to authenticated
  using ((select public.is_rpf()) or public.is_docente_del_corso(corso_id));
drop policy if exists corsi_iscr_sel_rpf_docente on public.s_corsi_iscritti;
create policy corsi_iscr_sel_rpf_docente on public.s_corsi_iscritti for select to authenticated
  using ((select public.is_rpf()) or public.is_docente_del_corso(corso_id));
drop policy if exists corsi_interv_sel_rpf_docente on public.s_corsi_interventi;
create policy corsi_interv_sel_rpf_docente on public.s_corsi_interventi for select to authenticated
  using ((select public.is_rpf()) or public.is_docente_del_corso(corso_id));
/* l'incarico porta il compenso: il docente vede solo il suo */
drop policy if exists corsi_incar_sel_rpf_docente on public.s_corsi_incarichi;
create policy corsi_incar_sel_rpf_docente on public.s_corsi_incarichi for select to authenticated
  using ((select public.is_rpf()) or (persona_id is not null and persona_id = (select public.mia_persona_id())));
drop policy if exists corsi_pres_sel_rpf_docente on public.s_corsi_presenze;
create policy corsi_pres_sel_rpf_docente on public.s_corsi_presenze for select to authenticated
  using ((select public.is_rpf()) or exists (select 1 from public.s_corsi_giornate g where g.id = s_corsi_presenze.giornata_id and public.is_docente_del_corso(g.corso_id)));

-- ── 1a. la ripubblicazione sul portale, dal database ────────
insert into public.s_config (chiave, valore, descrizione) values
  ('questionari_pubblica_url', 'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/questionari-pubblica',
   'La funzione questionari-pubblica di questo progetto, chiamata dal database (pg_net) quando il docente aggiunge un allievo in aula: le firme di presenza vanno ripubblicate.')
on conflict (chiave) do nothing;

create or replace function public.pres_ripubblica(p_corso bigint)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_url text; v_tok text;
begin
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(p_corso)) then raise exception 'non autorizzato'; end if;
  if not exists (select 1 from public.s_corsi where id = p_corso and pres_codice is not null) then return false; end if;
  select valore into v_url from public.s_config where chiave = 'questionari_pubblica_url';
  select valore into v_tok from public.s_config where chiave = 'questionari_token';
  if coalesce(v_url, '') = '' or coalesce(v_tok, '') = '' then
    raise warning 'pres_ripubblica: questionari_pubblica_url o questionari_token mancanti in s_config';
    return false;
  end if;
  begin
    perform net.http_post(url := v_url,
      body := jsonb_build_object('corso_id', p_corso, 'cosa', 'presenza'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Questionari-Token', v_tok));
  exception when others then
    raise warning 'pres_ripubblica: chiamata non partita (%): il corso va ripubblicato dalla segreteria', sqlerrm;
    return false;
  end;
  return true;
end $$;
revoke execute on function public.pres_ripubblica(bigint) from public, anon;

-- ── 1b. i miei corsi ─────────────────────────────────────────
create or replace function public.corso_docente_corsi()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
                     'lettera', (select jsonb_build_object('firma_id', f.id, 'stato', f.stato, 'file', f.file_firmato, 'firmata_il', f.firmata_il)
                                   from public.s_firme f where f.tipo = 'incarico_docenza' and f.rif = 'docenza:' || k.id::text and f.stato in ('in_attesa', 'in_coda', 'firmata')
                                   order by (f.stato = 'firmata') desc, f.richiesta_il desc limit 1),
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
end $$;
revoke execute on function public.corso_docente_corsi() from public, anon;

-- ── 1c. la giornata: iscritti, presenze, firme dal QR ────────
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
                            'stato', f.stato, 'fuori_orario', f.fuori_orario, 'note', f.note, 'fonte', f.fonte) order by f.ora_server)
                   from public.s_corsi_firme_presenza f where f.iscritto_id = i.id and f.giornata_id = g.id), '[]'::jsonb)
      ) order by i.nominativo)
      from public.s_corsi_iscritti i where i.corso_id = g.corso_id and coalesce(i.esito, '') not in ('annullato', 'sostituito')), '[]'::jsonb),
    'non_riconosciute', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'ora_server', f.ora_server, 'riferimento_esito', f.riferimento_esito) order by f.ora_server)
      from public.s_corsi_firme_presenza f where f.corso_id = g.corso_id and f.iscritto_id is null and f.ora_server::date = g.data), '[]'::jsonb));
end $$;
revoke execute on function public.corso_docente_giornata(bigint) from public, anon;

-- ── 1d. cercare una persona o un'impresa (senza recapiti, senza creare) ──
create or replace function public.corso_docente_cerca_persona(p_corso bigint, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := btrim(coalesce(p_q, ''));
begin
  if not (public.is_segreteria() or public.is_docente_del_corso(p_corso)) then raise exception 'non autorizzato'; end if;
  if length(q) < 3 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'persona_id', p.persona_id, 'nome', p.nome, 'cognome', p.cognome, 'cf', p.cf,
      'impresa_id', pi.impresa_id, 'impresa', im.impresa_nome, 'mansione', pi.mansione,
      'gia_iscritto', exists (select 1 from public.s_corsi_iscritti i where i.corso_id = p_corso and i.persona_id = p.persona_id and coalesce(i.esito, '') not in ('annullato', 'sostituito'))))
    from (select * from public.persone pp where pp.elimina = 0
            and (upper(pp.cf) like upper(q) || '%' or pp.cognome ilike q || '%' or (pp.cognome || ' ' || pp.nome) ilike q || '%')
          order by pp.cognome, pp.nome limit 12) p
    left join lateral (select x.impresa_id, x.mansione from public.persone_imprese x where x.persona_id = p.persona_id and x.data_cessazione is null order by x.data_assunzione desc nulls last limit 1) pi on true
    left join public.imprese im on im.impresa_id = pi.impresa_id), '[]'::jsonb);
end $$;
revoke execute on function public.corso_docente_cerca_persona(bigint, text) from public, anon;

create or replace function public.corso_docente_cerca_impresa(p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := btrim(coalesce(p_q, ''));
begin
  if not (public.is_segreteria() or public.is_docente() or public.is_personale()) then raise exception 'non autorizzato'; end if;
  if length(q) < 3 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('impresa_id', i.impresa_id, 'ragione_sociale', i.impresa_nome, 'piva', i.piva, 'comune', i.comune))
    from (select * from public.imprese im where coalesce(im.elimina, 0) = 0
            and (im.impresa_nome ilike '%' || q || '%' or im.piva like regexp_replace(q, '\D', '', 'g') || '%' or im.impresa_id like regexp_replace(q, '\D', '', 'g') || '%')
          order by im.impresa_nome limit 12) i), '[]'::jsonb);
end $$;
revoke execute on function public.corso_docente_cerca_impresa(text) from public, anon;

-- ── 1e. aggiungere un allievo in aula — PRIMA della firma ────
create or replace function public.corso_docente_aggiungi_allievo(p_corso bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_me text := lower(coalesce(auth.jwt() ->> 'email', '')); v_pid uuid; v_cf text; v_nome text; v_cogn text; v_mans text;
        v_imp text; v_txt text; v_nuova boolean := false; v_id bigint; v_cod text; v_pub boolean := false; c public.s_corsi;
begin
  if not (public.is_segreteria() or public.is_docente_del_corso(p_corso)) then raise exception 'non autorizzato'; end if;
  select * into c from public.s_corsi where id = p_corso;
  if not found then raise exception 'corso % non trovato', p_corso; end if;
  v_mans := nullif(btrim(coalesce(p ->> 'mansione', '')), '');
  if v_mans is null then raise exception 'La mansione è necessaria (va nell''analisi aula del progetto formativo).'; end if;

  v_pid := nullif(btrim(coalesce(p ->> 'persona_id', '')), '')::uuid;
  if v_pid is null then
    v_cf := upper(regexp_replace(coalesce(p ->> 'cf', ''), '[^A-Za-z0-9]', '', 'g'));
    if length(v_cf) <> 16 then raise exception 'Serve il codice fiscale di 16 caratteri (o una persona scelta dalla ricerca).'; end if;
    select persona_id into v_pid from public.persone where upper(cf) = v_cf and elimina = 0 limit 1;
    if v_pid is null then
      v_nome := nullif(btrim(coalesce(p ->> 'nome', '')), ''); v_cogn := nullif(btrim(coalesce(p ->> 'cognome', '')), '');
      if v_nome is null or v_cogn is null then raise exception 'Persona nuova: servono nome e cognome.'; end if;
      insert into public.persone (nome, cognome, cf, ruoli, updated_by)
      values (v_nome, v_cogn, v_cf, array['allievo'], v_me) returning persona_id into v_pid;
      v_nuova := true;
    end if;
  end if;
  select nome, cognome, cf into v_nome, v_cogn, v_cf from public.persone where persona_id = v_pid;
  if not found then raise exception 'persona non trovata'; end if;
  if exists (select 1 from public.s_corsi_iscritti i where i.corso_id = p_corso and coalesce(i.esito, '') not in ('annullato', 'sostituito')
              and (i.persona_id = v_pid or (v_cf is not null and upper(i.cf) = upper(v_cf)))) then
    raise exception '% % è già fra gli iscritti di questo corso.', v_cogn, v_nome;
  end if;

  /* l'impresa: quella scelta, oppure scritta, oppure il rapporto attivo in anagrafica; mai creata qui */
  v_imp := nullif(btrim(coalesce(p ->> 'impresa_id', '')), '');
  if v_imp is not null then
    select impresa_nome into v_txt from public.imprese where impresa_id = v_imp;
    if v_txt is null then raise exception 'impresa % non trovata', v_imp; end if;
  else
    v_txt := nullif(btrim(coalesce(p ->> 'impresa_txt', '')), '');
    if v_txt is null then
      select x.impresa_id, im.impresa_nome into v_imp, v_txt
        from public.persone_imprese x join public.imprese im on im.impresa_id = x.impresa_id
       where x.persona_id = v_pid and x.data_cessazione is null order by x.data_assunzione desc nulls last limit 1;
    end if;
  end if;

  insert into public.s_corsi_iscritti (corso_id, persona_id, nominativo, cf, impresa_id, impresa_txt, mansione, esito, data_iscrizione, aggiunto_in_aula_da, aggiunto_in_aula_il)
  values (p_corso, v_pid, upper(coalesce(v_cogn, '') || ' ' || coalesce(v_nome, '')), v_cf, v_imp, v_txt, v_mans, 'in_attesa', (now() at time zone 'Europe/Rome')::date, v_me, now())
  returning id into v_id;

  /* il codice personale subito: è così che firma dal telefono */
  perform public.corso_codici_personali(p_corso);
  select test_codice into v_cod from public.s_corsi_iscritti where id = v_id;
  if c.pres_codice is not null then v_pub := public.pres_ripubblica(p_corso); end if;

  return jsonb_build_object('iscritto_id', v_id, 'codice', v_cod, 'nominativo', upper(coalesce(v_cogn, '') || ' ' || coalesce(v_nome, '')),
    'persona_nuova', v_nuova, 'impresa_txt', v_txt, 'ripubblicato', v_pub, 'firme_aperte', c.pres_codice is not null);
end $$;
revoke execute on function public.corso_docente_aggiungi_allievo(bigint, jsonb) from public, anon;

-- ── 1f. presenza segnata a mano dal docente ──────────────────
create or replace function public.corso_docente_presenza(p_iscritto bigint, p_giornata bigint, p_modo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare g public.s_corsi_giornate; i public.s_corsi_iscritti; r public.s_corsi_presenze; v_ore numeric;
begin
  select * into g from public.s_corsi_giornate where id = p_giornata;
  select * into i from public.s_corsi_iscritti where id = p_iscritto;
  if g.id is null or i.id is null or i.corso_id <> g.corso_id then raise exception 'iscritto e giornata non combaciano'; end if;
  if not (public.is_segreteria() or public.is_docente_del_corso(g.corso_id)) then raise exception 'non autorizzato'; end if;
  if p_modo = 'assente' then
    insert into public.s_corsi_presenze (iscritto_id, giornata_id, presente, ingresso1, uscita1, ingresso2, uscita2, ore)
    values (p_iscritto, p_giornata, false, null, null, null, null, 0)
    on conflict (iscritto_id, giornata_id) do update set presente = false, ingresso1 = null, uscita1 = null, ingresso2 = null, uscita2 = null, ore = 0;
  elsif p_modo = 'carta' then
    /* firma sul registro di carta: gli orari previsti dove manca una firma confermata dal QR */
    insert into public.s_corsi_presenze (iscritto_id, giornata_id, presente) values (p_iscritto, p_giornata, true)
    on conflict (iscritto_id, giornata_id) do update set presente = true;
    update public.s_corsi_presenze set
      ingresso1 = coalesce(ingresso1, g.dalle), uscita1 = coalesce(uscita1, g.alle),
      ingresso2 = coalesce(ingresso2, g.dalle2), uscita2 = coalesce(uscita2, g.alle2)
     where iscritto_id = p_iscritto and giornata_id = p_giornata;
    select * into r from public.s_corsi_presenze where iscritto_id = p_iscritto and giornata_id = p_giornata;
    v_ore := round((
        case when r.ingresso1 is not null and r.uscita1 is not null and r.uscita1 > r.ingresso1 then extract(epoch from (r.uscita1 - r.ingresso1)) / 3600 else 0 end
      + case when r.ingresso2 is not null and r.uscita2 is not null and r.uscita2 > r.ingresso2 then extract(epoch from (r.uscita2 - r.ingresso2)) / 3600 else 0 end)::numeric, 2);
    update public.s_corsi_presenze set ore = v_ore where iscritto_id = p_iscritto and giornata_id = p_giornata;
  elsif p_modo = 'togli' then
    if exists (select 1 from public.s_corsi_firme_presenza f where f.iscritto_id = p_iscritto and f.giornata_id = p_giornata and f.stato = 'confermata') then
      raise exception 'Ci sono firme confermate dal QR: prima si respingono quelle.';
    end if;
    delete from public.s_corsi_presenze where iscritto_id = p_iscritto and giornata_id = p_giornata;
  else
    raise exception 'modo % non previsto (assente, carta, togli)', p_modo;
  end if;
  return coalesce((select to_jsonb(p) from public.s_corsi_presenze p where p.iscritto_id = p_iscritto and p.giornata_id = p_giornata), 'null'::jsonb);
end $$;
revoke execute on function public.corso_docente_presenza(bigint, bigint, text) from public, anon;

-- ── 1g. gli argomenti svolti, sul proprio intervento ─────────
create or replace function public.corso_docente_argomenti(p_intervento bigint, p_argomenti text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare iv public.s_corsi_interventi;
begin
  select * into iv from public.s_corsi_interventi where id = p_intervento;
  if not found then raise exception 'intervento % non trovato', p_intervento; end if;
  if not (public.is_segreteria() or (public.is_docente_del_corso(iv.corso_id) and iv.persona_id = public.mia_persona_id())) then
    raise exception 'Gli argomenti svolti li scrive il docente dell''intervento.';
  end if;
  update public.s_corsi_interventi set argomenti = nullif(btrim(coalesce(p_argomenti, '')), '') where id = p_intervento;
end $$;
revoke execute on function public.corso_docente_argomenti(bigint, text) from public, anon;

-- ── 1h. che cosa manca per firmare il registro della giornata ─
create or replace function public.corso_docente_registro_pronto(p_giornata bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare g public.s_corsi_giornate; v_isc int; v_senza int; v_guard int; v_firmato boolean;
begin
  select * into g from public.s_corsi_giornate where id = p_giornata;
  if not found then raise exception 'giornata % non trovata', p_giornata; end if;
  if not (public.is_segreteria() or public.is_rpf() or public.is_docente_del_corso(g.corso_id)) then raise exception 'non autorizzato'; end if;
  select count(*) into v_isc from public.s_corsi_iscritti i where i.corso_id = g.corso_id and coalesce(i.esito, '') not in ('annullato', 'sostituito');
  select count(*) into v_senza from public.s_corsi_iscritti i where i.corso_id = g.corso_id and coalesce(i.esito, '') not in ('annullato', 'sostituito')
     and not exists (select 1 from public.s_corsi_presenze p where p.iscritto_id = i.id and p.giornata_id = g.id);
  select count(*) into v_guard from public.s_corsi_firme_presenza f where f.giornata_id = g.id and f.stato = 'ricevuta';
  v_firmato := exists (select 1 from public.s_firme f where f.tipo = 'registro_giornata' and f.rif = 'giornata:' || g.id::text and f.stato = 'firmata');
  return jsonb_build_object('ok', v_isc > 0 and v_senza = 0 and v_guard = 0, 'iscritti', v_isc, 'senza_presenza', v_senza, 'da_guardare', v_guard, 'gia_firmato', v_firmato,
    'motivo', case when v_isc = 0 then 'nessun iscritto'
                   when v_guard > 0 then v_guard || ' firme dal QR da confermare o respingere'
                   when v_senza > 0 then v_senza || ' iscritti senza presenza segnata (assente, firma su carta o firma dal QR confermata)'
                   else null end);
end $$;
revoke execute on function public.corso_docente_registro_pronto(bigint) from public, anon;

-- ── 2. l'accettazione firmata scrive l'incarico ──────────────
create or replace function public.trg_firme_accettazione_incarico()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tipo = 'accettazione_incarico' and new.stato = 'firmata' and coalesce(old.stato, '') <> 'firmata' and new.rif like 'incarico:%' then
    update public.s_corsi_incarichi set accettato_il = coalesce(new.firmata_il, now()), accettazione_firma_id = new.id
     where id = split_part(new.rif, ':', 2)::bigint;
  end if;
  return new;
end $$;
drop trigger if exists trg_s_firme_accettazione_incarico on public.s_firme;
create trigger trg_s_firme_accettazione_incarico after insert or update of stato on public.s_firme
  for each row execute function public.trg_firme_accettazione_incarico();

-- ── 3. il docente legge la lettera firmata del SUO incarico ──
drop policy if exists firme_presidente_lettura on storage.objects;
create policy firme_presidente_lettura on storage.objects for select to authenticated
  using (bucket_id = 'firme-presidente' and (
    public.is_segreteria()
    or exists (select 1 from public.s_firme f
                where lower(f.firmatario_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                  and (f.file_originale = objects.name or f.file_firmato = objects.name or f.file_precedente = objects.name))
    or exists (select 1 from public.s_firme f join public.s_corsi_incarichi k on f.tipo = 'incarico_docenza' and f.rif = 'docenza:' || k.id::text
                where f.stato = 'firmata' and f.file_firmato = objects.name and k.persona_id is not null and k.persona_id = public.mia_persona_id())));

-- ── 4. i flussi nel cruscotto «che cosa è stato usato» ───────
do $$
declare d text; a1 text; a2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 's_flussi_uso';
  a1 := 'from public.s_iscrizioni where stato = ''confermata''';
  a2 := '(''Formazione'', ''iscr_confermata'', ''Iscrizione confermata dalla segreteria'')';
  if d is null or position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 's_flussi_uso: ancora non trovata'; end if;
  if position('allievo_in_aula' in d) > 0 then return; end if;
  d := replace(d, a1, a1 || E'\n    /* la pagina del docente (14/10/2026, lotto 5) */'
    || E'\n    union all select ''Formazione'', ''allievo_in_aula'', ''Allievo aggiunto in aula dal docente'', aggiunto_in_aula_il::date from public.s_corsi_iscritti where aggiunto_in_aula_il is not null'
    || E'\n    union all select ''Formazione'', ''incarico_accettato'', ''Incarico di docenza accettato nell''''app'', accettato_il::date from public.s_corsi_incarichi where accettato_il is not null'
    || E'\n    union all select ''Formazione'', ''registro_giornata_firmato'', ''Registro della giornata firmato dal docente'', firmata_il::date from public.s_firme where tipo = ''registro_giornata'' and stato = ''firmata''');
  d := replace(d, a2, a2 || E',\n    (''Formazione'', ''allievo_in_aula'', ''Allievo aggiunto in aula dal docente''),\n    (''Formazione'', ''incarico_accettato'', ''Incarico di docenza accettato nell''''app''),\n    (''Formazione'', ''registro_giornata_firmato'', ''Registro della giornata firmato dal docente'')');
  execute d;
end $$;
