-- =============================================================================
--  PORTALE SERVIZI: le richieste arrivano DIRETTAMENTE al database (12/09/2026)
-- -----------------------------------------------------------------------------
--  Deciso dall'utente: il foglio Google era un passaggio in mezzo (portale →
--  Apps Script → foglio → import delle 6:30 → tabelle), il piu' fragile di
--  tutti (deployment morto ad agosto, cartella Drive inesistente dal 1/07,
--  autorizzazione mancante). Si passa modulo per modulo alla edge function
--  portale-richieste; prima tappa la Segnalazione Cantiere.
--
--  La funzione: scatola nera in s_portale_ricezioni → pratica subito in
--  s_segnalazioni (numero di ricevuta = progressivo) → foto su Drive →
--  COPIA DELLA RIGA SUL FOGLIO → mail alla segreteria e conferma a chi scrive.
--
--  ⚠️ Perche' la copia sul foglio non e' un vezzo: il numero di ricevuta lo
--  assegnava Apps Script contando le righe della scheda, e l'import salta le
--  righe il cui progressivo e' gia' nel database. Se la strada diretta non
--  scrivesse la riga, una segnalazione arrivata dalla vecchia strada (una
--  pagina rimasta aperta da prima dell'aggiornamento) prenderebbe lo stesso
--  numero e verrebbe SCARTATA IN SILENZIO dall'import. La riga prenota il
--  numero. Si toglie quando si spegne il foglio.
-- =============================================================================

alter table public.s_segnalazioni
  add column if not exists submission_id text,
  add column if not exists portale_esito jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_segnalazioni_submission_id_key') then
    alter table public.s_segnalazioni
      add constraint s_segnalazioni_submission_id_key unique (submission_id);
  end if;
end $$;

comment on column public.s_segnalazioni.submission_id is
  'Identificativo della compilazione dal portale (strada diretta, dal 12/09/2026): rende sicuro il reinvio, lo stesso id non crea una seconda pratica.';
comment on column public.s_segnalazioni.portale_esito is
  'Che cosa ha fatto la funzione portale-richieste: foto caricate, copia sul foglio, mail interna e conferma (con data o errore). Serve a riprendere un invio interrotto senza rifare quel che e'' gia'' fatto.';

alter table public.s_portale_ricezioni
  add column if not exists pratica_id bigint,
  add column if not exists elaborata_at timestamptz;

comment on column public.s_portale_ricezioni.pratica_id is
  'Strada diretta: id della pratica creata dalla richiesta (per ora in s_segnalazioni).';
comment on column public.s_portale_ricezioni.elaborata_at is
  'Strada diretta: quando la funzione portale-richieste ha finito di lavorare la richiesta. Vuoto con sul_foglio vuoto dopo 15 minuti = richiesta arrivata e mai completata.';

insert into public.s_config (chiave, valore, descrizione, updated_by) values
  ('portale_diretto_battito_al', '',
   'Ultimo battito della strada diretta del portale (funzione portale-richieste): database, cartella foto su Drive, foglio e Gmail verificati davvero. Vuoto = mai.',
   'migrazione 2026_09_12'),
  ('portale_drive_servizi_id', '10e9jzlhxd7PcijxqhWcX4wz_Jm6qkVJb',
   'Cartella SERVIZI su Drive: la sottocartella PDF_ricevuti accoglie le foto delle segnalazioni dal portale (la stessa del backend Apps Script).',
   'migrazione 2026_09_12'),
  ('portale_mail_segreteria', 'cpt@formedilpadova.it',
   'A chi va la mail interna di ogni richiesta arrivata dal portale per la strada diretta.',
   'migrazione 2026_09_12')
on conflict (chiave) do nothing;

-- ⚠️ UNA LAVORAZIONE ALLA VOLTA (aggiunta lo stesso giorno, migrazione
-- portale_richieste_lavorazione, dopo la prima prova): lo stesso invio era
-- arrivato due volte insieme (modulo + coda del telefono) e tutto era stato
-- fatto due volte — due foto, due mail interne, due conferme. La funzione
-- prende la prenotazione con un UPDATE condizionato su questa colonna.
alter table public.s_portale_ricezioni
  add column if not exists lavorazione_dal timestamptz;

comment on column public.s_portale_ricezioni.lavorazione_dal is
  'Strada diretta: prenotazione della lavorazione. La funzione portale-richieste la prende con un UPDATE condizionato (atomico) e la rilascia alla fine: lo stesso invio arrivato due volte insieme viene lavorato una volta sola. Scade dopo 2 minuti se una lavorazione muore a meta''.';

-- Il battito della strada diretta, ogni notte alle 05:20 UTC (dopo quello di
-- Apps Script delle 05:10). Il token si legge da s_config al momento: nel
-- comando del job non c'e' nessun segreto.
select cron.schedule('battito-portale-diretto', '20 5 * * *', $cmd$
do $body$
declare
  r record;
  tok text;
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
  select valore into tok from public.s_config where chiave = 'portale_battito_token';
  select * into r from http((
    'POST',
    'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/portale-richieste',
    array[http_header('X-Token', tok)],
    'application/json',
    '{"battito":true,"origine":"pg_cron"}'
  )::http_request);
  if r.status <> 200 then
    raise warning 'battito-portale-diretto: canale NON ok (status %) %', r.status, left(r.content, 300);
  end if;
end
$body$;
$cmd$);
