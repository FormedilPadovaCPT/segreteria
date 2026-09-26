-- ============================================================
-- Integrità, 26/09/2026 — i collegamenti «logici» diventano chiavi esterne
-- (approvato dall'utente il 26/09/2026)
--
-- Fino a oggi 30 colonne puntavano ad altre tabelle solo per codice
-- (impresa_id, persona_id, cantiere_id, incarico_id, visita_id,
-- protocollo_id): il database non impediva di scrivere un codice che non
-- esiste, e un riferimento rotto si vedeva solo come «nessuno» nelle app.
-- Verificato prima di scrivere: 0 riferimenti rotti e 0 stringhe vuote su
-- tutte. Le funzioni che uniscono e rinumerano (fondi_imprese,
-- s_cambia_id_impresa, fondi_persone, fondi_cantieri) creano prima la
-- scheda nuova, poi spostano i riferimenti, poi archiviano o cancellano la
-- vecchia: sono compatibili.
--
-- Regole, uguali a quelle delle chiavi già esistenti:
--  * anagrafiche (imprese, persone, cantieri) e protocollo: NO ACTION —
--    non si cancella ciò che è ancora usato;
--  * incarico e visita puntati da pratiche che devono sopravvivere:
--    ON DELETE SET NULL.
-- NON fatte, per scelta:
--  * tecnico_email (incarichi, s_mail_respinte, tecnici_zone): il
--    riferimento per email si rompe o si blocca al cambio di casella, e
--    una cascata su incarichi.tecnico_email farebbe partire le notifiche
--    push di tutti gli incarichi storici (trg_push_incarichi);
--  * incarichi.visita_id: è il puntatore «ultima visita» ricalcolato da
--    incarichi_ricalcola, e incarichi ha un trigger di guardia che
--    annullerebbe il SET NULL. Il legame vero è visite.incarico_id (sotto);
--  * s_impresa_audit, s_protocollo_audit, visite_audit: sono registri, la
--    storia non deve bloccare niente.
-- Per tornare indietro: 2026_09_26_integrita_collegamenti_ANNULLA.sql
-- ============================================================

-- 1. impresa_id → imprese (15 tabelle)
do $$
declare t text;
begin
  foreach t in array array['incarichi','imprese_ateco','s_attestazioni_dm132','s_conferenze_cantiere',
    's_consulenze','s_corsi','s_corsi_iscritti','s_formazione_segnalazioni','s_nomine',
    's_notifiche_cantiere','s_protocollo','s_rls_anagrafe','s_rlst_pratiche','s_segnalazioni',
    's_visite_richieste'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_impresa_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (impresa_id) references public.imprese(impresa_id) not valid', t, t || '_impresa_id_fkey');
      execute format('alter table public.%I validate constraint %I', t, t || '_impresa_id_fkey');
    end if;
  end loop;
end $$;

-- 2. persona_id → persone (6 tabelle)
do $$
declare t text;
begin
  foreach t in array array['s_attestazioni_dm132','s_conferenze_cantiere','s_consulenze',
    's_rls_anagrafe','s_rlst_pratiche','s_visite_richieste'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_persona_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (persona_id) references public.persone(persona_id) not valid', t, t || '_persona_id_fkey');
      execute format('alter table public.%I validate constraint %I', t, t || '_persona_id_fkey');
    end if;
  end loop;
end $$;

-- 3. cantiere_id → cantieri (2 tabelle)
do $$
declare t text;
begin
  foreach t in array array['s_notifiche_cantiere','s_segnalazioni'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_cantiere_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (cantiere_id) references public.cantieri(cantiere_id) not valid', t, t || '_cantiere_id_fkey');
      execute format('alter table public.%I validate constraint %I', t, t || '_cantiere_id_fkey');
    end if;
  end loop;
end $$;

-- 4. incarico_id → incarichi (4 tabelle): la pratica resta se l'incarico sparisce
do $$
declare t text;
begin
  foreach t in array array['s_conferenze_cantiere','s_consulenze','s_segnalazioni','s_visite_richieste'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_incarico_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (incarico_id) references public.incarichi(id) on delete set null not valid', t, t || '_incarico_id_fkey');
      execute format('alter table public.%I validate constraint %I', t, t || '_incarico_id_fkey');
    end if;
  end loop;
end $$;

-- 5. visita_id → visite (2 tabelle): la segnalazione resta se la visita sparisce
do $$
declare t text;
begin
  foreach t in array array['s_formazione_segnalazioni','s_mail_respinte'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_visita_id_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (visita_id) references public.visite(visita_id) on delete set null not valid', t, t || '_visita_id_fkey');
      execute format('alter table public.%I validate constraint %I', t, t || '_visita_id_fkey');
    end if;
  end loop;
end $$;

-- 6. protocollo della proposta nata dalla posta
alter table public.s_posta_proposte drop constraint if exists s_posta_proposte_protocollo_id_fkey;
alter table public.s_posta_proposte add constraint s_posta_proposte_protocollo_id_fkey
  foreign key (protocollo_id) references public.s_protocollo(id) not valid;
alter table public.s_posta_proposte validate constraint s_posta_proposte_protocollo_id_fkey;

-- 7. visita → incarico con una chiave vera.
-- prot_int («Prot. int. richiesta») resta com'è: lo scrivono le app ed è
-- testo. incarico_id lo calcola il database da prot_int a ogni scrittura, e
-- vale solo se l'incarico esiste: il trigger non solleva mai errori, così
-- il salvataggio di un verbale non può fallire per questo.
alter table public.visite add column if not exists incarico_id bigint;
comment on column public.visite.incarico_id is 'Incarico della visita: calcolato dal database da prot_int (trg_visite_incarico_id), valorizzato solo se l''incarico esiste. Non scriverlo dalle app.';

create or replace function public.tg_visite_incarico_id()
returns trigger language plpgsql set search_path = public as $f$
begin
  if new.prot_int ~ '^\s*[0-9]{1,18}\s*$' then
    select i.id into new.incarico_id from public.incarichi i where i.id = trim(new.prot_int)::bigint;
    if not found then new.incarico_id := null; end if;
  else
    new.incarico_id := null;
  end if;
  return new;
end $f$;
revoke execute on function public.tg_visite_incarico_id() from public, anon;

drop trigger if exists trg_visite_incarico_id on public.visite;
create trigger trg_visite_incarico_id before insert or update of prot_int, incarico_id on public.visite
  for each row execute function public.tg_visite_incarico_id();

-- riempimento: aggiorna la sola colonna nuova (prot_int non cambia, quindi
-- il trigger di aggancio agli incarichi non riparte)
update public.visite v set incarico_id = i.id
  from public.incarichi i
 where v.prot_int ~ '^\s*[0-9]{1,18}\s*$' and i.id = trim(v.prot_int)::bigint
   and v.incarico_id is distinct from i.id;

alter table public.visite drop constraint if exists visite_incarico_id_fkey;
alter table public.visite add constraint visite_incarico_id_fkey
  foreign key (incarico_id) references public.incarichi(id) on delete set null not valid;
alter table public.visite validate constraint visite_incarico_id_fkey;

-- 8. un indice per ogni chiave esterna che non ne ha (le 39 dell'advisor
-- «unindexed_foreign_keys» più le nuove): servono ai controlli sulle
-- cancellazioni e ai collegamenti fra tabelle.
do $$
declare r record;
begin
  for r in
    select n.nspname s, cl.relname t, a.attname c
      from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and n.nspname in ('public','planning') and array_length(k.conkey,1) = 1
       and not exists (select 1 from pg_index i where i.indrelid = k.conrelid and i.indkey[0] = k.conkey[1])
  loop
    execute format('create index if not exists %I on %I.%I (%I)', left('ix_' || r.t || '_' || r.c, 63), r.s, r.t, r.c);
  end loop;
end $$;
