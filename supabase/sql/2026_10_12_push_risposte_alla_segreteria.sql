-- (12/10/2026, chiesto dall'utente) Le notifiche sul telefono della segreteria quando
-- qualcuno RISPONDE a qualcosa che la segreteria ha mandato:
--   • il Direttore autorizza o respinge un servizio CPT (segnalazioni, consulenze,
--     richieste di visita, conferenze, attestazioni DM 132);
--   • l'Amministrazione prende visione di un mandato di pagamento, o lo segna pagato;
--   • un tecnico accetta un incarico, lo rifiuta (col motivo) o lo chiude senza visita.
-- Firma del Presidente e preventivi del Direttore avvisano già dalle loro funzioni
-- (firma-presidente, approvazione-direttore). Testi tutti dal database; chi fa l'azione
-- non riceve la propria notifica. Un errore qui non blocca mai il salvataggio.

-- a chi: ogni accesso di segreteria (o admin) attivo, come avvisaSegreteria nelle funzioni
create or replace function public.push_destinatari_segreteria()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct lower(trim(email))) filter (where coalesce(trim(email), '') <> ''), '{}')
    from app_ruoli where ruolo in ('segreteria', 'admin') and stato = 'attivo';
$$;
revoke execute on function public.push_destinatari_segreteria() from public, anon, authenticated;

create or replace function public.push_alla_segreteria(p_evento text, p_titolo text, p_testo text, p_tag text,
                                                      p_silenzio interval default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_e text; v_io text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  foreach v_e in array push_destinatari_segreteria() loop
    if v_e = v_io then continue; end if;
    -- raffica (es. venti incarichi accettati di fila): una notifica sola per tag nella finestra
    if p_silenzio is not null and exists (select 1 from push_coda where email = v_e and tag = p_tag
                                           and created_at > now() - p_silenzio) then continue; end if;
    -- push_accoda scarta lo stesso evento entro 2 minuti: l'evento porta il tag, così due
    -- rifiuti di tecnici diversi a un minuto l'uno dall'altro arrivano tutti e due
    perform push_accoda(v_e, p_evento || ':' || p_tag, p_titolo, p_testo, './', p_tag);
  end loop;
exception when others then raise warning 'push_alla_segreteria: %', sqlerrm;
end $$;
revoke execute on function public.push_alla_segreteria(text, text, text, text, interval) from public, anon, authenticated;

-- 1. il Direttore decide un'autorizzazione dei servizi CPT
create or replace function public.push_aut_decisa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_j jsonb := to_jsonb(new); v_cosa text; v_chi text; v_n text;
begin
  begin
    if new.aut_stato in ('approvata', 'respinta') and old.aut_stato in ('da_richiedere', 'richiesta') then
      v_cosa := case tg_table_name when 's_segnalazioni' then 'Segnalazione' when 's_consulenze' then 'Consulenza'
                  when 's_visite_richieste' then 'Richiesta di visita' when 's_conferenze_cantiere' then 'Conferenza di cantiere'
                  when 's_attestazioni_dm132' then 'Attestazione DM 132' else 'Servizio' end;
      v_chi := coalesce(nullif(v_j ->> 'ragione_sociale', ''), nullif(v_j ->> 'notificante', ''), '');
      v_n := coalesce(v_j ->> 'progressivo', 'm' || new.id);
      perform push_alla_segreteria('aut_decisa',
        case when new.aut_stato = 'approvata' then 'Il Direttore ha autorizzato' else 'Il Direttore non ha autorizzato' end,
        v_cosa || ' n° ' || v_n || case when v_chi <> '' then ' — ' || v_chi else '' end
          || case when new.aut_stato = 'approvata' then ': si può assegnare e lavorare.' else ': la trovi fra le autorizzazioni, nell''app Segreteria.' end,
        'aut-decisa-' || tg_table_name || '-' || new.id);
    end if;
  exception when others then raise warning 'push_aut_decisa: %', sqlerrm; end;
  return null;
end $$;

drop trigger if exists trg_push_aut_decisa on public.s_segnalazioni;
create trigger trg_push_aut_decisa after update of aut_stato on public.s_segnalazioni for each row execute function push_aut_decisa();
drop trigger if exists trg_push_aut_decisa on public.s_consulenze;
create trigger trg_push_aut_decisa after update of aut_stato on public.s_consulenze for each row execute function push_aut_decisa();
drop trigger if exists trg_push_aut_decisa on public.s_visite_richieste;
create trigger trg_push_aut_decisa after update of aut_stato on public.s_visite_richieste for each row execute function push_aut_decisa();
drop trigger if exists trg_push_aut_decisa on public.s_conferenze_cantiere;
create trigger trg_push_aut_decisa after update of aut_stato on public.s_conferenze_cantiere for each row execute function push_aut_decisa();
drop trigger if exists trg_push_aut_decisa on public.s_attestazioni_dm132;
create trigger trg_push_aut_decisa after update of aut_stato on public.s_attestazioni_dm132 for each row execute function push_aut_decisa();

-- 2. l'Amministrazione e il mandato di pagamento
create or replace function public.push_mandato_amministrazione()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    if new.visto_il is not null and old.visto_il is null and coalesce(new.visto_fonte, '') <> 'carta' then
      perform push_alla_segreteria('mandato_visto', 'Mandato visto dall''Amministrazione',
        coalesce(nullif(new.visto_nome, ''), new.visto_da, 'L''Amministrazione') || ' ha preso visione del mandato n° ' || new.id
          -- importo all'italiana: il database ha le impostazioni numeriche inglesi (4,187.04)
          || ' (' || translate(to_char(new.totale, 'FM999,999,990.00'), ',.', '.,') || ' €): si può pagare.',
        'mandato-visto-' || new.id);
    end if;
    if new.pagato_il is not null and old.pagato_il is null then
      perform push_alla_segreteria('mandato_pagato', 'Mandato pagato',
        'Il mandato n° ' || new.id || ' risulta pagato il ' || to_char(new.pagato_il, 'DD/MM/YYYY') || '.',
        'mandato-pagato-' || new.id);
    end if;
  exception when others then raise warning 'push_mandato_amministrazione: %', sqlerrm; end;
  return null;
end $$;
drop trigger if exists trg_push_mandato_amministrazione on public.s_mandati_pagamento;
create trigger trg_push_mandato_amministrazione after update of visto_il, pagato_il on public.s_mandati_pagamento
  for each row execute function push_mandato_amministrazione();

-- 3. il tecnico risponde all'incarico
create or replace function public.push_incarico_risposta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_tec text := coalesce(nullif(new.tecnico_nome, ''), split_part(coalesce(new.tecnico_email, ''), '@', 1), 'Il tecnico');
        v_dove text := concat_ws(', ', nullif(coalesce(nullif(new.impresa, ''), nullif(new.cantiere, ''), new.indirizzo), ''), nullif(new.comune, ''));
begin
  begin
    if new.rifiutato_il is not null and old.rifiutato_il is null then
      perform push_alla_segreteria('incarico_rifiutato', 'Incarico rifiutato — ' || v_tec,
        'Incarico n° ' || new.id || case when v_dove <> '' then ' (' || v_dove || ')' else '' end
          || case when coalesce(new.rifiuto_motivo, '') <> '' then ': «' || new.rifiuto_motivo || '»' else '' end
          || ' — da riassegnare.',
        'incarico-rifiutato-' || new.id);
    elsif new.accettato_il is not null and old.accettato_il is null then
      perform push_alla_segreteria('incarico_accettato', 'Incarico accettato — ' || v_tec,
        'Incarico n° ' || new.id || case when v_dove <> '' then ' (' || v_dove || ')' else '' end
          || '. Se ne accetta altri entro mezz''ora non arriva un''altra notifica.',
        'incarico-accettato-' || lower(coalesce(new.tecnico_email, '')), interval '30 minutes');
    end if;
    -- chiuso senza visita: le segnalazioni avvisano già da s_segnalazione_da_incarico
    if new.esito_il is not null and old.esito_il is null and new.esito_senza_visita is not null
       and not exists (select 1 from s_segnalazioni s where s.incarico_id = new.id) then
      perform push_alla_segreteria('incarico_senza_visita', 'Incarico chiuso senza visita — ' || v_tec,
        'Incarico n° ' || new.id || case when v_dove <> '' then ' (' || v_dove || ')' else '' end
          || ': cantiere finito o non trovato. Nell''app Segreteria si decide se pagare l''uscita.',
        'incarico-esito-' || new.id);
    end if;
  exception when others then raise warning 'push_incarico_risposta: %', sqlerrm; end;
  return null;
end $$;
drop trigger if exists trg_push_incarico_risposta on public.incarichi;
create trigger trg_push_incarico_risposta after update of accettato_il, rifiutato_il, esito_il on public.incarichi
  for each row execute function push_incarico_risposta();
