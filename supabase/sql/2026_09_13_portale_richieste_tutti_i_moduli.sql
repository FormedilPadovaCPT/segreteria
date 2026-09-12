-- =============================================================================
--  STRADA DIRETTA DEL PORTALE: tutti i moduli (13/09/2026)
-- -----------------------------------------------------------------------------
--  Dopo segnalazione e notifica, anche consulenza, visita, conferenza,
--  attestazione DM 132, RLST, RLS e questionario di sopralluogo arrivano dalla
--  funzione portale-richieste direttamente nelle loro tabelle, invece che dal
--  foglio alle 6:30. Stesso impianto: submission_id per il reinvio sicuro,
--  portale_esito per riprendere un invio interrotto, copia della riga sulla
--  scheda del foglio che prenota il numero finche' esiste la vecchia strada.
--  Il questionario non aveva una tabella: esisteva solo come riga sul foglio.
--  Applicata su Supabase come migrazione portale_richieste_tutti_i_moduli.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['s_consulenze','s_visite_richieste','s_conferenze_cantiere','s_attestazioni_dm132','s_rlst_pratiche','s_rls_anagrafe'] loop
    execute format('alter table public.%I add column if not exists submission_id text, add column if not exists portale_esito jsonb', t);
    if not exists (select 1 from pg_constraint where conname = t || '_submission_id_key') then
      execute format('alter table public.%I add constraint %I unique (submission_id)', t, t || '_submission_id_key');
    end if;
    execute format($c$comment on column public.%I.submission_id is 'Identificativo della compilazione dal portale (strada diretta, dal 13/09/2026): rende sicuro il reinvio.'$c$, t);
    execute format($c$comment on column public.%I.portale_esito is 'Che cosa ha fatto la funzione portale-richieste (allegati, copia sul foglio, mail): serve a riprendere un invio interrotto.'$c$, t);
  end loop;
end $$;

create table if not exists public.s_questionari_sopralluogo (
  id bigint generated always as identity primary key,
  fonte text not null default 'modulo',
  progressivo integer unique,
  submission_id text unique,
  timestamp_modulo timestamptz,
  tecnico text,
  data_visita date,
  scopi text,
  scala_aspettative smallint,
  ruolo_chiaro text,
  scala_professionale smallint,
  suggerimenti_pratici text,
  scala_facilita smallint,
  nuovi_rischi text,
  misure_sicurezza text,
  aree_monitorate text,
  scala_serv_area smallint,
  scala_serv_visite smallint,
  scala_serv_consulenza smallint,
  scala_serv_formazione smallint,
  scala_serv_corsi smallint,
  proposte_miglioramento text,
  aggiornamenti text,
  contatto_richiesto text,
  recapito_contatto text,
  privacy text,
  portale_esito jsonb,
  stato text not null default 'ricevuto' check (stato in ('ricevuto', 'letto', 'contattato', 'archiviato', 'scartato')),
  note_ufficio text,
  importato_il timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aggiornato_da text
);
comment on table public.s_questionari_sopralluogo is
  'Questionario di gradimento del sopralluogo, dal portale servizi (strada diretta, dal 13/09/2026). Prima esisteva solo come riga sulla scheda «Questionario Sopralluogo» del foglio Google.';

alter table public.s_questionari_sopralluogo enable row level security;
drop policy if exists sgr_qst_all on public.s_questionari_sopralluogo;
create policy sgr_qst_all on public.s_questionari_sopralluogo
  for all to authenticated using (is_segreteria()) with check (is_segreteria());
revoke all on table public.s_questionari_sopralluogo from anon;

insert into public.s_config (chiave, valore, descrizione, updated_by) values
  ('qst_sheet_titolo', 'Questionario',
   'Titolo (anche parziale) della scheda del foglio servizi col questionario di gradimento del sopralluogo: la funzione portale-richieste ci scrive la copia della riga.',
   'migrazione 2026_09_13')
on conflict (chiave) do nothing;

comment on column public.s_portale_ricezioni.pratica_id is
  'Strada diretta: id della pratica creata dalla richiesta, nella tabella del suo tipo (seg → s_segnalazioni, not → s_notifiche_cantiere, cons → s_consulenze, vis → s_visite_richieste, conf → s_conferenze_cantiere, att → s_attestazioni_dm132, rlst → s_rlst_pratiche, rls → s_rls_anagrafe, qst → s_questionari_sopralluogo).';
