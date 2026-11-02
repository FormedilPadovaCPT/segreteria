-- ASSEMBLEA SINDACALE: la partecipazione del dipendente e il contatore delle 12 ore (02/11/2026,
-- chiesto dall'utente).
-- CCNL Formazione Professionale 2024-2027, art. 17 lettera B c.1 (testo ufficiale in
-- 3_RISORSE/Normativa): «12 ore annue individuali retribuite per tenere l'assemblea degli operatori
-- in orario di lavoro». Migliora le 10 ore dello Statuto dei lavoratori (L. 300/1970, art. 20,
-- letto su Normattiva il 02/11/2026), che lascia alla contrattazione collettiva condizioni migliori.
--
-- Decisioni dell'utente, 02/11/2026:
--   · l'«assemblea» è la causale che l'ufficio usa da sempre, «Riunione sindacale» (monte
--     permessi_sindacali): non si crea una causale nuova, le ore già registrate contano;
--   · le 12 ore si contano per ANNO FORMATIVO, che parte il 1° SETTEMBRE (il CCNL dice «annue» e non
--     fissa l'inizio: il giorno sta in s_config, così si cambia senza toccare il codice);
--   · l'assemblea, quando si tiene, è GIÀ autorizzata: il lavoratore decide solo se partecipa. La
--     richiesta nasce approvata, senza nulla osta del Direttore (aut_modalita = 'assemblea').
--
-- Il conteggio sta nel database (s_assemblea_ore), non nella pagina: ore delle righe vere di banca
-- ore con la causale, più le partecipazioni comunicate e non ancora trasformate in righe.

insert into public.s_config(chiave, valore, descrizione) values
  ('presenze_assemblea_ore_annue', '12',
   'Ore annue individuali retribuite per l''assemblea sindacale in orario di lavoro (CCNL Formazione Professionale 2024-2027, art. 17 lett. B c.1; lo Statuto dei lavoratori, art. 20, ne prevede 10).'),
  ('presenze_assemblea_inizio_anno', '09-01',
   'Giorno (mm-gg) in cui comincia l''anno formativo su cui si contano le ore di assemblea sindacale. Deciso dall''utente il 02/11/2026: 1° settembre.')
on conflict (chiave) do nothing;

-- fotografia del contatore sulla richiesta: la leggono anche Direttore e Amministrazione, che le
-- tabelle delle presenze non le leggono (come visita_foto e saldo_foto)
alter table public.s_ferie_richieste add column if not exists assemblea_foto jsonb;
comment on column public.s_ferie_richieste.assemblea_foto is
  'Assemblea sindacale (art. 17 B CCNL FP): contatore delle 12 ore dell''anno formativo fotografato alla comunicazione (s_assemblea_ore).';

-- Il contatore. p_escludi_richiesta: le righe e la comunicazione di quella richiesta non si contano,
-- così una richiesta non si conta due volte quando se ne ricalcola la fotografia.
create or replace function public.s_assemblea_ore(p_dipendente text, p_data date default current_date,
                                                  p_escludi_richiesta bigint default null)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_inizio text := coalesce((select valore from public.s_config where chiave = 'presenze_assemblea_inizio_anno'), '09-01');
  v_tetto int := round(coalesce((select valore from public.s_config where chiave = 'presenze_assemblea_ore_annue')::numeric, 12) * 60);
  v_mm int; v_gg int; v_da date; v_a date;
  v_usate int; v_comunicate int;
begin
  /* chi non legge le presenze avrebbe uno zero muto, che sembra «nessuna ora usata»: meglio un errore */
  if not public.is_segreteria() then
    raise exception 'Il contatore dell''assemblea sindacale lo legge la segreteria';
  end if;
  if p_dipendente is null or p_data is null then
    raise exception 'Servono dipendente e data';
  end if;
  v_mm := split_part(v_inizio, '-', 1)::int;
  v_gg := split_part(v_inizio, '-', 2)::int;
  v_da := make_date(extract(year from p_data)::int, v_mm, v_gg);
  if p_data < v_da then v_da := (v_da - interval '1 year')::date; end if;
  v_a := (v_da + interval '1 year' - interval '1 day')::date;

  select coalesce(sum(e.ore_min), 0) into v_usate
    from public.s_presenze_extra e
   where e.dipendente = p_dipendente
     and lower(btrim(e.causale)) = 'riunione sindacale'
     and e.data between v_da and v_a
     and (p_escludi_richiesta is null or coalesce(e.note, '') !~ ('Richiesta n° ' || p_escludi_richiesta || '([^0-9]|$)'));

  select coalesce(sum(round(r.ore * 60)), 0) into v_comunicate
    from public.s_ferie_richieste r
   where r.dipendente = p_dipendente
     and r.tipo = 'riunione_sindacale'
     and r.aut_stato = 'approvata'
     and not coalesce(r.righe_generate, false)
     and r.data_inizio between v_da and v_a
     and (p_escludi_richiesta is null or r.id <> p_escludi_richiesta);

  return jsonb_build_object(
    'anno_da', v_da,
    'anno_a', v_a,
    'anno', extract(year from v_da)::int || '-' || lpad(((extract(year from v_da)::int + 1) % 100)::text, 2, '0'),
    'tetto_min', v_tetto,
    'usate_min', v_usate,
    'comunicate_min', v_comunicate,
    'residuo_min', greatest(v_tetto - v_usate - v_comunicate, 0));
end;
$$;

revoke all on function public.s_assemblea_ore(text, date, bigint) from public, anon;
grant execute on function public.s_assemblea_ore(text, date, bigint) to authenticated;
comment on function public.s_assemblea_ore(text, date, bigint) is
  'Ore di assemblea sindacale (causale «Riunione sindacale») del dipendente nell''anno formativo della data, contro le 12 annue retribuite dell''art. 17 B CCNL FP. Solo segreteria: Direttore e Amministrazione leggono la fotografia assemblea_foto sulla richiesta.';
