-- Segnalazioni di cantiere: a chi va l'esito (17/09/2026, regola dell'utente)
--
-- «Al segnalante decide la segreteria se rispondere o no, di regola no. Se è la
-- Cassa Edile che ci chiede una visita ovviamente si risponde, ma non riceve
-- risposte per segnalazioni fatte da altri.»
--
-- Quindi:
--   - presa in carico al segnalante: facoltativa (protocollo_out_id / riscontro_*,
--     come prima);
--   - esito: SOLO se la segnalazione viene dalla Cassa Edile (segnalante_tipo =
--     'ceiv'), con una lettera e un protocollo OUT suoi — i campi esito_* qui sotto;
--   - per le segnalazioni di altri l'esito non va a nessuno.
-- Fino al 16/09/2026 l'app preparava l'esito completo per i segnalanti «di
-- sistema» (sindacato, ente, comune, CEIV, presidenza): superato.
-- esito_cc resta per scrivere eventuali copie, ma la maschera non la propone.

alter table public.s_segnalazioni
  add column if not exists esito_protocollo_id bigint,
  add column if not exists esito_drive_id text,
  add column if not exists esito_drive_url text,
  add column if not exists esito_a text,
  add column if not exists esito_cc text;

comment on column public.s_segnalazioni.risposta_testo is
  'Testo dell''esito, che si comunica SOLO alla Cassa Edile quando la visita l''ha chiesta lei (regola del 17/09/2026).';
comment on column public.s_segnalazioni.esito_protocollo_id is
  'Protocollo OUT della lettera di esito alla Cassa Edile richiedente (regola del 17/09/2026).';
comment on column public.s_segnalazioni.esito_a is
  'Destinatari «A» della lettera di esito, come proposti e corretti al momento dell''invio.';
