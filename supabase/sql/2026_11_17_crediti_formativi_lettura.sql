-- Crediti formativi dei tecnici nel gestionale (17/11/2026, decisione dell'utente):
-- la segreteria e il Coordinatore (sola lettura) vedono tutti i tecnici in servizio,
-- ogni tecnico vede solo i propri. s_doc_tecnico resta leggibile solo dalla segreteria
-- (ci sono anche polizze e contratti): questa funzione dà SOLO i requisiti a ore
-- (aggiornamento coordinatore, formatori) e quello da cui partono (corso 120 ore),
-- e il collegamento al file solo a chi è il tecnico stesso o la segreteria.
-- Chi non è nessuno dei tre riceve un elenco vuoto, non un errore.

create or replace function public.crediti_formativi()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with chi as (
    select public.is_segreteria() as segr, public.is_coordinatore() as coord, public.mio_tecnico_id() as mio
  ),
  req as (
    select r.* from public.s_doc_requisito r
     where r.attivo and (r.ore_soglia is not null
        or r.id in (select origine_requisito_id from public.s_doc_requisito where origine_requisito_id is not null))
  ),
  tec as (
    select t.tecnico_id, t.tecnico_cognome, t.tecnico_nome, t.asseveratore
      from public.tecnici t, chi
     where coalesce(t.attivo, false) and not coalesce(t.dipendente, false)
       and t.tecnico_id <> 'TEC-PROVA-2026'
       and (chi.segr or chi.coord or t.tecnico_id = chi.mio)
  )
  select jsonb_build_object(
    'ruolo', case when (select segr from chi) then 'segreteria' when (select coord from chi) then 'coordinatore'
                  when (select mio from chi) is not null then 'tecnico' else 'nessuno' end,
    'requisiti', coalesce((select jsonb_agg(to_jsonb(r) - 'note' - 'fonte' order by r.ordine) from req r), '[]'::jsonb),
    'tecnici', coalesce((select jsonb_agg(to_jsonb(t) order by t.tecnico_cognome, t.tecnico_nome) from tec t), '[]'::jsonb),
    'documenti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tecnico_id', d.tecnico_id, 'requisito_id', d.requisito_id, 'tipo', d.tipo,
        'descrizione', d.descrizione, 'data_inizio', d.data_inizio, 'data_fine', d.data_fine,
        'senza_scadenza', d.senza_scadenza, 'ore', d.ore, 'ore_di_corso', d.ore_di_corso,
        'drive_url', case when (select segr from chi) or d.tecnico_id = (select mio from chi) then d.drive_url end))
        from public.s_doc_tecnico d
       where d.tecnico_id in (select tecnico_id from tec)
         and d.requisito_id in (select id from req)), '[]'::jsonb)
  );
$$;

revoke all on function public.crediti_formativi() from public, anon;
grant execute on function public.crediti_formativi() to authenticated;
