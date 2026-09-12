-- =============================================================================
--  STRADA DIRETTA DEL PORTALE: seconda tappa, la NOTIFICA CANTIERE (12/09/2026)
-- -----------------------------------------------------------------------------
--  Dopo la Segnalazione Cantiere (2026_09_12_portale_richieste_dirette.sql),
--  la notifica di apertura cantiere arriva dalla funzione portale-richieste
--  direttamente in s_notifiche_cantiere, invece che dal foglio alle 6:30.
--  Stesso impianto: submission_id per il reinvio sicuro, portale_esito per
--  riprendere un invio interrotto, copia della riga sulla scheda «Notifica»
--  del foglio che prenota il numero finche' esiste la vecchia strada.
--  Applicata su Supabase come migrazione portale_richieste_notifica.
-- =============================================================================

alter table public.s_notifiche_cantiere
  add column if not exists submission_id text,
  add column if not exists portale_esito jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 's_notifiche_cantiere_submission_id_key') then
    alter table public.s_notifiche_cantiere
      add constraint s_notifiche_cantiere_submission_id_key unique (submission_id);
  end if;
end $$;

comment on column public.s_notifiche_cantiere.submission_id is
  'Identificativo della compilazione dal portale (strada diretta, dal 12/09/2026): rende sicuro il reinvio, lo stesso id non crea una seconda notifica.';
comment on column public.s_notifiche_cantiere.portale_esito is
  'Che cosa ha fatto la funzione portale-richieste: copia sul foglio, mail interna e conferma (con data o errore). Serve a riprendere un invio interrotto senza rifare quel che e'' gia'' fatto.';
comment on column public.s_portale_ricezioni.pratica_id is
  'Strada diretta: id della pratica creata dalla richiesta, nella tabella del suo tipo (seg → s_segnalazioni, not → s_notifiche_cantiere).';
