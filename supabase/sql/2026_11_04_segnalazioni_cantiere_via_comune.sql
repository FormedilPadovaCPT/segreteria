-- ============================================================
-- Segnalazioni di cantiere: via e comune dalle coordinate (04/11/2026, chiesto dall'utente).
-- Il tecnico salva posizione e nota; via e comune non si registravano, e nell'elenco dei
-- cantieri il segnalato compariva col solo testo della nota, senza poterlo filtrare per comune.
-- Ora il gestionale li ricava al salvataggio con la ricerca inversa di OpenStreetMap
-- (_segnDoveSono in index.html). «indirizzo» resta quello scritto da chi segnala.
-- Le 14 segnalazioni già registrate sono state completate lo stesso giorno (update per id).
-- ============================================================
alter table public.segnalazioni_cantiere
  add column if not exists comune_nome text,
  add column if not exists indirizzo_gps text;
comment on column public.segnalazioni_cantiere.comune_nome is 'Comune ricavato dalle coordinate (OpenStreetMap, ricerca inversa) al salvataggio; vuoto se la ricerca non è riuscita (04/11/2026)';
comment on column public.segnalazioni_cantiere.indirizzo_gps is 'Via e civico ricavati dalle coordinate; distinti da «indirizzo», che è quello scritto da chi segnala (04/11/2026)';
