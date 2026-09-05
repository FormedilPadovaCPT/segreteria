-- Test delle tariffe con validita' e del regime fiscale per tecnico:
-- sono i numeri che finiscono nei riepiloghi da fatturare e nel report di rendicontazione.
-- Sola lettura; la transazione viene comunque annullata.
begin;

do $$
declare f record;
begin
  -- tariffe (s_tariffe): la seconda visita valeva 80 fino al 31/03/2025, poi 100 (decisione di Paolo)
  assert public.s_tariffa('visita_successiva', '2025-03-31', null) = 80,  'seconda visita fino al 31/03/2025 = 80';
  assert public.s_tariffa('visita_successiva', '2025-04-01', null) = 100, 'seconda visita dal 01/04/2025 = 100';
  assert public.s_tariffa('visita_prima', current_date, null) = 100,      'prima visita = 100';
  assert public.s_tariffa('visita_stage', current_date, null) = 100,      'visita stage = 100';
  assert public.s_tariffa('asseverazione_giorno', current_date, null) = 320, 'asseverazione = 320 al giorno-uomo';
  assert public.s_tariffa('docenza_ora', current_date, null) = 50,        'docenza = 50 all''ora';
  assert public.s_tariffa('docenza_ora', '2017-01-01', null) is null,     'nessuna tariffa prima della validita''';

  -- regime fiscale (s_tecnici_fiscale): lordo = netto x (1 + cassa) x (1 + IVA)
  select r.* into f from public.tecnici t, lateral public.s_regime_tecnico(t.tecnico_id, current_date) r
   where t.email = 'nicola.demarco@did.formedilpadova.it';
  assert f.regime = 'forfettario' and round(100 * (1 + f.cassa_pct / 100) * (1 + f.iva_pct / 100), 2) = 104.00,
    'De Marco forfettario: 100 -> 104';
  select r.* into f from public.tecnici t, lateral public.s_regime_tecnico(t.tecnico_id, '2023-01-15'::date) r
   where t.email = 'paolo.balladore@did.formedilpadova.it';
  assert f.regime = 'ordinario' and round(800 * (1 + f.cassa_pct / 100) * (1 + f.iva_pct / 100), 2) = 1015.04,
    'Balladore ordinario: 800 -> 1015,04 (lo stesso lordo del report storico)';

  raise notice 'OK tariffe e regime';
end $$;

rollback;
