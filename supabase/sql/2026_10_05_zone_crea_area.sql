-- ============================================================
-- Tecnici e zone: creare un'area nuova — 05/10/2026
-- (chiesto dall'utente: «devo poter creare una nuova zona da assegnare a un tecnico»)
--
-- Fino a oggi la scheda «Tecnici e zone» lavorava solo sulle aree già
-- esistenti (le 56 di Access): si poteva passare un'area a un altro tecnico
-- e spostare comuni fra aree, ma non aprirne una nuova. Qui l'area nuova:
--   - prende il numero dopo l'ultimo (come in Access TAreaTecnici, i numeri
--     non si riusano: le lettere mensili storiche li portano già);
--   - nasce col tecnico che la ha da oggi (zone_aree_tecnici, dal = oggi);
--   - nasce VUOTA: i comuni si aggiungono con «+ Comune» (zone_sposta), che
--     sposta anche le visite aperte se il comune era in un'altra area.
-- Etichetta: se non la si scrive, alla maniera di Access «aaaammCognome»
-- (come «202207Nicola», «2025Canova»).
-- Per tornare indietro: drop function public.zone_crea_area(text, text, text);
-- (le aree create restano: sono storia, si svuotano con «Passa l'area» / «Sposta»).
-- ============================================================

create or replace function public.zone_crea_area(p_tecnico text, p_etichetta text default null, p_note text default null)
returns json language plpgsql security definer
set search_path = public
as $$
declare t record; n int; et text;
begin
  if not ((select public.is_segreteria()) or session_user = 'postgres') then raise exception 'Non autorizzato'; end if;
  select tecnico_id, trim(coalesce(tecnico_cognome,'')) cognome, attivo, elimina into t from public.tecnici where tecnico_id = p_tecnico;
  if t.tecnico_id is null then raise exception 'Tecnico inesistente'; end if;
  if t.attivo is false or coalesce(t.elimina,0) <> 0 then raise exception 'Il tecnico non è in servizio'; end if;

  -- il numero dopo l'ultimo, senza che due creazioni insieme prendano lo stesso
  lock table public.zone_aree in exclusive mode;
  select coalesce(max(area_id), 0) + 1 into n from public.zone_aree;
  et := coalesce(nullif(trim(p_etichetta), ''), to_char(current_date, 'YYYYMM') || t.cognome);

  insert into public.zone_aree (area_id, etichetta, note)
  values (n, et, nullif(trim(coalesce(p_note, '')), ''));
  insert into public.zone_aree_tecnici (area_id, tecnico_id, nome, dal, fonte)
  values (n, t.tecnico_id, t.cognome, current_date, 'scheda Tecnici e zone');

  return json_build_object('area', n, 'etichetta', et, 'tecnico', t.cognome);
end $$;

revoke execute on function public.zone_crea_area(text, text, text) from public, anon;
grant execute on function public.zone_crea_area(text, text, text) to authenticated, service_role;
