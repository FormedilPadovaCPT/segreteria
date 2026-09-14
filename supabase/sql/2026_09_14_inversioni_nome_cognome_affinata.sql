-- =============================================================================
--  INVERSIONI NOME/COGNOME: LA REGOLA AFFINATA DOPO LA PROVA (14/09/2026)
-- -----------------------------------------------------------------------------
--  Segue 2026_09_14_inversioni_nome_cognome.sql (va eseguita dopo). La prova a
--  vuoto sull'anagrafica vera ha dato 29 persone e 32 coppie nelle visite, e
--  tre casi in cui la prima regola avrebbe sbagliato:
--    - «Germana / Cristiano», titolo Dott.ssa: una donna che si chiama Germana.
--      Se il titolo e' femminile e il nome che risulterebbe e' maschile, no;
--    - «Nicolò / Di Pietro»: il dizionario non riconosceva «Nicolò» con
--      l'accento, e un cognome con particella (Di, De, Da, Del, La...) e' un
--      cognome. Conteggi senza accenti e particelle mai girate;
--    - «Sergiu / Stolnic»: il codice fiscale dice invertiti, ma Sergiu e' un nome
--      di battesimo (7 persone) e Stolnic mai. Quando CF e dizionario si
--      contraddicono non e' palese: si lascia. Il CF resta decisivo quando il
--      dizionario non sa dire niente (es. «Lucica / Poenaru») o gli da' ragione.
--
--  La firma cambia: nome_cognome_invertiti(nome, cognome, cf, titolo).
--
--  Applicata su Supabase come migrazione inversioni_nome_cognome_affinata_2026_09_14.
-- =============================================================================

create index if not exists persone_primo_nome_norm_idx
  on public.persone (upper(translate(split_part(trim(nome), ' ', 1), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')));
create index if not exists persone_cognome_norm_idx
  on public.persone (upper(translate(trim(cognome), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')));

-- quante persone hanno questa parola come primo nome di battesimo (esclusi i
-- record con la stessa coppia nome/cognome, che non fanno testo)
create or replace function public.conta_come_nome(p_parola text, p_nome text, p_cognome text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.persone pp
   where upper(translate(split_part(trim(pp.nome), ' ', 1), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')) = p_parola
     and coalesce(pp.elimina, 0) = 0
     and not (upper(trim(pp.nome)) = upper(trim(coalesce(p_nome, '')))
              and upper(trim(coalesce(pp.cognome, ''))) = upper(trim(coalesce(p_cognome, ''))))
$$;

create or replace function public.conta_come_cognome(p_parola text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.persone pp
   where upper(translate(trim(pp.cognome), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU')) = p_parola
     and coalesce(pp.elimina, 0) = 0
$$;

revoke execute on function public.conta_come_nome(text, text, text) from public, anon, authenticated;
revoke execute on function public.conta_come_cognome(text) from public, anon, authenticated;
grant execute on function public.conta_come_nome(text, text, text) to service_role;
grant execute on function public.conta_come_cognome(text) to service_role;

drop function if exists public.nome_cognome_invertiti(text, text, text);

create or replace function public.nome_cognome_invertiti(p_nome text, p_cognome text,
                                                         p_cf text default null, p_titolo text default null)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cf         text := upper(regexp_replace(coalesce(p_cf, ''), '[^A-Za-z0-9]', '', 'g'));
  tn         text[] := public.parole_nominativo(p_nome);
  tc         text[] := public.parole_nominativo(p_cognome);
  t          text;
  conta      integer := 0;
  n          integer;
  particelle constant text[] := array['D', 'DA', 'DAL', 'DALL', 'DALLA', 'DALLE', 'DE', 'DEI', 'DEGLI', 'DEL',
                                      'DELL', 'DELLA', 'DELLE', 'DI', 'LA', 'LE', 'LI', 'LO'];
begin
  if coalesce(array_length(tn, 1), 0) = 0 or coalesce(array_length(tc, 1), 0) = 0 then
    return null;
  end if;

  -- 1. il codice fiscale decide, salvo contraddizione netta col dizionario
  if cf ~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z]' and length(cf) = 16 then
    if substr(cf, 1, 3) = public.cf_codice_cognome(p_cognome) and substr(cf, 4, 3) = public.cf_codice_nome(p_nome) then
      return null;
    end if;
    if substr(cf, 1, 3) = public.cf_codice_cognome(p_nome) and substr(cf, 4, 3) = public.cf_codice_nome(p_cognome) then
      if public.conta_come_nome(tn[1], p_nome, p_cognome) >= 2 then
        n := 0;
        foreach t in array tc loop
          continue when length(t) < 3;
          n := n + public.conta_come_nome(t, p_nome, p_cognome);
        end loop;
        if n = 0 then
          return null;   -- il nome e' un nome di battesimo, il cognome mai: CF sospetto
        end if;
      end if;
      return 'codice fiscale';
    end if;
    return null;
  end if;

  -- 2. senza CF
  if tc && particelle then
    return null;         -- «Di Pietro» e' un cognome
  end if;
  if p_titolo ~* '(ra|ssa)[.[:space:]]*$' and public.sesso_da_nome(tc[1]) = 'M' then
    return null;         -- «Dott.ssa Germana Cristiano»
  end if;

  foreach t in array tc loop
    continue when length(t) < 3;
    conta := conta + 1;
    n := public.conta_come_nome(t, p_nome, p_cognome);
    if n < 5 or public.conta_come_cognome(t) * 10 > n then
      return null;
    end if;
  end loop;
  if conta = 0 then
    return null;
  end if;

  conta := 0;
  foreach t in array tn loop
    continue when length(t) < 3;
    conta := conta + 1;
    if public.conta_come_nome(t, p_nome, p_cognome) > 0 then
      return null;
    end if;
  end loop;
  if conta = 0 then
    return null;
  end if;

  return 'dizionario dei nomi';
end;
$$;
revoke execute on function public.nome_cognome_invertiti(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nome_cognome_invertiti(text, text, text, text) to service_role;

create or replace function public.tg_persone_inversione()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mot text;
  r   record;
begin
  if coalesce(new.elimina, 0) <> 0 then
    return new;
  end if;
  mot := public.nome_cognome_invertiti(new.nome, new.cognome, new.cf, new.titolo);
  if mot is null then
    return new;
  end if;
  select * into r from public.inverti_nome_cognome(new.nome, new.cognome, new.titolo);
  perform public.registra_inversione('persone', new.persona_id::text, 'nome/cognome',
                                     new.nome, new.cognome, r.nome, r.cognome, mot);
  new.nome := r.nome;
  new.cognome := r.cognome;
  new.titolo := r.titolo;
  return new;
exception when others then
  raise warning 'inversione nome/cognome (persona %): %', new.persona_id, sqlerrm;
  return new;
end;
$$;

create or replace function public.tg_visite_inversione()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mot text;
  r   record;
begin
  if coalesce(new.elimina, 0) <> 0 then
    return new;
  end if;

  if new.comm_tipo_sogg = 'PF' then
    mot := public.nome_cognome_invertiti(new.comm_nome, new.comm_cog, new.comm_cf, new.comm_titolo);
    if mot is not null then
      select * into r from public.inverti_nome_cognome(new.comm_nome, new.comm_cog, new.comm_titolo);
      perform public.registra_inversione('visite', new.visita_id, 'committente', new.comm_nome, new.comm_cog, r.nome, r.cognome, mot);
      new.comm_nome := r.nome; new.comm_cog := r.cognome; new.comm_titolo := r.titolo;
    end if;
  end if;

  mot := public.nome_cognome_invertiti(new.ppre_nome, new.ppre_cog, null, new.ppre_titolo);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.ppre_nome, new.ppre_cog, new.ppre_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'persona presente', new.ppre_nome, new.ppre_cog, r.nome, r.cognome, mot);
    new.ppre_nome := r.nome; new.ppre_cog := r.cognome; new.ppre_titolo := r.titolo;
    new.nom_ppre := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.rl_nome, new.rl_cog, null, new.rl_titolo);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.rl_nome, new.rl_cog, new.rl_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'responsabile dei lavori', new.rl_nome, new.rl_cog, r.nome, r.cognome, mot);
    new.rl_nome := r.nome; new.rl_cog := r.cognome; new.rl_titolo := r.titolo;
    new.resp_lav := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.csp_nome, new.csp_cog, null, new.csp_titolo);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.csp_nome, new.csp_cog, new.csp_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'CSP', new.csp_nome, new.csp_cog, r.nome, r.cognome, mot);
    new.csp_nome := r.nome; new.csp_cog := r.cognome; new.csp_titolo := r.titolo;
    new.csp := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  mot := public.nome_cognome_invertiti(new.cse_nome, new.cse_cog, null, new.cse_titolo);
  if mot is not null then
    select * into r from public.inverti_nome_cognome(new.cse_nome, new.cse_cog, new.cse_titolo);
    perform public.registra_inversione('visite', new.visita_id, 'CSE', new.cse_nome, new.cse_cog, r.nome, r.cognome, mot);
    new.cse_nome := r.nome; new.cse_cog := r.cognome; new.cse_titolo := r.titolo;
    new.cse := nullif(concat_ws(' ', nullif(trim(r.titolo), ''), r.nome, r.cognome), '');
  end if;

  return new;
exception when others then
  raise warning 'inversione nome/cognome (visita %): %', new.visita_id, sqlerrm;
  return new;
end;
$$;
