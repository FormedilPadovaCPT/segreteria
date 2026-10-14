-- ============================================================
-- FIRME DEL PRESIDENTE: UN RIEPILOGO, NON UNA MAIL A DOCUMENTO
-- (14/10/2026, chiesto dall'utente: «non posso disturbare il presidente
-- ogni volta che il documento viene mandato alla sua firma»)
--
-- I ruoli elencati qui non ricevono la mail (né la notifica) a ogni
-- richiesta di firma: il documento entra nel loro spazio firme e la
-- segreteria, quando decide, manda UNA mail con l'elenco di tutto quello
-- che aspetta (cruscotto, «✉️ Avvisa il Presidente»). La funzione
-- firma-documenti (= firma-presidente) legge la chiave a ogni chiamata.
-- Valori: ruoli separati da virgola (presidente, direttore, rpf, docente).
-- Chiave assente = presidente; valore vuoto = nessuno, si torna alla mail
-- a ogni richiesta.
-- ============================================================
insert into public.s_config (chiave, valore, descrizione) values
  ('firme_avviso_raccolto_ruoli', 'presidente',
   'Firmatari che non si avvisano a ogni richiesta di firma: i documenti si accumulano nel loro spazio e la segreteria manda un riepilogo dal cruscotto (14/10/2026). Ruoli separati da virgola; vuoto = mail a ogni richiesta.')
on conflict (chiave) do nothing;
