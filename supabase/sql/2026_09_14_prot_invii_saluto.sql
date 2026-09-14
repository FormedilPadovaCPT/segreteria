-- 14/09/2026 — Il saluto delle mail del protocollato resta scritto.
--
-- Il dialogo «Invia protocollato» propone ora, per tipo di documento, anche
-- la riga d'apertura (per il piano 5.D.4: «G.d.V. / e.p.c. / Spett.le …»).
-- Come il testo, quello che si è scritto nel saluto resta nel registro degli
-- invii: l'app registra la PREPARAZIONE, l'invio lo fa una persona.
-- Applicata su Supabase con apply_migration «prot_invii_saluto_2026_09_14».

alter table public.s_prot_invii add column if not exists saluto text;

comment on column public.s_prot_invii.saluto is
  'Riga d''apertura della mail preparata (vuota = «Gent.le <nome>, buongiorno,»).';
