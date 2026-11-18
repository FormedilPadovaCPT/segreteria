-- Il tecnico vede anche contratto e polizze, con le scadenze (18/11/2026, chiesto dall'utente)
--
-- crediti_formativi() restituisce in più, SOLO al tecnico per sé (non al
-- Coordinatore né alla segreteria, che ha la sua app):
--   altri_requisiti  = i requisiti a scadenza del catalogo (contratto, polizze,
--                      UNI 11751-2 se il tecnico è asseveratore), senza note e fonte;
--   altri_documenti  = le sue righe di s_doc_tecnico per quei requisiti: date,
--                      disdetta, protocollo e ha_file, mai la nota (contiene
--                      percorsi e appunti d'ufficio).
-- Lo stato si calcola nel gestionale con statoScadenza() di doc-tecnici-ore.js,
-- la stessa regola della pagina «Documenti tecnici».

create or replace function public.crediti_formativi()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
  ),
  io as (
    select t.* from public.tecnici t, chi where chi.mio is not null and t.tecnico_id = chi.mio
  ),
  altri as (
    select r.* from public.s_doc_requisito r, io
     where r.attivo and r.ore_soglia is null
       and r.id not in (select id from req)
       and (r.per_chi = 'tecnici' or (r.per_chi = 'asseveratori' and coalesce(io.asseveratore, false)))
  )
  select jsonb_build_object(
    'ruolo', case when (select segr from chi) then 'segreteria' when (select coord from chi) then 'coordinatore'
                  when (select mio from chi) is not null then 'tecnico' else 'nessuno' end,
    'requisiti', coalesce((select jsonb_agg(to_jsonb(r) - 'note' - 'fonte' order by r.ordine) from req r), '[]'::jsonb),
    'tecnici', coalesce((select jsonb_agg(to_jsonb(t) order by t.tecnico_cognome, t.tecnico_nome) from tec t), '[]'::jsonb),
    'documenti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'tecnico_id', d.tecnico_id, 'requisito_id', d.requisito_id, 'tipo', d.tipo,
        'ha_file', (d.drive_file_id is not null or coalesce(d.note, '') ~* 'File: [0-9]_?[A-Z].*\.(pdf|jpe?g|png|docx?|xlsx?|msg|eml)'),
        'descrizione', d.descrizione, 'data_inizio', d.data_inizio, 'data_fine', d.data_fine,
        'senza_scadenza', d.senza_scadenza, 'ore', d.ore, 'ore_di_corso', d.ore_di_corso,
        'drive_url', case when (select segr from chi) or d.tecnico_id = (select mio from chi) then d.drive_url end))
        from public.s_doc_tecnico d
       where d.tecnico_id in (select tecnico_id from tec)
         and d.requisito_id in (select id from req)), '[]'::jsonb),
    'invii', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.inviato_il desc)
        from public.s_doc_tecnico_invii i, chi
       where (chi.segr and (i.stato = 'da_verificare' or i.verificato_il > now() - interval '30 days'))
          or (i.tecnico_id = chi.mio and (i.stato <> 'confermato' or i.verificato_il > now() - interval '30 days'))), '[]'::jsonb),
    'altri_requisiti', coalesce((select jsonb_agg(to_jsonb(r) - 'note' - 'fonte' order by r.ordine) from altri r), '[]'::jsonb),
    'altri_documenti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'requisito_id', d.requisito_id, 'descrizione', d.descrizione,
        'data_inizio', d.data_inizio, 'data_fine', d.data_fine, 'senza_scadenza', d.senza_scadenza,
        'disdetto_il', d.disdetto_il, 'protocollo_txt', d.protocollo_txt,
        'ha_file', (d.drive_file_id is not null or coalesce(d.note, '') ~* 'File: [0-9]_?[A-Z].*\.(pdf|jpe?g|png|docx?|xlsx?|msg|eml)'))
        order by d.data_inizio desc nulls last)
        from public.s_doc_tecnico d, io
       where d.tecnico_id = io.tecnico_id and d.requisito_id in (select id from altri)), '[]'::jsonb)
  );
$function$;
