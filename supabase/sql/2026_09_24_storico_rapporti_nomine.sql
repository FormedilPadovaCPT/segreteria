-- Storico rapporti e nomine (24/09/2026, decisione dell'utente: «2 e 3» + «Figura esterna»).
-- L'import di Access del 05/08 aveva mescolato le due cose: nomine «DIPENDENTE» senza
-- rapporto, e rapporti col RUOLO al posto del tipo («rspp», «preposto»…). Tre passi,
-- ognuno in una transazione, eseguiti in quest'ordine; prima una copia di sicurezza.
-- Per tornare indietro: le righe CREATE si riconoscono dalla nota (e da ext_id per i
-- rapporti); le righe MODIFICATE hanno tipo e nota di prima in archivio.persone_imprese_backup_20260924.

-- ── 0. copia di sicurezza delle righe che il passo B modifica ────────────────
create table if not exists archivio.persone_imprese_backup_20260924 as
select pi.id, pi.tipo_rapporto, pi.note, now() as copiato_il
  from public.persone_imprese pi
 where pi.tipo_rapporto not in (select codice from public.s_tipi_rapporto);

-- ── A. rapporti mancanti dalle nomine che sono rapporti ─────────────────────
-- DIPENDENTE, TITOLARE, SOCIO, TIROCINANTE, APPRENDISTA (s_tipi_rapporto.ruolo_id).
-- Un rapporto per nomina, con le sue date; la nomina resta dov'e' (storico).
insert into public.persone_imprese (persona_id, impresa_id, tipo_rapporto, mansione,
                                    data_assunzione, data_cessazione, note, ext_id)
select n.persona_id, n.impresa_id, t.codice, n.mansione, n.data_inizio, n.data_fine,
       'Dalla nomina «' || coalesce(n.ruolo_txt, t.etichetta) || '» n. ' || n.access_id
         || ', ricostruito il 24/09/2026',
       'nomina:' || n.access_id
  from public.s_nomine n
  join public.s_tipi_rapporto t on t.ruolo_id = n.ruolo_id
 where n.persona_id is not null and n.impresa_id is not null
   and exists (select 1 from public.imprese i where i.impresa_id = n.impresa_id)
   and not exists (select 1 from public.persone_imprese pi
                    where pi.persona_id = n.persona_id and pi.impresa_id = n.impresa_id);

-- ── B1. la nomina del ruolo, dove manca ─────────────────────────────────────
-- Non per i ruoli che sono tipi di legame e non funzioni: IMPRENDITORE (diventa
-- titolare), TECNICO, COLLABORATORE, «Da usare», «IMPRESA Edile».
do $$
declare base int;
begin
  perform pg_advisory_xact_lock(hashtext('s_nomine.access_id'));
  select greatest(90000, coalesce(max(access_id), 90000)) into base from public.s_nomine where access_id >= 90000;
  insert into public.s_nomine (access_id, data_reg, persona_txt, persona_id, impresa_txt, impresa_id,
                               ruolo_txt, ruolo_id, mansione, data_inizio, data_fine, note, created_at, updated_at)
  select base + row_number() over (order by x.id), current_date,
         trim(concat_ws(' ', p.cognome, p.titolo, p.nome)), x.persona_id, i.impresa_nome, x.impresa_id,
         x.ruolo, x.id_ruolo, x.mansione, x.data_assunzione, x.data_cessazione,
         'Dal rapporto importato da Access (tipo «' || x.tipo_rapporto || '»), 24/09/2026', now(), now()
    from (select pi.*, r.id_ruolo, r.ruolo
            from public.persone_imprese pi
            join public.s_ruoli r on lower(replace(trim(r.ruolo), ' ', '_')) = pi.tipo_rapporto
           where pi.tipo_rapporto not in (select codice from public.s_tipi_rapporto)
             and r.id_ruolo not in (86, 28, 7, 82, 3)
             and not exists (select 1 from public.s_nomine sn
                              where sn.persona_id = pi.persona_id and sn.impresa_id = pi.impresa_id
                                and sn.ruolo_id = r.id_ruolo)) x
    join public.persone p on p.persona_id = x.persona_id
    left join public.imprese i on i.impresa_id = x.impresa_id;
end $$;

-- ── B2. il tipo giusto, con la nota del tipo di prima ───────────────────────
update public.persone_imprese pi
   set tipo_rapporto = case
         when r.propone_rapporto then 'dipendente'
         when pi.tipo_rapporto = 'imprenditore' then 'titolare'
         when pi.tipo_rapporto in ('legale_rappresentante', 'tecnico', 'lavoratore_autonomo',
                                   'collaboratore', 'da_usare', 'impresa_edile') then 'altro'
         else 'esterno' end,
       note = concat_ws(' · ', nullif(pi.note, ''), 'Tipo nell''import Access: ' || pi.tipo_rapporto)
  from public.s_ruoli r
 where lower(replace(trim(r.ruolo), ' ', '_')) = pi.tipo_rapporto
   and pi.tipo_rapporto not in (select codice from public.s_tipi_rapporto);
