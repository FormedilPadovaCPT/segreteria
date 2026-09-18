/* ============================================================================
   IL PONTE: LE DOMANDE ARRIVANO AL PORTALE                    (18/09/2026)

   Il portale non parla col database del Gestionale — chi sta su internet non
   deve avere le chiavi (regola del 13/09/2026). Le domande di un evento gli
   arrivano perché il Gestionale gliele COPIA sul progetto Servizi, come già
   fa con gli attestati: di là c'è solo il testo delle domande.

   Il giro:
     segreteria → questionari-pubblica (Gestionale, legge quest_pubblicazione)
                → questionari-ricevi   (Servizi, scrive questionari_pubblici)
                → apri_questionario(codice, firma) ← la pagina del portale

   ⚠️ LA PAROLA D'ORDINE NON SI TRASPORTA, SI DERIVA. I due progetti
   condividono già attestati_token (verificato confrontando le IMPRONTE, senza
   leggere i valori): questionari_token si calcola da quello con la stessa
   formula sui due lati, così il segreto non passa per una chat, un file o un
   appunto. Se un giorno attestati_token cambia, questa riga va ricalcolata su
   TUTTI E DUE i database o il ponte si chiude.

   ⚠️ DELLA FIRMA PARTE SOLO L'IMPRONTA sha256: al portale basta per
   riconoscere chi arriva col link giusto, e il segreto non esce dal
   Gestionale nemmeno in copia.

   DUE COSE IMPARATE PROVANDO IL PONTE, e per questo il file esiste:

   1. Dentro una funzione SECURITY DEFINER, `current_user` è il PROPRIETARIO,
      non il chiamante: il controllo «current_user = 'service_role'» era
      sempre falso e la pubblicazione rispondeva «non autorizzato». Il ruolo
      di chi chiama si legge dai claim che PostgREST imposta dal JWT
      verificato, che un utente non può falsificare.

   2. Un istante senza fuso viene riletto come UTC. `to_char(... at time zone
      'Europe/Rome', ...)` faceva arrivare la chiusura DUE ORE più avanti:
      le 23:59 italiane diventavano le 23:59 UTC. Ora parte l'istante intero
      con l'offset. La data dell'evento resta una data secca: quella non ha
      fuso.
   ============================================================================ */

-- ═══════════════════ progetto SERVIZI (qcvwrgjldbdoxcfdsvkq) ═══════════════
/*
create table if not exists public.questionari_pubblici (
  codice        text primary key,
  firma_hash    text not null,
  titolo        text not null,
  genere        text not null default 'corso',
  quando        date,
  sede          text,
  chiuso_il     timestamptz,
  domande       jsonb not null default '[]'::jsonb,
  aggiornato_il timestamptz not null default now()
);

alter table public.questionari_pubblici enable row level security;
revoke all on public.questionari_pubblici from anon, authenticated;

create or replace function public.apri_questionario(p_codice text, p_firma text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare q public.questionari_pubblici; cod text; fir text;
begin
  cod := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9-]', '', 'g'));
  fir := lower(regexp_replace(coalesce(p_firma,  ''), '[^A-Fa-f0-9]',  '', 'g'));
  if length(cod) not between 3 and 40 or length(fir) not between 8 and 64 then
    return jsonb_build_object('trovato', false);
  end if;

  select * into q from public.questionari_pubblici
   where codice = cod
     and firma_hash = encode(extensions.digest(convert_to(fir, 'UTF8'), 'sha256'), 'hex');
  if not found then
    -- codice inesistente e firma sbagliata rispondono allo stesso modo: chi
    -- prova a indovinare non impara nemmeno se l'evento esiste.
    return jsonb_build_object('trovato', false);
  end if;

  return jsonb_build_object(
    'trovato',   true,
    'aperto',    (q.chiuso_il is null or q.chiuso_il > now()),
    'codice',    q.codice,
    'titolo',    q.titolo,
    'genere',    q.genere,
    'quando',    q.quando,
    'sede',      q.sede,
    'chiuso_il', q.chiuso_il,
    'domande',   q.domande);
end $fn$;

revoke execute on function public.apri_questionario(text, text) from public;
grant execute on function public.apri_questionario(text, text) to anon, authenticated, service_role;

insert into public.cassetta_impostazioni (chiave, valore, descrizione)
values ('questionari_token', encode(extensions.gen_random_bytes(32), 'hex'), '…')
on conflict (chiave) do nothing;

update public.cassetta_impostazioni
   set valore = encode(extensions.digest(convert_to('questionari:v1:' ||
                  (select valore from public.cassetta_impostazioni where chiave = 'attestati_token'),
                  'UTF8'), 'sha256'), 'hex'),
       aggiornato_il = now()
 where chiave = 'questionari_token';
*/

-- ═══════════════════ progetto GESTIONALE (utdantrfugnmqsuujxbe) ════════════

insert into public.s_config (chiave, valore, descrizione)
values ('questionari_token',
        encode(extensions.digest(convert_to('questionari:v1:' ||
          (select valore from public.s_config where chiave = 'attestati_token'), 'UTF8'), 'sha256'), 'hex'),
        'Parola d''ordine di questionari-ricevi sul progetto Servizi. Derivata da attestati_token con sha256(''questionari:v1:'' || attestati_token).')
on conflict (chiave) do update
  set valore = excluded.valore, descrizione = excluded.descrizione;

insert into public.s_config (chiave, valore, descrizione)
values ('questionari_ricevi_url', 'https://qcvwrgjldbdoxcfdsvkq.supabase.co/functions/v1/questionari-ricevi',
        'Dove il Gestionale copia le domande di un questionario, sul progetto Servizi.')
on conflict (chiave) do nothing;

/* la versione definitiva di quest_pubblicazione: risponde anche al servizio
   (la edge function, quando pubblica da sola) e manda l'istante col fuso. */
create or replace function public.quest_pubblicazione(p_corso_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare r record; v_dom jsonb; v_ruolo text;
begin
  v_ruolo := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if not (public.is_segreteria() or v_ruolo = 'service_role') then
    raise exception 'non autorizzato';
  end if;

  select c.id, c.titolo, c.tipo, c.sede, c.data_inizio, c.data_fine,
         c.quest_codice, c.quest_modello, c.quest_chiuso_il
    into r from public.s_corsi c where c.id = p_corso_id;
  if not found or r.quest_codice is null then return null; end if;

  select coalesce(jsonb_agg(d order by d.tronco desc, d.ordine, d.id), '[]'::jsonb)
    into v_dom
    from (
      select id, ordine, testo, tipo, opzioni, obbligatoria, tronco
        from public.s_quest_domande
       where modello = r.quest_modello
       union all
      select id, 100 + ordine, testo, tipo, opzioni, obbligatoria, tronco
        from public.s_quest_domande
       where corso_id = r.id
    ) d;

  return jsonb_build_object(
    'codice',      r.quest_codice,
    'firma',       public.quest_firma(r.quest_codice),
    'titolo',      r.titolo,
    'genere',      coalesce(r.quest_modello, 'corso'),
    'quando',      to_char(coalesce(r.data_inizio, r.data_fine), 'YYYY-MM-DD'),
    'sede',        r.sede,
    'chiuso_il',   to_jsonb(r.quest_chiuso_il),
    'domande',     v_dom);
end $$;

revoke execute on function public.quest_pubblicazione(bigint) from public, anon;
grant execute on function public.quest_pubblicazione(bigint) to authenticated, service_role;
