-- ═══════════════════════════════════════════════════════════════════════
--  AVVISO AL COORDINATORE: «c'è una fattura da approvare» (21/09/2026)
--  Chiesto dall'utente: «quando la segreteria approva una fattura tecnico
--  potresti fare come per i mandati che inviamo a Patrizia, che anche il
--  coordinatore riceva per la fattura da approvare una mail con link
--  all'applicazione per approvare, la puoi mandare in automatico […]
--  tanto è solo interna non serve altro perché rischia che solo con
--  l'app non la veda.»
--
--  ⚠️ È UNA MAIL CHE PARTE DA SOLA, seconda eccezione dichiarata alla
--  regola «la posta dell'ufficio la manda una persona», decisa
--  dall'utente. Regge per lo stesso motivo dell'avviso di pagamento
--  (16/09): la mail NON contiene niente scritto da chi la fa partire —
--  tecnico, numero, data e importo della fattura si leggono dal
--  database. Ed è **interna**: va al solo coordinatore dell'Area.
--
--  Perché serve: il coordinatore approva dalla Zona Coordinatore del
--  gestionale visite, e la notifica al telefono (17/09) arriva solo a
--  chi l'ha attivata. Senza mail, una fattura verificata può restare
--  ferma finché qualcuno non apre l'app.
--
--  Qui stanno solo le colonne del quaderno e la chiave del cc: il
--  mestiere lo fa la edge function `avviso-approvazione`.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.s_fatture_tecnici
  add column if not exists avviso_appr_il    timestamptz,
  add column if not exists avviso_appr_a     text,
  add column if not exists avviso_appr_esito text,
  add column if not exists avviso_appr_dal   timestamptz;

comment on column public.s_fatture_tecnici.avviso_appr_il is
  'Quando è partito al coordinatore l''avviso «fattura da approvare». Vuoto = mai partito.';
comment on column public.s_fatture_tecnici.avviso_appr_a is
  'A chi è andato l''avviso di approvazione (destinatario + copie), come era al momento dell''invio.';
comment on column public.s_fatture_tecnici.avviso_appr_esito is
  'Esito dell''avviso di approvazione: «inviato», oppure il motivo per cui non è partito.';
comment on column public.s_fatture_tecnici.avviso_appr_dal is
  'Prenotazione: presa prima di spedire, così due chiamate insieme non mandano due mail. Si libera a invio fatto o fallito.';

/* Il destinatario è `coordinatore_email`; le copie stanno in una chiave
   a sé, vuota di suo — un cc si decide, non si mette nel codice. */
insert into public.s_config (chiave, valore, descrizione) values
  ('avviso_approvazione_cc', '',
   'Copie dell''avviso automatico al coordinatore «fattura da approvare» (vuoto = nessuna copia). Il destinatario è coordinatore_email.')
on conflict (chiave) do nothing;

/* ── il flusso entra nel riquadro «flussi mai usati» del cruscotto ──
   Si tocca la sola riga che serve, partendo dal testo che la funzione ha
   nel database: ricopiarla a mano è il modo di introdurre un secondo
   errore (regola del 19/09). Il controllo `position` fa fallire la
   migrazione se la riga di riferimento non c'è più. */
do $$
declare def text; nuova text; punto text;
begin
  select pg_get_functiondef('public.s_flussi_uso()'::regprocedure) into def;

  punto := 'union all select ''Tecnici'', ''stage_senza_verbale''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo il punto di innesto (%). Guardare la funzione prima di insistere.', punto;
  end if;
  nuova := 'union all select ''Tecnici'', ''avviso_approvazione'', ''Avviso al coordinatore: fattura da approvare'', avviso_appr_il::date'
    || E'\n      from public.s_fatture_tecnici where avviso_appr_il is not null' || E'\n    ' || punto;
  def := replace(def, punto, nuova);

  punto := '(''Tecnici'', ''stage_senza_verbale''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo l''elenco dei flussi (%).', punto;
  end if;
  def := replace(def, punto,
    '(''Tecnici'', ''avviso_approvazione'', ''Avviso al coordinatore: fattura da approvare''),' || E'\n    ' || punto);

  execute def;
end $$;

/* i permessi si riscrivono: `create or replace` non li perde, ma se un
   giorno la funzione venisse ricreata da zero questa riga la richiude */
revoke execute on function public.s_flussi_uso() from public, anon;
grant execute on function public.s_flussi_uso() to authenticated, service_role;
