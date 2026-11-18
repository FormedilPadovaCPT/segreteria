-- ============================================================
-- LA CONFERMA DELL'ISCRIZIONE PER MAIL, COL CODICE PER FIRMARE
-- (18/11/2026, deciso dall'utente — tredicesima eccezione alla regola
-- «l'app prepara, la persona manda»)
--
-- Quando la segreteria preme «Conferma le iscrizioni», a ciascun iscritto
-- (una mail per indirizzo, come il promemoria) parte da sola la mail
-- «Iscrizione confermata» con evento, date, sede e il codice personale per
-- la firma di presenza. Non parte prima della conferma, e non parte a chi si
-- è registrato in sala. La spedisce promemoria-corsi ({ conferma_iscrizione }).
--
-- Qui: l'iscritto ricorda da quale richiesta è nato (iscrizione_id) e se la
-- conferma è partita (conferma_mail_*): la prenotazione prima di spedire
-- impedisce che arrivi due volte, come nel quaderno dei promemoria.
-- ============================================================

alter table public.s_corsi_iscritti
  add column if not exists iscrizione_id              bigint references public.s_iscrizioni(id) on delete set null,
  add column if not exists conferma_mail_prenotata_il timestamptz,
  add column if not exists conferma_mail_il           timestamptz,
  add column if not exists conferma_mail_a            text,
  add column if not exists conferma_mail_esito        text;
create index if not exists s_corsi_iscritti_iscrizione_idx on public.s_corsi_iscritti (iscrizione_id) where iscrizione_id is not null;
comment on column public.s_corsi_iscritti.iscrizione_id is 'La richiesta d''iscrizione (s_iscrizioni) da cui è nato l''iscritto, scritta da iscr_conferma dal 18/11/2026.';
comment on column public.s_corsi_iscritti.conferma_mail_il is 'Quando è partita la mail «Iscrizione confermata» col codice per firmare (promemoria-corsi, eccezione 13).';

create or replace function public.iscr_conferma(p_id bigint, p_scelte jsonb default '[]'::jsonb, p_impresa_id text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare r record; p jsonb; s jsonb; i int; v_creati int := 0; v_saltati int := 0;
        v_pid uuid; v_cf text; v_nomin text; v_imp text; v_nuove int := 0;
        v_utente text; v_imp_riga text; v_imp_txt text; v_rapp jsonb; v_rapporti int := 0;
        v_nom jsonb; v_nomine int := 0; v_data date; v_nuovo bigint; v_ids bigint[] := '{}';
begin
  if not public.is_segreteria() then raise exception 'non autorizzato'; end if;
  select * into r from public.s_iscrizioni where id = p_id for update;
  if not found then raise exception 'iscrizione % inesistente', p_id; end if;
  if r.stato = 'confermata' then raise exception 'iscrizione % già confermata', p_id; end if;
  if r.corso_id is null then raise exception 'l''iscrizione % non è agganciata a nessun evento', p_id; end if;

  v_utente := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sistema');
  v_imp := coalesce(p_impresa_id, r.impresa_id);
  v_data := coalesce(r.timestamp_modulo::date, r.creato_il::date);

  for i in 0 .. greatest(jsonb_array_length(r.persone) - 1, 0) loop
    exit when jsonb_array_length(r.persone) = 0;
    p := r.persone -> i;
    select e into s from jsonb_array_elements(p_scelte) e where (e ->> 'i')::int = i limit 1;

    if coalesce(s ->> 'azione', 'iscrivi') = 'salta' then
      v_saltati := v_saltati + 1; continue;
    end if;

    v_cf := nullif(upper(regexp_replace(coalesce(p ->> 'cf', ''), '\s', '', 'g')), '');
    v_nomin := btrim(coalesce(p ->> 'cognome', '') || ' ' || coalesce(p ->> 'nome', ''));
    if v_nomin = '' then continue; end if;

    v_pid := nullif(s ->> 'persona_id', '')::uuid;
    v_imp_riga := coalesce(nullif(s ->> 'impresa_id', ''), v_imp);
    v_imp_txt  := coalesce(nullif(btrim(coalesce(p -> 'impresa' ->> 'ragione_sociale', '')), ''), r.ragione_sociale);

    if v_pid is null and coalesce((s ->> 'crea_anagrafica')::boolean, false) then
      insert into public.persone (titolo, nome, cognome, cf, email, telefono, sesso,
                                  data_nascita, comune_nascita, cittadinanza, qualifica, note, updated_by)
      values (nullif(p ->> 'titolo',''), nullif(p ->> 'nome',''), nullif(p ->> 'cognome',''),
              v_cf, nullif(p ->> 'email',''), nullif(p ->> 'telefono',''),
              nullif(upper(coalesce(p ->> 'sesso','')), ''),
              nullif(p ->> 'nato_il','')::date, nullif(p ->> 'comune_nascita',''),
              nullif(p ->> 'cittadinanza',''), nullif(p ->> 'mansione',''),
              'Anagrafica nata dall''iscrizione n° ' || p_id || ' del ' || to_char(r.creato_il, 'DD/MM/YYYY'),
              v_utente)
      returning persona_id into v_pid;
      v_nuove := v_nuove + 1;
    end if;

    v_rapp := public.iscr_registra_rapporto(
      v_pid, v_imp_riga,
      coalesce(s ->> 'rapporto', case when (s ->> 'crea_anagrafica')::boolean then 'crea' else 'niente' end),
      nullif(p ->> 'mansione',''), p_id, v_data);
    if (v_rapp ->> 'fatto')::boolean then v_rapporti := v_rapporti + 1; end if;

    begin
      v_nom := public.iscr_nomina_da_ruolo(v_pid, v_imp_riga, p ->> 'ruolo',
                                           v_nomin, v_imp_txt, p_id, v_data);
      if (v_nom ->> 'fatto')::boolean then v_nomine := v_nomine + 1; end if;
    exception when others then
      raise warning 'nomina non registrata per %: %', v_nomin, sqlerrm;
    end;

    insert into public.s_corsi_iscritti
      (corso_id, persona_id, nominativo, cf, impresa_id, impresa_txt, ruolo, mansione,
       email_iscrizione, data_iscrizione, note, iscrizione_id)
    values (r.corso_id, v_pid, v_nomin, v_cf, v_imp_riga, v_imp_txt,
            nullif(p ->> 'ruolo',''), nullif(p ->> 'mansione',''),
            coalesce(nullif(p ->> 'email',''), r.email), v_data,
            'Iscrizione n° ' || p_id || ' dal portale', p_id)
    returning id into v_nuovo;
    v_ids := v_ids || v_nuovo;
    v_creati := v_creati + 1;
  end loop;

  update public.s_iscrizioni set
    stato = 'confermata', confermata_il = now(), confermata_da = v_utente,
    iscritti_creati = v_creati, impresa_id = coalesce(p_impresa_id, impresa_id),
    note_ufficio = coalesce(p_note, note_ufficio)
  where id = p_id;

  return jsonb_build_object('iscritti', v_creati, 'saltati', v_saltati,
                            'anagrafiche_nuove', v_nuove, 'rapporti_registrati', v_rapporti,
                            'nomine_registrate', v_nomine, 'iscritti_id', to_jsonb(v_ids),
                            'in_sala', r.in_sala is not null);
end $function$;
revoke execute on function public.iscr_conferma(bigint, jsonb, text, text) from public, anon;
grant execute on function public.iscr_conferma(bigint, jsonb, text, text) to authenticated, service_role;
