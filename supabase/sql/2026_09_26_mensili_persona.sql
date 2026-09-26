-- ============================================================
-- Incarichi mensili storici, 26/09/2026 — la persona, oltre all'email
-- (approvato dall'utente il 26/09/2026)
--
-- 285 incarichi mensili su 908 non hanno tecnico_id: sono di docenti e di
-- tecnici del passato che non stanno in `tecnici`, e si ritrovavano solo per
-- indirizzo email. Come già s_fatture_tecnici, la riga porta ora anche
-- persona_id (→ persone), riempito SOLO dove l'email corrisponde a una e una
-- sola scheda persona attiva: 8 persone (Migliolaro, Chiffi, Ruscitti,
-- Picelli, Vianello, Bastianello, Bissacco Antonio, Scudier).
-- Esclusa per scelta appalti@ancepadova.it: è una casella condivisa di ANCE,
-- attribuirla a una persona sarebbe una deduzione. Senza scheda persona:
-- Bortolami, Degaspari, Castellini, cpt@scuolaedilepadova.net.
-- fondi_persone sposta da sola anche questa colonna (scorre tutte le
-- colonne persona_id di tipo uuid).
-- Per tornare indietro: alter table public.s_incarichi_mensili drop column persona_id;
-- ============================================================
alter table public.s_incarichi_mensili add column if not exists persona_id uuid;
comment on column public.s_incarichi_mensili.persona_id is 'Persona dell''incarico quando non è in `tecnici` (docenti e tecnici del passato). Riempita il 26/09/2026 dove l''email corrisponde a una sola scheda.';

alter table public.s_incarichi_mensili drop constraint if exists s_incarichi_mensili_persona_id_fkey;
alter table public.s_incarichi_mensili add constraint s_incarichi_mensili_persona_id_fkey
  foreign key (persona_id) references public.persone(persona_id);
create index if not exists ix_s_incarichi_mensili_persona_id on public.s_incarichi_mensili (persona_id);

update public.s_incarichi_mensili m
   set persona_id = x.persona_id
  from (
    select e.email, (array_agg(p.persona_id))[1] persona_id
      from (select distinct lower(tecnico_email) email from public.s_incarichi_mensili
             where tecnico_id is null and tecnico_email is not null
               and lower(tecnico_email) <> 'appalti@ancepadova.it') e
      join public.persone p on coalesce(p.elimina,0) = 0
       and e.email in (lower(p.email), lower(coalesce(p.email2,'')), lower(coalesce(p.email3,'')))
     group by e.email
    having count(distinct p.persona_id) = 1) x
 where lower(m.tecnico_email) = x.email and m.tecnico_id is null and m.persona_id is null;
