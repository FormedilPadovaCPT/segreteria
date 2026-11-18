-- Crediti formativi: il tecnico scarica i suoi documenti dal gestionale (18/11/2026)
--
-- In crediti_formativi() i documenti portano in più `id` e `ha_file`: vero se la
-- riga ha il collegamento a Drive (drive_file_id) o il percorso del file nella
-- nota («File: 2_AREE/…/nome.pdf», scritto dalla ricostruzione del 17/11/2026).
-- Il file lo consegna la edge function crediti-attestato, azione «scarica», che
-- controlla che la riga sia del tecnico che chiede (o che chieda la segreteria)
-- e, se manca drive_file_id, trova il file dal percorso e lo salva nella riga.
-- Applicata il 18/11/2026: la funzione completa è quella di
-- 2026_11_17_crediti_attestati_caricati_dal_tecnico.sql con, nei documenti:
--
--   'id', d.id,
--   'ha_file', (d.drive_file_id is not null
--               or coalesce(d.note, '') ~* 'File: [0-9]_?[A-Z].*\.(pdf|jpe?g|png|docx?|xlsx?|msg|eml)'),
--
-- Al 18/11/2026: 175 documenti su 179 (requisiti 5, 6, 8) hanno un file.

do $$ declare d text := pg_get_functiondef('public.crediti_formativi'::regproc);
begin
  if position($q$'ha_file'$q$ in d) > 0 then return; end if;   -- già applicata
  execute replace(d, $q$'tecnico_id', d.tecnico_id, 'requisito_id', d.requisito_id, 'tipo', d.tipo,$q$,
    $q$'id', d.id,
        'tecnico_id', d.tecnico_id, 'requisito_id', d.requisito_id, 'tipo', d.tipo,
        'ha_file', (d.drive_file_id is not null or coalesce(d.note, '') ~* 'File: [0-9]_?[A-Z].*\.(pdf|jpe?g|png|docx?|xlsx?|msg|eml)'),$q$);
end $$;
