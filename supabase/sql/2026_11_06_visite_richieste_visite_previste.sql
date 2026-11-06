-- (06/11/2026, deciso dall'utente) Una serie di visite è di norma di 10, ma la segreteria può proporne
-- un numero diverso (per esempio 30) e il Direttore lo autorizza. Il numero sta sulla pratica di richiesta:
-- esce sul foglio di autorizzazione e passa all'incarico (incarichi.visite_previste), che è quello che il
-- controllo della serie (verbale_mancanze, verbale_posizione) già legge.
-- Vuoto = il numero di base (incarichi_previste: 10 per le serie).
alter table public.s_visite_richieste
  add column if not exists visite_previste smallint;

alter table public.s_visite_richieste
  drop constraint if exists s_visite_richieste_visite_previste_ck;
alter table public.s_visite_richieste
  add constraint s_visite_richieste_visite_previste_ck check (visite_previste is null or visite_previste between 1 and 100);

comment on column public.s_visite_richieste.visite_previste is
  'Serie di visite: quante visite si chiedono di autorizzare (vuoto = 10, il numero di base). Passa a incarichi.visite_previste quando nasce l''incarico.';
