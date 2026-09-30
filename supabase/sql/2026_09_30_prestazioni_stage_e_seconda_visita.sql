-- ════════════════════════════════════════════════════════════════════
--  RIEPILOGO DELLE FATTURE DEI TECNICI: stage e seconda visita (30/09/2026)
--
--  Due difetti emersi chiudendo settembre 2026, il primo mese calcolato
--  dalle visite (fino ad agosto le prestazioni venivano da Access):
--
--  1) 28 visite su 30 di Visentini risultavano «visita stage». Nelle
--     visite importate dal modulo Google visite.stage_vis conteneva la
--     risposta alla domanda 18.2 «L'impresa potrebbe essere idonea ad
--     ospitare un ragazzo in stage?», non «è una visita stage» (che stava
--     in stage_sn). Nell'app stage_vis vuol dire visita stage. Deciso
--     dall'utente: si corregge il dato, non il calcolo.
--
--  2) Le visite di De Marco uscivano divise in prime e seconde. Il
--     calcolo dava «visita_successiva» a ogni «Accesso al cantiere n°»
--     maggiore di 1, ma dal 01/04/2025 tutte le visite valgono 100 € e
--     tecnici e Access hanno sempre segnato «prima visita». La seconda
--     visita torna da sola quando avrà di nuovo una tariffa diversa.
--
--  Applicato sul progetto del gestionale con le migrazioni
--  visite_stage_vis_idoneita_separata e
--  prestazioni_seconda_visita_solo_se_tariffa_diversa.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) stage: l'idoneità dell'impresa in una colonna sua ──────────────
alter table public.visite add column if not exists impresa_idonea_stage boolean;
comment on column public.visite.impresa_idonea_stage is
  'Risposta del tecnico alla domanda 18.2 del modulo Google: «L''impresa potrebbe essere idonea ad ospitare un ragazzo in stage?». Fino al 30/09/2026 le importazioni la scrivevano in stage_vis; spostata qui il 30/09/2026. NON dice che la visita è una visita stage.';
comment on column public.visite.stage_vis is
  'Visita stage: c''è uno stagista (nom_stage). Nell''app la mette l''aggancio a un incarico stage. Per le visite importate dal modulo Google vale la risposta a «E'' visita STAGE ragazzi scuola?» (stage_sn), riallineata il 30/09/2026.';

create table if not exists archivio.bk_2026_09_30_visite_stage as
  select visita_id, stage_vis, stage_sn, nom_stage, now() as salvato_il from public.visite;

-- correzione tecnica: non è una modifica del tecnico, quindi niente riga di audit e updated_at invariato
alter table public.visite disable trigger visite_audit_trg;
alter table public.visite disable trigger trg_visite_updated_at;

update public.visite
   set impresa_idonea_stage = stage_vis,
       stage_vis = coalesce(stage_sn, false)
 where visita_id ~ '^(V[0-9]{4}-|FORM|XLS0|AGG0)'
   and impresa_idonea_stage is null
   and (stage_vis is not null or coalesce(stage_sn, false));

alter table public.visite enable trigger trg_visite_updated_at;
alter table public.visite enable trigger visite_audit_trg;

-- ── 2) seconda visita solo se la sua tariffa è diversa dalla prima ────
do $mig$
declare
  d text;
  vecchio text := $a$::int > 1 then 'visita_successiva'$a$;
  nuovo   text := $b$::int > 1 and public.s_tariffa('visita_successiva', v.data_visita, p_tecnico) is distinct from public.s_tariffa('visita_prima', v.data_visita, p_tecnico) then 'visita_successiva'$b$;
begin
  select pg_get_functiondef('public.s_prestazioni_calcola_interna(text,integer,integer)'::regprocedure) into d;
  if position(nuovo in d) > 0 then return; end if;   -- già applicato
  if (length(d) - length(replace(d, vecchio, ''))) / length(vecchio) <> 1 then
    raise exception 'frammento da sostituire non trovato una volta sola in s_prestazioni_calcola_interna';
  end if;
  execute replace(d, vecchio, nuovo);
end
$mig$;

-- ── 3) le prestazioni di settembre 2026 già congelate, non fatturate ──
with calc as (
  select t.tecnico_id, x->>'visita_id' visita_id, x->>'tipo' tipo, x->>'tariffa_codice' tar, (x->>'importo')::numeric importo
  from public.tecnici t, jsonb_array_elements(public.s_prestazioni_calcola_interna(t.tecnico_id, 2026, 9)) x
  where x->>'sorgente' = 'visita')
update public.s_prestazioni p set tipo = c.tipo, tariffa_codice = c.tar
from calc c
where p.visita_id = c.visita_id and p.tecnico_id = c.tecnico_id and p.anno = 2026 and p.mese = 9
  and p.fattura_id is null and p.chiusa_il is null and p.importo = c.importo
  and (p.tipo is distinct from c.tipo or p.tariffa_codice is distinct from c.tar);
