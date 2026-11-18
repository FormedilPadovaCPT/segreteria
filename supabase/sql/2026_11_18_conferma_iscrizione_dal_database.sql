-- ============================================================
-- LA CONFERMA DELL'ISCRIZIONE PARTE DAL DATABASE (18/11/2026)
--
-- Prova vera dell'utente, iscrizione n° 9 del corso 332: confermata alle
-- 13:23, nessuna mail. I registri dicono che la pagina della segreteria non
-- ha chiamato promemoria-corsi: era aperta da prima della pubblicazione delle
-- 12:15 e girava col codice vecchio. Una mail che deve partire non può
-- dipendere da quale versione di una pagina è aperta in quel momento.
--
-- Qui: quando una richiesta diventa «confermata» (e non viene dalla sala), il
-- database chiama promemoria-corsi con { conferma_iscrizione } attraverso
-- pg_net, che spedisce DOPO il commit (gli iscritti appena creati ci sono già)
-- e non rallenta la conferma. Il giro del mattino rimanda quelle rimaste
-- indietro. La pagina non la manda più da sola; resta «✉ Rimanda la conferma».
-- ============================================================

create or replace function public.trg_iscrizioni_conferma_mail()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_tok text;
begin
  if new.stato = 'confermata' and old.stato is distinct from 'confermata' and new.in_sala is null then
    select valore into v_tok from public.s_config where chiave = 'promemoria_corsi_token';
    if coalesce(v_tok, '') = '' then
      raise warning 'conferma iscrizione %: manca promemoria_corsi_token, la mail la rimanda il giro del mattino', new.id;
      return new;
    end if;
    begin
      perform net.http_post(
        url := 'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/promemoria-corsi',
        body := jsonb_build_object('conferma_iscrizione', new.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Promemoria-Corsi', v_tok,
          -- la chiave pubblica (anon) che chiede verify_jwt: è la stessa del giro del mattino
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZGFudHJmdWdubXFzdXVqeGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjEzMTYsImV4cCI6MjA5MzgzNzMxNn0.L6YUgMD9rYPtqZCn5-c6hB-ok5nSCISpSolj_a-pcmM'),
        timeout_milliseconds := 60000);
    exception when others then
      /* la conferma non si ferma mai per la mail: la rimanda il giro del mattino */
      raise warning 'conferma iscrizione %: chiamata non accodata (%), la rimanda il giro del mattino', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke execute on function public.trg_iscrizioni_conferma_mail() from public, anon, authenticated;

drop trigger if exists trg_s_iscrizioni_conferma_mail on public.s_iscrizioni;
create trigger trg_s_iscrizioni_conferma_mail after update of stato on public.s_iscrizioni
  for each row execute function public.trg_iscrizioni_conferma_mail();
