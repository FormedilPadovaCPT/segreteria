-- =============================================================================
--  NOMINE RICAVATE DAI VERBALI DI SOPRALLUOGO (14/09/2026)
-- -----------------------------------------------------------------------------
--  Richiesta dell'utente dopo i verbali 864 e 866: Farronato Nicola e
--  Carburazzi Roberto, CSP e CSE in quei verbali, erano entrati nell'anagrafica
--  persone (ruoli text[] = {cse,csp}) ma senza una nomina in s_nomine, che e'
--  il posto dove la scheda persona della segreteria dice che cosa fa una
--  persona. Quella di Farronato l'ha scritta la segreteria a mano il 14/09
--  (access_id 90022); quella di Carburazzi mancava.
--
--  La regola vive nel database, come il completamento anagrafica del 08/09,
--  perche' le porte da cui entra un verbale sono due (form del gestionale e
--  import dal modulo Google) e in tutte e due la VISITA si salva prima della
--  PERSONA (864: visita 08:55:23, persona 08:56:40). Servono quindi due trigger
--  che chiamano la stessa funzione:
--    - trg_visite_nomine: salvata o corretta una visita, per ogni figura cerca
--      la persona e registra la nomina;
--    - trg_persone_nomine: creata o rinominata una persona, rilegge le visite
--      in cui compare.
--
--  Che cosa diventa nomina lo dice la tabella visite_figure_ruoli, non il
--  codice: CSP e CSE -> 48 COORDINATORE PER LA SICUREZZA (lo stesso ruolo scelto
--  a mano per Farronato) con la fase in «mansione»; RL -> 11 RESP. LAVORI; della
--  persona presente solo le qualifiche che dicono un ruolo preciso (titolare,
--  preposto, capocantiere, RSPP, RLS, direttore tecnico, coordinatore,
--  lavoratore autonomo). Le generiche (dipendente, tecnico, operaio...) no.
--
--  Prudenze:
--    - la persona si abbina per nominativo, titoli esclusi e in qualunque
--      ordine; se le persone possibili sono due o piu' NON si sceglie;
--    - se c'e' gia' una nomina equivalente in corso non se ne crea un'altra, e
--      quelle scritte a mano non si toccano;
--    - data_inizio resta vuota: il verbale prova che il ruolo c'era quel giorno,
--      non da quando. Verbale e data stanno nella nota, che comincia sempre con
--      «Rilevata dal verbale»: e' il segno con cui la funzione riconosce le sue;
--    - un errore qui non deve mai impedire di salvare un verbale o una persona:
--      i trigger lo trasformano in un warning.
--
--  Lo STORICO non e' elaborato da questa migrazione: si recupera a parte, con
--  l'ok dell'utente (regola d'oro 2), chiamando s_nomine_da_visita visita per
--  visita. Con p_esegui = false la funzione dice solo che cosa farebbe.
--
--  Applicata su Supabase come migrazione nomine_dai_verbali_2026_09_14.
-- =============================================================================

-- ── 1. Chiave del nominativo: parole minuscole, senza titoli, in ordine ───────
--  «Geom. Nicola Farronato» e «Farronato Nicola» danno la stessa chiave
--  «farronato nicola». Immutabile, perche' serve anche a un indice.
create or replace function public.nominativo_chiave(t text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select nullif(array_to_string(array(
    select distinct w
      from unnest(regexp_split_to_array(
             lower(regexp_replace(
               translate(coalesce(t, ''), 'àáèéìíòóùúÀÁÈÉÌÍÒÓÙÚ', 'aaeeiioouuAAEEIIOOUU'),
               '[^a-zA-Z]+', ' ', 'g')),
             ' ')) w
     where length(w) > 1
       and w not in ('geom', 'geometra', 'geo', 'ing', 'ingegnere', 'arch', 'architetto',
                     'dott', 'dottssa', 'ssa', 'dssa', 'dr', 'sig', 'ra', 'sigg', 'signor',
                     'signora', 'avv', 'rag', 'prof', 'per', 'ind', 'perito', 'pi',
                     'imp', 'rapp', 'ammin', 'leg')
     order by w), ' '), '')
$$;
revoke execute on function public.nominativo_chiave(text) from public, anon;
--  resta eseguibile da authenticated: sta nell'indice su persone, che si
--  aggiorna con i permessi di chi inserisce (tecnici e segreteria)
grant execute on function public.nominativo_chiave(text) to authenticated, service_role;

create index if not exists persone_nominativo_chiave_idx
  on public.persone (public.nominativo_chiave(coalesce(nome, '') || ' ' || coalesce(cognome, '')));

-- ── 2. Quali figure del verbale diventano nomina ──────────────────────────────
create table if not exists public.visite_figure_ruoli (
  chiave            text primary key,      -- 'csp' | 'cse' | 'rl' | 'presente:<qualifica minuscola>'
  ruolo_id          integer not null references public.s_ruoli(id_ruolo),
  ruoli_equivalenti integer[] not null,    -- una nomina con uno di questi ruoli basta
  con_impresa       boolean not null default false,  -- la nomina porta l'impresa visitata
  mansione          text,                  -- vuota: si usa la qualifica scritta nel verbale
  note              text
);
alter table public.visite_figure_ruoli enable row level security;
drop policy if exists vfr_sel on public.visite_figure_ruoli;
create policy vfr_sel on public.visite_figure_ruoli for select to authenticated
  using ((select public.is_personale()));
drop policy if exists vfr_scrive on public.visite_figure_ruoli;
create policy vfr_scrive on public.visite_figure_ruoli for all to authenticated
  using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
revoke all on public.visite_figure_ruoli from anon;

insert into public.visite_figure_ruoli (chiave, ruolo_id, ruoli_equivalenti, con_impresa, mansione, note) values
  ('csp', 48, '{16,17,48,92}', false, 'CSP', 'Riquadro CSP del verbale'),
  ('cse', 48, '{16,17,48,92}', false, 'CSE', 'Riquadro CSE del verbale'),
  ('rl',  11, '{11}',          false, null,  'Riquadro responsabile dei lavori'),
  ('presente:coordinatore',                  48, '{16,17,48,92}', false, null, null),
  ('presente:titolare',                      23, '{23}',          true,  null, null),
  ('presente:socio titolare',                23, '{23}',          true,  null, null),
  ('presente:preposto',                      12, '{12}',          true,  null, null),
  ('presente:capo cantiere',                 21, '{21}',          true,  null, null),
  ('presente:rspp',                           1, '{1,92}',        true,  null, null),
  ('presente:rspp aziendale',                 1, '{1,92}',        true,  null, null),
  ('presente:rls',                            2, '{2}',           true,  null, null),
  ('presente:direttore tecnico di cantiere', 41, '{41}',          true,  null, null),
  ('presente:direttore tecnico di cartiere', 41, '{41}',          true,  null, 'Refuso presente in 34 verbali storici'),
  ('presente:direttore tecnico impresa',     41, '{41}',          true,  null, null),
  ('presente:lavoratore autonomo',           18, '{18}',          false, null, null),
  ('presente:autonomo',                      18, '{18}',          false, null, null)
on conflict (chiave) do nothing;

-- ── 3. La funzione: una visita, le sue figure, le nomine ──────────────────────
create or replace function public.s_nomine_da_visita(p_visita_id text, p_esegui boolean default true)
returns table (azione text, figura text, persona_id uuid, persona text, ruolo text,
               impresa_id text, access_id integer, dettaglio text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v         public.visite%rowtype;
  f         record;
  m         public.visite_figure_ruoli%rowtype;
  k         text;
  n_cand    integer;
  pid       uuid;
  p         public.persone%rowtype;
  imp_id    text;
  imp_txt   text;
  es        public.s_nomine%rowtype;
  etichetta text;
  nuovo     integer;
  tentativi integer;
begin
  select * into v from public.visite vv where vv.visita_id = p_visita_id;
  if not found or coalesce(v.elimina, 0) <> 0 then
    return;
  end if;

  for f in
    select * from (values
      ('csp',      coalesce(nullif(trim(concat_ws(' ', v.csp_nome,  v.csp_cog)),  ''), v.csp),      null::text),
      ('cse',      coalesce(nullif(trim(concat_ws(' ', v.cse_nome,  v.cse_cog)),  ''), v.cse),      null::text),
      ('rl',       coalesce(nullif(trim(concat_ws(' ', v.rl_nome,   v.rl_cog)),   ''), v.resp_lav), null::text),
      ('presente', coalesce(nullif(trim(concat_ws(' ', v.ppre_nome, v.ppre_cog)), ''), v.nom_ppre), v.qual_ppre)
    ) as t(fig, testo, qual)
  loop
    continue when f.testo is null or trim(f.testo) = '';
    select * into m from public.visite_figure_ruoli r
     where r.chiave = case when f.fig = 'presente'
                           then 'presente:' || lower(trim(coalesce(f.qual, '')))
                           else f.fig end;
    continue when not found;              -- qualifica generica: niente nomina

    figura := f.fig; persona := f.testo; persona_id := null; ruolo := null;
    impresa_id := null; access_id := null; dettaglio := null;

    k := public.nominativo_chiave(f.testo);
    if k is null or position(' ' in k) = 0 then
      azione := 'saltata'; dettaglio := 'nominativo incompleto';
      return next; continue;
    end if;

    select count(*), (array_agg(pp.persona_id))[1] into n_cand, pid
      from public.persone pp
     where public.nominativo_chiave(coalesce(pp.nome, '') || ' ' || coalesce(pp.cognome, '')) = k
       and coalesce(pp.elimina, 0) = 0;
    if n_cand = 0 then
      azione := 'saltata'; dettaglio := 'persona non in anagrafica';
      return next; continue;
    elsif n_cand > 1 then
      azione := 'saltata'; dettaglio := n_cand || ' persone con lo stesso nominativo: non si sceglie';
      return next; continue;
    end if;

    select * into p from public.persone pp where pp.persona_id = pid;
    persona_id := pid;
    persona := nullif(concat_ws(' ', p.cognome, p.titolo, p.nome), '');
    ruolo := (select r.ruolo from public.s_ruoli r where r.id_ruolo = m.ruolo_id);
    if m.con_impresa then
      imp_id := v.impresa_id;
      select i.impresa_nome into imp_txt from public.imprese i where i.impresa_id = v.impresa_id;
    else
      imp_id := null; imp_txt := null;
    end if;
    impresa_id := imp_id;
    etichetta := case f.fig
                   when 'csp' then 'CSP'
                   when 'cse' then 'CSE'
                   when 'rl'  then 'responsabile dei lavori'
                   else 'persona presente in qualità di «' || trim(f.qual) || '»'
                 end;

    --  il lock va preso PRIMA di guardare se la nomina c'e': se la persona e la
    --  sua visita si salvano insieme, due transazioni vedrebbero entrambe «non
    --  c'e'» e ne creerebbero due (corretto il 14/09, prima del recupero storico)
    if p_esegui then
      perform pg_advisory_xact_lock(hashtext('s_nomine.access_id'));
    end if;
    select * into es from public.s_nomine sn
     where sn.persona_id = pid
       and sn.ruolo_id = any (m.ruoli_equivalenti)
       and (not m.con_impresa or sn.impresa_id is not distinct from imp_id)
       and (sn.data_fine is null or sn.data_fine >= v.data_visita)
     order by sn.access_id
     limit 1;

    if found then
      access_id := es.access_id;
      --  una nomina c'e' gia'. Se l'ha scritta questa funzione le si aggiunge la
      --  fase che mancava (CSP -> «CSP e CSE»); quelle scritte a mano non si toccano.
      if m.mansione is not null
         and coalesce(es.note, '') like 'Rilevata dal verbale%'
         and coalesce(es.mansione, '') !~ ('\m' || m.mansione || '\M') then
        if p_esegui then
          update public.s_nomine sn
             set mansione = case when coalesce(sn.mansione, '') = '' then m.mansione
                                 else sn.mansione || ' e ' || m.mansione end,
                 updated_at = now()
           where sn.access_id = es.access_id;
        end if;
        azione := case when p_esegui then 'aggiornata' else 'da_aggiornare' end;
        dettaglio := 'aggiunta la fase ' || m.mansione;
      else
        azione := 'gia_presente';
      end if;
      return next; continue;
    end if;

    if not p_esegui then
      azione := 'da_creare'; dettaglio := etichetta;
      return next; continue;
    end if;

    --  access_id: s_nomine e' lo specchio di Access, senza serial. Si prosegue la
    --  fascia sopra 90000 come fa la maschera nomine, ma sotto lock.
    perform pg_advisory_xact_lock(hashtext('s_nomine.access_id'));
    tentativi := 0;
    loop
      select greatest(90000, coalesce(max(sn.access_id), 90000)) + 1 into nuovo
        from public.s_nomine sn where sn.access_id >= 90000;
      begin
        insert into public.s_nomine (access_id, data_reg, persona_txt, persona_id, impresa_txt,
                                     impresa_id, ruolo_txt, ruolo_id, mansione, note)
        values (nuovo, current_date, persona, pid, imp_txt, imp_id, ruolo, m.ruolo_id,
                coalesce(m.mansione, nullif(trim(f.qual), '')),
                format('Rilevata dal verbale %s del %s: la persona vi compare come %s%s. La data della nomina non è documentata dal verbale.',
                       coalesce(v.nr_verbale, v.visita_id), to_char(v.data_visita, 'DD/MM/YYYY'), etichetta,
                       case when m.con_impresa then ', per l''impresa visitata' else '' end));
        exit;
      exception when unique_violation then
        tentativi := tentativi + 1;
        if tentativi >= 3 then raise; end if;
      end;
    end loop;

    access_id := nuovo;
    azione := 'creata';
    dettaglio := etichetta;
    return next;
  end loop;
end;
$$;
revoke execute on function public.s_nomine_da_visita(text, boolean) from public, anon, authenticated;
grant execute on function public.s_nomine_da_visita(text, boolean) to service_role;

-- ── 4. Trigger sulle visite ───────────────────────────────────────────────────
create or replace function public.tg_visite_nomine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.elimina, 0) = 0 then
    begin
      perform 1 from public.s_nomine_da_visita(new.visita_id, true);
    exception when others then
      raise warning 'nomine dal verbale %: %', new.visita_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
revoke execute on function public.tg_visite_nomine() from public, anon, authenticated;
grant execute on function public.tg_visite_nomine() to service_role;

drop trigger if exists trg_visite_nomine on public.visite;
create trigger trg_visite_nomine
  after insert or update of csp, cse, resp_lav, nom_ppre, qual_ppre,
                            csp_nome, csp_cog, cse_nome, cse_cog, rl_nome, rl_cog,
                            ppre_nome, ppre_cog, impresa_id, data_visita, elimina
  on public.visite
  for each row execute function public.tg_visite_nomine();

-- ── 5. Trigger sulle persone (la persona arriva dopo la visita) ───────────────
create or replace function public.tg_persone_nomine()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k    text;
  pref text;
  vid  text;
begin
  if coalesce(new.elimina, 0) <> 0 then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.nome    is not distinct from old.nome
     and new.cognome is not distinct from old.cognome
     and new.ruoli   is not distinct from old.ruoli
     and new.elimina is not distinct from old.elimina then
    return null;
  end if;

  k := public.nominativo_chiave(coalesce(new.nome, '') || ' ' || coalesce(new.cognome, ''));
  if k is null or position(' ' in k) = 0 then
    return null;
  end if;
  --  filtro grossolano sul cognome per non normalizzare tutte le visite
  pref := substring(coalesce(new.cognome, '') from '^[A-Za-z]{3,}');

  for vid in
    select v.visita_id
      from public.visite v
     where coalesce(v.elimina, 0) = 0
       and (pref is null
            or concat_ws(' ', v.csp, v.cse, v.resp_lav, v.nom_ppre,
                              v.csp_nome, v.csp_cog, v.cse_nome, v.cse_cog,
                              v.rl_nome, v.rl_cog, v.ppre_nome, v.ppre_cog) ilike '%' || pref || '%')
       and k in (
             public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.csp_nome,  v.csp_cog)),  ''), v.csp)),
             public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.cse_nome,  v.cse_cog)),  ''), v.cse)),
             public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.rl_nome,   v.rl_cog)),   ''), v.resp_lav)),
             public.nominativo_chiave(coalesce(nullif(trim(concat_ws(' ', v.ppre_nome, v.ppre_cog)), ''), v.nom_ppre)))
     order by v.data_visita, v.visita_id
  loop
    begin
      perform 1 from public.s_nomine_da_visita(vid, true);
    exception when others then
      raise warning 'nomine dal verbale % (persona %): %', vid, new.persona_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
revoke execute on function public.tg_persone_nomine() from public, anon, authenticated;
grant execute on function public.tg_persone_nomine() to service_role;

drop trigger if exists trg_persone_nomine on public.persone;
create trigger trg_persone_nomine
  after insert or update of nome, cognome, ruoli, elimina
  on public.persone
  for each row execute function public.tg_persone_nomine();
