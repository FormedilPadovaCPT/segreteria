-- ════════════════════════════════════════════════════════════════════════
-- sala_presenze: i doppioni si chiudono respinti, non confermati (18/11/2026)
-- Dalla prova del corso 338: confermando l'uscita, le due entrate doppie della
-- stessa persona sono state chiuse «confermate» insieme. Le firme erano giuste
-- (nessuna doppia), lo stato no: una richiesta la cui presenza era già scritta
-- si chiude «respinta», con la nota del perché. Quella che si sta confermando
-- resta confermata.
-- ════════════════════════════════════════════════════════════════════════
do $$
declare d text; a1 text := 'v_gia := v_gia + 1;'; a2 text := 'stato = ''confermata'',';
        a3 text := 'if exists (select 1 from public.s_corsi_firme_presenza f';
begin
  d := pg_get_functiondef('public.sala_presenze'::regproc);
  if position('v_dop' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'sala_presenze: punti di innesto non trovati';
  end if;
  d := regexp_replace(d, '\ndeclare ', E'\ndeclare v_dop boolean := false; ');
  d := replace(d, a3, 'v_dop := false;
    ' || a3);
  d := replace(d, a1, a1 || ' v_dop := (q.id <> r.id);');
  d := replace(d, a2, 'stato = case when v_dop then ''respinta'' else ''confermata'' end,');
  d := replace(d, '''Presenza scritta insieme alla richiesta n° '' || r.id || ''.''',
    'case when v_dop then ''Doppione: la stessa '' || q.in_sala || '' era già scritta; chiusa come respinta insieme alla richiesta n° '' || r.id || ''.''
                               else ''Presenza scritta insieme alla richiesta n° '' || r.id || ''.'' end');
  execute d;
end $$;

-- le due richieste doppie della prova del 338 (n° 3 e 4, id 14 e 15)
update public.s_iscrizioni set stato = 'respinta',
  note_ufficio = concat_ws(E'\n', note_ufficio, 'Doppione chiuso come respinta dall''assistente (prova del 18/11/2026).')
 where corso_id = 338 and id in (14, 15);
