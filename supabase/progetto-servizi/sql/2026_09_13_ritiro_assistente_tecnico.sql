-- =============================================================================
--  PROGETTO SERVIZI (qcvwrgjldbdoxcfdsvkq): RITIRO DELL'ASSISTENTE TECNICO
--  E DELLE TABELLE DELLA VECCHIA PWA CANTIERI (13/09/2026)
-- -----------------------------------------------------------------------------
--  L'assistente tecnico (chat con Gemini su una base di conoscenza) era gia'
--  spento la mattina del 13/09/2026: funzioni assistente-tecnico e carica-kb
--  ritirate (410), codice in 9_APPLICATIVI/Claude/PWA CANTIERI GOOGLE/
--  funzioni_supabase_ritirate/. Restavano le sue tabelle e cinque tabelle vuote
--  della vecchia PWA Cantieri, che nessuna app in uso legge: il portale, la
--  pagina admin e la redazione social usano solo «notizie» e «notizie-media»,
--  la cassetta le sue tre tabelle.
--  Cancellazione chiesta dall'utente dopo una copia dei dati nel vault
--  (stessa cartella del codice ritirato). Applicato su Supabase con
--  apply_migration il 13/09/2026: questo file e' la copia.
-- =============================================================================

drop function if exists public.match_kb_chunks(vector, integer, double precision);

drop table if exists public.kb_chunks;               -- prima di kb_documents
drop table if exists public.kb_documents;
drop table if exists public.chat_logs;
drop table if exists public.cantieri;                -- prima di committenti
drop table if exists public.committenti;
drop table if exists public.imprese_certificazioni;  -- prima di imprese
drop table if exists public.imprese;
drop table if exists public.tecnici;

-- restano: notizie (+ trigger set_updated_at e funzione update_updated_at),
-- cassetta, cassetta_impostazioni, cassetta_quota (+ funzione cassetta_quota),
-- bucket notizie-media e cassetta-allegati.

-- l'estensione vector serviva solo ai vettori della base di conoscenza; tolta
-- lo stesso giorno su richiesta dell'utente (migrazione togli_estensione_vector_2026_09_13).
-- Senza cascade: se qualcosa la usasse ancora, il comando si fermerebbe.
drop extension if exists vector;
