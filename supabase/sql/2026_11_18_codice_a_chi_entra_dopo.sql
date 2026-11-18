-- ════════════════════════════════════════════════════════════════════════
-- Il codice personale a chi entra dopo l'apertura delle firme   (18/11/2026)
-- Dalla prova del corso 338: chi si registra in sala, confermato, diventa
-- iscritto senza codice, e la sezione firme mostrava «un iscritto senza
-- codice: premi Ripubblica». Ora chi entra in un corso con le firme dal QR
-- aperte riceve subito il suo codice, e il corso si ripubblica da solo sul
-- portale (una volta per corso, anche se entrano in venti insieme).
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.trg_iscritti_codice_dopo_apertura()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  for r in select distinct n.corso_id from nuovi n
             join public.s_corsi c on c.id = n.corso_id
            where n.test_codice is null and c.pres_codice is not null
              and (c.pres_chiuso_il is null or c.pres_chiuso_il > now())
  loop
    begin
      if public.corso_codici_personali(r.corso_id) > 0 then
        perform public.pres_ripubblica(r.corso_id);
      end if;
    exception when others then
      raise warning 'trg_iscritti_codice_dopo_apertura: corso % (%): il codice lo assegna «Ripubblica»', r.corso_id, sqlerrm;
    end;
  end loop;
  return null;
end $$;
drop trigger if exists trg_s_corsi_iscritti_codice_dopo_apertura on public.s_corsi_iscritti;
create trigger trg_s_corsi_iscritti_codice_dopo_apertura after insert on public.s_corsi_iscritti
  referencing new table as nuovi for each statement execute function public.trg_iscritti_codice_dopo_apertura();
