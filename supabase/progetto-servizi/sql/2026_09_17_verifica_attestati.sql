-- =============================================================================
--  PROGETTO SERVIZI: LA VERIFICA PUBBLICA DEGLI ATTESTATI (17/09/2026)
-- -----------------------------------------------------------------------------
--  Deciso dall'utente: il QR degli attestati della serie N/aaaa punta a una
--  pagina del portale servizi su GitHub
--  (https://formedilpadovacpt.github.io/servizi/verifica/). Chi lo inquadra —
--  un coordinatore in cantiere, SPISAL, l'ispettorato, un committente — vede
--  se l'attestato esiste, se è valido o revocato, per quale corso e quante ore.
--
--  Perché qui e non sul Gestionale: la pagina è pubblica, e la porta aperta a
--  internet non deve avere in mano le chiavi (regola del 13/09/2026). Il
--  Gestionale COPIA qui i soli dati minimi di ogni attestato (funzione
--  attestati-pubblica, con parola d'ordine); la pagina legge solo da qui.
--
--  Dati minimi, per scelta:
--    - niente nome, codice fiscale, impresa, data di nascita: solo le INIZIALI;
--    - il codice di verifica non c'è: c'è la sua impronta (sha256). Il codice
--      sta solo sull'attestato stampato (nel QR e scritto sotto);
--    - senza numero E codice giusti la funzione non dice niente, nemmeno se il
--      numero esiste: così non si possono sfogliare gli attestati cambiando
--      il numero nell'indirizzo.
--
--  ⚠️ I segreti non stanno in questo file: attestati_token nasce nel database
--  (sotto) e si copia a mano in s_config.attestati_token del Gestionale.
-- =============================================================================

create table if not exists public.attestati_pubblici (
  numero        text primary key,                     -- «12/2027»
  codice_hash   text not null,                        -- sha256 esadecimale del codice di verifica
  tipo          text not null,                        -- «Attestato di frequenza», …
  corso         text not null,                        -- titolo del corso
  tipologia     text,
  durata_ore    numeric,
  ore_frequentate numeric,
  data_inizio   date,
  data_fine     date,
  data_rilascio date not null,
  iniziali      text not null,                        -- «R. M.»
  ente          text not null default 'Formedil Padova',
  stato         text not null default 'valido' check (stato in ('valido', 'revocato')),
  revocato_il   date,
  aggiornato_il timestamptz not null default now()
);
comment on table public.attestati_pubblici is
  'Verifica pubblica degli attestati (17/09/2026): copia minima fatta dal Gestionale, letta dalla pagina servizi/verifica solo con numero e codice. Nessun nome, CF o impresa.';

alter table public.attestati_pubblici enable row level security;
revoke all on table public.attestati_pubblici from anon, authenticated;

-- la parola d'ordine per la copia dal Gestionale nasce qui
insert into public.cassetta_impostazioni (chiave, valore, descrizione) values
  ('attestati_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
   'Parola d''ordine della funzione attestati-pubblica (la stessa sta in s_config.attestati_token del Gestionale).')
on conflict (chiave) do nothing;

-- l'unica porta pubblica: numero + codice, e risponde solo se tornano entrambi
create or replace function public.verifica_attestato(p_numero text, p_codice text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.attestati_pubblici;
  cod text := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9]', '', 'g'));
  num text := regexp_replace(coalesce(p_numero, ''), '-', '/');
begin
  if length(num) > 20 or length(cod) not between 8 and 20 then
    return jsonb_build_object('trovato', false);
  end if;
  select * into a from public.attestati_pubblici
   where numero = num
     and codice_hash = encode(sha256(convert_to(cod, 'UTF8')), 'hex');
  if not found then
    return jsonb_build_object('trovato', false);
  end if;
  return jsonb_build_object(
    'trovato', true,
    'numero', a.numero, 'stato', a.stato, 'revocato_il', a.revocato_il,
    'tipo', a.tipo, 'corso', a.corso, 'tipologia', a.tipologia,
    'durata_ore', a.durata_ore, 'ore_frequentate', a.ore_frequentate,
    'data_inizio', a.data_inizio, 'data_fine', a.data_fine, 'data_rilascio', a.data_rilascio,
    'iniziali', a.iniziali, 'ente', a.ente, 'aggiornato_il', a.aggiornato_il);
end
$$;

revoke execute on function public.verifica_attestato(text, text) from public, anon, authenticated;
grant execute on function public.verifica_attestato(text, text) to anon, authenticated, service_role;
