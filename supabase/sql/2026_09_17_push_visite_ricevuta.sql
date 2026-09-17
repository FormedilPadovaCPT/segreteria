-- Notifiche del gestionale visite: RICEVUTA DI RITORNO DAL TELEFONO (17/09/2026 sera)
-- Migrazione applicata: push_visite_ricevuta_dal_telefono_2026_09_17
--
-- Il 201 del servizio di notifica dice che Google/Apple hanno preso in carico il messaggio,
-- non che il telefono l'abbia ricevuto e mostrato (prima prova su un Android vero: 201, e sul
-- telefono niente). Ora il service worker lo conferma alla funzione push-visite
-- (azione 'ricevuta', valida solo per un indirizzo d'iscrizione già noto).
alter table public.push_iscrizioni
  add column if not exists ultima_ricezione_il timestamptz,
  add column if not exists ultima_ricezione_esito text;
comment on column public.push_iscrizioni.ultima_ricezione_il is 'Ultima volta che il service worker di QUEL dispositivo ha confermato di aver ricevuto una notifica (ricevuta di ritorno). Distinta da ultima_consegna_il, che è la presa in carico del servizio di notifica.';
comment on column public.push_iscrizioni.ultima_ricezione_esito is '«mostrata» oppure «errore: …» (messaggio del browser, troncato). Lo scrive solo la funzione push-visite.';
