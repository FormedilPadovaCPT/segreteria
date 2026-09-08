-- ============================================================================
-- 2026-09-08 — ricontrolli_pendenti allineata alla pagina Scadenze del gestionale
--
-- L'utente ha confrontato per Caon la pagina Scadenze del gestionale, la lettera
-- di incarico della segreteria e il promemoria del lunedì: «le scadenze devono
-- essere uguali a quelle che appaiono nel gestionale, altrimenti c'è un errore».
-- L'errore c'era, in due punti di questa funzione (usata dal promemoria):
--
-- 1. Escludeva le visite con `chiusa = true` PRIMA di scegliere l'ultima visita
--    del cantiere. Se l'ultima visita era chiusa (es. 2° accesso con IPC NR, che
--    archivia il cantiere), la funzione prendeva la PENULTIMA e la rimetteva in
--    scadenza: via Milano Albignasego, verbale 0220, «scaduto 914 gg» nella mail,
--    mentre il gestionale — che non guarda `chiusa` — lo archivia correttamente
--    sull'ultima visita 0273. Ora `chiusa` non conta, come nel gestionale.
-- 2. A parità di data (due o tre verbali lo stesso giorno sullo stesso cantiere:
--    0567/0568 via Zacco, 0796/0797/0799 via Boccaccio) sceglieva a caso, e
--    quindi un numero di verbale diverso da quello della pagina. Ora vale il
--    numero di verbale più alto; lo stesso spareggio è messo nel gestionale
--    (loadScadenze) e nella lettera di incarico (tutteLeVisite).
-- 3. `data_ritorno` valeva solo se >= data_visita; il gestionale la usa com'è.
--    Ora com'è: se una data è sbagliata si vede in entrambi i posti e si corregge.
-- Il promemoria del lunedì passa ora 60 giorni come finestra (era 7): la pagina
-- Scadenze mostra 60 giorni, e le due liste devono coincidere.
-- ============================================================================
create or replace function public.ricontrolli_pendenti(p_giorni_imminenti integer default 7)
returns table(tecnico_id text, tecnico_email text, tecnico_nome text, cantiere_id text, cantiere_label text, nr_verbale text, data_visita date, acc integer, ipc text, data_rientro date, tipo text, giorni_diff integer, categoria text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ultime as (
    select distinct on (v.cantiere_id) v.*
    from public.visite v
    join public.cantieri c on c.cantiere_id = v.cantiere_id
    where coalesce(v.elimina,0)=0
      and coalesce(c.cantiere_chiuso,false)=false
    order by v.cantiere_id, v.data_visita desc, v.nr_verbale desc
  ),
  calc as (
    select u.tecnico_id, u.cantiere_id, u.nr_verbale, u.data_visita,
      u.data_ritorno as data_ritorno_valida,
      nullif(regexp_replace(coalesce(u.acc_cant::text,''),'\D','','g'),'')::int as acc,
      upper(coalesce(nullif(trim(u.ipc),''),'NR')) as ipc
    from ultime u
  ),
  g as (
    select c.*,
      case
        when c.acc is null or c.acc<=1 then case when c.ipc='ALTO' then 3 when c.ipc in ('MEDIO','BASSO') then 22 end
        when c.acc=2 then case when c.ipc='ALTO' then 3 when c.ipc='MEDIO' then 22 end
        else case when c.ipc='ALTO' then 3 end
      end as giorni,
      case
        when c.acc is null or c.acc<=1 then case when c.ipc='ALTO' then 'urgente' when c.ipc in ('MEDIO','BASSO') then 'ordinaria' end
        when c.acc=2 then case when c.ipc='ALTO' then 'immediata' when c.ipc='MEDIO' then 'ordinaria' end
        else case when c.ipc='ALTO' then 'immediata' end
      end as tipo
    from calc c
  ),
  eff as (
    select g.*,
      case
        when g.giorni is null then null
        when g.data_ritorno_valida is not null then g.data_ritorno_valida
        else g.data_visita + g.giorni
      end as eff_ritorno
    from g
  )
  select e.tecnico_id, t.email,
    trim(coalesce(t.tecnico_cognome,'')||' '||coalesce(t.tecnico_nome,'')),
    e.cantiere_id,
    case
      when nullif(trim(ca.cantiere_indirizzo),'') is not null
        then trim(concat_ws(' ', ca.cantiere_indirizzo, ca.cantiere_civico))
             || case when nullif(trim(ca.comune_nome),'') is not null then ', '||ca.comune_nome else '' end
      else coalesce(
             nullif(trim(ca.cantiere_etichetta),'')
               || case when nullif(trim(ca.comune_nome),'') is not null then ', '||ca.comune_nome else '' end,
             ca.cantiere_etichetta,
             ca.comune_nome
           )
    end,
    e.nr_verbale,
    e.data_visita, e.acc, e.ipc,
    e.eff_ritorno, e.tipo,
    (e.eff_ritorno - current_date),
    case
      when e.eff_ritorno <= current_date then 'urgente'
      when e.eff_ritorno <= current_date + p_giorni_imminenti then 'imminente'
      else 'futuro'
    end
  from eff e
  left join public.tecnici t on t.tecnico_id = e.tecnico_id
  left join public.cantieri ca on ca.cantiere_id = e.cantiere_id
  where e.eff_ritorno is not null
$$;
