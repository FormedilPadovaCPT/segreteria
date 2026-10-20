-- Richiesta di ferie o permessi: la fotografia del saldo del monte (20/10/2026).
-- Il modulo nuovo («Modulo + tessera», scelto dall'utente con Patrizia) mette in testa il saldo di
-- ferie o ex festività dopo la richiesta. Il Direttore e l'Amministrazione non leggono le tabelle
-- delle presenze: il saldo si fotografa sulla richiesta quando la segreteria la crea e quando la manda
-- al Direttore, come per il recupero (banca_righe, 19/10/2026).
-- {monte, nome, oggiMin, chiestaMin, dopoMin, oggiG, chiestaG, dopoG, registrata, al}
alter table public.s_ferie_richieste add column if not exists saldo_foto jsonb;
comment on column public.s_ferie_richieste.saldo_foto is
  'Saldo del monte (ferie o ex festività) fotografato dalla segreteria alla creazione e all''invio al Direttore: lo leggono anche Direttore e Amministrazione.';
