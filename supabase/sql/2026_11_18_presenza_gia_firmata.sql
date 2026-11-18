-- ════════════════════════════════════════════════════════════════════════
-- Firma di presenza: una sola entrata e una sola uscita per turno (18/11/2026)
-- Dalla prova del corso 336 con l'utente: una seconda firma prima di metà
-- giornata entrava come seconda entrata. Regola dell'utente: chi ha già
-- firmato quel momento non firma di nuovo («hai già firmato, se c'è un errore
-- rivolgiti al tutor d'aula»), e il tutor dal PC lo sblocca subito.
--
-- 1. trg_firme_presenza_doppione: una firma uguale (stessa persona, giornata,
--    turno e momento) a una ricevuta o confermata, a qualunque ora, nasce
--    respinta «già firmata». Prima valeva solo entro 2 minuti. È la rete di
--    sicurezza: il telefono di norma non la fa nemmeno partire.
-- 2. pres_pubblicazione: ogni persona porta 's', gli sblocchi:
--    { "aaaa-mm-gg|turno|tipo": ora } = l'ultima firma di quel momento
--    respinta da una persona (non dagli automatismi). Il portale non conta le
--    firme arrivate prima dello sblocco.
-- 3. trg_firme_presenza_sblocco: quando una persona respinge una firma, il
--    corso si ripubblica da solo sul portale (pres_ripubblica): lo sblocco
--    arriva al telefono senza premere niente, dal PC della segreteria come
--    dalla pagina del docente.
-- Il portale (progetto Servizi) ha la sua parte:
-- servizi/supabase/sql/2026_11_18_presenza_gia_firmata.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.trg_firme_presenza_doppione()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_prima public.s_corsi_firme_presenza;
begin
  if new.iscritto_id is null or new.giornata_id is null or new.tipo is null then return new; end if;
  select * into v_prima from public.s_corsi_firme_presenza f
   where f.iscritto_id = new.iscritto_id and f.giornata_id = new.giornata_id
     and f.tipo = new.tipo and f.turno is not distinct from new.turno
     and f.stato in ('ricevuta', 'confermata')
   order by f.ora_server limit 1;
  if found then
    new.stato := 'respinta';
    new.note := concat_ws(' · ', nullif(new.note, ''),
      case when abs(extract(epoch from (coalesce(new.ora_server, now()) - v_prima.ora_server))) < 120
        then 'doppione: stessa firma arrivata ' || to_char(v_prima.ora_server at time zone 'Europe/Rome', 'HH24:MI:SS') || ' (id ' || v_prima.id || ')'
        else 'già firmata alle ' || to_char(v_prima.ora_server at time zone 'Europe/Rome', 'HH24:MI') || ' (id ' || v_prima.id
             || '): per farla rifare si respinge quella' end);
    new.confermata_da := 'automatico (doppione)';
    new.confermata_il := now();
  end if;
  return new;
end $$;

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

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'h', encode(extensions.digest(convert_to(upper(i.test_codice), 'UTF8'), 'sha256'), 'hex'),
           'a', public.pres_impronta_anno(i.test_codice, public.iscritto_yy(i.id)),
           'n', (select string_agg(left(p, 1) || '.', ' ')
                   from unnest(string_to_array(regexp_replace(coalesce(i.nominativo, ''), '\s+', ' ', 'g'), ' ')) p
                  where p <> ''),
           -- solo con questionari-ricevi che conosce 's' (v9 sul progetto Servizi):
           -- prima di allora il portale rifiutava l'intera pubblicazione
           's', case when (select valore from public.s_config where chiave = 'pres_sblocchi_portale') = 'si' then
                (select jsonb_object_agg(k, il) from (
                   select to_char(g.data, 'YYYY-MM-DD') || '|' || coalesce(f.turno::text, '') || '|' || f.tipo as k,
                          max(f.confermata_il) as il
                     from public.s_corsi_firme_presenza f
                     join public.s_corsi_giornate g on g.id = f.giornata_id
                    where f.iscritto_id = i.id and f.stato = 'respinta' and f.tipo is not null
                      and f.confermata_il is not null
                      and coalesce(f.confermata_da, '') not like 'automatico%'
                    group by 1) sb) end))), '[]'::jsonb)
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

create or replace function public.trg_firme_presenza_sblocco()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.stato = 'respinta' and old.stato is distinct from 'respinta'
     and coalesce(new.confermata_da, '') not like 'automatico%' then
    begin
      perform public.pres_ripubblica(new.corso_id);
    exception when others then
      raise warning 'trg_firme_presenza_sblocco: corso % non ripubblicato (%): va ripubblicato dalla segreteria', new.corso_id, sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_s_corsi_firme_presenza_sblocco on public.s_corsi_firme_presenza;
create trigger trg_s_corsi_firme_presenza_sblocco after update of stato on public.s_corsi_firme_presenza
  for each row execute function public.trg_firme_presenza_sblocco();

-- interruttore: 'si' solo dopo il deploy di questionari-ricevi v9 sul progetto Servizi
insert into public.s_config (chiave, valore, descrizione) values ('pres_sblocchi_portale', 'no',
  'Firme dal QR: manda al portale gli sblocchi del tutor (persone[].s). ''si'' solo se questionari-ricevi li accetta (v9, 18/11/2026).')
on conflict (chiave) do nothing;
