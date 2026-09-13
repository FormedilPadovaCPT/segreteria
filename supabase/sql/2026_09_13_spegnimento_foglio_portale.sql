-- =============================================================================
--  GESTIONALE: SPEGNIMENTO DEL FOGLIO GOOGLE E DI APPS SCRIPT DEL PORTALE (13/09/2026)
-- -----------------------------------------------------------------------------
--  Deciso dall'utente dopo il passaggio dei moduli alla cassetta delle lettere
--  sul progetto Supabase Servizi: il portale non usa piu' Apps Script, e il
--  numero di ricevuta lo da' solo il database (portale-richieste v13).
--  Ordine seguito, che conta:
--   1. deployment Apps Script archiviato dall'utente (l'indirizzo /exec risponde 404);
--   2. un ultimo import dal foglio (job una tantum, 09:42 UTC, riuscito);
--   3. portale-richieste v13 senza foglio, import-rlst e ricezione-portale ritirate (410);
--   4. job e impostazioni del foglio tolti (qui sotto);
--   5. foglio e progetto Apps Script nel cestino di Drive, a mano, dopo la copia d'archivio.
--  Applicato su Supabase a mano (execute_sql) il 13/09/2026: questo file e' la copia.
-- =============================================================================

-- i due job che parlavano col foglio e con Apps Script
select cron.unschedule('import-rlst-mattina');   -- import dal foglio ogni mattina
select cron.unschedule('battito-portale');       -- ping al backend Apps Script

-- le impostazioni del foglio: nessun codice le legge piu'
delete from public.s_config
where chiave in ('rlst_sheet_id', 'rlst_sheet_gid', 'rls_sheet_gid', 'segn_sheet_gid',
                 'attest_sheet_titolo', 'confcant_sheet_titolo', 'cons_sheet_titolo',
                 'notif_sheet_titolo', 'visita_sheet_titolo', 'qst_sheet_titolo',
                 'portale_battito_al');

-- restano, e servono: portale_battito_token + portale_diretto_battito_al (battito
-- notturno di portale-richieste, job battito-portale-diretto), portale_battito_ore
-- (soglia dell'allarme nel cruscotto), portale_drive_servizi_id (cartella dei file),
-- portale_mail_segreteria, portale_diretto_pubblico (= no) e le chiavi cassetta_*.
