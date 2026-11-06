-- ============================================================
-- Post social: il promemoria di pubblicazione nel calendario (06/11/2026)
--
-- Chiesto dall'utente (segreteria d'area): quando un post è approvato dal
-- Direttore e ha una data di programmazione, nel calendario Google compare
-- da solo il promemoria per pubblicarlo, così non si dimentica.
-- Scelte dell'utente, stesso giorno:
--   · calendario: il primario di cptpd@did.formedilpadova.it (s_config.post_calendario_id);
--   · ora: 9:30 del giorno programmato, con notifica (s_config.post_calendario_ora);
--   · pubblicato il post, l'evento resta, segnato «✅ Pubblicato», senza notifica.
-- Non è un'eccezione alla regola «l'app prepara, la persona manda»: è un
-- evento senza invitati nel calendario della segreteria, non esce niente.
--
-- Il trigger chiama la funzione `calendario-post` (pg_net, dopo il commit)
-- quando cambia qualcosa che conta per l'evento; la funzione rilegge il post
-- e porta il calendario a combaciare (crea, sposta, segna, toglie), e scrive
-- l'esito in s_post.calendario_il / calendario_esito. Un errore qui non
-- blocca mai il salvataggio del post.
-- ============================================================

alter table public.s_post add column if not exists calendario_il timestamptz;
alter table public.s_post add column if not exists calendario_esito text;

insert into public.s_config (chiave, valore, descrizione) values
  ('post_calendario_id', 'cptpd@did.formedilpadova.it', 'Calendario Google dei promemoria di pubblicazione dei post social (funzione calendario-post)'),
  ('post_calendario_ora', '09:30', 'Ora del promemoria di pubblicazione dei post social, nel giorno programmato (hh:mm)'),
  ('calendario_post_token', encode(extensions.gen_random_bytes(24), 'hex'), 'Parola d''ordine con cui il database chiama la funzione calendario-post')
on conflict (chiave) do nothing;

create or replace function public.s_post_calendario_avvisa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_tok text; conta boolean;
begin
  conta := case when tg_op = 'INSERT' then new.stato in ('approvato', 'pubblicato')
    else (old.stato in ('approvato', 'pubblicato') or new.stato in ('approvato', 'pubblicato'))
      and (new.stato is distinct from old.stato
           or new.data_programmata is distinct from old.data_programmata
           or new.titolo is distinct from old.titolo
           or new.pubblicato_il is distinct from old.pubblicato_il) end;
  if not coalesce(conta, false) then return new; end if;
  begin
    select valore into v_tok from s_config where chiave = 'calendario_post_token';
    if coalesce(v_tok, '') <> '' then
      perform net.http_post(
        url := 'https://utdantrfugnmqsuujxbe.supabase.co/functions/v1/calendario-post',
        body := jsonb_build_object('post_id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'X-Calendario-Post', v_tok));
    end if;
  exception when others then
    raise warning 's_post_calendario_avvisa: % (il post è salvato, il calendario no)', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists s_post_calendario on public.s_post;
create trigger s_post_calendario after insert or update on public.s_post
  for each row execute function public.s_post_calendario_avvisa();

revoke all on function public.s_post_calendario_avvisa() from public, anon, authenticated;
