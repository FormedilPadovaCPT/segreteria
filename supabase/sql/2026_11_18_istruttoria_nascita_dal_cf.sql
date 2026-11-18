-- ============================================================
-- L'ISTRUTTORIA MOSTRA DATA, SESSO E LUOGO DI NASCITA RICAVATI DAL CF
-- (18/11/2026, dall'utente: «una volta chiesto il codice fiscale è inutile
-- chiedere anche quando è nato e dove è nato, il programma li può ricavare»)
--
-- Dal 18/11 il modulo d'iscrizione del portale non li chiede più. Il database
-- li ricavava già (cf_decode, e il trigger persone_cf_fill quando nasce
-- un'anagrafica): qui la scheda dell'istruttoria li mostra subito, presi dal
-- codice fiscale, con quello che la persona ha scritto che vince se c'è
-- (import da Excel). Modifica di una riga sola della funzione esistente.
-- ============================================================
do $$
declare d text;
begin
  d := pg_get_functiondef('public.iscr_istruttoria(bigint)'::regprocedure);
  if position('dal_cf' in d) > 0 then return; end if;   -- già fatto
  d := replace(d, '''i'', i, ''dati'', p,',
    '''i'', i, ''dati'', coalesce((select jsonb_strip_nulls(jsonb_build_object(''nato_il'', x.data_nascita, ''sesso'', x.sesso, ''comune_nascita'', x.comune_nascita, ''dal_cf'', true)) from public.cf_decode(v_cf) x), ''{}''::jsonb) || p,');
  if position('dal_cf' in d) = 0 then raise exception 'iscr_istruttoria: riga da cambiare non trovata'; end if;
  execute d;
end $$;
