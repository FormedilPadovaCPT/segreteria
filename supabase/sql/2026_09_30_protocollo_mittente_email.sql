-- 30/09/2026 — A chi si risponde quando il protocollo in entrata nasce da una mail.
--
-- Il caso: l'invito di ESEM-CPT protocollato 2048-in. L'avviso al mittente
-- diceva «Serve almeno un destinatario», perché i destinatari si cercavano solo
-- in anagrafica (impresa agganciata, persone per cognome) e ESEM-CPT non è
-- un'impresa. Ma è una risposta: va a chi ha scritto, e l'indirizzo era nella
-- mail. Il manuale lo diceva già («allo stesso indirizzo da cui è arrivata la
-- comunicazione»); il programma no.
--
-- Già applicato in produzione come migrazione `protocollo_mittente_email`.
-- Questo file è la documentazione.

alter table public.s_protocollo add column if not exists mittente_email text;
comment on column public.s_protocollo.mittente_email is
  'Solo in entrata: indirizzo e-mail di chi ha scritto la mail protocollata (Reply-To, altrimenti From). È il destinatario della risposta e dell''avviso di protocollazione.';

-- s_crea_protocollo: alla lista delle colonne scritte si aggiunge
--   mittente_email = case when v_dir = 'IN' then nullif(trim(p->>'mittente_email'), '') end
-- Il resto della funzione è invariato (numerazione, controllo is_segreteria).

-- Recupero dello storico: 23 protocolli in entrata avevano già la mail allegata
-- (`…_originale.msg`). Il mittente è stato letto da quei file, nel vault, con
-- lo stesso modulo che usa l'app (js/mittente-mail.js), e scritto solo dove il
-- campo era vuoto: 2011, 2012, 2017, 2018, 2019, 2024, 2025, 2026, 2027, 2028,
-- 2033, 2034, 2035, 2037, 2038, 2039, 2040, 2041, 2043, 2045, 2046, 2047, 2048.
-- I protocolli in entrata senza mail allegata restano col campo vuoto: lì
-- l'indirizzo si scrive una volta nel dialogo dell'avviso, e resta.
