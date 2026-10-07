-- 07/10/2026 — LA CODA DELLA LETTERA MENSILE DI INCARICO IN TRE PARTI (proposta approvata dall'utente).
-- Fino a oggi in fondo alla lettera c'erano la «nota» dell'incarico e un testo fisso (s_config.incarico_visite_testo,
-- copiato da Access il 04/09) che dall'app non si poteva cambiare. Ora:
--   1. TESTO FISSO («Modalità visite e consulenze»): resta in s_config, la segreteria lo cambia dall'app; ogni cambio
--      resta in s_config_storia (chi, quando, prima e dopo). Tolto il blocco «ATTENZIONE» (Veronese, The Builder,
--      account) e le emoji, che il PDF stampava «??»; la riga sull'account diventa il punto 9.
--   2. AVVISO DEL MESE (s_incarichi_avvisi): uno per mese, esce in tutte le lettere di quel mese. «ATTENZIONE - NUOVE
--      ZONE -», scritto nella nota della lettera di Caon di ottobre (n. 933, non ancora protocollata), diventa l'avviso
--      di ottobre 2026.
--   3. NOTA PER IL TECNICO (s_incarichi_mensili.note): resta, solo per lui. Le annotazioni che l'app scriveva nello
--      stesso campo («chiuso senza attività», riaperture, fatture) passano in note_interne, che in lettera non esce:
--      riprendendo il testo del mese prima sarebbero finite nella lettera al tecnico.
-- Le lettere già protocollate non cambiano: il PDF è su Drive. Copia di sicurezza in archivio.

begin;

create table if not exists archivio.bk_2026_10_07_lettera_incarico as
  select 'config'::text tipo, to_jsonb(c) riga from public.s_config c where c.chiave = 'incarico_visite_testo'
  union all
  select 'incarico', to_jsonb(m) from public.s_incarichi_mensili m where m.anno = 2026 and m.note is not null;

-- 3. annotazioni interne separate
alter table public.s_incarichi_mensili add column if not exists note_interne text;
comment on column public.s_incarichi_mensili.note_interne is 'Annotazioni della segreteria e dell''app (chiusure senza attività, riaperture…): NON escono nella lettera (07/10/2026). La lettera usa solo «note».';
do $$
declare n int;
begin
  update public.s_incarichi_mensili
     set note_interne = concat_ws(E'\n', note_interne, note), note = null
   where anno = 2026 and note is not null
     and (note ~ '^\d{2}/\d{2}/\d{4} chiuso senza attività' or note like 'Riaperto il %' or note ~ '^Fattura \S+ \(\d+ visite\) registrata il ');
  get diagnostics n = row_count;
  assert n = 6, 'attese 6 annotazioni interne da spostare, trovate ' || n;   -- 921, 923, 925, 928, 929, 932
end $$;

-- 2. avviso del mese
create table if not exists public.s_incarichi_avvisi (
  anno smallint not null,
  mese smallint not null check (mese between 1 and 12),
  testo text not null check (btrim(testo) <> ''),
  aggiornato_da text,
  aggiornato_il timestamptz not null default now(),
  primary key (anno, mese)
);
comment on table public.s_incarichi_avvisi is 'Avviso del mese per tutti i tecnici: esce in ogni lettera mensile di incarico di quel mese (07/10/2026).';
alter table public.s_incarichi_avvisi enable row level security;
drop policy if exists s_incarichi_avvisi_sel on public.s_incarichi_avvisi;
create policy s_incarichi_avvisi_sel on public.s_incarichi_avvisi for select to authenticated using ((select public.is_segreteria()));
drop policy if exists s_incarichi_avvisi_ins on public.s_incarichi_avvisi;
create policy s_incarichi_avvisi_ins on public.s_incarichi_avvisi for insert to authenticated with check ((select public.is_segreteria()));
drop policy if exists s_incarichi_avvisi_upd on public.s_incarichi_avvisi;
create policy s_incarichi_avvisi_upd on public.s_incarichi_avvisi for update to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
drop policy if exists s_incarichi_avvisi_del on public.s_incarichi_avvisi;
create policy s_incarichi_avvisi_del on public.s_incarichi_avvisi for delete to authenticated using ((select public.is_segreteria()));
grant select, insert, update, delete on public.s_incarichi_avvisi to authenticated;

insert into public.s_incarichi_avvisi (anno, mese, testo, aggiornato_da)
select 2026, 10, note, 'spostato dalla nota della lettera n. 933 (07/10/2026)'
  from public.s_incarichi_mensili where id = 933 and note = 'ATTENZIONE - NUOVE ZONE -' and lettera_protocollo_id is null
on conflict (anno, mese) do nothing;
update public.s_incarichi_mensili set note = null
 where id = 933 and note = 'ATTENZIONE - NUOVE ZONE -' and lettera_protocollo_id is null;

-- 1. storico del testo fisso
create table if not exists public.s_config_storia (
  id bigint generated always as identity primary key,
  chiave text not null,
  valore_prima text,
  valore_dopo text,
  cambiato_da text,
  cambiato_il timestamptz not null default now()
);
comment on table public.s_config_storia is 'Chi ha cambiato i testi d''ufficio di s_config e quando (07/10/2026). Solo chiavi di testo, mai segreti: l''elenco è nel trigger.';
alter table public.s_config_storia enable row level security;
drop policy if exists s_config_storia_sel on public.s_config_storia;
create policy s_config_storia_sel on public.s_config_storia for select to authenticated using ((select public.is_segreteria()));
grant select on public.s_config_storia to authenticated;

create or replace function public.tg_s_config_storia()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.chiave in ('incarico_visite_testo') and new.valore is distinct from old.valore then
    insert into public.s_config_storia (chiave, valore_prima, valore_dopo, cambiato_da)
    values (new.chiave, old.valore, new.valore, coalesce(nullif(new.updated_by, ''), auth.jwt() ->> 'email', 'sistema (' || session_user || ')'));
  end if;
  return new;
end $$;
drop trigger if exists trg_s_config_storia on public.s_config;
create trigger trg_s_config_storia after update on public.s_config for each row execute function public.tg_s_config_storia();

update public.s_config
   set valore = $t$Modalità visite e consulenze
1) Durata degli incarichi: le visite assegnate dalla Segreteria sono valide per un mese. Dopo la scadenza, l'incarico non sarà più valido.
2) Comunicazione degli appuntamenti: se si riceve un incarico per consulenza, è necessario comunicare la data dell'appuntamento fissato.
3) Tempistiche: se non è possibile svolgere l'incarico entro 4-5 giorni, avvisare tempestivamente la Segreteria.
4) Fatturazione: a fine mese riceverete un riepilogo con i conteggi per l'emissione della fattura.
5) Priorità cantieri: dare precedenza ai cantieri delle imprese iscritte alla C.E.I.V.
6) Evitare conflitti di interesse: non effettuare visite o consulenze per imprese con cui si hanno collaborazioni in libera professione. In tal caso, avvisare la Segreteria che provvederà ad assegnare l'incarico a un altro tecnico.
7) Promemoria pratiche aperte: la comunicazione inviata include la lista dei cantieri con NC per facilitare la chiusura delle pratiche aperte.
8) Affiancamento con RLST (Sauro Cazzoli): per concordare le visite in affiancamento, contattarlo al 349 2979481.
9) Comunicazioni con il CPT e per le visite in cantiere: utilizzare esclusivamente il proprio account nome.cognome@did.formedilpadova.it.
---
Per qualsiasi dubbio o chiarimento, sono a disposizione. Grazie a tutti per la collaborazione!$t$,
       updated_by = 'tolto il blocco ATTENZIONE, account al punto 9 (deciso dall''utente, 07/10/2026)',
       updated_at = now(),
       descrizione = 'Testo fisso in coda alla lettera mensile di incarico visite: si cambia dall''app (Incarichi tecnici › «Testo fisso della lettera»), storico in s_config_storia'
 where chiave = 'incarico_visite_testo'
   and valore like 'ATTENZIONE%' and valore like '%8) Affiancamento con RLST (Sauro Cazzoli)%';

commit;
