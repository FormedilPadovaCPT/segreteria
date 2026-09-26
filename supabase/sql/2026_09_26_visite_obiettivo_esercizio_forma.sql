-- 26/09/2026: una riga «NaN-NaN» salvata da una pagina con l'errore di calcolo
-- dell'esercizio. Si toglie (vuota) e da ora l'esercizio si accetta solo come «aaaa/aaaa».
-- APPLICATA in produzione il 26/09/2026. Provata: l'inserimento di 'NaN-NaN' viene rifiutato.
delete from public.visite_obiettivo_esercizio
 where esercizio = 'NaN-NaN' and contributi_ceiv is null and visite_minime_manuali is null and note is null;
alter table public.visite_obiettivo_esercizio
  add constraint visite_obiettivo_esercizio_forma
  check (esercizio ~ '^[0-9]{4}/[0-9]{4}$' and split_part(esercizio,'/',2)::int = split_part(esercizio,'/',1)::int + 1);
