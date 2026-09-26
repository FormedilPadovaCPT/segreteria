-- ============================================================
-- Attestati, 26/09/2026 — il numero della serie nuova (NN/aaaa) è unico
--
-- corsi.js calcola il progressivo dell'anno leggendo il massimo già usato:
-- se due emissioni si sovrappongono, o se quella lettura fallisce, lo
-- stesso numero poteva finire su due attestati. Il numero è stampato
-- sull'attestato e nel QR della verifica pubblica: un doppione non si
-- corregge dopo. Da qui il database lo rifiuta.
--
-- Solo la serie con la barra: i numeri storici (import da Access) restano
-- fuori, così un import dello storico non si blocca. Al 26/09/2026 nessun
-- doppione, né nella serie nuova né nello storico.
-- ============================================================
create unique index if not exists s_corsi_iscritti_attestato_numero_unico
  on public.s_corsi_iscritti (attestato_numero)
  where attestato_numero like '%/%';
