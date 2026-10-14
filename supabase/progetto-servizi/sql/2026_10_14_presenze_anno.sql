-- =============================================================================
--  PROGETTO SERVIZI: L'ANNO DI NASCITA ALLA FIRMA DI PRESENZA (14/10/2026)
-- -----------------------------------------------------------------------------
--  Dalla verifica di legge del 14/10: il codice personale da solo stava
--  stampato sul registro accanto al nome, e chiunque poteva leggerlo. Da oggi
--  il codice si consegna su un biglietto personale e alla firma si chiede
--  anche l'anno di nascita.
--  Il Gestionale pubblica in `presenze_pubbliche.persone` anche `a` =
--  impronta di (codice + ':' + ultime due cifre dell'anno), solo quando
--  l'anno è ricavabile (data di nascita o codice fiscale). Mai l'anno in
--  chiaro. `pres_che_cosa` con p_anno:
--    · persona con `a` e anno che non torna → {trovato:false, anno_errato:true}
--      (non si mostrano neppure le iniziali);
--    · persona senza `a` → come prima, con anno_verificato:false;
--    · p_anno assente (pagina vecchia rimasta in cache) → come prima.
--  Si toglie la versione a 3 argomenti: due versioni con default renderebbero
--  ambigua la chiamata per nome.
-- =============================================================================

drop function if exists public.pres_che_cosa(text, text, text);
create or replace function public.pres_che_cosa(p_codice text, p_firma text, p_personale text, p_anno text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare t public.presenze_pubbliche; cod text; fir text; per text; h text; v jsonb; g jsonb; v_oggi date; dec jsonb; v_data date;
        v_anno text; v_verif boolean := false;
begin
  cod := upper(regexp_replace(coalesce(p_codice, ''), '[^A-Za-z0-9-]', '', 'g'));
  fir := lower(regexp_replace(coalesce(p_firma,  ''), '[^A-Fa-f0-9]',  '', 'g'));
  per := upper(regexp_replace(coalesce(p_personale, ''), '[^A-Za-z0-9]', '', 'g'));
  v_anno := regexp_replace(coalesce(p_anno, ''), '[^0-9]', '', 'g');
  if length(per) not between 3 and 12 then return jsonb_build_object('trovato', false); end if;
  select * into t from public.presenze_pubbliche
   where codice = cod
     and firma_hash = encode(extensions.digest(convert_to(fir, 'UTF8'), 'sha256'), 'hex');
  if not found then return jsonb_build_object('trovato', false); end if;

  h := encode(extensions.digest(convert_to(per, 'UTF8'), 'sha256'), 'hex');
  select x into v from jsonb_array_elements(t.persone) x where x ->> 'h' = h;
  if v is null then return jsonb_build_object('trovato', false); end if;

  /* l'anno: si controlla quando la persona ne ha l'impronta e la pagina lo manda */
  if p_anno is not null and v ? 'a' then
    if length(v_anno) <> 4
       or encode(extensions.digest(convert_to(per || ':' || right(v_anno, 2), 'UTF8'), 'sha256'), 'hex') <> v ->> 'a' then
      return jsonb_build_object('trovato', false, 'anno_errato', true);
    end if;
    v_verif := true;
  end if;

  v_oggi := (now() at time zone 'Europe/Rome')::date;
  select x into g from jsonb_array_elements(t.giornate) x
   where (x ->> 'data') ~ '^\d{4}-\d{2}-\d{2}$'
   order by abs((x ->> 'data')::date - v_oggi), x ->> 'dalle' limit 1;
  if g is null then
    return jsonb_build_object('trovato', true, 'iniziali', v ->> 'n', 'anno_verificato', v_verif, 'giornata', null, 'tipo', null, 'fuori_orario', true);
  end if;
  v_data := (g ->> 'data')::date;
  dec := public.pres_decidi(v_data, (g ->> 'dalle')::time, (g ->> 'alle')::time, (g ->> 'dalle2')::time, (g ->> 'alle2')::time, now());
  return jsonb_build_object(
    'trovato', true, 'iniziali', v ->> 'n', 'anno_verificato', v_verif,
    'giornata', to_char(v_data, 'YYYY-MM-DD'), 'oggi', (v_data = v_oggi),
    'tipo', dec ->> 'tipo', 'turno', (dec ->> 'turno')::int, 'ora_turno', dec ->> 'ora_turno',
    'fuori_orario', coalesce((dec ->> 'fuori_orario')::boolean, true));
end $$;
grant execute on function public.pres_che_cosa(text, text, text, text) to anon, authenticated, service_role;
