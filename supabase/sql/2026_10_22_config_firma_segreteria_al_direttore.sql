-- APPLICATA il 22/10/2026 su conferma dell'utente (migrazione config_firma_segreteria_al_direttore_2026_10_22).
-- La firma del dipendente sul modulo delle richieste di ferie e permessi: quando il Direttore approva
-- dall'app, il modulo col visto lo rigenera LUI. Per mettere la firma scansionata della segreteria
-- (sulle richieste di Renato Squizzato) deve leggere segreteria_firma_id e segreteria_firma_nome di
-- s_config, che oggi legge solo la segreteria e l'Amministrazione (che le usa per il mandato).
-- Senza questa modifica il modulo col visto esce con la riga «Firma del dipendente» vuota.
-- Cambia solo il ramo del Direttore: due chiavi in più, nient'altro.
alter policy s_config_sel on public.s_config using (
  is_segreteria()
  or (is_direttore() and chiave = any (array['direttore_email', 'direttore_nome', 'direttore_firma_id',
                                              'segreteria_firma_id', 'segreteria_firma_nome']))
  or (is_amministrazione() and chiave = any (array['amministrazione_email', 'amministrazione_nome', 'amministrazione_firma_id',
                                                   'segreteria_firma_id', 'segreteria_firma_nome', 'coordinatore_firma_id', 'coordinatore_nome']))
  or ((select auth.uid()) is not null and chiave = any (array['didattica_referenti', 'stage_relazione_cc', 'stage_relazione_cartella']))
);
