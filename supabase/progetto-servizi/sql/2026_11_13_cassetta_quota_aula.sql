-- 13/11/2026 — APPLICATA sul progetto Servizi (qcvwrgjldbdoxcfdsvkq) lo stesso giorno.
-- Tetto orario della cassetta: da 60 a 300 in tutto, da 15 a 80 per impronta di IP.
--
-- Perché: dal 13/10/2026 dalla cassetta passano anche le firme di presenza (prs),
-- i questionari (qev) e i test (tst) dei corsi. Un'aula collegata alla stessa rete
-- esce con UN solo indirizzo: 30 persone che firmano entrata e uscita e compilano
-- il questionario sono 90 invii in poche ore dallo stesso indirizzo, e col tetto a
-- 15 la sedicesima riceveva «troppe richieste nell'ultima ora». Il 15/10/2026 il
-- massimo visto è stato 11 in un'ora: non era ancora successo, ma mancava poco.
-- Il tetto resta: una porta pubblica si difende dall'abuso. 80 l'ora da un indirizzo
-- e 300 in tutto restano molto sotto ciò che il database regge.
--
-- Per tornare indietro: gli stessi update con '60' e '15'.
update public.cassetta_impostazioni set valore = '300', aggiornato_il = now() where chiave = 'quota_ora';
update public.cassetta_impostazioni set valore = '80',  aggiornato_il = now() where chiave = 'quota_ora_ip';
