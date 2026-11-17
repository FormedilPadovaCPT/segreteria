-- Formatore che non completa le 24 ore nel triennio: sospeso finche' non recupera (17/11/2026).
-- La norma (D.I. 6/3/2013) non dice che cosa succede; nessuna fonte pubblica trovata. Scelta
-- dell'utente, la lettura piu' prudente e coerente con l'Accordo 59/CSR per coordinatori e RSPP:
-- le ore fatte dopo la fine del triennio completano quelle mancanti di quel triennio.
-- Domanda a FORMEDIL Italia protocollata in uscita; se la risposta e' diversa si cambia qui.
update public.s_doc_requisito set recupero_ore = true where codice = 'formatori';

-- Preavviso di 6 mesi per i requisiti a ore (decisione dell'utente: un corso va trovato e programmato).
update public.s_doc_requisito set preavviso_giorni = 180 where codice in ('agg_coordinatore', 'formatori');
